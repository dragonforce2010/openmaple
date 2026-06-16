#!/usr/bin/env python3
"""Keep-alive pool of claude_agent_sdk_runner subprocesses, one per session.

Kills the per-turn cold start (python + claude CLI boot, 1-3s) by reusing the
runner across turns, and streams every loop event back to the control plane
through an ordered callback queue while the turn is still running.
"""
from __future__ import annotations

import http.client
import json
import queue
import subprocess
import threading
import time
import urllib.parse
import urllib.request
from collections import deque


class RunnerDied(RuntimeError):
    pass


class SessionRunner:
    """One live runner subprocess bound to a session + init config."""

    def __init__(self, command, init_payload, workspace, env, ready_timeout=60):
        self.init_key = runner_init_key(init_payload)
        self.turn_lock = threading.Lock()
        self.proc = subprocess.Popen(
            command,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            cwd=workspace,
            env=env,
            text=True,
            bufsize=1,
        )
        self._events = queue.Queue()
        self._stderr_tail = deque(maxlen=200)
        threading.Thread(target=self._pump_stdout, daemon=True).start()
        threading.Thread(target=self._pump_stderr, daemon=True).start()
        self._write({"type": "init", "payload": init_payload})
        self._await_ready(ready_timeout)

    def alive(self):
        return self.proc.poll() is None

    def close(self):
        try:
            if self.alive():
                self._write({"type": "exit"})
                self.proc.wait(timeout=5)
        except Exception:
            pass
        finally:
            if self.alive():
                self.proc.kill()

    def run_turn(self, query_payload, on_event, timeout):
        """Send one query, stream events to on_event until the result event."""
        with self.turn_lock:
            if not self.alive():
                raise RunnerDied(self._death_report())
            self._write({"type": "query", "payload": query_payload})
            events = []
            deadline = time.monotonic() + timeout
            while True:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    self.close()
                    raise RunnerDied(f"runner turn timed out after {timeout}s")
                try:
                    event = self._events.get(timeout=min(remaining, 1.0))
                except queue.Empty:
                    if not self.alive():
                        raise RunnerDied(self._death_report())
                    continue
                if self._is_fatal(event):
                    self.close()
                    raise RunnerDied(str(event.get("message") or "runner reported a fatal error"))
                on_event(event)
                if event.get("type") != "stream_event":
                    events.append(event)
                if event.get("type") == "result":
                    return events

    def _write(self, value):
        try:
            self.proc.stdin.write(json.dumps(value, ensure_ascii=False) + "\n")
            self.proc.stdin.flush()
        except Exception as error:
            raise RunnerDied(f"runner stdin closed: {error}") from error

    def _await_ready(self, timeout):
        deadline = time.monotonic() + timeout
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                self.close()
                raise RunnerDied(f"runner not ready within {timeout}s: {self._death_report()}")
            try:
                event = self._events.get(timeout=min(remaining, 1.0))
            except queue.Empty:
                if not self.alive():
                    raise RunnerDied(self._death_report())
                continue
            if event.get("type") == "system" and event.get("subtype") == "ready":
                return
            if self._is_fatal(event):
                self.close()
                raise RunnerDied(str(event.get("message") or "runner failed to start"))

    @staticmethod
    def _is_fatal(event):
        return event.get("type") == "system" and event.get("subtype") == "error"

    def _death_report(self):
        tail = "".join(self._stderr_tail).strip()
        return f"runner exited (code={self.proc.poll()}): {tail[-2000:]}" if tail else f"runner exited (code={self.proc.poll()})"

    def _pump_stdout(self):
        for line in self.proc.stdout:
            text = line.strip()
            if not text:
                continue
            try:
                value = json.loads(text)
            except json.JSONDecodeError:
                continue
            if isinstance(value, dict):
                self._events.put(value)

    def _pump_stderr(self):
        for line in self.proc.stderr:
            self._stderr_tail.append(line)


_RUNNERS: dict[str, SessionRunner] = {}
_RUNNERS_LOCK = threading.Lock()


def acquire_runner(session_id, command, init_payload, workspace, env):
    """Reuse the session's live runner; restart it when config changed or it died."""
    init_key = runner_init_key(init_payload)
    with _RUNNERS_LOCK:
        existing = _RUNNERS.get(session_id)
        if existing and existing.alive() and existing.init_key == init_key:
            return existing
        if existing:
            existing.close()
            _RUNNERS.pop(session_id, None)
    runner = SessionRunner(command, init_payload, workspace, env)
    with _RUNNERS_LOCK:
        _RUNNERS[session_id] = runner
    return runner


def drop_runner(session_id):
    with _RUNNERS_LOCK:
        runner = _RUNNERS.pop(session_id, None)
    if runner:
        runner.close()


def runner_init_key(init_payload):
    return json.dumps(init_payload, sort_keys=True, ensure_ascii=False, default=repr)


class EventCallbackSender:
    """Ordered, non-blocking event relay to the control plane.

    A single worker thread preserves event order. The first delivery failure
    degrades the relay permanently for the turn — the control plane then falls
    back to the batch events returned with the run response. streamed_count is
    therefore always a clean prefix of the returned events list.
    """

    DELTA_FLUSH_SECONDS = 0.4
    MAX_BATCH = 16

    def __init__(self, url, token, timeout=10):
        self.url = url
        self.token = token
        self.timeout = timeout
        self.streamed_count = 0
        self.degraded = not url
        self._queue = queue.Queue()
        self._delta_lock = threading.Lock()
        self._delta_buf = []
        self._delta_last_flush = 0.0
        self._delta_seq = 0
        self._conn = None
        self._split = urllib.parse.urlsplit(url) if url else None
        self.post_count = 0
        self.post_ms = 0.0
        self._worker = None
        if not self.degraded:
            self._worker = threading.Thread(target=self._drain, daemon=True)
            self._worker.start()

    def send(self, event):
        if self.degraded:
            return
        if event.get("type") == "stream_event":
            self._buffer_delta(event)
            return
        self._flush_delta()
        self._queue.put(("event", event))

    def finish(self, wait=15):
        self._flush_delta()
        if self._worker:
            self._queue.put(None)
            self._worker.join(timeout=wait)
        return self.streamed_count

    def _buffer_delta(self, event):
        text = _delta_text(event)
        if not text:
            return
        with self._delta_lock:
            self._delta_buf.append(text)
            now = time.monotonic()
            if now - self._delta_last_flush < self.DELTA_FLUSH_SECONDS:
                return
            chunk = "".join(self._delta_buf)
            self._delta_buf.clear()
            self._delta_last_flush = now
        self._emit_delta(chunk)

    def _flush_delta(self):
        with self._delta_lock:
            if not self._delta_buf:
                return
            chunk = "".join(self._delta_buf)
            self._delta_buf.clear()
            self._delta_last_flush = time.monotonic()
        self._emit_delta(chunk)

    def _emit_delta(self, chunk):
        # first=True lets the control plane reset its per-session accumulator at turn start
        self._delta_seq += 1
        self._queue.put(("delta", {"type": "agent_text_delta", "text": chunk, "first": self._delta_seq == 1}))

    def _drain(self):
        # Batch consecutive non-delta events into one POST and reuse a keep-alive HTTPS
        # connection, so the relay no longer serializes at one full WAN round-trip per event.
        # Deltas flush any pending events first, preserving the SSE ordering contract.
        while True:
            item = self._queue.get()
            if item is None:
                return
            if self.degraded:
                continue
            kind, event = item
            if kind == "delta":
                self._send_delta(event)
                continue
            events = [event]
            done = False
            while len(events) < self.MAX_BATCH:
                try:
                    nxt = self._queue.get_nowait()
                except queue.Empty:
                    break
                if nxt is None:
                    done = True
                    break
                if nxt[0] == "delta":
                    self._send_events(events)
                    events = None
                    self._send_delta(nxt[1])
                    break
                events.append(nxt[1])
            if events:
                self._send_events(events)
            if done:
                return

    def _send_events(self, events):
        if self.degraded or not events:
            return
        try:
            self._post({"events": [{"kind": "event", "event": event} for event in events]})
            self.streamed_count += len(events)
        except Exception:
            self.degraded = True

    def _send_delta(self, event):
        if self.degraded:
            return
        try:
            self._post({"kind": "delta", "event": event})
        except Exception:
            self.degraded = True

    def _post(self, payload):
        started = time.monotonic()
        try:
            self._do_post(payload)
        finally:
            self.post_count += 1
            self.post_ms += (time.monotonic() - started) * 1000

    def _do_post(self, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        headers = {"Content-Type": "application/json", "X-Maple-Runtime-Bridge-Token": self.token}
        path = (self._split.path or "/") + (f"?{self._split.query}" if self._split.query else "")
        last_error = None
        for _ in range(2):
            try:
                conn = self._ensure_conn()
                conn.request("POST", path, body=body, headers=headers)
                response = conn.getresponse()
                response.read()
                if response.status >= 500:
                    raise RuntimeError(f"loop_events status {response.status}")
                return
            except Exception as error:
                last_error = error
                self._close_conn()
        raise last_error if last_error else RuntimeError("loop_events post failed")

    def _ensure_conn(self):
        if self._conn is None:
            host = self._split.hostname
            port = self._split.port or (443 if self._split.scheme == "https" else 80)
            if self._split.scheme == "https":
                self._conn = http.client.HTTPSConnection(host, port, timeout=self.timeout)
            else:
                self._conn = http.client.HTTPConnection(host, port, timeout=self.timeout)
        return self._conn

    def _close_conn(self):
        if self._conn is not None:
            try:
                self._conn.close()
            except Exception:
                pass
            self._conn = None


def _delta_text(event):
    inner = event.get("event") if isinstance(event.get("event"), dict) else {}
    delta = inner.get("delta") if isinstance(inner.get("delta"), dict) else {}
    text = delta.get("text")
    return text if isinstance(text, str) else ""

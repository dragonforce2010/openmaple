#!/usr/bin/env python3
"""Contract test for infra/vefaas/runtime-app/runner_pool.py.

Drives SessionRunner against a fake NDJSON runner subprocess and asserts:
- keep-alive: two turns reuse one process
- streaming: events reach the callback in order while the turn runs
- delta coalescing: stream_event deltas merge into ordered agent_text_delta posts
- restart: a changed init payload or a dead process produces a fresh runner
"""
import http.server
import io
import json
import sys
import threading
import types
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "infra" / "vefaas" / "runtime-app"))
import runner_pool  # noqa: E402

fake_sdk = types.ModuleType("claude_agent_sdk")
fake_sdk.ClaudeAgentOptions = object
fake_sdk.ClaudeSDKClient = object
sys.modules.setdefault("claude_agent_sdk", fake_sdk)
import claude_agent_sdk_runner  # noqa: E402

FAKE_RUNNER = r"""
import json, sys
def w(v):
    sys.stdout.write(json.dumps(v) + "\n"); sys.stdout.flush()
init = json.loads(sys.stdin.readline())
assert init["type"] == "init"
w({"type": "system", "subtype": "ready"})
turn = 0
for line in sys.stdin:
    msg = json.loads(line)
    if msg.get("type") == "exit":
        break
    if msg.get("type") != "query":
        continue
    turn += 1
    w({"type": "assistant", "message": {"content": [{"type": "tool_use", "id": f"t{turn}", "name": "Bash", "input": {"command": "ls"}}]}})
    w({"type": "stream_event", "event": {"type": "content_block_delta", "delta": {"type": "text_delta", "text": f"hello-{turn} "}}})
    w({"type": "stream_event", "event": {"type": "content_block_delta", "delta": {"type": "text_delta", "text": "world"}}})
    w({"type": "result", "result": f"done-{turn}", "usage": {"output_tokens": 5}, "pid_marker": turn})
"""

received = []


class CallbackHandler(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", "0"))))
        assert self.headers.get("X-Maple-Runtime-Bridge-Token") == "tok_test"
        # the relay batches non-delta events into {events:[...]}; deltas arrive singly
        if isinstance(body.get("events"), list):
            received.extend(body["events"])
        else:
            received.append(body)
        payload = b"{}"
        self.send_response(202)
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, fmt, *args):
        return


def main():
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), CallbackHandler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    url = f"http://127.0.0.1:{server.server_address[1]}/loop_events"

    command = [sys.executable, "-c", FAKE_RUNNER]
    init = {"cwd": ".", "model": "test-model"}

    # turn 1
    sender = runner_pool.EventCallbackSender(url, "tok_test")
    runner = runner_pool.acquire_runner("sess_a", command, init, ".", None)
    pid_one = runner.proc.pid
    events = runner.run_turn({"type": "user", "message": {"role": "user", "content": "hi"}}, sender.send, timeout=20)
    streamed = sender.finish()
    assert [e["type"] for e in events] == ["assistant", "result"], events
    assert streamed == 2, f"streamed_count {streamed}"

    # turn 2 reuses the same live process (keep-alive)
    sender2 = runner_pool.EventCallbackSender(url, "tok_test")
    runner2 = runner_pool.acquire_runner("sess_a", command, init, ".", None)
    assert runner2.proc.pid == pid_one, "keep-alive should reuse the runner process"
    events2 = runner2.run_turn({"type": "user", "message": {"role": "user", "content": "again"}}, sender2.send, timeout=20)
    sender2.finish()
    assert events2[-1]["pid_marker"] == 2, "second turn must hit the same process state"

    # ordered callbacks: events stream in order, deltas coalesce with first=True at turn start
    kinds = [(item["kind"], item["event"].get("type")) for item in received]
    assert kinds.count(("event", "assistant")) == 2 and kinds.count(("event", "result")) == 2, kinds
    deltas = [item for item in received if item["kind"] == "delta"]
    assert deltas and all(d["event"]["type"] == "agent_text_delta" for d in deltas)
    assert deltas[0]["event"]["first"] is True
    joined = "".join(d["event"]["text"] for d in deltas if "hello-1" in d["event"]["text"] or d is deltas[0])
    assert "hello-1" in deltas[0]["event"]["text"]

    # changed init -> new process
    runner3 = runner_pool.acquire_runner("sess_a", command, {**init, "model": "other"}, ".", None)
    assert runner3.proc.pid != pid_one, "changed init payload must restart the runner"

    # dead process -> RunnerDied, drop_runner clears it
    runner3.proc.kill()
    runner3.proc.wait()
    try:
        runner3.run_turn({"type": "user", "message": {}}, lambda e: None, timeout=5)
        raise AssertionError("run_turn on a dead runner must raise")
    except runner_pool.RunnerDied:
        pass
    runner_pool.drop_runner("sess_a")
    assert_claude_runner_writer_json_safe()

    server.shutdown()
    print("vefaas runner pool contract passed")


def assert_claude_runner_writer_json_safe():
    class Server:
        pass

    original_stdout = sys.stdout
    try:
        captured = io.StringIO()
        sys.stdout = captured
        claude_agent_sdk_runner.NdjsonWriter().write({"type": "system", "server": Server()})
    finally:
        sys.stdout = original_stdout
    parsed = json.loads(captured.getvalue())
    assert parsed["type"] == "system"
    assert "Server" in parsed["server"]


if __name__ == "__main__":
    main()

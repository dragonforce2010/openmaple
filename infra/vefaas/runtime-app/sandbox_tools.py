"""In-process MCP tools that forward every tool call to the control-plane tool
bridge, which executes it inside an isolated veFaaS Sandbox.

The agent loop runs in the runtime container, but its file/shell tools must NOT
execute here — they run in a separate sandbox so one session can never touch
another's files. The SDK's built-in Bash/Read/Write are disabled (see app.py
``disallowed_tools``); the model is steered onto these ``mcp__maple_sandbox__*``
tools instead.

Security: the container only ever holds a per-session bridge token (scoped to
the tool endpoint). Sandbox credentials (gateway URL, api_token) live solely in
the control plane and are injected at the bridge boundary — never readable from
inside this container.
"""
from __future__ import annotations

import http.client
import json
import threading
import urllib.parse

from claude_agent_sdk import create_sdk_mcp_server, tool


SERVER_NAME = "maple_sandbox"
# mcp__maple_sandbox__* — the names app.py allow-lists and the model must use.
TOOL_NAMES = [f"mcp__{SERVER_NAME}__{name}" for name in ("bash", "read_file", "write_file", "grep", "list_files")]


class _ToolBridge:
    """Keep-alive HTTPS relay to the control-plane tool endpoint.

    One connection reused across tool calls (a tool turn is serial within a
    session), guarded by a lock so a retry never races a concurrent call.
    """

    def __init__(self) -> None:
        self.url = ""
        self.token = ""
        self._lock = threading.Lock()
        self._conn: http.client.HTTPConnection | None = None
        self._split: urllib.parse.SplitResult | None = None

    def configure(self, url: str, token: str) -> None:
        with self._lock:
            if url == self.url and token == self.token:
                return
            self.url = url or ""
            self.token = token or ""
            self._split = urllib.parse.urlsplit(self.url) if self.url else None
            self._close()

    def call(self, tool_name: str, tool_input: dict) -> dict:
        if not self.url:
            return {"error": "tool bridge not configured"}
        body = json.dumps({"tool": tool_name, "input": tool_input}, ensure_ascii=False).encode("utf-8")
        headers = {"Content-Type": "application/json", "X-Maple-Runtime-Bridge-Token": self.token}
        path = (self._split.path or "/") + (f"?{self._split.query}" if self._split.query else "")
        with self._lock:
            last_error: Exception | None = None
            for _ in range(2):
                try:
                    conn = self._ensure_conn()
                    conn.request("POST", path, body=body, headers=headers)
                    response = conn.getresponse()
                    text = response.read().decode("utf-8") or "{}"
                    if response.status >= 500:
                        raise RuntimeError(f"tool bridge status {response.status}: {text}")
                    return json.loads(text)
                except Exception as error:  # reconnect once on a dropped keep-alive
                    last_error = error
                    self._close()
        return {"error": str(last_error) if last_error else "tool bridge call failed"}

    def _ensure_conn(self) -> http.client.HTTPConnection:
        if self._conn is None:
            assert self._split is not None
            host = self._split.hostname or "127.0.0.1"
            port = self._split.port or (443 if self._split.scheme == "https" else 80)
            if self._split.scheme == "https":
                self._conn = http.client.HTTPSConnection(host, port, timeout=130)
            else:
                self._conn = http.client.HTTPConnection(host, port, timeout=130)
        return self._conn

    def _close(self) -> None:
        if self._conn is not None:
            try:
                self._conn.close()
            except Exception:
                pass
            self._conn = None


_BRIDGE = _ToolBridge()


def configure_tool_bridge(url: str, token: str) -> None:
    """Point the sandbox tools at this turn's control-plane bridge."""
    _BRIDGE.configure(url, token)


def _ok(text: str) -> dict:
    return {"content": [{"type": "text", "text": text}]}


def _err(text: str) -> dict:
    return {"content": [{"type": "text", "text": text}], "is_error": True}


def _render(result: dict) -> dict:
    """Turn the control-plane /tools response into MCP tool content.

    Bridge response shape: {ok, status, tool_call_id, output} | {error}.
    """
    if result.get("error"):
        return _err(str(result["error"]))
    output = result.get("output")
    failed = result.get("ok") is False or result.get("status") == "failed"
    if isinstance(output, dict):
        # bash → {stdout, stderr, exit_code}; other tools → their own shape
        if "stdout" in output or "stderr" in output or "exit_code" in output:
            parts = []
            if output.get("stdout"):
                parts.append(str(output["stdout"]))
            if output.get("stderr"):
                parts.append(f"[stderr]\n{output['stderr']}")
            code = output.get("exit_code")
            if code:
                parts.append(f"[exit_code] {code}")
            text = "\n".join(parts) if parts else "(no output)"
        else:
            text = json.dumps(output, ensure_ascii=False)
    else:
        text = "" if output is None else str(output)
    return _err(text) if failed else _ok(text)


@tool("bash", "Run a bash command inside the isolated sandbox", {"command": str})
async def bash(args):
    return _render(_BRIDGE.call("bash", {"command": str(args.get("command") or "")}))


@tool("read_file", "Read a file from the sandbox workspace", {"path": str})
async def read_file(args):
    return _render(_BRIDGE.call("read_file", {"path": str(args.get("path") or "")}))


@tool("write_file", "Write a file into the sandbox workspace", {"path": str, "content": str})
async def write_file(args):
    return _render(_BRIDGE.call("write_file", {"path": str(args.get("path") or ""), "content": str(args.get("content") or "")}))


@tool("grep", "Search files in the sandbox workspace for a pattern", {"pattern": str, "path": str})
async def grep(args):
    return _render(_BRIDGE.call("grep", {"pattern": str(args.get("pattern") or ""), "path": str(args.get("path") or ".")}))


@tool("list_files", "List files in the sandbox workspace", {"path": str})
async def list_files(args):
    return _render(_BRIDGE.call("list_files", {"path": str(args.get("path") or ".")}))


def build_sandbox_mcp_server():
    return create_sdk_mcp_server(name=SERVER_NAME, version="1.0.0", tools=[bash, read_file, write_file, grep, list_files])

#!/usr/bin/env python3
import base64
import json
import os
import shlex
import shutil
import subprocess
import threading
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import runner_pool
import sandbox_tools


ROOT = Path(os.environ.get("MAPLE_VEFAAS_DATA_DIR", "/tmp/maple-vefaas-runtime"))
CLAUDE_SDK_RUNNER = Path(__file__).with_name("claude_agent_sdk_runner.py")
AGENT_LOOP_CLI_READY = set()
CLAUDE_SDK_READY = set()


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        self._json(200, {"ok": True, "service": "managed-agents-vefaas-runtime"})

    def do_POST(self):
        try:
            body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", "0"))) or b"{}")
            action = body.get("action")
            if action == "bootstrap":
                self._json(200, {"ok": True, "result": bootstrap(body)})
                return
            if action == "tool":
                self._json(200, {"ok": True, "result": run_tool(body)})
                return
            if action == "run":
                self._json(200, {"ok": True, "result": run_agent_loop(body)})
                return
            self._json(400, {"ok": False, "error": f"unknown action {action}"})
        except Exception as error:
            self._json(500, {"ok": False, "error": str(error)})

    def log_message(self, fmt, *args):
        return

    def _json(self, status, payload):
        data = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


def bootstrap(body):
    session_id = str(body.get("session_id") or "default")
    workspace = workspace_dir(session_id, str(body.get("workspace_path") or "/workspace"))
    workspace.mkdir(parents=True, exist_ok=True)
    uploads = ROOT / session_id / "mnt" / "session" / "uploads"
    uploads.mkdir(parents=True, exist_ok=True)

    resources = body.get("resources") if isinstance(body.get("resources"), list) else []
    mounted = []
    mount_failed = []
    for resource in resources:
        if not isinstance(resource, dict) or resource.get("type") != "file":
            continue
        mount_path = str(resource.get("mount_path") or "")
        if not mount_path.startswith("/mnt/session/uploads/"):
            continue
        target = safe_path(uploads, mount_path.removeprefix("/mnt/session/uploads/"))
        target.parent.mkdir(parents=True, exist_ok=True)
        try:
            mount_session_resource(resource, target)
            mounted.append(mount_path)
        except Exception as error:
            mount_failed.append({"mount_path": mount_path, "error": str(error)})

    # Pre-warm the keep-alive runner during bootstrap so the first user turn
    # skips the claude CLI cold start entirely.
    if isinstance(body.get("agent_config"), dict):
        threading.Thread(target=prewarm_claude_runner, args=(body,), daemon=True).start()

    return {
        "runtime": "ready",
        "session_id": session_id,
        "workspace": str(workspace),
        "mounted": mounted,
        "mount_failed": mount_failed,
        "sandbox_runtime": body.get("sandbox_runtime"),
    }


def mount_session_resource(resource, target):
    """Write one session upload to the runtime. Prefers a short-lived presigned
    TOS download; falls back to inline base64 for local/dev without TOS."""
    presigned_url = str(resource.get("presigned_url") or "")
    if presigned_url:
        with urllib.request.urlopen(presigned_url, timeout=120) as response:
            target.write_bytes(response.read())
        return
    target.write_bytes(base64.b64decode(str(resource.get("content_base64") or "")))


def run_tool(body):
    session_id = str(body.get("session_id") or "default")
    workspace = workspace_dir(session_id, str(body.get("workspace_path") or "/workspace"))
    tool = str(body.get("tool") or "")
    input_value = body.get("input") if isinstance(body.get("input"), dict) else {}

    if tool == "bash":
        completed = subprocess.run(
            ["bash", "-lc", str(input_value.get("command") or "")],
            cwd=workspace,
            text=True,
            capture_output=True,
            timeout=120,
        )
        return {"stdout": completed.stdout, "stderr": completed.stderr, "exit_code": completed.returncode}
    if tool == "read_file":
        path = resolve_runtime_path(session_id, workspace, str(input_value.get("path") or ""))
        return {"path": input_value.get("path"), "content": path.read_text()}
    if tool == "write_file":
        path = resolve_runtime_path(session_id, workspace, str(input_value.get("path") or ""))
        path.parent.mkdir(parents=True, exist_ok=True)
        content = str(input_value.get("content") or "")
        path.write_text(content)
        return {"path": input_value.get("path"), "bytes": len(content.encode("utf-8"))}
    if tool == "list_files":
        base = resolve_runtime_path(session_id, workspace, str(input_value.get("path") or "."))
        files = sorted(str(path.relative_to(base if base.is_dir() else workspace)) for path in base.rglob("*") if path.is_file())
        return {"path": input_value.get("path") or ".", "files": files[:200]}
    if tool == "grep":
        pattern = str(input_value.get("pattern") or "")
        base = resolve_runtime_path(session_id, workspace, str(input_value.get("path") or "."))
        matches = []
        for path in (base.rglob("*") if base.is_dir() else [base]):
            if not path.is_file():
                continue
            for idx, line in enumerate(path.read_text(errors="ignore").splitlines(), 1):
                if pattern in line:
                    matches.append(f"{path}:{idx}:{line}")
        return {"pattern": pattern, "path": input_value.get("path") or ".", "matches": matches[:200]}
    return {"error": f"unknown tool {tool}"}


def run_agent_loop(body):
    session_id = str(body.get("session_id") or "default")
    agent_config = body.get("agent_config") if isinstance(body.get("agent_config"), dict) else {}
    agent_loop = agent_config.get("agent_loop") if isinstance(agent_config.get("agent_loop"), dict) else {}
    agent_env = {str(key): str(value) for key, value in (body.get("agent_env") if isinstance(body.get("agent_env"), dict) else {}).items()}
    runtime_env = os.environ.copy()
    runtime_env.update(agent_env)
    runtime_env.setdefault("MAPLE_SESSION_ID", session_id)
    runtime_env.setdefault("MAPLE_AGENT_TEMPLATE", json.dumps(agent_config, ensure_ascii=False))
    runtime_env.setdefault("MAPLE_AGENT_LOOP_TYPE", str(agent_loop.get("type") or "anthropic_claude_code"))

    workspace = workspace_dir(session_id, str(body.get("workspace_path") or "/workspace"))
    loop_type = str(agent_loop.get("type") or "anthropic_claude_code")
    protocol = str(agent_loop.get("config", {}).get("protocol") if isinstance(agent_loop.get("config"), dict) else "").strip().lower()
    if loop_type == "anthropic_claude_code" and protocol not in {"cli_batch", "batch", "print"}:
        return run_claude_sdk_loop(body, agent_config, session_id, workspace, runtime_env)
    ensure_agent_loop_cli(loop_type, runtime_env)
    command = agent_loop_command(loop_type, runtime_env)
    completed = subprocess.run(
        ["bash", "-lc", command],
        input=agent_loop_prompt(body, agent_config, session_id, str(workspace)),
        cwd=workspace,
        env=runtime_env,
        text=True,
        capture_output=True,
        timeout=int(os.environ.get("MAPLE_AGENT_LOOP_TIMEOUT_SECONDS", "300")),
    )
    if completed.returncode != 0:
        raise RuntimeError(completed.stderr or completed.stdout or f"agent loop exited {completed.returncode}")
    return normalize_agent_loop_output(completed.stdout, completed.stderr, body=body, workspace=workspace)


def run_claude_sdk_loop(body, agent_config, session_id, workspace, runtime_env):
    ensure_claude_sdk_runner(runtime_env)
    callback = runner_pool.EventCallbackSender(*event_callback_target(body))
    timeout = int(os.environ.get("MAPLE_AGENT_LOOP_TIMEOUT_SECONDS", "300"))
    t0 = time.monotonic()
    timings = {"acquire_ms": None, "first_event_ms": None, "first_raw_event_ms": None}

    def on_event(event):
        elapsed_ms = round((time.monotonic() - t0) * 1000)
        if timings["first_raw_event_ms"] is None:
            timings["first_raw_event_ms"] = elapsed_ms
        if not should_relay_loop_event(event):
            return
        if timings["first_event_ms"] is None:
            timings["first_event_ms"] = elapsed_ms
        callback.send(event)

    try:
        raw_events = run_claude_turn(body, agent_config, session_id, workspace, runtime_env, on_event, timeout, timings)
    finally:
        streamed = callback.finish()
    events = [event for event in raw_events if should_keep_loop_event(event)]
    result = normalize_agent_loop_events(events)
    result["streamed_count"] = streamed
    result["timings"] = {
        "turn_ms": round((time.monotonic() - t0) * 1000),
        "acquire_ms": timings["acquire_ms"],
        "first_event_ms": timings["first_event_ms"],
        "first_raw_event_ms": timings["first_raw_event_ms"],
        "events": len(events),
        "raw_events": len(raw_events),
        "streamed_count": streamed,
        "callback_posts": callback.post_count,
        "callback_post_ms": round(callback.post_ms),
    }
    return result


def should_relay_loop_event(event):
    if event.get("type") == "stream_event":
        return True
    return should_keep_loop_event(event)


def should_keep_loop_event(event):
    # SDK system heartbeat/debug events are useful inside the runtime but not in Maple's
    # user-facing event stream. Dropping them keeps transcript deltas from queueing behind
    # debug-only callback posts while preserving streamed_count as a prefix of events[].
    return event.get("type") != "system"


def run_claude_turn(body, agent_config, session_id, workspace, runtime_env, on_event, timeout, timings=None):
    query = claude_query_payload(body)
    init = claude_init_payload(body, agent_config, session_id, str(workspace))
    command = claude_sdk_runner_command()
    acquired_at = time.monotonic()
    try:
        runner = runner_pool.acquire_runner(session_id, command, init, workspace, runtime_env)
        if timings is not None:
            timings["acquire_ms"] = round((time.monotonic() - acquired_at) * 1000)
        return runner.run_turn(query, on_event, timeout)
    except runner_pool.RunnerDied:
        runner_pool.drop_runner(session_id)
        # One fresh retry; drop partial streaming in case the baked CLI rejects the flag.
        retry_init = claude_init_payload(body, agent_config, session_id, str(workspace), allow_partial=False)
        runner = runner_pool.acquire_runner(session_id, command, retry_init, workspace, runtime_env)
        return runner.run_turn(query, on_event, timeout)


def prewarm_claude_runner(body):
    try:
        session_id = str(body.get("session_id") or "default")
        agent_config = body.get("agent_config") if isinstance(body.get("agent_config"), dict) else {}
        agent_loop = agent_config.get("agent_loop") if isinstance(agent_config.get("agent_loop"), dict) else {}
        if str(agent_loop.get("type") or "anthropic_claude_code") != "anthropic_claude_code":
            return
        agent_env = {str(key): str(value) for key, value in (body.get("agent_env") if isinstance(body.get("agent_env"), dict) else {}).items()}
        runtime_env = os.environ.copy()
        runtime_env.update(agent_env)
        workspace = workspace_dir(session_id, str(body.get("workspace_path") or "/workspace"))
        workspace.mkdir(parents=True, exist_ok=True)
        ensure_claude_sdk_runner(runtime_env)
        init = claude_init_payload(body, agent_config, session_id, str(workspace))
        runner_pool.acquire_runner(session_id, claude_sdk_runner_command(), init, workspace, runtime_env)
    except Exception:
        pass


def event_callback_target(body):
    callback = body.get("event_callback") if isinstance(body.get("event_callback"), dict) else {}
    return str(callback.get("url") or ""), str(callback.get("token") or "")


def tool_bridge_target(body):
    bridge = body.get("tool_bridge") if isinstance(body.get("tool_bridge"), dict) else {}
    return str(bridge.get("url") or ""), str(bridge.get("token") or "")


def partial_streaming_enabled():
    return str(os.environ.get("MAPLE_STREAM_PARTIAL", "true")).strip().lower() not in {"0", "false", "no"}


def sandbox_bridge_config(body):
    bridge_url, bridge_token = tool_bridge_target(body)
    if not bridge_url:
        return {}
    return {"url": bridge_url, "token": bridge_token}


def ensure_claude_sdk_runner(runtime_env):
    python = os.environ.get("MAPLE_CLAUDE_AGENT_SDK_PYTHON", "python3")
    cache_key = (python, runtime_env.get("PATH", ""))
    if cache_key in CLAUDE_SDK_READY:
        return
    completed = subprocess.run(
        [python, "-c", "import claude_agent_sdk"],
        env=runtime_env,
        text=True,
        capture_output=True,
        timeout=30,
    )
    if completed.returncode != 0:
        raise RuntimeError("anthropic_claude_code requires claude-agent-sdk in veFaaS runtime. Install infra/vefaas/runtime-app/requirements.txt or set protocol=cli_batch.")
    ensure_agent_loop_cli("anthropic_claude_code", runtime_env)
    CLAUDE_SDK_READY.add(cache_key)


def claude_sdk_runner_command():
    configured = os.environ.get("MAPLE_CLAUDE_AGENT_SDK_RUNNER_COMMAND", "").strip()
    if configured:
        return shlex.split(configured)
    return [os.environ.get("MAPLE_CLAUDE_AGENT_SDK_PYTHON", "python3"), str(CLAUDE_SDK_RUNNER)]


# Built-in SDK tools that would execute IN this runtime container. Disabled so file/shell work
# can only happen through mcp__maple_sandbox__* (which forwards to an isolated sandbox).
SANDBOXED_BUILTIN_TOOLS = ["Bash", "Read", "Write", "Edit", "Glob", "Grep"]


def claude_init_payload(body, agent_config, session_id, workspace, allow_partial=True):
    loop = agent_config.get("agent_loop") if isinstance(agent_config.get("agent_loop"), dict) else {}
    config = loop.get("config") if isinstance(loop.get("config"), dict) else {}
    model = agent_config.get("model") if isinstance(agent_config.get("model"), dict) else {}
    extra_args = dict(config.get("extra_args") or {})
    if allow_partial and partial_streaming_enabled():
        extra_args.setdefault("include-partial-messages", None)
    # Merge the user's remote MCP servers with a serializable bridge config. The child runner
    # process builds the in-process maple_sandbox MCP server after reading this init payload.
    mcp_servers = dict(normalize_mcp_servers(agent_config.get("mcp_servers")))
    disallowed = sorted(set((config.get("disallowed_tools") or []) + SANDBOXED_BUILTIN_TOOLS))
    return {
        "cwd": workspace,
        "cli_path": os.environ.get("MAPLE_CLAUDE_CODE_COMMAND") or None,
        "model": config.get("model") or model.get("id"),
        "system_prompt": agent_loop_prompt({"input": {"text": ""}}, agent_config, session_id, workspace),
        "output_format": config.get("output_format") or "stream-json",
        "permission_mode": config.get("permission_mode") or os.environ.get("MAPLE_CLAUDE_CODE_PERMISSION_MODE") or "bypassPermissions",
        "tools": config.get("tools") or claude_code_tools_for_agent(agent_config),
        "allowed_tools": config.get("allowed_tools") or [],
        "disallowed_tools": disallowed,
        "mcp_servers": mcp_servers,
        "maple_sandbox_bridge": sandbox_bridge_config(body),
        "max_turns": config.get("max_turns"),
        "continue_conversation": config.get("continue_conversation", True),
        "resume": config.get("resume"),
        "fork_session": config.get("fork_session", False),
        "add_dirs": config.get("add_dirs") or [],
        "extra_args": extra_args,
    }


def claude_query_payload(body):
    input_value = body.get("input") if isinstance(body.get("input"), dict) else {}
    user_text = input_value.get("text") if isinstance(input_value.get("text"), str) else ""
    return {"type": "user", "message": {"role": "user", "content": user_text}}


def claude_code_tools_for_agent(agent_config):
    agent_tools = agent_config.get("tools") if isinstance(agent_config.get("tools"), list) else []
    toolset = next((tool for tool in agent_tools if isinstance(tool, dict) and str(tool.get("type") or "").startswith("agent_toolset")), None)
    if not toolset:
        return ["AskUserQuestion"]
    configs = {}
    if isinstance(toolset.get("default_config"), dict):
        configs.update(toolset["default_config"])
    if isinstance(toolset.get("configs"), dict):
        configs.update(toolset["configs"])
    if configs.get("enabled") is False:
        return ["AskUserQuestion"]
    explicit = any(key in configs for key in ("read", "write", "bash", "grep"))

    def enabled(key):
        return bool(configs.get(key)) if explicit else True

    # File/shell capability maps to the sandbox MCP tools, not the built-ins (which are disabled),
    # so the model's only path to the filesystem is the isolated sandbox.
    sb = lambda name: f"mcp__{sandbox_tools.SERVER_NAME}__{name}"
    tools = ["AskUserQuestion"]
    if enabled("bash"):
        tools.append(sb("bash"))
    if enabled("write"):
        tools.append(sb("write_file"))
    if enabled("read"):
        tools.extend([sb("read_file"), sb("list_files")])
    if enabled("grep"):
        tools.append(sb("grep"))
    return sorted(set(tools))


def ensure_agent_loop_cli(loop_type, runtime_env):
    if runtime_env.get("MAPLE_AGENT_LOOP_COMMAND", "").strip() or os.environ.get("MAPLE_AGENT_LOOP_COMMAND", "").strip():
        return
    install_policy = (runtime_env.get("MAPLE_AGENT_LOOP_INSTALL_POLICY") or os.environ.get("MAPLE_AGENT_LOOP_INSTALL_POLICY") or "never").strip().lower()
    if loop_type == "codex_open_source":
        binary = os.environ.get("MAPLE_CODEX_COMMAND", "codex").strip()
        check_args, package, version_env = ["exec", "--help"], "@openai/codex", "MAPLE_CODEX_VERSION"
    else:
        binary = os.environ.get("MAPLE_CLAUDE_CODE_COMMAND", "claude").strip()
        check_args, package, version_env = ["--version"], "@anthropic-ai/claude-code", "MAPLE_CLAUDE_CODE_VERSION"

    cache_key = (loop_type, binary, tuple(check_args), runtime_env.get("PATH", ""))
    if cache_key in AGENT_LOOP_CLI_READY:
        return
    if cli_check(binary, check_args, runtime_env):
        AGENT_LOOP_CLI_READY.add(cache_key)
        return
    if install_policy in {"auto", "install", "npm"}:
        install_node_cli(package, os.environ.get(version_env, "latest"), runtime_env)
        if cli_check(binary, check_args, runtime_env):
            AGENT_LOOP_CLI_READY.add((loop_type, binary, tuple(check_args), runtime_env.get("PATH", "")))
            return
    raise RuntimeError(
        f"{loop_type} requires `{binary}` CLI in veFaaS runtime. "
        f"Preinstall {package}, set MAPLE_AGENT_LOOP_COMMAND, or set MAPLE_AGENT_LOOP_INSTALL_POLICY=auto."
    )


def cli_check(binary, args, runtime_env):
    if not shutil.which(binary, path=runtime_env.get("PATH")):
        return False
    completed = subprocess.run(
        [binary, *args],
        env=runtime_env,
        text=True,
        capture_output=True,
        timeout=30,
    )
    return completed.returncode == 0


def install_node_cli(package, version, runtime_env):
    npm = shutil.which("npm", path=runtime_env.get("PATH"))
    if not npm:
        raise RuntimeError(f"Cannot auto-install {package}: npm is not available in veFaaS runtime.")
    prefix = ROOT / "node-agent-loop-cli"
    prefix.mkdir(parents=True, exist_ok=True)
    spec = f"{package}@{version or 'latest'}"
    completed = subprocess.run(
        [npm, "install", "--prefix", str(prefix), spec],
        env=runtime_env,
        text=True,
        capture_output=True,
        timeout=int(os.environ.get("MAPLE_AGENT_LOOP_INSTALL_TIMEOUT_SECONDS", "180")),
    )
    if completed.returncode != 0:
        raise RuntimeError(completed.stderr or completed.stdout or f"npm install failed for {spec}")
    bin_dir = prefix / "node_modules" / ".bin"
    runtime_env["PATH"] = f"{bin_dir}:{runtime_env.get('PATH', '')}"


def agent_loop_command(loop_type, runtime_env):
    command = (runtime_env.get("MAPLE_AGENT_LOOP_COMMAND") or os.environ.get("MAPLE_AGENT_LOOP_COMMAND") or "").strip()
    if command:
        return command
    if loop_type == "codex_open_source":
        binary = (runtime_env.get("MAPLE_CODEX_COMMAND") or os.environ.get("MAPLE_CODEX_COMMAND") or "codex").strip()
        resolved = shutil.which(binary, path=runtime_env.get("PATH")) or binary
        return f"{shlex.quote(resolved)} exec --cd . --sandbox workspace-write --skip-git-repo-check --color never -"
    binary = (runtime_env.get("MAPLE_CLAUDE_CODE_COMMAND") or os.environ.get("MAPLE_CLAUDE_CODE_COMMAND") or "claude").strip()
    resolved = shutil.which(binary, path=runtime_env.get("PATH")) or binary
    return f"{shlex.quote(resolved)} --print --output-format json --permission-mode bypassPermissions --no-session-persistence"


def agent_loop_prompt(body, agent_config, session_id, workspace):
    input_value = body.get("input") if isinstance(body.get("input"), dict) else {}
    user_text = input_value.get("text") if isinstance(input_value.get("text"), str) else ""
    loop = agent_config.get("agent_loop") if isinstance(agent_config.get("agent_loop"), dict) else {}
    return "\n".join(
        [
            str(agent_config.get("system") or ""),
            "",
            f"Managed agent: {agent_config.get('name') or 'Managed Agent'}",
            f"Session: {session_id}",
            f"AgentLoop: {loop.get('type') or 'anthropic_claude_code'}",
            f"Workspace root: {workspace}",
            "You are the real external agent loop for this managed-agent session.",
            "Use your native CLI tools and keep file operations inside the workspace unless the user explicitly asks otherwise.",
            "Return a concise final response with concrete file paths, commands, or errors when relevant.",
            "",
            "User message:",
            user_text,
        ]
    )


def normalize_agent_loop_events(events, body=None, workspace=None):
    if body is not None and workspace is not None:
        mirror_native_tool_events_to_bridge(body, events, workspace)
    return {"message": {"content": message_from_events(events)}, "usage": usage_from_events(events), "events": events}


def normalize_agent_loop_output(stdout, stderr, body=None, workspace=None):
    events = []
    for line in (stdout or "").splitlines():
        try:
            event = json.loads(line)
        except Exception:
            continue
        if isinstance(event, dict):
            events.append(event)
    if events:
        return normalize_agent_loop_events(events, body=body, workspace=workspace)
    try:
        parsed = json.loads(stdout or "{}")
        if isinstance(parsed, dict):
            if isinstance(parsed.get("result"), str):
                return {"message": {"content": parsed["result"]}, "usage": parsed.get("usage") or {}}
            message = parsed.get("message") if isinstance(parsed.get("message"), dict) else {}
            if isinstance(message.get("content"), str):
                return {"message": {"content": message["content"]}, "usage": parsed.get("usage") or {}}
            if isinstance(parsed.get("content"), str):
                return {"message": {"content": parsed["content"]}, "usage": parsed.get("usage") or {}}
            return parsed
    except Exception:
        pass
    return {"message": {"content": (stdout or stderr).strip()}, "usage": {}}


def message_from_events(events):
    for event in reversed(events):
        text = text_from_event(event)
        if text:
            return text
    return ""


def usage_from_events(events):
    for event in reversed(events):
        if event.get("type") == "result":
            return event.get("usage") or event.get("total_usage") or {}
    return {}


def mirror_native_tool_events_to_bridge(body, events, workspace):
    bridge = body.get("tool_bridge") if isinstance(body.get("tool_bridge"), dict) else {}
    if not bridge.get("url"):
        return
    seen = set()
    calls = []
    for tool_use in native_tool_uses(events):
        tool_id = str(tool_use.get("id") or "")
        if tool_id and tool_id in seen:
            continue
        if tool_id:
            seen.add(tool_id)
        input_value = tool_use.get("input") if isinstance(tool_use.get("input"), dict) else {}
        calls.extend(bridge_calls_for_native_tool(str(tool_use.get("name") or ""), input_value, workspace))
    if not calls:
        return
    # Parallel mirroring: serial HTTP round-trips here used to block the run response.
    with ThreadPoolExecutor(max_workers=min(8, len(calls))) as pool:
        for tool, bridged_input in calls:
            pool.submit(safe_call_tool_bridge, body, tool, bridged_input)


def safe_call_tool_bridge(body, tool, input_value):
    try:
        return maybe_call_tool_bridge(body, tool, input_value)
    except Exception:
        return {}


def native_tool_uses(events):
    for event in events:
        message = event.get("message") if isinstance(event.get("message"), dict) else {}
        content = message.get("content", event.get("content"))
        if not isinstance(content, list):
            continue
        for item in content:
            if isinstance(item, dict) and item.get("type") == "tool_use":
                yield item


def bridge_calls_for_native_tool(name, input_value, workspace):
    normalized = name.strip().lower()
    if normalized == "write":
        path = bridge_relative_path(workspace, input_value.get("file_path") or input_value.get("path") or "")
        return [("write_file", {"path": path, "content": str(input_value.get("content") or "")})]
    if normalized == "read":
        path = bridge_relative_path(workspace, input_value.get("file_path") or input_value.get("path") or "")
        return [("read_file", {"path": path})]
    if normalized == "grep":
        return [
            (
                "grep",
                {
                    "pattern": str(input_value.get("pattern") or ""),
                    "path": bridge_relative_path(workspace, input_value.get("path") or "."),
                },
            )
        ]
    if normalized != "bash":
        return []
    command = str(input_value.get("command") or "")
    if not command:
        return []
    calls = [("bash", {"command": bridge_command(command, workspace)})]
    list_path = bash_list_path(command)
    if list_path is not None:
        calls.append(("list_files", {"path": bridge_relative_path(workspace, list_path)}))
    return calls


def bridge_relative_path(workspace, value):
    text = str(value or ".").strip() or "."
    try:
        target = Path(text)
        if target.is_absolute():
            return str(target.resolve().relative_to(workspace.resolve())) or "."
    except Exception:
        pass
    return text


def bridge_command(command, workspace):
    return command.replace(str(workspace), ".")


def bash_list_path(command):
    try:
        parts = shlex.split(command)
    except Exception:
        return None
    if not parts or parts[0] != "ls":
        return None
    paths = [part for part in parts[1:] if not part.startswith("-")]
    return paths[-1] if paths else "."


def text_from_event(event):
    if isinstance(event.get("result"), str):
        return event["result"].strip()
    if isinstance(event.get("text"), str):
        return event["text"].strip()
    message = event.get("message") if isinstance(event.get("message"), dict) else {}
    content = message.get("content", event.get("content"))
    if isinstance(content, str):
        return content.strip()
    if isinstance(content, list):
        return "\n".join(str(item.get("text", "")) if isinstance(item, dict) else str(item) for item in content).strip()
    return ""


def normalize_mcp_servers(value):
    if not isinstance(value, list):
        return {}
    result = {}
    for item in value:
        if not isinstance(item, dict):
            continue
        name = str(item.get("name") or item.get("id") or "").strip()
        if name:
            result[name] = item.get("config") if isinstance(item.get("config"), dict) else item
    return result


def maybe_call_tool_bridge(body, tool, input_value):
    bridge = body.get("tool_bridge") if isinstance(body.get("tool_bridge"), dict) else {}
    url = str(bridge.get("url") or "")
    token = str(bridge.get("token") or "")
    if not url:
        return {}
    payload = json.dumps({"tool": tool, "input": input_value}, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=payload,
        headers={"Content-Type": "application/json", "X-Maple-Runtime-Bridge-Token": token},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=120) as response:
        return json.loads(response.read().decode("utf-8") or "{}")


def workspace_dir(session_id, workspace_path):
    return ROOT / session_id / workspace_path.lstrip("/")


def resolve_runtime_path(session_id, workspace, value):
    if value.startswith("/mnt/session/uploads/"):
        return safe_path(ROOT / session_id / "mnt" / "session" / "uploads", value.removeprefix("/mnt/session/uploads/"))
    return safe_path(workspace, value or ".")


def safe_path(root, value):
    target = (root / value).resolve()
    root = root.resolve()
    if target != root and root not in target.parents:
        raise ValueError(f"path escapes root: {value}")
    return target


def main():
    host = os.environ.get("SERVER_HOST", "0.0.0.0")
    port = int(os.environ.get("_FAAS_RUNTIME_PORT") or os.environ.get("SERVER_PORT") or "8000")
    ThreadingHTTPServer((host, port), Handler).serve_forever()


if __name__ == "__main__":
    main()

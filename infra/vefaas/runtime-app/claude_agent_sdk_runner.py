#!/usr/bin/env python3
from __future__ import annotations

import asyncio
import json
import logging
import os
import sys
from collections.abc import AsyncIterator
from typing import Any

from claude_agent_sdk import ClaudeAgentOptions, ClaudeSDKClient


MAX_NDJSON_LINE_BYTES = 50 * 1024 * 1024
logging.basicConfig(level=os.environ.get("MAPLE_CLAUDE_AGENT_SDK_LOG_LEVEL", "INFO"), stream=sys.stderr)
logger = logging.getLogger("claude_agent_sdk_runner")
AUTH_ENV_KEYS = (
    "IS_SANDBOX",
    "ANTHROPIC_BASE_URL",
    "ANTHROPIC_MODEL",
    "ANTHROPIC_AUTH_TOKEN",
    "ANTHROPIC_API_KEY",
    "ARK_API_KEY",
    "MAPLE_CLAUDE_CODE_MODEL",
)


class NdjsonReader:
    def __init__(self) -> None:
        self._reader: asyncio.StreamReader | None = None

    async def _ensure_reader(self) -> asyncio.StreamReader:
        if self._reader is None:
            reader = asyncio.StreamReader(limit=MAX_NDJSON_LINE_BYTES)
            await asyncio.get_event_loop().connect_read_pipe(lambda: asyncio.StreamReaderProtocol(reader), sys.stdin)
            self._reader = reader
        return self._reader

    async def read(self) -> dict[str, Any] | None:
        reader = await self._ensure_reader()
        while True:
            line = await reader.readline()
            if not line:
                return None
            text = line.decode("utf-8", errors="replace").strip()
            if not text:
                continue
            try:
                value = json.loads(text)
            except json.JSONDecodeError:
                logger.warning("invalid JSON from stdin: %s", text[:200])
                continue
            if isinstance(value, dict):
                return value


def json_safe(value: Any) -> Any:
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, dict):
        return {str(key): json_safe(item) for key, item in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [json_safe(item) for item in value]
    if hasattr(value, "model_dump"):
        try:
            return json_safe(value.model_dump())
        except Exception:
            pass
    return repr(value)


class NdjsonWriter:
    def write(self, value: dict[str, Any]) -> None:
        sys.stdout.write(json.dumps(json_safe(value), ensure_ascii=False) + "\n")
        sys.stdout.flush()


class ClaudeClient:
    def __init__(self, options: ClaudeAgentOptions) -> None:
        if os.environ.get("CLAUDE_AGENT_SDK_SKIP_VERSION_CHECK") is None:
            os.environ["CLAUDE_AGENT_SDK_SKIP_VERSION_CHECK"] = "1"
        self._sdk = ClaudeSDKClient(options)

    async def connect(self) -> None:
        await self._sdk.connect()

    async def query(self, messages: list[dict[str, Any]]) -> None:
        async def gen() -> AsyncIterator[dict[str, Any]]:
            for message in messages:
                yield message

        await self._sdk.query(gen())

    async def receive_messages(self) -> AsyncIterator[dict[str, Any]]:
        query = getattr(self._sdk, "_query", None)
        if query is None:
            raise RuntimeError("Claude SDK query transport is not ready")
        async for item in query.receive_messages():
            if isinstance(item, dict):
                yield json_safe(item)
            else:
                yield json_safe(item)

    async def interrupt(self) -> None:
        await self._sdk.interrupt()

    async def disconnect(self) -> None:
        await self._sdk.disconnect()


def build_options(config: dict[str, Any]) -> ClaudeAgentOptions:
    option_env = {key: os.environ[key] for key in AUTH_ENV_KEYS if os.environ.get(key)}
    option_env.setdefault("ANTHROPIC_AUTH_TOKEN", option_env.get("ANTHROPIC_API_KEY") or option_env.get("ARK_API_KEY") or "")
    if not option_env["ANTHROPIC_AUTH_TOKEN"]:
        option_env.pop("ANTHROPIC_AUTH_TOKEN")
    option_env.update({str(key): str(value) for key, value in dict(config.get("env") or {}).items()})
    mcp_servers = build_mcp_servers(config)
    return ClaudeAgentOptions(
        cwd=config.get("cwd", "."),
        env=option_env,
        cli_path=config.get("cli_path"),
        add_dirs=config.get("add_dirs", []),
        model=config.get("model"),
        fallback_model=config.get("fallback_model"),
        system_prompt=config.get("system_prompt", ""),
        output_format=config.get("output_format"),
        tools=config.get("tools"),
        allowed_tools=config.get("allowed_tools", []),
        disallowed_tools=config.get("disallowed_tools", []),
        mcp_servers=mcp_servers,
        max_turns=config.get("max_turns"),
        max_budget_usd=config.get("max_budget_usd"),
        continue_conversation=config.get("continue_conversation", True),
        resume=config.get("resume"),
        fork_session=config.get("fork_session", False),
        permission_mode=config.get("permission_mode"),
        settings=config.get("settings"),
        setting_sources=config.get("setting_sources", []),
        extra_args=config.get("extra_args") or {},
    )


def build_mcp_servers(config: dict[str, Any]) -> dict[str, Any]:
    mcp_servers = dict(config.get("mcp_servers") or {})
    if "maple_sandbox_bridge" not in config:
        return mcp_servers
    bridge = config.get("maple_sandbox_bridge") if isinstance(config.get("maple_sandbox_bridge"), dict) else {}
    import sandbox_tools

    sandbox_tools.configure_tool_bridge(str(bridge.get("url") or ""), str(bridge.get("token") or ""))
    mcp_servers[sandbox_tools.SERVER_NAME] = sandbox_tools.build_sandbox_mcp_server()
    return mcp_servers


async def stdin_to_client(reader: NdjsonReader, client: ClaudeClient, writer: NdjsonWriter, done: asyncio.Event, eof: asyncio.Event) -> None:
    try:
        while not done.is_set():
            message = await reader.read()
            if message is None:
                eof.set()
                return
            kind = message.get("type")
            if kind == "query":
                payload = message.get("payload", [])
                await client.query(payload if isinstance(payload, list) else [payload])
            elif kind == "interrupt":
                await client.interrupt()
            elif kind == "exit":
                done.set()
                return
            else:
                logger.warning("unknown message type: %s", kind)
    except Exception as error:
        writer.write({"type": "system", "subtype": "error", "message": str(error)})
        done.set()


async def client_to_stdout(client: ClaudeClient, writer: NdjsonWriter, done: asyncio.Event, eof: asyncio.Event) -> None:
    try:
        async for event in client.receive_messages():
            writer.write(event)
            if event.get("type") == "result" and eof.is_set():
                done.set()
                return
    except asyncio.CancelledError:
        raise
    except Exception as error:
        writer.write({"type": "system", "subtype": "error", "message": str(error)})
        done.set()


async def run() -> None:
    reader = NdjsonReader()
    writer = NdjsonWriter()
    init = await reader.read()
    if init is None or init.get("type") != "init":
        writer.write({"type": "system", "subtype": "error", "message": "expected init message"})
        return

    client = ClaudeClient(build_options(dict(init.get("payload") or {})))
    try:
        await client.connect()
    except Exception as error:
        writer.write({"type": "system", "subtype": "error", "message": f"failed to start Claude CLI: {error}"})
        return

    writer.write({"type": "system", "subtype": "ready"})
    done = asyncio.Event()
    eof = asyncio.Event()
    tasks = [
        asyncio.create_task(stdin_to_client(reader, client, writer, done, eof)),
        asyncio.create_task(client_to_stdout(client, writer, done, eof)),
    ]
    try:
        await done.wait()
    finally:
        for task in tasks:
            if not task.done():
                task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        await client.disconnect()


if __name__ == "__main__":
    asyncio.run(run())

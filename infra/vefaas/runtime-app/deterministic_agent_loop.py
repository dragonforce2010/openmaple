#!/usr/bin/env python3
"""Deterministic agent-loop fixture for cloud smoke tests.

The script mimics native Claude Code tool events closely enough for Maple to
exercise runtime event ingestion and tool mirroring without depending on a paid
external sandbox during infrastructure smoke tests.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path


def main() -> int:
    prompt = sys.stdin.read()
    path, content = parse_write_request(prompt)
    if not path:
        emit({"type": "result", "result": "No write_file request found.", "usage": {}})
        return 0

    target = safe_workspace_path(Path.cwd(), path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, encoding="utf-8")
    list_dir = path.rsplit("/", 1)[0] if "/" in path else "."
    files = sorted(item.name for item in safe_workspace_path(Path.cwd(), list_dir).iterdir() if item.is_file())

    write_id = "toolu_write_deterministic"
    list_id = "toolu_list_deterministic"
    emit_tool_use(write_id, "Write", {"file_path": str(target), "content": content})
    emit_tool_result(write_id, f"wrote {path}")
    emit_tool_use(list_id, "Bash", {"command": f"ls {shellish(list_dir)}"})
    emit_tool_result(list_id, "\n".join(files))
    emit({"type": "result", "result": f"Created {path} and listed {list_dir}.", "usage": {"input_tokens": 0, "output_tokens": 0}})
    return 0


def parse_write_request(prompt: str) -> tuple[str, str]:
    match = re.search(r"create\s+(\S+)\s+with content\s+([^,\n]+)", prompt, re.IGNORECASE)
    if not match:
        return "", ""
    return match.group(1).strip(), match.group(2).strip()


def safe_workspace_path(root: Path, value: str) -> Path:
    target = (root / (value or ".")).resolve()
    root = root.resolve()
    if target != root and root not in target.parents:
        raise ValueError(f"path escapes workspace: {value}")
    return target


def shellish(value: str) -> str:
    return value.replace("'", "'\\''")


def emit_tool_use(tool_id: str, name: str, input_value: dict[str, str]) -> None:
    emit({"type": "assistant", "message": {"content": [{"type": "tool_use", "id": tool_id, "name": name, "input": input_value}]}})


def emit_tool_result(tool_id: str, content: str) -> None:
    emit({"type": "user", "message": {"content": [{"type": "tool_result", "tool_use_id": tool_id, "content": content, "is_error": False}]}})


def emit(value: dict) -> None:
    print(json.dumps(value, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    raise SystemExit(main())

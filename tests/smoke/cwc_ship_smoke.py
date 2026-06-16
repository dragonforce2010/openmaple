#!/usr/bin/env python3
"""Run the CwC ship-your-first-managed-agent reference implementation.

Expected environment:
  ANTHROPIC_BASE_URL=http://127.0.0.1:27951
  ANTHROPIC_API_KEY=maple_dev_key
  CWC_SHIP_DIR=/tmp/cwc-workshops/ship-your-first-managed-agent
"""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path


def main() -> int:
    ship_dir = Path(os.environ.get("CWC_SHIP_DIR", "/tmp/cwc-workshops/ship-your-first-managed-agent")).resolve()
    if not (ship_dir / "agent_complete.py").exists():
        print(f"missing CwC ship workshop at {ship_dir}", file=sys.stderr)
        return 2

    ensure_log(ship_dir)
    sys.path.insert(0, str(ship_dir))
    os.chdir(ship_dir)

    import agent_complete as agent  # type: ignore

    agent_id = agent.setup_agent()
    env_id = agent.setup_environment()
    file_id = agent.upload_log()
    session_id = agent.start_session(agent_id, env_id, file_id)
    print(f"agent {agent_id}")
    print(f"env {env_id}")
    print(f"file {file_id}")
    print(f"session {session_id}")

    seen: list[str] = []
    try:
        for event in agent.stream_reply(
            session_id,
            "Use grep or python to inspect /mnt/session/uploads/app.log, call get_recent_deploys, "
            "and tell me the likely bad commit briefly.",
        ):
            event_type = getattr(event, "type", "")
            seen.append(event_type)
            print(f"event {event_type}")
            stop_type = getattr(getattr(event, "stop_reason", None), "type", None)
            if event_type == "session.status_idle" and stop_type == "end_turn":
                break
            if len(seen) > 100:
                raise RuntimeError("too many stream events without idle")
    finally:
        agent.delete_session(session_id)

    require_event(seen, "agent.custom_tool_use")
    require_event(seen, "user.custom_tool_result")
    require_event(seen, "agent.tool_use")
    require_event(seen, "agent.message")
    require_event(seen, "session.status_idle")
    print("cwc ship smoke passed")
    return 0


def ensure_log(ship_dir: Path) -> None:
    log_path = ship_dir / "data" / "app.log"
    if log_path.exists():
        return
    generator = ship_dir / "data" / "generate_log.py"
    if not generator.exists():
        raise FileNotFoundError(f"missing {generator}")
    subprocess.run([sys.executable, str(generator)], cwd=str(ship_dir), check=True)


def require_event(seen: list[str], event_type: str) -> None:
    if event_type not in seen:
        raise RuntimeError(f"missing stream event {event_type}; saw {seen}")


if __name__ == "__main__":
    raise SystemExit(main())

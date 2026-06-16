---
name: maple-managed-agent
description: Use when a user asks an AI agent to create, manage, deploy, inspect, or interact with agents on the Maple managed agent platform through maple CLI. Trigger for Maple CLI, managed agent platform, agent sessions, deployments, workspace API keys, skill push, skill deploy-run, and session event inspection.
---

# Maple Managed Agent

Use `maple` as the primary interface for Maple platform operations. Prefer JSON
output when another agent or script will parse results.

## First Checks

1. Run `maple config get` to see base URL and redacted auth state.
2. If not logged in, use one of:
   - `maple config login --api-key <maple_ws_...>`
   - `maple config login --local --email <email> --name <name>`
3. Run `maple workspace list --json` and `maple agent list --json` to inspect accessible resources.

## Create And Deploy Agent

```bash
maple init --name support-agent --loop codex_open_source --runtime e2b --directory ./support-agent --yes
maple build --project ./support-agent
maple deploy --project ./support-agent --json
```

Record `deployment_id`, `agent_id`, and `environment_id` from deploy output.

## Interact With Agent

```bash
maple invoke "Inspect the workspace and report evidence." --deployment <deployment_id> --stream
maple status --session <session_id> --json
maple session message <session_id> "Continue with evidence." --json
maple session ask <session_id> "Summarize blockers and next steps." --json
```

For long-running work, keep the session id and poll `maple status --session`.

## Manage Platform Resources

Prefer first-class resource commands for common OpenAPI operations:

```bash
maple workspace list --json
maple workspace api-key create <workspace_id> --display-name "CI" --json
maple model-config list --json
maple agent create --data @agent.json --json
maple environment create --name e2b --runtime e2b --workspace <workspace_id> --json
maple session create --workspace <workspace_id> --agent <agent_id> --environment <environment_id> --json
maple vault create --display-name "MCP credentials" --workspace <workspace_id> --json
maple vault credential create <vault_id> --name github --provider github --auth-type oauth --json
maple mcp catalog --json
```

Use raw API when a new or uncommon endpoint is not covered by a resource command:

```bash
maple api GET /v1/agents --query workspace_id=<workspace_id> --json
maple api POST /v1/agents --data @agent.json --json
maple api GET /v1/sessions/<session_id>/events/stream --stream
```

## Skill-backed Agent Flow

Use `skill deploy-run` when the user wants one command that creates a skill,
attaches it to an agent, deploys, invokes, and returns session evidence.

```bash
maple skill deploy-run \
  --name repo-auditor \
  --description "Use when auditing a repository through Maple." \
  --project ./repo-auditor-agent \
  --loop codex_open_source \
  --runtime e2b \
  --prompt "Audit this repository and create a findings summary." \
  --json
```

## Safety

- Do not print API keys or session cookies.
- Prefer `--json` for machine use.
- Report exact resource ids, endpoint paths, and final session status.
- For runtime failures, include `session_id`, status, and visible tool calls.

More command recipes: `maple skills read maple-managed-agent references/commands.md`.

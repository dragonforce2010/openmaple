# Maple CLI

Maple managed agent platform CLI.

## Install

```bash
npm install -g maple-agent-cli
```

The package builds the Go CLI on first run and caches the binary under the
system temp directory. Go 1.23+ must be installed on the machine running Maple
CLI.

## Quick Test

```bash
maple version --json
maple skills list
maple init --name smoke-agent --loop codex_open_source --runtime local_docker --directory ./smoke-agent --yes
maple build --project ./smoke-agent
```

## Configure

```bash
maple config set api.baseUrl http://127.0.0.1:27951
maple config login --api-key <maple_ws_...>
maple status --json
```

## Platform API

High-frequency Maple resources have first-class commands:

```bash
maple agent list --workspace <ws_id> --json
maple agent create --data @agent.json --json
maple environment create --name e2b --runtime e2b --workspace <ws_id> --json
maple session create --workspace <ws_id> --agent <agent_id> --environment <env_id> --title smoke --json
maple session message <session_id> "Continue" --json
maple vault create --display-name "GitHub credentials" --workspace <ws_id> --json
maple vault credential create <vault_id> --name github --provider github --auth-type oauth --json
maple workspace api-key create <ws_id> --display-name "CI" --scopes control_plane,data_plane --json
maple mcp catalog --json
maple model-config list --json
```

Every Maple OpenAPI route is also reachable through raw `api`:

```bash
maple api GET /v1/agents --query workspace_id=<ws_id> --json
maple api POST /v1/agents --data @agent.json --json
maple api GET /v1/sessions/<session_id>/events/stream --stream
```

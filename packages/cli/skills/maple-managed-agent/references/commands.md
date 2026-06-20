# Maple CLI Commands

## Auth

```bash
maple config set api.baseUrl http://127.0.0.1:27951
maple config login --api-key <maple_ws_...>
maple config whoami
```

## Agent Project

```bash
maple init --name <name> --loop codex_open_source --runtime e2b --directory ./<name> --yes
maple build --project ./<name>
maple deploy --project ./<name> --json
maple status --json
```

## Session Interaction

```bash
maple invoke "message" --deployment <deployment_id> --stream
maple status --session <session_id> --json
maple session list --json
maple session create --workspace <workspace_id> --agent <agent_id> --environment <environment_id> --title "smoke" --json
maple session detail <session_id> --json
maple session events <session_id> --json
maple session message <session_id> "Continue" --json
maple session stream <session_id>
maple session ask <session_id> "What failed?" --json
maple session terminate <session_id>
```

## Platform Skills

```bash
maple skill list --json
maple skill init --name <skill-name> --description "Use when ..." --directory ./skills/<skill-name> --yes
maple skill push --name <skill-name> --description "Use when ..." --file ./skills/<skill-name>/SKILL.md --json
maple skill deploy-run --name <skill-name> --description "Use when ..." --project ./<skill-name>-agent --prompt "task" --json
```

## OpenAPI Resources

```bash
maple agent list --workspace <workspace_id> --json
maple agent get <agent_id> --json
maple agent create --data @agent.json --json
maple agent update <agent_id> --data @agent-patch.json --json
maple agent versions <agent_id> --json
maple agent runtime <agent_id> --json

maple environment list --workspace <workspace_id> --json
maple environment create --name e2b --runtime e2b --workspace <workspace_id> --json
maple environment update <environment_id> --data @environment-patch.json --json

maple vault list --workspace <workspace_id> --json
maple vault create --display-name "GitHub credentials" --workspace <workspace_id> --json
maple vault credential list <vault_id> --json
maple vault credential create <vault_id> --name github --provider github --auth-type oauth --json
maple vault credential oauth-start <vault_id> <credential_id> --json

maple workspace list --json
maple workspace get <workspace_id> --json
maple workspace members list <workspace_id> --json
maple workspace members add <workspace_id> --email user@example.com --json
maple workspace admins add <workspace_id> --email admin@example.com --json
maple workspace runtime-pool <workspace_id> --json
maple workspace api-key create <workspace_id> --display-name "CI" --scopes control_plane,data_plane --json

maple model-config list --json
maple model-config create --data @model-config.json --json
maple model-config test <model_config_id> --json

maple mcp catalog --json
maple mcp list --workspace <workspace_id> --json
maple mcp create --name github --provider github --mcp-url https://example/mcp --auth-type oauth2 --workspace <workspace_id> --json
maple mcp oauth-start <mcp_id> --json

maple memory-store list --workspace <workspace_id> --json
maple memory-store create --name project-memory --workspace <workspace_id> --json
maple memory-store memories <memory_store_id> --query query=needle --json
maple memory-store put <memory_store_id> notes/status.md "content" --json

maple file create --file ./artifact.txt --filename artifact.txt --content-type text/plain --json
maple file get <file_id> --json
maple artifact list --json
maple artifact session <session_id> --json

maple deployment list --json
maple deployment get <deployment_id> --json
maple deployment invoke <deployment_id> "hello" --json
```

## Raw API Fallback

Use `api` for any Maple OpenAPI endpoint not yet represented by a first-class
command.

```bash
maple api GET /v1/agents --query workspace_id=<workspace_id> --json
maple api POST /v1/agents --data @agent.json --json
maple api PATCH /v1/environments/<environment_id> --data '{"name":"sandbox"}' --json
maple api GET /v1/sessions/<session_id>/events/stream --stream
```

# Minimal SDK Run

Run one managed-agent session through the local repo SDK source.

This example is for developers who already have:

- a running OpenMaple API server
- a workspace API key with the full `maple_ws_...` value
- one agent id
- one environment id

It does not require publishing or installing `maple-agent-sdk`; it imports `../../packages/sdk/index.mjs` from this repo.

## Run

```bash
cp examples/minimal-sdk-run/.env.example examples/minimal-sdk-run/.env
```

Edit `examples/minimal-sdk-run/.env`, then run:

```bash
node examples/minimal-sdk-run/index.mjs
```

Expected output:

```text
OpenMaple minimal SDK run
baseUrl=http://127.0.0.1:27951
workspace=ws_...
agent=agent_...
environment=env_...
session=sess_...
agent_message
...
```

## Environment

| Variable | Required | Notes |
|---|---:|---|
| `MAPLE_API_BASE_URL` | no | Defaults to `http://127.0.0.1:27951`. |
| `MAPLE_API_KEY` | yes | Full workspace API key. Do not use the shortened key prefix from lists. |
| `MAPLE_WORKSPACE_ID` | yes | Workspace where the agent and environment live. |
| `MAPLE_AGENT_ID` | yes | Agent to run. |
| `MAPLE_ENVIRONMENT_ID` | yes | Environment/runtime to bind to the session. |
| `MAPLE_MESSAGE` | no | User message sent after the session stream is ready. |
| `MAPLE_RUN_TIMEOUT_MS` | no | Defaults to `120000`. |

## Why this example exists

The console is the fastest way to see OpenMaple. This script shows the same managed-agent boundary from code: create a session, open the event stream, send a user message, and stop when the agent replies or the session fails.

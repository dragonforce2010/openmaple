# E2E Test Suite

## Command

Run the complete acceptance suite from the project root:

```bash
bun run test:all
```

For E2E only:

```bash
bun run test:e2e
```

For Anthropic Managed Agents compatibility and CwC workshop smoke:

```bash
ANTHROPIC_BASE_URL=http://127.0.0.1:8787 ANTHROPIC_API_KEY=lmap_dev_key bun run test:cwc-ship
```

For veFaaS runtime contract coverage:

```bash
bun run test:vefaas-provisioner
bun run test:vefaas-contract
```

For a real Volcengine veFaaS runtime:

```bash
bun run test:vefaas-real
```

`tests/e2e/e2e.mjs` uses `E2E_API_BASE` and `E2E_WEB_BASE` when provided. Without those values it can auto-start isolated localhost API/web servers; the web side runs the Vite admin app and proxies API requests through the configured Maple API base.

## Environment Requirements

- Docker daemon must be running.
- `OPENAI_API_KEY` or `ARK_API_KEY` must be available.
- `OPENAI_BASE_URL` may point at an OpenAI-compatible provider.
- Project `.env` must provide a real `E2B_API_KEY` for real sandbox runs. `sandbox.config.json` should only carry non-secret defaults such as template, workspace path, and timeout.
- veFaaS provisioning tests use fake SDK/OpenAPI clients and require no cloud credentials.
- Fire-and-forget veFaaS contract tests use a local fake HTTP trigger and require no cloud credentials.
- Real Volcengine veFaaS cloud tests load project-level credentials from the project root `.env`; do not copy those secrets into tracked repo files.
- Playwright Chromium must be available through the project dependency install.

## Test Cases

| ID | Area | Proof |
|---|---|---|
| E2E-001 | Server boot | `/health` returns `{ ok: true, service: "maple" }`. |
| E2E-002 | API validation | `POST /v1/agents` with invalid payload returns `400` and field errors. |
| E2E-003 | Docker runtime prerequisite | `docker info --format '{{.ServerVersion}}'` returns a server version for the local Docker fallback path. |
| E2E-004 | Agent builder | `POST /v1/agent_drafts` returns normalized `draft.name`, `draft.system`, `tools[]`, and optional `mcp_servers[]`. |
| E2E-005 | Agent persistence | `POST /v1/agents` returns an agent id, version, config, and config hash. |
| E2E-006 | Sandbox environment persistence | `GET /v1/environments` includes default E2B and local Docker fallback environments; `POST /v1/environments` persists both E2B and local Docker provider configs. |
| E2E-007 | Vault persistence | `POST /v1/vaults` returns a vault id and metadata. |
| E2E-008 | Secret safety | `POST /v1/vaults/:id/credentials` creates an encrypted secret file and does not expose `secret_ref` or raw secret text. |
| E2E-009 | Memory persistence | `POST /v1/memory_stores`, `PUT /v1/memory_stores/:id/memories/*path`, and query listing return the persisted record. |
| E2E-010 | Skill indexing | `POST /v1/skills/scan` indexes local skills and `GET /v1/skills` includes `skill-creator`. |
| E2E-011 | Session creation | `POST /v1/sessions` returns a session id, workspace path, metadata, and immutable agent snapshot. |
| E2E-012 | E2B runtime boot | Session detail eventually shows status `idle` with real E2B runtime metadata and `sandbox_id`. |
| E2E-013 | E2B provider/tool loop | Posting `user.message` to an E2B-backed session completes `write_file` and `list_files`, and host workspace sync contains the exact file content. |
| E2E-014 | Local Docker runtime boot | Session detail eventually shows status `idle` with local Docker fallback runtime metadata. |
| E2E-015 | Provider/tool loop | Posting `user.message` records `user.message`, `session.status_running`, `agent.tool_use`, `tool.result`, `agent.message_delta`, and final `session.status_idle`; the script explicitly fails if any required event type is missing. |
| E2E-016 | Real workspace artifact | The file requested through `write_file` exists under `.managed-agents/sessions/<session-id>/qa/` with exact expected content. |
| E2E-017 | Desktop UI | Playwright verifies Quickstart, resource navigation, session detail, transcript/debug visibility, and takes a desktop screenshot. |
| E2E-018 | Mobile UI | Playwright verifies Quickstart at `390x844`, checks horizontal overflow, and takes a mobile screenshot. |
| E2E-019 | Quickstart feedback | Clicking or pressing Enter on Quickstart shows immediate generation feedback while the provider call is running. |
| E2E-020 | Session composer | The chat composer is visible in the first viewport and Enter sends a message. |
| E2E-021 | Template CRUD | UI creates and edits template name/category/description/JSON, then verifies invalid JSON shows an inline error without a successful save. |
| E2E-022 | Skill CRUD | UI creates and edits a local skill, writes it under `~/.agents/skills`, verifies `SKILL.md`, and checks all seven supported client symlinks. |
| E2E-023 | Skill file tree/editor | API and UI load a skill directory tree, read `SKILL.md`, edit it, save it, and verify persisted content through API reread. |
| E2E-024 | Resource detail panels | Agents, Environments, Vaults, Memory, Skills, Templates, Users, Model gateway, and Artifacts pages expose a settings/detail panel. |
| E2E-025 | Lark SSO OpenAPI start | `/v1/auth/providers` exposes `lark_sso`; `/v1/auth/oauth/lark_sso/start` returns a Feishu authorize URL when configured or an explicit `501 auth_provider_not_configured` when not configured. |
| E2E-026 | Button audit | A required `buttonAudit` set for Quickstart, Sessions, Environments, Templates, Skills, Model gateway, Artifacts, and modal close/save paths is clicked and asserted. |
| E2E-027 | GUI Computer Use evidence | Manual Computer Use validation records the local URL, visible screens, clicked controls, timestamp, and pass/fail result. |
| E2E-028 | Agent draft provider fallback | A separate user with an intentionally broken default model config calls `POST /v1/agent_drafts`; the API returns a valid `schema-fallback` draft with `provider_fallback: true` in under 5 seconds instead of surfacing a 502. |
| E2E-029 | Quickstart create-agent feedback | UI clicks `Create this agent`, verifies `Creating agent...` appears, and verifies the button is disabled while the POST is in flight. |
| E2E-030 | Modal write error UX | UI forces `POST /v1/environments` to fail and verifies the Create environment modal stays open with an inline API error, while expected console noise is excluded from the global console audit. |
| E2E-031 | AgentLoop selection | Agent drafts and persisted agents include `agent_loop.type`; E2E creates one `anthropic_claude_code` agent and one `codex_open_source` agent, and session snapshots preserve the loop. |
| E2E-032 | Event write safety | External `POST /v1/sessions/:id/events` rejects forged system/agent events such as `agent.tool_use`; only `user.message` is client-writable. |
| E2E-033 | Maple CLI deployment | `Maple CLI init/build/deploy/status` publishes a `codex_open_source` manifest through `/v1/deployments` and verifies the deployment is listed with agent/environment ids. |
| E2E-034 | Anthropic SDK CwC compatibility | With only `ANTHROPIC_BASE_URL` and `ANTHROPIC_API_KEY` changed, `/tmp/cwc-workshops/ship-your-first-managed-agent/agent_complete.py` creates agent/environment/file/session, streams events, handles `agent.custom_tool_use`, posts `user.custom_tool_result`, receives sandbox `agent.tool_use`, final `agent.message`, and deletes the session. |
| E2E-035 | veFaaS runtime contract | `bun run test:vefaas-contract` starts a local HTTP trigger, creates a real platform session with `agent_runtime.provider=vefaas`, verifies bootstrap sends file resources and bearer auth, and verifies `bash/read_file/write_file/list_files/grep` tool requests/responses. |
| E2E-036 | Real Volcengine veFaaS runtime | When project `.env` provides veFaaS invoke/function configuration, the same runtime contract must run against the real cloud HTTP trigger and prove a session can bootstrap the veFaaS agent runtime, attach an E2B sandbox, and execute at least `bash` and `grep` in the sandbox. |
| E2E-037 | veFaaS provisioning contract | `bun run test:vefaas-provisioner` verifies the deploy helper does not depend on veadk, loads only project `.env`, zips the fixed runtime template, calls direct Volcengine SDK/OpenAPI actions in order, and outputs `invoke_url`/`function_id` binding data. |

## Error Categories Covered

- Clickability: every required navigation/action/modal button has a state assertion after click.
- Post-click functional failure: forced API failures must render inline or banner errors.
- Slow action feedback: long-running draft/agent creation must show busy text and disable duplicate submission.
- Provider/runtime dependency failure: missing, broken, or timed-out model providers must fall back where the workflow can still produce a safe draft.
- Data safety: secrets and gateway keys are checked for non-exposure in list/detail APIs.
- Responsive UX: mobile viewport checks horizontal overflow.
- Console health: unexpected browser console errors fail the suite.
- Artifact/runtime correctness: Docker/E2B tool loops must create real files and expose downloadable artifacts.
- Programmatic onboarding: `Maple CLI` must create a local harness project, build a bundle, deploy it, and preserve AgentLoop selection in the platform deployment record.
- Compatibility: the official Anthropic Python SDK and CwC reference implementation are used as black-box clients.
- veFaaS runtime: bootstrap payloads, file resource materialization, bearer auth, and all built-in runtime tool names are asserted at the HTTP trigger boundary.

## Acceptance Output

A successful E2E run prints JSON:

```json
{
  "ok": true,
  "stamp": 1779853892425,
  "session_id": "sess_...",
  "checks": [
    { "status": "PASS", "name": "API health" }
  ]
}
```

Screenshots are written to:

```text
/tmp/managed-agents-e2e-<stamp>.png
/tmp/managed-agents-e2e-mobile-<stamp>.png
```

## Computer Use Evidence

Headless Playwright remains the automated gate, but GUI Computer Use is required for manual interactive validation when an unlocked macOS desktop is available. Evidence must include:

- Absolute date/time and local URL.
- Screens observed through Computer Use.
- Controls clicked or typed into.
- Any visible failure, overlap, blank screen, or console-like error.
- Pass/fail conclusion and screenshot/observation handle when available.

## Locked-Screen Policy

This test suite intentionally uses headless Playwright rather than GUI Computer Use. Headless browser automation is the reliable path for locked or unattended macOS runs. GUI Computer Use should be treated as an additional manual visual acceptance pass that requires an unlocked desktop session.

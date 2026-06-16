# OpenMaple Spec

## Purpose

This project implements OpenMaple, an API-first open managed agent platform. It provides a prototype-faithful web console, REST API, SDK, and CLI for opening a workspace, creating reusable agent definitions, configuring runtime/sandbox environments, attaching credential vaults, running sessions, storing artifacts, and observing append-only session events.

## Current Product Surface

- Maple Console: served from `ui-design/MaplePrototype.html` as the visible source of truth. The visible pages are Dashboard, Quickstart, Agents, Sessions, Environments, Credential Vaults, Tenant, Models, API Keys, and Documentation.
- API server: Express routes under `/v1/*`, plus `/health`.
- Persistence: MySQL database `maple` on `vedbm-qkydajdkqldu.pri.mysql.vedb.volces.com`; product records must not come from bundled prototype sample arrays or local-only seeds.
- Object storage: Volcengine TOS bucket `maple-bucket-michael`; uploaded files and generated artifacts must store object metadata in MySQL and content in TOS.
- Runtime: configurable sandbox infrastructure. E2B is the default sandbox/tool runtime provider; local Docker is a development fallback only when explicitly configured.
- Provider loop: OpenAI-compatible chat completions with function tool calls.
- AgentLoop contract: agent definitions carry `agent_loop.type`, currently supporting `anthropic_claude_code` and `codex_open_source` as stable selection values. The first value is presented as Maple Code loop in product surfaces while remaining stable for existing persisted configs.
- Built-in tools: `bash`, `read_file`, `write_file`, `list_files`, `grep`, `memory_search`, and `memory_write`.
- Vaults: credential metadata is persisted in MySQL; raw secret material and secret references must not be exposed in API responses.
- Prototype scope exclusions: Memory, Skills, Templates, Artifacts, Users, Usage, Cost, Logs, and Cache pages are not visible product surfaces unless `MaplePrototype.html` reintroduces them.

## Spec-Driven Operating Mode

All future code-change work in this project must start from this spec and a Superpowers plan under:

```text
docs/superpowers/plans/YYYY-MM-DD-<feature-name>.md
```

Implementation must proceed task-by-task from the plan. Each task needs explicit files, commands, expected results, and verification gates. The plan can be updated as evidence changes, but implementation should not proceed from vague notes or ad hoc chat-only requirements.

## Functional Requirements

### Agent Definition

- The platform must generate an agent draft from a natural-language prompt using the configured provider.
- Generated drafts must normalize to `AgentConfig` with `name`, `description`, `model`, `system`, `tools`, `mcp_servers`, `skills`, and optional metadata.
- Reviewed agents must be persisted as versioned resources.
- Sessions must store an immutable agent snapshot at creation time.
- Agent definitions must include an explicit `agent_loop` object. Users can select `anthropic_claude_code` for Maple Code-style managed coding behavior or `codex_open_source` for Codex-style open-source loop/harness workflows.
- CLI-created agents must preserve `agent_loop.type` in persisted agent versions, session snapshots, and deployment records.

### Programmatic SDK And CLI

- Terminal users must be able to configure the API endpoint, authenticate with local login, initialize a local harness project, build a bundle, deploy it, inspect status, and invoke a deployment through Maple CLI.
- Maple CLI must support `init`, `invoke`, `version`, `status`, `config`, `build`, and `deploy`; no legacy CLI executable alias is exposed in the product package.
- Deployment manifests must include agent config, environment config, harness metadata, resources, vault ids, memory store ids, and include/exclude metadata.
- Deployment records must persist under `/v1/deployments` and link to the created agent and environment.
- Custom harness hooks are modeled as an outer-loop contract (`beforeInvoke`, `onEvent`, `afterInvoke`) in the MVP. The server stores and audits the hook manifest; direct server-side execution of uploaded hook code is intentionally out of scope until sandboxed hook execution is added.

### Environment And Runtime

- Environments must persist runtime configuration, including `sandbox.provider`, E2B template/workspace settings, Docker image, and networking mode.
- The default sandbox provider must come from `sandbox.config.json` / `MAPLE_SANDBOX_PROVIDER`, with E2B selected by default.
- E2B credentials must be configurable through `sandbox.config.json` or `E2B_API_KEY`.
- Creating a session must create an isolated workspace under `.managed-agents/sessions/<session-id>`.
- Bootstrapping a session must create or reconnect to the selected runtime: E2B sandbox for `e2b`, Docker container for `local_docker`.
- Tool execution must run inside the session runtime or operate against the session workspace.

### Session Events And Observability

- Session events are the source of truth for UI timelines.
- The platform must record user messages, status transitions, agent messages, tool uses, and tool results.
- The UI must show transcript/debug modes and allow inspecting individual event payloads.
- The SSE endpoint must stream session events for active sessions.

### Vaults And Secrets

- Vaults must be explicitly linked to sessions through `vault_ids`.
- Credential creation must persist metadata in MySQL and store sensitive material only through the configured secret storage path.
- API responses must not expose raw secrets, raw API keys, or `secret_ref`.
- Credential metadata may include MCP registry hints such as Notion MCP server URL.

### Prototype Source Of Truth

- `ui-design/MaplePrototype.html` is the visual and interaction source of truth for all visible console behavior.
- The Bun web server may dynamically hydrate the bundled prototype with `/v1/console_snapshot`, but it must preserve the prototype's layout, copy, navigation order, drawers, modals, and responsive behavior.
- Bundled prototype sample rows are design fixtures only. Product data must be replaced by MySQL-backed API data before rendering the authenticated console.
- Features absent from the prototype must not appear in the local visible product, even if older React code or API routes still exist internally.

### Frontend Console

- The first authenticated screen must be the prototype Dashboard, not a marketing page.
- The Quickstart flow must guide Describe -> Agent review -> Environment -> Vault -> Session.
- Quickstart send must give immediate visible feedback after click or Enter, even when provider generation takes time.
- Sessions must keep the chat composer visible without requiring page-bottom scrolling.
- Session chat must support Enter-to-send.
- Resource pages must render current API state without runtime console errors.
- Resource pages must expose prototype-matched detail/settings panels for agents, environments, vaults, tenant, model pool, API keys, and documentation.
- Desktop and mobile layouts must avoid blank screens, framework overlays, and incoherent overlap.
- E2E acceptance must click the relevant visible buttons across the prototype target screens and assert a required button-audit set. Each clicked button must prove state changes, modals, loading states, persisted API state, or explicit no-op rationale.
- GUI Computer Use validation is a separate manual evidence gate for interactive macOS verification. It must record the date/time, target URL, visible screens, clicked controls, and observed pass/fail result.

## E2E Acceptance Criteria

The project is acceptable when this command exits with code `0`:

```bash
bun run test:all
```

The command must prove:

- TypeScript compilation succeeds.
- Production build succeeds.
- API health responds.
- Invalid API payloads are rejected.
- MySQL connectivity reaches database `maple`.
- Uploaded file content is stored in TOS and metadata is persisted in MySQL.
- The served prototype console hydrates from `/v1/console_snapshot`, has no bundled demo data leakage, and exposes only prototype-approved navigation.
- Lark SSO provider discovery and OpenAPI authorization start behavior are explicit.
- Provider-backed agent draft generation returns normalized config.
- Agent, E2B environment, vault, credential, model config, workspace API key, artifact metadata, and session resources are persisted in MySQL.
- Credential secret material is encrypted and not leaked in API responses.
- Session detail includes immutable agent snapshot and linked resources.
- A real E2B sandbox session bootstraps to `idle` and records `runtime.type = "e2b"` plus `sandbox_id`.
- A real E2B-backed provider/tool loop writes and lists a file, then syncs the exact file content back to the host workspace.
- Local Docker fallback runtime reaches `idle` only when local Docker is explicitly enabled for that test run.
- A real provider/tool loop records user, agent, tool, and status events.
- The provider/tool loop event assertion must explicitly require `user.message`, `session.status_running`, `agent.tool_use`, `tool.result`, `agent.message_delta`, and `session.status_idle`.
- The provider/tool loop event assertion must explicitly require `agent.loop_selected`.
- Client event writes must reject non-user event types such as `agent.tool_use`, `tool.result`, and `session.status_idle`.
- `maple init/build/deploy/status` must publish and list a deployment with `agent_loop.type = "codex_open_source"`.
- A file written through the agent tool loop exists on the host workspace with exact expected content.
- Web UI renders Dashboard, Quickstart, Agents, Sessions, Environments, Vaults, Tenant, Models, API Keys, and Documentation.
- Web UI exposes prototype-matched detail/settings panels for all prototype primary resource pages.
- Quickstart send button shows immediate generation feedback.
- Session chat composer is visible and supports Enter send.
- Button audit covers a required set of visible buttons in Dashboard, Quickstart, Agents, Sessions, Environments, Vaults, Tenant, Models, API Keys, Documentation, and modal close/save flows.
- Session transcript/debug detail is visible.
- Desktop and mobile Playwright screenshots are produced without relevant console errors.
- Manual Computer Use validation is performed against the local web console and captured as evidence outside the headless Playwright gate.

## Known Boundaries

- The current E2E validates a Notion MCP server requirement and vault credential plumbing, but it does not perform a real Notion read/write call.
- OAuth/device-code flows are not implemented; token-like secrets are stored through the local encrypted secret writer.
- Budget and cost accounting are not part of the current acceptance gate.
- GUI Computer Use validation requires an unlocked interactive macOS session. Headless Playwright E2E is the reliable default for locked or unattended runs.

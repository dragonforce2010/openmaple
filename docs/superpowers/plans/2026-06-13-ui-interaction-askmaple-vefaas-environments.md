# Maple UI interaction hardening, AskMaple, runtime visibility, and environment lifecycle

## Goal

Make the core Maple console path feel production-grade: create Agent, create Session, chat with Agent, inspect AskMaple, inspect veFaaS Runtime Pool / Sandbox Pool, and manage Environments without dead air or hidden runtime state.

## Terms

- `AskMaple`: session-context assistant that answers from session detail, events, tool calls, artifacts, and runtime metadata.
- `Runtime Pool` / `Pool Member`: workspace-level veFaaS agent runtime function pool.
- `Sandbox`: tool runtime for a session or standby pool member, separate from AgentRuntime.

## TDD Coverage First

- [x] `tests/contracts/maple_ui_interaction_contract.ts`: source-level UI contract for no localhost samples, Chinese templates, modal loading indicators, Agent edit name/config-template controls, Environment edit/delete controls, session loading indicators, runtime deep fields, sandbox chips, and environment relationship lists.
- [x] `tests/contracts/environment_lifecycle_contract.ts`: API contract for Environment update name/description/config, Environment delete preview with linked agents/sessions, forced archive delete, and hidden-from-list behavior.
- [x] `tests/contracts/workspace_runtime_pool_contract.ts`: existing coverage kept green for runtime pool function metadata and Agent runtime binding fields.
- [x] `tests/contracts/prototype_console_contract.ts`: browser contract kept green after loading, template, AskMaple, and runtime detail changes.
- [x] `tests/e2e/e2e.mjs`: customer UI walkthrough covers Chinese templates, loading assertions, AskMaple, session flow, and generated code checks.
- [ ] Computer Use acceptance script/manual checklist: attempted on local and cloud, blocked by Computer Use window enumeration errors (`cgWindowNotFound`, `noWindowsAvailable`, `timeoutReached`).

## Implementation Slices

- [x] Shared UI primitives: busy buttons, session detail loading overlay/skeleton, runtime member detail component, URL copy/link helpers.
- [x] AskMaple: keep API answer path, improve drawer states, labels, stats, and empty/loading/error behavior.
- [x] Session performance UX: clear stale detail on selection, show loading state immediately, keep optimistic user message, and ensure append polling does not re-render old detail as if current.
- [x] Runtime/Sandbox visibility: workspace settings/detail, Agent runtime tab, and Session header/detail show function id/name, invoke URL, region, member id, sandbox id, gateway URL, status, active sessions, config, and console jump links.
- [x] Templates: replace English shallow templates with Chinese-first deep templates, add package-heavy scenarios that create useful Environment package configs.
- [x] Agent edit: support name, description, model, system, full config editing, and template-based config replacement.
- [x] Samples/docs: user-facing generated snippets use `MAPLE_API_BASE_URL` with cloud stable base, never `http://127.0.0.1:27951`; local defaults stay only in internal test harnesses.
- [x] Environment lifecycle: API archive delete + preview links, UI edit name/description/packages/networking/metadata, related Agents/Sessions detail list, delete confirmation with one-click forced archive.

## Files

- `apps/admin-web/src/pages/sessions/*`
- `apps/admin-web/src/pages/agents/*`
- `apps/admin-web/src/pages/workspaces/*`
- `apps/admin-web/src/pages/modals/*`
- `apps/admin-web/src/config/templates.ts`
- `apps/admin-web/src/components/shared/code.tsx`
- `apps/control-plane-api/src/routes/agentEnvironmentRoutes.ts`
- `apps/control-plane-api/src/routes/workspaceRoutes.ts`
- `apps/control-plane-api/src/routes/routeHelpers.ts`
- `apps/control-plane-api/src/storage/storeAgentsEnvironments.ts`
- `apps/control-plane-api/src/storage/storeWorkspace.ts`
- `apps/control-plane-api/src/storage/storeSandboxPool.ts`
- `tests/contracts/*`
- `tests/e2e/e2e.mjs`

## Verification

- [x] `bun run typecheck`
- [x] `bun run lint`
- [x] `bun run test:maple-docs`
- [x] `bun run test:workspace-runtime-pool`
- [x] `bun run test:prototype-console`
- [x] `bun tests/contracts/maple_ui_interaction_contract.ts`
- [x] `bun tests/contracts/environment_lifecycle_contract.ts`
- [x] `bun run test:e2e`
- [ ] Local Computer Use smoke on `http://127.0.0.1:5173` blocked by Computer Use window enumeration errors.
- [x] `bun run deploy:vefaas:stable`
- [x] `bun run status:vefaas:stable`
- [ ] Cloud Computer Use smoke on `https://sd8ihq8v316pc5mf9c1j0.apigateway-cn-beijing.volceapi.com` blocked by Computer Use window enumeration errors.
- [x] Cloud E2E with stable URL via `bun run test:cloud-min-story`
- [x] `bun run test:all`

## Non-goals / Safety

- Do not bulk delete files or directories.
- Do not rewrite frozen giant files except narrow prop wiring.
- Do not collapse AgentRuntime and SandboxRuntime concepts.
- Do not commit secrets.

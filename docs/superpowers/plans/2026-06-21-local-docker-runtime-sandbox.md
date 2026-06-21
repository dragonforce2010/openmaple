# Local Docker Runtime And Sandbox

## Goal

Make OpenMaple runnable with `docker compose up --build` without cloud runtime, cloud sandbox, or user OAuth configuration.

## Files

- `compose.yaml`, `.env.example`, `README.md`, `README.zh-CN.md`
- `apps/control-plane-api/src/contracts/schemas.ts`
- `apps/control-plane-api/src/storage/storeCore.ts`
- `apps/control-plane-api/src/storage/storeWorkspaceCreate.ts`
- `apps/control-plane-api/src/storage/storeWorkspaceProvisioning.ts`
- `apps/control-plane-api/src/storage/storeAgentsEnvironments.ts`
- `apps/control-plane-api/src/runtime/sandboxConfigTypes.ts`
- `apps/control-plane-api/src/runtime/sandboxConfig.ts`
- `apps/control-plane-api/src/runtime/dockerRuntime.ts`
- `apps/control-plane-api/src/runtime/runtimeManager.ts`
- `apps/control-plane-api/src/runtime/sandboxPoolManager.ts`
- `apps/control-plane-api/src/auth/auth.ts`
- `apps/admin-web/src/app/useWorkspaceActions.ts`
- `apps/admin-web/src/pages/workspaces/WorkspaceOnboardingSteps.tsx`
- `tests/contracts/*`, `tests/e2e/*`

## Tasks

- [x] Add `local_docker` to runtime and sandbox provider contracts.
- [x] Make workspace onboarding and workspace create accept local Docker without cloud credentials.
- [x] Make local Docker runtime pool members become active during provisioning.
- [x] Make local Docker sandbox pool create and claim reusable Docker-backed members.
- [x] Make compose default to local Docker runtime and sandbox, and hide user OAuth providers in local Docker mode.
- [x] Split Compose into explicit `web`, `api`, and `mysql` services so local users can see the frontend/backend boundary.
- [x] Default the local web console to port `8080` while keeping direct API access on `27951`.
- [x] Add `scripts/setup-local-docker.sh` so users can start the local stack without typing Docker Compose commands.
- [x] Reduce `.env.example` to local Docker settings plus optional model keys; keep online-only OAuth, veFaaS, TOS, E2B, and MCP settings out of the local path.
- [x] Add local Docker contract/E2E coverage for onboarding, pool initialization, session tools, and auth provider discovery.
- [x] Run `bun run typecheck`, `bun run lint`, `bun run build`, `bun run ci:contracts`, `bun run test:e2e:local-docker`, `docker compose up --build`, and browser screenshot capture.

## Expected Results

- `/v1/auth/providers` returns only local login in compose local mode.
- `/v1/workspace_onboarding` accepts `runtime_provider=local_docker` and `sandbox_provider=local_docker` without VolcEngine or E2B credentials.
- `/v1/workspaces/:id/runtime_pool` shows local Docker members as `active`.
- `/v1/workspaces/:id/sandbox_pool` shows local Docker standby/claimed members.
- Provider-loop sessions can write/list files through Docker-backed tools.

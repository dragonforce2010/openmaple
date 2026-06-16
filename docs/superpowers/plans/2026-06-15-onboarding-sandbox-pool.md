# Onboarding Sandbox Pool

## Goal

Tenant/workspace onboarding must finish sandbox pool provisioning before the API returns. A newly opened veFaaS workspace should show `workspace_sandbox_pool_members` immediately, with standby or failed rows visible instead of an empty drawer.

## Files

- `apps/control-plane-api/src/routes/workspaceRoutes.ts`
- `apps/control-plane-api/src/routes/workspaceProvisioning.ts`
- `tests/contracts/workspace_onboarding_sandbox_pool_contract.ts`
- `package.json`

## Plan

- [x] Change onboarding and workspace-create routes to await `finishWorkspaceProvisioning(...)` and merge `runtime_pool`, `sandbox_pool`, and `provisioning_logs` into the response.
- [x] Run runtime pool provisioning and sandbox pool replenish in parallel inside `finishWorkspaceProvisioning(...)` so sandbox pool creation is not blocked by a slow runtime member.
- [x] Add a contract test where `POST /v1/workspace_onboarding` uses veFaaS sandbox config and returns with one standby sandbox pool member already created.
- [x] Verify with `bun run test:onboarding-sandbox-pool`, `bun run typecheck`, and `bun run lint`.

## Expected Result

- `POST /v1/workspace_onboarding` returns only after sandbox pool replenish has been attempted.
- Successful veFaaS sandbox config returns `sandbox_pool.members` with standby rows.
- Failed sandbox creation is persisted as `workspace_sandbox_pool_members.status='failed'`, not hidden by an empty pool.

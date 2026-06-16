# Spec: Workspace Runtime Pool

## Objective
Introduce Workspace as the resource isolation boundary while keeping Environment aligned with the Anthropic definition: Environment is the tool/sandbox hand configuration only. Agent runtime selection, runtime pooling, model pool, and workspace API keys belong to Workspace. Session creation binds an agent, an Environment, and one selected runtime pool member.

## Tech Stack
- Bun + TypeScript for API, store, runtime, and tests.
- SQLite via `bun:sqlite`.
- Existing veFaaS direct provisioning helper for real cloud function creation, invoked by workspace runtime pool provisioning when project `.env` has Volcengine credentials.

## Commands
- Contract: `bun scripts/workspace_runtime_pool_contract.ts`
- Existing runtime contracts: `bun run test:project-env && bun run test:vefaas-provisioner && bun run test:vefaas-contract`
- Type/build: `bun run typecheck && bun run build`
- Full local E2E: `bun run test:all`
- Real veFaaS E2E when project `.env` has cloud bindings: `bun run test:vefaas-real`

## Project Structure
- `server/store.ts`: workspace, tenant, pool, pool member, workspace key schema and persistence.
- `server/index.ts`: onboarding/workspace APIs and workspace-aware create/list APIs.
- `server/runtime.ts`: session runtime selection from workspace runtime pool members.
- `scripts/workspace_runtime_pool_contract.ts`: TDD contract for workspace isolation and runtime pool dispatch.
- `docs/superpowers/plans/`: living spec and task record.

## Code Style
Keep the existing store style: small exported functions around SQLite statements, `JsonRecord` metadata, and backward-compatible defaults for existing rows.

## Testing Strategy
- Store/API contract test first: onboarding creates tenant/workspace/pool/member/key.
- Environment contract: sandbox-only config, rejects `agent_runtime`.
- Agent/model contract: agent belongs to workspace and model must be in workspace model pool.
- Session contract: session belongs to workspace, selects a runtime pool member, and records sticky binding.
- Runtime contract: veFaaS+E2B uses the selected pool member, not Environment agent runtime.

## Boundaries
- Always: Workspace owns AgentRuntime/RuntimePool/ModelPool/APIKey; Environment owns sandbox/tool execution config only.
- Always: Workspace config snapshot is immutable from user APIs after onboarding.
- Always: Session stores `runtime_pool_id`, `runtime_pool_member_id`, and cloud function binding separately.
- Ask first: destructive migration of existing DB data or deletion of cloud functions.
- Never: put `agent_runtime` back into Environment semantics, create veFaaS functions during session creation, or commit secrets.

## Tasks
- [x] Add RED contract test for workspace onboarding, sandbox-only Environment, model pool enforcement, session pool dispatch.
- [x] Implement Workspace/Tenant/Pool/PoolMember/APIKey schema and store helpers.
- [x] Implement onboarding/workspace APIs and read-only config behavior.
- [x] Update session creation/runtime bootstrap to use sticky runtime pool member.
- [x] Service or adapter layer for veFaaS runtime pool provisioning.
- [x] Run contract, existing runtime tests, and local E2E.

## Success Criteria
- A new user can create tenant + default workspace through onboarding.
- Workspace has immutable runtime provider `vefaas`, sandbox provider `e2b`, runtime pool policy, model pool, and API key.
- Environment creation rejects `agent_runtime` and stores sandbox/network/package config only.
- Agent creation validates `workspace_id` and `model.config_id` against workspace model pool.
- Session creation validates workspace ownership, selects an active `runtime_pool_member`, and runtime bootstrap uses that member's `invoke_url/function_id`.
- Existing compatibility paths remain functional until UI and SDK migration catch up.

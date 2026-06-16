# Maple onboarding/runtime/quickstart fixes

## Scope

Fix the screenshot-reported Maple issues without broad refactors:

- Runtime pool limits: max instances <= 100, concurrency per instance <= 1000.
- Onboarding inputs use empty values plus placeholders instead of prefilled examples.
- Improve dropdown/native select styling where onboarding/model dialogs still use raw `select.fld`.
- Workspace API key placeholder is `<workspace name>-apikey`.
- Fix `model_config_not_found` when model configs are workspace-scoped or newly created during onboarding.
- New E2B workspace creates only the E2B sandbox environment, not local Docker.
- Make clear `Ask Maple` is a control-plane context assistant; cloud agent runs still use normal session agent.
- Agent creation config preview supports direct YAML/JSON editing before create.
- Investigate "Not logged in · Please run /login" by checking deployed veFaaS runtime dependency/env path.

## Files

- `apps/admin-web/src/App.workspaceViews.tsx`
- `apps/admin-web/src/App.modals.tsx`
- `apps/admin-web/src/App.shared.tsx`
- `apps/admin-web/src/App.sessionViews.tsx`
- `apps/admin-web/src/styles.css`
- `apps/control-plane-api/src/store.ts`
- `apps/control-plane-api/src/index.ts`
- `apps/control-plane-api/src/modelGateway.ts`
- `scripts/workspace_runtime_pool_contract.ts`

## Expected Results

- UI no longer shows fake filled values as user input in provisioning.
- Runtime pool payload and backend persistence clamp to the requested limits.
- Onboarding selected model IDs are valid for global or workspace scope.
- E2B onboarding creates one visible E2B environment.
- Agent config can be edited inline and invalid JSON/YAML blocks create with a clear error.

## Verification

- `bun run typecheck`
- `bun run test:workspace-runtime-pool`
- `bun run build`
- Local browser smoke on `http://127.0.0.1:5173`

## Tasks

- [x] Patch UI defaults/placeholders and select styling.
- [x] Patch editable agent config preview.
- [x] Patch backend runtime limits, model lookup, and environment defaults.
- [x] Add/update focused contract coverage.
- [x] Run verification commands and browser smoke.

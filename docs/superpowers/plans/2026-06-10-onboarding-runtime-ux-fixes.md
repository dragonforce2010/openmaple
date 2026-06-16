# Maple onboarding/runtime UX fixes

## Scope

- Cap runtime pool max instances at 100 and max concurrency per instance at 1000 in UI, API schema, and store normalization.
- Treat onboarding examples as placeholders only; do not prefill tenant/workspace/API key fields.
- Replace odd native selects in onboarding/model/environment modals with the shared custom select styling.
- Set Workspace API Key placeholder to `<workspace name>-apikey`.
- Prevent stale `model_config_ids` from blocking onboarding/workspace creation.
- Stop seeding Local Docker Sandbox for new cloud workspaces.
- Make Agent create config directly editable before submit.
- Keep session failure diagnosis visible through real event/debug data; no fake assistant copy added.

## Files

- `apps/admin-web/src/App.workspaceViews.tsx`
- `apps/admin-web/src/App.modals.tsx`
- `apps/admin-web/src/App.shared.tsx`
- `apps/admin-web/src/styles.css`
- `apps/admin-web/src/App.documentation.tsx`
- `apps/control-plane-api/src/schemas.ts`
- `apps/control-plane-api/src/store.ts`
- `apps/control-plane-api/src/index.ts`
- `apps/control-plane-api/src/builderAgent.ts`
- `apps/control-plane-api/src/web.ts`
- `scripts/maple_docs_contract.ts`
- `scripts/workspace_runtime_pool_contract.ts`

## Verification

- `bun run typecheck`
- Targeted contracts: `bun run test:workspace-runtime-pool`, `bun run test:prototype-console`, `bun run test:maple-docs`
- Production build: `bun run build`
- Browser smoke on local admin web after dev server starts.

## Tasks

- [x] Runtime limits and server clamp
- [x] Placeholder-only onboarding inputs
- [x] Select/dropdown styling cleanup
- [x] Workspace API key placeholder
- [x] model_config fallback/filtering
- [x] Cloud-only default environment seed
- [x] Direct config editing
- [x] Agent loop env injection for cloud sessions
- [x] Verification

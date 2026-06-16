# Package layout and megafile refactor

## Goal

Refactor Maple package layout so app code is easier to navigate and large files are split into smaller modules without changing behavior.

## External structure guidance

- React is component-oriented but intentionally does not prescribe a folder layout.
- Modern React/Vite guidance commonly separates reusable `components/` from route/page entrypoints (`pages/` or `routes/`) and from shared `utils/lib/hooks`.
- Feature-Sliced Design allows `features/`, but only when the layer represents reusable user-value actions with strict downward dependencies. Current Maple `features/*/*Views.tsx` files are mostly page-level view modules, so `pages/` is a better fit.

## Current audit

Largest files:

- `apps/control-plane-api/src/storage/store.ts` 2572
- `apps/control-plane-api/src/index.ts` 2078
- `apps/admin-web/src/features/workspaces/WorkspaceViews.tsx` 1742
- `apps/admin-web/src/styles.css` 1507
- `apps/admin-web/src/App.tsx` 1296
- `apps/control-plane-api/src/runtime/runtime.ts` 1279
- `apps/admin-web/src/features/docs/DocumentationView.tsx` 1252
- `apps/admin-web/src/features/modals/Modals.tsx` 1168
- `apps/admin-web/src/features/agents/AgentViews.tsx` 1109
- `apps/admin-web/src/features/sessions/SessionViews.tsx` 948
- `apps/admin-web/src/features/shared/AppShared.tsx` 779

## P0 scope

Frontend:

- Rename `apps/admin-web/src/features/*` to `apps/admin-web/src/pages/*` for page-level modules.
- Move shared app rendering helpers from `features/shared` to `components/shared`.
- Keep `shell/`, `api.ts`, `types.ts`, and `ui.tsx` as top-level app infrastructure.

Backend:

- Group root `apps/control-plane-api/src/*.ts` into domain folders:
  - `agents/`
  - `auth/`
  - `catalog/`
  - `files/`
  - `infra/`
  - `sessions/`
  - `skills/`
  - `web/`
- Preserve current root files as re-export shims in P0 where needed, to avoid a large simultaneous import rewrite.

Megafile split:

- Split `App.tsx`, `WorkspaceViews.tsx`, `Modals.tsx`, `AgentViews.tsx`, `SessionViews.tsx`, `AppShared.tsx`, `index.ts`, `store.ts`, `runtime.ts` by extracting cohesive modules.
- Do not split generated or contract-heavy tests in P0 unless they block the >400 guard.

## Verification

- `bun run typecheck`
- `bun run build`
- `bun run test:vefaas-sandbox`
- `bun run test:workspace-runtime-pool`
- `bun run test:ui-overlay`
- `bun run test:prototype-console`
- `bun run test:platform-sdk-cli`
- `bun run test:project-env`
- `bun run test:api-storage`

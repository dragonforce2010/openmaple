# Module boundary review

## Goal

Make package and file responsibilities visible at import sites, then keep the lint/contract gates aligned with the live monorepo layout.

## Findings

- Admin Web had already split shared UI helpers into `forms`, `labels`, `layout`, `events`, `code`, and `misc`, but most consumers still imported the `AppShared` barrel. That erased the benefit of the split and hid unused dependencies.
- TypeScript `organizeImports` found large copied import blocks in both frontend pages and backend route modules. They were structural residue from earlier file splits, not behavior.
- `eslint.config.js` still contained stale max-lines exemptions for old root files; the live repo no longer has >400-line exempt files.
- Backend root re-export shims (`src/store.ts`, `src/runtime.ts`, etc.) are still used by routes/tests. They should be migrated one domain at a time, not removed in this pass.
- `packages/runtime-*`, `packages/sandbox-*`, `packages/components`, and `packages/chat-kit` remain shallow seams. Keep them only if future work moves real provider/UI logic into them.

## Completed

- [x] Replaced `AppShared` imports with focused shared module imports.
- [x] Deleted `apps/admin-web/src/components/shared/AppShared.tsx`.
- [x] Ran TypeScript organize-imports across `apps`, `agents`, and `packages`.
- [x] Removed stale max-lines exemptions from `eslint.config.js`.
- [x] Added contract coverage preventing `AppShared` from returning.

## Next Pass

- [ ] Enable `noUnusedLocals` after the remaining non-import unused locals stay at zero.
- [ ] Replace backend root shims with direct domain imports one folder at a time.
- [ ] Decide whether shallow packages should be deepened or removed from workspace metadata.

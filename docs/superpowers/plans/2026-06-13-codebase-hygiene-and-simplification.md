# Codebase hygiene and simplification

## Goal

Keep Maple's codebase truthful, small, and easy to navigate by removing misleading active references, dead local probes, and mechanical import residue while preserving current behavior.

## Current Findings

- Active docs (`CLAUDE.md`, `README.md`, `CONTEXT.md`) still described the removed `server/` + root `src/` layout even though the live code is `apps/control-plane-api` + `apps/admin-web`.
- Tracked migrations imported `../apps/control-plane-api/src/mysql_child.mjs`, but the live helper is `apps/control-plane-api/src/infra/mysql_child.mjs`.
- `scripts/_assess_mc.mjs` was an ignored local one-off probe: broken `../server/mysql_child.mjs` import, incomplete output, and no tracked callers.
- Storage modules carried copied import blocks from the old monolith split; `tsc --noUnusedLocals --noUnusedParameters` reported unused imports across `apps/control-plane-api/src/storage/*`.
- `packages/runtime-*`, `packages/sandbox-*`, `packages/components`, and `packages/chat-kit` are mostly shallow package seams today. They are useful as intended architecture only if future work moves real provider/UI logic into them; otherwise they should be collapsed.
- `apps/control-plane-api/src/*.ts` root re-export shims are still actively used by routes/tests/storage. Deleting them now would be noisy; the safe next step is direct domain imports, then remove shims one by one.
- `apps/admin-web/src/components/shared/AppShared.tsx` remained a broad barrel. Many page files imported the same large symbol set, hiding dependencies and making unused-code detection noisy.

## Completed In This Pass

- [x] Added `tests/contracts/codebase_hygiene_contract.ts`.
- [x] Updated active docs to the current app/package layout and remote MySQL persistence.
- [x] Fixed tracked migration imports to the live MySQL helper.
- [x] Removed ignored broken probe `scripts/_assess_mc.mjs`.
- [x] Organized storage module imports and removed unused import residue.
- [x] Fixed live Admin Web documentation copy that still pointed users at removed `server/index.ts` / `server/store.ts`.
- [x] Kept local Codex runtime config out of git with `.codex/`; removed the tracked local CodeGraph PID from the intended commit set.
- [x] Removed the Admin Web `AppShared.tsx` barrel, rewired callers to focused shared modules, and removed stale max-lines exemptions.

## Next Pass

- [ ] Replace root backend shim imports (`../store`, `../runner`, `../auth`, etc.) with domain imports in one folder at a time.
- [x] Split `AppShared.tsx` callers to focused modules (`forms`, `labels`, `layout`, `events`, `code`, `misc`) and delete the barrel.
- [ ] Decide package seams:
  - keep and deepen `packages/runtime-*` / `packages/sandbox-*` by moving real provider interfaces there, or remove them from workspace metadata/docs;
  - keep `packages/components` / `packages/chat-kit` only after real consumers exist.
- [ ] Archive or label historical docs under `docs/design` / `docs/research` so old `server/` / SQLite references are not mistaken for active truth.
- [ ] Consider a stricter `noUnusedLocals` gate for new files after frontend barrel imports are split.

## Verification

- `bun run test:codebase-hygiene`
- `bun run test:maple-docs`
- `bun run typecheck`
- `bun run lint`
- `bun run build`

# Builder Agent Progress Disclosure

## Goal

Show visible Builder Agent progress while Quickstart waits for `/v1/quickstart/builder_session/:sessionId/message`, without exposing private model chain-of-thought or changing the synchronous route contract.

## Files

- `apps/admin-web/src/pages/quickstart/QuickstartParts.tsx`
- `apps/admin-web/src/pages/quickstart/QuickstartView.tsx`
- `apps/admin-web/src/styles/part-2.css`

## Plan

- [x] Add a reusable Builder progress component with public phases: understand request, plan config, prepare API draft.
- [x] Replace the static pending copy in Quickstart with the progress component.
- [x] Style the progress rows so the active phase is clear and text fits in the existing conversation column.
- [x] Run focused validation for the changed Quickstart files.
- [x] Run full `bun run lint`.
- [ ] Run full `bun run typecheck`.

## Expected Result

During long Builder Agent replies, the user sees a changing progress card instead of only `Builder Agent 正在回复...`.

## Verification

- `bun run typecheck`
- `bun run lint`

## Validation Result

- Focused TS check on changed Quickstart TSX files: passed.
- Focused eslint on changed Quickstart TSX files: passed.
- Full `bun run lint`: passed.
- Full `bun run typecheck`: blocked by existing untracked `apps/control-plane-api/src/routes/workspaceProvisioning.ts` `RuntimePoolConfig` conversion error.

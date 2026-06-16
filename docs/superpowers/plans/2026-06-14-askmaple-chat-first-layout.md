# AskMaple chat-first layout

## Goal

Make AskMaple read as a chat surface first. Keep current Session metadata and event signals behind an explicit information button. Keep Ask Maple and New Session actions side by side in the Session header.

## Files

- `apps/admin-web/src/pages/sessions/AskMapleDrawer.tsx`
- `apps/admin-web/src/pages/sessions/SessionsView.tsx`
- `apps/admin-web/src/styles/part-6.css`
- `tests/contracts/maple_ui_interaction_contract.ts`

## Tasks

- [x] Move Session metadata and signals out of the default AskMaple message flow.
- [x] Add a current Session information toggle and panel.
- [x] Keep Session header actions on one row.
- [x] Run typecheck, lint, build, and targeted source assertions.
- [ ] Verify with browser screenshot and deploy stable.

## Verification

- `bun run typecheck`
- `bun run lint`
- `bun tests/contracts/maple_ui_interaction_contract.ts`
- `bun run build`
- Browser check at local or stable URL: AskMaple drawer shows chat stream only by default; current Session details appear only after the info button; header actions are horizontal.

Note: `maple_ui_interaction_contract.ts` still fails on the pre-existing Agent edit template assertion before the AskMaple assertions run.

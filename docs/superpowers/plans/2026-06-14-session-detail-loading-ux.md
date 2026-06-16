# Session detail loading UX

## Goal

Stop the Sessions page from showing an indefinite blank loading overlay when `GET /v1/sessions/:id/detail` is slow or stuck.

## Evidence

- Screenshot session `sess_Cz52_LU9b6` stayed on `正在加载 Session 详情...` for tens of seconds.
- Remote MySQL showed the session only has 3 events and 0 tool calls, so data volume is not the reason.
- The frontend clears `sessionDetail` on selection, fetches full detail without a timeout, and renders a blocking overlay while `sessionDetail?.session?.id !== selectedSession`.

## Files

- `apps/admin-web/src/api.ts`
- `apps/admin-web/src/app/useSelectedSessionDetail.ts`
- `apps/admin-web/src/AppFrame.tsx`
- `apps/admin-web/src/pages/sessions/SessionsView.tsx`

## Tasks

- [x] Add GET timeout support so a stuck detail request fails visibly.
- [x] Render a shell detail from the selected session row while full detail loads.
- [x] Show slow/error detail status in the session panel instead of an indefinite spinner.
- [x] Run `bun run typecheck` and `bun run lint`.

## Expected Result

Customers immediately see the selected session identity and existing shell state. If detail loading is slow, the UI says which API is slow and keeps the page usable.

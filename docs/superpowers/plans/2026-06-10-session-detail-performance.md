# Session Detail Performance

## Goal

Reduce visible wait when opening a session drawer.

## Evidence

- Session `sess_Pv3MuNxJxM` has 80 events and 17 tool calls.
- Full detail path performs sequential DB reads for session, permission, agent, environment, events, and tool calls.
- `tool_calls` query uses `Using filesort` for `ORDER BY created_at`.
- Remote MySQL timing is bursty; repeated event/tool queries ranged from tens of ms to over 1s.

## Files

- `apps/control-plane-api/src/storeSchema.ts`
- `apps/control-plane-api/src/index.ts`
- `apps/admin-web/src/App.sessionViews.tsx`

## Plan

- [x] Add `idx_tool_calls_session_created ON tool_calls(session_id, created_at)`.
- [x] Let session detail route return a lightweight shell via `?summary=1`.
- [x] Reuse the already-loaded session record when building detail to avoid duplicate `getSession`.
- [x] Load session drawer shell first, then full events/tool calls in the background.
- [x] Verify with typecheck and targeted API timing.

## Verification

- `bun run typecheck`
- `GET /v1/sessions/:id/detail?summary=1`
- `GET /v1/sessions/:id/detail`

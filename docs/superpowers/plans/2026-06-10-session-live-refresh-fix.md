# Session live refresh fix

## Goal

Fix Quickstart Preview and Sessions views that stay on `session.status_running` after `POST /v1/sessions/:sessionId/events` returns `202` and the agent reply is produced in the background.

## Evidence

- `sess_5B9bi6nvPa` had `agent.message` and `session.status_idle` in MySQL, while the UI screenshot still showed `running`.
- `sess_08-BHmjKt_` had later `agent.message` events after the screenshot state.
- The frontend relies on SSE for live detail updates, with no polling fallback while a selected session remains active.

## Files

- `apps/admin-web/src/app/useSelectedSessionDetail.ts`
- `apps/admin-web/src/app/useQuickstartController.ts`
- `apps/admin-web/src/App.tsx`
- `apps/control-plane-api/src/runtime/runtimeManager.ts`
- `apps/control-plane-api/src/runtime/runtimeTools.ts`

## Expected Results

- Live events refresh selected session detail and focus the newest event.
- If SSE misses an event, active sessions poll detail until the status leaves `bootstrapping`, `running`, or `tool_waiting`.
- Quickstart Preview binds `quickSessionId` to `selectedSession` before sending a message.
- Built-in tools execute against the sandbox runtime directly; E2B sessions are not blocked by missing veFaaS agent runtime invoke URLs.

## Verification

- `bun run typecheck`
- `bun run lint`
- Local browser smoke on `http://127.0.0.1:5173`

## Tasks

- [x] Add active-session polling fallback.
- [x] Focus latest event on live refresh.
- [x] Bind Quickstart preview send to selected session.
- [x] Use sandbox runtime for built-in tool execution.
- [x] Run verification commands.
- [x] Browser smoke local app load; session-page smoke blocked by in-app browser using `admin@example.com` onboarding state instead of the screenshot user.

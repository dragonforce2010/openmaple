# veFaaS turn TTFT

## Goal

- Reduce the silent delay before the first runtime event on veFaaS AgentRuntime turns.
- Keep local file/shell tools isolated in SandboxRuntime via the existing tool bridge.
- Make the runtime-preparation phase visible in the Sessions UI.

## Files

- `apps/control-plane-api/src/runtime/runtimeManager.ts`
- `apps/control-plane-api/src/runtime/runner.ts`
- `apps/admin-web/src/app/useSessionEventStream.ts`
- `apps/admin-web/src/pages/sessions/SessionTranscriptActions.tsx`
- `apps/admin-web/src/pages/sessions/SessionsView.tsx`
- `apps/admin-web/src/components/shared/events.tsx`
- `infra/vefaas/runtime-app/app.py`
- `docs/architecture/maple-platform-overview.md`
- `docs/adr/0004-agent-tools-execute-in-sandbox-not-runtime.md`

## Commands

- `bun run typecheck`
- `bun run lint`
- Browser smoke on `http://127.0.0.1:5173`, screenshot Sessions running state.

## Expected Result

- Simple veFaaS turns no longer block on `ensureSessionSandboxRuntime()` before `invokeVefaas(action="run")`.
- If the model later calls bash/read/write/grep/list files, `executeTool()` lazily ensures SandboxRuntime and retries stale veFaaS sandbox once.
- Session debug stream shows `session.status_preparing_runtime` during the control-plane preparation window.
- Runtime callback skips SDK `system` heartbeat/debug events so assistant deltas do not queue behind non-user-visible callback posts.

## Tasks

- [x] Remove the per-turn eager SandboxRuntime wait from veFaaS AgentRuntime dispatch.
- [x] Emit and stream a runtime-preparation status event.
- [x] Show a precise running label in Sessions UI.
- [x] Update ADR 0004 so docs match the lazy sandbox behavior.
- [x] Skip SDK system heartbeat callbacks while preserving `streamed_count` prefix semantics.
- [x] Run verification and capture screenshot.

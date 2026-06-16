# Agent TTFT Performance

## Goal

Make agent chat feel responsive by reducing request wait and first visible agent output latency.

## Evidence

- `POST /v1/sessions/:sessionId/events` currently awaits `maybeRunUserMessage`.
- `runProviderTurn` currently waits for `callProvider` to finish before writing `agent.message_delta`.
- `callOpenAI` currently reads `response.json()`, so no token delta can reach SSE clients until the full model response is complete.

## Files

- `apps/control-plane-api/src/routes/sessionRoutes.ts`
- `apps/control-plane-api/src/sessions/turnQueue.ts`
- `apps/control-plane-api/src/runtime/provider.ts`
- `apps/control-plane-api/src/runtime/runner.ts`

## Plan

- [x] Return `202` immediately after storing client events.
- [x] Run agent turns in a per-session background queue.
- [x] Stream OpenAI-compatible chat completion chunks into `agent.message_delta`.
- [x] Keep final `agent.message` for transcript stability.
- [x] Verify with typecheck, lint, and build.

## Verification

- `/Users/bytedance/.bun/bin/bunx tsc --noEmit`
- `/Users/bytedance/.bun/bin/bun run lint`
- `env PATH=/Users/bytedance/.bun/bin:/usr/bin:/bin:/usr/sbin:/sbin /Users/bytedance/.bun/bin/bun run build`

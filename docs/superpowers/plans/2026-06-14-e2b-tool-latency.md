# E2B tool latency optimization

## Goal

Reduce hot E2B tool latency for simple `bash` calls. The reported session `sess_9HKsXRMdFl` showed `bash date` taking about 19.6s even though the command itself is instant.

## Evidence

- `agent.tool_use` for `date`: `2026-06-14T06:35:27.284Z`.
- `tool.result`: `2026-06-14T06:35:47.207Z`.
- Tool output timestamp: `Sun Jun 14 06:35:45 UTC 2026`.
- Conclusion: most delay happens before the actual `date` command runs. The hot path repeatedly prepares the existing E2B workspace before each tool call, then always syncs the workspace back to host after `bash`.

## Files

- `apps/control-plane-api/src/runtime/e2bRuntime.ts`
- `apps/control-plane-api/src/runtime/runtimeTools.ts`

## Plan

- [x] Confirm server-side event and `tool_calls` timestamps from remote MySQL.
- [x] Add E2B perf spans for connect/create/prepare/command/sync.
- [x] Cache recent E2B workspace readiness and skip repeated hot `id -un` / `chown` prepare work.
- [x] Skip host workspace sync after clearly read-only `bash` commands like `date`.
- [x] Run `bun run typecheck` and `bun run lint`.

## Expected Result

Hot `date`-style tools should avoid repeated E2B prepare work and post-command sync, leaving only `ensure_sandbox` metadata lookup plus one E2B command round trip.

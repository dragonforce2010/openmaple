# Agent Team Review: AgentLoop, SDK, CLI, E2E

Date: 2026-05-29

This note preserves the multi-agent review used for the AgentLoop + magcli design and implementation.

## Team Inputs

- Runtime / AgentLoop reviewer: current platform originally had only one OpenAI-compatible function-calling loop. Required changes were explicit AgentLoop config, event evidence, safer client event writes, and a future driver boundary for real Claude Code and Codex loop implementations.
- SDK / CLI reviewer: reuse existing API-first session/event/SSE surface; add a minimal deployment API and a `magcli` command surface instead of rewriting runner.
- Product / API / E2E reviewer: current product surface is broad, but programmatic onboarding needed a stable CLI/auth/deploy path, explicit event safety, and E2E coverage for SDK/CLI.

## High-Impact Findings Addressed

| Finding | Resolution |
|---|---|
| AgentLoop type was absent from `AgentConfig`. | Added `agent_loop.type` with `anthropic_claude_code` and `codex_open_source`. |
| Session snapshots did not prove loop selection. | `bootstrapSession()` now emits `agent.loop_selected`. |
| External event API allowed forged system events. | `POST /v1/sessions/:id/events` now only accepts `user.message`. |
| No CLI/SDK onboarding path. | Added `sdk/index.mjs`, `scripts/magcli.mjs`, and `/v1/deployments`. |
| No deployment artifact linking manifest to agent/environment. | Added `agent_deployments` table and deployment CRUD/invoke API. |
| E2E did not cover AgentLoop or CLI deploy. | Added AgentLoop, event safety, and magcli deployment checks to `scripts/e2e.mjs`. |

## Known Boundaries Kept Explicit

- `anthropic_claude_code` and `codex_open_source` are stable platform loop selections in this MVP. They currently route through the existing local provider/tool substrate with distinct metadata and prompt preambles. The implementation does not yet invoke real external Claude Code or Codex CLI loop processes.
- Uploaded harness code is stored and audited as a bundle manifest. Server-side execution of uploaded hook code remains out of scope until sandboxed hook execution is added.
- Multi-user isolation for agents/environments/vaults/templates and real MCP/Notion execution remain future hardening items from the review.

## Follow-Up Architecture Work

1. Introduce `AgentLoopDriver` with `bootstrap`, `sendUserMessage`, `ingestEvent`, `cancelRun`, and `resumeRun`.
2. Add `session_runs` and per-session run locks to avoid concurrent loop execution.
3. Add event sequencing (`seq`, `run_id`, `source`, `direction`, `external_event_id`) for replay and webhook ingestion.
4. Add first-class API token/PAT management for non-browser clients.
5. Add real MCP execution with vault-backed secret injection and a mock MCP E2E.
6. Add hermetic E2E mode with temporary `LMAP_DATA_DIR` and temporary skills root.

## Implemented Verification

```bash
npm run test:all
```

The passing run covered:

- TypeScript compilation.
- Production build.
- Real E2B and local Docker runtime checks.
- `agent_loop` persistence for both supported loop types.
- `agent.loop_selected` event evidence.
- Client event forgery rejection.
- `magcli init/build/deploy/status` with a `codex_open_source` deployment manifest.
- Web UI screenshots and button audit.

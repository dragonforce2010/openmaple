# Magcli AgentLoop SDK Plan

**Goal:** Add a programmatic onboarding path for managed agents: explicit AgentLoop selection, a lightweight SDK, a `magcli` command surface, deployable harness manifests, E2E proof, and a Feishu-ready onboarding manual with screenshots.

**AI Pair / Agent Team Inputs:**

- `ai-pair` plan-team preflight:
  - `codex` exists at `/opt/homebrew/bin/codex`, but the installed command is not the OpenAI Codex CLI (`codex --version` is unsupported and `codex -h` shows a blog generator interface). Treat Codex planner CLI as unavailable for this run and record that limitation.
  - `gemini` exists at `/Users/bytedance/.nvm/versions/node/v24.13.0/bin/gemini`, but `gemini -p "Reply exactly: OK"` opens an interactive auth prompt and times out under non-interactive execution. Treat Gemini CLI as not headless.
  - Antigravity CLI is available via `/Users/bytedance/.agents/skills/agy-cli/scripts/agy_exec.sh version`.
- Parallel agent-team reviews are running for product/API/E2E, runtime/database/AgentLoop, and SDK/CLI design. Incorporate concrete findings before final completion.

## Requirements

- Agent configs must carry an explicit `agent_loop.type` selected at creation time:
  - `anthropic_claude_code`
  - `codex_open_source`
- Session snapshots must preserve the selected loop and emit evidence that a loop was selected for the run.
- End users need API, SDK, and CLI entry points.
- `magcli` must support `init`, `invoke`, `version`, `status`, `config`, `build`, and `deploy`.
- Developers must be able to write local harness hook code, build a bundle manifest, and deploy it through the CLI.
- Docs must give a step-by-step code + CLI workflow and be suitable for Feishu publication with screenshots.

## Implementation Tasks

- [x] AgentLoop contract
  - Files: `server/types.ts`, `server/agentLoops.ts`, `server/agentBuilder.ts`, `server/index.ts`, `server/runner.ts`, `src/types.ts`, `src/App.tsx`.
  - Expected result: agent create/update validates loop type, generated drafts include a default loop, UI/API previews display the loop, and session runs record `agent.loop_selected`.
  - Verification: typecheck plus E2E API assertions for both loop types.

- [x] Deployment model for CLI publishing
  - Files: `server/store.ts`, `server/index.ts`, `src/types.ts`.
  - Expected result: agents can receive immutable deployment records containing manifest, loop type, build metadata, and hook entry points.
  - Verification: API creates/lists deployment and rejects invalid manifests.

- [x] SDK and CLI
  - Files: `sdk/index.mjs`, `sdk/index.d.ts`, `scripts/magcli.mjs`, `package.json`.
  - Expected result: `node scripts/magcli.mjs version`, `config`, `init`, `build`, `deploy`, `status`, and `invoke` work against the local API using local login.
  - Verification: smoke commands run against a local server; build output is deterministic under `.mag/build/`.

- [x] E2E and documentation
  - Files: `scripts/e2e.mjs`, `docs/acceptance/e2e-test-suite.md`, `README.md`, `.env.example`, `docs/product-manual/magcli-sdk-onboarding.md`.
  - Expected result: automated acceptance covers AgentLoop selection and magcli deploy/invoke; docs include full CLI/code onboarding and screenshot references.
  - Verification: `npm run typecheck`, `npm run build`, targeted CLI smoke, and either full `npm run test:all` or a clearly labeled blocked reason if provider/E2B dependencies fail.

## Design Direction

- Store loop selection inside the canonical agent config rather than only session metadata. Sessions already persist `agent_snapshot_json`, so this keeps historical runs immutable.
- Keep the first implementation loop-neutral internally: both built-in loop types use the existing provider/tool execution substrate, but carry distinct system preambles, event metadata, and harness hook semantics. This gives the platform a stable contract now while leaving room to swap in real Claude Code or Codex loop workers later.
- Treat custom harness code as an outer-loop package with typed hooks:
  - `beforeUserMessage`
  - `afterUserMessage`
  - `beforeToolCall`
  - `afterToolCall`
  - `afterSession`
- `magcli build` packages source references and hook metadata; it does not execute untrusted hook code on the server in this local MVP.

## Verification Commands

```bash
node scripts/magcli.mjs version
node scripts/magcli.mjs init --name demo-agent --loop codex_open_source --yes --directory /tmp/magcli-demo
node scripts/magcli.mjs build --project /tmp/magcli-demo
npm run typecheck
npm run build
npm run test:e2e
```

## Verification Results

- 2026-05-29: `npm run typecheck` passed.
- 2026-05-29: `npm run build` passed.
- 2026-05-29: `npm run test:e2e` passed, including AgentLoop selection, magcli init/build/deploy, deployment invoke path, session snapshot loop evidence, and frontend smoke coverage.
- 2026-05-29: Feishu document `Y7Vzd89AwoQlkjxKzpIcQizenid` overwritten with `docs/product-manual/lark-magcli-sdk-onboarding.xml` and supplemented with 5 screenshots in section `十一、界面截图` (revision 25).

## Stop Conditions

- Do not claim real Anthropic Claude Code or real Codex CLI execution unless the implementation actually invokes those external loops.
- If Feishu document publication fails due to auth/scope, leave the markdown/manual and screenshot paths as local artifacts and report the exact command error.

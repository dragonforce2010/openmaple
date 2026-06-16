# E2E Agent Creation Hardening Plan

**Goal:** Reproduce and fix Quickstart agent creation failures/slowness, expand E2E coverage for clickable buttons, error states, slow actions, and user-visible recovery, then publish a Feishu test report.

**Scope:** React/Vite UI, Express agent draft API, provider timeout behavior, Playwright E2E suite, Browser-use validation, Feishu report.

## Tasks

- [x] **Trace current behavior**
  - Files: `src/App.tsx`, `src/api.ts`, `server/agentBuilder.ts`, `server/provider.ts`, `server/modelGateway.ts`, `scripts/e2e.mjs`
  - Expected result: identify exact failure and latency path for Quickstart draft/agent creation.

- [x] **Add E2E cases**
  - Files: `scripts/e2e.mjs`, `docs/acceptance/e2e-test-suite.md`
  - Cases: provider credential missing fallback, upstream provider failure fallback, slow draft loading feedback, create-agent button disabled/deduplicated while busy, modal API error display, navigation/button audit categories.

- [x] **Fix backend resilience**
  - Files: `server/agentBuilder.ts`, `server/provider.ts`
  - Expected result: agent draft generation returns a valid rule-based draft on missing/broken/slow provider instead of surfacing a 502 to the UI.

- [x] **Fix UI error experience**
  - Files: `src/api.ts`, `src/App.tsx`
  - Expected result: API errors render concise messages; modal actions surface inline errors and clear saving state instead of creating console-only failures.

- [x] **Verify**
  - Commands: `npm run typecheck`, `npm run test:e2e`, targeted Browser-use flow on `http://127.0.0.1:5173/`.
  - Expected result: automated and visual/browser validation pass; screenshots and timing evidence are recorded.

- [x] **Report**
  - Files: local markdown report under `docs/acceptance/`, plus Feishu document via `lark-cli docs +create --api-version v2`.
  - Expected result: user receives Feishu URL and concise test summary.

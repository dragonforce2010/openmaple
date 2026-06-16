# Managed Agents Platform Spec-Driven Conversion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the current local managed-agents platform into a spec-driven project with explicit acceptance criteria and a repeatable E2E test suite.

**Architecture:** `SPEC.md` becomes the root source of truth for current requirements and boundaries. `docs/acceptance/e2e-test-suite.md` documents the runnable acceptance suite. `scripts/e2e.mjs` is the executable E2E harness and auto-starts local API/web servers when default ports are not already serving.

**Tech Stack:** TypeScript, React, Vite, Express, SQLite via `better-sqlite3`, Docker, OpenAI-compatible provider API, Playwright Chromium.

---

### Task 1: Establish The Project Spec

**Files:**
- Create: `SPEC.md`

- [x] **Step 1: Write the current-state spec**

Create `SPEC.md` with these sections:

```markdown
# Local Managed Agents Platform Spec
## Purpose
## Current Product Surface
## Spec-Driven Operating Mode
## Functional Requirements
## E2E Acceptance Criteria
## Known Boundaries
```

- [x] **Step 2: Verify the spec names current implementation surfaces**

Run:

```bash
rg -n "Agent Definition|Environment And Runtime|Session Events And Observability|Vaults And Secrets|Memory And Skills|Frontend Console|Known Boundaries" SPEC.md
```

Expected: every named section is found.

### Task 2: Document The E2E Test Suite

**Files:**
- Create: `docs/acceptance/e2e-test-suite.md`

- [x] **Step 1: Add the acceptance test matrix**

Create `docs/acceptance/e2e-test-suite.md` with:

```markdown
# E2E Test Suite
## Command
## Environment Requirements
## Test Cases
## Acceptance Output
## Locked-Screen Policy
```

- [x] **Step 2: Verify all expected test cases are listed**

Run:

```bash
rg -n "E2E-001|E2E-002|E2E-003|E2E-004|E2E-005|E2E-006|E2E-007|E2E-008|E2E-009|E2E-010|E2E-011|E2E-012|E2E-013|E2E-014|E2E-015|E2E-016" docs/acceptance/e2e-test-suite.md
```

Expected: all sixteen test case ids are found.

### Task 3: Make E2E Self-Contained And Broader

**Files:**
- Modify: `scripts/e2e.mjs`

- [x] **Step 1: Add default server auto-start**

Add helper functions that check `E2E_API_BASE` and `E2E_WEB_BASE`, auto-start `npm run dev:api` and `npm run dev:web` only for the default `127.0.0.1:8787` and `127.0.0.1:5173` ports, and clean up spawned child processes in a `finally` block.

- [x] **Step 2: Expand API checks**

Add E2E steps for invalid agent payload rejection, memory store persistence/query, skill scanning, and session detail snapshot/resource linkage.

- [x] **Step 3: Expand UI checks**

In the Playwright step, verify Quickstart, Agents, Environments, Credential vaults, Memory, Skills, Templates, Sessions, transcript/debug detail, desktop screenshot, and mobile Quickstart without horizontal overflow.

- [x] **Step 4: Verify E2E script syntax**

Run:

```bash
node --check scripts/e2e.mjs
```

Expected: exit code `0`.

### Task 4: Add One-Command Acceptance Script

**Files:**
- Modify: `package.json`

- [x] **Step 1: Add `test:all`**

Add:

```json
"test:all": "npm run typecheck && npm run build && npm run test:e2e"
```

- [x] **Step 2: Verify package scripts**

Run:

```bash
node -e "const p=require('./package.json'); console.log(p.scripts['test:all'])"
```

Expected output:

```text
npm run typecheck && npm run build && npm run test:e2e
```

### Task 5: Run Acceptance Gates

**Files:**
- Read: `package.json`
- Read: `scripts/e2e.mjs`
- Read: `SPEC.md`
- Read: `docs/acceptance/e2e-test-suite.md`

- [x] **Step 1: Run TypeScript check**

Run:

```bash
npm run typecheck
```

Expected: exit code `0`.

- [x] **Step 2: Run production build**

Run:

```bash
npm run build
```

Expected: Vite production build exits with code `0`.

- [x] **Step 3: Run complete acceptance suite**

Run:

```bash
npm run test:all
```

Expected: exit code `0`, JSON output includes `"ok": true`, and every `checks[]` entry has `"status": "PASS"`.

### Task 6: Final Completion Audit

**Files:**
- Read: `SPEC.md`
- Read: `docs/acceptance/e2e-test-suite.md`
- Read: `scripts/e2e.mjs`
- Read: `package.json`

- [x] **Step 1: Verify requirement coverage**

Run:

```bash
rg -n "npm run test:all|Locked-Screen Policy|GUI Computer Use|headless Playwright|E2E-016" SPEC.md docs/acceptance/e2e-test-suite.md scripts/e2e.mjs package.json
```

Expected: output includes the acceptance command, locked-screen policy, headless Playwright policy, mobile E2E case, and package script.

- [x] **Step 2: Report exact evidence**

Summarize the verified files, commands, exit codes, E2E session id, and screenshot paths. Do not claim completion unless all acceptance gates pass.

Verified on 2026-05-27:

```text
npm run test:all
exit code: 0
e2e session_id: sess_xKNn_UbMtm
desktop screenshot: /tmp/managed-agents-e2e-1779854404014.png
mobile screenshot: /tmp/managed-agents-e2e-mobile-1779854404014.png
```

# UI Button Audit And Product Docs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the reported UI interaction gaps, make Templates and Skills editable/createable, expand E2E to click the relevant visible buttons, and publish a screenshot-rich product manual to Feishu.

**Architecture:** The API remains Express + SQLite with file-backed skill creation under `~/.agents/skills`. The React app keeps the current single-page console but adds explicit busy feedback, sticky chat composition, modal editors, and targeted button audit coverage. Product docs are generated from verified screenshots and the current API/UI behavior.

**Tech Stack:** TypeScript, React, Vite, Express, SQLite, Playwright, Codex Browser plugin, `lark-cli docs`.

---

### Task 1: Capture Requirements In Spec

**Files:**
- Modify: `SPEC.md`
- Modify: `docs/acceptance/e2e-test-suite.md`

- [x] **Step 1: Add UI interaction requirements**

Record the five user-reported requirements: instant send feedback, visible session chat entry, Enter-to-send, Templates create/edit, Skills create/edit, and exhaustive button-click E2E acceptance.

- [x] **Step 2: Add E2E cases**

Add test case ids for quickstart button feedback, session composer, template create/edit, skill create/edit, and button audit.

### Task 2: Backend CRUD Support

**Files:**
- Modify: `server/store.ts`
- Modify: `server/index.ts`
- Create: `server/skillWriter.ts`
- Modify: `src/types.ts`

- [x] **Step 1: Add template update API**

Implement `GET /v1/templates/:templateId` and `PATCH /v1/templates/:templateId`.

- [x] **Step 2: Add skill create/update API**

Implement `POST /v1/skills` and `PATCH /v1/skills/:skillId`. Write source files under `~/.agents/skills/<name>/SKILL.md`, keep frontmatter to `name` and `description`, and refresh the skill index.

### Task 3: Frontend UX Fixes

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/styles.css`

- [x] **Step 1: Quickstart send feedback**

Show immediate busy state and visible status text while agent draft generation is running. The button must visibly change on click.

- [x] **Step 2: Sessions composer visibility and Enter send**

Make the session screen fit the viewport with a sticky visible composer and support Enter to send, Shift+Enter for newline where applicable.

- [x] **Step 3: Template create/edit UI**

Add `New template`, row-level `Edit`, and a modal editor for name, category, description, and JSON template.

- [x] **Step 4: Skill create/edit UI**

Add `New skill`, row-level `Edit`, and a modal editor for skill name and description.

### Task 4: E2E Button Audit

**Files:**
- Modify: `scripts/e2e.mjs`

- [x] **Step 1: Add API checks**

Verify template create/edit and skill create/edit through API.

- [x] **Step 2: Add UI checks**

Use Playwright to click visible buttons across Quickstart, Sessions, Templates, Skills, and modal close/save paths. For each click, verify a state change, modal, loading state, or explicit no-op rationale.

- [x] **Step 3: Capture screenshots**

Capture screenshots for Quickstart feedback, Sessions composer, Templates editor, Skills editor, and product manual.

### Task 5: Product Manual And Feishu

**Files:**
- Create: `docs/product-manual/local-managed-agents-platform.md`
- Create screenshots under `/tmp/managed-agents-docs-*`

- [x] **Step 1: Write manual**

Cover every main feature for users and developers: Quickstart, Agents, Sessions, Environments, Vaults, Memory, Skills, Templates, API, E2E, and troubleshooting.

- [x] **Step 2: Create Feishu document**

Use `lark-cli docs +create --api-version v2` and insert screenshots. If auth or network fails, preserve the exact error and leave the local manual ready for retry.

### Task 6: Verification

**Files:**
- Read: all modified files

- [x] **Step 1: Run typecheck**

Run:

```bash
npm run typecheck
```

- [x] **Step 2: Run complete acceptance**

Run:

```bash
npm run test:all
```

- [x] **Step 3: Browser validation**

Use the in-app Browser to reload `http://127.0.0.1:5173/`, verify console health, click the reported buttons, and collect screenshot evidence.

# User, Artifact, and Model Gateway Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add login-gated backend APIs, user management, model gateway keys with TPM/TPD quota enforcement, and artifact management for session outputs.

**Architecture:** Keep the current SQLite + Express + React shape. Add focused backend modules for auth, artifacts, and gateway behavior, extend the store with durable users/model configs/gateway keys/usage, and gate all `/v1` API routes except health/auth/gateway inference. The frontend gets a login screen plus three new admin surfaces: Users, Model gateway, and Artifacts.

**Tech Stack:** Express 5, better-sqlite3, React 19, Vite, Playwright E2E, OpenAI-compatible chat completion forwarding.

---

### Task 1: Durable Auth, Users, Gateway Data

**Files:**
- Modify: `server/store.ts`
- Create: `server/auth.ts`
- Modify: `server/types.ts`

- [ ] Add SQLite tables for `users`, `auth_sessions`, `model_configs`, `gateway_keys`, and `gateway_usage`.
- [ ] Add store helpers to upsert/list users, create/lookup auth sessions, create/list model configs, create/list/update gateway keys, and record/read gateway usage.
- [ ] Hash session tokens and gateway keys before storage; never return raw provider API keys after creation.

Run: `npm run typecheck`
Expected: TypeScript accepts the new store/auth exports.

### Task 2: API Auth Guard, User Management, Model Gateway, Artifacts

**Files:**
- Modify: `server/index.ts`
- Create: `server/artifacts.ts`
- Create: `server/modelGateway.ts`
- Modify: `server/provider.ts`
- Modify: `server/agentBuilder.ts`
- Modify: `server/runner.ts`

- [ ] Add `POST /v1/auth/login`, `POST /v1/auth/logout`, `GET /v1/auth/me`, and `GET /v1/auth/providers`.
- [ ] Apply login-state middleware to all other `/v1` APIs except gateway inference.
- [ ] Add user list API for the Users module.
- [ ] Add model config and gateway key APIs, including one-time raw key return and quota usage output.
- [ ] Add OpenAI-compatible `POST /v1/gateway/chat/completions`; resolve gateway key to the user's real model credential and enforce TPM/TPD before forwarding.
- [ ] Add artifact listing and download APIs scoped to accessible sessions.
- [ ] Pass session owner user id into provider calls used by draft generation and runtime loops.

Run: `npm run typecheck`
Expected: TypeScript accepts route and provider changes.

### Task 3: Frontend Login, Users, Models, Artifacts

**Files:**
- Modify: `src/api.ts`
- Modify: `src/types.ts`
- Modify: `src/App.tsx`
- Modify: `src/styles.css`

- [ ] Make fetch helpers send browser credentials.
- [ ] Add login screen supporting local/OAuth/OIDC/LarkSSO/ByteSSO provider choices.
- [ ] Add Users, Model gateway, and Artifacts navigation entries.
- [ ] Implement Users page with current user, auth providers, and user table.
- [ ] Implement Model gateway page with custom model creation, preset selection, gateway key creation, and visible quota configuration.
- [ ] Implement Artifacts page with session/file list and download actions.

Run: `npm run build`
Expected: TypeScript and Vite build complete.

### Task 4: E2E Coverage and Button Audit

**Files:**
- Modify: `scripts/e2e.mjs`

- [ ] Add unauthenticated API rejection check.
- [ ] Log in through auth API and attach cookie to all protected API calls.
- [ ] Add API checks for model config creation, gateway key issue, gateway 401, and artifact listing/download.
- [ ] Add UI login flow and click Users, Model gateway, Artifacts, create model, issue gateway key, download artifact, plus existing template/skill/session flows.

Run: `npm run test:e2e`
Expected: JSON result has `ok: true` and `buttonAudit` includes the new modules.

### Task 5: Final Verification

**Files:**
- No code changes unless verification exposes defects.

- [ ] Run `npm run typecheck`.
- [ ] Run `npm run build`.
- [ ] Run `npm run test:e2e`.
- [ ] Start the dev server and verify the rendered UI with Browser or Playwright, including no console errors and at least one desktop and mobile screenshot.

Expected: All verification commands exit 0, rendered pages load without framework overlays, and new module controls produce visible state changes.

# CLAUDE.md

Guidance for AI agents working in this repo (Maple — managed agent platform).

## Commands

- `bun run dev` — start API (`bun --watch apps/control-plane-api/src/index.ts`, port **27951**) + web (Vite, port **5173**) together. Vite proxies `/v1` and `/health` to 27951.
- `bun run typecheck` — `bunx tsc --noEmit`. **Run after every change.**
- `bun run build` — typecheck + `vite build`.
- `bun run start` — production API (no watch).
- Tests are per-contract scripts: `bun run test:api-storage`, `test:workspace-runtime-pool`, `test:vefaas-contract`, `test:prototype-console`, etc. `bun run test:all` runs the full suite (includes e2e, slow).

Local API base is **27951** (`.env` `PORT`); web is **5173**. `.env` is gitignored (holds MySQL creds, veFaaS AK/SK, OAuth secrets) — never commit it.

## Architecture

Bun + Express 5 backend (`apps/control-plane-api/src/`) + React 19 SPA (`apps/admin-web/src/`), single repo.

### Backend (`apps/control-plane-api/src/`)
- `index.ts` — all Express routes (`/v1/...`). Auth via cookie/bearer; `currentUser(req)` reads `req.user` (set by middleware, **no DB hit**).
- `storage/store.ts` — all data access export surface. Exposes a **synchronous** db API (`db.prepare(sql).get/all/run`, `db.transaction`) in better-sqlite3 style.
- **`infra/mysql.ts` + `infra/mysql_worker.mjs` + `infra/mysql_child.mjs` — the DB is a REMOTE MySQL, not sqlite.** `db = createMysqlDatabase()`. The sync API is backed by a persistent worker thread (mysql2 connection pool) bridged with `Atomics.wait` on a SharedArrayBuffer. `mysql_child.mjs` is the legacy spawn-per-query fallback (`MAPLE_MYSQL_FORCE_HELPER=true`). `.managed-agents/platform.sqlite` is a DEAD legacy file — ignore it.
- `runtime/runtime.ts` — agent/sandbox runtimes: vefaas / e2b / docker / aws_lambda. `invokeVefaas` POSTs the function `invoke_url`; control actions (bootstrap) use a short timeout, `run` uses the full agent timeout.
- `runtime/runner.ts` — `runUserMessage` drives a session turn (vefaas agent loop / external claude_code loop / direct provider loop).
- `infra/secrets.ts` — `encryptSecret`/`writeSecret`/`readSecret` (secret store; `secret_ref` columns point here).
- `catalog/mcpCatalog.ts` — preset MCP providers (Notion/GitHub/Vercel/Google/Canva/Figma/Atlassian) with OAuth endpoints; `mcp_servers` table holds user-managed endpoints.
- veFaaS provisioning shells out to `infra/vefaas/deploy_vefaas_runtime.py` via **async** `execFileAsync`, and runs in the background (`provisionPoolMembersBackground`) so onboarding returns immediately; pool members start `status='provisioning'`.

### Frontend (`apps/admin-web/src/`)
- `App.tsx` — the console shell (**frozen baseline debt — do not grow it**). `view` state drives the active page; `modal` state drives modals; `refresh()` fetches workspace-scoped lists in parallel. New views go in their own file (`apps/admin-web/src/pages/<domain>/<Name>.tsx`), not here.
- `ui.tsx` — `Icon`/`Av`/theme + i18n + Toast + Confirm + DrawerStack providers. Icons are an SVG sprite (`<svg class="ic"><use href="#i-..."/>`), injected in `index.html`.
- `styles.css` — the prototype design system (`ui-design/MaplePrototype.html` is the source of truth for look/feel). Custom `Select` (`.sel`) replaces native `<select>`; `.dropdown` is the dark popup.

### Data model (MySQL)
tenants → workspaces → (agents, environments, sessions, vaults, memory_stores, runtime pools). `workspace_members` gates access. Auth/list endpoints **must scope by the user's accessible workspaces** — `accessibleWorkspaceIds(userId)` + `scopeByWorkspace(...)` in `index.ts`; a list endpoint with no `workspace_id` must filter to member workspaces, never the whole table.

## Gotchas

- **DB is remote MySQL over a worker, not sqlite.** Per-query latency ≈ MySQL RTT; the worker serializes queries (main thread blocks on `Atomics.wait`). Avoid N+1 in handlers — batch, or accept the serialized cost. Inspect/clean data with the helper: `echo '{"op":"query","mode":"all","sql":"...","params":[]}' | node apps/control-plane-api/src/infra/mysql_child.mjs`.
- **Deleting rows hits a long FK chain** (workspace_api_keys / workspace_members / workspace_model_configs / runtime_pool* / auth_sessions / model_configs.owner_user_id …). Wrap deletes in a transaction with `SET FOREIGN_KEY_CHECKS=0`.
- **Onboarding lock:** while a user has no workspace, the left nav + workspace switcher are `disabled` (provisioning must finish first). Onboarding form state persists to `localStorage` (`maple_onboarding_<userId>`), secrets excluded.
- **Ports:** API 27951, web 5173, both in `.env` + `vite.config.ts`. OAuth callbacks use `MAPLE_WEB_BASE_URL`.
- veFaaS deploy needs valid AK/SK; without them pool members go `failed` (degraded) — expected locally.

## Conventions
- Minimum-viable diffs; match surrounding style. No comments unless the *why* is non-obvious. Run `bun run typecheck` **and `bun run lint`** before declaring done.
- **Keep it simple — anti-monolith.** Functions single-purpose & ≤80 lines, nesting ≤3 (flatten with guard clauses / early return), ≤4 params, names state intent (`userProfile`, not `data`/`tmp`). No dead code. A new teammate should grok it faster than the version it replaced.
- **File size: 400-line hard cap** (`bun run lint` → eslint `max-lines`, a hard **error** that blocks commit; complexity / depth / function-length are **warnings**). No max-lines exemptions: split before you exceed it, and shrink files hovering near the limit before adding behavior.
- **Focused imports only.** `apps/admin-web/src/components/shared/AppShared.tsx` was removed because it hid dependencies behind a broad barrel. Import from the focused modules (`forms`, `labels`, `layout`, `events`, `code`, `misc`) instead.

## Domain language & decisions

`CONTEXT.md`(repo root)是术语裁决表,`docs/adr/` 是架构决策记录。走 spec-driven / brainstorming / 改架构前先读这两份:`CONTEXT.md` 给共享语言(用裁决后的词,别漂移),ADR 记录"为何这样做"——不重新争论已决决策。

- 命名(变量、函数、文件)用 `CONTEXT.md` 裁决后的词。遇到它没收录的 Maple 专属概念,顺手补进去(1-2 句 + `_Avoid_` 同义词)。
- 做了**难回退 + 看代码会困惑 + 真有取舍**的决策时,落一份 `docs/adr/NNNN-slug.md`(顺号、1-3 句即可:做了什么 + 为什么)。改动与既有 ADR 冲突时,先读那份 ADR。

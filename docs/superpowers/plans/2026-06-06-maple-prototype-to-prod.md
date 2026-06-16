# Maple Prototype To Prod Plan

## Goal

把 `ui-design/MaplePrototype.html` 的高保真交互推进到现有 Bun/Express 应用。当前原型文件是可见产品的唯一 source of truth：布局、导航、文案、弹窗、抽屉和交互顺序均以它为准；原型没有的页面和功能不得出现在本地可见 UI。

## Source Inputs

- 原型 source of truth：`/Users/bytedance/workspace/managed-agents-platform/ui-design/MaplePrototype.html`
- 历史参考，不再作为 source of truth：`/Users/bytedance/workspace/managed-agents-platform/ui-design/maple-login.html`
- 历史参考，不再作为 source of truth：`/Users/bytedance/workspace/managed-agents-platform/ui-design/maple-console.html`
- 当前前端：`/Users/bytedance/workspace/managed-agents-platform/src/App.tsx`
- 当前认证：`/Users/bytedance/workspace/managed-agents-platform/server/auth.ts`
- 当前 API：`/Users/bytedance/workspace/managed-agents-platform/server/index.ts`
- 当前数据层：`/Users/bytedance/workspace/managed-agents-platform/server/store.ts`
- 架构边界：`/Users/bytedance/workspace/managed-agents-platform/docs/design/2026-06-05-current-architecture.md`

## Product Contract

登录页必须以 Maple 品牌和飞书 SSO 为主路径，保留 local dev login 只作为开发兜底。SSO 点击后要有原型中的遮罩、进度、错误反馈和回调后的控制台跳转。

租户开通是首登后的强制流程。用户未完成开通时，只能停留在开通页；左侧导航、工作区选择、Dashboard、Quickstart、Sessions 等入口必须被拦截，并给出“请先完成租户开通”的明确反馈。

开通页必须是原型中的三步式流程：

1. 租户与工作区：租户名称、唯一 slug、管理员、租户描述、默认工作区名称、默认工作区描述、Console URL 预览。
2. 运行时与沙箱：Runtime Provider、Sandbox Provider、provider-specific 参数、Runtime Pool 预热函数数、单函数最大实例、单实例并发、CPU Milli、Memory MB。
3. 模型池与密钥：至少一个模型配置、Workspace API key 名称、最终确认、开通成功后只展示一次明文 key。

租户 slug 规则必须在前端和后端同时约束：`^[a-z0-9]([a-z0-9-]{1,28}[a-z0-9])?$`，总长度 3-30，不能使用保留词，不能与已存在租户冲突。前端要显示 available/taken/invalid/pending 状态，后端是最终裁决。

Workspace 继续承载 agent runtime、runtime pool、sandbox provider、model pool、Workspace API key。Environment 只描述 sandbox/tool environment、网络、包和 metadata，不能回流 agent runtime。

## API Contract

- `GET /v1/auth/providers`
  - 返回 `lark_sso` configured 状态。
- `GET /v1/auth/oauth/lark_sso/start`
  - 支持 `MAPLE_LARK_AUTHORIZE_URL`、`MAPLE_LARK_TOKEN_URL`、`MAPLE_LARK_USERINFO_URL`、`MAPLE_LARK_CLIENT_ID`、`MAPLE_LARK_CLIENT_SECRET`、`MAPLE_LARK_CALLBACK_URL`、`MAPLE_LARK_SCOPE`。
  - 当配置了 `MAPLE_LARK_CALLBACK_URL=http://localhost:6789/callback` 时，授权 URL 的 `redirect_uri` 必须使用它。
- `GET /callback`
  - 作为飞书 SSO 的本地回调别名，完成 `lark_sso` token exchange，写入 session cookie，然后跳回 `/`。
- `GET /v1/workspace_onboarding/status`
  - 返回 `required`、已有 workspaces、tenant slug/URL 信息。
- `POST /v1/workspace_onboarding`
  - 接收 tenant slug/admin/description、workspace metadata、runtime provider、sandbox provider、runtime pool、model config ids、api key display name。
  - 创建 tenant、workspace、workspace member admin、runtime pool、runtime pool members、workspace model pool、workspace API key。
  - 响应里明文 API key 只出现一次。
- `GET /v1/tenants/slug/:slug`
  - 返回 slug availability，用于开通页即时校验。
- `GET /v1/workspaces/:workspaceId/api_keys`
- `POST /v1/workspaces/:workspaceId/api_keys`
- `PATCH /v1/workspaces/:workspaceId/api_keys/:keyId`
- `DELETE /v1/workspaces/:workspaceId/api_keys/:keyId`
  - 管理 Workspace API keys，列表不暴露 hash/secret，只暴露 prefix、scopes、enabled、last_used_at。

## Implementation Tasks

- [x] 冻结 spec：本文件包含原型差距、开通细节、API contract、验收命令。
- [x] 更新 `.env.example` 的 Lark OIDC 变量名，真实 secret 只留在本地 `.env`。
- [x] 修改 `server/auth.ts`：加入 provider callback URL 解析，优先使用 `MAPLE_LARK_CALLBACK_URL`，并保留 generic OAuth/OIDC 兼容。
- [x] 修改 `server/index.ts`：新增 `/callback`，并让 `/v1/auth/oauth/:provider/start|callback` 使用 provider callback URL。
- [x] 修改 `server/store.ts`：tenant metadata 增加 slug、console_url、admins；workspace config 增加 runtime/sandbox/provider 参数快照；新增 slug availability 和 workspace API key 管理函数。
- [x] 修改 `server/index.ts`：扩展 onboarding schema、slug 校验、tenant slug 查询、workspace API key CRUD。
- [x] 修改 `src/App.tsx`：登录页对齐 Maple/Lark 原型，local dev login 降级为辅助入口。
- [x] 修改 `src/App.tsx`：开通页改为三步 wizard，补齐 slug 校验、Console URL 预览、provider cards、runtime pool、模型池、API key 一次性展示。
- [x] 修改 `src/App.tsx`：开通完成前加入导航和 workspace picker 绕行保护，提示文案与原型一致。
- [x] 修改 `src/App.tsx`：Console shell、workspace picker、Tenant、API keys、Sessions detail 按原型逐步对齐。
- [x] 更新 `scripts/e2e.mjs` 或现有 Playwright 覆盖：登录 start、`/callback`、开通三步、slug invalid/taken、API key 一次性展示、开通前导航拦截。
- [x] 运行 `bun run typecheck`。
- [x] 运行 `bunx --bun vite build`。
- [x] 运行 `bun run test:e2e`。
- [x] 尽力运行 `bun run test:all`；若真实 E2B/veFaaS 受配额或外部环境限制，记录具体错误和资源 ID，并清理可清理资源。

## Expected Results

- 新用户通过飞书 SSO 登录后，若没有 workspace，只能进入租户开通。
- 租户 slug 规则在 UI 和 API 两侧一致，冲突时不能提交。
- 完成开通后生成 active tenant、active workspace、admin membership、active runtime pool、model pool 绑定和一个 workspace API key。
- Workspace API key 明文只在开通或创建后展示一次，列表页不泄露 secret。
- Environment 创建和展示仍只描述 sandbox/tool runtime，不包含 agent runtime provider。
- Console 首屏能从开通成功的 workspace 进入 Quickstart，并能继续创建/运行 session。

## Verification Evidence To Capture

- `bun run typecheck` 输出。
- `bunx --bun vite build` 输出。
- `bun run test:e2e` 输出。
- SSO configured 时 `/v1/auth/oauth/lark_sso/start` 返回或跳转的 `redirect_uri=http://localhost:6789/callback`。
- 开通前访问 Console 路由被拦截的 Playwright 证据。
- 开通成功响应中 `api_key.key` 存在；随后 API key list 不包含明文 key。

## Verification Evidence

- `PATH=/Users/bytedance/.bun/bin:$PATH /Users/bytedance/.bun/bin/bun run typecheck` passed.
- `PATH=/Users/bytedance/.bun/bin:$PATH /Users/bytedance/.bun/bin/bunx --bun vite build` passed; latest assets: `index-CGAWDvme.css`, `index-D1QemCtU.js`.
- `PATH=/Users/bytedance/.bun/bin:$PATH E2E_PORT_BASE=26600 /Users/bytedance/.bun/bin/bun run test:all` passed.
- E2E verified `redirect_uri=http://localhost:6789/callback` for Lark SSO start.
- E2E verified tenant slug contract: `invalid`, `reserved`, and `taken`; both `/v1/tenants/slug/:slug` and `/v1/workspace_slugs/:slug` return taken after onboarding.
- E2E verified onboarding creates tenant/workspace metadata and only the create response contains the raw Workspace API key; list response does not expose `key`.
- E2E created real E2B sandbox `isj18e1pl4r08tpk095wu`; script cleanup completed because E2B cleanup failures are fatal and `test:all` exited 0.
- Local E2E ports `26500`, `26501`, `26600`, and `26601` had no LISTEN residue after tests.

## 2026-06-06 MaplePrototype.html Alignment Pass

### Objective

`ui-design/MaplePrototype.html` is now the active interaction source of truth. The React app should match the bundled prototype's console behavior closely enough that a user can navigate, inspect, configure, and operate Maple without falling into placeholder surfaces.

### Added Source Input

- 原型：`/Users/bytedance/workspace/managed-agents-platform/ui-design/MaplePrototype.html`

### Assumptions

- `MaplePrototype.html` supersedes the older split `maple-login.html` / `maple-console.html` files for visible console interactions.
- Runtime pool creation remains a provisioning-time operation; editing an existing pool in settings should show read-only status unless a backend mutation contract exists.
- Provider credentials are represented in workspace config/provider sections; secrets must never be echoed back after creation.
- Product behavior beats decorative parity when there is a conflict between prototype mock data and the current API model.

### Implementation Tasks

- [x] Add Workspace Settings drawer/modal from the prototype.
  - Acceptance: workspace picker exposes a settings icon; settings shows Overview, Runtime, Providers, Model pool, API keys.
  - Verify: Playwright can open settings, switch tabs, create a Workspace API key, and close it.
  - Files: `src/App.tsx`, `src/styles.css`, `scripts/e2e.mjs`.
- [x] Align shell, user menu, and workspace picker with MaplePrototype desktop states.
  - Acceptance: sidebar grouping, current workspace label, create workspace route, language/action controls, and footer actions fit without overlap.
  - Verify: screenshot at 1440x900; no horizontal overflow at 390x844.
  - Files: `src/App.tsx`, `src/styles.css`.
- [x] Expand Documentation into the prototype's three-pane docs view.
  - Acceptance: left nav, main article, and right table-of-contents are visible on desktop; TOC collapses on smaller screens.
  - Verify: Playwright navigation to Documentation finds Managed Agents API, 基础 URL 与版本, 第一个请求, 本页目录.
  - Files: `src/App.tsx`, `src/styles.css`.
- [x] Strengthen Sessions observability interactions.
  - Acceptance: event filter, Transcript/Debug tabs, copy/download, Ask Maple drawer, and event details remain usable when events are empty or long.
  - Verify: `scripts/e2e.mjs` covers every visible control or documents disabled state.
  - Files: `src/App.tsx`, `src/styles.css`, `scripts/e2e.mjs`.
- [x] Keep product surfaces scoped to the prototype source of truth.
  - Acceptance: visible navigation and interactions are limited to Dashboard, Quickstart, Agents, Sessions, Environments, Vaults, Tenant, Models, API Keys, and Documentation.
  - Verify: UI smoke and `scripts/e2e.mjs` button audit exclude Skills, Templates, Artifacts, and Scan Skills.
  - Files: `src/App.tsx`, `src/styles.css`, `scripts/e2e.mjs`.
- [x] Final verification.
  - Acceptance: typecheck, build, E2E, and desktop/mobile screenshots pass.
  - Verify: `bun run typecheck`, `bun run build`, `bun run test:e2e`; inspect screenshots.
  - Status: typecheck/build/browser smoke passed; full E2E is blocked until `docker` is available in PATH.
  - Files: no additional files expected unless tests reveal gaps.

### Commands

- Typecheck: `bun run typecheck`
- Build: `bun run build`
- E2E: `bun run test:e2e`
- Full suite when cloud env is available: `bun run test:all`

### Current Pass Evidence

- `PATH=/Users/bytedance/.bun/bin:$PATH /Users/bytedance/.bun/bin/bun run typecheck` passed.
- `PATH=/Users/bytedance/.bun/bin:$PATH /Users/bytedance/.bun/bin/bun run build` passed; latest assets: `index-t8qbfceg.js`, `index-pv9a9m5t.css`.
- Playwright pixel smoke with mocked `/v1/*` passed for login, Dashboard, Workspace Settings, Ask Maple, and 390x844 Quickstart.
- Final smoke screenshots:
  - Login: `/tmp/maple-app-final-login-1780754884194.png`
  - Dashboard: `/tmp/maple-app-final-dashboard-1780754884194.png`
  - Workspace Settings: `/tmp/maple-app-final-settings-stable-1780754988472.png`
  - Ask Maple: `/tmp/maple-app-final-ask-blue-1780755232102.png`
  - Mobile Quickstart: `/tmp/maple-app-final-mobile-1780755133200.png`
- Pixel metrics checked:
  - Ask Maple drawer: `x=840`, `w=600`, `h=920`.
  - Mobile sidebar rail: `w=64`, `scrollWidth=390`, `innerWidth=390`.
  - Ask Maple send button: `rgb(46, 121, 200)`.
- `PATH=/Users/bytedance/.bun/bin:$PATH /Users/bytedance/.bun/bin/bun run test:e2e` is currently blocked before frontend audit by local Docker availability: `Executable not found in $PATH: "docker"` at `scripts/e2e.mjs:513`.

## 2026-06-06 Real Data, MySQL, TOS, and Prototype Function Completion Pass

### Objective

The visible UI must remain 100% sourced from `ui-design/MaplePrototype.html`, but the application data source must not be the prototype's bundled sample records or local-only fixtures. All product data must be persisted in MySQL, and all generated/uploaded artifacts must be stored in Volcengine TOS.

### Required Runtime Configuration

- MySQL host: `vedbm-qkydajdkqldu.pri.mysql.vedb.volces.com`
- MySQL database: `maple`
- MySQL user: `root`
- MySQL password: stored in local `.env`, not committed.
- TOS bucket: `maple-bucket-michael`
- TOS endpoint: `maple-bucket-michael.tos-cn-beijing.volces.com`
- Volcengine AK/SK: loaded from `.env` via `VOLCENGINE_ACCESS_KEY` / `VOLCENGINE_SECRET_KEY` or `VOLC_ACCESSKEY` / `VOLC_SECRETKEY`.

### Source Of Truth Rules

- Visual layout, copy, interaction order, drawers, modals, nav, and button behavior come from `MaplePrototype.html`.
- Prototype static records such as `ws_default`, `sess_*`, `agt_*`, `env_*`, `mem_*`, `vlt_*`, `mc_*`, `gk_*`, example users, example sessions, example transcript rows, and example tool calls are not product data.
- React state may hold UI state only. Product records must come from `/v1/*` APIs backed by MySQL.
- No hardcoded production-like API keys or secrets may be embedded in source code. Defaults must come from `.env`, MySQL rows, or one-time generated secrets.
- Local file storage may only be used for transient sandbox working directories. Uploaded files, generated artifacts, and artifact metadata must be represented as TOS-backed objects.

### Prototype Function Inventory To Implement Or Prove Removed

- Auth and onboarding: `renderAuthGate`, `authSetMode`, `authSSO`, `openProvision`, `pvInit`, `pvSlugInput`, `pvGo`, `pvNext`, `confirmProvision`, provider cards, provider credentials, runtime pool inputs, model pool selection, one-time workspace API key display.
- Shell and workspace: `renderShell`, `renderNav`, `selectWs`, `filterWs`, `openCreateWorkspace`, `confirmCreateWorkspace`, `openWorkspaceSettings`, `openSettings`, `settingsGo`, `saveWorkspaceSettings`, theme/language/density/accent controls.
- Dashboard and entity drilldowns: dashboard metrics, `openMetricDrawer`, `drillTo`, `gotoEntityPage`, `openEntityDrawer`, entity panels for agent/environment/model/vault/memory/artifact/user.
- Quickstart: prompt composer, template browse/search/detail/use/copy, draft generation, model tab switching, code sample copy, test send, restart/close controls.
- Agents: list/detail selection, overview/config/sessions tabs, config copy, session open.
- Sessions: list filtering, row selection, transcript/debug tabs, event detail, Ask Maple drawer, composer send, copy/download transcript, references drawer.
- Environments: create/edit draft, provider-specific fields, packages, env vars, custom endpoints, save/cancel.
- Vaults and credentials: create vault, create/edit credentials, masking, credential completion.
- Models and API keys: add/delete model, set default model, create/rename/delete key, copy one-time key.
- Memory and artifacts: create memory store, artifact list/download/details, file upload if present in the prototype.
- Documentation: three-pane docs nav, TOC scroll, copyable code samples.

### Implementation Tasks

- [x] Add `.env.example` entries for MySQL and TOS without committing secrets.
- [x] Add MySQL dependency and replace runtime persistence with a MySQL-backed data layer.
- [x] Convert schema DDL through the MySQL adapter: remove/translate `PRAGMA`, use MySQL-compatible DDL, index creation, and `INSERT IGNORE` semantics.
- [x] Add `/v1/console_snapshot` so the served prototype hydrates product records from MySQL instead of bundled sample arrays.
- [x] Remove automatic fake seed data from database initialization; old sample environments/templates/memory/vault rows are not recreated.
- [x] Remove source-code hardcoded model API key creation; model config listing must not auto-create configs.
- [x] Replace `server/files.ts` local file writes with TOS object writes and metadata persisted in MySQL.
- [x] Replace `server/artifacts.ts` artifact download path with TOS-backed metadata/object URL flow.
- [x] Add repeatable API storage contract covering MySQL + TOS + no seed data.
- [x] Add repeatable prototype console contract covering DB-backed empty state, prototype-only nav, no demo data leakage, and main navigation clicks.
- [ ] Persist prototype modal mutations that still operate only in the bundled JS arrays: workspace create/settings, model add/delete/default, API key create/delete, vault/environment/session creation.
- [ ] Remove or implement every remaining prototype-visible UI function listed above. Features absent from `MaplePrototype.html` must stay removed from the visible product.
- [ ] Extend E2E to cover MySQL persistence, TOS upload/download, no raw secret exposure, no fake runtime rows, and every visible prototype control.
- [ ] Run `mirror-protopype` pixel diff for at least login, dashboard, workspace settings, quickstart, sessions, onboarding runtime, and mobile states.
- [ ] Run the complete E2E suite three consecutive times against the real local app, real MySQL, real TOS, and E2B sandbox. Record sandbox IDs and cleanup status.
- [ ] Deploy backend as one veFaaS function and frontend as one separate veFaaS function. Prefer the veFaaS MCP server when available; if the MCP tool is not exposed in the current session, use the repository's Volcengine deployment scripts with the same AK/SK from `.env`.
- [ ] Run online E2E against the deployed frontend/backend pair, bypassing login only for the online smoke as requested.
- [ ] Send a progress report via `lark-cli` after steps 0-5 are complete.
- [ ] Scan the final code and update the latest architecture design document before sending it to the user.

### Verification Evidence To Capture

- MySQL connectivity: `SELECT DATABASE()` returns `maple`; app-created rows are visible in MySQL after API calls.
- No SQLite use: source search has no runtime SQLite imports (`bun:sqlite`, `better-sqlite3`, `platform.sqlite`) outside migration notes or historical docs.
- No fake data: source search has no product runtime `fake-vefaas-*`, static prototype records wired into React, `seedMemory`, or hardcoded production-like API keys.
- TOS: uploaded file/artifact response includes bucket/key/URL metadata for `maple-bucket-michael`; local `.managed-agents/files` is not the source of truth.
- E2E pass 1/2/3: each run passes and reports E2B sandbox cleanup.
- Pixel diff: every checked state reports `changed_pixels = 0`.
- veFaaS deployment: frontend and backend function IDs, invoke URLs, region, deployment artifact IDs, and online E2E output.
- Lark report: exact `lark-cli` command, target, message ID, and delivered progress summary.
- Architecture document: updated file path and source-backed summary of frontend, backend, MySQL, TOS, E2B, veFaaS, auth bypass, and runtime-pool flows.

### Current Evidence

- MySQL whitelist verified: child adapter query returned `db=maple`, `user=root@%`, `version=8.0.27-18-ndb`, `hostname=vedbm-qkydajdkqldu-0`.
- TOS verified by API storage contract: `bun run test:api-storage` passed and cleaned its test object/DB rows.
- Prototype DB-backed UI verified: `bun run test:prototype-console` passed.
- TypeScript verified after the MySQL/TOS/prototype contract changes: `bun run typecheck` passed.
- Local inspect URL: `http://127.0.0.1:27951/?dev_login=1`.

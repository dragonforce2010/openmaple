# Part B — 登录/注册统一入口 + 租户分支引导（PR2）

> 计划日期 2026-06-08。依赖 PR1（schema 硬化）已合入。
> 目标：① 前端不分登录/注册，统一入口；② 登录后按「是否创建过租户 / 是否他人租户成员」四分支引导。

## 0. 现状（只读梳理，带 file:line）

**后端：**
- `POST /v1/auth/login`（index.ts:497）：唯一本地登录入口，`issueLogin`→`upsertUser`（按 email upsert，首次登录=注册）。无独立注册端点 → **后端本就统一**，注册=首次登录。
- `GET /v1/auth/me`（index.ts:517）：返回 `{user, tenants: listAccessibleTenants(user.id)}`。
- `GET /v1/workspace_onboarding/status`（index.ts:558）：`required = ownedTenantCount===0`。**当前 bug 根源**：member-only 用户（属他人租户但自己没 own）会被判 `required=true`，强推去开通自己的新租户（index.ts:561 注释明示此设计）。
- `listAccessibleTenants`（store.ts:707）：按 workspace_members 反查租户，聚合 `is_owner`(成员含 admin 角色=1)、`workspace_count`、`primary_workspace_id`。**已能区分 owner vs member**，前端没充分用。

**前端（src/App.tsx）：**
- `LoginView`（App.tsx:2694）：有 `authMode: login|signup`（:2696）+ 两 tab（:2750），但**只切提示文案**（:2753），提交逻辑/表单完全一样 → 形同虚设。实际登录只有飞书 SSO（:2755）+ 隐藏 dev 登录（autoLocalLogin :2705，写死 admin@example.com）。
- 首屏判断（App.tsx:519-542 useEffect）：拉 providers+me → setCurrentUser → 若 `owned>0 && tenants>1` 进 `tenant_select`（:530），否则 `refresh()`。
- `refresh()`（App.tsx:463）：拉 `workspace_onboarding/status`，`required` 真 → `view="provision"`（:488）。
- `TenantSelectView`（App.tsx:2774）：多租户全屏选择页。
- `WorkspaceOnboardingView`（App.tsx:2805）：3 步开通租户（Tenant→Runtime→Models）。
- Switcher：`WorkspacePicker`（:1203）+ 用户菜单租户切换（:1322，tenants>1 才显示）。`locked = onboardingRequired || view==='tenant_select'`（:949）。

## 1. 目标四分支（你的需求）

登录成功后，依据 `listAccessibleTenants(userId)` 拆成 `owned`（is_owner=1）与 `memberOnly`（is_owner=0）：

| 分支 | 条件 | 引导 |
|---|---|---|
| A | owned=0 且 memberOnly=0（无任何租户） | → 租户开通向导（WorkspaceOnboardingView） |
| B | owned=0 且 memberOnly≥1（只是他人租户成员） | → **新增「二选一」页**：① 创建自己的租户 ② 进入已有租户（列 memberOnly 租户，选一个进） |
| C | owned≥1 且总租户=1（只有自己一个租户） | → 直接进主页（dashboard），选中该租户的 primary workspace |
| D | owned≥1 且总租户>1（自己的+他人的多个） | → 租户列表选择页（TenantSelectView 扩展），选一个进 |

> 核心变化：**B 分支是当前缺失的**——现在 B 被错判成 A（强推开通新租户，无「加入已有」选项）。

## 2. 后端改动

1. **新增 `GET /v1/auth/bootstrap`**（或扩 `workspace_onboarding/status`）：一次返回前端首屏分支决策所需全部数据，收敛分散逻辑（承接 ER 分析「首屏分支分散」）。返回：
   ```ts
   { user, tenants: [{id,name,is_owner,primary_workspace_id,workspace_count}],
     owned_count, member_only_count, recommended_view: "onboarding"|"tenant_choice"|"dashboard"|"tenant_select" }
   ```
   `recommended_view` 后端按 §1 四分支算好，前端直接用（单一可信源）。
2. **保留** `POST /v1/auth/login`（已统一，无需拆注册）；前端 signup tab 删除。
3. `workspace_onboarding/status` 的 `required` 语义保持（A 分支仍用），但前端不再单独依赖它做分支——以 `bootstrap.recommended_view` 为准。
4. **不改** `issueLogin`/`upsertUser`（首次登录=注册已正确）。

## 3. 前端改动

1. **LoginView（:2694）**：删 `authMode`/signup tab（:2696/2750/2753），改成单一「登录 / 注册」合并入口文案（如「登录或注册 Maple」），保留 SSO 按钮 + 本地登录（dev）。提交后调 `/v1/auth/bootstrap`。
2. **首屏路由（:519-542 + refresh :463）**：改为读 `bootstrap.recommended_view` 直接 setView，删除前端散落的 `owned>0&&tenants>1` / `required` 判断（移到后端）。映射：
   - `onboarding` → view `provision`
   - `tenant_choice` → **新 view `tenant_choice`**（B 分支二选一页）
   - `dashboard` → 进主页 + setSelectedWorkspaceId(primary)
   - `tenant_select` → view `tenant_select`（D）
3. **新增 `TenantChoiceView`（B 分支）**：两张大卡片——「创建新租户」（→provision）/「进入已有租户」（下方列 memberOnly 租户，点选→dashboard+该租户 primary workspace）。交互参考现有 TenantSelectView 视觉。**这是你说的「前端交互好好设计」的重点页**。
4. **TenantSelectView（:2774，D 分支）**：现已存在，确认覆盖「owned+member 混合多租户」，每项标注 `is_owner`（自己的/受邀的）徽章。
5. Switcher `locked` 逻辑（:949）：加 `view==='tenant_choice'` 也 locked。

## 4. 交互设计（B 分支 TenantChoiceView）

```
┌─────────────────────────────────────────┐
│  欢迎回来，<name>                          │
│  你被邀请加入了 N 个工作区，也可以创建自己的  │
│                                           │
│  ┌──────────────┐   ┌──────────────┐     │
│  │ ➕ 创建新租户  │   │ 🏢 进入已有    │     │
│  │ 开通你自己的   │   │ 选择一个你被   │     │
│  │ 工作区与运行时 │   │ 邀请的租户进入 │     │
│  └──────────────┘   └──────────────┘     │
│                                           │
│  已有租户（点击进入）：                     │
│   • Acme Corp（受邀 · member）  →         │
│   • Dev Shared（受邀 · member） →         │
└─────────────────────────────────────────┘
```

## 5. e2e 验证（前后端）

用 `scripts/e2e.mjs`（已有 51.7K e2e）+ 新增分支用例。**需 live MySQL（白名单已放行）**。

构造四类测试用户（migration 后或测试 fixture）：
- U_A：全新 email 首次登录 → 期望落 `provision`（A）
- U_B：被加入某租户 workspace_members(member) 但自己未 own → 期望落 `tenant_choice`（B），且能选「进入已有」进 dashboard、也能选「创建新租户」进 provision
- U_C：own 1 租户、不是其他租户成员 → 期望直接 `dashboard`（C）
- U_D：own 1 租户 + member 于另 1 租户 → 期望 `tenant_select`（D），选任一进对应 workspace
- 回归：U_C 登录不再误进 onboarding；scope 不漏（A 类用户看不到他人资源）

验证方式：
1. `bun run typecheck` 干净。
2. 后端契约：扩 `scripts/api_storage_contract.ts` 或新增 `scripts/auth_tenant_flow_contract.ts`，对四类用户断言 `/v1/auth/bootstrap.recommended_view`。
3. 前端 e2e：`bun run dev` + Playwright（已连 chrome-devtools/playwright MCP）跑四分支 UI 流，截图存证。
4. `bun run test:prototype-console` 不回归。

## 6. 文件清单（PR2）

| 文件 | 改动 |
|---|---|
| `server/index.ts` | 新增 `/v1/auth/bootstrap`；可选废弃 status 的前端用途 |
| `server/store.ts` | `listAccessibleTenants` 补 member_only 拆分辅助（或在 index 算） |
| `src/App.tsx` | LoginView 删 signup tab；首屏读 recommended_view；新增 TenantChoiceView；TenantSelectView 加 owner 徽章；switcher locked |
| `src/types.ts` | bootstrap 响应类型 |
| `scripts/auth_tenant_flow_contract.ts`（新） | 四分支后端契约 |
| `scripts/e2e.mjs` | 四分支 e2e 用例 |

## 7. 任务清单（checkbox）

- [ ] T1 后端 `/v1/auth/bootstrap` + recommended_view 四分支逻辑
- [ ] T2 后端契约测试 auth_tenant_flow_contract，四类用户断言通过
- [ ] T3 LoginView 删 signup tab，统一入口
- [ ] T4 首屏路由改读 recommended_view，删散落判断
- [ ] T5 新增 TenantChoiceView（B 分支二选一 + 已有租户列表）
- [ ] T6 TenantSelectView 加 owner/member 徽章
- [ ] T7 `bun run typecheck` + test:prototype-console 干净
- [ ] T8 前端 e2e 四分支流 + 截图
- [ ] T9 出 PR（push 拿 MR 链接）

## 8. 风险

- `/v1/auth/bootstrap` 每请求多查 listAccessibleTenants（已有 JOIN，可接受）；与 ER 分析「auth_sessions 迁 Redis」是独立后续，本轮不动。
- 改首屏路由触及 App.tsx 大文件多处 state，回归面大 → 严格按 e2e 四分支 + 现有 prototype-console 守护。

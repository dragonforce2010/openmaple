# 统一分级侧拉窗详情页改造（drawer-stack-unify）

> 日期：2026-06-09 · 分支建议：`feat/drawer-stack-unify` · 仅前端（`src/`），无后端改动

## 1. 要落地的原则

1. **侧拉窗详情页都复用各组件的详情页**——侧拉窗里渲染的详情主体 = 整页详情用的同一个 `DetailBody` 组件，不另写一套。
2. **页面各处都能跳详情，通过侧拉窗**；详情套详情用分级侧拉窗承载：
   - 第 1 级 **80%** 宽，第 2 级 **60%**，第 3 级 **40%**；
   - 还要再跳第 4 级 → **直接整页跳转**（`goView`），不再叠侧拉窗。

## 2. 走查结论（现状缺口）

基础设施齐全但**零接入**：`DrawerStack`（`DRAWER_WIDTHS=["80%","60%","40%"]`）定义在 `src/ui.tsx:234-280`、`DrawerStackProvider` 已在 `src/main.tsx:12` 挂载，但 **`App.tsx` 全文 0 次调用 `useDrawerStack`**。

| 缺口 | 证据 |
|---|---|
| 详情主入口走整页路由，非侧拉 | `goView("agent"/"environment")` 整页 `App.tsx:1273-1274`、入口 `:4342`/`:4571` |
| 详情套详情无分级承载 | `MetricDrawer.onDrill` 跳列表整页 `:1349`/`:5970,5977,5983,5987`；`SessionInfoDrawer` 单层 `ask-drawer` `:5164` |
| 侧拉窗详情未复用详情页 | `SessionInfoDrawer` 里 env 只渲染 JSON `:5180`；agent 只塞子面板 `AgentOverviewPanel` `:5177`，非完整 `AgentDetailView` |
| 两套 drawer 系统并存 | `drawer-layer`+`ask-drawer`（z40）vs `drawer-stack`+`dw-panel`（z60，死代码）|
| Dashboard 行点击断头 | `:1664`/`:1682` 只 `setView` 跳列表、不带 id、不进详情 |
| `ui.tsx` open 第 4 级逻辑错误 | `:250` 满 3 级时是「替换第 3 级」(`slice(0,2)+entry`)，应交由 caller 跳整页 |

**有真实「实体详情」概念的实体**：`agent` / `environment` / `vault` / `session`（工作台，特殊）。边角实体（`model_config`/`user`/`api_key`/`memory_store`/`tenant`/`credential`/`mcp`）是列表 + modal，**无详情页**，本次不造详情，仅把「凡引用即可跳详情」的入口统一到注册表。

## 3. 目标架构

```
EntityNavProvider (App 内, value 实时)
  ├─ data: { agents, sessions, environments, vaults, modelConfigs, workspaces }
  ├─ goView(view, id?, edit?)
  └─ openEntity(kind, id)   // 唯一入口
        depth < 3  → drawerStack.open({ body: <XxxDetailBody kind id/> })  // 自动 80/60/40
        depth >= 3 → goView(整页)                                          // 第 4 级跳转

DetailBody 组件（纯 body，无 PageFrame / 无 drawer 外壳）
  ├─ AgentDetailBody(agentId)      // 从 AgentDetailView 抽出
  ├─ EnvDetailBody(envId)          // 从 EnvDetailView 抽出
  └─ VaultDetailBody(vaultId)      // 从 VaultsView 双栏右侧抽出
  // 内部用 useEntityNav() 取实时 data（解决 DrawerStack body 快照不刷新问题）

整页路由 view=agent/environment → PageFrame + <XxxDetailBody/>  （复用，保留作深链接 + 第 4 级落地）
drawer    → DrawerStack 的 dw-panel + <XxxDetailBody/>          （复用同一 body）
```

### 关键设计决策

- **D1 快照刷新**：`DrawerStack.open` 的 `body` 是 ReactNode 快照，外部 list 更新不会重渲染。解法：`body` 只塞 `<AgentDetailBody agentId="x"/>`（仅含 id），body 内部 `useEntityNav()` 订阅 Context 实时 data → Context 更新即重渲染。**不新增后端单查依赖**（虽 `GET /v1/{agents,environments,vaults}/:id` 已存在，可作后续增强）。
- **D2 session 例外**：session 详情是三栏工作台（`session-screen`，`App.tsx:4962`），太重，不塞 60%/40% drawer。`openEntity("session", id)` → **直接 `goView("sessions", id)` 跳整页工作台并选中**。这是「卡片详情 vs 工作台」的合理例外，仍满足「可跳转」。
- **D3 两套 drawer 收编**：
  - 废弃 `SessionInfoDrawer`（`:5154`）——session meta-link 改 `openEntity` 渲染完整 `AgentDetailBody`/`EnvDetailBody`/`VaultDetailBody`。
  - `MetricDrawer`（`:5943`）重构为 `MetricBody`，作为 `openEntity("metric", kind)` 的第 1 级 dw-panel 内容；其 row 点单实体 → `openEntity` 开第 2 级。废弃 `drawer-layer`/`ask-drawer` 外壳。
  - **保留独立**：`AskMapleDrawer`（AI 问答，非实体详情）、`WorkspaceSettingsDrawer`（设置 modal，有保存 foot）。二者维持现状，不进 stack。
- **D4 vault 主页**：VaultsView 自身双栏（列表+详情）**保留**——它是 vault 的主工作区。仅「从别处引用 vault」（如 session meta-link）走 `openEntity` 渲染 `VaultDetailBody`。
- **D5 整页路由保留**：`view=agent/environment` 不删，内部改为复用 `XxxDetailBody`，承载 URL 深链接 + 第 4 级 fallback。

## 4. 分阶段任务

### Phase 0 — 基建（`ui.tsx` + App 顶层 Context）
- [ ] `ui.tsx`：修 `DrawerStackProvider.open`（`:250`）——满 3 级时**不入栈**（`current.length >= 3 ? current : [...current, entry]`），由 caller 负责跳整页。更新注释。
- [ ] `ui.tsx`：导出 `DRAWER_WIDTHS` 已有；确认 `dw-panel` 样式（`styles.css:1202-1229`）分级宽度生效。
- [ ] `App.tsx`：新增 `EntityKind = "agent"|"environment"|"vault"|"session"|"metric"`。
- [ ] `App.tsx`：新增 `EntityNavContext` + `useEntityNav()`（放 `App.tsx` 顶部或 `ui.tsx`）。value：`{ openEntity, goView, data }`。
- [ ] `App.tsx`：在 `App` 组件内 `const drawer = useDrawerStack()`；定义 `openEntity(kind, id)`：`depth<3` → `drawer.open({ key:`${kind}:${id}:${drawer.depth}`, title, sub, body:<DetailBody kind id/> })`；`depth>=3` → `goView`。`title/sub` 从 `data` 查实体名。
- [ ] `App.tsx`：用 `<EntityNavContext.Provider value=...>` 包住主渲染树。
- **验证**：`bun run typecheck` 通过；临时在某列表行接 `openEntity` 点击能弹 80% dw-panel。

### Phase 1 — 抽 DetailBody（复用核心，原则 1）
- [ ] `AgentDetailBody({ agentId })`：从 `AgentDetailView`（`:5648`）抽出 tabs + 各 Panel 主体（保留 5 tab：agent/sessions/runtime/integration/config）；内部 `useEntityNav()` 取 agent。`AgentDetailView` 整页 = `PageFrame`(title/crumb/action) + `<AgentDetailBody/>`。
- [ ] `EnvDetailBody({ envId })`：从 `EnvDetailView`（`:5773`）抽出主体（含 `edit` 态）。整页同样包壳复用。
- [ ] `VaultDetailBody({ vaultId })`：从 `VaultsView` 双栏右侧（`:4750-4826`）抽出（vault 头 + credential 表 + 空态）。`VaultsView` 右栏改为 `<VaultDetailBody/>`。
- **验证**：`bun run typecheck`；整页 agent/env、vault 主页双栏视觉与改前一致。

### Phase 2 — 入口统一接 openEntity（原则 2 入口）
- [ ] `AgentsView` 行（`:4342`）：`goView("agent")` → `openEntity("agent", agent.id)`。
- [ ] `EnvironmentsView` 行 + id-link（`:4571`/`:4572`）：→ `openEntity("environment", id)`。
- [ ] `DashboardView` 行（`:1664` session / `:1682` agent）：修断头 → `openEntity`（session 走 D2 跳整页选中；agent 开 drawer）。
- [ ] `DashboardView` 指标卡：点击 → `openEntity("metric", kind)`（替换现有 `setMetric`）。
- **验证**：`bun run typecheck`；各列表/卡片点击弹 80% drawer 或按 D2 跳转。

### Phase 3 — 套娃分级 + 收编散装 drawer（原则 2 核心）
- [ ] `SessionsView` meta-link（`:4976` agent / `:4979` env / `:4982` vault）：`setInfo(kind)` → `openEntity(kind, id)`。删 `info` 状态 + `SessionInfoDrawer` 渲染（`:5149`）。
- [ ] 删除 `SessionInfoDrawer` 组件（`:5154-5203`）。
- [ ] `AgentDetailBody` 内 sessions tab 行（`:5737`）：→ `openEntity("session", session.id)`（D2 跳整页）。
- [ ] `MetricDrawer`（`:5943`）→ 重构 `MetricBody({ kind })`：去掉 `drawer-layer`/`ask-drawer` 外壳，仅留 `metric-drawer` 内容；row 的 `onDrill` → `openEntity(单实体)` 开第 2 级（60%）。「查看全部」→ `goView` 整页列表。
- [ ] `App.tsx` 主渲染：删 `{metric ? <MetricDrawer/> : null}`（`:1341`）、`setMetric`/`metric` 状态（改由 `openEntity("metric")` 承载）。
- **验证**：手测套娃链路——
  - 指标卡 → 80% MetricBody → 点 agent 行 → 60% AgentDetailBody → 点其 session → 跳整页（D2）；
  - session 工作台 meta-link → 80% AgentDetailBody → 其 env（若有引用）→ 60%；
  - 三级满后再跳 → 整页（depth>=3 fallback）；
  - `Esc` 逐级关、`scrim` 点击关。

### Phase 4 — 清理 + 全量验证
- [ ] 删死代码 / 未用 import（`SessionInfoDrawer`、`MetricDrawer` 残留、`info`/`metric` 状态、`drawer-layer` 仅剩 AskMaple 用则保留）。
- [ ] 确认 `ask-drawer`/`drawer-layer` 仍被 `AskMapleDrawer` 使用，不误删 css。
- [ ] `bun run typecheck` 全绿。
- [ ] `bun run dev` 起本地，按下方清单逐项手测。

## 5. 验证清单（完成判据）

- [ ] 各实体列表行点击 → 弹 **80%** 第 1 级侧拉，内容 = 该实体完整详情页（与整页一致）。
- [ ] 第 1 级详情内点子实体 → 弹 **60%** 第 2 级；再点 → **40%** 第 3 级。
- [ ] 第 3 级内再点实体 → **整页跳转**（不出现第 4 级侧拉）。
- [ ] `Esc` 逐级回退；`scrim` 点击关闭当前级。
- [ ] URL 深链接 `view=agent/environment` 仍能整页打开（复用同 body）。
- [ ] session 工作台 meta-link agent/env/vault → 侧拉复用 `XxxDetailBody`（不再是 JSON dump）。
- [ ] Dashboard 行不再断头。
- [ ] `bun run typecheck` 通过。

## 6. 风险

- **R1 抽组件回归**：`AgentDetailView`/`EnvDetailView`/`VaultsView` 体量大，抽 body 易漏 state/prop。缓解：先抽再 typecheck，整页视觉逐项比对。
- **R2 z-index 叠加**：旧 `drawer-layer`(z40) 与 `drawer-stack`(z60) 若同时出现会叠。MetricDrawer 收编后只剩 AskMaple 用 z40，二者不会与详情 stack 同时打开。
- **R3 Context 性能**：`EntityNavProvider` value 含大 list，每次 App render 新建对象致 body 重渲染。缓解：`useMemo` 包 value（data 引用变才更新）。
- **R4 session 例外争议**：D2 让 session 跳整页而非侧拉。若需 session 也侧拉，后续可加精简 `SessionInfoBody`，不阻塞本次。

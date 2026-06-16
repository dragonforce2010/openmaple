# Managed Agent Deployments 对齐 Anthropic 设计

> 状态:计划 · 作者:michael.zhang · 日期:2026-06-15
> 范围:研究 Anthropic Managed Agents deployments,给 Maple 的实现与落地计划。本文不改产品代码。
> 当前工作区注意:执行本计划前先处理或确认现有 dirty state,不要覆盖未归属改动。

## 官方信号

- Anthropic Managed Agents 不是 Messages API 的薄封装,而是托管 agent harness + runtime,面向 long-running / async work。
- 核心资源是 Agent / Environment / Session / Events。Agent 放 model/system/tools/MCP/skills;Environment 决定 cloud/self-hosted sandbox;Session 是一次运行实例;Events 是用户、工具、状态流。
- Anthropic 工程博客明确把 system 拆成 session / harness / sandbox 三个稳定接口。实现可以换,接口不随 harness 细节漂移。
- Deployment 不是镜像发布。它是 session 启动模板:绑定 agent、environment、initial_events、vaults、memory stores、files/GitHub,可选 schedule。
- Scheduled deployment 需要初始 `user.message`,schedule 是 POSIX cron + IANA timezone,分钟级粒度,返回 `schedule.upcoming_runs_at`。
- 每次触发产生 `deployment_run`。成功 run 关联 `session_id`;失败 run 记录 `error.type`;run history 独立于 session lifecycle。
- 生命周期语义:pause 只停止后续 schedule,不影响已启动 session;manual run 在 paused 时仍允许;unpause 不补跑 missed trigger;archive terminal。

## Maple 当前形态

现状已经接近 Anthropic 的基础抽象:

- `CONTEXT.md` 已裁决 Control Plane / Runtime Plane / AgentRuntime / Sandbox / agent snapshot。
- `apps/control-plane-api/src/routes/deploymentRoutes.ts` 已有 `GET/POST /v1/deployments` 和 `POST /v1/deployments/:id/invoke`。
- `agent_deployments` 现在主要服务 CLI: `maple build && maple deploy` 把 `manifest` + `bundle` 写入部署记录,并创建 Agent + Environment。
- `invoke` 现在是临时创建 session、写一条 `user.message`、跑 `runUserMessage`。
- SDK/CLI 只暴露 `list/create/get/invoke`,没有 schedule、run history、pause/unpause/archive。

差距:

- 没有 `deployment_runs`。
- 没有 first-class `initial_events`。
- 没有 schedule / scheduler / due trigger / missed trigger 语义。
- 没有 manual `run` endpoint,只有 `invoke`。
- `listAgentDeployments(userId)` 仍按 user_id,需要按 workspace scoping 对齐 repo 规则。
- 没有 archived / paused_reason 语义。
- 没有 UI 的 Deployments 页和 run history。

## 设计裁决

### D1. Maple 的 Deployment 定义

Deployment = 可复用 session 启动模板。它引用一个 Agent 版本和 Environment,携带默认初始事件、Vault、Memory、Resources、Schedule。它不代表 veFaaS runtime revision,也不代表前端/后端发布。

保留当前 CLI `manifest/bundle` 能力,但把它视为 "create deployment from bundle" 的兼容入口。新 API 走 Anthropic-shaped deployment。

### D2. Deployment Run 定义

Deployment Run = 一次尝试启动 deployment 的事实记录。它可以成功创建 session,也可以在 session 创建前失败。run record 是调度器、CLI、UI 排障的主事实。

### D3. Scheduler 落点

MVP 放在 Control Plane API 进程内,用 DB lease 防重复触发。后续需要多实例/高可靠时,再拆独立 scheduler worker。

原因:当前 repo 已有 Express + MySQL sync adapter,没有队列系统。MVP 用 `setInterval` + atomic lease 最小变更可验证。

### D4. Cron 解析

新增 `cron-parser` 小依赖,不要手写 cron / DST / timezone。Anthropic 明确 cron 按 wall-clock 语义,手写风险高。

### D5. Scope 和权限

Deployment 是 workspace-scoped 资源。list 无 `workspace_id` 时必须使用 `accessibleWorkspaceIds(userId)` + `scopeByWorkspace(...)`,不能只按 creator `user_id`。

## 目标 API

保留:

- `GET /v1/deployments`
- `GET /v1/deployments/:deploymentId`
- `POST /v1/deployments`
- `POST /v1/deployments/:deploymentId/invoke` 作为 legacy alias

新增:

- `PATCH /v1/deployments/:deploymentId`
- `POST /v1/deployments/:deploymentId/run`
- `POST /v1/deployments/:deploymentId/pause`
- `POST /v1/deployments/:deploymentId/unpause`
- `POST /v1/deployments/:deploymentId/archive`
- `GET /v1/deployments/:deploymentId/runs`
- `GET /v1/deployment_runs/:runId`

`POST /v1/deployments` 支持两种 body:

```json
{
  "name": "Weekly compliance scan",
  "agent_id": "agent_xxx",
  "environment_id": "env_xxx",
  "initial_events": [
    {
      "type": "user.message",
      "content": [{ "type": "text", "text": "Run the weekly scan." }]
    }
  ],
  "vault_ids": ["vault_xxx"],
  "memory_store_ids": ["mem_xxx"],
  "resources": [],
  "schedule": {
    "type": "cron",
    "expression": "0 20 * * 5",
    "timezone": "America/New_York"
  },
  "workspace_id": "ws_xxx",
  "metadata": {}
}
```

Legacy body 继续支持:

```json
{
  "manifest": {},
  "bundle": {}
}
```

`POST /v1/deployments/:id/run`:

```json
{
  "initial_events": [
    {
      "type": "user.message",
      "content": [{ "type": "text", "text": "Manual smoke." }]
    }
  ],
  "trigger_context": { "type": "manual" }
}
```

## 数据模型

### Extend `agent_deployments`

新增列:

- `workspace_id TEXT`
- `tenant_id TEXT`
- `agent_version INTEGER`
- `initial_events_json TEXT NOT NULL DEFAULT '[]'`
- `vault_ids_json TEXT NOT NULL DEFAULT '[]'`
- `memory_store_ids_json TEXT NOT NULL DEFAULT '[]'`
- `resources_json TEXT NOT NULL DEFAULT '[]'`
- `schedule_json TEXT`
- `paused_reason_json TEXT`
- `archived_at TEXT`
- `last_run_at TEXT`
- `next_run_at TEXT`
- `scheduler_locked_until TEXT`
- `scheduler_locked_by TEXT`
- `metadata_json TEXT NOT NULL DEFAULT '{}'`

现有 `manifest_json` / `bundle_json` 保留。Anthropic-shaped deployment 可以把它们写成 `{}`。

索引:

- `idx_agent_deployments_workspace_created(workspace_id, created_at)`
- `idx_agent_deployments_schedule_due(status, next_run_at, scheduler_locked_until)`
- `idx_agent_deployments_agent(agent_id)`
- `idx_agent_deployments_environment(environment_id)`

### Add `deployment_runs`

```sql
CREATE TABLE IF NOT EXISTS deployment_runs (
  id TEXT PRIMARY KEY,
  deployment_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  tenant_id TEXT,
  trigger_context_json TEXT NOT NULL,
  scheduled_at TEXT,
  status TEXT NOT NULL,
  session_id TEXT,
  error_json TEXT,
  agent_snapshot_json TEXT NOT NULL,
  environment_snapshot_json TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(deployment_id) REFERENCES agent_deployments(id),
  FOREIGN KEY(session_id) REFERENCES sessions(id)
);
```

索引:

- `idx_deployment_runs_deployment_created(deployment_id, created_at)`
- `idx_deployment_runs_workspace_created(workspace_id, created_at)`
- `idx_deployment_runs_session(session_id)`
- `idx_deployment_runs_status(status, created_at)`

## 服务端实现任务

### Phase 0: 术语与 schema

- [ ] `CONTEXT.md`:新增 `Deployment` / `Deployment Run` / `Scheduled Deployment` 术语。
- [ ] `apps/control-plane-api/src/contracts/schemas.ts`:新增 `deploymentCreateSchema`, `deploymentPatchSchema`, `deploymentRunCreateSchema`, `deploymentScheduleSchema`, `deploymentInitialEventSchema`。
- [ ] `deploymentManifestSchema` 保持兼容,不要破坏 `maple deploy`。

验证:

- `bun run typecheck`

### Phase 1: 存储层

- [ ] `apps/control-plane-api/src/storage/storeSchema.ts`:补列 + 新表。
- [ ] `apps/control-plane-api/src/storage/storeInit.ts`:补老库迁移列,兼容 remote MySQL。
- [ ] `apps/control-plane-api/src/storage/storeHydrators.ts`:hydrate deployment schedule / initial_events / paused_reason / runs。
- [ ] `apps/control-plane-api/src/storage/storeModelsDeployments.ts`:拆出:
  - `createBundleDeployment(input)`
  - `createDeployment(input)`
  - `updateDeployment(id, input)`
  - `archiveDeployment(id)`
  - `listDeployments(workspaceIds | workspaceId)`
  - `createDeploymentRun(input)`
  - `updateDeploymentRun(id, input)`
  - `listDeploymentRuns(deploymentId, filters)`

验证:

- `bun run test:api-storage`
- 新增 `tests/contracts/deployment_schedule_contract.ts`

### Phase 2: Run 执行路径

- [ ] 新建 `apps/control-plane-api/src/deployments/runDeployment.ts`。
- [ ] 把当前 `invoke` 里的 create session + create event + bootstrap + `runUserMessage` 逻辑迁入 `runDeployment(...)`。
- [ ] `runDeployment(...)` 创建 `deployment_runs` 记录,成功后写 `session_id`,失败写 `error_json`。
- [ ] `invoke` 改成 thin alias:message -> one `user.message` -> `runDeployment`。
- [ ] Session metadata 写入:
  - `deployment_id`
  - `deployment_run_id`
  - `deployment_version`
  - `trigger_context`
  - `vault_ids`
  - `memory_store_ids`
  - `resources`

验证:

- `bun run test:platform-sdk-cli`
- `bun run test:api-storage`

### Phase 3: Scheduler

- [ ] 新建 `apps/control-plane-api/src/deployments/scheduler.ts`。
- [ ] 使用 `cron-parser` 计算 `next_run_at` 和 `upcoming_runs_at`。
- [ ] `startDeploymentScheduler()` 在 `index.ts` 注册一次,间隔默认 `MAPLE_DEPLOYMENT_SCHEDULER_INTERVAL_MS=10000`。
- [ ] 每次 tick:
  - 查询 `status='active' AND archived_at IS NULL AND schedule_json IS NOT NULL AND next_run_at <= now`
  - atomic lease `scheduler_locked_until`
  - 加 0-10s jitter
  - 创建 `deployment_runs`
  - 调 `runDeployment`
  - 计算下一次 `next_run_at`
- [ ] 失败语义:
  - environment/agent archived -> failed run + pause 或 archive,按错误类型区分
  - session rate limit -> failed run,不重试,下次 schedule 再触发
  - run 内部失败 -> session 事件流自带错误,run 记录 session_id

验证:

- `MAPLE_DEPLOYMENT_SCHEDULER_INTERVAL_MS=1000 bun tests/contracts/deployment_schedule_contract.ts`
- 覆盖 manual run、pause、unpause、archive、no backfill。

### Phase 4: API 路由

- [ ] `apps/control-plane-api/src/routes/deploymentRoutes.ts`:按 workspace scoping 重写 list/get 权限。
- [ ] `POST /v1/deployments`:legacy parser + Anthropic-shaped parser。
- [ ] `PATCH /v1/deployments/:id`:只允许可变字段,archive 后拒绝。
- [ ] `POST /pause`, `/unpause`, `/archive`, `/run`。
- [ ] `GET /runs` 和 `GET /v1/deployment_runs/:runId`。
- [ ] 错误码:
  - `deployment_not_found`
  - `deployment_archived`
  - `deployment_agent_or_environment_not_found`
  - `deployment_schedule_invalid`
  - `deployment_run_failed`

验证:

- `bun run typecheck`
- `bun run lint`
- `bun run test:api-storage`
- `bun run test:platform-sdk-cli`

### Phase 5: SDK / CLI

- [ ] `packages/sdk/index.mjs` / `.d.ts`:
  - `updateDeployment`
  - `runDeployment`
  - `pauseDeployment`
  - `unpauseDeployment`
  - `archiveDeployment`
  - `listDeploymentRuns`
- [ ] `packages/cli/cmd/platform_resources.go`:
  - `maple deployment run`
  - `maple deployment pause`
  - `maple deployment unpause`
  - `maple deployment archive`
  - `maple deployment runs`
- [ ] `packages/cli/cmd/deploy.go`:增加 `--schedule`, `--timezone`, `--message`, `--workspace` 可选参数,保持旧行为不破坏。

验证:

- `bun run test:platform-sdk-cli`
- `bun run test:npm-sdk`

### Phase 6: Admin Web

- [ ] 新建 `apps/admin-web/src/pages/deployments/DeploymentsView.tsx`。
- [ ] 列表显示 name/status/schedule/next_run_at/last_run_at/agent/environment。
- [ ] Detail Drawer 显示 initial_events、vault/memory/resource ids、upcoming runs、recent runs。
- [ ] 操作按钮:Run now / Pause / Unpause / Archive。
- [ ] Archive 走确认弹窗,因为 terminal。
- [ ] 失败 run 展示 `error.type` 和 `message`,成功 run 链到 session detail。
- [ ] `App.tsx` 只接入 view,不继续膨胀。

验证:

- `bun run typecheck`
- `bun run lint`
- `bun run build`
- Playwright 浏览器截图,覆盖 list/detail/run/pause/archive 文案和按钮状态。

## 验收标准

后端:

- Legacy `maple deploy --json` 仍返回 `deployment_id`, `agent_id`, `environment_id`。
- `POST /v1/deployments` 新 body 可创建 active deployment。
- `POST /v1/deployments/:id/run` 创建 `deployment_run` + `session`。
- Scheduled deployment 到点自动创建 run + session。
- pause 后 schedule 不触发;manual run 仍可触发。
- unpause 后从下一次 schedule 开始,不补跑。
- archive 后不可 patch/run/pause/unpause。
- list 不泄露其他 workspace deployment。

前端:

- Deployments 页可见 schedule、next run、last run、runs history。
- run now 后能跳转或打开对应 session。
- failure run 可看到 `error.type`。
- archive 操作有确认且 archived 后按钮禁用。

命令:

```bash
bun run typecheck
bun run lint
bun run test:api-storage
bun run test:platform-sdk-cli
bun run test:npm-sdk
bun run build
```

可选线上验收:

```bash
bun run deploy:vefaas:stable
bun run status:vefaas:stable
curl -fsS "$MAPLE_STABLE_BASE_URL/health"
curl -fsS "$MAPLE_STABLE_BASE_URL/v1/auth/providers"
```

## 风险与处理

| 风险 | 处理 |
|---|---|
| Cron/DST 语义复杂 | 使用 `cron-parser`,测试 UTC + Asia/Shanghai + America/New_York。 |
| API 进程多实例重复触发 | DB lease,所有 due trigger 必须 atomic claim。 |
| 当前 deployment list 按 user_id | 改 workspace scoping,保留 created_by_user_id 仅做审计。 |
| Legacy CLI 依赖 `manifest/bundle` | 双 parser,旧 contract 先跑再改。 |
| Schedule missed trigger | 明确不补跑,unpause 从 next occurrence 开始。 |
| archive 误操作 | UI 确认,API terminal 状态不可恢复。 |
| Scheduler 长任务阻塞 tick | tick 只 claim + fire async run,run 自己更新 run record。 |

## 推荐切分

1. PR1: schema + storage + runDeployment + manual run,无 scheduler。
2. PR2: scheduler + pause/unpause/archive + deployment_runs contract。
3. PR3: SDK/CLI commands。
4. PR4: Admin Web Deployments 页 + Playwright screenshot。
5. PR5: docs/guide + cloud stable deploy + online smoke。


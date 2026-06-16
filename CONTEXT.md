# Maple

Maple 是一个托管 Agent 控制面平台。这份文件裁决项目专属术语——同一概念多个叫法时选一个、其余列 `_Avoid_`。只收 Maple 特有概念,不收通用编程术语。架构全貌见 `docs/architecture/`,不在此重复。

## 平台面

**Control Plane**:
管资源、权限、配置归一、事件写入、密钥引用的服务面。代码在 `apps/control-plane-api`。不把用户任务硬编码进服务。
_Avoid_: backend, server(`server/` 目录已不存在,旧叫法)

**Runtime Plane**:
实际跑 Agent Loop 的执行面。与 Control Plane 解耦。
_Avoid_: worker plane, execution layer

**AgentRuntime**:
跑 Agent Loop 的地方("跑脑子")——读 agent snapshot、调模型、需要工具时回调 Control Plane。provider 可插拔(provider loop / vefaas runtime pool)。代码 `packages/runtime-*` + `apps/control-plane-api/src/runtime/*AgentRuntime.ts`。
_Avoid_: agent worker, executor, brain

**Sandbox**(SandboxRuntime):
跑工具的地方("跑手")——隔离命令、文件、包安装、MCP 副作用。provider:`e2b` / `vefaas`。与 AgentRuntime 分离,可独立组合。代码 `packages/sandbox-*`。
_Avoid_: container, executor, runner(runner 专指 runner.ts 的会话驱动)

**Runtime Pool** / **Pool Member**:
工作区开通时创建的 veFaaS runtime 实例池,描述目标容量与实际函数实例。表 `workspace_runtime_pools` / `workspace_runtime_pool_members`。member 开通中 `status='provisioning'`,失败 `failed`(degraded)。
_Avoid_: instance group, function pool

**Vault**:
凭证库。`vaults` 存元信息,`vault_credentials` 存凭证项,密文不进明文列:`secret_ref` 指向本地 secret store 文件,`secret_cipher` 存同一密文的 DB 副本(应对 veFaaS /tmp 非持久,见 ADR 0006)。读取走 `readCredentialSecret`(cipher 优先,回退文件)。MCP OAuth 凭据当前是 workspace 共享(非 per-user,见 ADR 0005)。
_Avoid_: credential store, keychain, secret manager

**Builder Agent**:
Quickstart 背后的系统 Agent,把用户自然语言需求变成 agent draft 再落地成可运行 Agent。代码 `agents/super-agent` + `apps/control-plane-api/src/agents/builderAgent.ts`。
_Avoid_: quickstart agent, wizard agent

**AskMaple**:
session 内上下文问答助手,读 detail/events/tool_calls/artifacts 回答"现在在干啥/为何失败"。
_Avoid_: session assistant, debug bot

## 数据与事件

**事件即事实**(event-as-truth):
所有会话沉淀到 `session_events` / `tool_calls` / `session_artifacts`;Console、SDK、CLI、Skill 看同一条事件流。这是核心设计原则,不是某个模块。

**workspace scoping**:
list/auth 端点必须按用户可访问工作区过滤——用 `accessibleWorkspaceIds(userId)` + `scopeByWorkspace(...)`。无 `workspace_id` 的 list 端点必须过滤到 member 工作区,绝不返回全表。散在 `apps/control-plane-api/src/routes/*Routes.ts`。
_Avoid_: tenant filter, access filter, permission scope

**资源层级**:
`tenants → workspaces → (agents / environments / sessions / vaults / memory_stores / runtime pools)`。`workspace_members` 控访问,`tenant_members` 控租户管理权。这是资源边界,新功能优先用 workspace/tenant scope,不引全局游离资源。

**agent snapshot**:
建 session 时把 Agent 当前版本 + Environment 当前配置快照进 session。Agent/Environment 后续改动不影响已存在 session 的可追溯性。
_Avoid_: agent config copy, frozen config

## 基建怪点(看代码会困惑的)

**MySQL sync-adapter**:
`db` 暴露**同步** better-sqlite3 风格 API(`db.prepare(sql).get/all/run`),但后端是**远程 MySQL,不是 sqlite**。同步 API 由常驻 worker thread(mysql2 池)+ `Atomics.wait`(SharedArrayBuffer)桥接。`.managed-agents/platform.sqlite` 是废弃旧库,忽略。决策见 ADR-0001。代码 `apps/control-plane-api/src/infra/mysql.ts` + `apps/control-plane-api/src/infra/mysql_worker.mjs`。
_Avoid_: sqlite, the database(要明确"remote MySQL over worker")

**onboarding lock**:
用户无工作区时,左侧导航 + 工作区切换器 `disabled`(provisioning 必须先完成)。表单状态持久化到 `localStorage`(`maple_onboarding_<userId>`,排除 secret)。
_Avoid_: provisioning gate, setup lock

**vefaas 流式契约**:
veFaaS runtime turn 进行中逐事件 POST `loop_events`;`streamed_count` = 回调成功条数,必须是 events 数组的干净前缀(首次失败即永久降级);control plane 累积 delta 成全文再落 `agent.message_delta`。改任一侧必须同步另一侧。决策/契约见 `docs/architecture/` 与 memory。代码 `apps/control-plane-api/src/runtime/runner.ts` + `infra/vefaas/runtime-app/runner_pool.py`。
_Avoid_: streaming protocol(要说"loop_events 回调契约")

## 架构术语(供 `/improve-codebase-architecture` 使用)

谈架构友点/重构时用这套词,别漂移到 "component/service/boundary"。

**Module**:有接口 + 实现的任意东西(函数、类、包、切片)。
**Interface**:调用方必须知道的一切——类型、不变量、错误模式、顺序、配置。不只是类型签名。
**Implementation**:模块内部代码。
**Depth**:接口处的杠杆。**Deep** = 小接口背后大量行为;**Shallow** = 接口几乎和实现一样复杂。
**Seam**:接口所在处——可不改原地就改变行为的点。用这个词,不用 "boundary"。
**Adapter**:在 seam 处满足某接口的具体物。
**Locality**:深度给维护者的回报——变更、bug、知识集中在一处。
**deletion test**:设想删掉某模块。复杂度消失 = 它是 pass-through;复杂度在 N 个调用方重现 = 它在挣钱(值得留)。

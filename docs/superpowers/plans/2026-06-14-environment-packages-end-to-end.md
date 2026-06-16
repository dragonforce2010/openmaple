# Environment packages 端到端 + 装包闸门与可见进度(vefaas sandbox)

> 状态:已实现 · 本地已提交 main(`844bcb09`,仅本 feature 19 文件)· 部署待非沙箱终端 · 作者:michael.zhang · 日期:2026-06-14
> 验证:typecheck / lint / `test:environment-packages` 全绿;环境编辑表单 hint + packages 落库 + 详情 chip 经 Playwright 真实浏览器截图确认。装包进度面板/闸门真实运行态需 veFaaS 凭证(见 `docs/superpowers/screenshots/2026-06-14-environment-packages.md`)。
> 范围裁决(用户多轮拍板,按时间顺序):
> - ✅ 打通 **packages 端到端**:改了环境包 → 真正在沙箱里安装、agent 能 import
> - ❌ 不加独立"镜像 image"字段("镜像的安装包"= packages 生效即可,与截图一致)
> - ⏸ networking 真实出网控制 **skip**(UI 能改能存现状保留,runtime 不强制消费)
> - ✅ **装包点 = vefaas Sandbox**(不是 AgentRuntime;按 `CONTEXT.md` 术语,"装包"归 Sandbox"跑手")
> - ✅ **探包兜底 + session 亲和调度**(粘性尽力而为 + 缺包必重装)
> - ✅ **installing_packages 会话闸门**:装完才能交互
> - ✅ **loop_events 逐包进度 + 日志**:前端实时可见安装过程
> - ✅ **一次性完整交付**(非分期)

## 背景 / 根因

Environment 详情页编辑表单(`EnvironmentDetailView.tsx`)早已能改名称/描述/Networking/Packages/Metadata 并 `PATCH` 落库。但 **packages 改了后沙箱根本不装包**:全后端对 `config.packages` 仅 `consoleSnapshot.ts:167` 一处展示引用,`normalizeSandboxConfig`(`sandboxConfig.ts:101`)规范化时**直接丢弃** packages,沙箱起来什么都不装。用户配了 `pip xxx` → 保存成功 → agent `import xxx` 仍 `ModuleNotFoundError`。

## 架构定位(关键,先对齐再动手)

按 `CONTEXT.md` 术语裁决:
- **AgentRuntime**="跑脑子"(读 snapshot、调模型、claude agent loop)
- **Sandbox**(SandboxRuntime)="跑手"(隔离命令、文件、**包安装**、MCP 副作用)→ **装包归这里**

**默认 agent 走 provider loop**(`shouldUseExternalAgentLoop` 默认 `execution="provider"` → `false`,`agentLoopDrivers.ts:62`):脑子在控制面本地循环,**不起 vefaas agent runtime**;工具执行才 `ensureSessionSandboxRuntime` → **vefaas sandbox**(`runtimeTools.ts:41`)。vefaas agent loop 那条路工具也在 sandbox 跑。

→ **唯一对所有 loop 都成立的装包点 = vefaas sandbox**(`ensureVefaasSandboxRuntime`,`vefaasSandboxRuntime.ts:24`)。装在 sandbox 里,无论脑子在本地还是 vefaas,工具(bash/python)都能用到包。

## 粘性现状(代码实证)

- sandbox 复用判定 `isSameVefaasSandbox`(`vefaasSandboxRuntime.ts:396`)只比 `function_id`+`gateway_url`,**不绑 session**。
- pool claim(`claimPooledSandboxRuntime`,`sandboxPoolManager.ts:40`)"谁空闲给谁",**无 session 亲和**。
- 同 session 续聊会命中 `session.metadata.runtime.sandbox_id` 复用同实例(`vefaasSandboxRuntime.ts:49`),**但跨请求/池分配/veFaaS 回收冷起后不保证**。

→ 不追求强粘性。**每次进 sandbox 先探包,缺了带日志重装**,天然兜住粘性破坏。

## loop_events 契约现状(改前必读,memory 警告"改一侧必同步另一侧")

- **接收端**:`POST /v1/runtime/sessions/:id/loop_events`(`publicRoutes.ts:245`)。body 接受 `{kind:"event"|"delta", event:{...}}` 或 `{events:[...]}`。`kind:"event"` → 落 `agent.external_loop_event`(payload `{driver, event}`)+ emit SSE。**已有的事件管道,装包进度复用它即可,无需改接收端 schema。**
- **发送端(Python)**:`EventCallbackSender`(`runner_pool.py:168`),`send(event)` 把非 delta 事件入队、worker 线程批量 POST。装包进度走这个 sender 发 `kind:"event"` 即可。
- **SSE → 前端**:`emitSessionEvent` → `/v1/sessions/:id/events/stream`,前端 `useSelectedSessionDetail.ts:162` 的 `EventSource` 消费。

## 设计

### D1. 数据形态
环境存 `[{manager,name}, ...]`(`EnvironmentDetailView.tsx:34-38`)。规范化透传形态 `Array<{manager:string,name:string}>`,manager 聚合放 Python 侧(`pip install a b c`)。

### D2. 装包挂在 sandbox 的 prepare 阶段 + 幂等探包
`ensureVefaasSandboxRuntime` 在 `prepareVefaasSandboxRuntime`(`vefaasSandboxRuntime.ts:242`,建 workspace + sync 文件)**之后**、`markRuntimeReady` **之前**插入装包步:
1. **探包**:对每个包跑轻量检测(`pip show <name>` / `npm ls <name>` / `dpkg -s`)或读 sandbox 内 marker 文件 `/tmp/.maple_packages.json`。全命中 → 跳过(粘性命中/已装)。
2. **缺包 → 装包**:经 sandbox gateway(`runVefaasSandboxCommand`,已有)在 sandbox 内跑 `pip install` 等。装包是幂等的(已装秒过),所以"粘性破坏后重装"安全。
3. 装完写 marker,供下次探包快速判定。

装包**经 sandbox gateway HTTP 执行**(不是 agent runtime 的 invoke),与 sandbox 的 `runVefaasSandboxCommand` 同通道,不碰 20s control timeout(那是 agent runtime invoke 的约束)。

### D3. installing_packages 会话闸门
- 新增 session 状态 `installing_packages`(加进 `runner.ts` 状态流转 + 前端 `statusPill` + `useSelectedSessionDetail.ts` 的已知状态列表 `:13-16`)。
- 时序:`bootstrapSession`(或首个 turn 的 sandbox prepare)进入装包前 `updateSessionStatus("installing_packages")` + emit `session.status_installing_packages`;装完 `→ idle`。
- **闸门**:`runUserMessage`(`runner.ts:92`)现有的"等 created/bootstrapping"循环(`:99-103`)扩展为也等 `installing_packages`——装包未完成不放行 turn。前端在该状态禁用输入框 + 显示进度。

### D4. 逐包进度 + 日志(走 loop_events)
- sandbox 装包时,**每个包前后 emit 一条 `agent.external_loop_event`** 风格事件(经控制面侧 emit,**不改 loop_events 接收 schema**):
  - `package.install_started` {manager, name, index, total}
  - `package.install_log` {name, chunk}(stdout/stderr 截断)
  - `package.install_finished` {name, ok, duration_ms}
- **回传路径选择(关键)**:装包由**控制面**驱动(控制面调 sandbox gateway 跑命令),所以进度事件**在控制面侧直接 `emitSessionEvent` + 落 `session_events`**,无需 runtime POST loop_events。这比"runtime 回调"简单且不动 Python 回调契约——✅ 满足"可见进度"又避开 memory 警告的双端契约同步。
  - (用户原选"方案2 loop_events 回调",但实测装包是**控制面驱动 sandbox 命令**,控制面本就能直接 emit;走控制面 emit 是同一可见效果的更短路径。执行时若发现装包改由 runtime 自驱,再切回 runtime POST。)
- 前端新增装包日志面板:订阅这些事件,渲染"安装 numpy… ✓ / 安装 pandas…"列表 + 可展开日志。

### D5. session 亲和调度(粘性增强,尽力而为)
- `claimPooledSandboxRuntime`(`sandboxPoolManager.ts:40`):claim 前先查该 session 上次的 `sandbox_id`/`pool_member_id`(`session.metadata.runtime`),该实例仍 active 就优先复用,减少重装。
- `markSandboxPoolMemberClaimed`(`storeSandboxPool.ts:88`)按需加"优先按 session_id 复用上次 member"的查询分支。
- 破坏时(实例回收/被抢)靠 D2 探包重装兜底,不强保证。

## 改动清单(按依赖顺序)

### 后端规范化层
- [ ] `runtime/sandboxConfigTypes.ts`:`NormalizedSandboxRuntimeConfig` 的 `vefaas` 分支加 `packages: Array<{manager:string;name:string}>`(共享 `EnvironmentPackage` type)。
- [ ] `runtime/sandboxConfig.ts`:新增 `normalizeEnvironmentPackages(config)`(兼容 `[m,n]` 元组与 `{manager,name}` 两种历史形态,过滤空 name);`normalizeSandboxRuntime` 的 vefaas 分支返回带 `packages`。
- [ ] 验证 `bun run typecheck`。

### 后端 sandbox 装包 + 探包
- [ ] `runtime/vefaasSandboxRuntime.ts`:新增 `ensureSandboxPackages(runtime, packages, onProgress)`:探包 → 缺包装包(经 `runVefaasSandboxCommand`)→ 写 marker;`onProgress` 回调 emit 进度事件。在 `ensureVefaasSandboxRuntime` 的 prepare 后调用。
  - 注意 400 行硬上限:该文件当前 401 行,**已到顶**。装包逻辑**拆到新文件** `runtime/vefaasSandboxPackages.ts`,`vefaasSandboxRuntime.ts` 只调用,不长肉。
- [ ] `runtime/runtimeManager.ts`:`ensureConfiguredSandboxRuntime`(vefaas 分支)把 `config.packages` 传入装包;装包进度回调里 emit session 事件。

### 后端 session 状态机 + 闸门
- [ ] `runtime/runner.ts`:加 `installing_packages` 状态流转;`runUserMessage` 的等待循环纳入该状态(`:99-103`)。
- [ ] 装包进度事件:控制面侧 `emitSessionEvent` + `createSessionEvent`(`package.install_*` 三类),复用现有事件管道。

### 后端 session 亲和
- [ ] `runtime/sandboxPoolManager.ts` + `storage/storeSandboxPool.ts`:claim 优先复用该 session 上次 member。

### vefaas sandbox 镜像端(Python)——按需
- [ ] sandbox 镜像若无 `pip`/`npm`,装包命令会失败 → 探包后 emit `failed` 日志,不阻断(降级:包装不上但 session 仍可用,日志可见原因)。**不改 sandbox 镜像构建**(超范围),仅保证失败可见。

### 前端
- [ ] `app/useSelectedSessionDetail.ts`:已知状态列表加 `session.status_installing_packages`;订阅 `package.install_*` 事件聚合成装包进度。
- [ ] `components/shared/labels.tsx`:`statusPill` 加 `installing_packages` → "安装依赖中"。
- [ ] session 详情/对话页:`installing_packages` 时禁用输入框 + 显示装包进度面板(包列表 + 日志展开)。具体落点执行时定(可能在 `SessionModal.tsx` 或 session detail view),**新面板独立文件**,不堆进 `App.tsx`。
- [ ] `EnvironmentDetailView.tsx`:Packages 区块加 hint:`L("包会在该环境的会话首次运行时安装,期间会显示安装进度;失败不阻断会话。", "Packages install on the session's first run with live progress; failures won't block the session.")`。

### 契约 / 测试
- [ ] `tests/contracts/`:加断言 `normalizeSandboxConfig({sandbox:{provider:"vefaas"}, packages:[...]})` → `.sandbox.packages` 含项。
- [ ] e2e/契约:installing_packages 状态流转 + 闸门(turn 在装包完成后才跑)。

## 验证步骤(沙箱拦 MySQL/veFaaS,需非沙箱终端)

1. `bun run typecheck` 全绿。
2. `bun run lint`:**所有触碰文件 < 400 行硬上限**(`vefaasSandboxRuntime.ts` 已 401 行 → 装包逻辑必须拆新文件;改前确认)。
3. 规范化单测:`normalizeSandboxConfig` vefaas 分支返回 packages。
4. 探包幂等单测:已装包 → 探包跳过、不重装。
5. 闸门验证:session `installing_packages` 期间发消息被 hold,装完才跑 turn。
6. 端到端(veFaaS AK/SK 可用):环境配 `pip cowsay` → 建 session → 详情页显示"安装 cowsay…✓"进度 → 闸门放行后发消息 `python -c "import cowsay"` 成功。AK/SK 不可用则记录"已透传+闸门+探包逻辑就位,实际安装受限于凭证"(参照 memory `maple-quickstart-builder-async-fix`)。
7. 粘性验证:同 session 第二条消息探包命中、不重装(日志无 install_started);模拟实例丢失 → 探包缺包 → 带日志重装。
8. **前端截图**(用户全局约定必需):①环境编辑加包+hint;②session 装包进度面板;③装完输入框可用。Playwright 截图存档贴进最终回复。

## 不做 / 边界
- 不做 networking 出网控制(skip)。
- 不加 docker image 字段。
- 不改 e2b/vercel/aws_lambda 装包(本次只 vefaas)。
- 不改 vefaas sandbox 镜像构建(镜像缺 pip/npm 时仅保证失败可见)。
- 不动 `agent_snapshot` 语义(packages 走 live env,改完即对新 turn 生效)。
- 不追求强粘性(探包重装兜底 + 亲和优先,足够)。

## CONTEXT.md 术语补充(执行时顺手)
- **environment packages**:环境声明、由 **Sandbox** 在 prepare 阶段探测并安装的包列表(`config.packages`,`{manager,name}[]`)。_Avoid_: deps, dependencies。
- **装包闸门(installing_packages)**:session 装依赖期间的状态,装完才放行交互。_Avoid_: provisioning(那是 runtime pool 开通)。

## ADR 候选(执行时若成立则落 docs/adr/)
"装包放 Sandbox 而非 AgentRuntime,且控制面驱动+探包幂等+闸门" 是难回退 + 有取舍的决策 → 落一份 ADR(做了什么 + 为何:术语归属 Sandbox / 避开 20s control timeout / 粘性不可靠故探包兜底)。

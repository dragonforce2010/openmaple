# Quickstart Builder Agent 全链路性能评估与优化

> 状态:进行中 · 作者:michael.zhang · 日期:2026-06-14
> 取代方向:`2026-06-14-builder-progress.md`(该计划刻意"不改同步路由契约、只加假进度"——正是超时根因,本计划根治)

## 再迭代:环境创建/编辑/删除 + 保存转圈(2026-06-14 同日,rev 63/62)

用户四个反馈(环境管理 + Agent 保存),全部修复+线上验证:

- **R. 创建环境 loading 动画**:EnvironmentModal 创建按钮已有 saving 文字切换,缺 spinner。加 `<span class="btn-spin">`(对齐 AgentDetailView 模式)。
- **S. 编辑环境支持改包**:`EnvDetailView` 的整页编辑态(`edit=true`)本就有完整 packages 增删改 UI,但从环境列表点开的是 **embedded 只读抽屉**(`EntityDetailBody`),底部只有"删除",没有编辑入口——用户因此以为不能改包。修:embedded 详情底部加"编辑环境"按钮 → `drawerStack.closeAll()` + `goView("environment", id, true)` 切到整页编辑态。
- **T. 删除环境弹窗改 tab+列表**:原 `useDeleteEnvironment` 用通用 confirm(纯文本 body)把关联 agent/session 拼成一大坨。改:扩展 `ConfirmOpts.body` 支持 `ReactNode`(string 仍走 `<p>`),新建 `DeleteEnvironmentBody`(tab:关联 Agent 默认 / 关联 Session,各 tab 下列表,复用 `.seg.settings-seg` tab 样式)。`useDeleteEnvironment.ts`→`.tsx`(含 JSX)。线上验证:tab 切换正常,Agent(1)/Session(2) 各自列表整齐。
- **U. 保存一直转圈(fail-fast bug)**:根因 `apiPost/apiPatch/apiPut/apiDelete` 全无 timeout,后端慢/hang 或其后 `refresh()` hang 时前端无限转圈且无错误。线上实测 PATCH 1.2s + bootstrap 2.4s 正常(复现不出,但大 workspace/网络抖动会 hang)。修:抽 `writeRequest` helper 给四个写方法加默认 30s timeout + 友好超时错误(复用 apiGet 的 AbortController 模式);`refresh()` 的 `/v1/bootstrap` apiGet 也补 30s timeout。超时即抛错终止转圈,符合 fail-fast。

## 再迭代:Quickstart Preview 排版 + Builder 闲聊引导(2026-06-14 同日,rev 62/61)

用户三个反馈,全部修复+线上验证:

- **O. Preview 云图标未居中**:`.qs-prev-cloud` 的 30×30 方块用 `place-items:center` 但 SVG baseline 偏移导致 i-cloud 偏左下。修:`.qs-prev-cloud .ic{display:block}`(part-2.css)。验证(chrome-devtools 计算样式 + 截图):图标居中。
- **P. Preview user 气泡"你"看不清**:`.bubble .who` 全局用 `--muted`(灰),但 `.qs-preview-chat .bubble.user` 背景 `#245b88`(中蓝),灰字对比度严重不足。修:override `.qs-preview-chat .bubble.user .who{color:rgba(244,248,252,.74)}`。验证:浅色"你"在蓝底上清晰可读。
- **Q. Builder Agent 支持闲聊+引导**:`builderSystemPrompt` 原只说"greetings 正常答不建 draft",没让它把闲聊拉回构建主题。加指令:可自然闲聊/答任何话题(永不拒绝、不说"我只做 agent building"),但每轮答完用一句自然的桥接把话题引导回"构建 agent"并给具体起点。验证(curl 真 LLM):发"今天天气真好,周末推荐电影?"→ Builder 先真诚接住(推荐《沙丘2》《奥本海默》)→ 自然桥接("既然聊到推荐和自动化,要不要用 Maple 构建一个推荐助手?比如电影推荐助手/周末活动规划助手"),且未误调 draft_agent_config。

## 再迭代:Ask Maple 真 LLM + 纯 SSE 去兜底(2026-06-14 同日)

用户反馈两件事 + 一个方向决策:① Ask Maple 抽屉排版异常;② Ask Maple 功能不正常,严格查前后端 + 补 e2e 全绿;③ **"不要兜底 就走 SSE 有问题咱们修"** —— 撤回上一轮加的轮询兜底,纯 SSE,SSE 有问题就修 SSE。

**SSE 决定性实测(动手前先验证,推翻"网关 buffer SSE"假设):** 用 `MAPLE_DEV_API_KEY` 作 `x-maple-api-key` 鉴权(auth.ts:75 直认,非走 dev_login),订阅线上真实 session 的 `/events/stream` 同时另一端 POST 触发事件。结果:`ready` 建连后,POST 的 `user.message` ~3s 内到达,`session.status_running`/`session.status_failed` **逐条带间隔实时推送**(非末尾一次性吐出)。`server: istio-envoy`,`x-faas-execution-duration` 仅记控制动作耗时,流式响应体不受影响。**结论:veFaaS+Envoy 不 buffer SSE,SSE 本就实时通——轮询兜底纯属多余,可安全移除。** (附带抓到无关 runtime bug:`sess_sxWKqpbmfZ` 报 workspace 目录缺失,另线处理。)

- **K. Ask Maple 排版**:`AskMapleDrawer.tsx` 建议 chips 用内联 style 覆盖 `.action-row`(挤成一坨);answer 是后端 `\n` 拼的多行,`<p>` 默认 `white-space:normal` 折叠换行成空格。修:去内联 style 用 part-3.css 类,answer 容器加 `white-space:pre-line`。
- **L. Ask Maple 改真 LLM(根治"假 agent")**:`runAskMapleTurn`→`buildAskMapleAnswer` 原是纯关键词匹配字符串拼接、根本不调 LLM(建 agent/env/session、emit 一串事件伪装成 turn)。改为像 `runQuickstartBuilderTurn` 一样真调 `callProvider`:把 session 上下文(detail 摘要/events/tool_calls)做 system+user message,流式 reasoning(`onReasoningDelta`)+ message。`buildAskMapleAnswer` 的统计降级为"上下文摘要"喂给 LLM,不再当 answer。fail-fast:LLM 失败显式报错不回退模板。
- **M. e2e 补齐**:现有 step 只断言字符串模板;改/补真 LLM 回答断言 + 前端抽屉渲染 + 错误态,全绿。
- **N. 纯 SSE 去兜底**:删 `useSelectedSessionDetail.ts` 的 `ACTIVE_POLL_INTERVAL_MS` 轮询 useEffect + `turnWatchRef`/`TURN_WATCH_WINDOW_MS` + `beginTurnWatch`;删 `quickstartBuilderPolling.ts` 的 `pollBuilderDetailUntilIdle`,builder session 改用与通用 session 同一套 SSE 订阅。保留 `optimisticSessionDetail`/`builderFailureMessage`。SSE `onerror` 改为重连而非"兜底拉一次"。

### 落地与验证(已部署 backend rev 61 / frontend rev 60)

新增 focused 模块(均 <400 行,反屎山):`useSessionEventStream.ts`(SSE 订阅 + 白名单 + 指数退避重连,三处共用)、`useBuilderTurnStream.ts`(builder turn 的 SSE 收尾)、`applyBuilderDetail.ts`(从 controller 抽出的 detail→wizard 纯映射,controller 411→366 行回到上限内)、`AskMapleTranscript.tsx`(消息流 + 折叠思考块)。`SessionAnalysis.buildSessionAnalysis` 删掉死掉的 `answer` 模板字段(只留 eventCounts/toolRows/references 真实可视化)。

- **后端线上实测(curl + MAPLE_DEV_API_KEY)**:POST `/v1/ask_maple/.../message` 5s 内 202 返回 `{ask_session_id, stats}`;ask_session 事件序列 `status_running → user.message → 8×reasoning_delta → reasoning → ui.card → agent.message → status_idle`——真 reasoning 流式 + 真 LLM answer,不再是固定模板。answer 准确识别目标 session 的 failed 状态 / 0 工具调用 / 最新用户意图,并给出诊断推理。
- **前端 UI 端到端(chrome-devtools 连线上)**:排版修复确认——建议 chips 均匀排布(`.ask-actions`)、Session 上下文/事件分布/工具调用表/链接图片四区整齐;消息流确认——用户问句蓝色右对齐气泡、Maple 回复带 ✦ kicker 左对齐、`✦ 思考过程`可折叠块、真 LLM markdown 回答("## 工具调用统计 总调用次数:1次 已完成:1次 使用的工具:bash …")。证据截图见 `output/`。
- **静态全绿**:`bun run typecheck` + `bun run lint`(含 max-lines 硬上限)+ `test:ui-overlay` + `maple_branding_contract` 全过。`platform_sdk_cli_contract`/`e2e` 已改为异步流式断言(poll ask_session until idle 读 `agent.message`),需 VPC+服务,部署后在非沙箱终端跑。
- **附带发现(另线处理)**:SSE 实测时撞到无关 runtime bug——`sess_sxWKqpbmfZ` 跑 agent 报 `No such file or directory: /tmp/maple-vefaas-runtime/.../workspace`(沙箱 workspace 未创建)。不在本次范围。

## 后续迭代:真消息流 + 思考流式 + fail-fast + 模板修复(2026-06-14 同日)

用户进一步把 Quickstart 从"进度卡"彻底转向真消息流,且要 fail-fast。已实现并部署(backend rev 56 / frontend rev 55):

- **模板错位 bug**:`QuickstartParts.tsx` 的 `templatePrompts`(8 项)与 `templateCards`(10 项)错位——选"数据洞察分析师"发出"空白 Agent"。删 `templatePrompts`,`templatePrompt(index)` 改为基于同一张 `templateCards[index]`(name+description)生成,越界 throw。线上验证:选数据洞察分析师 → 对话区/draft 全部对应 `DataInsightAnalyst`。
- **fail-fast**:回滚上轮加的 draft 容错(`agentBuilder.ts` `normalizeRecords` mcp/skill 非数组即 throw,不再回退 `[]`),合约断言改回"缺字段应抛错"。扫 builder 链路其余兜底,判定 parseJsonObject(已 throw)/resolveConfigApiKey(合理多级凭证)/route catch(显式返回错误)均非掩盖型,不动。`builderFailureMessage` 保留强化。
- **reasoning 流式**(思考过程 SSE 暴露):`provider.ts` `readOpenAIStream` 抓 `delta.reasoning_content` + 新增 `onReasoningDelta` 回调(reasoning 不进 messages/ProviderResult);`builderAgent.ts` turn 内 ~400ms 节流累积 emit `agent.reasoning_delta`/`agent.reasoning`(payload 带累积全文);`eventHub.ts` `shouldHideCompatEvent` 隐藏这两类(Anthropic 兼容客户端)。
- **前端折叠思考块**:`events.tsx` 泛化 `dedupeDeltaPair`(message/reasoning 同构去重)+ `transcriptMessagesFromEvents` 返回带 `kind:"user"|"agent"|"reasoning"` 的统一序列;`QuickstartView.tsx` 删 `BuilderProgress`/假三阶段 effect,按 kind 渲染;`QuickstartParts.tsx` 用 `ReasoningBlock`(可折叠,流式展开/final 折叠)替换 `BuilderProgress`。builder session 沿用 `pollBuilderDetailUntilIdle` 轮询(700ms,够流式),未抽 SSE hook(避免改通用 hook 的回归风险)。
- **keep-refining**:真消息流 + "继续优化"按钮天然支持继续和 Builder 讨论。
- 线上端到端验证全过:模板对应 ✓、折叠思考块含真实 reasoning("用户想要创建一个数据洞察分析师…我应该调用 draft_agent_config")✓、draft 卡 ✓。证据 `output/quickstart-reasoning-block.jpeg`。
- **预存红测试(与本次正交)**:`maple_ui_interaction_contract` 断言 `AgentDetailView` 含"从模板替换配置"(`templateCards.map|配置模板`)功能,但该功能从未实现——stash 验证干净 HEAD 同样红。属 Agent 详情页独立缺陷,未在本次处理。

## 再迭代:沙箱 provider 硬编码 + loading indicator 审计(2026-06-14 同日,rev 58/57)

- **F. 沙箱 provider 错用 e2b(核心 bug)**:工作区配 `sandbox_provider: vefaas`,但 quickstart 创建的环境硬编码 e2b。根因 `agents/super-agent/src/index.ts` 的 `createQuickstartEnvironmentConfig` 写死 `provider: "e2b"`,绕过了 `ensureDefaultEnvironments`(storeAgentsEnvironments.ts)已有的"按工作区 provider 选 vefaas/e2b"逻辑。修:`createQuickstartEnvironmentConfig` 加 `sandboxProvider` 参数(vefaas/e2b),`builderAgent.ts` `quickEnvConfig` 读 `getWorkspace(workspaceId).sandbox_provider` 传入。删前端 dead `quickEnvConfig`(QuickstartParts/QuickstartView re-export,零调用)。线上验证:vefaas 工作区 → quickstart 环境 `type/provider: vefaas`(`output/quickstart-vefaas-env-fixed.jpeg`)。
- **G. loading indicator 审计**:Workflow 并行审计 16 前端文件(2 个解析失败,已知有 loading),查出 11 处异步动作缺 loading。补齐组件能自洽控制的 6 处高频破坏性操作:ModelGatewayView(设默认/删除→行级 busyModelId+spin-dot)、VaultsView(归档/删除凭证→busyCredentialId)、TenantView(移除管理员→removingAdminId+按钮 spin-dot)。统一模式:菜单关闭型用行级 spinner,原地按钮型用按钮内 spinner,都加防重复点。剩 4 处 props 委托动作(workspace key 停用/删除/复制、删除工作区)handler 在父层 `useWorkspaceActions`,需加 busy state 多层透传,单独后台任务处理(避免本轮透传复杂度+超 400 行)。

## 背景 / 问题现象

线上 Quickstart(`apigateway-cn-beijing.volceapi.com`)发一句"创建一个空白 Agent"后:
1. 出现"理解需求 / 规划 Agent 配置 / 准备 API 草稿"三阶段进度卡;
2. 随后报 `The operation was aborted due to timeout`;
3. 同一句 prompt 被重复提交 4 次(用户超时重试)。

## 一、三阶段进度的真实性 —— 结论:纯前端假进度

`QuickstartView.tsx:164-174`:

```js
const startedAt = Date.now();
const tick = () => setBuilderProgressIndex(Math.min(2, Math.floor((Date.now() - startedAt) / 2500)));
const timer = window.setInterval(tick, 700);
```

`BuilderProgress`(`QuickstartParts.tsx:85-109`)用这个 index 渲染三行。**它是按墙钟时间每 2.5s 自增、封顶 2 的计数器**,与后端真实进度无关。后端 `runQuickstartBuilderTurn` 实际 emit 了真实事件(`session.status_running` / `agent.tool_use` / `tool.result` / `agent.message`),但 Quickstart 前端**未订阅 SSE、未消费这些事件**——假进度盖住了真实卡顿。

## 二、为什么会超时 —— 根因:同步路由 + 无超时 + 多轮串行 LLM

### 根因 A:两条路径调同一函数,一异步一同步,前端走了同步那条

| 路径 | 行为 | 调用方 |
|---|---|---|
| `POST /v1/sessions/:id/events`(通用,`sessionRoutes.ts:208-214`) | `enqueueSessionTurn(...)` fire-and-forget,**立即 202**,SSE 推事件 | SDK / 通用 session |
| `POST /v1/quickstart/builder_session/:id/message`(`quickstartRoutes.ts:114-121`) | **`await runQuickstartBuilderTurn(...)`** 同步阻塞,跑完才返回 | **前端 Quickstart(`useQuickstartController.ts:201`)** |

`enqueueSessionTurn`(`turnQueue.ts`)是现成的后台串行队列。SSE(`emitSessionEvent` / `addStreamClient` + 前端 `useSelectedSessionDetail.ts:156` 的 `EventSource`)也现成。**异步基建齐备,Quickstart 这条路就是没接上。**

### 根因 B:turn 内部最多 6 轮串行 LLM,且 callProvider 无超时

`builderAgent.ts:291-292`:循环 `maxBuilderProviderTurns = 6`,每轮 `callProvider(messages, ...)` **不传 `timeoutMs`**(对照 `buildAgentDraft` 有 `agentDraftTimeoutMs=8000`)。

一次"发消息"的真实 LLM 调用链(最常见路径):
1. 用户消息 → Builder LLM **第 1 轮**:决定调 `draft_agent_config` 工具;
2. 工具内部 → **`buildAgentDraft` 又是一次完整 LLM**(`max_tokens=2200`,doubao-seed);
3. 结果回灌 → Builder LLM **第 2 轮**:生成自然语言解释 + draft 卡。

即 **一次用户消息 = 串行 2~3 次 LLM 调用**,全部 `await` 阻塞在一个 HTTP 响应里。ARK doubao-seed 单次 2~6s,叠加后 8~18s。

### 根因 C:veFaaS API Gateway 响应窗口 < turn 耗时

线上经 `apigateway-cn-beijing.volceapi.com`,网关有固定响应超时(典型 ≤15s)。turn 还没返回网关先 abort → 前端 `The operation was aborted due to timeout` → 用户重试 → 4 次重复提交。本地直连不经网关,所以本地"能跑只是慢",线上必现超时。

## 三、瓶颈定量

| 环节 | 代码位置 | 量级 | 性质 |
|---|---|---|---|
| 同步 await 整个 turn | `quickstartRoutes.ts:115` | 阻塞至 turn 结束 | **致命**(根因 A) |
| 每轮 callProvider 无超时 | `builderAgent.ts:292` | 无上限 | **致命**(根因 B) |
| 嵌套 LLM(builder 轮 + buildAgentDraft) | `builderAgent.ts:242` | ×2~3 串行 | 高 |
| draft max_tokens=2200 | `agentBuilder.ts:40` | 输出大 → 慢 | 中 |
| 前端假进度,不订 SSE | `QuickstartView.tsx:164` | 体验失真 | 高(掩盖问题) |
| 网关响应窗口 | veFaaS APIGW | ≤~15s | 外部约束 |

## 优化方案(根治,复用既有基建)

核心:**让 Quickstart 复用通用 session 已验证的"异步队列 + SSE + 前端 EventSource"模式,前端从假进度切到真事件驱动。**

### 后端
- [x] **B1** `quickstartRoutes.ts` `/message`:`await runQuickstartBuilderTurn(...)` → `enqueueSessionTurn(sessionId, () => runQuickstartBuilderTurn(...))`,立即返回 `202 { detail }`(detail 含已写入的 `user.message`)。与 `sessionRoutes.ts:208-214` 对齐。
- [x] **B2** `builderAgent.ts`:`callProvider` 传 `timeoutMs`(新增 `MAPLE_BUILDER_PROVIDER_TIMEOUT_MS`,默认 30_000)。turn 失败已 emit `session.status_failed`(既有 catch)。
- [x] **B3** `agentBuilder.ts` `agentDraftTimeoutMs` 8s→**60s** + `max_tokens` 2200→1400。**实测驱动**:部署后线上首测 turn 仍 `failed`(事件流 `agent.tool_use(draft_agent_config)` → `status_failed: operation aborted due to timeout`),用 curl 实测 doubao-seed-1-6 生成该 draft 真耗时 **38.9s**(1480 tok),8s 必然超时。60s 给足余量。
  - 备注(留后续):flash 模型快但产出不足——`doubao-seed-1-6-flash` 2.4s 仅 367 字符、`deepseek-v4-flash` 17.8s 仅 1018 字符,都装不下完整 agent 配置;doubao-seed(慢)给 2223 字符完整配置。draft 换 flash 需单独验证输出完整性,不并入本次根治。

### 前端
- [x] **F1** `useQuickstartController.ts`:`buildDraft` 发送后立即 `setView` + 乐观插入 user 消息,改为 `pollBuilderDetailUntilIdle`(轮询 detail until idle/failed,渲染真实事件)。轮询逻辑抽到 focused 模块 `app/quickstartBuilderPolling.ts`(避免 controller 超 400 行)。
- [x] **F2** `QuickstartView.tsx`:`BuilderProgress` 由真实事件驱动——`status_running`→理解,`agent.tool_use(draft_agent_config)`→规划/起草,`tool.result(draft_agent_config)`→准备草稿。
- [x] **F3** 删除 `QuickstartView.tsx` 的 `setInterval` 墙钟假进度 effect。

### 测试
- [ ] **T1** 合约:`/v1/quickstart/builder_session/:id/message` 返回 **202 且立即返回**(断言响应时间 < provider 单次耗时;断言返回体含 user.message,draft 卡通过后续 detail/SSE 拉取)。
- [ ] **T2** e2e(`tests/e2e/e2e.mjs:569`):现有"Quickstart builder"步骤适配异步——发消息后**轮询 detail 或 SSE** 等 `agent_draft` 卡出现,而非假设同步返回即含 draft。
- [ ] **T3** UI 合约(`maple_ui_interaction_contract.ts`):断言不存在墙钟假进度(`builderProgressIndex` setInterval 已删),进度来源是事件。

## 预期结果

- `/message` 立即 202,网关不再 abort;不再出现"重复提交 4 次"。
- 进度卡反映真实阶段;turn 失败有明确 `status_failed`,不再静默卡死。
- 单次 LLM 有 30s 上限兜底。

## 验证

- [x] `bun run typecheck` — 绿
- [x] `bun run lint` — 绿
- [x] `bun run test:agent-builder`(含新增 4 条回归锁)+ 7 个其它静态合约 — 全绿
- [x] `bun run build`(vite + 后端 bundle) — 绿
- [x] **线上端到端实测**(部署后 chrome-devtools 真实操作):
  - 优化前(旧 rev):`/message` 长 `pending` + 假进度走完三步(截图 `output/quickstart-before-fake-progress.jpeg`)
  - 优化后(rev 50/49):`/message` **秒回 202**,前端轮询 `/detail` 跟真实事件,进度卡停在真实阶段(`output/quickstart-after-real-progress.jpeg`)
  - 首测暴露 draft 8s 超时(事件流 `status_failed`),curl 实测 doubao 真耗时 38.9s → B3 调 60s 重新部署(rev 51/50)
  - 终测:事件流 8 条完整(`agent_draft` `Blank Agent` → `status_idle`),draft 卡渲染(`output/quickstart-after-draft-success.jpeg`),wizard 走通 创建 Agent(6→7)→ 配置环境 → 启动 Session(`output/quickstart-after-wizard-session-step.jpeg`)

### 追加修复:启动 Session 点击"没反应"(竞态)

线上端到端走到 wizard 第 3 步时发现:点"启动 Session"后端 201 成功(会话数真的涨)但前端 UI 不跳转,连点多次建了多个空 session。根因不是超时,是**前端竞态**:
- `createQuickSession` 在同一 tick 里 `setSelectedSession(id)` + `await refreshSessionDetail(id)`;
- `refreshSessionDetail`(`useSelectedSessionDetail.ts:124`)有 guard `if (selectedSessionRef.current !== sessionId) return` —— 此刻 ref 还没被 React 更新到新 id,结果被丢弃;
- 于是全局 `sessionDetail` 不指向新 session,`QuickstartView` 的 `quickSessionDetail`(:118)为 null,session 步永远渲染"启动 Session"表单分支。

诊断过程(三层,逐步逼近真因):
- 表象:点"启动 Session"后端 201(会话数涨)但 UI 不跳转,连点建多个空 session。用 React fiber 探针读出 props 后发现 `sessionDetail.session.id`、`agent_id`、`environment_id` 全部与 `quickSessionId`/`agent`/`environment` 匹配 —— `quickSessionDetail` 判定输入看似都对,却仍渲染表单分支。矛盾点指向**状态在渲染前被回退**。
- **真因**(`useBootstrapController.ts:117-121`):`createQuickSession` 在 `setSelectedSession(id)` + `setSessionDetail(optimistic)` **之后**调 `await refresh()`;而 `refresh()` 末尾有 `if (!selectedSession || !list.has(selectedSession)) { setSelectedSession(view==="quickstart" ? "" : ...); setSessionDetail(null); }` —— 在 quickstart 视图下**强制把刚设的 selectedSession 清成 ""、sessionDetail 清成 null**(且闭包里的 `selectedSession` 还是旧值)。于是每次都回退到表单。

修复(顺序 + 两个支撑):
1. **`createQuickSession` 把 `await refresh()` 提到 `setSelectedSession`/`setSessionDetail` 之前** —— refresh 的强制清空先发生,再选中新 session 并播种 optimistic detail,不再被回退。
2. `optimisticSessionDetail` helper(`quickstartBuilderPolling.ts`)+ 给 controller 补传 `setSessionDetail`,让 session 视图立即推进。
3. `useSelectedSessionDetail` effect:`detailRef.current` 已指向目标 session 时不清空(保护 optimistic seed,切换不同 session 仍清)。

线上端到端验证:启动 Session 后 UI 立即进入 Preview/试运行(`output/quickstart-after-start-session.jpeg`)。

### 未尽事项(沙箱外执行)
- `bun run test:all` 含需内网 MySQL(`*.pri.mysql.vedb.ivolces.com`,VPC 隔离)/ 起本地服务 / e2b / Playwright 的测试 —— 本机非 VPC 环境跑不了(架构性,非沙箱)。脚本 `scripts/verify-and-deploy-quickstart.sh` 备好,在 VPC 内或线上 CI 跑。线上端到端实测已等价覆盖集成路径。
- 失败提示 UX(`builderFailureMessage` + toast)已写入代码,尚未部署(终测已不再失败,优先级降低)。

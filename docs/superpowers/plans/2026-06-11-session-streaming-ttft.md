# Session 流式可见 + TTFT 极致优化(P0–P2)— 已落地

诊断报告见会话记录。三个用户可见问题 + TTFT 全链路优化,本次全部落地。

## 根因回顾

1. 工具调用不可见:runner.ts 把 runtime events 原样包成 `agent.external_loop_event`;前端 Transcript 不解包、还把 Tool role 过滤。
2. running 后死寂:runtime `subprocess.run(capture_output=True)` 吞掉 runner 已有的 NDJSON 流;control plane 单次 fetch 等完整响应;线上 APIG→veFaaS SSE buffered 失效;前端轮询仅在 status∈ACTIVE 才启动(race)。
3. 创建 session 突变:modal 无 spinner;onCreated 先 refresh 全量再显示 detail。

## 已完成

### T1 runtime-app(infra/vefaas/runtime-app/)
- [x] `runner_pool.py`(新):SessionRunner 保活子进程(stdin 常开,多 turn 复用,init 变更/进程死亡自动重启)+ EventCallbackSender(单 worker 保序回调、失败永久降级保证 streamed_count 是干净前缀、delta 400ms 聚合 + first 标记)
- [x] `app.py`:`run_claude_sdk_loop` 走保活 runner,逐事件实时回调 `event_callback.url`;返回 `streamed_count`;重试一次且自动去掉 partial flag(CLI 不兼容时自愈)
- [x] bootstrap 收到 `agent_config` 时后台预热 runner(首 turn 零冷启动)
- [x] `include-partial-messages` extra_args(`MAPLE_STREAM_PARTIAL`,默认开)→ stream_event 文本 delta
- [x] `mirror_native_tool_events_to_bridge` ThreadPoolExecutor 并行(原先串行 HTTP 阻塞 run 响应)
- [x] Dockerfile COPY runner_pool.py

### T2 control plane(apps/control-plane-api/)
- [x] `POST /v1/runtime/sessions/:id/loop_events`(tool_bridge token 鉴权):event → `agent.external_loop_event` 落库+SSE;delta → 服务端累积成全文后落 `agent.message_delta`(与 provider loop 同语义,`first`/`result`/10min TTL 三重清零)
- [x] `runAgentLoopOnVefaas`:run payload 带 `event_callback`;bootstrap payload 带 `agent_config`/`agent_env`(预热);loop 配置构造挪至 vefaasAgentRuntime.ts 共享
- [x] runner.ts vefaas 分支:不再先 markRuntimeReady(消重复 ensure 链 + 消 turn 中 idle 闪烁);`slice(streamed_count)` 兜底批量写 `createSessionEvents`(单 INSERT 多 VALUES,stamp 每行 +1ms 保序)
- [x] `storeSessionEvents.ts`(新,从 storeSessionsFiles 拆出):events/tool_calls 全部数据访问 + `createSessionEvents` 批量 + `findToolResultEvent` 定向查询
- [x] `GET /detail?after=<event_id>` 增量(COALESCE 子查询,after 失效自动回全量;响应带 `events_mode`)
- [x] 索引:`session_events(session_id, created_at)`、`tool_calls(session_id, created_at)`(此前零二级索引,轮询全表扫)
- [x] `waitForClientToolResult`:全量拉表 → `findToolResultEvent` SQL 定向(精确 JSON 片段 LIKE)

### T3 前端(apps/admin-web/)
- [x] useSelectedSessionDetail:发消息后 `beginTurnWatch` 90s 强制轮询窗口(见 active 后回 idle 才提前结束)→ 修死寂 race;EventSource onerror 触发刷新;active 轮询 1s→500ms;detail 增量拉取 + id 去重 merge + 乐观消息(`optimistic_` 前缀)在服务端回声到达时移除
- [x] events.tsx `externalLoopView`:解包 external_loop_event → Tool call / tool result / assistant 文本;loop 内部事件(init/result 回声)标 debugOnly 只进 Debug
- [x] SessionsView:Transcript 显示 Tool 行;eventRole/eventBarClass/transcriptText 全部感知解包;run-hint 扩展到 bootstrapping/created(文案区分);loadingEvents 接入 AppFrame
- [x] SessionModal 按钮 spinner(`.btn-spin`);onCreated 先 detail 后全量 refresh
- [x] 打字机:回调 delta 服务端累积 → 前端现有 dedupe(取最新 delta)直接渲染增长文本,零前端改动

### T4 验证
- [x] `python3 -m py_compile` 三个 runtime 文件
- [x] `bun run typecheck` + `bun run lint` + `bun run build`
- [x] 新增 `tests/contracts/vefaas_runner_pool_contract.py`(fake NDJSON runner:保活复用 PID、流式顺序、delta 聚合 first 标记、init 变更重启、死进程 RunnerDied)→ `bun run test:vefaas-runner-pool`,已入 test:all
- [x] test:vefaas-contract / api-storage / workspace-runtime-pool / prototype-console / real-agent-loop-driver 全过

## TTFT 审计结论(发消息 → 首个 agent 输出可见)

改造前链路 ≈ `2-3s CLI 冷启动 + 整 turn 时长(~23s)+ ≤1s 轮询`,事件只在 turn 结束后批量可见。

| # | 优化项 | 预估收益 |
|---|--------|---------|
| 1 | runner+claude CLI 保活(二轮起)+ bootstrap 预热(首轮) | -1~3s/turn |
| 2 | 流式回调:首工具调用/首文本即时落库 | 首事件可见 23s → 1~3s |
| 3 | 去掉 vefaas 路径重复 ensureSessionRuntime(整链 DB+沙箱检查 ×2→×1) | -200ms~1s |
| 4 | partial 文本 delta(400ms 聚合)打字机 | 首字可见 ≈ 模型 TTFT |
| 5 | 轮询 500ms + detail 增量 + (session_id, created_at) 索引 | 可见延迟均摊 -250ms,payload/查询 O(新事件) |
| 6 | turn 末批量 INSERT(N 次远程 RTT → 1 次) | 长 turn -0.5~2s |
| 7 | mirror 桥接并行化 | run 响应 -N×RTT |

### 未做(后续候选,按 ROI 排序)
1. **veFaaS 实例预留/常驻**(infra):函数实例缩容后的容器冷启动仍在(秒级),需 provisioner 配最小实例数;且多实例水平扩容时保活 runner 不共享(同 session 第二 turn 打到新实例 = 一次冷启动 + 无进程内对话连续性,靠 `continue_conversation` 的磁盘 session 文件也仅同实例有效)。要彻底解决需 session→实例粘性路由。
2. runUserMessage 内同步 DB 读链(getSession/getEnvironment ×多次,每次 ≈1 RTT):合并为单次读 + 透传,约 -100ms。
3. SSE 真流式穿透 APIG(veFaaS response streaming 或 WebSocket):把 500ms 轮询降为推送,需 infra 验证。
4. GET /detail 的 tool_calls 仍全量(行数小,暂不动)。

## 上线步骤
1. 重新构建并部署 veFaaS runtime 镜像(`deploy:vefaas:stable` / deploy_vefaas_update.py — runtime-app 目录整体上传,含 runner_pool.py)
2. control plane + 前端随常规发布;`session_events` 索引在 storeInit 启动时自动创建(CREATE INDEX 翻译层已兼容,重复报错被忽略)
3. 线上验证:发消息后 Transcript 应在 1~3s 内出现首个工具调用行,文本随 delta 增长;Debug 流时间戳应分散在 turn 全程而非挤在结尾

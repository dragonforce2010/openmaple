# Maple Session TTFT 全链路 Profiling + 优化计划

> 数据来源:线上 prod session `sess_SZP6CSJRVQ`(Space STG · Support agent · glm-4-7 via ARK `/api/coding` · veFaaS runtime)的事件 `created_at` 服务端时间戳重建,非网络轮询抖动。7 段并行代码分析 + 对抗验证(部分验证因额度中断,最高杠杆两项已独立双重确认)。

## 1. 实测时间线(服务端真值)

| | TURN 1 warm | TURN 2 warm(keep-alive) | TURN 3(失败) |
|---|---|---|---|
| 总时长 | 26.6s | 22.1s | 178.0s(timeout) |
| dispatch:user.message → status_running | 0.75s | 0.74s | 0.75s |
| **warmup floor:running → 首个 system 事件** | **3.60s** | **3.57s** | **17.14s(冷实例)** |
| streaming body:首 system → result | ~13.4s | ~11.9s | ~40s |
| tool:result → tool_result | 2.87 / 3.48s | 2.82s | 64s 挂起 → 失败 |
| finalize:→ status_idle | ~1.0s | ~1.5s | — |

**关键观察:**
- TURN 2 的事件间隔高度节律化:`1.28 / 1.26 / 1.26 / 1.29 / 1.27 / 1.25 / 1.29 / 1.27 / 1.26`s。模型自然出 token 不会如此规整——这是**回调层串行化的节流下界**,不是模型生成速度。
- warmup floor 在 keep-alive 下仍有 3.6s 地板;TURN 3 飙到 17.1s = 命中**冷的 scaled-to-zero veFaaS 实例**(keep-alive runner 在别的实例上,无 session→实例粘性)。
- TURN 3 根因(已用 payload 坐实):`error: "The operation was aborted due to timeout"` —— `invokeVefaas` 的 run action `AbortSignal.timeout(120s)` 触发;turn 慢 → 累计超 120s → control plane fetch 中止 → status_failed;runtime 仍在跑,tool_result 经回调在 failed 后 40s 才到 → **孤儿事件**。

## 1.5 实测三角验证(2026-06-11 补测)

为把估算钉成实测,三个独立基线:

- **warmup probe**(同 session 背靠背 6 turn,`scripts/perf/session_timeline_profiler.mjs` 同源):turn1 warmup **5.78s**(冷)→ turn2-6 稳定 **2.54s**(热)。证实 keep-alive runner 有效,但热稳态仍有 2.54s 地板。
- **ARK glm-4-7 真实 TTFT**(本地北京直连,简单 prompt,4 次):TTFB = 1.2 / 1.36 / 3.29 / 1.43s,中位 **~1.4s**。这是模型首响应,落在事件流的 `system → assistant` 段,**不在 warmup floor 内**。
- **APIG 裸往返**(health,5 次):**0.06-0.11s/跳**。

**三个结论修正:**

1. **warmup ≠ 模型**。冷 5.78s 比热 2.54s 多 ~3.2s = claude CLI 现场冷建(node 启动 + SDK connect 握手)。线上多 session 并发 + 实例 scale + APIG 在 function 多实例间 round-robin,大量 turn 落冷态,不是稳定的 2.54s。**池子的「热」= pool member 已 provision 有 invoke_url,不等于 veFaaS 实例常驻 + 该 session 的 runner 在那个实例上**(`_RUNNERS` 是 module-global = per-instance;prewarm 只在 bootstrap 命中的那 1 个实例建 runner)。
2. **热态 2.54s 里 ~1.27s 是首个 system 事件的回调落库延迟** —— 与 body 同一个回调串行化病(首事件也要经 EventCallbackSender → 4×MySQL 串行落库才有 created_at)。
3. **tool 段的 ~3s 是冗余**:vefaas agent loop 的工具**真实执行在 runtime 容器内**(claude CLI subprocess,已含在 body 里)。profile 里 `result` 之后的 `agent.tool_use`/`tool.result` 是 `mirror_native_tool_events_to_bridge` 把 SDK 已跑的工具**事后镜像到独立 vefaas_sandbox 重跑一遍** + 全量 workspace sync。read-only 工具(Read/Grep/ls)也被镜像,纯浪费。

## 2. 单 warm turn 分解 + 可控份额

| 阶段 | 实测 | 根因 | 可控份额 |
|---|---|---|---|
| dispatch | 0.75s | created/bootstrapping 100ms 自旋等待 + 9 次串行 MySQL RTT(status 写 + 事件落库) | 高(纯平台) |
| warmup floor | 3.6s | ensureSessionRuntime 冗余 3-4 次 MySQL + SDK connect→首 handshake + APIG TLS;无 min_instance/无粘性 → 冷启动尾部 17s | 中(平台 + infra) |
| **streaming body** | **~11.9s** | **回调串行化(~1.27s × N 事件)主导,真实模型生成远快于此** | **高(平台)← 最高杠杆** |
| tool 执行 | ~3s/工具 | bash 后全量 workspace sync(N+1 网关 RTT)+ 每工具重跑 ensureSandbox + mirror 把 SDK 已跑的工具又跑一遍 | 高(平台) |
| finalize | ~1.5s | message_delta/message/status_idle 多次串行落库 | 中 |
| 模型本身 | (混在 body) | glm-4-7 thinking(每 turn 隐式开)+ ARK RTT + decode | 低(provider-inherent,部分可控) |

## 3. 最高杠杆:回调中继串行化(双侧)

**Runtime 侧**(`infra/vefaas/runtime-app/runner_pool.py`):`EventCallbackSender` 单 `_drain` worker,`_post` 每条同步 `urllib.urlopen` 等响应,`streamed_count += 1` 在 POST 返回后。事件 N+1 必须等 N 的完整往返 → 事件间隔 == 单条 loop_events POST 往返。无 pipeline、无批量、无 keep-alive 连接。

**Control plane 侧**(`publicRoutes.ts` loop_events handler):返回 202 前**同步 4 次远程 MySQL**——`getSession`(runtimeBridgeSession)+ `getPrimaryThread` + `createSessionEvent` 内 `scopeForParent` SELECT + INSERT 本身。全部经 worker `Atomics.wait` 串行。

合计把事件吞吐封顶在 `1 / (WAN RTT + 4×MySQL) ≈ 1/1.27s`。~9 个 body 事件 = ~11s 纯中继地板,底下真实模型生成可能只需 ~4-6s。

**解耦洞见**:每事件的 DB INSERT 是冗余的——turn 末 `createSessionEvents` 批量(`runner.ts:109-117` streamed_count 对账)已经持久化全部事件。Live 路径只需要 SSE emit。所以:回调时用内存构造的 SessionEvent 直接 `emitSessionEvent`,**跳过每事件 INSERT**,让 turn 末批量成为唯一持久化写。INSERT 彻底移出热路径,streamed_count 语义改为"已 SSE 推送"(仍是干净前缀)。

## 4. 分级优化计划

### P0 — control plane only,无需重新部署镜像,立即可上

| # | 改动 | 攻击的成本 | 预估收益 | 文件 | 风险 |
|---|---|---|---|---|---|
| P0-1 | **回调中继提速**:loop_events 按 sessionId 缓存 `{session, threadId, workspace_id, tenant_id}`;先回 202;解耦——SSE emit 用内存事件,删每事件 INSERT,turn 末批量为唯一持久化 | body ~1.27s × N 的串行地板 | body ~11.9s → ~模型生成(~4-6s),**省 5-7s/turn** | `publicRoutes.ts` loop_events、`storeSessionEvents.ts`、`runner.ts:106-117` | 中 |
| P0-2 | dispatch 提速:provider-loop 跳过 created/bootstrapping 等待;100ms 自旋降到 20ms+退避;`updateSessionStatus` 去掉尾部 getSession 回查;`record()`/scopeForParent 每 turn 缓存一次 | dispatch 0.75s | -0.2~0.4s | `runner.ts:76-88`、`storeSessionsFiles.ts:269` | 低 |
| P0-3 | warm-turn DB N+1:把已取的 session/environment 对象透传进 `runAgentLoopOnVefaas`/`ensureSessionRuntime`,消除 5+ 次重复 getSession/getEnvironment/getWorkspace | warmup floor 内 ~0.4-1.2s | -0.4~1.0s | `runner.ts`、`runtimeManager.ts:14-35,60-92` | 低 |
| P0-4 | 前端增量:`/detail?after=` 同步增量化 tool_calls(加 after-cursor),append 路径省略静态 agent/environment/vaults;轮询 fast-follow(收到新事件立即再拉一次) | 每 500ms 轮询全量重拉 tool_calls + 静态元数据;250ms 平均感知延迟 | 长 session 显著降 payload;感知 -0.2s | `routeHelpers.ts:294-312`、`storeSessionEvents.ts:168`、`useSelectedSessionDetail.ts` | 低 |
| P0-5 | 工具等待去轮询:`waitForClientToolResult` 的 500ms `findToolResultEvent` 轮询换成 eventHub 一次性监听 | 多秒 custom-tool 等待期间 ~0.4s 串行 DB + worker 争用 | -0.3~0.4s + 解争用 | `runner.ts:361-375`、`sessionRoutes.ts:165` | 中 |

### P1 — 需重新部署 runtime 镜像

| # | 改动 | 攻击的成本 | 预估收益 | 风险 |
|---|---|---|---|---|
| P1-1 | runtime 回调批量 + keep-alive 连接:非 delta 事件带 seq 批量进单 POST(数组),复用 HTTP 连接 | N 次往返 → ceil(N/batch) | body 进一步压缩 + 连接开销 -0.05~0.2s/event | 中 |
| P1-2 | tool bridge:bash 后改**惰性/差量** workspace sync(只在 read/list/download 或变更路径时同步,并行读),ensureSandbox 每 turn 一次而非每工具,mirror 改"只记录不重跑" | post-bash 全量 sync 1.5-2.5s/工具 + mirror 重跑 1.27s×N | tool ~3s → ~1s | 中 |
| P1-3 | per-tool 硬截止(25-30s AbortController)+ 有序超时阶梯(control-plane 25s < bridge 35s < waitForClientToolResult 180s);session 离开 running/tool_waiting 后丢弃 tool.result | TURN3 类 64s 挂起 + 孤儿事件 | 64s → <30s 有界失败,消除孤儿 | 中 |
| P1-4 | 模型侧:`MAX_THINKING_TOKENS` 预算(Dockerfile/extra_args)、`max_turns ?? 8` 默认、`CLAUDE_CODE_MAX_OUTPUT_TOKENS` 降到 4-8k;`DELTA_FLUSH_SECONDS` 0.4→0.2 | thinking 每 turn 隐式开 = 模型侧 TTFT 主导;失控多轮;首屏 0.4s 地板 | 简单 turn 模型侧 TTFT 大降(**需先验证 ARK 是否认 thinking 旋钮**);感知首屏 -0.2s | 中 |
| P1-5 | prewarm handshake:bootstrap 时发一条 throwaway warmup query 让模型 handshake/system-init 提前完成(env flag 兜底) | warm floor 内 SDK connect→首事件的 1-2s | -1~2s | 中 |

### P2 — infra 改造(veFaaS / APIG)

| # | 改动 | 攻击的成本 | 收益 | 风险 |
|---|---|---|---|---|
| P2-1 | agent runtime function 设 reserved concurrency(`min_instance≥1`)+ session→实例粘性路由 | TURN3 类冷启动 17s;keep-alive runner 在多实例下不可靠 | 冷 turn 17s → 3.6s floor;让 P0/P1 的保活真正生效 | 中 |
| P2-2 | 真推送通道穿透 APIG(response streaming 或 WebSocket upgrade)替代 500ms 轮询 | 每事件 ~250ms 感知延迟地板 | 折叠到网络 RTT(数十 ms) | 中 |
| P2-3 | MySQL worker 异步只读通道 / 按 sessionId 分片多 worker:并发安全读不再排在单 Atomics 门后 | 回调 + SSE + tool 轮询互相 head-of-line | 尾延迟(并发 session 不再互堵) | 高 |

## 5. 端到端预估(warm turn)

- **现状**:~22s 总时长;首个可见工具/文本 ~12s(turn1)。
- **P0 后**:body 从 ~11.9s(中继封顶)塌到模型真实生成 ~4-6s;dispatch -0.3s;warm DB -0.8s。**warm turn ~22s → ~13-14s**。首事件仍 ~3.6s(warmup floor 要 P1/P2)。
- **P0+P1 后**:tool ~3s→~1s;warmup -1~2s(prewarm handshake);模型侧若 thinking 可控再降。**→ ~9-11s**。
- **P2 后**:冷 turn(TURN3 类)17s → 3.6s floor;真推送去掉 250ms/event 感知;粘性让保活稳定可靠。

## 6. 先埋点(Instrument-first)

runtime-app(python)目前**零 perf span**——上面 body/tool/warmup 的内部拆分是估算。先补最小埋点,把数字从"估算"变"实测":
- `run_claude_turn` 整体 wall time + 首事件延迟(query 写入 → 首个 SDK 事件)
- `EventCallbackSender._post` 每条 POST 往返 RTT(直接量出回调地板)
- tool bridge 调用往返 RTT(`maybe_call_tool_bridge`)
- 统一输出 control plane 同款 `{"type":"maple.perf", name, duration_ms, ...}` JSON,日志聚合

控制面已有 `MAPLE_PERF_TRACE=1` + `vefaas_agent.invoke`/`runtime.*` span(`perfTrace.ts`),线上开一次就能拿 control-plane 侧分解;runtime 侧补齐后即可端到端归因。

## 7. 落地顺序建议

1. **先埋点**(第 6 节)——一次 redeploy 同时带上,之后所有数字可测。
2. **P0-1 回调中继提速**——单项最大收益,纯 control plane,先上先量。
3. P0-2~P0-5 control-plane/前端快赢,随常规发布。
4. P1 批量 redeploy 一次镜像(P1-1~P1-5 一起)。
5. P2 infra 单独评估(reserved concurrency 成本 / APIG streaming 可行性)。

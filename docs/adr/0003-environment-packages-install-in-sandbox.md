# Environment packages 装在 Sandbox、控制面驱动、探包幂等 + installing_packages 闸门

环境声明的 `config.packages`(`{manager,name}[]`)在 **vefaas Sandbox**(`ensureVefaasSandboxRuntime` 之后,`runtimeManager.ts` 的 `ensureConfiguredSandboxRuntime` vefaas 分支)安装,**不在 AgentRuntime**。装包由**控制面驱动**——控制面经 sandbox gateway 跑 `pip/npm install`(`vefaasSandboxPackages.ts` 的 `ensureSandboxPackages`),逐包 `emitSessionEvent` 出 `package.install_started/log/finished`,并把 session 置于新状态 `installing_packages`;`runUserMessage` 在该状态阻塞 turn 直到装完(`waitForPackageInstall`)。探包靠 sandbox 内 marker(`/tmp/.maple_packages.json`)+ 安装幂等,缺包才装。

原因(看代码会困惑的几处):

1. **为何装 Sandbox 不装 AgentRuntime**:`CONTEXT.md` 术语裁决"装包"归 Sandbox(跑手)。且默认 agent 走 provider loop(`shouldUseExternalAgentLoop` 默认 false),根本不起 vefaas agent runtime,工具只在 sandbox 跑——装 sandbox 才对所有 loop 都成立。

2. **为何控制面驱动 + emit,而非 runtime 回调 loop_events**:装包命令本就由控制面经 gateway 发起,控制面直接拿到每步结果,`emitSessionEvent` 即到前端。走 runtime 自驱回调要改 Python 的 `EventCallbackSender` 契约(memory/ADR 警告 loop_events 改一侧必同步另一侧),无谓增加风险。

3. **为何不在 agent runtime 的 bootstrap 装(原始直觉)**:bootstrap 经 control 通道、超时 `min(timeout, MAPLE_VEFAAS_CONTROL_TIMEOUT_MS=20s)`(`vefaasAgentRuntime.ts:115`)。`pip install` 动辄 30s+,同步装会顶爆 20s → bootstrap 失败 → turn 失败。Sandbox gateway 命令通道无此 20s 限制,故装包放这里。

4. **为何要 installing_packages 闸门而非静默后台**:用户要"装包进度可见 + 装完才可交互"。后台静默会让首条消息在包未装完时就 import 失败。显式状态 + 闸门 + SSE 进度同时满足可见与无竞态。

5. **粘性**:同 session 复用 `session.metadata.runtime.sandbox_id`(已有)是主路径;`markSandboxPoolMemberClaimed` 加 session 亲和(优先复用本 session 已 claim 的 member)。破坏(实例回收/换池)时探包发现缺包重装兜底,不追求强保证。

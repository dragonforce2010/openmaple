# Agent 工具在独立 Sandbox 执行(非 runtime 容器)· 凭证零落容器 · 工具按执行端分流

vefaas agent loop 里 `claude-agent-sdk` 的本地执行类工具(Bash/Read/Write/Grep)**不再在 runtime 容器内 `subprocess` 执行**,改为经 control plane 工具桥转发到该 session 绑定的独立 veFaaS Sandbox 实例执行。机制:runtime-app 用 `create_sdk_mcp_server` 注册 `mcp__maple_sandbox__*` 工具(`infra/vefaas/runtime-app/sandbox_tools.py`),并在 `claude_init_payload`(`app.py`)用 `disallowed_tools` 禁掉内置 `Bash/Read/Write/Edit/Glob/Grep`,逼模型只用这些 MCP 工具;每个 MCP 工具体 POST 到 `/v1/runtime/sessions/:id/tools`(只带 session 级 bridge token),control plane 侧 `executeTool` 用自己持有的凭证打 sandbox gateway。control plane 在 bootstrap/turn 时后台预热 sandbox,但不在每轮 `run` 前阻塞;首次本地工具调用由 `executeTool` lazy `ensureSessionSandboxRuntime`,失效时重建一次。

原因(看代码会困惑/有取舍的几处):

1. **为何反转工具执行位置(早期为了快放在容器内)**:原 `app.py` 流式路径显式跳过 tool_bridge,注释自认"the SDK already executed the tools in this runtime container"——快,但 runtime pool member 是 **workspace 级共享**(`storeAgentsEnvironments.ts` 按 `active_session_count` 负载均衡 + `runner_pool._RUNNERS` 一容器并存多 session),导致**多 session 的 bash 在同一容器跑**,`safe_path` 只管 read/write 路径、管不住 bash 命令本身 → 跨 session 可读彼此文件。隔离是硬要求,故反转。

2. **为何凭证零落容器**:sandbox 跑 agent 生成的不可信 bash、runtime 跑可被 prompt 劫持的 LLM,任一处只要能读到明文凭证(env/payload),恶意代码即可 `env|curl` 外传。故 sandbox/TOS 凭证**只在 control plane 持有**,调用时在边界注入;容器内只有 session 级 bridge token(仅能调工具桥)。对齐 Anthropic code-execution:容器从不持有调用方 api key,鉴权在容器外 `x-api-key` 边界。

3. **为何 control plane 做唯一出口(两跳)而非容器直连 sandbox(一跳)**:直连要把 sandbox `gateway_url`+`api_token` 传进容器,违反 §2。`runtimePublicMetadata`(`runtimeCommon.ts:7`)本就对 vefaas_sandbox 裁掉了这两个字段。两跳(runtime→control→sandbox)换凭证零落,延迟靠 sandbox 池化常驻 + keep-alive 摊薄(后续 task D)。

4. **为何工具按执行端分流**:remote MCP 工具(Notion/GitHub 等)的执行端本身是远端隔离服务,runtime 直连 MCP server 即可,绕道 sandbox 无安全收益且更慢。故只有**本地执行类**(动文件系统/跑命令的 Bash/Read/Write/Grep)进 sandbox;remote MCP 直连(此链路 `app.py:292 mcp_servers` + `claude_agent_sdk_runner.py:115` 已存在,不改)。

5. **为何 sandbox_id 不在 runtime 启动时静态注入**:sandbox 池化会被回收/替换(reuse TTL/claim 失败重建/expire)。control plane 每次从 `session.metadata.runtime/sandbox_runtime` 动态解析当前 sandbox,失效则重建——容器侧无需也不应持有 sandbox_id。

6. **provider loop 不受影响**:provider loop 的工具本就经 `executeTool` 在 sandbox 跑(已合规),本次只改 vefaas agent loop。非 SDK 路径(cli_batch/codex)的 `mirror_native_tool_events_to_bridge` 保留(那条路径工具仍在容器 subprocess 跑,mirror 是其文件同步机制);SDK 路径调 `normalize_agent_loop_events(events)` 不传 body/workspace,天然绕开 mirror。

未决(后续,需真实 veFaaS 环境验证):**文件状态外置 TOS**(maplesandbox 应用层预配挂载,按 workspace/session 分 prefix 隔离,绕去 host↔sandbox 双向同步)与 **sandbox 池化常驻**(min-instance + keep-alive)。挂载点真实路径、prefix 隔离是否生效、control plane 读文件改读 TOS 还是读 sandbox,均依赖非沙箱终端验证,不在本次落地。

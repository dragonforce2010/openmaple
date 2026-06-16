# Plan: veFaaS Agent Loop Runtime and Workspace Onboarding

## Objective

修正 runtime 分层：

- Agent runtime 承载 agent loop，例如 Claude Code loop 或 Codex loop。
- E2B sandbox 只作为工具执行环境，由 agent runtime 通过控制面 tool bridge 调用。
- Agent 创建时必须携带 `agent_loop.type`，不再从 Environment 决定。
- 首次登录需要 workspace onboarding 配置 runtime provider、runtime pool、sandbox provider、model pool 和 API key。
- Agent 详情页需要展示 workspace、runtime pool、可关联的 veFaaS function，以及最近 session 的真实 runtime 绑定。

## Assumptions

- 不新增 npm 依赖。
- 本阶段不跑真实 E2B 付费测试，只跑 fake/local contract；真实 E2B 测试必须跟踪并清理 sandbox。
- veFaaS 函数仍通过固定源码模板发布，但 provisioning envs 必须包含 agent-loop runtime 所需的模板输入能力。
- 当前最小可落地形态是：控制面收到 user message 后把 `action=run` 发给 veFaaS agent runtime；veFaaS runtime 在 agent loop 过程中通过 `tool_bridge_url` 回调控制面，由控制面在 E2B sandbox 执行工具。

## Commands

- Dev: `bun run dev`
- Contract runtime: `bun run test:vefaas-contract`
- Contract provisioner: `bun run test:vefaas-provisioner`
- Contract workspace: `bun run test:workspace-runtime-pool`
- Typecheck: `bun run typecheck`
- Build: `bun run build`

## Files

- `server/runtime.ts`
- `server/runner.ts`
- `server/provider.ts`
- `server/index.ts`
- `server/store.ts`
- `scripts/vefaas_runtime_contract.ts`
- `scripts/workspace_runtime_pool_contract.ts`
- `scripts/vefaas_provisioner_contract.py`
- `scripts/vefaas_runtime_app/app.py`
- `scripts/deploy_vefaas_runtime.py`
- `src/types.ts`
- `src/App.tsx`
- `src/styles.css`

## Testing Strategy

- 先改 `scripts/vefaas_runtime_contract.ts`：期望 `runUserMessage` 触发 veFaaS `run`，而不是由 API server 直接执行 agent loop。
- 合同里模拟 veFaaS runtime 调用控制面 tool bridge，验证工具请求仍落到 sandbox runtime。
- 扩展 `scripts/workspace_runtime_pool_contract.ts`：onboarding 后 Agent 创建必须关联 workspace/model pool；Agent detail endpoint 返回 runtime candidate。
- 前端通过 typecheck/build 覆盖 workspace onboarding 和详情渲染。

## Acceptance

- veFaaS session 收到用户消息时，事件流出现 agent output，但模型 loop 不在 API server 内部执行。
- E2B/local Docker 工具执行仍由控制面 `executeSandboxTool` 承载。
- Workspace onboarding UI 能创建默认空间和 runtime pool。
- Agent 详情页能展示 workspace/runtime pool/function 信息。
- `test:vefaas-contract`, `test:vefaas-provisioner`, `test:workspace-runtime-pool`, `typecheck`, `build` 通过。
- 前端 smoke 可进入 workspace onboarding 或 console，不点击会触发真实云资源创建的开通动作。

## Boundaries

- Always: `.env` 只从项目目录加载；测试不创建真实付费 E2B sandbox。
- Ask first: 删除真实云资源、跑真实 veFaaS/E2B 付费 e2e。
- Never: 批量删除文件或目录；把用户 AK/SK 写进源码或文档。

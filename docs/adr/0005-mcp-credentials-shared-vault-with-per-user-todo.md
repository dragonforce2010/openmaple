# 0005 — MCP OAuth 凭据用 workspace 共享模型(per-user 为未来 TODO)

日期:2026-06-15

## 决策

MCP provider 的 OAuth 凭据按 **workspace/vault 共享**:token 存 `vault_credentials`(绑 vault→workspace,不绑 user)。运行时注入(`findWorkspaceProviderToken` → `injectMcpCredentials`)按 `(workspace_id, provider)` 取已连接凭据,注入 MCP 调用的 `Authorization` header。

## 为什么

- 现有数据模型 `vault_credentials` 无 `user_id` 维度;workspace 是既有资源边界。
- 共享模型最小改动即可跑通端到端闭环(agent 真调 GitHub/Notion)。

## 后果(已知限制)

- **同 workspace 内任何成员调用该 agent,都用同一条 token(凭据连接者的身份)**。即"别人用你的 agent = 用你的 GitHub 身份"。
- "获取我的 repo / 我的 PR"这类**随调用者身份变化**的语义,在共享模型下只会返回**凭据连接者**的数据,不是当前调用者的。这是模型A的固有限制,不是 bug。

## 未来 TODO:per-user 凭据(模型B)

当需要"每人用自己的 OAuth 身份"时:
- 新增 `user_mcp_connections(workspace_id, agent_id 或 provider, user_id, secret_ref, secret_cipher, metadata)`,token 绑到 (workspace, provider/agent, user)。
- OAuth 授权改为**运行时按需触发**:某用户首次用该 agent 且自己没 token → 触发他自己的 OAuth → 存成他自己的连接。
- 注入改为按 **session 发起者**(已有 `currentUser`)取各自 token,而非按 workspace。
- agent 配置只声明"需要 provider X",token 是 per-user 运行时解析。

未实现。本 ADR 记录该方向,避免共享模型被误当作终态。

# CODEX 接力交接 — Vault MCP 端到端闭环

> 给新 session(无上下文)的自包含交接。配套读:`docs/superpowers/plans/2026-06-15-vault-mcp-end-to-end-closed-loop.md`(完整计划+决策)、`docs/adr/0005-*.md`、`docs/adr/0006-*.md`。
> 用户偏好:中文输出;最小 diff;findings-first;不擅自 commit 用户的前端工作。

## 一句话现状

GitHub+Notion MCP OAuth 端到端闭环(共享凭据模型A)的**代码全部写完、本地 typecheck+lint 全绿**,但**尚未 commit 到 main、尚未部署到云端验证**。

## Git 状态(精确,务必先核对)

- 主 repo:`/Users/bytedance/workspace/managed-agents-platform`,分支 `main`,HEAD=`d7042cfa`。
- 主 repo 工作区**有 ~34 个未提交文件**,混了两拨改动:
  1. **用户正在做的前端**(vault-detail 页 + WorkspaceSettings 等):`VaultDetailView.tsx`/`VaultsView.tsx`/`AppFrame.tsx`/`appTypes.ts`/`navigation.ts`/`CredentialModal.tsx`/`App.tsx`/`WorkspaceSettingsDrawer.tsx`/`styles/part-*.css` 等 —— **不要动、不要擅自 commit,这是用户掌舵的工作**。
  2. **本次 apply 进去的后端闭环**(下方"已完成"列出的 13 个后端文件 + `useBootstrapController.ts` + `.env.example` + `CONTEXT.md` + 3 个新 doc)。
- worktree:`.claude/worktrees/github-mcp-vault`,分支 `worktree-github-mcp-vault`,HEAD=`9d6482f4`(含完整 commit:后端闭环 + 一份从旧 stash 复制的**旧版**前端)。**worktree 的前端是旧快照,主 repo 工作区的前端更新——以主 repo 为准**。
- 主 repo `stash@{0}`(`wip-vault-detail-page-before-github-mcp-deploy`):旧 vault-detail,已被 worktree commit 吸收,**冗余,别 pop,用户自行处理**。
- main 已含之前部署过的 `32562d93`(GitHub provider 启用 + MCP picker 禁用未配置 provider)。

## 已完成(代码已在主 repo 工作区,未 commit)

1. **P0 secret 持久化**(ADR 0006):`vault_credentials` 加 `secret_cipher` 列(`storeSchema.ts`+`storeInit.ts` ensureColumn);`readCredentialSecret(row)` 优先 cipher 回退 `secret_ref` 文件(`storeVaultMcpMemory.ts`);OAuth callback/refresh/手填 三处都写 cipher(`mcpRoutes.ts`/`vaultRoutes.ts`);master key 读 `MAPLE_SECRET_MASTER_KEY` env 优先(`infra/secrets.ts`)。解决 veFaaS `/tmp` 非持久。
2. **需求4 执行侧 token 注入**(ADR 0005,模型A 共享凭据):新文件 `apps/control-plane-api/src/runtime/mcpCredentialInjection.ts`(`injectMcpCredentials`/`withInjectedMcpCredentials`);`findWorkspaceProviderToken(workspaceId,provider)`(`storeVaultMcpMemory.ts`)按 workspace+provider 取已连接 token 解密;注入 `headers.Authorization: Bearer <token>` + `type:"http"`;接入两条执行路径 —— vefaas(`vefaasAgentRuntime.ts` 的 `vefaasLoopAgentConfig`)、external(`runner.ts` 传 agent 前)。`agentBuilder.ts` prompt 改为让 LLM 对 github/notion 产 `provider` 字段(注入靠 provider 匹配)。
3. **需求1 OAuth 回凭证详情页**:callback redirect 带 `&vault=<id>`(`mcpRoutes.ts` credential 分支);`useBootstrapController.ts` 消费 `vault` param → `setRouteId(vaultId)`+`setView("vault")`。依赖用户前端已建的 `"vault"` view + `VaultDetailView(vaultId)`(已确认存在)。
4. **需求2 Notion + 文档**:`.env.example` 补 Notion + `MAPLE_SECRET_MASTER_KEY` 占位;ADR 0005/0006;`CONTEXT.md` Vault 术语更新。

本地 `bun run typecheck` + `bun run lint` 全绿(主 repo 工作区,用户前端+本次后端一起编译通过)。

## 待办(按序)

### A. 决定如何 commit(先问用户)
主 repo 工作区混着用户前端 + 本次后端,**未 commit**。问用户:是否帮 commit、怎么切分(后端闭环单独一个 commit,还是和前端一起)。**不要擅自 commit 用户的前端。**

### B. 部署(用户在普通终端跑;sandbox 会拦 volcengine 上传,agent 跑不了)
```bash
cd /Users/bytedance/workspace/managed-agents-platform && bun run deploy:vefaas:stable
```
- env 已全配(`.env` 已有 `MAPLE_MCP_GITHUB_CLIENT_ID/_SECRET`、`MAPLE_MCP_NOTION_CLIENT_ID/_SECRET`、`MAPLE_SECRET_MASTER_KEY`,都 `MAPLE_` 前缀 → `backend_envs()` 自动上云,见 `infra/vefaas/deploy_vefaas_application.py:388`)。
- 部署成功判据:`output/vefaas/stable-deployment.json` 的 `updated_at` 刷新到当前(上次 `2026-06-15T00:44:49`)。
- 网关:`https://sd8ihq8v316pc5mf9c1j0.apigateway-cn-beijing.volceapi.com`。

### C. 两个 provider 后台加 callback URL
GitHub App + Notion integration 都加:`https://sd8ihq8v316pc5mf9c1j0.apigateway-cn-beijing.volceapi.com/v1/mcp/oauth/callback`

### D. 端到端验证(需求3 token 落库 + 需求4 真调用)
- DB 层(可在普通终端,非 sandbox):
```bash
echo '{"op":"query","mode":"all","sql":"SELECT id,name,auth_type,LEFT(secret_cipher,16) cipher,LEFT(metadata_json,150) meta FROM vault_credentials WHERE auth_type=\"oauth\" ORDER BY created_at DESC LIMIT 5","params":[]}' | node apps/control-plane-api/src/infra/mysql_child.mjs
```
看 `secret_cipher` 非空 + metadata `oauth_connected:true`。
- 端到端:网关登录(Lark SSO;`MAPLE_DEV_LOGIN` 云端未开,匿名/dev curl 进不去 catalog) → Quickstart 输入"创建能查看我 GitHub 仓库和 PR 的助手" → builder 产 `provider:'github'` 的 mcp_server → vault step 连 GitHub OAuth → 回 vault 详情页 → session 发"列出我最近改动的10个repo + 它们的 PR/issue" → 看 loop_events 有真实 GitHub 数据。

## 陷阱(踩过的,别重踩)

1. **sandbox 拦外网/MySQL/dev server**:部署(volcengine 上传)、`bun run dev`(listen EPERM)、连 MySQL —— 这些**必须用户在普通终端跑**,agent 的 Bash 沙箱会拦。本地起服务截图走不通。
2. **veFaaS `/tmp` 非持久**:`MAPLE_DATA_DIR=/tmp/...`,secret 文件冷启动即丢 —— 已用 `secret_cipher` 进 DB + master key 走 env 解决。**部署必须带 `MAPLE_SECRET_MASTER_KEY`**,否则跨实例解不开密文。
3. **GitHub Copilot MCP 端点风险**:catalog 的 `api.githubcopilot.com/mcp/` 不一定接受纯 user OAuth token(可能要 Copilot 订阅/特定 scope)。若 session 测试 GitHub MCP 返回 401 → 是端点问题不是注入问题,换 GitHub 官方 MCP / PAT 路径,改 `catalog/mcpCatalog.ts` 的 `mcp_url`。
4. **zsh history expansion**:agent 的 Bash 里 `!` 会被转义(`grep -q ! foo`、heredoc 含 `!`、JS 的 `!==`)。用 `grep -c`/Write 工具写脚本/`set +H` 规避。
5. **凭据模型 = 共享(模型A)**:同 workspace 内别人用该 agent = 用凭据连接者的身份。"我的 repo"语义在共享模型下返回的是连接者的数据。per-user OAuth 是 ADR 0005 记录的未来 TODO,本次不做。

## 关键文件索引

- 注入:`apps/control-plane-api/src/runtime/mcpCredentialInjection.ts`
- 凭据查询/解密:`apps/control-plane-api/src/storage/storeVaultMcpMemory.ts`(`findWorkspaceProviderToken`/`readCredentialSecret`)
- secret 加解密:`apps/control-plane-api/src/infra/secrets.ts`
- OAuth callback/refresh:`apps/control-plane-api/src/routes/mcpRoutes.ts`
- catalog(provider 元数据/client env 前缀):`apps/control-plane-api/src/catalog/mcpCatalog.ts`
- 部署脚本:`infra/vefaas/deploy_vefaas_stable.py`(`deploy` 模式)、`deploy_vefaas_application.py`(`backend_envs()`)
- 前端 callback 落地:`apps/admin-web/src/app/useBootstrapController.ts`

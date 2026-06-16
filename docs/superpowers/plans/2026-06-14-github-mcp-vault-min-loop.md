# GitHub MCP Provider 启用 + Vault 最小闭环

日期:2026-06-14
分支:`worktree-github-mcp-vault`

## 背景 / 目标

接通 vault 的 **OAuth 接入闭环**(凭据获取→加密存储→自动刷新)的 GitHub provider 这一路:

1. 配置 GitHub OAuth client(App ID 4052164 / Client ID `Iv23li55pwdQz4xVX8rR`)到平台,使 `/v1/mcp_catalog` 对 GitHub 返回 `configured: true`。
2. 创建 vault credential / 接入 MCP 时,**未启用(无 client 配置)的 provider 灰显禁用、标注"未启用"**,已启用的正常可选。
3. callback URL 指向用户的网关:`https://sd8ihq8v316pc5mf9c1j0.apigateway-cn-beijing.volceapi.com/v1/mcp/oauth/callback`。

### 闭环边界(必须对用户讲清)

- ✅ 本计划打通:OAuth 授权 → 换 token → `writeSecret` 加密落盘 → 写 `vault_credentials.secret_ref` → 后台 60s 自动刷新(`refreshMcpOauthTokens`,mcpRoutes.ts:229 已覆盖 vault_credentials)。
- ❌ 本计划**不**打通:agent 执行时把 token 注入 MCP 调用。`normalizeMcpServers`(agentLoopDriverUtils.ts:51)仍不查 vault / 不 `readSecret` / 不拼 Authorization。这是独立任务,本次范围外。

### GitHub OAuth 特性确认点(验证时重点看)

- GitHub token endpoint 默认返回 form-urlencoded;callback 已带 `Accept: application/json`,GitHub 认此头返回 JSON → 现有 `tokenResponse.json()` 应可解析。验证时确认。
- GitHub user-to-server token 默认**无 refresh_token**(除非 App 开启 token 过期)。故自动刷新对 GitHub 多为 no-op(无 refresh_token 即跳过,token 长期有效)——这是 GitHub 设计,非 bug。

## 决策(已与用户确认)

- 凭据存放:**env-only**,与现有 catalog 一致(`mcpProviderClient` 读 `MAPLE_MCP_GITHUB_CLIENT_ID` / `_CLIENT_SECRET`)。后端 catalog 零代码改动。
- 列表过滤:**灰显 + 禁用点击 + 标"未启用"**,自定义 URL 仍可手填。

## 改动清单

### 后端 / 配置(无 catalog 代码改动)

- [ ] `.env.example`:新增占位块 `MAPLE_MCP_GITHUB_CLIENT_ID=` / `MAPLE_MCP_GITHUB_CLIENT_SECRET=`,并补 `MAPLE_CONTROL_PLANE_BASE_URL=`(callback base 来源,mcpRoutes.ts:111)注释说明。
- [ ] 本地 `.env`(gitignored,不进 commit):写入 GitHub client_id/secret + `MAPLE_CONTROL_PLANE_BASE_URL=https://sd8ihq8v316pc5mf9c1j0.apigateway-cn-beijing.volceapi.com`。**仅本地配置,代码层不读硬编码值。**

### 前端 `CredentialModal.tsx`(创建 vault 凭据入口)

- [ ] provider 列表 `filtered.map`:OAuth 且 `!configured` 的条目 → `<button disabled>` + 追加"未启用"提示(badge 已是 `OAuth setup` warn 态,补 disabled)。
- [ ] 已有的 `connect()` 内"未配置则报错"逻辑保留(双保险)。

### 前端 `McpConnectModal.tsx`(接入 MCP 入口)

- [ ] 同上:`filtered.map` 里 OAuth 且 `!configured` 的 `mcp-row` 加 `disabled` + 文案,避免点击后才报错。

### i18n

- [ ] `config/i18n.ts`:新增"未启用 / Not enabled"文案 key(如已有 `未配置` 可复用 labels.tsx:41,优先复用)。

## 验证步骤

1. `bun run typecheck` 通过。
2. `bun run lint` 通过(注意 400 行硬顶,两个 modal 现各 ~77/166 行,有余量)。
3. 配好本地 `.env` 后启 `bun run dev`,用 preview MCP 截图:
   - 创建 vault → Add credential → MCP server 列表:GitHub 可点(badge ready/OAuth),其余未配置 provider 灰显禁用标"未启用"。
   - 点 GitHub → oauth/start → 跳转 URL 的 `client_id=Iv23li55pwdQz4xVX8rR`、`redirect_uri=<网关>/v1/mcp/oauth/callback`。
4. (条件允许)走完 GitHub 授权 → callback → 确认 `vault_credentials` 落了一条 `auth_type='oauth'` 且 `secret_ref` 指向加密 secret;`metadata.oauth_connected=true`。
5. 截图入终稿。

## 风险

- callback 走外网网关:本地 dev 时 GitHub 回调打到网关而非 localhost,本地不一定能接住回调落库;若验证受阻,记录为"授权跳转 URL 已验证、回调落库需网关环境",标明 blocker。
- `MAPLE_CONTROL_PLANE_BASE_URL` 未配时 callback 会回退到 `request.protocol://host`(mcpRoutes.ts:111),本地可能拼成 localhost,导致 redirect_uri 与 GitHub App 注册的不一致 → 必须配。

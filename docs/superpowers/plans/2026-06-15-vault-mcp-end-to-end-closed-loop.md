# Vault MCP 端到端闭环(共享凭据模型A)

日期:2026-06-15
分支:`worktree-github-mcp-vault`(基于已合入 main 的 `32562d93`)

## 目标(用户 4 个需求)

1. **OAuth 授权完成后回到凭证详情页**(不是回首页)。
2. **带上 Notion**(已配 env,重新部署即可,零代码)。
3. **验证 token 有效落库**(给出验证手段 + 解决云端 `/tmp` 非持久风险)。
4. **端到端闭环用例**:自然语言创建 agent → builder 自动配上 GitHub/Notion MCP → 创建时索要凭证 → 用户选择创建时完成 OAuth → session 测试时 agent 真能调 GitHub(如"获取我最近改动的10个repo / PR / issue")。

### 凭据模型决策(已与用户确认)

- **本次做模型 A:共享凭据**(workspace/vault 级)。token 存 workspace 的 vault,该 workspace 内调用 agent 的人共用同一 token。
- **模型 B(每用户独立 OAuth)记为 ADR + TODO,本次不实现**。用户已知晓"共享模型下,同 workspace 别人用你的 agent = 用你的 GitHub 身份"这一限制。
- 注入方式:**方案 A —— 解密 token 注入 MCP server 的 `headers.Authorization`,随 agent config 透传进 sandbox**。token 会进 sandbox 进程(可接受,换快速跑通)。

---

## 背景事实(已读代码确认)

### secret_ref / token 存储现状

- `vault_credentials.secret_ref` = 指针字符串 `local-secret://<id>`,**DB 不存 token 明文**。
- 真 token 在 `<secretsDir>/<id>.json`,AES-256-GCM 加密,bundle = `{access_token, refresh_token, token_type, expires_at, scope}`,主密钥 `<secretsDir>/master.key`(secrets.ts)。
- OAuth callback 换 token 后 `writeSecret(...)` → `updateVaultCredential(credId, {secret_ref, metadata:{oauth_connected:true,...}})`(mcpRoutes.ts:189-191)。

### ⚠️ 云端 `/tmp` 非持久(端到端的真实拦路虎,必须前置解决)

- `secretsDir = dataDir/secrets`,`dataDir` 由 `MAPLE_DATA_DIR` 决定(paths.ts:4)。
- 云端 `backend_envs()` 设 `MAPLE_DATA_DIR=/tmp/maple-managed-agents`(deploy_vefaas_application.py:409)。
- **veFaaS `/tmp` 实例重启/扩缩容即清空、多实例不共享** → token 密文文件会丢,DB secret_ref 变悬空,`readSecret` 抛错。
- **结论**:云端必须让 secret 密文持久 + 跨实例可读,否则 OAuth 存的 token 活不过冷启动。

### 执行侧断链(需求4 的核心,两处)

- **关联键缺失**:`agent_snapshot.mcp_servers` 条目(agentBuilder 产 `{name,url,type:'url'}`)与 vault credential **无任何关联键**。
- **注入缺失**:`claudeInitPayload` 的 `normalizeMcpServers`(agentLoopDriverUtils.ts:21,51)原样透传,不查 vault、不 readSecret、不拼 header;云端 `claude_agent_sdk_runner.py:115` 直接 `mcp_servers=config.get(...)` 进 SDK。

---

## 实现计划

### P0 前置:secret 密文持久化(否则云端闭环站不住)

**决策(已确认):token 密文直接进 DB 列对称加密;未来接 KMS。**

- [ ] 给 `vault_credentials` 加 `secret_cipher TEXT NULL` 列,`encryptSecret()`(已存在,secrets.ts:17)产出的 AES-256-GCM 密文 JSON 存这里;`secret_ref` 保留向后兼容(本地文件)但**优先读 `secret_cipher`**。
- [ ] store 层加 `readCredentialSecret(cred)`:优先 `secret_cipher`(decryptSecret),回退 `secret_ref` 文件(readSecret)。写入侧 OAuth callback 改为同时写 `secret_cipher`(decrypt 路径不依赖 /tmp 文件)。
- [ ] master key 云端持久:`encryptSecret` 的 master.key 现也在 `/tmp`。**本次 master key 走 env**(`MAPLE_SECRET_MASTER_KEY` base64,backend_envs `MAPLE_` 前缀自动上云),secrets.ts 读 env 优先于文件。**未来接 KMS**(ADR 记 TODO)。
- [ ] 迁移:新列,旧数据本地文件仍可读;无破坏性迁移。

### 需求1:OAuth 回凭证详情页

- [ ] 合入 stash 里的 vault detail 改动(VaultDetailView +79行、`vault` 路由、navigation/appTypes +1)——这是详情页载体。**注意 stash 的 CredentialModal 改动(删 Optional 标签)与已合入的 provider-禁用改动需三方合并**(不同区域,应无冲突)。
- [ ] callback redirect 带上 vault 上下文:`mcpRoutes.ts` credential 分支 redirect 从 `?credential_connected=<provider>` 改为 `?credential_connected=<provider>&vault=<vaultId>`。
- [ ] `useBootstrapController.ts:195` 消费 `vault` param → `goView('vault', vaultId)` 跳详情页(而非首页 toast)。

### 需求2:带 Notion 上云

- [ ] 零代码。`.env` 已配 `MAPLE_MCP_NOTION_*`。**重新部署**即生效(`backend_envs` MAPLE_ 前缀白名单自动带上云)。
- [ ] `.env.example` 补 Notion 占位(文档完整)。
- [ ] Notion integration 后台加 callback `<gateway>/v1/mcp/oauth/callback`。

### 需求4:执行侧注入(共享模型A)

- [ ] **关联键**:agent 的 mcp 条目带 `provider`(agentBuilder 已能产 provider;补 prompt 让它对 github/notion 产 `{name,provider,url,type:'url'}`)。
- [ ] **运行时解析+注入**:runner 组装 agent 给 sandbox 前,对每个有 provider 的 mcp_server:
  - 按 `(workspace_id, provider, oauth_connected=true)` 查 vault_credentials(共享模型:取该 workspace 已连接的那条;多条取最近)。
  - `readCredentialSecret` 解出 access_token。
  - 给该 mcp_server config 注入 `{type:"http", url, headers:{Authorization:"Bearer <token>"}}`(claude-agent-sdk 的 http MCP 格式)。
  - 落点:新函数 `resolveMcpServerCredentials(agent, workspaceId)`,在 `claudeInitPayload`/`vefaasLoopAgentConfig` 组装 mcp_servers 之前调用。注入后再走 `normalizeMcpServers`。
- [ ] **安全**:注入只发生在服务端组装阶段;token 进 sandbox(模型A 接受)。日志脱敏(不打 token)。

### 需求3:验证 token 落库(手段,非代码)

部署后按序验证:
1. **DB 层**:`mysql_child.mjs` 查 `SELECT id,name,auth_type,secret_ref,LEFT(metadata_json,200) FROM vault_credentials WHERE auth_type='oauth' ORDER BY created_at DESC LIMIT 5;` → 看 `secret_ref` 非空 + `metadata.oauth_connected=true` + `oauth_account`。
2. **解密层**:`readCredentialSecret` 能解出 `access_token`(写个一次性脚本,或加只读端点 `GET /v1/vaults/:id/credentials/:cid/status` 返回 `{has_token:bool, expires_at, scope}` 不返 token 本身)。
3. **端到端层**:session 测试发"列出我最近的仓库",看 loop_events 里 MCP 调用返回真实 GitHub 数据(非空、非 401)。

---

## 端到端用例脚本(需求4 验收)

1. Quickstart describe:输入"创建一个能查看我 GitHub 仓库和 PR 的助手"。
2. builder agent 产出 agent config,mcp_servers 含 `{name:'github', provider:'github', url:'https://api.githubcopilot.com/mcp/', type:'url'}`。
3. wizard vault step:检测到 agent 需要 github → 展示"连接 GitHub"(已启用,绿 OAuth)。
4. 用户点连接 → OAuth → 回凭证详情页,token 落库(需求1+3)。
5. wizard session step:发"获取我最近改动的10个repo,以及它们的 open PR/issue"。
6. 期望:agent 经注入的 GitHub MCP 真实返回 repo/PR/issue 列表。

---

## ADR(本次新增,记录决策)

- [ ] `docs/adr/0005-mcp-credentials-shared-vault-with-per-user-todo.md`:
  - 决策:MCP OAuth 凭据当前用 **workspace 共享模型**(token 绑 vault 不绑 user)。
  - 后果:同 workspace 内任何成员调用 agent 都用同一 token(凭据所有者身份)。
  - TODO(模型B):未来支持 **per-user OAuth**——`user_mcp_connections(workspace_id, agent_id/provider, user_id, secret_ref)`,运行时按 session 发起者取各自 token,首次使用触发个人 OAuth。"获取我的repo"类语义最终需要 B。
- [ ] `docs/adr/0006-secret-ciphertext-in-db-for-vefaas-tmp.md`:
  - 决策:secret 密文进 DB 列(对称加密,+master key 走 env),因 veFaaS `/tmp` 非持久 + 多实例不共享。
  - TODO:未来接 KMS(master key 不再走 env,改 KMS 托管 / envelope encryption)。

## GitHub 端点(已确认)

- 先用 catalog 现有 `https://api.githubcopilot.com/mcp/`,**实测**该端点是否接受本 OAuth App 换来的 user-to-server token。
- 若 401/scope 不足(Copilot MCP 可能要 Copilot 订阅或特定 scope)→ 再换能用 user token 的 GitHub MCP 端点 / GitHub REST 轻包装,届时改 catalog `mcp_url`。

## 验证

- `bun run typecheck` + `bun run lint`。
- 本地:模拟注入(单测/脚本)确认 mcp_server 拼出正确 Authorization。
- 云端:重新部署 → dev/SSO 登录 → 走端到端用例脚本 → 截图 + loop_events 证据。
- token 落库三层验证(需求3)。

## 风险

- veFaaS `/tmp` 非持久(P0 已应对)。
- claude-agent-sdk 的 http MCP header 注入格式需按 SDK 版本确认(infra/vefaas/runtime-app 依赖)。
- GitHub Copilot MCP(`api.githubcopilot.com/mcp/`)是否接受纯 user OAuth token、scope 是否够(repo/read:user)——需实测,可能要换 GitHub 官方 MCP 或 PAT 路径。
- 沙箱拦 volcengine:部署必须用户在普通终端跑。

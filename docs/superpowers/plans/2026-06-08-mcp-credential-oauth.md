# MCP Credential OAuth 授权流方案设计

> 状态:设计阶段(未实现)。对应用户诉求 #4 —— 参考 Anthropic Claude managed agent 平台,
> 在 Quickstart 中引入"检测到 MCP 需 token → 弹授权 → 平台托管刷新"的 vault 逻辑。

## 1. 背景与目标

当前 Maple 的 vault credential 是**手动输入**:用户建 vault → 手动粘贴 bearer token →
存入 `vault_credentials`。没有 OAuth 授权流,也没有 token 自动刷新。

Anthropic 的做法(用户截图 4/5):agent config 声明了某个 MCP server(如 Notion),
平台在 Quickstart 阶段**检测**到该 MCP 需要授权,弹出"Authorization required to use
this MCP",用户点 Connect 走 OAuth,授权后平台拿到 token 存入 vault,**之后 token
刷新由平台自动负责**,用户无感。

目标:为 Maple 设计等价能力,让外部用户在 Quickstart 里一键完成 MCP 授权,不必手工管理 token。

## 2. Anthropic Claude Console 流程分析(参考截图)

从截图 4/5 还原的流程:

1. **检测**:agent config(YAML)里 `mcp_servers` 声明了 `notion`(type: url,
   url: `https://mcp.notion.com/mcp`),`tools` 里有 `mcp_toolset` 引用 `notion`。
2. **提示授权**:Quickstart 右侧 stepper 走到"Configure environment",检测到 notion MCP
   需凭证 → 渲染卡片"Add credential for Notion · Allows the agent to write weekly digest
   pages to your Notion field-watch database"。
3. **凭证形态**:卡片提供两种(都 Optional):
   - **Access token**(直接粘贴 bearer)
   - **OAuth client credentials**(走标准 OAuth 授权码流)
4. **共享警告**:"This credential will be shared across this workspace. Anyone with API
   key access can use this credential..." + 用户勾选 acknowledge。
5. **执行**:底层先 `POST /v1/vaults`(建 vault "Field Monitor Vault"),再把 Notion
   credential 加入该 vault。完成后显示"Notion credential added to vault" +
   "Notion is authorized"。
6. **托管刷新**:授权后平台保管 access/refresh token,过期前自动用 refresh_token 续期
   (截图未展示细节,属平台后台职责)。

关键点:**vault 是 workspace 级共享凭证库**,session 在创建时引用 vault → 运行时 MCP
调用用 vault 里的 token。OAuth 只是 credential 的一种 auth_type。

## 3. 本平台现状

| 组件 | 现状 | 文件 |
|---|---|---|
| vault 表 | 有(workspace 级) | `server/store.ts:127` |
| vault_credentials 表 | 有:`auth_type` + `secret_ref` + `metadata_json` | `server/store.ts:135` |
| createVaultCredential | 有(手动) | `server/store.ts:1499` |
| POST credential 端点 | `POST /v1/vaults/:vaultId/credentials` | `server/index.ts:1255` |
| MCP server 声明 | `agent.config.mcp_servers[]`(name/url/type) | — |
| QuickstartView vault 步骤 | 有(手动建 vault + 粘贴) | `src/App.tsx:2908` |
| **OAuth 授权流** | **无** | — |
| **token 自动刷新** | **无** | — |
| 用户登录 OAuth | 有(与本功能无关) | `server/auth.ts` |

`vault_credentials` 现有字段已能承载 OAuth:
- `auth_type`:扩展枚举加 `"oauth2"`。
- `secret_ref`:存 token bundle 引用(见 4.1)。
- `metadata_json`:存 OAuth 配置(authorize_url/token_url/client_id/scopes...)。

所以**不需要建新表**,扩展即可。

## 4. 设计方案

### 4.1 数据模型扩展(零新表)

`vault_credentials.auth_type` 取值扩展:
- `bearer`(现有,手动 token)
- `oauth2`(新)

`secret_ref` 对 `oauth2` 存**加密的 token bundle**(JSON,经 secret store 加密):
```json
{
  "access_token": "...",
  "refresh_token": "...",
  "token_type": "Bearer",
  "expires_at": "2026-06-08T12:00:00Z",
  "scope": "read write"
}
```
> 当前 `secret_ref` 似乎直接存值。生产应接入 KMS/secret store,这里存密文引用。
> 本方案不改密钥存储机制,沿用现状(`secret_ref` 语义),只规定 oauth2 的 payload 结构。

`metadata_json` 对 `oauth2` 存**不敏感的 OAuth 配置**:
```json
{
  "oauth": {
    "provider": "notion",
    "authorize_url": "https://api.notion.com/v1/oauth/authorize",
    "token_url": "https://api.notion.com/v1/oauth/token",
    "client_id": "...",
    "client_secret_ref": "<secret store ref>",
    "redirect_uri": "https://<maple>/v1/vaults/oauth/callback",
    "scopes": ["..."],
    "last_refreshed_at": "2026-06-08T11:00:00Z"
  }
}
```

可选:MCP server 目录(预置常见 MCP 的 OAuth 端点),让前端只需选 provider 即可,
不用用户填 authorize_url/token_url。可放 `server/mcpCatalog.ts`(静态表)。

### 4.2 OAuth 授权流程(授权码 + PKCE)

```
用户在 Quickstart 点 "Connect" (针对某 MCP server)
  │
  ├─ 前端 POST /v1/vaults/:vaultId/credentials/oauth/start
  │     body: { provider, mcp_server_url, client_id, client_secret?, scopes }
  │     后端:生成 state + PKCE verifier,存短期会话(state→{vaultId,verifier,config}),
  │           返回 authorize_url(带 client_id/redirect_uri/state/code_challenge/scope)
  │
  ├─ 前端 window.open(authorize_url) 或同窗跳转
  │
  ├─ 用户在第三方(Notion)同意授权 → 第三方重定向到
  │     GET /v1/vaults/oauth/callback?code=...&state=...
  │
  ├─ 后端 callback:
  │     1. 校验 state(取出 vaultId/verifier/config)
  │     2. POST token_url(code + code_verifier + client_id/secret) 换 token
  │     3. createVaultCredential({ vault_id, auth_type:"oauth2",
  │          secret_ref: encrypt(token bundle), metadata:{oauth config} })
  │     4. 重定向回前端 quickstart(带成功标记)
  │
  └─ 前端轮询/收到回调 → 显示 "X is authorized"
```

PKCE 必须(公共客户端安全)。state 防 CSRF。redirect_uri 必须与第三方后台白名单精确匹配
(复用现有 `MAPLE_WEB_BASE_URL` 模式)。

### 4.3 API 端点(新增)

| 方法 | 路径 | 作用 |
|---|---|---|
| POST | `/v1/vaults/:vaultId/credentials/oauth/start` | 生成 authorize_url + state,返回给前端 |
| GET | `/v1/vaults/oauth/callback` | 第三方回调,换 token,写 credential,重定向前端 |
| POST | `/v1/vaults/:vaultId/credentials/:credId/refresh` | 手动触发刷新(调试用;正常自动) |
| GET | `/v1/mcp_catalog` | (可选)预置 MCP provider 的 OAuth 端点目录 |

授权 state 临时存储:可用内存 Map(TTL 10min)或 `auth_sessions` 风格的临时表。

### 4.4 Token 刷新策略

两种,推荐 **A(惰性) + B(兜底)** 组合:

- **A. 惰性刷新(用时检查)**:运行时(`server/runtime.ts` 取 vault credential 准备 MCP
  调用前)检查 `expires_at`。若 `expires_at - now < 60s` → 用 refresh_token 调 token_url
  续期 → 更新 `secret_ref`。这是主路径,保证 MCP 调用时 token 必然有效。
- **B. 后台兜底**:定时任务(cron/interval)扫 `auth_type='oauth2'` 且即将过期的
  credential,提前刷新。降低首调用延迟。MVP 可省,只做 A。

刷新失败(refresh_token 失效)→ 标记 credential 需重新授权,前端提示用户重连。

### 4.5 前端集成(QuickstartView)

现有 `QuickstartView`(`src/App.tsx:2908`)已有 vault 步骤。扩展:
1. **检测**:agent config 的 `mcp_servers[]` 逐个判断是否需授权(查 mcp_catalog 或 server
   标记 `requires_auth`)。
2. **渲染授权卡片**:对每个需授权的 MCP,显示"Add credential for {name}" + provider 图标
   + 说明 + [Connect] / [Skip for now]。复用上次做的 `Select` / `.dropdown` 暗色风格。
3. **Connect**:调 `oauth/start` → 弹授权窗 → 等回调 → 成功显示"X is authorized"。
4. **Access token 兜底**:同 Anthropic,提供"直接粘贴 access token"作为 oauth 不可用时的
   降级(auth_type=bearer)。
5. **共享警告 + acknowledge 勾选**:照搬 Anthropic 文案(vault 工作区共享)。

### 4.6 安全考虑

- token bundle 必须加密存储(接 KMS/secret store),不可明文落库。
- `client_secret` 不回前端,只存 `client_secret_ref`。
- PKCE + state 强制。
- redirect_uri 白名单精确匹配。
- vault 工作区共享 → 明确告知用户(acknowledge),并受 #1 的 workspace 成员过滤保护
  (只有 workspace 成员能引用该 vault 的 credential)。
- 审计:credential 创建/刷新/使用写 log。

## 5. 实施阶段(若批准)

1. **P0 数据与 API**:扩展 auth_type=oauth2 语义;实现 `oauth/start` + `callback`
   (PKCE/state);credential 写入。
2. **P1 惰性刷新**:`runtime.ts` 取 credential 时检查 expires + refresh。
3. **P2 前端 Quickstart**:检测 + 授权卡片 + Connect 弹窗 + access token 降级。
4. **P3 MCP catalog**:预置常见 MCP(Notion/GitHub/Slack...)的 OAuth 端点,简化用户输入。
5. **P4 后台兜底刷新 + 重连提示**。

## 6. 开放问题(需产品确认)

1. **OAuth client 归属**:平台用**自己注册的** OAuth app(像 Anthropic,用户只授权)?
   还是用户填**自己的** client_id/secret?前者体验好但需平台为每个 MCP provider 注册
   app;后者通用但用户要懂 OAuth。Anthropic 截图两者都给(client credentials Optional)。
2. **secret 存储**:当前 `secret_ref` 是否已接 KMS?若是明文,需先补 secret store 再上 OAuth。
3. **MCP catalog 范围**:先支持哪几个 provider(Notion/GitHub/Slack/Google)?
4. **刷新 token 的调度**:MVP 只做惰性(A),还是要后台定时(B)?
5. **多 credential / 同 provider**:一个 vault 内同 provider 多 credential 如何区分(账号级)?

---

**结论**:Maple 现有 `vault_credentials` 结构足以承载 OAuth,**无需新表**,核心工作量在
①`oauth/start`+`callback` 两个端点(PKCE/state)②运行时惰性刷新 ③Quickstart 检测+授权 UI。
建议先确认第 6 节开放问题(尤其 #1 client 归属、#2 secret 存储),再进入 P0 实施。

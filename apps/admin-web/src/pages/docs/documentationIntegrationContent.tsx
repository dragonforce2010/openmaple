import type { DocContentHelpers, DocPage } from "./DocumentationTypes";

export function vaultsDoc(helpers: DocContentHelpers): DocPage {
  const { L, Code, EndpointList, FieldTable } = helpers;
  return {
            title: "Vaults API",
            lead: L(
              "Vaults 保存 MCP/OAuth/API key 等凭证引用；API 响应不会返回 secret_ref 明文。",
              "Vaults store references for MCP/OAuth/API-key credentials; API responses do not expose secret_ref."
            ),
            sections: [
              {
                id: "endpoints",
                h2: L("接口", "Endpoints"),
                body: (
                  <EndpointList rows={[
                    ["GET /v1/vaults?workspace_id=ws_xxx", L("列出 vaults，带 credential_count。", "List vaults with credential_count.")],
                    ["POST /v1/vaults", L("创建 vault；成功返回 201。", "Create a vault; returns 201.")],
                    ["GET /v1/vaults/:vaultId", L("读取 vault 和 credentials。", "Retrieve a vault and its credentials.")],
                    ["GET /v1/vaults/:vaultId/credentials", L("列出 credentials。", "List credentials.")],
                    ["POST /v1/vaults/:vaultId/credentials", L("创建 credential，并把 secret 写入托管 secret store。", "Create a credential and write the secret into the managed secret store.")],
                    ["PATCH /v1/vaults/:vaultId/credentials/:credId/archive", L("归档 credential。", "Archive a credential.")],
                    ["DELETE /v1/vaults/:vaultId/credentials/:credId", L("当前行为也是归档 credential，返回 { ok: true }。", "Current behavior also archives the credential and returns { ok: true }.")]
                  ]} />
                )
              },
              {
                id: "vault-fields",
                h2: L("Vault 入参/出参", "Vault request/response"),
                body: (
                  <>
                    <FieldTable rows={[
                      { field: "workspace_id", type: "string", required: L("否", "No"), description: L("不传时 workspace key 优先使用所属 workspace，其他登录态回退到当前用户第一个 workspace。", "When omitted, workspace keys default to their bound workspace; other auth defaults to the current user's first workspace.") },
                      { field: "display_name", type: "string", required: L("是", "Yes"), description: L("Vault 展示名。", "Vault display name.") },
                      { field: "metadata", type: "object", required: L("否", "No"), description: L("默认 {}。", "Defaults to {}.") }
                    ]} />
                    <Code>{`{
    "id": "vault_xxx",
    "display_name": "GitHub MCP credentials",
    "workspace_id": "ws_xxx",
    "metadata": { "source": "docs" },
    "credential_count": 1,
    "created_at": "2026-06-09T00:00:00.000Z",
    "updated_at": "2026-06-09T00:00:00.000Z"
  }`}</Code>
                  </>
                )
              },
              {
                id: "credential-fields",
                h2: L("Credential 入参/出参", "Credential request/response"),
                body: (
                  <>
                    <FieldTable rows={[
                      { field: "name", type: "string", required: L("是", "Yes"), description: L("凭证名。", "Credential name.") },
                      { field: "mcp_server_url", type: "url", required: L("否", "No"), description: L("关联 MCP server URL。", "Associated MCP server URL.") },
                      { field: "provider", type: "string", required: L("否", "No"), description: L("写入 metadata.provider，用于 OAuth provider 查找。", "Stored as metadata.provider and used to find the OAuth provider.") },
                      { field: "auth_type", type: "oauth | bearer_token | api_key", required: L("否", "No"), description: L("默认 oauth。", "Defaults to oauth.") },
                      { field: "secret", type: "string", required: L("否", "No"), description: L("写入 secret store；未传时写入包含 auth_type 和 created_at 的 JSON。", "Written to the secret store; when omitted, backend writes JSON containing auth_type and created_at.") },
                      { field: "metadata", type: "object", required: L("否", "No"), description: L("默认 {}。", "Defaults to {}.") }
                    ]} />
                    <Code>{`curl "$MAPLE_API_BASE_URL/v1/vaults/vault_xxx/credentials" \\
    -H "Authorization: Bearer $MAPLE_API_KEY" \\
    -H "Content-Type: application/json" \\
    -d '{
      "name": "github-oauth",
      "provider": "github",
      "mcp_server_url": "https://api.githubcopilot.com/mcp/",
      "auth_type": "oauth",
      "metadata": { "purpose": "repo-review" }
    }'`}</Code>
                    <Code>{`{
    "id": "vcred_secret_xxx",
    "vault_id": "vault_xxx",
    "name": "github-oauth",
    "mcp_server_url": "https://api.githubcopilot.com/mcp/",
    "auth_type": "oauth",
    "metadata": { "provider": "github", "purpose": "repo-review" },
    "workspace_id": "ws_xxx",
    "tenant_id": "tenant_xxx",
    "status": "pending",
    "created_at": "2026-06-09T00:00:00.000Z",
    "updated_at": "2026-06-09T00:00:00.000Z"
  }`}</Code>
                  </>
                )
              }
            ]
          };
}

export function mcpDoc(helpers: DocContentHelpers): DocPage {
  const { L, Code, EndpointList, FieldTable } = helpers;
  return {
            title: "MCP API",
            lead: L(
              "MCP API 覆盖预置 provider catalog、用户自定义 MCP server，以及 server/credential 的 OAuth 授权启动。",
              "The MCP API covers preset provider catalog, user-managed MCP servers, and OAuth start flows for servers and credentials."
            ),
            sections: [
              {
                id: "catalog",
                h2: L("Catalog", "Catalog"),
                body: (
                  <>
                    <p className="doc-p"><code>GET /v1/mcp_catalog</code></p>
                    <Code>{`{
    "data": [{
      "provider": "github",
      "name": "GitHub",
      "icon": "github",
      "description": "Repository and pull request context.",
      "mcp_url": "https://...",
      "auth_type": "oauth2",
      "oauth": true,
      "configured": true,
      "client_env_prefix": "MAPLE_MCP_GITHUB"
    }]
  }`}</Code>
                  </>
                )
              },
              {
                id: "servers",
                h2: L("User-managed MCP servers", "User-managed MCP servers"),
                body: (
                  <>
                    <EndpointList rows={[
                      ["GET /v1/mcp_servers?workspace_id=ws_xxx", L("列出 workspace 内 MCP servers。", "List MCP servers in a workspace.")],
                      ["POST /v1/mcp_servers", L("创建 MCP server。", "Create an MCP server.")],
                      ["PATCH /v1/mcp_servers/:mcpId", L("更新 name/mcp_url/auth_type/config。", "Update name/mcp_url/auth_type/config.")],
                      ["DELETE /v1/mcp_servers/:mcpId", L("归档 MCP server。", "Archive an MCP server.")]
                    ]} />
                    <FieldTable rows={[
                      { field: "workspace_id", type: "string", required: L("否", "No"), description: L("不传时 workspace key 优先使用所属 workspace，其他登录态回退到当前用户第一个 workspace。", "When omitted, workspace keys default to their bound workspace; other auth defaults to the current user's first workspace.") },
                      { field: "name", type: "string", required: L("是", "Yes"), description: L("MCP server 名称。", "MCP server name.") },
                      { field: "provider", type: "string", required: L("否", "No"), description: L("预置 catalog provider id。", "Preset catalog provider id.") },
                      { field: "mcp_url", type: "string", required: L("是", "Yes"), description: L("MCP endpoint。", "MCP endpoint.") },
                      { field: "auth_type", type: "oauth2 | bearer | none", required: L("否", "No"), description: L("默认 none。", "Defaults to none.") },
                      { field: "config", type: "object", required: L("否", "No"), description: L("默认 {}，OAuth 成功后会写 oauth_secret_ref 等非明文状态。", "Defaults to {}; OAuth success stores oauth_secret_ref and non-secret status fields.") }
                    ]} />
                  </>
                )
              },
              {
                id: "oauth",
                h2: L("OAuth start/callback", "OAuth start/callback"),
                body: (
                  <>
                    <EndpointList rows={[
                      ["POST /v1/mcp_servers/:mcpId/oauth/start", L("为 user-managed MCP server 启动 OAuth。", "Start OAuth for a user-managed MCP server.")],
                      ["POST /v1/vaults/:vaultId/credentials/:credId/oauth/start", L("为 vault credential 启动 OAuth。", "Start OAuth for a vault credential.")],
                      ["GET /v1/mcp/oauth/callback", L("OAuth provider 回调；成功后重定向到 MAPLE_WEB_BASE_URL 并标记连接状态。", "OAuth provider callback; redirects to MAPLE_WEB_BASE_URL and marks connection status on success.")]
                    ]} />
                    <p className="doc-p">
                      {L(
                        "start 接口校验 provider 是否支持 OAuth、client 是否通过环境变量配置，然后生成 state、PKCE verifier/challenge，并返回 authorize_url。",
                        "The start endpoint checks provider OAuth support and client env configuration, creates state plus PKCE verifier/challenge, and returns authorize_url."
                      )}
                    </p>
                    <Code>{`{
    "authorize_url": "https://provider.example/oauth/authorize?client_id=...&redirect_uri=...&response_type=code&state=...&code_challenge=...&code_challenge_method=S256&scope=..."
  }`}</Code>
                  </>
                )
              }
            ]
          };
}

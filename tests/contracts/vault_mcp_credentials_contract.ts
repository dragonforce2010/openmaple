import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { normalizeProviderAgentDraft } from "../../apps/control-plane-api/src/agents/agentBuilder";
import { encryptSecret } from "../../apps/control-plane-api/src/secrets";
import { injectMcpCredentials, withInjectedMcpCredentials } from "../../apps/control-plane-api/src/runtime/mcpCredentialInjection";
import type { AgentConfig } from "../../apps/control-plane-api/src/types";

process.env.MAPLE_DATA_DIR = mkdtempSync(join(tmpdir(), "maple-vault-mcp-"));
process.env.MAPLE_SECRET_MASTER_KEY = Buffer.alloc(32, 7).toString("base64");
process.env.MAPLE_AGENT_RUNTIME_PROVIDER = "local";

const store = await import("../../apps/control-plane-api/src/store");

let tenantId = "";
let workspaceId = "";
let userId = "";
let vaultId = "";
let credentialId = "";

try {
  store.initDatabase();
  const user = store.ensureUserByEmail({ email: `vault-mcp-contract-${Date.now()}@example.com`, name: "Vault MCP Contract" });
  assert.ok(user?.id);
  userId = String(user.id);

  const onboarding = store.createWorkspaceOnboarding({
    user_id: userId,
    tenant: { name: "Vault MCP Contract Tenant" },
    workspace: { name: "Vault MCP Contract Workspace", slug: `vault-mcp-${Date.now().toString(36)}` },
    runtime_provider: "vefaas",
    sandbox_provider: "e2b",
    runtime_pool: { desired_size: 0, min_instances_per_function: 0, max_instances_per_function: 1, max_concurrency_per_instance: 1, cpu_milli: 1000, memory_mb: 1024 },
    sandbox_pool: { desired_size: 1, standby_ttl_ms: 30 * 60 * 1000 },
    model_config_ids: [],
    api_key: { display_name: "contract key", scopes: ["control_plane"] },
    provisioning_mode: "manual"
  });
  workspaceId = String((onboarding.workspace as Record<string, unknown>).id);
  tenantId = String((onboarding.tenant as Record<string, unknown>).id);

  const vault = store.createVault({ display_name: "Vault MCP Contract", workspace_id: workspaceId });
  vaultId = String(vault.id);
  const bundle = JSON.stringify({ access_token: "gh_contract_token", token_type: "bearer", expires_at: "2099-01-01T00:00:00.000Z" });
  const credential = store.createVaultCredential({
    vault_id: vaultId,
    name: "GitHub OAuth",
    mcp_server_url: "https://api.githubcopilot.com/mcp/",
    auth_type: "oauth",
    secret_ref: "local-secret://missing-on-purpose",
    secret_cipher: encryptSecret(bundle),
    metadata: { provider: "github", oauth_connected: true }
  });
  assert.ok(credential?.id);
  assert.equal("secret_ref" in credential, false, "credential response must not expose secret_ref");
  assert.equal("secret_cipher" in credential, false, "credential response must not expose secret_cipher");
  credentialId = String(credential.id);

  const secret = store.readCredentialSecret(store.db.prepare("SELECT * FROM vault_credentials WHERE id = ?").get(credentialId) as Record<string, unknown>);
  assert.equal(JSON.parse(String(secret)).access_token, "gh_contract_token", "secret_cipher is readable without the local secret file");

  const token = store.findWorkspaceProviderToken(workspaceId, "github");
  assert.deepEqual(token, { credentialId, accessToken: "gh_contract_token" }, "workspace/provider resolves latest connected OAuth token");

  const injected = injectMcpCredentials([{ name: "github", provider: "github", url: "https://api.githubcopilot.com/mcp/", type: "url" }], workspaceId);
  assert.equal(injected[0].type, "http");
  assert.equal((injected[0].headers as Record<string, unknown>).Authorization, "Bearer gh_contract_token");

  const agent = { name: "GitHub Agent", mcp_servers: [{ name: "github", provider: "github", url: "https://api.githubcopilot.com/mcp/", type: "url" }] } as AgentConfig;
  assert.equal(((withInjectedMcpCredentials(agent, workspaceId).mcp_servers[0] as Record<string, unknown>).headers as Record<string, unknown>).Authorization, "Bearer gh_contract_token");

  const githubDraft = normalizeProviderAgentDraft(JSON.stringify({
    name: "GitHub assistant",
    description: "Can inspect GitHub repositories and PRs.",
    model: { provider: "custom", id: "glm-4-7-251222", speed: "standard" },
    agent_loop: { type: "anthropic_claude_code", config: {}, hooks: [] },
    system: "Use GitHub MCP.",
    tools: [{ type: "agent_toolset", configs: { read: true } }],
    mcp_servers: [{ name: "github", provider: "github", url: "https://api.githubcopilot.com/mcp/", type: "url" }],
    skills: []
  }), "创建一个能查看我 GitHub 仓库和 PR 的助手");
  assert.equal(githubDraft.mcp_servers[0].provider, "github");
  assert.equal(githubDraft.agent_loop.config?.execution, "external");

  console.log("vault_mcp_credentials_contract: OK");
} finally {
  if (credentialId) store.db.prepare("DELETE FROM vault_credentials WHERE id = ?").run(credentialId);
  if (vaultId) store.db.prepare("DELETE FROM vaults WHERE id = ?").run(vaultId);
  if (workspaceId) {
    store.db.prepare("DELETE FROM environments WHERE workspace_id = ?").run(workspaceId);
    store.db.prepare("DELETE FROM workspace_api_keys WHERE workspace_id = ?").run(workspaceId);
    store.db.prepare("DELETE FROM workspace_runtime_pool_members WHERE workspace_id = ?").run(workspaceId);
    store.db.prepare("DELETE FROM workspace_runtime_pools WHERE workspace_id = ?").run(workspaceId);
    store.db.prepare("DELETE FROM workspace_members WHERE workspace_id = ?").run(workspaceId);
    store.db.prepare("DELETE FROM workspaces WHERE id = ?").run(workspaceId);
  }
  if (tenantId) {
    store.db.prepare("DELETE FROM tenant_members WHERE tenant_id = ?").run(tenantId);
    store.db.prepare("DELETE FROM tenants WHERE id = ?").run(tenantId);
  }
  if (userId) store.db.prepare("DELETE FROM users WHERE id = ?").run(userId);
}

import type { Express } from "express";
import type { AuthenticatedRequest } from "./routeDeps";
import {
  MCP_CATALOG,
  analyticsOverview,
  archiveMcpServer,
  canAccessWorkspace,
  createHash,
  createMcpServer,
  currentUser,
  encryptSecret,
  getMcpServer,
  getRawVaultCredential,
  getVault,
  getVaultCredential,
  listConnectedOauthCredentials,
  listMcpServers,
  mcpCatalogEntry,
  mcpProviderClient,
  randomBytes,
  readCredentialSecret,
  readSecret,
  safeWebReturnPath,
  updateMcpServer,
  updateVaultCredential,
  writeSecret,
  z
} from "./routeDeps";
import { accessibleWorkspaceIds, fallbackWorkspaceId, routeParam, scopeByWorkspace, webRedirectUrl } from "./routeHelpers";
export function registerMcpRoutes(app: Express) {
app.get("/v1/analytics/overview", (request: AuthenticatedRequest, response) => {
  response.json(analyticsOverview([...accessibleWorkspaceIds(currentUser(request).id)]));
});

// MCP catalog (preset providers) + user-managed MCP endpoints
app.get("/v1/mcp_catalog", (_request, response) => {
  response.json({
    data: MCP_CATALOG.map((entry) => ({
      provider: entry.provider,
      name: entry.name,
      icon: entry.icon,
      description: entry.description,
      mcp_url: entry.mcp_url,
      auth_type: entry.auth_type,
      oauth: Boolean(entry.oauth),
      configured: Boolean(mcpProviderClient(entry.provider)),
      client_env_prefix: entry.oauth?.client_env_prefix ?? ""
    }))
  });
});

app.get("/v1/mcp_servers", (request: AuthenticatedRequest, response) => {
  const user = currentUser(request);
  const userId = user.id;
  const workspaceId = typeof request.query.workspace_id === "string" ? request.query.workspace_id : null;
  if (workspaceId && !canAccessWorkspace(userId, workspaceId)) return response.status(403).json({ error: "workspace_forbidden" });
  const servers = workspaceId ? listMcpServers(workspaceId) : scopeByWorkspace(listMcpServers(), accessibleWorkspaceIds(userId));
  response.json({ data: servers });
});

app.post("/v1/mcp_servers", (request: AuthenticatedRequest, response) => {
  const user = currentUser(request);
  const userId = user.id;
  const schema = z.object({
    workspace_id: z.string().optional(),
    name: z.string().min(1),
    provider: z.string().optional(),
    mcp_url: z.string().min(1),
    auth_type: z.enum(["oauth2", "bearer", "none"]).default("none"),
    config: z.record(z.string(), z.unknown()).default({})
  });
  const parsed = schema.safeParse(request.body);
  if (!parsed.success) return response.status(400).json(parsed.error.flatten());
  const workspaceId = fallbackWorkspaceId(user, parsed.data.workspace_id ?? null);
  if (workspaceId && !canAccessWorkspace(userId, workspaceId)) return response.status(403).json({ error: "workspace_forbidden" });
  response.status(201).json(createMcpServer({
    workspace_id: workspaceId ?? "",
    name: parsed.data.name,
    provider: parsed.data.provider ?? null,
    mcp_url: parsed.data.mcp_url,
    auth_type: parsed.data.auth_type,
    config: parsed.data.config,
    created_by_user_id: userId
  }));
});

app.patch("/v1/mcp_servers/:mcpId", (request: AuthenticatedRequest, response) => {
  const existing = getMcpServer(routeParam(request.params.mcpId));
  if (!existing) return response.status(404).json({ error: "mcp_server_not_found" });
  if (!canAccessWorkspace(currentUser(request).id, String((existing as { workspace_id?: unknown }).workspace_id))) return response.status(403).json({ error: "workspace_forbidden" });
  const schema = z.object({ name: z.string().min(1).optional(), mcp_url: z.string().min(1).optional(), auth_type: z.enum(["oauth2", "bearer", "none"]).optional(), config: z.record(z.string(), z.unknown()).optional() });
  const parsed = schema.safeParse(request.body);
  if (!parsed.success) return response.status(400).json(parsed.error.flatten());
  response.json(updateMcpServer(routeParam(request.params.mcpId), parsed.data));
});

app.delete("/v1/mcp_servers/:mcpId", (request: AuthenticatedRequest, response) => {
  const existing = getMcpServer(routeParam(request.params.mcpId));
  if (!existing) return response.status(404).json({ error: "mcp_server_not_found" });
  if (!canAccessWorkspace(currentUser(request).id, String((existing as { workspace_id?: unknown }).workspace_id))) return response.status(403).json({ error: "workspace_forbidden" });
  archiveMcpServer(routeParam(request.params.mcpId));
  response.json({ ok: true });
});

// ── MCP OAuth authorization flow (authorization code + PKCE) ──
type McpOAuthClient = { client_id: string; client_secret: string };
const mcpOauthStates = new Map<string, { kind: "mcp_server" | "credential"; mcpServerId?: string; credentialId?: string; vaultId?: string; verifier: string; provider: string; userId: string; returnTo: string; createdAt: number; client?: McpOAuthClient; customClient?: boolean }>();

function mcpPkce() {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

function mcpCallbackUrl(request: AuthenticatedRequest) {
  const base = process.env.MAPLE_CONTROL_PLANE_BASE_URL || `${request.protocol}://${request.get("host")}`;
  return `${base.replace(/\/$/, "")}/v1/mcp/oauth/callback`;
}

function mcpOauthReturnTo(request: AuthenticatedRequest) {
  return safeWebReturnPath((request.body as { return_to?: unknown } | undefined)?.return_to);
}

function mcpRedirect(returnTo: string, params: Record<string, string>) {
  const target = webRedirectUrl(returnTo || "/");
  const url = new URL(target, "https://maple.local");
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return /^https?:\/\//i.test(target) ? url.toString() : `${url.pathname}${url.search}${url.hash}`;
}

function credentialOAuthClient(credentialId: string, provider: string): { client: McpOAuthClient; custom: boolean } | null {
  const raw = getRawVaultCredential(credentialId);
  const secret = raw ? readCredentialSecret(raw) : null;
  if (secret) {
    try {
      const parsed = JSON.parse(secret) as { oauth_client?: { client_id?: unknown; client_secret?: unknown } };
      const clientId = String(parsed.oauth_client?.client_id || "");
      const clientSecret = String(parsed.oauth_client?.client_secret || "");
      if (clientId && clientSecret) return { client: { client_id: clientId, client_secret: clientSecret }, custom: true };
    } catch {
      // Existing access-token bundles and placeholders are not custom OAuth clients.
    }
  }
  const client = mcpProviderClient(provider);
  return client ? { client, custom: false } : null;
}

app.post("/v1/mcp_servers/:mcpId/oauth/start", (request: AuthenticatedRequest, response) => {
  const userId = currentUser(request).id;
  const server = getMcpServer(routeParam(request.params.mcpId)) as { id?: string; workspace_id?: unknown; provider?: unknown } | null;
  if (!server) return response.status(404).json({ error: "mcp_server_not_found" });
  if (!canAccessWorkspace(userId, String(server.workspace_id))) return response.status(403).json({ error: "workspace_forbidden" });
  const provider = String(server.provider || "");
  const entry = mcpCatalogEntry(provider);
  if (!entry?.oauth) return response.status(400).json({ error: "provider_has_no_oauth" });
  const client = mcpProviderClient(provider);
  if (!client) return response.status(400).json({ error: "oauth_client_not_configured", hint: `set ${entry.oauth.client_env_prefix}_CLIENT_ID / _CLIENT_SECRET` });
  const { verifier, challenge } = mcpPkce();
  const state = randomBytes(16).toString("base64url");
  mcpOauthStates.set(state, { kind: "mcp_server", mcpServerId: String(server.id), verifier, provider, userId, returnTo: mcpOauthReturnTo(request), createdAt: Date.now() });
  const url = new URL(entry.oauth.authorize_url);
  url.searchParams.set("client_id", client.client_id);
  url.searchParams.set("redirect_uri", mcpCallbackUrl(request));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  if (entry.oauth.scopes.length) url.searchParams.set("scope", entry.oauth.scopes.join(" "));
  response.json({ authorize_url: url.toString() });
});

// Vault credential OAuth: kick off the authorization flow for a credential whose provider supports OAuth.
app.post("/v1/vaults/:vaultId/credentials/:credId/oauth/start", (request: AuthenticatedRequest, response) => {
  const userId = currentUser(request).id;
  const vaultId = routeParam(request.params.vaultId);
  const credId = routeParam(request.params.credId);
  const vault = getVault(vaultId) as { workspace_id?: unknown } | null;
  if (!vault) return response.status(404).json({ error: "vault_not_found" });
  if (vault.workspace_id && !canAccessWorkspace(userId, String(vault.workspace_id))) return response.status(403).json({ error: "workspace_forbidden" });
  const credential = getVaultCredential(credId) as { id?: string; vault_id?: unknown; metadata?: Record<string, unknown> } | null;
  if (!credential || String(credential.vault_id) !== vaultId) return response.status(404).json({ error: "credential_not_found" });
  const provider = String(credential.metadata?.provider || "");
  const entry = mcpCatalogEntry(provider);
  if (!entry?.oauth) return response.status(400).json({ error: "provider_has_no_oauth" });
  const clientResult = credentialOAuthClient(String(credential.id), provider);
  if (!clientResult) return response.status(400).json({ error: "oauth_client_not_configured", hint: `set ${entry.oauth.client_env_prefix}_CLIENT_ID / _CLIENT_SECRET` });
  const client = clientResult.client;
  const { verifier, challenge } = mcpPkce();
  const state = randomBytes(16).toString("base64url");
  mcpOauthStates.set(state, { kind: "credential", credentialId: String(credential.id), vaultId, verifier, provider, userId, returnTo: mcpOauthReturnTo(request), createdAt: Date.now(), client, customClient: clientResult.custom });
  const url = new URL(entry.oauth.authorize_url);
  url.searchParams.set("client_id", client.client_id);
  url.searchParams.set("redirect_uri", mcpCallbackUrl(request));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  if (entry.oauth.scopes.length) url.searchParams.set("scope", entry.oauth.scopes.join(" "));
  response.json({ authorize_url: url.toString() });
});

app.get("/v1/mcp/oauth/callback", async (request: AuthenticatedRequest, response) => {
  const code = typeof request.query.code === "string" ? request.query.code : "";
  const state = typeof request.query.state === "string" ? request.query.state : "";
  const session = mcpOauthStates.get(state);
  if (!session || !code) return response.redirect(mcpRedirect("/", { mcp_error: "invalid_state" }));
  mcpOauthStates.delete(state);
  const entry = mcpCatalogEntry(session.provider);
  const client = session.client || mcpProviderClient(session.provider);
  if (!entry?.oauth || !client) return response.redirect(mcpRedirect(session.returnTo, { mcp_error: "oauth_not_configured" }));
  try {
    const tokenResponse = await fetch(entry.oauth.token_url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: mcpCallbackUrl(request), client_id: client.client_id, client_secret: client.client_secret, code_verifier: session.verifier })
    });
    const token = (await tokenResponse.json()) as Record<string, unknown>;
    if (!tokenResponse.ok) throw new Error(`token exchange failed: ${JSON.stringify(token)}`);
    const expiresAt = typeof token.expires_in === "number" ? new Date(Date.now() + token.expires_in * 1000).toISOString() : null;
    const bundle = { access_token: token.access_token, refresh_token: token.refresh_token ?? null, token_type: token.token_type ?? "Bearer", expires_at: expiresAt, scope: token.scope ?? null, ...(session.customClient && session.client ? { oauth_client: session.client } : {}) };
    const bundleJson = JSON.stringify(bundle);
    if (session.kind === "credential" && session.credentialId) {
      const secretRef = writeSecret(`cred_oauth_${session.credentialId}_${Date.now()}`, bundleJson);
      const cred = getVaultCredential(session.credentialId) as { metadata?: Record<string, unknown> } | null;
      // Persist the ciphertext in the DB too so the token survives a non-persistent secretsDir (veFaaS /tmp).
      updateVaultCredential(session.credentialId, { secret_ref: secretRef, secret_cipher: encryptSecret(bundleJson), metadata: { ...(cred?.metadata ?? {}), provider: session.provider, oauth_connected: true, oauth_account: String(token.account_id ?? token.workspace_name ?? session.provider), oauth_connected_at: new Date().toISOString() } });
      return response.redirect(mcpRedirect(session.returnTo, { credential_connected: session.provider, ...(session.vaultId ? { vault: session.vaultId } : {}) }));
    }
    const secretRef = writeSecret(`mcp_oauth_${session.mcpServerId}_${Date.now()}`, JSON.stringify(bundle));
    const current = getMcpServer(String(session.mcpServerId)) as { config?: Record<string, unknown> } | null;
    updateMcpServer(String(session.mcpServerId), { config: { ...(current?.config ?? {}), oauth_secret_ref: secretRef, oauth_connected: true, oauth_account: String(token.account_id ?? token.workspace_name ?? session.provider), oauth_connected_at: new Date().toISOString() } });
    response.redirect(mcpRedirect(session.returnTo, { mcp_connected: session.provider }));
  } catch (error) {
    response.redirect(mcpRedirect(session.returnTo, { mcp_error: error instanceof Error ? error.message : String(error) }));
  }
});

// ── P2: periodic OAuth token refresh (platform-managed) ──
async function refreshMcpOauthTokens() {
  for (const server of listMcpServers()) {
    const config = (server as { config?: Record<string, unknown> }).config ?? {};
    if (!config.oauth_secret_ref || !config.oauth_connected) continue;
    const provider = String((server as { provider?: unknown }).provider || "");
    try {
      const bundle = JSON.parse(readSecret(String(config.oauth_secret_ref))) as Record<string, unknown>;
      const expiresAt = bundle.expires_at ? new Date(String(bundle.expires_at)).getTime() : 0;
      if (!bundle.refresh_token || !expiresAt || expiresAt - Date.now() > 5 * 60_000) continue; // only refresh within 5min of expiry
      const entry = mcpCatalogEntry(provider);
      const bundleClient = (bundle.oauth_client ?? null) as { client_id?: unknown; client_secret?: unknown } | null;
      const client = bundleClient?.client_id && bundleClient?.client_secret ? { client_id: String(bundleClient.client_id), client_secret: String(bundleClient.client_secret) } : mcpProviderClient(provider);
      if (!entry?.oauth || !client) continue;
      const tokenResponse = await fetch(entry.oauth.token_url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
        body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: String(bundle.refresh_token), client_id: client.client_id, client_secret: client.client_secret })
      });
      const token = (await tokenResponse.json()) as Record<string, unknown>;
      if (!tokenResponse.ok) continue;
      const newExpiresAt = typeof token.expires_in === "number" ? new Date(Date.now() + token.expires_in * 1000).toISOString() : null;
      const newBundle = { access_token: token.access_token, refresh_token: token.refresh_token ?? bundle.refresh_token, token_type: token.token_type ?? "Bearer", expires_at: newExpiresAt, scope: token.scope ?? bundle.scope, ...(bundleClient ? { oauth_client: bundleClient } : {}) };
      const newRef = writeSecret(`mcp_oauth_${(server as { id?: string }).id}_${Date.now()}`, JSON.stringify(newBundle));
      updateMcpServer(String((server as { id?: string }).id), { config: { ...config, oauth_secret_ref: newRef, oauth_refreshed_at: new Date().toISOString() } });
    } catch { /* skip on error; next tick retries */ }
  }
  for (const row of listConnectedOauthCredentials()) {
    const metadata = JSON.parse(String(row.metadata_json ?? "{}")) as Record<string, unknown>;
    if (!metadata.oauth_connected) continue;
    const provider = String(metadata.provider || "");
    try {
      const secretJson = readCredentialSecret(row);
      if (!secretJson) continue;
      const bundle = JSON.parse(secretJson) as Record<string, unknown>;
      const expiresAt = bundle.expires_at ? new Date(String(bundle.expires_at)).getTime() : 0;
      if (!bundle.refresh_token || !expiresAt || expiresAt - Date.now() > 5 * 60_000) continue; // only refresh within 5min of expiry
      const entry = mcpCatalogEntry(provider);
      const bundleClient = (bundle.oauth_client ?? null) as { client_id?: unknown; client_secret?: unknown } | null;
      const client = bundleClient?.client_id && bundleClient?.client_secret ? { client_id: String(bundleClient.client_id), client_secret: String(bundleClient.client_secret) } : mcpProviderClient(provider);
      if (!entry?.oauth || !client) continue;
      const tokenResponse = await fetch(entry.oauth.token_url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
        body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: String(bundle.refresh_token), client_id: client.client_id, client_secret: client.client_secret })
      });
      const token = (await tokenResponse.json()) as Record<string, unknown>;
      if (!tokenResponse.ok) continue;
      const newExpiresAt = typeof token.expires_in === "number" ? new Date(Date.now() + token.expires_in * 1000).toISOString() : null;
      const newBundle = { access_token: token.access_token, refresh_token: token.refresh_token ?? bundle.refresh_token, token_type: token.token_type ?? "Bearer", expires_at: newExpiresAt, scope: token.scope ?? bundle.scope, ...(bundleClient ? { oauth_client: bundleClient } : {}) };
      const newBundleJson = JSON.stringify(newBundle);
      const newRef = writeSecret(`cred_oauth_${String(row.id)}_${Date.now()}`, newBundleJson);
      updateVaultCredential(String(row.id), { secret_ref: newRef, secret_cipher: encryptSecret(newBundleJson), metadata: { ...metadata, oauth_refreshed_at: new Date().toISOString() } });
    } catch { /* skip on error; next tick retries */ }
  }
}
if (process.env.MAPLE_MCP_OAUTH_REFRESH !== "false") {
  const timer = setInterval(() => { void refreshMcpOauthTokens(); }, Number(process.env.MAPLE_MCP_OAUTH_REFRESH_INTERVAL_MS || 60_000));
  timer.unref();
}
}

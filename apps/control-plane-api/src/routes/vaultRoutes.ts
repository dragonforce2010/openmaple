import type { Express, Response } from "express";
import type { AuthenticatedRequest } from "./routeDeps";
import {
  archiveVaultCredential,
  canAccessWorkspace,
  createVault,
  createVaultCredential,
  currentUser,
  encryptSecret,
  getVault,
  getVaultCredential,
  listVaultCredentials,
  listVaults,
  nanoid,
  writeSecret,
  z
} from "./routeDeps";
import {
  accessibleWorkspaceIds,
  canAccessScopedRecord,
  fallbackWorkspaceId,
  routeParam,
  scopeByWorkspace
} from "./routeHelpers";
export function registerVaultRoutes(app: Express) {
app.get("/v1/vaults", (request: AuthenticatedRequest, response) => {
  const userId = currentUser(request).id;
  const workspaceId = typeof request.query.workspace_id === "string" ? request.query.workspace_id : null;
  if (workspaceId && !canAccessWorkspace(userId, workspaceId)) return response.status(403).json({ error: "workspace_forbidden" });
  const vaults = workspaceId ? listVaults(workspaceId) : scopeByWorkspace(listVaults(), accessibleWorkspaceIds(userId));
  response.json({ data: vaults });
});

app.post("/v1/vaults", (request: AuthenticatedRequest, response) => {
  const user = currentUser(request);
  const schema = z.object({
    workspace_id: z.string().optional(),
    display_name: z.string().min(1),
    metadata: z.record(z.string(), z.unknown()).default({})
  });
  const parsed = schema.safeParse(request.body);
  if (!parsed.success) return response.status(400).json(parsed.error.flatten());
  if (parsed.data.workspace_id && !canAccessWorkspace(user.id, parsed.data.workspace_id)) {
    return response.status(403).json({ error: "workspace_forbidden" });
  }
  response.status(201).json(createVault({ ...parsed.data, workspace_id: fallbackWorkspaceId(user, parsed.data.workspace_id ?? null) ?? undefined }));
});

app.get("/v1/vaults/:vaultId", (request: AuthenticatedRequest, response) => {
  const vault = getVault(routeParam(request.params.vaultId));
  if (!vault) return response.status(404).json({ error: "vault_not_found" });
  if (!canAccessScopedRecord(currentUser(request).id, vault)) return response.status(403).json({ error: "workspace_forbidden" });
  response.json({ ...vault, credentials: listVaultCredentials(routeParam(request.params.vaultId)) });
});

app.get("/v1/vaults/:vaultId/credentials", (request: AuthenticatedRequest, response) => {
  const vault = getVault(routeParam(request.params.vaultId));
  if (!vault) return response.status(404).json({ error: "vault_not_found" });
  if (!canAccessScopedRecord(currentUser(request).id, vault)) return response.status(403).json({ error: "workspace_forbidden" });
  response.json({ data: listVaultCredentials(routeParam(request.params.vaultId)) });
});

app.post("/v1/vaults/:vaultId/credentials", (request: AuthenticatedRequest, response) => {
  const vault = getVault(routeParam(request.params.vaultId));
  if (!vault) return response.status(404).json({ error: "vault_not_found" });
  if (!canAccessScopedRecord(currentUser(request).id, vault)) return response.status(403).json({ error: "workspace_forbidden" });
  const schema = z.object({
    name: z.string().min(1),
    mcp_server_url: z.string().url().optional(),
    provider: z.string().optional(),
    auth_type: z.enum(["oauth", "bearer_token", "api_key"]).default("oauth"),
    secret: z.string().default(""),
    oauth_client: z.object({ client_id: z.string().min(1), client_secret: z.string().min(1) }).optional(),
    metadata: z.record(z.string(), z.unknown()).default({})
  });
  const parsed = schema.safeParse(request.body);
  if (!parsed.success) return response.status(400).json(parsed.error.flatten());
  const credentialId = `vcred_secret_${nanoid(10)}`;
  const secretValue = parsed.data.secret || JSON.stringify({ auth_type: parsed.data.auth_type, created_at: new Date().toISOString(), ...(parsed.data.oauth_client ? { oauth_client: parsed.data.oauth_client } : {}) });
  const secretRef = writeSecret(credentialId, secretValue);
  const credential = createVaultCredential({
    vault_id: routeParam(request.params.vaultId),
    name: parsed.data.name,
    mcp_server_url: parsed.data.mcp_server_url,
    auth_type: parsed.data.auth_type,
    secret_ref: secretRef,
    secret_cipher: encryptSecret(secretValue),
    metadata: { ...parsed.data.metadata, ...(parsed.data.provider ? { provider: parsed.data.provider } : {}) }
  });
  response.status(201).json(credential);
});

function scopedVaultCredential(request: AuthenticatedRequest, response: Response) {
  const vaultId = routeParam(request.params.vaultId);
  const credId = routeParam(request.params.credId);
  const vault = getVault(vaultId);
  if (!vault) {
    response.status(404).json({ error: "vault_not_found" });
    return null;
  }
  if (!canAccessScopedRecord(currentUser(request).id, vault)) {
    response.status(403).json({ error: "workspace_forbidden" });
    return null;
  }
  const credential = getVaultCredential(credId);
  if (!credential || String((credential as { vault_id?: unknown }).vault_id) !== vaultId) {
    response.status(404).json({ error: "credential_not_found" });
    return null;
  }
  return credential;
}

app.get("/v1/vaults/:vaultId/credentials/:credId", (request: AuthenticatedRequest, response) => {
  const credential = scopedVaultCredential(request, response);
  if (!credential) return;
  response.json({ ...credential, vault: getVault(routeParam(request.params.vaultId)) });
});

app.patch("/v1/vaults/:vaultId/credentials/:credId/archive", (request: AuthenticatedRequest, response) => {
  const credential = scopedVaultCredential(request, response);
  if (!credential) return;
  archiveVaultCredential(routeParam(request.params.credId));
  response.json({ ok: true });
});

app.delete("/v1/vaults/:vaultId/credentials/:credId", (request: AuthenticatedRequest, response) => {
  const credential = scopedVaultCredential(request, response);
  if (!credential) return;
  archiveVaultCredential(routeParam(request.params.credId));
  response.json({ ok: true });
});

// real analytics (counts + recent events over the user's workspaces)
}

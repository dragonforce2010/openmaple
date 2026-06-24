import { nanoid } from "nanoid";
import type { JsonRecord } from "../types";
import { decryptSecret, encryptSecret, readSecret } from "../secrets";
import { db, fromJson, now, toJson } from "./storeCore";
import { hydrateMemoryRow, hydrateVaultCredential } from "./storeHydrators";
import { assertMemoryContent, hashMemoryContent, normalizeMemoryPath, normalizeMemoryProvider, record, secretHint } from "./storeMemoryUtils";
import { scopeForParent, scopeForWorkspace } from "./storeAgentsEnvironments";

export function createVault(input: { display_name: string; metadata?: JsonRecord; workspace_id?: string | null }) {
  const stamp = now();
  const id = `vault_${nanoid(10)}`;
  const scope = scopeForWorkspace(input.workspace_id);
  db.prepare(`
    INSERT INTO vaults (id, display_name, metadata_json, workspace_id, tenant_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, input.display_name, toJson(input.metadata), scope.workspace_id, scope.tenant_id, stamp, stamp);
  return { id, display_name: input.display_name, metadata: input.metadata ?? {}, workspace_id: scope.workspace_id, created_at: stamp, updated_at: stamp };
}

export function listVaults(workspaceId?: string | null) {
  const rows = (workspaceId
    ? db.prepare("SELECT * FROM vaults WHERE archived_at IS NULL AND workspace_id = ? ORDER BY created_at DESC").all(workspaceId)
    : db.prepare("SELECT * FROM vaults WHERE archived_at IS NULL ORDER BY created_at DESC").all()) as JsonRecord[];
  if (!rows.length) return [];
  // batch credential counts in one grouped query instead of one COUNT(*) per vault (N+1)
  const ids = rows.map((row) => String(row.id));
  const counts = db
    .prepare(`SELECT vault_id, COUNT(*) AS count FROM vault_credentials WHERE archived_at IS NULL AND vault_id IN (${ids.map(() => "?").join(",")}) GROUP BY vault_id`)
    .all(...ids) as { vault_id: string; count: number }[];
  const countByVault = new Map(counts.map((entry) => [entry.vault_id, Number(entry.count)]));
  return rows.map((row) => ({
    ...row,
    metadata: fromJson(String(row.metadata_json), {}),
    credential_count: countByVault.get(String(row.id)) ?? 0
  }));
}

export function getVault(id: string) {
  const row = db.prepare("SELECT * FROM vaults WHERE id = ? AND archived_at IS NULL").get(id) as JsonRecord | undefined;
  if (!row) return null;
  const credentialCount = (db
    .prepare("SELECT COUNT(*) AS count FROM vault_credentials WHERE vault_id = ? AND archived_at IS NULL")
    .get(id) as { count: number }).count;
  return { ...row, metadata: fromJson(String(row.metadata_json), {}), credential_count: credentialCount };
}

export function createVaultCredential(input: {
  vault_id: string;
  name: string;
  mcp_server_url?: string | null;
  auth_type: string;
  secret_ref: string;
  secret_cipher?: string | null;
  metadata?: JsonRecord;
}) {
  const vault = getVault(input.vault_id);
  if (!vault) return null;
  const stamp = now();
  const id = `vcred_${nanoid(10)}`;
  const scope = scopeForParent("vaults", input.vault_id);
  db.prepare(`
    INSERT INTO vault_credentials
    (id, vault_id, name, mcp_server_url, auth_type, secret_ref, secret_cipher, metadata_json, workspace_id, tenant_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, input.vault_id, input.name, input.mcp_server_url ?? null, input.auth_type, input.secret_ref, input.secret_cipher ?? null, toJson(input.metadata), scope.workspace_id, scope.tenant_id, stamp, stamp);
  return getVaultCredential(id);
}

export function getVaultCredential(id: string) {
  const row = db.prepare("SELECT * FROM vault_credentials WHERE id = ? AND archived_at IS NULL").get(id) as JsonRecord | undefined;
  if (!row) return null;
  return hydrateVaultCredential(row);
}

export function getRawVaultCredential(id: string) {
  return db.prepare("SELECT * FROM vault_credentials WHERE id = ? AND archived_at IS NULL").get(id) as JsonRecord | undefined;
}

export function listVaultCredentials(vaultId: string) {
  return (db
    .prepare("SELECT * FROM vault_credentials WHERE vault_id = ? AND archived_at IS NULL ORDER BY created_at DESC")
    .all(vaultId) as JsonRecord[])
    .map(hydrateVaultCredential);
}

export function updateVaultCredential(id: string, input: { name?: string; secret_ref?: string; secret_cipher?: string | null; metadata?: JsonRecord }) {
  const sets: string[] = [];
  const vals: unknown[] = [];
  if (input.name !== undefined) { sets.push("name = ?"); vals.push(input.name); }
  if (input.secret_ref !== undefined) { sets.push("secret_ref = ?"); vals.push(input.secret_ref); }
  if (input.secret_cipher !== undefined) { sets.push("secret_cipher = ?"); vals.push(input.secret_cipher); }
  if (input.metadata !== undefined) { sets.push("metadata_json = ?"); vals.push(toJson(input.metadata)); }
  if (!sets.length) return getVaultCredential(id);
  sets.push("updated_at = ?"); vals.push(now());
  vals.push(id);
  db.prepare(`UPDATE vault_credentials SET ${sets.join(", ")} WHERE id = ? AND archived_at IS NULL`).run(...(vals as never[]));
  return getVaultCredential(id);
}

// Resolve the decrypted secret bundle for a credential row, preferring the DB ciphertext
// (survives non-persistent secretsDir) and falling back to the local-file secret_ref.
export function readCredentialSecret(row: { secret_cipher?: unknown; secret_ref?: unknown }): string | null {
  const cipher = typeof row.secret_cipher === "string" ? row.secret_cipher : "";
  if (cipher) return decryptSecret(cipher);
  const ref = typeof row.secret_ref === "string" ? row.secret_ref : "";
  if (ref) return readSecret(ref);
  return null;
}

export function archiveVaultCredential(id: string) {
  const stamp = now();
  db.prepare("UPDATE vault_credentials SET archived_at = ?, updated_at = ? WHERE id = ? AND archived_at IS NULL").run(stamp, stamp, id);
  return true;
}

// raw rows (incl. secret_ref) for the platform-managed OAuth refresh loop
export function listConnectedOauthCredentials() {
  return db.prepare("SELECT * FROM vault_credentials WHERE archived_at IS NULL AND auth_type = 'oauth'").all() as JsonRecord[];
}

// Shared-credential model: find the workspace's connected credential for a provider so the
// runtime can inject its token into MCP calls. Returns the raw row (incl. secret_cipher/ref) and
// the decrypted access_token, or null. Picks the most recently connected one when several exist.
export function findWorkspaceProviderToken(workspaceId: string, provider: string): { credentialId: string; accessToken: string } | null {
  if (!workspaceId || !provider) return null;
  const rows = db
    .prepare("SELECT * FROM vault_credentials WHERE archived_at IS NULL AND workspace_id = ? AND auth_type = 'oauth' ORDER BY updated_at DESC")
    .all(workspaceId) as JsonRecord[];
  for (const row of rows) {
    const metadata = fromJson(String(row.metadata_json ?? "{}"), {}) as JsonRecord;
    if (!metadata.oauth_connected || String(metadata.provider || "") !== provider) continue;
    try {
      const secretJson = readCredentialSecret(row);
      if (!secretJson) continue;
      const bundle = JSON.parse(secretJson) as { access_token?: unknown };
      const accessToken = typeof bundle.access_token === "string" ? bundle.access_token : "";
      if (accessToken) return { credentialId: String(row.id), accessToken };
    } catch { /* skip unreadable/expired secret; try next */ }
  }
  return null;
}

// user-managed MCP endpoints (own servers + connected catalog providers); credentials live in vault_credentials
function hydrateMcpServer(row: JsonRecord) {
  return { ...row, config: fromJson(String(row.config_json), {}) };
}

export function listMcpServers(workspaceId?: string | null) {
  const rows = (workspaceId
    ? db.prepare("SELECT * FROM mcp_servers WHERE archived_at IS NULL AND workspace_id = ? ORDER BY created_at DESC").all(workspaceId)
    : db.prepare("SELECT * FROM mcp_servers WHERE archived_at IS NULL ORDER BY created_at DESC").all()) as JsonRecord[];
  return rows.map(hydrateMcpServer);
}

export function getMcpServer(id: string) {
  const row = db.prepare("SELECT * FROM mcp_servers WHERE id = ? AND archived_at IS NULL").get(id) as JsonRecord | undefined;
  return row ? hydrateMcpServer(row) : null;
}

export function createMcpServer(input: { workspace_id: string; name: string; provider?: string | null; mcp_url: string; auth_type: string; config?: JsonRecord; created_by_user_id?: string | null }) {
  const stamp = now();
  const id = `mcp_${nanoid(10)}`;
  const scope = scopeForWorkspace(input.workspace_id);
  db.prepare(`
    INSERT INTO mcp_servers (id, workspace_id, tenant_id, name, provider, mcp_url, auth_type, config_json, created_by_user_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, scope.workspace_id, scope.tenant_id, input.name, input.provider ?? null, input.mcp_url, input.auth_type, toJson(input.config), input.created_by_user_id ?? null, stamp, stamp);
  return getMcpServer(id);
}

export function updateMcpServer(id: string, input: { name?: string; mcp_url?: string; auth_type?: string; config?: JsonRecord }) {
  const current = getMcpServer(id) as JsonRecord | null;
  if (!current) return null;
  const sets: string[] = [];
  const vals: unknown[] = [];
  if (input.name !== undefined) { sets.push("name = ?"); vals.push(input.name); }
  if (input.mcp_url !== undefined) { sets.push("mcp_url = ?"); vals.push(input.mcp_url); }
  if (input.auth_type !== undefined) { sets.push("auth_type = ?"); vals.push(input.auth_type); }
  if (input.config !== undefined) { sets.push("config_json = ?"); vals.push(toJson(input.config)); }
  if (!sets.length) return current;
  sets.push("updated_at = ?");
  vals.push(now());
  vals.push(id);
  db.prepare(`UPDATE mcp_servers SET ${sets.join(", ")} WHERE id = ?`).run(...(vals as never[]));
  return getMcpServer(id);
}

export function archiveMcpServer(id: string) {
  db.prepare("UPDATE mcp_servers SET archived_at = ? WHERE id = ?").run(now(), id);
  return true;
}

// real analytics over the user's accessible workspaces — no mock data
export function analyticsOverview(workspaceIds: string[]) {
  if (!workspaceIds.length) return { sessions: 0, agents: 0, environments: 0, vaults: 0, events: 0, recent: [] as JsonRecord[] };
  const ph = workspaceIds.map(() => "?").join(",");
  const count = (sql: string) => Number((db.prepare(sql).get(...workspaceIds) as { c?: number } | undefined)?.c ?? 0);
  const sessions = count(`SELECT COUNT(*) c FROM sessions WHERE workspace_id IN (${ph})`);
  const agents = count(`SELECT COUNT(*) c FROM agents WHERE archived_at IS NULL AND workspace_id IN (${ph})`);
  const environments = count(`SELECT COUNT(*) c FROM environments WHERE archived_at IS NULL AND workspace_id IN (${ph})`);
  const vaults = count(`SELECT COUNT(*) c FROM vaults WHERE archived_at IS NULL AND workspace_id IN (${ph})`);
  const events = count(`SELECT COUNT(*) c FROM session_events WHERE session_id IN (SELECT id FROM sessions WHERE workspace_id IN (${ph}))`);
  const recent = db
    .prepare(`SELECT e.id, e.type, e.created_at, e.session_id FROM session_events e WHERE e.session_id IN (SELECT id FROM sessions WHERE workspace_id IN (${ph})) ORDER BY e.created_at DESC LIMIT 40`)
    .all(...workspaceIds) as JsonRecord[];
  return { sessions, agents, environments, vaults, events, recent };
}

export function createMemoryStore(input: {
  name: string;
  description: string;
  provider?: string | null;
  status?: string | null;
  external_ref?: string | null;
  config?: JsonRecord;
  openviking?: JsonRecord;
  api_key?: string | null;
  api_key_ciphertext?: string | null;
  api_key_hint?: string | null;
  metadata?: JsonRecord;
  workspace_id?: string | null;
}) {
  const stamp = now();
  const id = `mem_${nanoid(10)}`;
  const scope = scopeForWorkspace(input.workspace_id);
  const provider = normalizeMemoryProvider(input.provider);
  const openviking = record(input.openviking);
  const config = {
    ...record(input.config),
    ...(provider === "openviking"
      ? {
          base_url: String(openviking.base_url || record(input.config).base_url || process.env.OPENVIKING_BASE_URL || ""),
          target_uri: String(openviking.target_uri || record(input.config).target_uri || input.external_ref || `viking://user/memories/${id}`)
        }
      : {})
  };
  const apiKey = String(input.api_key || openviking.api_key || "");
  const apiKeyCiphertext = input.api_key_ciphertext ?? (apiKey ? encryptSecret(apiKey) : null);
  const apiKeyHint = input.api_key_hint ?? (apiKey ? secretHint(apiKey) : null);
  const externalRef = input.external_ref ?? (provider === "openviking" ? String(config.target_uri || `viking://user/memories/${id}`) : null);
  db.prepare(`
    INSERT INTO memory_stores
    (id, name, description, provider, status, external_ref, config_json, api_key_ciphertext, api_key_hint, metadata_json, workspace_id, tenant_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.name,
    input.description,
    provider,
    input.status || "active",
    externalRef,
    toJson(config),
    apiKeyCiphertext,
    apiKeyHint,
    toJson(input.metadata),
    scope.workspace_id,
    scope.tenant_id,
    stamp,
    stamp
  );
  return getMemoryStore(id);
}

export function listMemoryStores(workspaceId?: string | null) {
  const rows = (workspaceId
    ? db.prepare("SELECT * FROM memory_stores WHERE archived_at IS NULL AND workspace_id = ? ORDER BY created_at DESC").all(workspaceId)
    : db.prepare("SELECT * FROM memory_stores WHERE archived_at IS NULL ORDER BY created_at DESC").all()) as JsonRecord[];
  const ids = rows.map((row) => String(row.id));
  const counts = ids.length
    ? db
        .prepare(`SELECT memory_store_id, COUNT(*) AS count FROM memories WHERE memory_store_id IN (${ids.map(() => "?").join(",")}) GROUP BY memory_store_id`)
        .all(...ids) as Array<{ memory_store_id: string; count: number }>
    : [];
  const countByStore = new Map(counts.map((entry) => [entry.memory_store_id, Number(entry.count)]));
  return rows.map((row) => hydrateMemoryStoreRow(row, countByStore.get(String(row.id)) ?? 0));
}

export function getMemoryStore(id: string) {
  const row = db.prepare("SELECT * FROM memory_stores WHERE id = ? AND archived_at IS NULL").get(id) as JsonRecord | undefined;
  return row ? hydrateMemoryStoreRow(row) : null;
}

export function getRawMemoryStore(id: string) {
  const row = db.prepare("SELECT * FROM memory_stores WHERE id = ? AND archived_at IS NULL").get(id) as JsonRecord | undefined;
  return row ? { ...row, metadata: fromJson(String(row.metadata_json), {}), config: fromJson(String(row.config_json), {}) } : null;
}

export function upsertMemory(input: { memory_store_id: string; path: string; content: string; actor: string; metadata?: JsonRecord; session_id?: string | null }) {
  const stamp = now();
  const path = normalizeMemoryPath(input.path);
  const content = assertMemoryContent(input.content);
  const contentSha = hashMemoryContent(content);
  const existing = db
    .prepare("SELECT * FROM memories WHERE memory_store_id = ? AND path = ?")
    .get(input.memory_store_id, path) as JsonRecord | undefined;
  const memoryId = existing ? String(existing.id) : `memory_${nanoid(10)}`;
  const scope = scopeForParent("memory_stores", input.memory_store_id);
  const tx = db.transaction(() => {
    if (existing) {
      db.prepare("UPDATE memories SET content = ?, metadata_json = ?, content_sha256 = ?, updated_at = ? WHERE id = ?").run(
        content,
        toJson(input.metadata ?? fromJson(String(existing.metadata_json), {})),
        contentSha,
        stamp,
        memoryId
      );
    } else {
      db.prepare(`
        INSERT INTO memories
        (id, memory_store_id, path, content, metadata_json, content_sha256, workspace_id, tenant_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        memoryId,
        input.memory_store_id,
        path,
        content,
        toJson(input.metadata ?? {}),
        contentSha,
        scope.workspace_id,
        scope.tenant_id,
        stamp,
        stamp
      );
    }
    db.prepare(`
      INSERT INTO memory_versions
      (id, memory_id, memory_store_id, path, operation, content, content_sha256, metadata_json, session_id, actor, workspace_id, tenant_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      `memver_${nanoid(10)}`,
      memoryId,
      input.memory_store_id,
      path,
      existing ? "update" : "create",
      content,
      contentSha,
      toJson(input.metadata ?? {}),
      input.session_id ?? null,
      input.actor,
      scope.workspace_id,
      scope.tenant_id,
      stamp
    );
  });
  tx();
  return listMemories(input.memory_store_id).find((item) => item.id === memoryId);
}

export function listMemories(memoryStoreId: string, query?: string): JsonRecord[] {
  const rows = db.prepare("SELECT * FROM memories WHERE memory_store_id = ? ORDER BY path ASC").all(memoryStoreId) as JsonRecord[];
  const filtered = query
    ? rows.filter((row) => `${row.path}\n${row.content}`.toLowerCase().includes(query.toLowerCase()))
    : rows;
  return filtered.map(hydrateMemoryRow);
}

export function getMemory(memoryStoreId: string, path: string) {
  const row = db.prepare("SELECT * FROM memories WHERE memory_store_id = ? AND path = ?").get(memoryStoreId, normalizeMemoryPath(path)) as JsonRecord | undefined;
  return row ? hydrateMemoryRow(row) : null;
}

export function readMemoryStoreApiKey(row: { api_key_ciphertext?: unknown }) {
  const cipher = typeof row.api_key_ciphertext === "string" ? row.api_key_ciphertext : "";
  if (cipher) return decryptSecret(cipher);
  return process.env.OPENVIKING_API_KEY || "";
}

function hydrateMemoryStoreRow(row: JsonRecord, memoryCount?: number) {
  const { api_key_ciphertext: _apiKeyCiphertext, metadata_json: _metadataJson, config_json: _configJson, ...safe } = row;
  return {
    ...safe,
    provider: String(row.provider || "local"),
    status: String(row.status || "active"),
    external_ref: row.external_ref ?? null,
    config: fromJson(String(row.config_json), {}),
    metadata: fromJson(String(row.metadata_json), {}),
    memory_count: memoryCount ?? Number((db.prepare("SELECT COUNT(*) AS count FROM memories WHERE memory_store_id = ?").get(row.id) as { count?: unknown } | undefined)?.count || 0)
  };
}

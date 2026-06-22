import { nanoid } from "nanoid";
import type { JsonRecord } from "../types";
import { db, fromJson, now, recordValue } from "./storeCore";
import { hydrateUserRow, hydrateWorkspaceRow } from "./storeHydrators";
import { ensureUserByEmail } from "./storeTemplatesSkillsUsers";
import { normalizeWorkspaceSlug } from "./storeWorkspace";

export function tenantSlugFromRecord(tenant: JsonRecord) {
  const inlineMetadata = recordValue(tenant.metadata);
  const metadata = Object.keys(inlineMetadata).length ? inlineMetadata : fromJson<JsonRecord>(String(tenant.metadata_json ?? ""), {});
  return normalizeWorkspaceSlug(String(metadata.slug || tenant.slug || tenant.name || tenant.id || "tenant")) || "tenant";
}

export function listWorkspacesForUser(userId: string) {
  return (db
    .prepare(
      `SELECT DISTINCT workspaces.*
       FROM workspaces
       LEFT JOIN workspace_members ON workspace_members.workspace_id = workspaces.id AND workspace_members.user_id = ?
       LEFT JOIN tenant_members ON tenant_members.tenant_id = workspaces.tenant_id
        AND tenant_members.user_id = ?
        AND tenant_members.role = 'admin'
       WHERE workspaces.status = 'active'
         AND (workspace_members.user_id IS NOT NULL OR tenant_members.user_id IS NOT NULL)
       ORDER BY workspaces.created_at ASC`
    )
    .all(userId, userId) as JsonRecord[]).map(hydrateWorkspaceRow);
}

// tenants the user can access; tenant admin is tracked separately from workspace admin.
export function listAccessibleTenants(userId: string) {
  return (db
    .prepare(
	      `SELECT t.id, t.name, t.status, t.created_by_user_id, t.metadata_json,
	         MAX(CASE WHEN t.created_by_user_id = ? THEN 1 ELSE 0 END) AS is_creator,
	         MAX(CASE WHEN tm.role = 'admin' THEN 1 ELSE 0 END) AS is_owner,
	         MAX(CASE WHEN wm.user_id IS NOT NULL THEN 1 ELSE 0 END) AS is_member,
         COUNT(DISTINCT w.id) AS workspace_count,
         MIN(w.id) AS primary_workspace_id
       FROM tenants t
       JOIN workspaces w ON w.tenant_id = t.id AND w.status = 'active'
       LEFT JOIN workspace_members wm ON wm.workspace_id = w.id AND wm.user_id = ?
       LEFT JOIN tenant_members tm ON tm.tenant_id = t.id AND tm.user_id = ?
       WHERE t.status = 'active'
         AND (t.created_by_user_id = ? OR wm.user_id IS NOT NULL OR tm.user_id IS NOT NULL)
	       GROUP BY t.id, t.name, t.status, t.created_by_user_id, t.metadata_json
	       ORDER BY t.created_at ASC`
	    )
	    .all(userId, userId, userId, userId) as JsonRecord[])
	    .map((row) => {
	      const metadata = fromJson<JsonRecord>(String(row.metadata_json ?? ""), {});
	      const { metadata_json: _metadataJson, ...tenant } = row;
	      return { ...tenant, metadata, slug: tenantSlugFromRecord({ ...row, metadata }) };
	    });
}

export function listLoginTenantsForUser(userId: string) {
  return listAccessibleTenants(userId) as JsonRecord[];
}

export function listCreatedTenantsForUser(userId: string) {
  return (listAccessibleTenants(userId) as JsonRecord[]).filter((tenant) => Number(tenant.is_creator) === 1);
}

export function listTenantAdminTenants(userId: string) {
  return (listAccessibleTenants(userId) as JsonRecord[]).filter((tenant) => Number(tenant.is_owner) === 1);
}

export function countActiveTenants() {
  const row = db.prepare("SELECT COUNT(*) AS count FROM tenants WHERE status = 'active'").get() as { count?: unknown } | undefined;
  return Number(row?.count || 0);
}

export function canAdminTenant(userId: string, tenantId: string) {
  const row = db
    .prepare(
      `SELECT 1 AS allowed
       FROM tenant_members
       JOIN tenants ON tenants.id = tenant_members.tenant_id
       WHERE tenant_members.user_id = ?
         AND tenant_members.tenant_id = ?
         AND tenant_members.role = 'admin'
         AND tenants.status = 'active'`
    )
    .get(userId, tenantId) as JsonRecord | undefined;
  return Boolean(row);
}

export function ensureTenantAdmin(tenantId: string, userId: string) {
  const existing = db
    .prepare("SELECT * FROM tenant_members WHERE tenant_id = ? AND user_id = ?")
    .get(tenantId, userId) as JsonRecord | undefined;
  if (existing) {
    if (String(existing.role) !== "admin") db.prepare("UPDATE tenant_members SET role = 'admin' WHERE id = ?").run(existing.id);
    return;
  }
  db.prepare("INSERT OR IGNORE INTO tenant_members (id, tenant_id, user_id, role, created_at) VALUES (?, ?, ?, 'admin', ?)").run(
    `tnmem_${nanoid(10)}`,
    tenantId,
    userId,
    now()
  );
}

export function listUsersForTenant(tenantId: string) {
  const users = (db
    .prepare(
      `SELECT DISTINCT users.*
       FROM users
       LEFT JOIN workspace_members ON workspace_members.user_id = users.id
       LEFT JOIN workspaces ON workspaces.id = workspace_members.workspace_id
       LEFT JOIN tenant_members ON tenant_members.user_id = users.id
       WHERE (workspaces.tenant_id = ? AND workspaces.status = 'active') OR tenant_members.tenant_id = ?
       ORDER BY users.updated_at DESC`
    )
    .all(tenantId, tenantId) as JsonRecord[]).map(hydrateUserRow);
  const tenantRoles = new Map(
    (db.prepare("SELECT user_id, role FROM tenant_members WHERE tenant_id = ?").all(tenantId) as JsonRecord[])
      .map((row) => [String(row.user_id), String(row.role)])
  );
  const workspaceRows = db
    .prepare(
      `SELECT workspace_members.user_id, workspace_members.role, workspaces.id AS workspace_id, workspaces.name AS workspace_name
       FROM workspace_members
       JOIN workspaces ON workspaces.id = workspace_members.workspace_id
       WHERE workspaces.tenant_id = ? AND workspaces.status = 'active'
       ORDER BY workspaces.created_at ASC`
    )
    .all(tenantId) as JsonRecord[];
  const byUser = new Map<string, Array<{ id: string; name: string; role: string }>>();
  for (const row of workspaceRows) {
    const userId = String(row.user_id);
    const entries = byUser.get(userId) ?? [];
    entries.push({ id: String(row.workspace_id), name: String(row.workspace_name || row.workspace_id), role: String(row.role || "member") });
    byUser.set(userId, entries);
  }
  return users.map((user) => {
    const userId = String((user as JsonRecord).id);
    const workspaceMemberships = byUser.get(userId) ?? [];
    const tenantRole = tenantRoles.get(userId) ?? null;
    const effectiveRole = tenantRole === "admin" ? "admin" : "member";
    return {
      ...user,
      tenant_role: tenantRole,
      effective_role: effectiveRole,
      workspace_ids: workspaceMemberships.map((item) => item.id),
      workspace_names: workspaceMemberships.map((item) => item.name),
      workspace_roles: workspaceMemberships.map((item) => item.role),
      workspace_count: workspaceMemberships.length
    };
  });
}

export function addTenantAdminByEmail(tenantId: string, email: string) {
  const user = ensureUserByEmail({ email, metadata: { source: "tenant_admin_invite" } }) as JsonRecord;
  upsertTenantMembership(tenantId, String(user.id), "admin");
  return tenantUser(tenantId, String(user.id));
}

export function addTenantMemberByEmail(tenantId: string, email: string) {
  const user = ensureUserByEmail({ email, metadata: { source: "tenant_member_invite" } }) as JsonRecord;
  upsertTenantMembership(tenantId, String(user.id), "member");
  return tenantUser(tenantId, String(user.id));
}

function upsertTenantMembership(tenantId: string, userId: string, role: "admin" | "member") {
  const existing = db
    .prepare("SELECT * FROM tenant_members WHERE tenant_id = ? AND user_id = ?")
    .get(tenantId, userId) as JsonRecord | undefined;
  if (existing) {
    if (String(existing.role) !== role) db.prepare("UPDATE tenant_members SET role = ? WHERE id = ?").run(role, existing.id);
    return;
  }
  db.prepare("INSERT INTO tenant_members (id, tenant_id, user_id, role, created_at) VALUES (?, ?, ?, ?, ?)").run(
    `tnmem_${nanoid(10)}`,
    tenantId,
    userId,
    role,
    now()
  );
}

function tenantUser(tenantId: string, userId: string) {
  return (listUsersForTenant(tenantId) as JsonRecord[]).find((user) => String(user.id) === userId) ?? null;
}

export function removeTenantAdmin(tenantId: string, userId: string) {
  const tenant = db.prepare("SELECT * FROM tenants WHERE id = ?").get(tenantId) as JsonRecord | undefined;
  if (!tenant) return { removed: false, reason: "tenant_not_found" };
  if (String(tenant.created_by_user_id || "") === userId) return { removed: false, reason: "cannot_remove_owner" };
  const result = db
    .prepare("DELETE FROM tenant_members WHERE tenant_id = ? AND user_id = ? AND role = 'admin'")
    .run(tenantId, userId) as { changes?: number };
  return { removed: Number(result.changes || 0) > 0 };
}

export function removeTenantMember(tenantId: string, userId: string) {
  const result = db
    .prepare("DELETE FROM tenant_members WHERE tenant_id = ? AND user_id = ? AND role <> 'admin'")
    .run(tenantId, userId) as { changes?: number };
  return { removed: Number(result.changes || 0) > 0 };
}

export function tenantCloudProviders(tenantId: string) {
  const tenant = db.prepare("SELECT metadata_json FROM tenants WHERE id = ?").get(tenantId) as JsonRecord | undefined;
  const metadata = fromJson<JsonRecord>(String(tenant?.metadata_json ?? ""), {});
  return recordValue(metadata.cloud_providers);
}

export function upsertTenantCloudProvider(tenantId: string, provider: string, credentials: JsonRecord) {
  const tenant = db.prepare("SELECT metadata_json FROM tenants WHERE id = ?").get(tenantId) as JsonRecord | undefined;
  if (!tenant) return null;
  const metadata = fromJson<JsonRecord>(String(tenant.metadata_json ?? ""), {});
  const providers = recordValue(metadata.cloud_providers);
  const nowValue = now();
  providers[provider] = {
    provider,
    connected: true,
    access_key_hint: maskTenantSecretHint(String(credentials.access_key || credentials.AccessKey || credentials.VOLCENGINE_ACCESS_KEY || "")),
    region: String(credentials.region || credentials.VEFAAS_REGION || "cn-beijing"),
    credential_source: `tenant.cloud_providers.${provider}`,
    updated_at: nowValue,
    credentials
  };
  metadata.cloud_providers = providers;
  db.prepare("UPDATE tenants SET metadata_json = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(metadata), nowValue, tenantId);
  return providers[provider] as JsonRecord;
}

function maskTenantSecretHint(value: string) {
  if (!value) return "";
  if (value.length <= 8) return `${value[0] ?? ""}***${value[value.length - 1] ?? ""}`;
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

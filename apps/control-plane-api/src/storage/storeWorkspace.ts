import { nanoid } from "nanoid";
import type { JsonRecord } from "../types";
import { GLOBAL_SCOPE_ID, countRowsToSummary, db, fromJson, now, reservedWorkspaceSlugs } from "./storeCore";
import { hydrateRuntimePoolMemberRow, hydrateRuntimePoolRow, hydrateWorkspaceMemberRow, hydrateWorkspaceRow } from "./storeHydrators";
import { ensureUserByEmail } from "./storeTemplatesSkillsUsers";

export function normalizeWorkspaceSlug(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 30);
}

export function workspaceConsoleUrl(tenantSlug: string, workspaceSlug: string) {
  const base = (process.env.MAPLE_CONSOLE_BASE_URL || process.env.MAPLE_WEB_BASE_URL || "http://localhost:6789").replace(/\/+$/, "");
  return `${base}/t/${encodeURIComponent(tenantSlug)}/w/${encodeURIComponent(workspaceSlug)}`;
}

export function workspaceSlugAvailable(slug: string) {
  const normalized = normalizeWorkspaceSlug(slug);
  if (!/^[a-z0-9]([a-z0-9-]{1,28}[a-z0-9])?$/.test(normalized)) return { available: false, slug: normalized, reason: "invalid" };
  if (reservedWorkspaceSlugs.has(normalized)) return { available: false, slug: normalized, reason: "reserved" };
  const rows = db.prepare("SELECT id, config_json FROM workspaces").all() as JsonRecord[];
  const taken = rows.some((row) => String(fromJson<JsonRecord>(String(row.config_json), {}).slug || "") === normalized);
  return { available: !taken, slug: normalized, reason: taken ? "taken" : "ok", console_url: workspaceConsoleUrl(normalized, normalized) };
}

export function getWorkspace(id: string) {
  const row = db.prepare("SELECT * FROM workspaces WHERE id = ?").get(id) as JsonRecord | undefined;
  return row ? hydrateWorkspaceRow(row) : null;
}

export function updateWorkspace(id: string, input: { name?: string; description?: string }) {
  const current = getWorkspace(id) as JsonRecord | null;
  if (!current) return null;
  db.prepare("UPDATE workspaces SET name = ?, description = ?, updated_at = ? WHERE id = ?").run(
    input.name ?? String(current.name || ""),
    input.description ?? String(current.description || ""),
    now(),
    id
  );
  return getWorkspace(id);
}

export function canAccessWorkspace(userId: string, workspaceId: string) {
  const row = db
    .prepare(
      `SELECT 1 AS allowed
       FROM workspaces
       LEFT JOIN workspace_members ON workspace_members.workspace_id = workspaces.id AND workspace_members.user_id = ?
       LEFT JOIN tenant_members ON tenant_members.tenant_id = workspaces.tenant_id
        AND tenant_members.user_id = ?
        AND tenant_members.role = 'admin'
       WHERE workspaces.id = ?
         AND workspaces.status = 'active'
         AND (workspace_members.user_id IS NOT NULL OR tenant_members.user_id IS NOT NULL)`
    )
    .get(userId, userId, workspaceId) as JsonRecord | undefined;
  return Boolean(row);
}

export function canAdminWorkspace(userId: string, workspaceId: string) {
  const row = db
    .prepare(
      `SELECT 1 AS allowed
       FROM workspaces
       LEFT JOIN workspace_members ON workspace_members.workspace_id = workspaces.id
        AND workspace_members.user_id = ?
        AND workspace_members.role = 'admin'
       LEFT JOIN tenant_members ON tenant_members.tenant_id = workspaces.tenant_id
        AND tenant_members.user_id = ?
        AND tenant_members.role = 'admin'
       WHERE workspaces.id = ?
         AND workspaces.status = 'active'
         AND (workspace_members.user_id IS NOT NULL OR tenant_members.user_id IS NOT NULL)`
    )
    .get(userId, userId, workspaceId) as JsonRecord | undefined;
  return Boolean(row);
}

export function listWorkspaceMembers(workspaceId: string) {
  return (db
    .prepare(
      `SELECT workspace_members.*, users.email, users.name, users.auth_provider, users.role AS user_role,
              workspaces.created_by_user_id,
              CASE WHEN users.id = workspaces.created_by_user_id THEN 'owner' ELSE workspace_members.role END AS effective_role
       FROM workspace_members
       JOIN users ON users.id = workspace_members.user_id
       JOIN workspaces ON workspaces.id = workspace_members.workspace_id
       WHERE workspace_members.workspace_id = ?
       ORDER BY CASE WHEN users.id = workspaces.created_by_user_id THEN 0 ELSE 1 END,
                workspace_members.created_at ASC`
    )
    .all(workspaceId) as JsonRecord[]).map(hydrateWorkspaceMemberRow);
}

export function getWorkspaceMember(workspaceId: string, userId: string) {
  const row = db
    .prepare(
      `SELECT workspace_members.*, users.email, users.name, users.auth_provider, users.role AS user_role,
              workspaces.created_by_user_id,
              CASE WHEN users.id = workspaces.created_by_user_id THEN 'owner' ELSE workspace_members.role END AS effective_role
       FROM workspace_members
       JOIN users ON users.id = workspace_members.user_id
       JOIN workspaces ON workspaces.id = workspace_members.workspace_id
       WHERE workspace_members.workspace_id = ? AND workspace_members.user_id = ?`
    )
    .get(workspaceId, userId) as JsonRecord | undefined;
  return row ? hydrateWorkspaceMemberRow(row) : null;
}

export function addWorkspaceAdminByEmail(workspaceId: string, email: string) {
  const user = ensureUserByEmail({ email, metadata: { source: "workspace_admin_invite" } }) as JsonRecord;
  const stamp = now();
  const existing = db
    .prepare("SELECT * FROM workspace_members WHERE workspace_id = ? AND user_id = ?")
    .get(workspaceId, user.id) as JsonRecord | undefined;
  if (existing) {
    if (String(existing.role) !== "admin") {
      db.prepare("UPDATE workspace_members SET role = ? WHERE id = ?").run("admin", existing.id);
    }
  } else {
    db.prepare("INSERT INTO workspace_members (id, workspace_id, user_id, role, created_at) VALUES (?, ?, ?, 'admin', ?)").run(
      `wsmem_${nanoid(10)}`,
      workspaceId,
      user.id,
      stamp
    );
  }
  return getWorkspaceMember(workspaceId, String(user.id));
}

export function addWorkspaceMemberByEmail(workspaceId: string, email: string) {
  const user = ensureUserByEmail({ email, metadata: { source: "workspace_member_invite" } }) as JsonRecord;
  const stamp = now();
  const existing = db
    .prepare("SELECT * FROM workspace_members WHERE workspace_id = ? AND user_id = ?")
    .get(workspaceId, user.id) as JsonRecord | undefined;
  if (!existing) {
    db.prepare("INSERT INTO workspace_members (id, workspace_id, user_id, role, created_at) VALUES (?, ?, ?, 'member', ?)").run(
      `wsmem_${nanoid(10)}`,
      workspaceId,
      user.id,
      stamp
    );
  }
  return getWorkspaceMember(workspaceId, String(user.id));
}

export function removeWorkspaceAdmin(workspaceId: string, userId: string) {
  const workspace = getWorkspace(workspaceId) as JsonRecord | null;
  if (!workspace) return { removed: false, reason: "workspace_not_found" };
  if (String(workspace.created_by_user_id || "") === userId) return { removed: false, reason: "cannot_remove_owner" };
  const result = db
    .prepare("DELETE FROM workspace_members WHERE workspace_id = ? AND user_id = ? AND role = 'admin'")
    .run(workspaceId, userId) as { changes?: number };
  return { removed: Number(result.changes || 0) > 0 };
}

export function removeWorkspaceMember(workspaceId: string, userId: string) {
  const member = getWorkspaceMember(workspaceId, userId) as JsonRecord | null;
  if (!member) return { removed: false, reason: "workspace_member_not_found" };
  const role = String(member.role || "");
  if (role === "owner" || role === "admin") return { removed: false, reason: "cannot_remove_admin" };
  const result = db.prepare("DELETE FROM workspace_members WHERE workspace_id = ? AND user_id = ? AND role = 'member'").run(workspaceId, userId) as { changes?: number };
  return { removed: Number(result.changes || 0) > 0 };
}

export function removeTenantUserFromTenant(tenantId: string, userId: string) {
  const tenantMember = db
    .prepare("SELECT * FROM tenant_members WHERE tenant_id = ? AND user_id = ?")
    .get(tenantId, userId) as JsonRecord | undefined;
  if (tenantMember && String(tenantMember.role) === "admin") return { removed: false, reason: "cannot_remove_admin" };
  // The sync MySQL adapter buffers transaction writes until commit, so per-statement `changes`
  // read inside db.transaction are always 0 (deletes haven't run yet); count the matching rows
  // before the transaction and keep the deletes inside it for atomicity.
  const workspaceCount = db
    .prepare("SELECT COUNT(*) AS count FROM workspace_members WHERE user_id = ? AND workspace_id IN (SELECT id FROM workspaces WHERE tenant_id = ?)")
    .get(userId, tenantId) as { count?: unknown } | undefined;
  const tenantCount = db
    .prepare("SELECT COUNT(*) AS count FROM tenant_members WHERE user_id = ? AND tenant_id = ? AND role <> 'admin'")
    .get(userId, tenantId) as { count?: unknown } | undefined;
  const changes = Number(workspaceCount?.count || 0) + Number(tenantCount?.count || 0);
  const tx = db.transaction(() => {
    db.prepare("DELETE FROM workspace_members WHERE user_id = ? AND workspace_id IN (SELECT id FROM workspaces WHERE tenant_id = ?)").run(userId, tenantId);
    db.prepare("DELETE FROM tenant_members WHERE user_id = ? AND tenant_id = ? AND role <> 'admin'").run(userId, tenantId);
  });
  tx();
  return { removed: changes > 0 };
}

export function deleteWorkspaceCascade(workspaceId: string) {
  if (!workspaceId || workspaceId === GLOBAL_SCOPE_ID) return { deleted: false, reason: "workspace_not_found", counts: {} as Record<string, number> };
  const workspace = getWorkspace(workspaceId) as JsonRecord | null;
  if (!workspace) return { deleted: false, reason: "workspace_not_found", counts: {} as Record<string, number> };
  const activeCount = db
    .prepare("SELECT COUNT(*) AS count FROM workspaces WHERE tenant_id = ? AND status = 'active'")
    .get(workspace.tenant_id) as { count?: unknown } | undefined;
  if (Number(activeCount?.count || 0) <= 1) return { deleted: false, reason: "last_workspace_required", counts: {} as Record<string, number> };
  // FK-safe delete order: children before parents. Each target's WHERE is shared by the
  // pre-count and the delete. The sync MySQL adapter buffers transaction writes until commit,
  // so per-statement `changes` read inside db.transaction are always 0 (deletes haven't run yet);
  // count before the transaction for the report, and confirm the outcome with a post-commit read.
  const targets: Array<{ key: string; table: string; where: string; params: unknown[] }> = [
    {
      key: "tool_calls",
      table: "tool_calls",
      where: "workspace_id = ? OR session_id IN (SELECT id FROM sessions WHERE workspace_id = ?) OR event_id IN (SELECT id FROM session_events WHERE workspace_id = ?)",
      params: [workspaceId, workspaceId, workspaceId]
    },
    { key: "session_events", table: "session_events", where: "workspace_id = ? OR session_id IN (SELECT id FROM sessions WHERE workspace_id = ?)", params: [workspaceId, workspaceId] },
    { key: "session_threads", table: "session_threads", where: "workspace_id = ? OR session_id IN (SELECT id FROM sessions WHERE workspace_id = ?)", params: [workspaceId, workspaceId] },
    { key: "session_artifacts", table: "session_artifacts", where: "workspace_id = ? OR session_id IN (SELECT id FROM sessions WHERE workspace_id = ?)", params: [workspaceId, workspaceId] },
    {
      key: "deployment_runs",
      table: "deployment_runs",
      where: "workspace_id = ? OR deployment_id IN (SELECT id FROM agent_deployments WHERE workspace_id = ?) OR session_id IN (SELECT id FROM sessions WHERE workspace_id = ?)",
      params: [workspaceId, workspaceId, workspaceId]
    },
    {
      key: "agent_deployments",
      table: "agent_deployments",
      where: "workspace_id = ? OR agent_id IN (SELECT id FROM agents WHERE workspace_id = ?) OR environment_id IN (SELECT id FROM environments WHERE workspace_id = ?)",
      params: [workspaceId, workspaceId, workspaceId]
    },
    { key: "agent_versions", table: "agent_versions", where: "workspace_id = ? OR agent_id IN (SELECT id FROM agents WHERE workspace_id = ?)", params: [workspaceId, workspaceId] },
    { key: "vault_credentials", table: "vault_credentials", where: "workspace_id = ? OR vault_id IN (SELECT id FROM vaults WHERE workspace_id = ?)", params: [workspaceId, workspaceId] },
    {
      key: "memory_versions",
      table: "memory_versions",
      where: "workspace_id = ? OR memory_id IN (SELECT memories.id FROM memories JOIN memory_stores ON memory_stores.id = memories.memory_store_id WHERE memory_stores.workspace_id = ?)",
      params: [workspaceId, workspaceId]
    },
    { key: "memories", table: "memories", where: "workspace_id = ? OR memory_store_id IN (SELECT id FROM memory_stores WHERE workspace_id = ?)", params: [workspaceId, workspaceId] },
    { key: "managed_files", table: "managed_files", where: "workspace_id = ?", params: [workspaceId] },
    { key: "sessions", table: "sessions", where: "workspace_id = ?", params: [workspaceId] },
    { key: "environments", table: "environments", where: "workspace_id = ?", params: [workspaceId] },
    { key: "agents", table: "agents", where: "workspace_id = ?", params: [workspaceId] },
    { key: "vaults", table: "vaults", where: "workspace_id = ?", params: [workspaceId] },
    { key: "memory_stores", table: "memory_stores", where: "workspace_id = ?", params: [workspaceId] },
    { key: "mcp_servers", table: "mcp_servers", where: "workspace_id = ?", params: [workspaceId] },
    { key: "model_configs", table: "model_configs", where: "workspace_id = ?", params: [workspaceId] },
    { key: "workspace_api_keys", table: "workspace_api_keys", where: "workspace_id = ?", params: [workspaceId] },
    { key: "workspace_sandbox_pool_members", table: "workspace_sandbox_pool_members", where: "workspace_id = ?", params: [workspaceId] },
    { key: "workspace_runtime_pool_members", table: "workspace_runtime_pool_members", where: "workspace_id = ?", params: [workspaceId] },
    { key: "workspace_runtime_pools", table: "workspace_runtime_pools", where: "workspace_id = ?", params: [workspaceId] },
    { key: "workspace_members", table: "workspace_members", where: "workspace_id = ?", params: [workspaceId] },
    { key: "workspaces", table: "workspaces", where: "id = ?", params: [workspaceId] }
  ];
  const counts: Record<string, number> = {};
  for (const target of targets) {
    const row = db.prepare(`SELECT COUNT(*) AS count FROM ${target.table} WHERE ${target.where}`).get(...(target.params as never[])) as { count?: unknown } | undefined;
    counts[target.key] = Number(row?.count || 0);
  }
  const tx = db.transaction(() => {
    for (const target of targets) {
      db.prepare(`DELETE FROM ${target.table} WHERE ${target.where}`).run(...(target.params as never[]));
    }
  });
  tx();
  return { deleted: !getWorkspace(workspaceId), counts };
}

export function workspaceIncludesModelConfig(workspaceId: string, modelConfigId: string) {
  const row = db
    .prepare("SELECT 1 AS included FROM model_configs WHERE id = ? AND (workspace_id = ? OR workspace_id = ?)")
    .get(modelConfigId, workspaceId, GLOBAL_SCOPE_ID) as JsonRecord | undefined;
  return Boolean(row);
}

export function getWorkspaceRuntimePool(workspaceId: string) {
  return listWorkspaceRuntimePools(workspaceId)[0] ?? null;
}

export function listWorkspaceRuntimePools(workspaceId: string) {
  const pools = (db
    .prepare("SELECT * FROM workspace_runtime_pools WHERE workspace_id = ? ORDER BY created_at ASC")
    .all(workspaceId) as JsonRecord[]).map(hydrateRuntimePoolRow);
  return pools.sort((a, b) => poolRank(a) - poolRank(b));
}

export function listRuntimePoolMembersPage(
  runtimePoolId: string,
  opts: { limit: number; offset: number; status?: string }
) {
  const filters = ["runtime_pool_id = ?"];
  const params: unknown[] = [runtimePoolId];
  if (opts.status) {
    filters.push("status = ?");
    params.push(opts.status);
  }
  // LIMIT/OFFSET are inlined (not bound) — this MySQL adapter rejects them as
  // prepared-statement params; limit/offset are pre-clamped integers, so it is safe.
  const limit = Math.max(0, Math.floor(opts.limit));
  const offset = Math.max(0, Math.floor(opts.offset));
  return (db
    .prepare(`SELECT * FROM workspace_runtime_pool_members WHERE ${filters.join(" AND ")} ORDER BY created_at ASC LIMIT ${limit} OFFSET ${offset}`)
    .all(...(params as never[])) as JsonRecord[]).map(hydrateRuntimePoolMemberRow);
}

export function countRuntimePoolMembersByStatus(runtimePoolId: string) {
  const rows = db
    .prepare("SELECT status, COUNT(*) AS count FROM workspace_runtime_pool_members WHERE runtime_pool_id = ? GROUP BY status")
    .all(runtimePoolId) as JsonRecord[];
  return countRowsToSummary(rows);
}

function poolRank(pool: JsonRecord) {
  const config = typeof pool.config === "object" && pool.config !== null ? pool.config as JsonRecord : {};
  const roleRank = String(config.role || "primary") === "standby" ? 10_000 : 0;
  return roleRank + Number(config.priority || 0);
}

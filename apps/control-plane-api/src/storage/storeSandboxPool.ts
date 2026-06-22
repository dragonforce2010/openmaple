import { nanoid } from "nanoid";
import type { JsonRecord } from "../types";
import { countRowsToSummary, db, fromJson, now, recordValue, sandboxPoolConfig, toJson } from "./storeCore";

export type SandboxPoolMember = JsonRecord & {
  id: string;
  workspace_id: string;
  provider: string;
  sandbox_id: string;
  status: string;
  expires_at?: string | null;
};

export function hydrateSandboxPoolMemberRow(row: JsonRecord): SandboxPoolMember {
  return {
    ...row,
    config: fromJson(String(row.config_json), {})
  } as unknown as SandboxPoolMember;
}

export function getWorkspaceSandboxPool(workspaceId: string) {
  return listWorkspaceSandboxPools(workspaceId)[0] ?? null;
}

export function listWorkspaceSandboxPools(workspaceId: string) {
  const workspace = db.prepare("SELECT * FROM workspaces WHERE id = ?").get(workspaceId) as JsonRecord | undefined;
  if (!workspace) return [];
  const workspaceConfig = fromJson(String(workspace.config_json), {}) as JsonRecord;
  const fallbackProvider = String(workspace.sandbox_provider || workspaceConfig.sandbox_provider || "e2b");
  const fallbackPool = sandboxPoolConfig(recordValue(workspaceConfig.sandbox_pool));
  const rawPools = Array.isArray(workspaceConfig.sandbox_pools) && workspaceConfig.sandbox_pools.length
    ? workspaceConfig.sandbox_pools as JsonRecord[]
    : [{ provider: fallbackProvider, role: "primary", priority: 0, ...fallbackPool }];
  return rawPools.map((pool, index) => {
    const provider = String(pool.provider || fallbackProvider);
    return {
      workspace_id: workspaceId,
      provider,
      role: String(pool.role || "primary") === "standby" ? "standby" : "primary",
      priority: Number.isFinite(Number(pool.priority)) ? Math.floor(Number(pool.priority)) : index,
      name: String(pool.name || `${String(pool.role || "primary")}-${provider}-${index + 1}`),
      config: recordValue(pool.config),
      ...sandboxPoolConfig(pool),
      members: listWorkspaceSandboxPoolMembers(workspaceId, provider)
    };
  }).sort((a, b) => poolRank(a) - poolRank(b));
}

export function listWorkspaceSandboxPoolMembers(workspaceId: string, provider?: string) {
  const params = provider ? [workspaceId, provider] : [workspaceId];
  const where = provider ? "workspace_id = ? AND provider = ?" : "workspace_id = ?";
  return (db
    .prepare(`SELECT * FROM workspace_sandbox_pool_members WHERE ${where} ORDER BY created_at ASC`)
    .all(...(params as never[])) as JsonRecord[]).map(hydrateSandboxPoolMemberRow);
}

export function listSandboxPoolMembersPage(
  workspaceId: string,
  provider: string,
  opts: { limit: number; offset: number; status?: string }
) {
  const filters = ["workspace_id = ?", "provider = ?"];
  const params: unknown[] = [workspaceId, provider];
  if (opts.status) {
    filters.push("status = ?");
    params.push(opts.status);
  }
  // LIMIT/OFFSET are inlined (not bound) — this MySQL adapter rejects them as
  // prepared-statement params; limit/offset are pre-clamped integers, so it is safe.
  const limit = Math.max(0, Math.floor(opts.limit));
  const offset = Math.max(0, Math.floor(opts.offset));
  return (db
    .prepare(`SELECT * FROM workspace_sandbox_pool_members WHERE ${filters.join(" AND ")} ORDER BY created_at ASC LIMIT ${limit} OFFSET ${offset}`)
    .all(...(params as never[])) as JsonRecord[]).map(hydrateSandboxPoolMemberRow);
}

export function countSandboxPoolMembersByStatus(workspaceId: string, provider: string) {
  const rows = db
    .prepare("SELECT status, COUNT(*) AS count FROM workspace_sandbox_pool_members WHERE workspace_id = ? AND provider = ? GROUP BY status")
    .all(workspaceId, provider) as JsonRecord[];
  return countRowsToSummary(rows);
}

function poolRank(pool: { role?: string; priority?: number }) {
  return (pool.role === "standby" ? 10_000 : 0) + (Number.isFinite(Number(pool.priority)) ? Number(pool.priority) : 0);
}

export function expireSandboxPoolMembers(workspaceId: string, provider: string) {
  db.prepare(`
    UPDATE workspace_sandbox_pool_members
    SET status = 'expired', updated_at = ?
    WHERE workspace_id = ? AND provider = ? AND status IN ('standby', 'claimed') AND expires_at IS NOT NULL AND expires_at <= ?
  `).run(now(), workspaceId, provider, now());
}

export function countSandboxPoolStandbyCapacity(workspaceId: string, provider: string) {
  const row = db.prepare(`
    SELECT COUNT(*) AS count
    FROM workspace_sandbox_pool_members
    WHERE workspace_id = ?
      AND provider = ?
      AND (status = 'provisioning' OR (status = 'standby' AND (expires_at IS NULL OR expires_at > ?)))
  `).get(workspaceId, provider, now()) as JsonRecord | undefined;
  return Number(row?.count || 0);
}

export function createSandboxPoolMember(input: {
  workspace_id: string;
  provider: string;
  config?: JsonRecord;
}) {
  const stamp = now();
  const id = `spmem_${nanoid(10)}`;
  db.prepare(`
    INSERT INTO workspace_sandbox_pool_members
    (id, workspace_id, provider, sandbox_id, status, claimed_session_id, claimed_agent_id, expires_at, last_checked_at, error, config_json, created_at, updated_at)
    VALUES (?, ?, ?, '', 'provisioning', NULL, NULL, NULL, NULL, NULL, ?, ?, ?)
  `).run(id, input.workspace_id, input.provider, toJson(input.config ?? {}), stamp, stamp);
  return getSandboxPoolMember(id);
}

export function markSandboxPoolMemberReady(id: string, input: { sandbox_id: string; expires_at: string; config?: JsonRecord }) {
  const current = getSandboxPoolMember(id);
  const config = { ...recordValue(current?.config), ...recordValue(input.config) };
  db.prepare(`
    UPDATE workspace_sandbox_pool_members
    SET sandbox_id = ?, status = 'standby', claimed_session_id = NULL, claimed_agent_id = NULL, expires_at = ?, last_checked_at = ?, error = NULL, config_json = ?, updated_at = ?
    WHERE id = ?
  `).run(input.sandbox_id, input.expires_at, now(), toJson(config), now(), id);
  return getSandboxPoolMember(id);
}

export function markSandboxPoolMemberClaimed(input: {
  workspace_id: string;
  provider: string;
  session_id: string;
  agent_id?: string;
  expires_at: string;
}) {
  // Session affinity: if this session already holds a live member, reuse it instead of grabbing a
  // fresh standby. Keeps the same sandbox (and its installed packages) bound to the session across
  // concurrent/rapid reconnects. A cold session falls through to the oldest standby.
  const sticky = db.prepare(`
    SELECT *
    FROM workspace_sandbox_pool_members
    WHERE workspace_id = ? AND provider = ? AND status = 'claimed' AND claimed_session_id = ? AND sandbox_id <> '' AND (expires_at IS NULL OR expires_at > ?)
    ORDER BY updated_at DESC
    LIMIT 1
  `).get(input.workspace_id, input.provider, input.session_id, now()) as JsonRecord | undefined;
  const row = sticky ?? (db.prepare(`
    SELECT *
    FROM workspace_sandbox_pool_members
    WHERE workspace_id = ? AND provider = ? AND status = 'standby' AND sandbox_id <> '' AND (expires_at IS NULL OR expires_at > ?)
    ORDER BY updated_at ASC, created_at ASC
    LIMIT 1
  `).get(input.workspace_id, input.provider, now()) as JsonRecord | undefined);
  if (!row) return null;
  const stamp = now();
  db.prepare(`
    UPDATE workspace_sandbox_pool_members
    SET status = 'claimed', claimed_session_id = ?, claimed_agent_id = ?, expires_at = ?, last_checked_at = ?, updated_at = ?
    WHERE id = ? AND (status = 'standby' OR (status = 'claimed' AND claimed_session_id = ?))
  `).run(input.session_id, input.agent_id ?? null, input.expires_at, stamp, stamp, row.id, input.session_id);
  const member = getSandboxPoolMember(String(row.id));
  return member?.status === "claimed" && member.claimed_session_id === input.session_id ? member : null;
}

export function markSandboxPoolMemberFailed(id: string, error: unknown) {
  db.prepare(`
    UPDATE workspace_sandbox_pool_members
    SET status = 'failed', error = ?, last_checked_at = ?, updated_at = ?
    WHERE id = ?
  `).run(error instanceof Error ? error.message : String(error), now(), now(), id);
}

export function updateSandboxPoolMemberRuntime(id: string, input: { sandbox_id: string; config?: JsonRecord }) {
  const current = getSandboxPoolMember(id);
  const config = { ...recordValue(current?.config), ...recordValue(input.config) };
  db.prepare(`
    UPDATE workspace_sandbox_pool_members
    SET sandbox_id = ?, config_json = ?, last_checked_at = ?, updated_at = ?
    WHERE id = ?
  `).run(input.sandbox_id, toJson(config), now(), now(), id);
  return getSandboxPoolMember(id);
}

export function markSandboxPoolMemberExpired(id: string) {
  db.prepare(`
    UPDATE workspace_sandbox_pool_members
    SET status = 'expired', updated_at = ?
    WHERE id = ?
  `).run(now(), id);
}

export function getSandboxPoolMember(id: string) {
  const row = db.prepare("SELECT * FROM workspace_sandbox_pool_members WHERE id = ?").get(id) as JsonRecord | undefined;
  return row ? hydrateSandboxPoolMemberRow(row) : null;
}

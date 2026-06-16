import { nanoid } from "nanoid";
import type { JsonRecord } from "../types";
import { GLOBAL_SCOPE_ID, db, now, toJson } from "./storeCore";
import { scopeForParent, scopeForWorkspace } from "./storeAgentsEnvironments";
import { hydrateAgentDeploymentRow, hydrateDeploymentRunRow } from "./storeHydrators";

export type DeploymentTrigger = "manual" | "scheduled" | "invoke";

export function createAgentDeployment(input: {
  user_id: string;
  agent_id: string;
  environment_id: string;
  name: string;
  version: string;
  manifest?: JsonRecord;
  bundle?: JsonRecord;
  initial_events?: JsonRecord[];
  schedule?: JsonRecord | null;
  vault_ids?: string[];
  memory_store_ids?: string[];
  resources?: JsonRecord[];
  metadata?: JsonRecord;
  workspace_id?: string | null;
  next_run_at?: string | null;
}) {
  const stamp = now();
  const id = `dep_${nanoid(10)}`;
  const scope = input.workspace_id ? scopeForWorkspace(input.workspace_id) : scopeForParent("agents", input.agent_id);
  db.prepare(`
    INSERT INTO agent_deployments
    (id, user_id, workspace_id, tenant_id, agent_id, agent_version, environment_id, name, version, manifest_json,
     bundle_json, initial_events_json, schedule_json, vault_ids_json, memory_store_ids_json, resources_json,
     metadata_json, status, next_run_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)
  `).run(
    id,
    input.user_id,
    scope.workspace_id,
    scope.tenant_id,
    input.agent_id,
    currentAgentVersion(input.agent_id),
    input.environment_id,
    input.name,
    input.version,
    toJson(input.manifest ?? {}),
    toJson(input.bundle ?? {}),
    toJson(input.initial_events ?? []),
    input.schedule ? toJson(input.schedule) : null,
    toJson(input.vault_ids ?? []),
    toJson(input.memory_store_ids ?? []),
    toJson(input.resources ?? []),
    toJson(input.metadata ?? {}),
    input.next_run_at ?? null,
    stamp,
    stamp
  );
  return getAgentDeployment(id);
}

export function listAgentDeployments(userId: string) {
  return (db
    .prepare("SELECT * FROM agent_deployments WHERE user_id = ? AND archived_at IS NULL ORDER BY created_at DESC")
    .all(userId) as JsonRecord[])
    .map(hydrateAgentDeploymentRow);
}

export function listAgentDeploymentsForWorkspace(workspaceId: string) {
  return (db
    .prepare("SELECT * FROM agent_deployments WHERE workspace_id = ? AND archived_at IS NULL ORDER BY updated_at DESC")
    .all(workspaceId) as JsonRecord[])
    .map(hydrateAgentDeploymentRow);
}

export function listAgentDeploymentsForWorkspaces(workspaceIds: string[], userId: string) {
  const scoped = workspaceIds.length ? deploymentsInWorkspaces(workspaceIds) : [];
  const global = (db
    .prepare("SELECT * FROM agent_deployments WHERE user_id = ? AND workspace_id = ? AND archived_at IS NULL ORDER BY updated_at DESC")
    .all(userId, GLOBAL_SCOPE_ID) as JsonRecord[])
    .map(hydrateAgentDeploymentRow);
  return [...scoped, ...global].sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
}

export function getAgentDeployment(id: string, userId?: string) {
  const row = (userId
    ? db.prepare("SELECT * FROM agent_deployments WHERE id = ? AND user_id = ?").get(id, userId)
    : db.prepare("SELECT * FROM agent_deployments WHERE id = ?").get(id)) as JsonRecord | undefined;
  return row ? hydrateAgentDeploymentRow(row) : null;
}

export function updateAgentDeployment(
  id: string,
  input: {
    name?: string;
    version?: string;
    initial_events?: JsonRecord[];
    schedule?: JsonRecord | null;
    vault_ids?: string[];
    memory_store_ids?: string[];
    resources?: JsonRecord[];
    metadata?: JsonRecord;
    next_run_at?: string | null;
  }
) {
  const current = getAgentDeployment(id) as JsonRecord | null;
  if (!current) return null;
  const stamp = now();
  const hasSchedule = Object.prototype.hasOwnProperty.call(input, "schedule");
  db.prepare(`
    UPDATE agent_deployments
    SET name = ?, version = ?, initial_events_json = ?, schedule_json = ?, vault_ids_json = ?,
        memory_store_ids_json = ?, resources_json = ?, metadata_json = ?, next_run_at = ?, updated_at = ?
    WHERE id = ?
  `).run(
    input.name ?? String(current.name || ""),
    input.version ?? String(current.version || "1"),
    toJson(input.initial_events ?? ((current.initial_events as JsonRecord[] | undefined) || [])),
    hasSchedule ? (input.schedule ? toJson(input.schedule) : null) : current.schedule ? toJson(current.schedule) : null,
    toJson(input.vault_ids ?? ((current.vault_ids as string[] | undefined) || [])),
    toJson(input.memory_store_ids ?? ((current.memory_store_ids as string[] | undefined) || [])),
    toJson(input.resources ?? ((current.resources as JsonRecord[] | undefined) || [])),
    toJson(input.metadata ?? ((current.metadata as JsonRecord | undefined) || {})),
    Object.prototype.hasOwnProperty.call(input, "next_run_at") ? input.next_run_at ?? null : current.next_run_at ?? null,
    stamp,
    id
  );
  return getAgentDeployment(id);
}

export function pauseAgentDeployment(id: string, reason?: string | null) {
  const stamp = now();
  const result = db
    .prepare("UPDATE agent_deployments SET status = 'paused', paused_at = ?, paused_reason = ?, next_run_at = NULL, updated_at = ? WHERE id = ? AND archived_at IS NULL")
    .run(stamp, reason ?? null, stamp, id) as { changes?: number };
  return result.changes ? getAgentDeployment(id) : null;
}

export function unpauseAgentDeployment(id: string, nextRunAt?: string | null) {
  const stamp = now();
  const result = db
    .prepare("UPDATE agent_deployments SET status = 'active', paused_at = NULL, paused_reason = NULL, next_run_at = ?, updated_at = ? WHERE id = ? AND archived_at IS NULL")
    .run(nextRunAt ?? null, stamp, id) as { changes?: number };
  return result.changes ? getAgentDeployment(id) : null;
}

export function archiveAgentDeployment(id: string) {
  const stamp = now();
  const result = db
    .prepare("UPDATE agent_deployments SET status = 'archived', archived_at = ?, next_run_at = NULL, updated_at = ? WHERE id = ?")
    .run(stamp, stamp, id) as { changes?: number };
  return result.changes ? getAgentDeployment(id) : null;
}

export function createDeploymentRun(input: {
  deployment_id: string;
  workspace_id: string;
  tenant_id: string;
  triggered_by: DeploymentTrigger;
  triggered_by_user_id?: string | null;
  initial_events?: JsonRecord[];
  trigger_context?: JsonRecord;
}) {
  const stamp = now();
  const id = `deprun_${nanoid(10)}`;
  db.prepare(`
    INSERT INTO deployment_runs
    (id, deployment_id, workspace_id, tenant_id, triggered_by, triggered_by_user_id, status,
     initial_events_json, trigger_context_json, started_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'running', ?, ?, ?, ?, ?)
  `).run(
    id,
    input.deployment_id,
    input.workspace_id,
    input.tenant_id,
    input.triggered_by,
    input.triggered_by_user_id ?? null,
    toJson(input.initial_events ?? []),
    toJson(input.trigger_context ?? {}),
    stamp,
    stamp,
    stamp
  );
  return getDeploymentRun(id);
}

export function updateDeploymentRun(
  id: string,
  input: { status: "running" | "succeeded" | "failed"; session_id?: string | null; error?: JsonRecord | null }
) {
  const stamp = now();
  db.prepare(`
    UPDATE deployment_runs
    SET status = ?, session_id = COALESCE(?, session_id), error_json = ?, finished_at = ?, updated_at = ?
    WHERE id = ?
  `).run(input.status, input.session_id ?? null, input.error ? toJson(input.error) : null, input.status === "running" ? null : stamp, stamp, id);
  return getDeploymentRun(id);
}

export function getDeploymentRun(id: string) {
  const row = db.prepare("SELECT * FROM deployment_runs WHERE id = ?").get(id) as JsonRecord | undefined;
  return row ? hydrateDeploymentRunRow(row) : null;
}

export function listDeploymentRuns(deploymentId: string, limit = 50) {
  const size = Math.min(Math.max(Math.floor(limit), 1), 100);
  return (db
    .prepare(`SELECT * FROM deployment_runs WHERE deployment_id = ? ORDER BY created_at DESC LIMIT ${size}`)
    .all(deploymentId) as JsonRecord[])
    .map(hydrateDeploymentRunRow);
}

export function claimDueAgentDeployments(nowIso: string, lockedBy: string, limit = 10) {
  const size = Math.min(Math.max(Math.floor(limit), 1), 100);
  const rows = db
    .prepare(`
      SELECT * FROM agent_deployments
      WHERE status = 'active' AND archived_at IS NULL AND next_run_at IS NOT NULL AND next_run_at <= ?
        AND (scheduler_locked_until IS NULL OR scheduler_locked_until < ?)
      ORDER BY next_run_at ASC
      LIMIT ${size}
    `)
    .all(nowIso, nowIso) as JsonRecord[];
  const lockedUntil = new Date(Date.parse(nowIso) + 120_000).toISOString();
  const claimed: JsonRecord[] = [];
  for (const row of rows) {
    const locked = claimDeploymentRow(row, lockedBy, lockedUntil, nowIso);
    if (locked) claimed.push(locked);
  }
  return claimed.map(hydrateAgentDeploymentRow);
}

export function finishDeploymentSchedule(id: string, nextRunAt: string | null) {
  const stamp = now();
  db.prepare(`
    UPDATE agent_deployments
    SET last_run_at = ?, next_run_at = ?, scheduler_locked_until = NULL, scheduler_locked_by = NULL, updated_at = ?
    WHERE id = ?
  `).run(stamp, nextRunAt, stamp, id);
}

export function releaseDeploymentScheduleLock(id: string) {
  db.prepare("UPDATE agent_deployments SET scheduler_locked_until = NULL, scheduler_locked_by = NULL, updated_at = ? WHERE id = ?").run(now(), id);
}

function deploymentsInWorkspaces(workspaceIds: string[]) {
  const placeholders = workspaceIds.map(() => "?").join(", ");
  return (db
    .prepare(`SELECT * FROM agent_deployments WHERE workspace_id IN (${placeholders}) AND archived_at IS NULL ORDER BY updated_at DESC`)
    .all(...workspaceIds) as JsonRecord[])
    .map(hydrateAgentDeploymentRow);
}

function currentAgentVersion(agentId: string) {
  const row = db.prepare("SELECT current_version FROM agents WHERE id = ?").get(agentId) as JsonRecord | undefined;
  return row?.current_version == null ? null : Number(row.current_version);
}

function claimDeploymentRow(row: JsonRecord, lockedBy: string, lockedUntil: string, nowIso: string) {
  const result = db
    .prepare(`
      UPDATE agent_deployments
      SET scheduler_locked_until = ?, scheduler_locked_by = ?, updated_at = ?
      WHERE id = ? AND status = 'active' AND archived_at IS NULL AND next_run_at <= ?
        AND (scheduler_locked_until IS NULL OR scheduler_locked_until < ?)
    `)
    .run(lockedUntil, lockedBy, nowIso, row.id, nowIso, nowIso) as { changes?: number };
  return result.changes ? row : null;
}

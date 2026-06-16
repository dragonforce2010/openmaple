import { nanoid } from "nanoid";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { sessionsDir } from "../paths";
import type { AgentConfig, JsonRecord, SessionStatus } from "../types";
import { GLOBAL_SCOPE_ID, db, now, toJson } from "./storeCore";
import { hydrateManagedFileRow, hydrateSessionArtifactRow, hydrateSessionRow } from "./storeHydrators";
import {
  getAgent,
  getEnvironment,
  runtimePoolMemberAgentRuntime,
  scopeForParent,
  scopeForWorkspace,
  selectRuntimePoolMember
} from "./storeAgentsEnvironments";

export class WorkspaceRuntimePoolUnavailableError extends Error {
  constructor(workspaceId: string) {
    super(`workspace runtime pool has no active members: ${workspaceId}`);
    this.name = "WorkspaceRuntimePoolUnavailableError";
  }
}

export function createSession(input: { agent_id: string; environment_id: string; title?: string; metadata?: JsonRecord; workspace_id?: string | null }) {
  const agent = getAgent(input.agent_id) as (JsonRecord & { id: string; name: string; current_version: number; config: AgentConfig }) | null;
  const environment = getEnvironment(input.environment_id) as JsonRecord | null;
  if (!agent || !environment) return null;
  const workspaceId = input.workspace_id ?? (typeof agent.workspace_id === "string" ? agent.workspace_id : null) ?? (typeof environment.workspace_id === "string" ? environment.workspace_id : null);
  if (workspaceId && agent.workspace_id && agent.workspace_id !== workspaceId) return null;
  if (workspaceId && environment.workspace_id && environment.workspace_id !== workspaceId) return null;

  const hasExplicitAgentRuntime = Boolean(
    input.metadata &&
      typeof input.metadata.agent_runtime === "object" &&
      input.metadata.agent_runtime !== null &&
      Object.keys(input.metadata.agent_runtime as JsonRecord).length
  );
  const runtimePoolMember = workspaceId ? selectRuntimePoolMember(workspaceId) : null;
  if (workspaceId && !runtimePoolMember && !hasExplicitAgentRuntime && workspaceRuntimePoolRequiresMember(workspaceId)) {
    throw new WorkspaceRuntimePoolUnavailableError(workspaceId);
  }

  const stamp = now();
  const id = `sess_${nanoid(10)}`;
  const threadId = `thread_${nanoid(10)}`;
  const workspacePath = join(sessionsDir, id);
  mkdirSync(workspacePath, { recursive: true });
  const metadata = {
    ...input.metadata,
    runtime_tool_bridge_token: `rtb_${nanoid(24)}`,
    ...(workspaceId ? { workspace_id: workspaceId } : {}),
    ...(runtimePoolMember
      ? {
          runtime_pool_id: runtimePoolMember.runtime_pool_id,
          runtime_pool_member_id: runtimePoolMember.id,
          ...(hasExplicitAgentRuntime ? {} : { agent_runtime: runtimePoolMemberAgentRuntime(runtimePoolMember) })
        }
      : {})
  };

  const sessionScope = scopeForWorkspace(workspaceId);
  const tx = db.transaction(() => {
    db.prepare(`
      INSERT INTO sessions
      (id, title, agent_id, agent_version, agent_snapshot_json, environment_id, status, workspace_path, metadata_json, workspace_id, tenant_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.title || String(agent.name),
      input.agent_id,
      agent.current_version,
      toJson(agent.config),
      input.environment_id,
      "created",
      workspacePath,
      toJson(metadata),
      sessionScope.workspace_id,
      sessionScope.tenant_id,
      stamp,
      stamp
    );
    db.prepare(`
      INSERT INTO session_threads (id, session_id, agent_id, agent_name, status, workspace_id, tenant_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(threadId, id, input.agent_id, agent.name, "idle", sessionScope.workspace_id, sessionScope.tenant_id, stamp);
    if (runtimePoolMember) {
      db.prepare("UPDATE workspace_runtime_pool_members SET active_session_count = active_session_count + 1, updated_at = ? WHERE id = ?").run(
        stamp,
        runtimePoolMember.id
      );
    }
  });
  tx();
  return getSession(id);
}

function workspaceRuntimePoolRequiresMember(workspaceId: string) {
  const row = db
    .prepare("SELECT desired_size, status FROM workspace_runtime_pools WHERE workspace_id = ? ORDER BY created_at ASC LIMIT 1")
    .get(workspaceId) as { desired_size?: unknown; status?: unknown } | undefined;
  return String(row?.status || "") === "active" && Number(row?.desired_size || 0) > 0;
}

export function listSessions() {
  return (db
    .prepare("SELECT * FROM sessions ORDER BY updated_at DESC")
    .all() as JsonRecord[])
    .map(hydrateSessionRow);
}

export function getSession(id: string) {
  const row = db.prepare("SELECT * FROM sessions WHERE id = ?").get(id) as JsonRecord | undefined;
  return row ? (hydrateSessionRow(row) as unknown as JsonRecord & { id: string; workspace_path: string; environment_id: string }) : null;
}

export function createManagedFileRecord(input: {
  id: string;
  filename: string;
  media_type: string;
  bytes: number;
  sha256: string;
  storage_provider: string;
  bucket: string;
  object_key: string;
  public_url?: string | null;
  metadata?: JsonRecord;
  workspace_id?: string | null;
  tenant_id?: string | null;
  created_by_user_id?: string | null;
}) {
  const stamp = now();
  db.prepare(`
    INSERT INTO managed_files
    (id, filename, media_type, bytes, sha256, storage_provider, bucket, object_key, public_url, metadata_json, workspace_id, tenant_id, created_by_user_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    input.id,
    input.filename,
    input.media_type,
    input.bytes,
    input.sha256,
    input.storage_provider,
    input.bucket,
    input.object_key,
    input.public_url ?? null,
    toJson(input.metadata ?? {}),
    input.workspace_id ?? GLOBAL_SCOPE_ID,
    input.tenant_id ?? GLOBAL_SCOPE_ID,
    input.created_by_user_id ?? null,
    stamp
  );
  return getManagedFileRecord(input.id);
}

export function getManagedFileRecord(id: string) {
  const row = db.prepare("SELECT * FROM managed_files WHERE id = ?").get(id) as JsonRecord | undefined;
  return row ? hydrateManagedFileRow(row) : null;
}

export function upsertSessionArtifactRecord(input: {
  session_id: string;
  path: string;
  filename: string;
  media_type: string;
  size_bytes: number;
  sha256: string;
  storage_provider: string;
  bucket: string;
  object_key: string;
  public_url?: string | null;
  metadata?: JsonRecord;
  updated_at?: string;
}) {
  const existing = db
    .prepare("SELECT id FROM session_artifacts WHERE session_id = ? AND path = ?")
    .get(input.session_id, input.path) as JsonRecord | undefined;
  const stamp = now();
  const updatedAt = input.updated_at ?? stamp;
  const id = existing ? String(existing.id) : `artifact_${nanoid(10)}`;
  if (existing) {
    db.prepare(`
      UPDATE session_artifacts
      SET filename = ?, media_type = ?, size_bytes = ?, sha256 = ?, storage_provider = ?, bucket = ?, object_key = ?, public_url = ?, metadata_json = ?, updated_at = ?
      WHERE id = ?
    `).run(
      input.filename,
      input.media_type,
      input.size_bytes,
      input.sha256,
      input.storage_provider,
      input.bucket,
      input.object_key,
      input.public_url ?? null,
      toJson(input.metadata ?? {}),
      updatedAt,
      id
    );
  } else {
    const artifactScope = scopeForParent("sessions", input.session_id);
    db.prepare(`
      INSERT INTO session_artifacts
      (id, session_id, path, filename, media_type, size_bytes, sha256, storage_provider, bucket, object_key, public_url, metadata_json, workspace_id, tenant_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.session_id,
      input.path,
      input.filename,
      input.media_type,
      input.size_bytes,
      input.sha256,
      input.storage_provider,
      input.bucket,
      input.object_key,
      input.public_url ?? null,
      toJson(input.metadata ?? {}),
      artifactScope.workspace_id,
      artifactScope.tenant_id,
      stamp,
      updatedAt
    );
  }
  return getSessionArtifactRecord(input.session_id, input.path);
}

export function getSessionArtifactRecord(sessionId: string, path: string) {
  const row = db
    .prepare("SELECT * FROM session_artifacts WHERE session_id = ? AND path = ?")
    .get(sessionId, path) as JsonRecord | undefined;
  return row ? hydrateSessionArtifactRow(row) : null;
}

export function listSessionArtifactRecords(sessionId: string) {
  return (db
    .prepare("SELECT * FROM session_artifacts WHERE session_id = ? ORDER BY updated_at DESC, path ASC")
    .all(sessionId) as JsonRecord[]).map(hydrateSessionArtifactRow);
}

export function updateSessionStatus(id: string, status: SessionStatus) {
  db.prepare("UPDATE sessions SET status = ?, updated_at = ? WHERE id = ?").run(status, now(), id);
  return getSession(id);
}

export function updateSessionMetadata(id: string, patch: JsonRecord) {
  const session = getSession(id);
  if (!session) return null;
  const metadata = { ...(session.metadata as JsonRecord), ...patch };
  db.prepare("UPDATE sessions SET metadata_json = ?, updated_at = ? WHERE id = ?").run(toJson(metadata), now(), id);
  return getSession(id);
}

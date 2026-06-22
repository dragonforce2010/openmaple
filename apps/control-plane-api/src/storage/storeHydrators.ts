import type { JsonRecord } from "../types";
import { db, fromJson } from "./storeCore";
import { safeTenantMetadata } from "./tenantMetadata";

export function hydrateConfigRow(row: JsonRecord) {
  return { ...row, config: fromJson(String(row.config_json), {}) };
}

export function hydrateTenantRow(row: JsonRecord) {
  return {
    ...row,
    metadata: safeTenantMetadata(fromJson<JsonRecord>(String(row.metadata_json), {}))
  };
}

export function hydrateWorkspaceRow(row: JsonRecord) {
  return {
    ...row,
    config: fromJson(String(row.config_json), {})
  };
}

export function hydrateRuntimePoolRow(row: JsonRecord) {
  const members = (db
    .prepare("SELECT * FROM workspace_runtime_pool_members WHERE runtime_pool_id = ? ORDER BY created_at ASC")
    .all(row.id) as JsonRecord[]).map(hydrateRuntimePoolMemberRow);
  return {
    ...row,
    id: String(row.id),
    min_instances_per_function: Number(row.min_instances_per_function ?? 0),
    config: fromJson(String(row.config_json), {}),
    members
  };
}

export function hydrateRuntimePoolMemberRow(row: JsonRecord) {
  return {
    ...row,
    config: fromJson(String(row.config_json), {})
  };
}

export function hydrateMetadataRow(row: JsonRecord) {
  return { ...row, metadata: fromJson(String(row.metadata_json), {}) };
}

export function hydrateSessionRow(row: JsonRecord) {
  return {
    ...row,
    agent_snapshot: fromJson(String(row.agent_snapshot_json), {}),
    metadata: fromJson(String(row.metadata_json), {})
  };
}

export function hydrateManagedFileRow(row: JsonRecord): JsonRecord {
  return {
    ...row,
    metadata: fromJson(String(row.metadata_json), {}),
    bytes: Number(row.bytes || 0),
    public_url: row.public_url ?? null
  };
}

export function hydrateSessionArtifactRow(row: JsonRecord): JsonRecord {
  const size = Number(row.size_bytes || 0);
  return {
    ...row,
    metadata: fromJson(String(row.metadata_json), {}),
    size,
    size_bytes: size,
    public_url: row.public_url ?? null
  };
}

export function hydrateUserRow(row: JsonRecord) {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    auth_provider: row.auth_provider,
    role: row.role,
    metadata: fromJson(String(row.metadata_json), {}),
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

export function hydrateWorkspaceMemberRow(row: JsonRecord) {
  return {
    id: row.id,
    workspace_id: row.workspace_id,
    user_id: row.user_id,
    email: row.email,
    name: row.name,
    role: row.effective_role ?? row.role,
    auth_provider: row.auth_provider,
    user_role: row.user_role,
    created_at: row.created_at
  };
}

export function hydrateMemoryRow(row: JsonRecord) {
  return { ...row, metadata: fromJson(String(row.metadata_json), {}) };
}

export function hydrateVaultCredential(row: JsonRecord) {
  const { secret_ref: _secretRef, secret_cipher: _secretCipher, metadata_json: _metadataJson, ...safe } = row;
  const metadata = fromJson(String(row.metadata_json), {}) as JsonRecord;
  const status = String(row.auth_type) === "oauth" && !metadata.oauth_connected ? "pending" : "active";
  return {
    ...safe,
    metadata,
    status
  };
}

export function hydrateModelConfigRow(row: JsonRecord, includeSecret = false) {
  const { api_key_ref: _apiKeyRef, api_key_ciphertext: _apiKeyCiphertext, ...safe } = row;
  const value = {
    ...safe,
    has_api_key: Boolean(row.api_key_ciphertext || row.api_key_ref),
    is_default: Boolean(row.is_default)
  };
  return includeSecret ? { ...value, api_key_ref: row.api_key_ref, api_key_ciphertext: row.api_key_ciphertext } : value;
}

export function hydrateAgentDeploymentRow(row: JsonRecord) {
  return {
    id: row.id,
    user_id: row.user_id,
    tenant_id: row.tenant_id,
    workspace_id: row.workspace_id,
    agent_id: row.agent_id,
    agent_version: row.agent_version == null ? null : Number(row.agent_version),
    environment_id: row.environment_id,
    name: row.name,
    version: row.version,
    manifest: fromJson(String(row.manifest_json), {}),
    bundle: fromJson(String(row.bundle_json), {}),
    initial_events: fromJson(String(row.initial_events_json || "[]"), []),
    schedule: row.schedule_json ? fromJson(String(row.schedule_json), null) : null,
    vault_ids: fromJson(String(row.vault_ids_json || "[]"), []),
    memory_store_ids: fromJson(String(row.memory_store_ids_json || "[]"), []),
    resources: fromJson(String(row.resources_json || "[]"), []),
    metadata: fromJson(String(row.metadata_json || "{}"), {}),
    status: row.status,
    next_run_at: row.next_run_at ?? null,
    last_run_at: row.last_run_at ?? null,
    paused_at: row.paused_at ?? null,
    paused_reason: row.paused_reason ?? null,
    archived_at: row.archived_at ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

export function hydrateDeploymentRunRow(row: JsonRecord) {
  return {
    id: row.id,
    deployment_id: row.deployment_id,
    workspace_id: row.workspace_id,
    tenant_id: row.tenant_id,
    session_id: row.session_id ?? null,
    triggered_by: row.triggered_by,
    triggered_by_user_id: row.triggered_by_user_id ?? null,
    status: row.status,
    error: row.error_json ? fromJson(String(row.error_json), null) : null,
    initial_events: fromJson(String(row.initial_events_json || "[]"), []),
    trigger_context: fromJson(String(row.trigger_context_json || "{}"), {}),
    started_at: row.started_at,
    finished_at: row.finished_at ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

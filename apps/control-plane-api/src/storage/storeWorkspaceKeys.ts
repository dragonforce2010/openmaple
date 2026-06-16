import { nanoid } from "nanoid";
import { decryptSecret, encryptSecret } from "../secrets";
import type { JsonRecord } from "../types";
import { db, fromJson, now, toJson, workspaceApiKeyMaterial } from "./storeCore";


export function getWorkspaceApiKey(id: string, includeKey = true) {
  const row = db.prepare("SELECT * FROM workspace_api_keys WHERE id = ?").get(id) as JsonRecord | undefined;
  if (!row) return null;
  const key = includeKey ? decryptWorkspaceApiKey(row) : "";
  return {
    id: row.id,
    workspace_id: row.workspace_id,
    display_name: row.display_name,
    key_prefix: row.key_prefix,
    scopes: fromJson(String(row.scopes_json), []),
    enabled: Boolean(row.enabled),
    created_at: row.created_at,
    updated_at: row.updated_at,
    last_used_at: row.last_used_at,
    ...(key ? { key } : {})
  };
}

function decryptWorkspaceApiKey(row: JsonRecord) {
  const ciphertext = typeof row.key_ciphertext === "string" ? row.key_ciphertext : "";
  if (!ciphertext) return "";
  try {
    return decryptSecret(ciphertext);
  } catch {
    return "";
  }
}

export function listWorkspaceApiKeys(workspaceId: string) {
  return (db
    .prepare("SELECT * FROM workspace_api_keys WHERE workspace_id = ? ORDER BY created_at DESC")
    .all(workspaceId) as JsonRecord[]).map((row) => getWorkspaceApiKey(String(row.id)));
}

export function createWorkspaceApiKey(input: { workspace_id: string; display_name: string; scopes: string[] }) {
  const material = workspaceApiKeyMaterial();
  const stamp = now();
  const id = `wskey_${nanoid(10)}`;
  db.prepare(`
    INSERT INTO workspace_api_keys
    (id, workspace_id, display_name, key_hash, key_prefix, key_ciphertext, scopes_json, enabled, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
  `).run(id, input.workspace_id, input.display_name, material.hash, material.prefix, encryptSecret(material.raw), toJson(input.scopes), stamp, stamp);
  return {
    ...(getWorkspaceApiKey(id) as JsonRecord),
    key: material.raw
  };
}

export function updateWorkspaceApiKey(workspaceId: string, keyId: string, input: { display_name?: string; enabled?: boolean }) {
  const current = getWorkspaceApiKey(keyId) as JsonRecord | null;
  if (!current || current.workspace_id !== workspaceId) return null;
  db.prepare("UPDATE workspace_api_keys SET display_name = ?, enabled = ?, updated_at = ? WHERE id = ? AND workspace_id = ?").run(
    input.display_name ?? current.display_name,
    input.enabled === undefined ? (current.enabled ? 1 : 0) : input.enabled ? 1 : 0,
    now(),
    keyId,
    workspaceId
  );
  return getWorkspaceApiKey(keyId);
}

export function deleteWorkspaceApiKey(workspaceId: string, keyId: string) {
  const result = db.prepare("DELETE FROM workspace_api_keys WHERE id = ? AND workspace_id = ?").run(keyId, workspaceId) as { changes?: number };
  return Number(result.changes ?? 0) > 0;
}

export function getWorkspaceApiKeyByHash(keyHash: string) {
  const row = db
    .prepare(
      `SELECT workspace_api_keys.*, workspaces.created_by_user_id, workspaces.status AS workspace_status
       FROM workspace_api_keys
       JOIN workspaces ON workspaces.id = workspace_api_keys.workspace_id
       WHERE workspace_api_keys.key_hash = ?`
    )
    .get(keyHash) as JsonRecord | undefined;
  if (!row) return null;
  return {
    ...(getWorkspaceApiKey(String(row.id), false) as JsonRecord),
    created_by_user_id: row.created_by_user_id,
    workspace_status: row.workspace_status
  };
}

export function touchWorkspaceApiKey(id: string) {
  db.prepare("UPDATE workspace_api_keys SET last_used_at = ?, updated_at = ? WHERE id = ?").run(now(), now(), id);
  return getWorkspaceApiKey(id, false);
}

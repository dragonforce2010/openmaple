import { nanoid } from "nanoid";
import { decryptSecret, encryptSecret } from "../secrets";
import type { JsonRecord } from "../types";
import { db, fromJson, now, tenantApiKeyMaterial, toJson } from "./storeCore";

export function getTenantApiKey(id: string, includeKey = true) {
  const row = db.prepare("SELECT * FROM tenant_api_keys WHERE id = ?").get(id) as JsonRecord | undefined;
  if (!row) return null;
  const key = includeKey ? decryptTenantApiKey(row) : "";
  return {
    id: row.id,
    tenant_id: row.tenant_id,
    display_name: row.display_name,
    key_prefix: row.key_prefix,
    scopes: fromJson(String(row.scopes_json), []),
    enabled: Boolean(row.enabled),
    created_by_user_id: row.created_by_user_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
    last_used_at: row.last_used_at,
    ...(key ? { key } : {})
  };
}

function decryptTenantApiKey(row: JsonRecord) {
  const ciphertext = typeof row.key_ciphertext === "string" ? row.key_ciphertext : "";
  if (!ciphertext) return "";
  try {
    return decryptSecret(ciphertext);
  } catch {
    return "";
  }
}

export function listTenantApiKeys(tenantId: string) {
  return (db
    .prepare("SELECT * FROM tenant_api_keys WHERE tenant_id = ? ORDER BY created_at DESC")
    .all(tenantId) as JsonRecord[]).map((row) => getTenantApiKey(String(row.id)));
}

export function createTenantApiKey(input: { tenant_id: string; display_name: string; scopes: string[]; created_by_user_id: string }) {
  const material = tenantApiKeyMaterial();
  const stamp = now();
  const id = `tnkey_${nanoid(10)}`;
  db.prepare(`
    INSERT INTO tenant_api_keys
    (id, tenant_id, display_name, key_hash, key_prefix, key_ciphertext, scopes_json, enabled, created_by_user_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
  `).run(id, input.tenant_id, input.display_name, material.hash, material.prefix, encryptSecret(material.raw), toJson(input.scopes), input.created_by_user_id, stamp, stamp);
  return {
    ...(getTenantApiKey(id) as JsonRecord),
    key: material.raw
  };
}

export function updateTenantApiKey(tenantId: string, keyId: string, input: { display_name?: string; enabled?: boolean }) {
  const current = getTenantApiKey(keyId) as JsonRecord | null;
  if (!current || current.tenant_id !== tenantId) return null;
  db.prepare("UPDATE tenant_api_keys SET display_name = ?, enabled = ?, updated_at = ? WHERE id = ? AND tenant_id = ?").run(
    input.display_name ?? current.display_name,
    input.enabled === undefined ? (current.enabled ? 1 : 0) : input.enabled ? 1 : 0,
    now(),
    keyId,
    tenantId
  );
  return getTenantApiKey(keyId);
}

export function deleteTenantApiKey(tenantId: string, keyId: string) {
  const result = db.prepare("DELETE FROM tenant_api_keys WHERE id = ? AND tenant_id = ?").run(keyId, tenantId) as { changes?: number };
  return Number(result.changes ?? 0) > 0;
}

export function getTenantApiKeyByHash(keyHash: string) {
  const row = db
    .prepare(
      `SELECT tenant_api_keys.*, tenants.status AS tenant_status
       FROM tenant_api_keys
       JOIN tenants ON tenants.id = tenant_api_keys.tenant_id
       WHERE tenant_api_keys.key_hash = ?`
    )
    .get(keyHash) as JsonRecord | undefined;
  if (!row) return null;
  return {
    ...(getTenantApiKey(String(row.id), false) as JsonRecord),
    tenant_status: row.tenant_status
  };
}

export function touchTenantApiKey(id: string) {
  db.prepare("UPDATE tenant_api_keys SET last_used_at = ?, updated_at = ? WHERE id = ?").run(now(), now(), id);
  return getTenantApiKey(id, false);
}

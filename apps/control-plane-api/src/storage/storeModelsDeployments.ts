import { nanoid } from "nanoid";
import type { JsonRecord } from "../types";
import { GLOBAL_SCOPE_ID, db, now, toJson } from "./storeCore";
import { hydrateModelConfigRow } from "./storeHydrators";

export function createModelConfig(input: {
  owner_user_id?: string | null;
  name: string;
  provider_type: string;
  base_url: string;
  model_name: string;
  api_key_ref?: string | null;
  api_key_ciphertext?: string | null;
  api_key_hint?: string | null;
  preset_key?: string | null;
  is_default?: boolean;
  workspace_id?: string | null;
  tenant_id?: string | null;
  created_by_user_id?: string | null;
}) {
  const stamp = now();
  const id = `modelcfg_${nanoid(10)}`;
  const workspaceId = input.workspace_id ?? GLOBAL_SCOPE_ID;
  const tenantId = input.tenant_id ?? GLOBAL_SCOPE_ID;
  const existingDefault = db
    .prepare("SELECT id FROM model_configs WHERE workspace_id = ? AND is_default = 1")
    .get(workspaceId) as JsonRecord | undefined;
  const isDefault = input.is_default ?? !existingDefault;
  const tx = db.transaction(() => {
    if (isDefault) db.prepare("UPDATE model_configs SET is_default = 0 WHERE workspace_id = ?").run(workspaceId);
    db.prepare(`
      INSERT INTO model_configs
      (id, owner_user_id, workspace_id, tenant_id, created_by_user_id, name, provider_type, base_url, model_name, api_key_ref, api_key_ciphertext, api_key_hint, preset_key, is_default, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.owner_user_id ?? null,
      workspaceId,
      tenantId,
      input.created_by_user_id ?? input.owner_user_id ?? null,
      input.name,
      input.provider_type,
      input.base_url.replace(/\/$/, ""),
      input.model_name,
      input.api_key_ref ?? null,
      input.api_key_ciphertext ?? null,
      input.api_key_hint ?? null,
      input.preset_key ?? null,
      isDefault ? 1 : 0,
      stamp,
      stamp
    );
  });
  tx();
  return getModelConfig(id);
}

export function ensureGlobalDefaultModel() {
  const hasDefault = db.prepare("SELECT 1 AS ok FROM model_configs WHERE workspace_id = ? AND is_default = 1 LIMIT 1").get(GLOBAL_SCOPE_ID);
  if (hasDefault) return;
  const fallback = db.prepare("SELECT id FROM model_configs WHERE workspace_id = ? AND preset_key IS NOT NULL ORDER BY created_at ASC LIMIT 1").get(GLOBAL_SCOPE_ID) as { id?: string } | undefined;
  if (fallback?.id) db.prepare("UPDATE model_configs SET is_default = 1 WHERE id = ?").run(String(fallback.id));
}

// Stable order by created_at only: toggling a default must NOT reorder the list. Callers that
// need the default model use getDefaultModelConfig, not list[0].
export function listModelConfigs(workspaceId: string) {
  return (db
    .prepare("SELECT * FROM model_configs WHERE workspace_id = ? OR workspace_id = ? ORDER BY created_at DESC")
    .all(workspaceId, GLOBAL_SCOPE_ID) as JsonRecord[])
    .map((row) => hydrateModelConfigRow(row));
}

export function listGlobalModelConfigs() {
  return (db
    .prepare("SELECT * FROM model_configs WHERE workspace_id = ? ORDER BY created_at DESC")
    .all(GLOBAL_SCOPE_ID) as JsonRecord[])
    .map((row) => hydrateModelConfigRow(row));
}

export function getModelConfig(id: string, workspaceId?: string) {
  const row = (workspaceId
    ? db.prepare("SELECT * FROM model_configs WHERE id = ? AND (workspace_id = ? OR workspace_id = ?)").get(id, workspaceId, GLOBAL_SCOPE_ID)
    : db.prepare("SELECT * FROM model_configs WHERE id = ?").get(id)) as JsonRecord | undefined;
  return row ? hydrateModelConfigRow(row) : null;
}

export function updateModelConfig(
  id: string,
  input: { name?: string; base_url?: string; model_name?: string; is_default?: boolean; updated_by_user_id?: string | null }
) {
  const current = getModelConfig(id) as JsonRecord | null;
  if (!current) return null;
  const workspaceId = String(current.workspace_id ?? GLOBAL_SCOPE_ID);
  const stamp = now();
  const tx = db.transaction(() => {
    if (input.is_default) db.prepare("UPDATE model_configs SET is_default = 0 WHERE workspace_id = ?").run(workspaceId);
    db.prepare(`
      UPDATE model_configs
      SET name = ?, base_url = ?, model_name = ?, is_default = ?, updated_by_user_id = ?, updated_at = ?
      WHERE id = ?
    `).run(
      input.name ?? String(current.name || ""),
      String((input.base_url ?? current.base_url) || "").replace(/\/$/, ""),
      input.model_name ?? String(current.model_name || ""),
      input.is_default === undefined ? (current.is_default ? 1 : 0) : input.is_default ? 1 : 0,
      input.updated_by_user_id ?? null,
      stamp,
      id
    );
  });
  tx();
  return getModelConfig(id);
}

export function updateModelConfigSecret(
  id: string,
  input: { api_key_ciphertext: string; api_key_hint: string | null }
) {
  const stamp = now();
  const result = db.prepare(`
    UPDATE model_configs
    SET api_key_ref = NULL, api_key_ciphertext = ?, api_key_hint = ?, updated_at = ?
    WHERE id = ?
  `).run(input.api_key_ciphertext, input.api_key_hint, stamp, id) as { changes?: number };
  return result.changes ? getModelConfig(id) : null;
}

export function deleteModelConfig(id: string, workspaceId?: string) {
  const current = getModelConfig(id, workspaceId) as JsonRecord | null;
  if (!current) return false;
  const ownerWorkspaceId = String(current.workspace_id ?? GLOBAL_SCOPE_ID);
  let fallbackId: unknown;
  if (current.is_default) {
    const fallback = db
      .prepare("SELECT id FROM model_configs WHERE workspace_id = ? AND id != ? ORDER BY created_at DESC LIMIT 1")
      .get(ownerWorkspaceId, id) as JsonRecord | undefined;
    fallbackId = fallback?.id;
  }
  const tx = db.transaction(() => {
    db.prepare("DELETE FROM model_configs WHERE id = ?").run(id);
    if (fallbackId) db.prepare("UPDATE model_configs SET is_default = 1 WHERE id = ?").run(fallbackId);
  });
  tx();
  return true;
}

export function getModelConfigInternal(id: string, workspaceId?: string) {
  const row = (workspaceId
    ? db.prepare("SELECT * FROM model_configs WHERE id = ? AND (workspace_id = ? OR workspace_id = ?)").get(id, workspaceId, GLOBAL_SCOPE_ID)
    : db.prepare("SELECT * FROM model_configs WHERE id = ?").get(id)) as JsonRecord | undefined;
  return row ? hydrateModelConfigRow(row, true) : null;
}

export function getDefaultModelConfig(workspaceId?: string) {
  const row = (workspaceId
    ? db
        .prepare("SELECT * FROM model_configs WHERE (workspace_id = ? OR workspace_id = ?) AND is_default = 1 ORDER BY created_at DESC LIMIT 1")
        .get(workspaceId, GLOBAL_SCOPE_ID)
    : db.prepare("SELECT * FROM model_configs WHERE is_default = 1 ORDER BY created_at DESC LIMIT 1").get()) as JsonRecord | undefined;
  return row ? hydrateModelConfigRow(row) : null;
}

export function getDefaultModelConfigInternal(workspaceId?: string) {
  const row = (workspaceId
    ? db
        .prepare("SELECT * FROM model_configs WHERE (workspace_id = ? OR workspace_id = ?) AND is_default = 1 ORDER BY created_at DESC LIMIT 1")
        .get(workspaceId, GLOBAL_SCOPE_ID)
    : db.prepare("SELECT * FROM model_configs WHERE is_default = 1 ORDER BY created_at DESC LIMIT 1").get()) as JsonRecord | undefined;
  return row ? hydrateModelConfigRow(row, true) : null;
}

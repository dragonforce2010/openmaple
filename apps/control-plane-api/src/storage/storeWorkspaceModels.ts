import { nanoid } from "nanoid";
import type { JsonRecord } from "../types";
import { GLOBAL_SCOPE_ID, db } from "./storeCore";

type WorkspaceModelConfig = {
  id: string;
  source: JsonRecord;
  clone: boolean;
};

export function workspaceModelConfigsForCreate(input: { model_config_ids?: string[]; workspaceId: string }) {
  const ids = Array.from(new Set(input.model_config_ids ?? []));
  return ids
    .map((id) => {
      const source = db.prepare("SELECT * FROM model_configs WHERE id = ?").get(id) as JsonRecord | undefined;
      if (!source) return null;
      const sourceWorkspaceId = String(source.workspace_id ?? GLOBAL_SCOPE_ID);
      if (sourceWorkspaceId === GLOBAL_SCOPE_ID || sourceWorkspaceId === input.workspaceId) return { id, source, clone: false };
      return { id: `modelcfg_${nanoid(10)}`, source, clone: true };
    })
    .filter(Boolean) as WorkspaceModelConfig[];
}

export function insertWorkspaceModelConfigClone(item: WorkspaceModelConfig, input: { workspaceId: string; tenantId: string; userId: string; stamp: string }) {
  if (!item.clone) return;
  const isDefault = Number(item.source.is_default) === 1;
  if (isDefault) db.prepare("UPDATE model_configs SET is_default = 0 WHERE workspace_id = ?").run(input.workspaceId);
  db.prepare(`
    INSERT INTO model_configs
    (id, owner_user_id, workspace_id, tenant_id, created_by_user_id, name, provider_type, base_url, model_name, api_key_ref, api_key_ciphertext, api_key_hint, preset_key, is_default, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    item.id,
    input.userId,
    input.workspaceId,
    input.tenantId,
    input.userId,
    String(item.source.name || "Model config"),
    String(item.source.provider_type || "openai"),
    String(item.source.base_url || "").replace(/\/$/, ""),
    String(item.source.model_name || ""),
    item.source.api_key_ref ?? null,
    item.source.api_key_ciphertext ?? null,
    item.source.api_key_hint ?? null,
    item.source.preset_key ?? null,
    isDefault ? 1 : 0,
    input.stamp,
    input.stamp
  );
}

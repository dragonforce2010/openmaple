import { useState } from "react";
import { apiPost } from "../../api";
import type { Vault } from "../../types";
import { Icon } from "../../ui";


import { useL } from "../../appConfig";
import { ModalShell } from "../../components/shared/layout";
import { errorMessage } from "../../components/shared/misc";

export function VaultModal({ workspaceId, onClose, onCreated }: { workspaceId?: string; onClose: () => void; onCreated: (vault: Vault) => void | Promise<void> }) {
  const L = useL();
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  async function save() {
    setSaving(true);
    setError("");
    try {
      const vault = await apiPost<Vault>("/v1/vaults", { workspace_id: workspaceId || undefined, display_name: name.trim(), metadata: { shared_scope: "workspace" } });
      await onCreated(vault);
    } catch (reason) {
      setError(errorMessage(reason));
      setSaving(false);
    }
  }
  return (
    <ModalShell title={L("创建凭证库", "Create vault")} onClose={onClose}>
      {error ? <div className="modal-note"><Icon name="i-alert" size={16} /> {error}</div> : null}
      <div className="modal-note"><Icon name="i-alert" size={16} /> {L("Vault 在当前工作区内共享。加入该 Vault 的凭据可被拥有 API key 访问权限的成员使用。", "Vaults are shared across this workspace. Credentials added to this vault will be usable by anyone with API key access.")}</div>
      <label className="form">{L("名称", "Name")}<input className="fld" autoFocus value={name} onChange={(event) => setName(event.target.value)} maxLength={50} placeholder={L("生产凭证库", "Production vault")} /><em className="fhint">{L("最多 50 个字符。", "50 characters or fewer.")}</em></label>
      <div className="modal-foot">
        <button className="btn primary" onClick={save} disabled={saving || !name.trim()}>{saving ? L("创建中…", "Creating...") : L("继续", "Continue")}</button>
      </div>
    </ModalShell>
  );
}

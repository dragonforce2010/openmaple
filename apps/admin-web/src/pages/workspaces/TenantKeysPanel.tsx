import { useEffect, useState } from "react";
import { apiDelete, apiGet, apiPatch, apiPost, type ApiList } from "../../api";
import { DataTable } from "../../components/shared/layout";
import { errorMessage, formatTime } from "../../components/shared/misc";
import type { TenantApiKey } from "../../types";
import { Icon, useConfirm, useToast } from "../../ui";

type LFn = (zh: string, en: string) => string;

export function TenantKeysPanel({ tenantId, L }: { tenantId: string; L: LFn }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [keys, setKeys] = useState<TenantApiKey[]>([]);
  const [issuedKey, setIssuedKey] = useState("");
  const [keyName, setKeyName] = useState("Tenant Admin Key");
  const [busy, setBusy] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    if (!tenantId) {
      setKeys([]);
      return;
    }
    setLoading(true);
    setError("");
    apiGet<ApiList<TenantApiKey>>(`/v1/tenants/${encodeURIComponent(tenantId)}/api_keys`)
      .then((result) => { if (!cancelled) setKeys(result.data); })
      .catch((reason) => { if (!cancelled) setError(errorMessage(reason)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [tenantId]);

  async function createKey() {
    if (!tenantId || !keyName.trim() || busy) return;
    setBusy("create");
    setError("");
    try {
      const key = await apiPost<TenantApiKey>(`/v1/tenants/${encodeURIComponent(tenantId)}/api_keys`, {
        display_name: keyName.trim(),
        scopes: ["tenant_admin", "control_plane", "data_plane"]
      });
      setKeys((current) => [key, ...current]);
      setIssuedKey(key.key || "");
      setKeyName("Tenant Admin Key");
      toast(L("已创建租户 AKSK", "Tenant AKSK created"), "ok");
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy("");
    }
  }

  async function toggleKey(key: TenantApiKey) {
    if (!tenantId || busy) return;
    setBusy(key.id);
    try {
      const next = await apiPatch<TenantApiKey>(`/v1/tenants/${encodeURIComponent(tenantId)}/api_keys/${encodeURIComponent(key.id)}`, { enabled: !key.enabled });
      setKeys((current) => current.map((item) => item.id === key.id ? next : item));
      toast(next.enabled ? L("已启用", "Enabled") : L("已停用", "Disabled"), "ok");
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy("");
    }
  }

  async function deleteKey(key: TenantApiKey) {
    if (!tenantId || busy) return;
    const ok = await confirm({
      title: L("删除租户 AKSK", "Delete tenant AKSK"),
      body: L(`确定删除 ${key.display_name}？`, `Delete ${key.display_name}?`),
      confirmLabel: L("删除", "Delete"),
      cancelLabel: L("取消", "Cancel"),
      danger: true
    });
    if (!ok) return;
    setBusy(key.id);
    try {
      await apiDelete(`/v1/tenants/${encodeURIComponent(tenantId)}/api_keys/${encodeURIComponent(key.id)}`);
      setKeys((current) => current.filter((item) => item.id !== key.id));
      toast(L("已删除", "Deleted"), "ok");
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy("");
    }
  }

  function copyValue(value: string) {
    if (!value) return;
    try {
      navigator.clipboard?.writeText(value);
    } catch {
      /* clipboard unavailable */
    }
    toast(L("已复制", "Copied"), "ok");
  }

  function maskedKey(key: TenantApiKey) {
    if (key.key) return `${key.key.slice(0, 10)}…${key.key.slice(-6)}`;
    return `${key.key_prefix}…`;
  }

  return (
    <>
      <div className="section-title">{L("租户 AKSK", "Tenant AKSK")}</div>
      {issuedKey ? (
        <div className="modal-note key-issued-note">
          <Icon name="i-check" size={16} />
          <div>
            <b>{L("完整租户 AKSK 已创建", "Full tenant AKSK issued")}</b>
            <p className="note-copy-once">{L("该 key 可管理租户下的工作区、成员与资产，请立即复制并妥善保存。", "This key can manage workspaces, members, and assets under this tenant. Copy and store it now.")}</p>
            <div className="reveal-key compact">
              <code>{issuedKey}</code>
              <button className="btn secondary compact" onClick={() => copyValue(issuedKey)}><Icon name="i-copy" size={13} /> {L("复制完整 Key", "Copy full key")}</button>
            </div>
          </div>
        </div>
      ) : null}
      <div className="settings-inline-form key-create-row">
        <label className="form">{L("名称", "Display name")}<input className="fld" value={keyName} onChange={(event) => setKeyName(event.target.value)} placeholder="Tenant Admin Key" /></label>
        <button className="btn primary" onClick={createKey} disabled={!tenantId || busy === "create" || !keyName.trim()}>
          {busy === "create" ? L("创建中…", "Creating…") : L("创建租户 AKSK", "Create tenant AKSK")}
        </button>
      </div>
      {error ? <div className="modal-note"><Icon name="i-alert" size={16} /> {error}</div> : null}
      <div className="settings-table keys-table">
        <DataTable headers={[L("名称", "Name"), "Key", L("权限范围", "Scopes"), L("状态", "Status"), L("最后使用", "Last used"), ""]} loading={loading}>
          {keys.map((key) => (
            <tr key={key.id}>
              <td><strong>{key.display_name}</strong><small>{key.id}</small></td>
              <td><div className="secret-line ws-secret-line"><code className="mono">{maskedKey(key)}</code><button className="icon-btn" title={L("复制完整 Key", "Copy full key")} onClick={() => copyValue(key.key || key.key_prefix)}><Icon name="i-copy" size={14} /></button></div></td>
              <td>{key.scopes.length ? <div className="scope-chip-row">{key.scopes.map((scope) => <span className="scope-chip" key={scope}>{scope}</span>)}</div> : "—"}</td>
              <td><span className={`status ${key.enabled ? "active" : "idle"}`}>{key.enabled ? L("已启用", "Enabled") : L("已停用", "Disabled")}</span></td>
              <td>{key.last_used_at ? formatTime(key.last_used_at) : L("从未", "Never")}</td>
              <td className="actions-cell"><div className="action-row"><button className="btn secondary compact" onClick={() => toggleKey(key)} disabled={!!busy}>{busy === key.id ? <span className="spin-dot" /> : null}{key.enabled ? L("停用", "Disable") : L("启用", "Enable")}</button><button className="btn secondary compact danger-text" onClick={() => deleteKey(key)} disabled={!!busy}><Icon name="i-trash" size={13} /></button></div></td>
            </tr>
          ))}
        </DataTable>
      </div>
    </>
  );
}

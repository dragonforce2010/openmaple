import { useCallback, useEffect, useState } from "react";
import { apiDelete, apiGet, apiPatch, apiPost } from "../../api";
import type { Vault, VaultCredential } from "../../types";
import { Icon, useConfirm, useDrawerStack, useToast } from "../../ui";
import { credentialRouteId, currentCredentialDetailReturnPath, useEntityNav, useI18n } from "../../appConfig";
import { credentialAuthLabel, credentialLastUsed, credentialProviderName, statusPill } from "../../components/shared/labels";
import { Crumb, PageFrame } from "../../components/shared/layout";
import { errorMessage, formatRelativeTime } from "../../components/shared/misc";
import { CredentialDetailView } from "./CredentialDetailView";

export function VaultDetailView({ vaultId, embedded }: { vaultId: string; embedded?: boolean }) {
  const { language } = useI18n();
  const L = (zh: string, en: string) => (language === "zh" ? zh : en);
  const { data, goView, openCredentialForVault, refresh } = useEntityNav();
  const toast = useToast();
  const confirm = useConfirm();
  const drawerStack = useDrawerStack();
  const summary = data.vaults.find((v) => v.id === vaultId) ?? null;
  const credentialCount = summary?.credential_count ?? 0;
  const [detail, setDetail] = useState<Vault | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [busyCredentialId, setBusyCredentialId] = useState("");
  const refreshDetail = useCallback(async () => {
    if (!vaultId) return;
    const vault = await apiGet<Vault>(`/v1/vaults/${vaultId}`);
    setDetail(vault);
  }, [vaultId]);

  useEffect(() => {
    let cancelled = false;
    if (!vaultId) { setDetail(null); return; }
    setLoading(true);
    setError("");
    apiGet<Vault>(`/v1/vaults/${vaultId}`)
      .then((v) => { if (!cancelled) setDetail(v); })
      .catch((reason) => { if (!cancelled) setError(errorMessage(reason)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [vaultId, credentialCount]);
  const vault = detail?.id === vaultId ? detail : summary;
  const credentials = vault?.credentials ?? [];
  const hasCredentials = credentials.length > 0 || Number(vault?.credential_count ?? 0) > 0;

  async function archiveCredential(credential: VaultCredential, mode: "archive" | "delete") {
    const ok = await confirm({
      title: mode === "delete" ? L("删除 credential?", "Delete credential?") : L("归档 credential?", "Archive credential?"),
      body: mode === "delete"
        ? L("该 credential 会从此 vault 中移除，已有会话不会再看到它。", "This credential will be removed from this vault and hidden from new sessions.")
        : L("该 credential 会从列表中隐藏，可避免后续 Agent 继续使用。", "This credential will be hidden so future agents do not use it."),
      confirmLabel: mode === "delete" ? L("删除", "Delete") : L("归档", "Archive"),
      danger: mode === "delete"
    });
    if (!ok || busyCredentialId) return;
    setBusyCredentialId(credential.id);
    try {
      if (mode === "delete") {
        await apiDelete<{ ok: boolean }>(`/v1/vaults/${vaultId}/credentials/${credential.id}`);
      } else {
        await apiPatch<{ ok: boolean }>(`/v1/vaults/${vaultId}/credentials/${credential.id}/archive`, {});
      }
      await refreshDetail();
      await refresh();
      toast(mode === "delete" ? L("Credential 已删除", "Credential deleted") : L("Credential 已归档", "Credential archived"), "ok");
    } catch (reason) {
      toast(errorMessage(reason), "err");
    } finally {
      setBusyCredentialId("");
    }
  }

  async function connectCredential(credential: VaultCredential) {
    if (busyCredentialId) return;
    setBusyCredentialId(credential.id);
    try {
      const start = await apiPost<{ authorize_url: string }>(`/v1/vaults/${vaultId}/credentials/${credential.id}/oauth/start`, {
        return_to: currentCredentialDetailReturnPath(vaultId, credential.id)
      });
      window.location.href = start.authorize_url;
    } catch (reason) {
      toast(errorMessage(reason), "err");
      setBusyCredentialId("");
    }
  }

  function openCredentialDetail(credential: VaultCredential) {
    const routeId = credentialRouteId(vaultId, credential.id);
    if (drawerStack.depth >= 3) {
      drawerStack.closeAll();
      goView("credential", routeId);
      return;
    }
    drawerStack.open({
      key: `credential-detail-${credential.id}-${drawerStack.depth}`,
      title: credential.name || credential.id,
      sub: credential.id,
      body: <CredentialDetailView routeId={routeId} />
    });
  }

  const content = (
    <div className="vault-detail-body detail-doc">
      {loading && !vault ? (
        <div className="panel-empty">{L("加载 vault...", "Loading vault...")}</div>
      ) : error ? (
        <div className="panel-empty danger-text"><Icon name="i-alert" size={16} /> {error}</div>
      ) : vault ? (
        <>
          <div className="vault-detail-head">
            <div className="vault-title-block">
              <div className="vault-title-line"><h2>{vault.display_name}</h2>{statusPill("active", L)}</div>
              <div className="vault-meta">
                <span>{vault.id}</span>
                <span>{L("创建", "Created")} {formatRelativeTime(vault.created_at, language)}</span>
                <span>{L("更新", "Updated")} {formatRelativeTime(vault.updated_at, language)}</span>
              </div>
            </div>
            <button className="btn primary" onClick={() => openCredentialForVault(vault.id)}>
              <Icon name="i-plus" size={14} /> {L("添加 credential", "Add credential")}
            </button>
          </div>
          {credentials.length ? (
            <div className="vault-credential-wrap">
              <table className="data-table vault-credential-table">
                <thead>
                  <tr><th>ID</th><th>{L("名称", "Name")}</th><th>{L("Auth", "Auth")}</th><th>{L("状态", "Status")}</th><th>{L("Last used", "Last used")}</th><th>{L("Updated", "Updated")}</th><th>{L("操作", "Actions")}</th></tr>
                </thead>
                <tbody>
                  {credentials.map((credential) => (
                    <tr key={credential.id} className="clickable-row" onClick={() => openCredentialDetail(credential)}>
                      <td><button className="id-link ghost-link" onClick={(event) => { event.stopPropagation(); openCredentialDetail(credential); }}>{credential.id}</button></td>
                      <td className="t-name"><b>{credential.name}</b><small>{credentialProviderName(credential)}</small></td>
                      <td><span className="cred-auth-cell"><b>{credentialAuthLabel(credential.auth_type, language)}</b><small>{credential.mcp_server_url || "-"}</small></span></td>
                      <td>{statusPill(credential.status || "active", L)}</td>
                      <td>{credentialLastUsed(credential, language)}</td>
                      <td>{formatRelativeTime(credential.updated_at, language)}</td>
                      <td className="row-actions">
                        <div className="action-row vault-credential-actions">
                          {credential.auth_type === "oauth" && credential.status === "pending" ? (
                            <button className="btn primary compact" disabled={busyCredentialId === credential.id} onClick={(event) => { event.stopPropagation(); void connectCredential(credential); }}>
                              {busyCredentialId === credential.id ? <span className="spin-dot" aria-hidden /> : <Icon name="i-play" size={13} />}
                              {L("继续授权", "Authorize")}
                            </button>
                          ) : null}
                          <button className="btn secondary compact" disabled={busyCredentialId === credential.id} onClick={(event) => { event.stopPropagation(); void archiveCredential(credential, "archive"); }}>
                            {busyCredentialId === credential.id ? <span className="spin-dot" aria-hidden /> : <Icon name="i-archive" size={13} />}
                            {L("归档", "Archive")}
                          </button>
                          <button className="btn secondary compact danger-text" disabled={busyCredentialId === credential.id} onClick={(event) => { event.stopPropagation(); void archiveCredential(credential, "delete"); }}>
                            <Icon name="i-trash" size={13} /> {L("删除", "Delete")}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : hasCredentials ? (
            <div className="panel-empty">{L("正在加载 credentials...", "Loading credentials...")}</div>
          ) : (
            <div className="vault-empty compact">
              <span><Icon name="i-lock" size={20} /></span>
              <b>{L("还没有 credentials", "No credentials yet")}</b>
              <p>{L("添加第一个 credential，让 Agent 可以使用 MCP server。", "Add the first credential so agents can use this vault.")}</p>
              <button className="btn primary" onClick={() => openCredentialForVault(vault.id)}><Icon name="i-plus" size={14} /> {L("添加 credential", "Add credential")}</button>
            </div>
          )}
        </>
      ) : (
        <div className="panel-empty">{L("未找到 vault", "Vault not found")}</div>
      )}
    </div>
  );
  if (embedded) return content;
  return <PageFrame title={vault?.display_name ?? "Vault"} crumb={<Crumb parts={[{ label: L("凭证库", "Vaults"), icon: "i-key", onClick: () => goView("vaults") }, { label: vault?.display_name ?? vaultId }]} />}>{content}</PageFrame>;
}

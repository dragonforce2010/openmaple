import { useCallback, useEffect, useState } from "react";
import { apiDelete, apiGet, apiPatch, apiPost } from "../../api";
import { currentCredentialDetailReturnPath, parseCredentialRouteId, useEntityNav, useI18n } from "../../appConfig";
import { credentialAuthLabel, credentialLastUsed, credentialProviderName, statusPill } from "../../components/shared/labels";
import { Crumb, PageFrame } from "../../components/shared/layout";
import { errorMessage, formatRelativeTime } from "../../components/shared/misc";
import type { Vault, VaultCredential } from "../../types";
import { Icon, useConfirm, useToast } from "../../ui";

type CredentialDetail = VaultCredential & { vault: Vault };

function metadataRows(metadata: Record<string, unknown>) {
  return Object.entries(metadata).filter(([, value]) => value !== null && value !== undefined && String(value) !== "");
}

export function CredentialDetailView({ routeId }: { routeId: string }) {
  const route = parseCredentialRouteId(routeId);
  const { language } = useI18n();
  const L = (zh: string, en: string) => (language === "zh" ? zh : en);
  const { goView, refresh } = useEntityNav();
  const toast = useToast();
  const confirm = useConfirm();
  const [credential, setCredential] = useState<CredentialDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!route) return;
    const detail = await apiGet<CredentialDetail>(`/v1/vaults/${route.vaultId}/credentials/${route.credentialId}`);
    setCredential(detail);
  }, [route?.vaultId, route?.credentialId]);

  useEffect(() => {
    let cancelled = false;
    if (!route) { setCredential(null); setError(L("Credential URL 无效", "Invalid credential URL")); return; }
    setLoading(true);
    setError("");
    load()
      .catch((reason) => { if (!cancelled) setError(errorMessage(reason)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [load]);

  async function connect() {
    if (!route || busy) return;
    setBusy("connect");
    try {
      const start = await apiPost<{ authorize_url: string }>(`/v1/vaults/${route.vaultId}/credentials/${route.credentialId}/oauth/start`, {
        return_to: currentCredentialDetailReturnPath(route.vaultId, route.credentialId)
      });
      window.location.href = start.authorize_url;
    } catch (reason) {
      toast(errorMessage(reason), "err");
      setBusy("");
    }
  }

  async function archive(mode: "archive" | "delete") {
    if (!route || !credential || busy) return;
    const ok = await confirm({
      title: mode === "delete" ? L("删除 credential?", "Delete credential?") : L("归档 credential?", "Archive credential?"),
      body: mode === "delete"
        ? L("该 credential 会从 vault 中移除，已有会话不会再看到它。", "This credential will be removed from the vault and hidden from new sessions.")
        : L("该 credential 会从列表中隐藏，可避免后续 Agent 继续使用。", "This credential will be hidden so future agents do not use it."),
      confirmLabel: mode === "delete" ? L("删除", "Delete") : L("归档", "Archive"),
      danger: mode === "delete"
    });
    if (!ok) return;
    setBusy(mode);
    try {
      if (mode === "delete") await apiDelete<{ ok: boolean }>(`/v1/vaults/${route.vaultId}/credentials/${route.credentialId}`);
      else await apiPatch<{ ok: boolean }>(`/v1/vaults/${route.vaultId}/credentials/${route.credentialId}/archive`, {});
      await refresh();
      toast(mode === "delete" ? L("Credential 已删除", "Credential deleted") : L("Credential 已归档", "Credential archived"), "ok");
      goView("vault", route.vaultId);
    } catch (reason) {
      toast(errorMessage(reason), "err");
    } finally {
      setBusy("");
    }
  }

  const rows = metadataRows((credential?.metadata ?? {}) as Record<string, unknown>);
  return (
    <PageFrame
      title={credential?.name ?? L("Credential 详情", "Credential detail")}
      crumb={<Crumb parts={[{ label: L("凭证库", "Vaults"), icon: "i-key", onClick: () => goView("vaults") }, { label: credential?.vault.display_name ?? route?.vaultId ?? "Vault", onClick: () => route && goView("vault", route.vaultId) }, { label: credential?.name ?? route?.credentialId ?? "Credential" }]} />}
      action={credential ? (
        <>
          {credential.auth_type === "oauth" && credential.status !== "active" ? <button className="btn primary" onClick={connect} disabled={Boolean(busy)}>{busy === "connect" ? <span className="spin-dot" aria-hidden /> : <Icon name="i-play" size={14} />} {L("继续授权", "Authorize")}</button> : null}
          <button className="btn secondary" onClick={() => archive("archive")} disabled={Boolean(busy)}><Icon name="i-archive" size={14} /> {L("归档", "Archive")}</button>
          <button className="btn secondary danger-text" onClick={() => archive("delete")} disabled={Boolean(busy)}><Icon name="i-trash" size={14} /> {L("删除", "Delete")}</button>
        </>
      ) : null}
    >
      {loading && !credential ? <div className="panel-empty">{L("加载 credential...", "Loading credential...")}</div> : null}
      {error ? <div className="panel-empty danger-text"><Icon name="i-alert" size={16} /> {error}</div> : null}
      {credential ? (
        <div className="credential-detail-grid">
          <section className="card credential-detail-main">
            <div className="detail-kv"><span>ID</span><b>{credential.id}</b></div>
            <div className="detail-kv"><span>{L("凭证库", "Vault")}</span><button className="meta-link" onClick={() => route && goView("vault", route.vaultId)}>{credential.vault.display_name}</button></div>
            <div className="detail-kv"><span>{L("Provider", "Provider")}</span><b>{credentialProviderName(credential)}</b></div>
            <div className="detail-kv"><span>{L("Auth", "Auth")}</span><b>{credentialAuthLabel(credential.auth_type, language)}</b></div>
            <div className="detail-kv"><span>{L("状态", "Status")}</span>{statusPill(credential.status || "active", L)}</div>
            <div className="detail-kv"><span>{L("MCP 服务器", "MCP server")}</span><code>{credential.mcp_server_url || "-"}</code></div>
            <div className="detail-kv"><span>{L("最后使用", "Last used")}</span><b>{credentialLastUsed(credential, language)}</b></div>
            <div className="detail-kv"><span>{L("创建", "Created")}</span><b>{formatRelativeTime(credential.created_at, language)}</b></div>
            <div className="detail-kv"><span>{L("更新", "Updated")}</span><b>{formatRelativeTime(credential.updated_at, language)}</b></div>
          </section>
          <section className="card credential-detail-meta">
            <h3>{L("元数据", "Metadata")}</h3>
            {rows.length ? rows.map(([key, value]) => (
              <div className="detail-kv" key={key}><span>{key}</span><code>{typeof value === "object" ? JSON.stringify(value) : String(value)}</code></div>
            )) : <div className="panel-empty compact">{L("没有 metadata", "No metadata")}</div>}
          </section>
        </div>
      ) : null}
    </PageFrame>
  );
}

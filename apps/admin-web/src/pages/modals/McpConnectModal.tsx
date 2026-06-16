import { useEffect, useState } from "react";
import { apiGet, apiPost, type ApiList } from "../../api";
import type { JsonRecord } from "../../types";
import { Icon } from "../../ui";
import { currentConsoleReturnPath, useL } from "../../appConfig";
import { ModalShell } from "../../components/shared/layout";
import { errorMessage } from "../../components/shared/misc";

export type McpCatalogItem = { provider: string; name: string; icon: string; description: string; mcp_url: string; auth_type: string; oauth: boolean; configured: boolean; client_env_prefix?: string };

export function McpConnectModal(props: { workspaceId?: string; onClose: () => void; onConnected: () => Promise<void> | void }) {
  const L = useL();
  const [catalog, setCatalog] = useState<McpCatalogItem[]>([]);
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    apiGet<ApiList<McpCatalogItem>>("/v1/mcp_catalog").then((result) => setCatalog(result.data)).catch(() => {});
  }, []);
  const query = search.trim();
  const isUrl = /^https?:\/\//i.test(query);
  const filtered = catalog.filter((entry) => `${entry.name} ${entry.provider} ${entry.mcp_url}`.toLowerCase().includes(query.toLowerCase()));
  async function connect(entry: McpCatalogItem | null) {
    const url = entry?.mcp_url || query;
    if (!url) return;
    setSaving(entry?.provider || "custom");
    setError("");
    try {
      if (entry?.oauth && !entry.configured) {
        const prefix = entry.client_env_prefix || `MAPLE_MCP_${entry.provider.toUpperCase()}`;
        setError(L(`${entry.name} OAuth client 未配置：设置 ${prefix}_CLIENT_ID / ${prefix}_CLIENT_SECRET 后可跳转到授权页。`, `${entry.name} OAuth client is not configured. Set ${prefix}_CLIENT_ID / ${prefix}_CLIENT_SECRET to enable authorization redirect.`));
        return;
      }
      const server = await apiPost<JsonRecord>("/v1/mcp_servers", {
        workspace_id: props.workspaceId || undefined,
        name: entry?.name || (() => { try { return new URL(url).hostname; } catch { return url; } })(),
        provider: entry?.provider,
        mcp_url: url,
        auth_type: entry?.auth_type || "none"
      });
      // OAuth provider with a configured client → kick off the authorization flow (redirect to the third party)
      if (entry?.oauth && entry.configured) {
        const start = await apiPost<{ authorize_url: string }>(`/v1/mcp_servers/${String(server.id)}/oauth/start`, { return_to: currentConsoleReturnPath() });
        window.location.href = start.authorize_url;
        return;
      }
      props.onClose();
      await props.onConnected();
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setSaving("");
    }
  }
  return (
    <ModalShell title={L("接入 MCP", "Connect MCP")} onClose={props.onClose}>
      <p className="modal-sub">{L("从 MCP 注册表搜索，或输入自定义 URL。", "Search the MCP registry or enter a custom URL.")}</p>
      {error ? <div className="modal-note"><Icon name="i-alert" size={16} /> {error}</div> : null}
      <input className="fld mcp-search" autoFocus placeholder={L("搜索 MCP 注册表或输入自定义 URL", "Search the MCP registry or enter a custom URL")} value={search} onChange={(event) => setSearch(event.target.value)} />
      <div className="mcp-list">
        {filtered.map((entry) => {
          const notEnabled = entry.oauth && !entry.configured;
          return (
            <button key={entry.provider} type="button" className="mcp-row" disabled={Boolean(saving) || notEnabled} title={notEnabled ? L("未启用：平台未配置该 provider 的 OAuth client", "Not enabled: this provider has no OAuth client configured on the platform") : undefined} onClick={() => connect(entry)}>
              <span className="mcp-ico">{entry.name.slice(0, 1).toUpperCase()}</span>
              <span className="mcp-main"><b>{entry.name}</b><span>{entry.mcp_url}</span></span>
              {saving === entry.provider ? <span className="mcp-hint">{L("接入中…", "Connecting…")}</span> : entry.oauth ? <span className={`mcp-badge${entry.configured ? " ready" : " warn"}`}>{entry.configured ? "OAuth" : L("未启用", "Not enabled")}</span> : null}
            </button>
          );
        })}
        {!filtered.length && !isUrl ? <div className="mcp-empty">{L("无匹配，输入完整 URL 接入自定义 MCP", "No match — enter a full URL to connect a custom MCP")}</div> : null}
      </div>
      {isUrl ? (
        <div className="modal-foot">
          <button className="btn primary" disabled={Boolean(saving)} onClick={() => connect(null)}>{saving ? L("接入中…", "Connecting…") : L("接入自定义 MCP", "Connect custom MCP")}</button>
        </div>
      ) : null}
    </ModalShell>
  );
}

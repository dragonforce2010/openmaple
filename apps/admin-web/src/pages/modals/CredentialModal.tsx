import { useEffect, useState } from "react";
import { apiGet, apiPost, type ApiList } from "../../api";
import type { VaultCredential } from "../../types";
import { Icon } from "../../ui";
import { currentConsoleReturnPath, useL } from "../../appConfig";
import { ModalShell } from "../../components/shared/layout";
import { errorMessage } from "../../components/shared/misc";
import type { McpCatalogItem } from "./McpConnectModal";

export type McpServerPick = { name: string; url: string; provider?: string; oauth?: boolean; configured?: boolean; client_env_prefix?: string };

function requestedMcpServerParam(initialMcpServer = "") {
  if (initialMcpServer.trim()) return initialMcpServer.trim();
  if (typeof window === "undefined") return "";
  const params = new URLSearchParams(window.location.search);
  return params.get("mcp_server") || params.get("mcp_provider") || params.get("mcp_url") || "";
}

export function CredentialModal({
  vaultId,
  vaultName,
  onClose,
  initialMcpServer,
  oauthReturnTo,
  onOAuthRedirect
}: {
  vaultId: string;
  vaultName?: string;
  onClose: () => void;
  initialMcpServer?: string;
  oauthReturnTo?: (credential: VaultCredential) => string;
  onOAuthRedirect?: (credential: VaultCredential) => void;
}) {
  const L = useL();
  const [catalog, setCatalog] = useState<McpCatalogItem[]>([]);
  const [name, setName] = useState("");
  const [server, setServer] = useState<McpServerPick | null>(null);
  const [serverOpen, setServerOpen] = useState(false);
  const [serverQuery, setServerQuery] = useState("");
  const [clientOpen, setClientOpen] = useState(false);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [ack, setAck] = useState(false);
  const [savingLabel, setSavingLabel] = useState<"" | "checking" | "connecting">("");
  const [error, setError] = useState("");
  useEffect(() => {
    apiGet<ApiList<McpCatalogItem>>("/v1/mcp_catalog").then((result) => setCatalog(result.data)).catch(() => {});
  }, []);
  useEffect(() => {
    if (server || !catalog.length) return;
    const requested = requestedMcpServerParam(initialMcpServer).trim();
    if (!requested) return;
    const normalized = requested.toLowerCase();
    const decoded = (() => {
      try {
        return decodeURIComponent(requested).trim().toLowerCase();
      } catch {
        return normalized;
      }
    })();
    const match = catalog.find((entry) => {
      const values = [entry.provider, entry.name, entry.mcp_url].map((value) => String(value || "").trim().toLowerCase());
      return values.includes(normalized) || values.includes(decoded);
    });
    if (match) pick({ name: match.name, url: match.mcp_url, provider: match.provider, oauth: match.oauth, configured: match.configured, client_env_prefix: match.client_env_prefix });
  }, [catalog, server, initialMcpServer]);
  const query = serverQuery.trim();
  const filtered = catalog.filter((entry) => `${entry.name} ${entry.provider} ${entry.mcp_url}`.toLowerCase().includes(query.toLowerCase()));
  function pick(next: McpServerPick) {
    setServer(next);
    setServerOpen(false);
    setServerQuery("");
  }
  async function connect() {
    if (!server || !ack) return;
    const customClientId = clientId.trim();
    const customClientSecret = clientSecret.trim();
    const hasCustomClient = Boolean(customClientId && customClientSecret);
    const shouldCheckOAuth = Boolean(server.oauth);
    setSavingLabel(shouldCheckOAuth ? "checking" : "connecting");
    setError("");
    try {
      if (!server.oauth) {
        setError(L("当前只支持 OAuth MCP 服务器。", "Only OAuth MCP servers are supported."));
        setSavingLabel("");
        return;
      }
      if (!server.configured && !hasCustomClient) {
        const prefix = server.client_env_prefix || `MAPLE_MCP_${String(server.provider || server.name).toUpperCase()}`;
        setError(L(`${server.name} OAuth client 未配置：请填写 OAuth client 凭据，或设置平台默认 ${prefix}_CLIENT_ID / ${prefix}_CLIENT_SECRET。`, `${server.name} OAuth client is not configured. Fill OAuth client credentials, or configure platform defaults ${prefix}_CLIENT_ID / ${prefix}_CLIENT_SECRET.`));
        setSavingLabel("");
        return;
      }
      const credential = await apiPost<VaultCredential>(`/v1/vaults/${vaultId}/credentials`, {
        name: name.trim() || `${server.name} credential`,
        mcp_server_url: server.url,
        provider: server.provider,
        auth_type: "oauth",
        oauth_client: hasCustomClient ? { client_id: customClientId, client_secret: customClientSecret } : undefined,
        metadata: { mcp_server_name: server.name, oauth_client_source: hasCustomClient ? "custom" : "platform" }
      });
      onOAuthRedirect?.(credential);
      const start = await apiPost<{ authorize_url: string }>(`/v1/vaults/${vaultId}/credentials/${credential.id}/oauth/start`, { return_to: oauthReturnTo?.(credential) ?? currentConsoleReturnPath() });
      window.location.href = start.authorize_url;
    } catch (reason) {
      setError(errorMessage(reason));
      setSavingLabel("");
    }
  }
  return (
    <ModalShell title={L("新增凭据", "Add a credential")} onClose={onClose}>
      <p className="modal-sub">
        {vaultName
          ? <><b>{vaultName}</b>{L(" 已就绪。添加第一条凭据后 Agent 即可使用。", " is ready. Add its first credential so agents can use it.")}</>
          : L("添加凭据后 Agent 即可使用。", "Add a credential so agents can use it.")}
      </p>
      {error ? <div className="modal-note"><Icon name="i-alert" size={16} /> {error}</div> : null}
      <label className="form">{L("名称", "Name")}<input className="fld" value={name} onChange={(event) => setName(event.target.value)} placeholder={L("示例凭据", "Example credential")} /></label>
      <div className="form"><span className="flabel-in">{L("类型", "Type")}</span><div className="readonly-field">MCP OAuth</div></div>
      <div className="form"><span className="flabel-in">{L("MCP 服务器", "MCP server")}</span>
        {server ? (
          <div className="mcp-trigger selected">
            <span className="mcp-ico-sm">{server.name.slice(0, 1).toUpperCase()}</span>
            <span className="mcp-sel-name">{server.name}</span>
            <span className="mcp-sel-url">{server.url}</span>
            <button type="button" className="x-mini" onClick={() => setServer(null)} aria-label={L("清除", "Clear")}><Icon name="i-x" size={14} /></button>
          </div>
        ) : (
          <button type="button" className="mcp-trigger placeholder" onClick={() => setServerOpen((open) => !open)}>
            <span>https://mcp.example.com</span>
            <Icon name="i-chevron-down" size={15} />
          </button>
        )}
        {serverOpen && !server ? (
          <div className="mcp-inline">
            <input className="fld mcp-search" autoFocus placeholder={L("搜索 MCP registry 或输入自定义 URL", "Search the MCP registry or enter a custom URL")} value={serverQuery} onChange={(event) => setServerQuery(event.target.value)} />
            <div className="mcp-list flat">
              {filtered.map((entry) => {
                const needsClient = entry.oauth && !entry.configured;
                return (
                  <button key={entry.provider} type="button" className="mcp-row" title={needsClient ? L("平台未配置 OAuth client；可在下方填写自己的 client。", "No platform OAuth client is configured; fill your own client below.") : undefined} onClick={() => pick({ name: entry.name, url: entry.mcp_url, provider: entry.provider, oauth: entry.oauth, configured: entry.configured, client_env_prefix: entry.client_env_prefix })}>
                    <span className="mcp-ico">{entry.name.slice(0, 1).toUpperCase()}</span>
                    <span className="mcp-main"><b>{entry.name}</b><span>{entry.mcp_url}</span></span>
                    {entry.oauth ? <span className={`mcp-badge${entry.configured ? " ready" : " warn"}`}>{entry.configured ? "OAuth" : L("需 client", "Needs client")}</span> : null}
                  </button>
                );
              })}
              {!filtered.length ? <div className="mcp-empty">{L("无匹配的 OAuth MCP 服务器。", "No matching OAuth MCP server.")}</div> : null}
            </div>
          </div>
        ) : null}
      </div>
      <div className="cred-fold">
        <button type="button" className="cred-fold-head" onClick={() => setClientOpen((open) => !open)}>
          <Icon name="i-chevron-down" size={14} /> <b>{L("OAuth client 凭据", "OAuth client credentials")}</b> <span className="opt-tag">{L("可选", "Optional")}</span>
        </button>
        {clientOpen ? (
          <div className="cred-fold-body">
            <input className="fld" value={clientId} onChange={(event) => setClientId(event.target.value)} placeholder={L("Client ID（不填则使用平台默认 client）", "Client ID (leave blank to use platform default)")} />
            <input className="fld" type="password" value={clientSecret} onChange={(event) => setClientSecret(event.target.value)} placeholder={L("Client secret（不填则使用平台默认 client）", "Client secret (leave blank to use platform default)")} />
            <em className="fhint">{L("平台未配置该 MCP provider 时，必须填写一组 OAuth client 凭据。", "If this MCP provider has no platform client, fill an OAuth client pair.")}</em>
          </div>
        ) : null}
      </div>
      <div className="modal-note warn"><Icon name="i-alert" size={16} /> {L("该凭据会在当前工作区共享。拥有 API key 访问权限的成员可在 Agent Session 中使用该凭据访问关联服务，包括读取数据并代表凭据所有者执行操作。", "This credential will be shared across this workspace. Anyone with API key access can use this credential in an agent session to access the service associated with the credential, including reading data and taking actions on behalf of the credential owner.")}</div>
      <label className="cred-ack"><input type="checkbox" checked={ack} onChange={(event) => setAck(event.target.checked)} /> <span>{L("我确认该凭据会被共享，并会对其存储和使用负责。", "I acknowledge this credential is shared and that I am responsible for its storage and use.")}</span></label>
      <div className="modal-foot">
        <button className="btn secondary" onClick={onClose}>{L("暂时跳过", "Skip for now")}</button>
        <button className="btn primary" disabled={Boolean(savingLabel) || !vaultId || !server || !ack} onClick={connect}>{savingLabel === "checking" ? L("正在检查认证方式…", "Checking auth method...") : savingLabel ? L("连接中…", "Connecting...") : L("连接", "Connect")}</button>
      </div>
    </ModalShell>
  );
}

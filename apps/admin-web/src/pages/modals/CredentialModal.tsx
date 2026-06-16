import { useEffect, useState } from "react";
import { apiGet, apiPost, type ApiList } from "../../api";
import type { VaultCredential } from "../../types";
import { Icon } from "../../ui";
import { currentConsoleReturnPath, useL } from "../../appConfig";
import { Select } from "../../components/shared/forms";
import { ModalShell } from "../../components/shared/layout";
import { errorMessage } from "../../components/shared/misc";
import type { McpCatalogItem } from "./McpConnectModal";

export type McpServerPick = { name: string; url: string; provider?: string; oauth?: boolean; configured?: boolean; client_env_prefix?: string };

export function CredentialModal({
  vaultId,
  vaultName,
  onClose,
  onCreated,
  oauthReturnTo,
  onOAuthRedirect
}: {
  vaultId: string;
  vaultName?: string;
  onClose: () => void;
  onCreated: (credential: VaultCredential) => void | Promise<void>;
  oauthReturnTo?: (credential: VaultCredential) => string;
  onOAuthRedirect?: (credential: VaultCredential) => void;
}) {
  const L = useL();
  const [catalog, setCatalog] = useState<McpCatalogItem[]>([]);
  const [name, setName] = useState("");
  const [authType, setAuthType] = useState("oauth");
  const [server, setServer] = useState<McpServerPick | null>(null);
  const [serverOpen, setServerOpen] = useState(false);
  const [serverQuery, setServerQuery] = useState("");
  const [tokenOpen, setTokenOpen] = useState(false);
  const [accessToken, setAccessToken] = useState("");
  const [clientOpen, setClientOpen] = useState(false);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [ack, setAck] = useState(false);
  const [savingLabel, setSavingLabel] = useState<"" | "checking" | "connecting">("");
  const [created, setCreated] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    apiGet<ApiList<McpCatalogItem>>("/v1/mcp_catalog").then((result) => setCatalog(result.data)).catch(() => {});
  }, []);
  const query = serverQuery.trim();
  const isUrl = /^https?:\/\//i.test(query);
  const filtered = catalog.filter((entry) => `${entry.name} ${entry.provider} ${entry.mcp_url}`.toLowerCase().includes(query.toLowerCase()));
  const isOauth = authType === "oauth";
  function pick(next: McpServerPick) {
    setServer(next);
    setServerOpen(false);
    setServerQuery("");
  }
  async function connect() {
    if (!server || !ack) return;
    const shouldCheckOAuth = isOauth && !accessToken.trim() && Boolean(server.oauth);
    setSavingLabel(shouldCheckOAuth ? "checking" : "connecting");
    setError("");
    try {
      if (isOauth && !accessToken.trim() && server.oauth && !server.configured) {
        const prefix = server.client_env_prefix || `MAPLE_MCP_${String(server.provider || server.name).toUpperCase()}`;
        setError(L(`${server.name} OAuth client 未配置：设置 ${prefix}_CLIENT_ID / ${prefix}_CLIENT_SECRET 后可跳转授权。`, `${server.name} OAuth client is not configured. Set ${prefix}_CLIENT_ID / ${prefix}_CLIENT_SECRET to enable authorization redirect.`));
        setSavingLabel("");
        return;
      }
      const credential = await apiPost<VaultCredential>(`/v1/vaults/${vaultId}/credentials`, {
        name: name.trim() || `${server.name} credential`,
        mcp_server_url: server.url,
        provider: server.provider,
        auth_type: authType,
        secret: accessToken.trim(),
        metadata: { mcp_server_name: server.name, ...(clientId.trim() ? { oauth_client_id: clientId.trim() } : {}) }
      });
      // OAuth provider with a configured client and no manual token → redirect to the third-party consent page;
      // the callback exchanges the code for the user access token and stores it on the credential.
      if (isOauth && !accessToken.trim() && server.oauth && server.configured) {
        onOAuthRedirect?.(credential);
        const start = await apiPost<{ authorize_url: string }>(`/v1/vaults/${vaultId}/credentials/${credential.id}/oauth/start`, { return_to: oauthReturnTo?.(credential) ?? currentConsoleReturnPath() });
        window.location.href = start.authorize_url;
        return;
      }
      await onCreated(credential);
      setCreated(true);
      setSavingLabel("");
    } catch (reason) {
      setError(errorMessage(reason));
      setSavingLabel("");
    }
  }
  if (created) {
    return (
      <ModalShell title={L("凭据已创建", "Credential created")} onClose={onClose}>
        <div className="credential-created">
          <span><Icon name="i-check" size={22} /></span>
          <b>{L("凭据已创建", "Credential created")}</b>
          <p>{L("现在可以关闭窗口，或者继续给 Vault 添加凭据。", "You can now close this window or add another credential to this vault.")}</p>
        </div>
        <div className="modal-foot">
          <button className="btn primary" onClick={onClose}>{L("完成", "Done")}</button>
        </div>
      </ModalShell>
    );
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
      <div className="form"><span className="flabel-in">{L("类型", "Type")}</span>
        <Select value={authType} options={[{ value: "oauth", label: "MCP OAuth" }, { value: "bearer_token", label: "Bearer token" }, { value: "api_key", label: "API key" }]} onChange={setAuthType} />
      </div>
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
                const notEnabled = entry.oauth && !entry.configured;
                return (
                  <button key={entry.provider} type="button" className="mcp-row" disabled={notEnabled} title={notEnabled ? L("未启用：平台未配置该 provider 的 OAuth client", "Not enabled: this provider has no OAuth client configured on the platform") : undefined} onClick={() => pick({ name: entry.name, url: entry.mcp_url, provider: entry.provider, oauth: entry.oauth, configured: entry.configured, client_env_prefix: entry.client_env_prefix })}>
                    <span className="mcp-ico">{entry.name.slice(0, 1).toUpperCase()}</span>
                    <span className="mcp-main"><b>{entry.name}</b><span>{entry.mcp_url}</span></span>
                    {entry.oauth ? <span className={`mcp-badge${entry.configured ? " ready" : " warn"}`}>{entry.configured ? "OAuth" : L("未启用", "Not enabled")}</span> : null}
                  </button>
                );
              })}
              {isUrl ? (
                <button type="button" className="mcp-row" onClick={() => pick({ name: query, url: query })}>
                  <span className="mcp-ico"><Icon name="i-server" size={16} /></span>
                  <span className="mcp-main"><b>{L("自定义 URL", "Custom URL")}</b><span>{query}</span></span>
                </button>
              ) : null}
              {!filtered.length && !isUrl ? <div className="mcp-empty">{L("无匹配项。输入完整 URL 可连接自定义 MCP。", "No match. Enter a full URL to connect a custom MCP.")}</div> : null}
            </div>
          </div>
        ) : null}
      </div>
      {isOauth ? (
        <>
          <div className="cred-fold">
            <button type="button" className="cred-fold-head" onClick={() => setTokenOpen((open) => !open)}>
              <Icon name="i-chevron-down" size={14} /> <b>{L("访问令牌", "Access token")}</b> <span className="opt-tag">{L("可选", "Optional")}</span>
            </button>
            {tokenOpen ? <input className="fld" value={accessToken} onChange={(event) => setAccessToken(event.target.value)} placeholder={L("粘贴访问令牌以跳过 OAuth 流程", "Paste an access token to skip the OAuth flow")} /> : null}
          </div>
          <div className="cred-fold">
            <button type="button" className="cred-fold-head" onClick={() => setClientOpen((open) => !open)}>
              <Icon name="i-chevron-down" size={14} /> <b>{L("OAuth client 凭据", "OAuth client credentials")}</b> <span className="opt-tag">{L("可选", "Optional")}</span>
            </button>
            {clientOpen ? (
              <div className="cred-fold-body">
                <input className="fld" value={clientId} onChange={(event) => setClientId(event.target.value)} placeholder={L("Client ID（默认使用平台托管 client）", "Client ID (defaults to platform-managed client)")} />
                <input className="fld" type="password" value={clientSecret} onChange={(event) => setClientSecret(event.target.value)} placeholder={L("Client secret", "Client secret")} />
              </div>
            ) : null}
          </div>
        </>
      ) : (
        <label className="form">{L("访问令牌", "Access token")}<input className="fld" type="password" value={accessToken} onChange={(event) => setAccessToken(event.target.value)} placeholder={L("Bearer token 或 API key", "Bearer token or API key")} /></label>
      )}
      <div className="modal-note warn"><Icon name="i-alert" size={16} /> {L("该凭据会在当前工作区共享。拥有 API key 访问权限的成员可在 Agent Session 中使用该凭据访问关联服务，包括读取数据并代表凭据所有者执行操作。", "This credential will be shared across this workspace. Anyone with API key access can use this credential in an agent session to access the service associated with the credential, including reading data and taking actions on behalf of the credential owner.")}</div>
      <label className="cred-ack"><input type="checkbox" checked={ack} onChange={(event) => setAck(event.target.checked)} /> <span>{L("我确认该凭据会被共享，并会对其存储和使用负责。", "I acknowledge this credential is shared and that I am responsible for its storage and use.")}</span></label>
      <div className="modal-foot">
        <button className="btn secondary" onClick={onClose}>{L("暂时跳过", "Skip for now")}</button>
        <button className="btn primary" disabled={Boolean(savingLabel) || !vaultId || !server || !ack} onClick={connect}>{savingLabel === "checking" ? L("正在检查认证方式…", "Checking auth method...") : savingLabel ? L("连接中…", "Connecting...") : L("连接", "Connect")}</button>
      </div>
    </ModalShell>
  );
}

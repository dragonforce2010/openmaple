import { Fragment, useCallback, useEffect, useState } from "react";
import { apiGet, apiPost } from "../../api";
import type { Agent, Environment, Session, Vault } from "../../types";
import { DrawerLayer, Icon } from "../../ui";
import { useL } from "../../appConfig";
import { Select } from "../../components/shared/forms";
import { isProductionEnvironment } from "../../components/shared/labels";
import { ModalShell } from "../../components/shared/layout";
import { errorMessage } from "../../components/shared/misc";
import { EnvironmentForm } from "./EnvironmentForm";

export function SessionModal(props: { agents: Agent[]; environments: Environment[]; vaults: Vault[]; workspaceId?: string; sandboxProvider?: string; lockedAgentId?: string; onClose: () => void; onCreated: (session: Session) => void }) {
  const L = useL();
  const locked = Boolean(props.lockedAgentId); // opened from an agent detail — agent is fixed, keep the form minimal
  const [envs, setEnvs] = useState<Environment[]>(props.environments);
  const productionEnvironments = envs.filter(isProductionEnvironment);
  const [title, setTitle] = useState("");
  const [agentId, setAgentId] = useState(props.lockedAgentId ?? props.agents[0]?.id ?? "");
  const [environmentId, setEnvironmentId] = useState(productionEnvironments[0]?.id ?? "");
  const [vaultId, setVaultId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [creatingEnv, setCreatingEnv] = useState(false);
  const agent = props.agents.find((item) => item.id === agentId);
  const mcpServers = agent?.config.mcp_servers ?? [];

  const refreshEnvs = useCallback(async () => {
    try {
      const query = props.workspaceId ? `?workspace_id=${encodeURIComponent(props.workspaceId)}` : "";
      const list = await apiGet<{ data: Environment[] }>(`/v1/environments${query}`);
      setEnvs(list.data ?? []);
    } catch {
      // keep the last good list on a transient refresh failure
    }
  }, [props.workspaceId]);

  // pull the latest environments when the modal opens so a just-created env shows up
  useEffect(() => { void refreshEnvs(); }, [refreshEnvs]);
  useEffect(() => {
    if (environmentId && productionEnvironments.some((item) => item.id === environmentId)) return;
    setEnvironmentId(productionEnvironments[0]?.id ?? "");
  }, [environmentId, productionEnvironments]);

  async function save() {
    setSaving(true);
    setError("");
    try {
      const session = await apiPost<Session>("/v1/sessions", {
        workspace_id: props.workspaceId || agent?.workspace_id || productionEnvironments.find((item) => item.id === environmentId)?.workspace_id || undefined,
        agent: agentId,
        environment_id: environmentId,
        title: title || undefined,
        vault_ids: vaultId ? [vaultId] : [],
        resources: []
      });
      props.onClose();
      await props.onCreated(session);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setSaving(false);
    }
  }

  async function onEnvironmentCreated(created: Environment) {
    await refreshEnvs();
    setEnvs((current) => (current.some((item) => item.id === created.id) ? current : [...current, created]));
    setEnvironmentId(created.id);
  }

  return (
    <ModalShell title={L("新建 Session", "Create session")} onClose={props.onClose}>
      <p className="modal-sub">{locked ? L("为该 Agent 启动一个运行实例。", "Spin up a run of this agent.") : L("配置并启动一个 Agent 运行实例。", "Set up an instance of your agent in its environment.")}</p>
      {error ? <div className="modal-note"><Icon name="i-alert" size={16} /> {error}</div> : null}
      <label className="form">{L("标题", "Title")}<input className="fld" placeholder={L("可选 – 命名本次运行", "Optional – name this run")} value={title} onChange={(event) => setTitle(event.target.value)} /></label>
      {locked ? (
        <div className="form"><span className="flabel-in">{L("Agent", "Agent")}</span><div className="sel-static">{agent?.name ?? props.lockedAgentId}</div></div>
      ) : (
        <div className="form"><span className="flabel-in">{L("Agent", "Agent")}</span>
          <Select value={agentId} options={props.agents.map((item) => ({ value: item.id, label: item.name }))} onChange={setAgentId} placeholder={L("选择 Agent", "Select agent")} searchable forceSearch />
        </div>
      )}
      <div className="form">
        <span className="flabel-in flabel-row">{L("环境", "Environment")}
          <button type="button" className="flabel-action" onClick={() => setCreatingEnv(true)}><Icon name="i-plus" size={13} /> {L("新建环境", "New environment")}</button>
        </span>
        <Select value={environmentId} options={productionEnvironments.map((item) => ({ value: item.id, label: `${item.name} · ${item.id}` }))} onChange={setEnvironmentId} placeholder={L("选择环境", "Select environment")} searchable forceSearch onOpen={refreshEnvs} />
        {!productionEnvironments.length ? <em className="fhint">{L("当前没有可用云端沙箱环境。点击「新建环境」创建一个。", "No cloud sandbox environment is available. Click “New environment” to create one.")}</em> : null}
      </div>
      {!locked ? (
        <Fragment>
          <div className="form"><span className="flabel-in">{L("凭证库", "Credential vault")}</span>
            <Select value={vaultId} options={[{ value: "", label: L("无凭证库", "No vault") }, ...props.vaults.map((item) => ({ value: item.id, label: item.display_name }))]} onChange={setVaultId} placeholder={L("无凭证库", "No vault")} />
          </div>
          {mcpServers.length > 0 ? (
            <div className="form">
              <span className="flabel-in">{L("MCP 服务器", "MCP Servers")}</span>
              <div className="mp-list">
                {mcpServers.map((server, index) => (
                  <div className="mp-row" key={String(server.name ?? index)}>
                    <Icon name="i-lock" size={16} />
                    <div className="mp-main"><b>{String(server.name ?? "mcp")}</b><span>{String(server.url ?? "")}</span></div>
                    <em className="mp-hint">{vaultId ? L("已选凭证库", "Vault selected") : L("需要凭证库", "Needs vault")}</em>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </Fragment>
      ) : null}
      <div className="modal-foot">
        <button className="btn secondary" onClick={props.onClose}>{L("取消", "Cancel")}</button>
        <button className="btn primary" disabled={saving || !agentId || !environmentId} onClick={save}>
          {saving ? <span className="btn-spin" aria-hidden /> : null}
          {saving ? L("创建中…", "Creating...") : L("新建 Session", "Create session")}
        </button>
      </div>
      {creatingEnv ? (
        <DrawerLayer onClose={() => setCreatingEnv(false)} className="modal-nested-drawer-layer">
          <aside className="ask-drawer pool-detail-drawer" role="dialog" aria-modal="true" aria-label={L("新建环境", "New environment")}>
            <div className="drawer-head">
              <div><b>{L("新建环境", "New environment")}</b><span>{L("创建后将自动选中", "Auto-selected once created")}</span></div>
              <button className="x" onClick={() => setCreatingEnv(false)} aria-label={L("关闭", "Close")}><Icon name="i-x" size={18} /></button>
            </div>
            <div className="pool-drawer-body">
              <EnvironmentForm workspaceId={props.workspaceId} sandboxProvider={props.sandboxProvider} onClose={() => setCreatingEnv(false)} onCreated={onEnvironmentCreated} />
            </div>
          </aside>
        </DrawerLayer>
      ) : null}
    </ModalShell>
  );
}

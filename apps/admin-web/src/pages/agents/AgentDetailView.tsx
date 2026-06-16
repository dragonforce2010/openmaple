import { useEffect, useState } from "react";
import { apiGet, apiPatch } from "../../api";
import type { AgentConfig, AgentRuntimeInfo } from "../../types";
import { Icon, useDrawerStack, useToast } from "../../ui";
import { TEMPLATE_SYSTEMS, templateCards, useEntityNav, useI18n } from "../../appConfig";
import { HighlightedCode, agentModelConfigId, agentModelFromModelConfig } from "../../components/shared/code";
import { ModelPicker } from "../../components/shared/forms";
import { agentStatusForIndex, isProductionEnvironment, statusPill } from "../../components/shared/labels";
import { Crumb, DataTable, PageFrame } from "../../components/shared/layout";
import { errorMessage, formatRelativeTime } from "../../components/shared/misc";
import { editableConfigText, parseEditableAgentConfig } from "../modals/modalConfig";
import { AgentOverviewPanel } from "./AgentOverviewPanel";
import { AgentIntegrationPanel, AgentRuntimePanel } from "./AgentPanels";

export function AgentDetailView(props: { agentId: string; edit?: boolean; embedded?: boolean }) {
  const { language } = useI18n();
  const L = (zh: string, en: string) => (language === "zh" ? zh : en);
  const toast = useToast();
  const { data, openEntity, openSessionForAgent, refresh, goView } = useEntityNav();
  const drawerStack = useDrawerStack();
  const { sessions, environments, modelConfigs, workspace, workspaces } = data;
  const agent = data.agents.find((item) => item.id === props.agentId) ?? data.agents[0] ?? null;
  const index = agent ? data.agents.findIndex((item) => item.id === agent.id) : 0;
  const status = agentStatusForIndex(index);
  const [tab, setTab] = useState<"agent" | "sessions" | "runtime" | "integration" | "config">("agent");
  const [sampleLanguage, setSampleLanguage] = useState<"python" | "typescript" | "curl">("curl");
  const [runtimeInfo, setRuntimeInfo] = useState<AgentRuntimeInfo | null>(null);
  const [runtimeError, setRuntimeError] = useState("");
  const [modelConfigId, setModelConfigId] = useState("");
  const [draftName, setDraftName] = useState("");
  const [draftDescription, setDraftDescription] = useState("");
  const [draftSystem, setDraftSystem] = useState("");
  const [configFmt, setConfigFmt] = useState<"yaml" | "json">("yaml");
  const [configText, setConfigText] = useState("");
  const [configError, setConfigError] = useState("");
  const [savingAgent, setSavingAgent] = useState(false);
  const [modelError, setModelError] = useState("");
  const selectedModelConfigId = agent ? agentModelConfigId(agent, modelConfigs) : "";
  const agentSessions = sessions.filter((session) => session.agent_id === agent?.id);
  const integrationEnvironment =
    environments.find((environment) => environment.workspace_id === agent?.workspace_id && isProductionEnvironment(environment)) ??
    environments.find((environment) => isProductionEnvironment(environment)) ??
    environments.find((environment) => environment.workspace_id === agent?.workspace_id) ??
    environments[0] ??
    null;

  useEffect(() => {
    setModelConfigId(selectedModelConfigId);
    setModelError("");
  }, [selectedModelConfigId]);

  useEffect(() => {
    setDraftName(agent?.name ?? "");
    setDraftDescription(agent?.description ?? "");
    setDraftSystem(agent?.config.system ?? "");
    setConfigFmt("yaml");
    setConfigText(agent ? editableConfigText(agent.config, "yaml") : "");
    setConfigError("");
  }, [agent?.id, agent?.name, agent?.description, agent?.config.system]);

  useEffect(() => {
    let cancelled = false;
    setRuntimeError("");
    setRuntimeInfo(null);
    if (!agent) return;
    apiGet<AgentRuntimeInfo>(`/v1/agents/${agent.id}/runtime`)
      .then((info) => { if (!cancelled) setRuntimeInfo(info); })
      .catch((reason) => { if (!cancelled) setRuntimeError(errorMessage(reason)); });
    return () => { cancelled = true; };
  }, [agent?.id]);

  function openEdit() {
    if (!agent) return;
    drawerStack.closeAll();
    goView("agent", agent.id, true);
  }

  async function saveAgentBasicInfo() {
    if (!agent) return;
    let patch: Partial<AgentConfig>;
    try {
      patch = {
        ...parseEditableAgentConfig(configText, configFmt, agent.config),
        name: draftName.trim(),
        description: draftDescription,
        system: draftSystem
      };
    } catch (reason) {
      setConfigError(errorMessage(reason));
      return;
    }
    if (!patch.name) {
      setModelError(L("请输入 Agent 名称。", "Enter an agent name."));
      return;
    }
    patch = {
      ...patch,
      description: draftDescription,
      system: draftSystem
    };
    if (modelConfigId !== selectedModelConfigId) {
      const modelConfig = modelConfigs.find((config) => config.id === modelConfigId);
      if (!modelConfig) {
        setModelError(L("请选择模型接入点。", "Select a model endpoint."));
        return;
      }
      patch.model = agentModelFromModelConfig(modelConfig);
    }
    setSavingAgent(true);
    setModelError("");
    try {
      await apiPatch(`/v1/agents/${agent.id}`, patch);
      await refresh();
      toast(L("Agent 已更新", "Agent updated"), "ok");
      goView("agent", agent.id, false);
    } catch (reason) {
      setModelError(errorMessage(reason));
    } finally {
      setSavingAgent(false);
    }
  }

  function switchConfigFmt(nextFmt: "yaml" | "json") {
    if (!agent) return;
    try {
      const parsed = parseEditableAgentConfig(configText, configFmt, agent.config);
      setConfigText(editableConfigText(parsed, nextFmt));
      setConfigError("");
    } catch {
      setConfigText(editableConfigText({ ...agent.config, name: draftName, description: draftDescription, system: draftSystem }, nextFmt));
    }
    setConfigFmt(nextFmt);
  }

  function editConfigText(value: string) {
    if (!agent) return;
    setConfigText(value);
    try {
      const parsed = parseEditableAgentConfig(value, configFmt, agent.config);
      setDraftName(parsed.name);
      setDraftDescription(parsed.description);
      setDraftSystem(parsed.system);
      setModelConfigId(parsed.model.config_id ?? modelConfigId);
      setConfigError("");
    } catch (reason) {
      setConfigError(errorMessage(reason));
    }
  }

  function applyTemplate(index: number) {
    if (!agent) return;
    const [name, description] = templateCards[index];
    const modelConfig = modelConfigs.find((config) => config.id === modelConfigId) ?? modelConfigs.find((config) => config.id === selectedModelConfigId);
    const nextConfig = {
      ...agent.config,
      name,
      description,
      system: TEMPLATE_SYSTEMS[index] ?? description,
      model: modelConfig ? agentModelFromModelConfig(modelConfig) : agent.config.model,
      mcp_servers: [],
      tools: [{ type: "agent_toolset_20260401" }],
      skills: []
    } as AgentConfig;
    setDraftName(name);
    setDraftDescription(description);
    setDraftSystem(nextConfig.system);
    setConfigText(editableConfigText(nextConfig, configFmt));
    setConfigError("");
  }

  if (!agent) {
    const notFound = <div className="empty-state"><b>{L("未找到 Agent", "Agent not found")}</b></div>;
    return props.embedded ? notFound : <PageFrame title={L("Agent", "Agent")}>{notFound}</PageFrame>;
  }

  const actions = (
    <>
      <button className="btn secondary" onClick={openEdit}><Icon name="i-edit" size={15} /> {L("编辑", "Edit")}</button>
      <button className="btn primary" onClick={() => openSessionForAgent(agent.id)}><Icon name="i-play" size={15} /> {L("新建 Session", "New session")}</button>
    </>
  );

  if (props.edit) {
    return (
      <PageFrame
        title={`${L("编辑", "Edit")} ${agent.name}`}
        sub={<span className="mono">{agent.id}</span>}
        crumb={<Crumb parts={[{ label: L("智能体", "Agents"), icon: "i-brain", onClick: () => goView("agents") }, { label: agent.name, onClick: () => goView("agent", agent.id) }, { label: L("基本信息", "Basic info") }]} />}
      >
        <div className="edit-form agent-edit-form">
          {modelError ? <div className="modal-note"><Icon name="i-alert" size={16} /> {modelError}</div> : null}
          <label className="form">{L("名称", "Name")}
            <input className="fld" value={draftName} onChange={(event) => setDraftName(event.target.value)} placeholder={L("Agent 名称", "Agent name")} />
          </label>
          <div className="field-block">
            <div className="flabel">{L("模型", "Model")}</div>
            <ModelPicker label={L("模型接入点", "Model endpoint")} value={modelConfigId} modelConfigs={modelConfigs} onChange={setModelConfigId} />
          </div>
          <label className="form">{L("描述", "Description")}
            <textarea className="fld" value={draftDescription} onChange={(event) => setDraftDescription(event.target.value)} placeholder={L("描述这个 Agent 的用途…", "Describe what this agent is for...")} />
          </label>
          <label className="form">{L("系统提示词", "System prompt")}
            <textarea className="fld agent-system-editor" value={draftSystem} onChange={(event) => setDraftSystem(event.target.value)} placeholder={L("输入系统提示词…", "Enter the system prompt...")} />
          </label>
          <div className="field-block">
            <div className="flabel">{L("配置模板", "Config template")}</div>
            <div className="ac-tpls agent-edit-template-grid">
              {templateCards.map(([name, desc], index) => (
                <button key={name} type="button" className="ac-tpl" onClick={() => applyTemplate(index)}>
                  <b>{name}</b><span>{desc}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="ac-config">
            <div className="ac-config-head">
              <span className="flabel-in">{L("完整配置", "Full config")}</span>
              <div className="ac-fmt">
                <button type="button" className={configFmt === "yaml" ? "on" : ""} onClick={() => switchConfigFmt("yaml")}>YAML</button>
                <button type="button" className={configFmt === "json" ? "on" : ""} onClick={() => switchConfigFmt("json")}>JSON</button>
              </div>
            </div>
            {configError ? <div className="modal-note warn"><Icon name="i-alert" size={16} /> {configError}</div> : null}
            <textarea className="fld ac-config-editor" value={configText} onChange={(event) => editConfigText(event.target.value)} spellCheck={false} />
          </div>
          <div className="edit-actions">
            <button className="btn primary" onClick={saveAgentBasicInfo} disabled={savingAgent || Boolean(configError)}>
              {savingAgent ? <span className="btn-spin" aria-hidden /> : <Icon name="i-save" size={14} />} {savingAgent ? L("保存中…", "Saving…") : L("保存更改", "Save changes")}
            </button>
            <button className="btn secondary" onClick={() => goView("agent", agent.id, false)} disabled={savingAgent}>{L("取消", "Cancel")}</button>
          </div>
        </div>
      </PageFrame>
    );
  }

  const content = (
    <>
      {props.embedded ? <div className="detail-actions action-row">{actions}</div> : null}
      <div className="tabs agent-tabs">
        <button className={tab === "agent" ? "on" : ""} onClick={() => setTab("agent")}>Agent</button>
        <button className={tab === "sessions" ? "on" : ""} onClick={() => setTab("sessions")}>{L("会话", "Sessions")}<span className="cnt">{agentSessions.length}</span></button>
        <button className={tab === "runtime" ? "on" : ""} onClick={() => setTab("runtime")}>{L("运行时", "Runtime")}</button>
        <button className={tab === "integration" ? "on" : ""} onClick={() => setTab("integration")}>{L("集成", "Integration")}</button>
        <button className={tab === "config" ? "on" : ""} onClick={() => setTab("config")}>{L("配置", "Config")}</button>
      </div>

      {tab === "agent" ? (
        <AgentOverviewPanel
          agent={agent}
          workspace={workspace}
          workspaces={workspaces}
        />
      ) : null}

      {tab === "sessions" ? (
        agentSessions.length ? (
          <DataTable headers={["ID", L("标题", "Title"), L("状态", "Status"), L("更新", "Updated")]} pageSize={8}>
            {agentSessions.map((session) => (
              <tr key={session.id} className="clickable-row" onClick={() => openEntity("session", session.id)}>
                <td><span className="id-link">{session.id}</span></td>
                <td className="t-name">{session.title}</td>
                <td>{statusPill(session.status, L)}</td>
                <td>{formatRelativeTime(session.updated_at, language)}</td>
              </tr>
            ))}
          </DataTable>
        ) : (
          <div className="panel-empty">{L("该 Agent 暂无会话。", "No sessions for this agent yet.")}</div>
        )
      ) : null}

      {tab === "runtime" ? <AgentRuntimePanel info={runtimeInfo} error={runtimeError} /> : null}
      {tab === "integration" ? <AgentIntegrationPanel agent={agent} environment={integrationEnvironment} language={sampleLanguage} setLanguage={setSampleLanguage} /> : null}
      {tab === "config" ? (
        <div className="field-block agent-config-tab">
          <div className="flabel">{L("完整配置", "Full config")}</div>
          <pre className="json-block"><HighlightedCode code={JSON.stringify(agent.config, null, 2)} language="json" /></pre>
        </div>
      ) : null}
    </>
  );

  return props.embedded ? content : (
    <PageFrame
      title={<>{agent.name} {statusPill(status, L)}</>}
      sub={agent.description}
      crumb={<Crumb parts={[{ label: L("智能体", "Agents"), icon: "i-brain", onClick: () => goView("agents") }, { label: agent.name }]} />}
      action={actions}
    >
      {content}
    </PageFrame>
  );
}

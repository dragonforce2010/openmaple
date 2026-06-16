import { useEffect, useMemo, useState } from "react";
import { apiGet, apiPost, type ApiList } from "../../api";
import type { View } from "../../appConfig";
import { useI18n } from "../../appConfig";
import { errorMessage, formatTime } from "../../components/shared/misc";
import { Select } from "../../components/shared/forms";
import { DataTable, PageFrame } from "../../components/shared/layout";
import { statusPill } from "../../components/shared/labels";
import type { Agent, AgentDeployment, DeploymentRun, Environment } from "../../types";
import { Icon, useToast } from "../../ui";

export function DeploymentsView(props: {
  deployments: AgentDeployment[];
  agents: Agent[];
  environments: Environment[];
  selectedWorkspaceId: string;
  refresh: (workspaceId?: string) => Promise<void> | void;
  goView: (view: View, id?: string) => void;
  loading?: boolean;
}) {
  const { language } = useI18n();
  const L = (zh: string, en: string) => (language === "zh" ? zh : en);
  const toast = useToast();
  const [selectedId, setSelectedId] = useState("");
  const [runs, setRuns] = useState<DeploymentRun[]>([]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const selected = props.deployments.find((deployment) => deployment.id === selectedId) ?? props.deployments[0] ?? null;
  const agentOptions = useMemo(() => props.agents.map((agent) => ({ value: agent.id, label: `${agent.name} · ${agent.id}` })), [props.agents]);
  const environmentOptions = useMemo(() => props.environments.map((environment) => ({ value: environment.id, label: `${environment.name} · ${environment.id}` })), [props.environments]);

  useEffect(() => {
    if (!selectedId && props.deployments[0]) setSelectedId(props.deployments[0].id);
    if (selectedId && !props.deployments.some((deployment) => deployment.id === selectedId)) setSelectedId(props.deployments[0]?.id ?? "");
  }, [props.deployments, selectedId]);

  useEffect(() => {
    if (!selected) {
      setRuns([]);
      return;
    }
    void loadRuns(selected.id);
  }, [selected?.id]);

  async function loadRuns(deploymentId: string) {
    const result = await apiGet<ApiList<DeploymentRun>>(`/v1/deployments/${deploymentId}/runs`);
    setRuns(result.data);
  }

  async function runAction(action: string, fn: () => Promise<void>) {
    setBusy(action);
    setError("");
    try {
      await fn();
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy("");
    }
  }

  return (
    <PageFrame
      title={L("部署", "Deployments")}
      sub={L("把 Agent、环境、初始消息和 schedule 固化成可重复运行的 session launch template。", "Persist an agent, environment, initial message, and schedule as a reusable session launch template.")}
      action={<button className="btn secondary" onClick={() => props.refresh(props.selectedWorkspaceId)}><Icon name="i-refresh" size={15} /> {L("刷新", "Refresh")}</button>}
    >
      {error ? <div className="error-banner inline">{error}</div> : null}
      <DeploymentCreatePanel
        agents={props.agents}
        environments={props.environments}
        agentOptions={agentOptions}
        environmentOptions={environmentOptions}
        workspaceId={props.selectedWorkspaceId}
        busy={busy}
        L={L}
        onBusy={runAction}
        onCreated={async (deploymentId) => {
          setSelectedId(deploymentId);
          await props.refresh(props.selectedWorkspaceId);
        }}
      />
      {props.deployments.length || props.loading ? (
        <div className="deployments-layout">
          <div className="deployments-table">
            <DataTable headers={["ID", L("名称", "Name"), L("状态", "Status"), L("Schedule", "Schedule"), L("下次运行", "Next run"), L("更新", "Updated"), ""]} pageSize={8} loading={props.loading}>
              {props.deployments.map((deployment) => (
                <tr key={deployment.id} className={selected?.id === deployment.id ? "sel" : ""} onClick={() => setSelectedId(deployment.id)}>
                  <td><span className="id-link">{deployment.id}</span></td>
                  <td><span className="t-name">{deployment.name}</span><small>{agentName(props.agents, deployment.agent_id)}</small></td>
                  <td>{statusPill(deployment.status, L)}</td>
                  <td className="mono">{scheduleLabel(deployment, L)}</td>
                  <td>{formatTime(deployment.next_run_at || "") || "-"}</td>
                  <td>{formatTime(deployment.updated_at)}</td>
                  <td className="actions-cell">
                    <button className="btn secondary compact" onClick={(event) => { event.stopPropagation(); setSelectedId(deployment.id); void runDeployment(deployment); }} disabled={Boolean(busy)}>
                      <Icon name="i-play" size={13} /> {L("运行", "Run")}
                    </button>
                  </td>
                </tr>
              ))}
            </DataTable>
          </div>
          <DeploymentDetail
            deployment={selected}
            runs={runs}
            busy={busy}
            L={L}
            onRun={runDeployment}
            onPause={pauseDeployment}
            onUnpause={unpauseDeployment}
            onArchive={archiveDeployment}
            openSession={(sessionId) => props.goView("sessions", sessionId)}
          />
        </div>
      ) : (
        <div className="resource-empty">
          <div className="resource-empty-icon"><Icon name="i-workflow" size={26} /></div>
          <h2>{L("还没有部署", "No deployments yet")}</h2>
          <p>{L("选择一个 Agent 和环境，保存初始 user.message 后即可手动运行或配置 cron schedule。", "Choose an agent and environment, save an initial user.message, then run manually or attach a cron schedule.")}</p>
        </div>
      )}
    </PageFrame>
  );

  async function runDeployment(deployment: AgentDeployment) {
    await runAction(`run:${deployment.id}`, async () => {
      const result = await apiPost<{ session_id?: string; deployment_run_id?: string }>(`/v1/deployments/${deployment.id}/run`, {});
      toast(L("Deployment run 已创建", "Deployment run created"), "ok");
      await props.refresh(props.selectedWorkspaceId);
      await loadRuns(deployment.id);
      if (result.session_id) props.goView("sessions", result.session_id);
    });
  }

  async function pauseDeployment(deployment: AgentDeployment) {
    await runAction(`pause:${deployment.id}`, async () => {
      await apiPost(`/v1/deployments/${deployment.id}/pause`, { reason: "paused from console" });
      await props.refresh(props.selectedWorkspaceId);
    });
  }

  async function unpauseDeployment(deployment: AgentDeployment) {
    await runAction(`unpause:${deployment.id}`, async () => {
      await apiPost(`/v1/deployments/${deployment.id}/unpause`, {});
      await props.refresh(props.selectedWorkspaceId);
    });
  }

  async function archiveDeployment(deployment: AgentDeployment) {
    await runAction(`archive:${deployment.id}`, async () => {
      await apiPost(`/v1/deployments/${deployment.id}/archive`, {});
      setSelectedId("");
      await props.refresh(props.selectedWorkspaceId);
    });
  }
}

function DeploymentCreatePanel(props: {
  agents: Agent[];
  environments: Environment[];
  agentOptions: Array<{ value: string; label: string }>;
  environmentOptions: Array<{ value: string; label: string }>;
  workspaceId: string;
  busy: string;
  L: (zh: string, en: string) => string;
  onBusy: (action: string, fn: () => Promise<void>) => Promise<void>;
  onCreated: (deploymentId: string) => Promise<void>;
}) {
  const [agentId, setAgentId] = useState("");
  const [environmentId, setEnvironmentId] = useState("");
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [scheduleOn, setScheduleOn] = useState(false);
  const [cron, setCron] = useState("0 9 * * 1-5");
  const [timezone, setTimezone] = useState("UTC");
  const canCreate = props.workspaceId && props.agents.length && props.environments.length && (name.trim() || selectedAgentName(props.agents, agentId)) && message.trim();

  useEffect(() => {
    if (!agentId && props.agents[0]) setAgentId(props.agents[0].id);
    if (!environmentId && props.environments[0]) setEnvironmentId(props.environments[0].id);
  }, [props.agents, props.environments, agentId, environmentId]);

  async function create() {
    await props.onBusy("create", async () => {
      const deployment = await apiPost<AgentDeployment>("/v1/deployments", {
        workspace_id: props.workspaceId,
        agent_id: agentId,
        environment_id: environmentId,
        name: name.trim() || `${selectedAgentName(props.agents, agentId)} deployment`,
        version: "1",
        initial_events: [{ type: "user.message", payload: { content: [{ type: "text", text: message.trim() }] } }],
        schedule: scheduleOn ? { type: "cron", expression: cron.trim(), timezone: timezone.trim() || "UTC" } : null
      });
      setName("");
      setMessage("");
      await props.onCreated(deployment.id);
    });
  }

  return (
    <div className="deployment-create card">
      <div className="deployment-create-grid">
        <label className="form">
          <span>{props.L("Agent", "Agent")}</span>
          <Select value={agentId} options={props.agentOptions} onChange={setAgentId} searchable forceSearch />
        </label>
        <label className="form">
          <span>{props.L("环境", "Environment")}</span>
          <Select value={environmentId} options={props.environmentOptions} onChange={setEnvironmentId} searchable forceSearch />
        </label>
        <label className="form">
          <span>{props.L("名称", "Name")}</span>
          <input className="fld" value={name} onChange={(event) => setName(event.target.value)} placeholder={props.L("默认使用 Agent 名称", "Defaults to agent name")} />
        </label>
        <label className="form deployment-message">
          <span>{props.L("初始 user.message", "Initial user.message")}</span>
          <textarea value={message} onChange={(event) => setMessage(event.target.value)} placeholder={props.L("每次运行会创建新 session，并写入这条消息。", "Each run creates a new session and writes this message.")} />
        </label>
        <label className="deployment-checkbox">
          <input type="checkbox" checked={scheduleOn} onChange={(event) => setScheduleOn(event.target.checked)} />
          <span>{props.L("启用 cron schedule", "Enable cron schedule")}</span>
        </label>
        <label className="form">
          <span>Cron</span>
          <input className="fld mono" value={cron} onChange={(event) => setCron(event.target.value)} disabled={!scheduleOn} />
        </label>
        <label className="form">
          <span>Timezone</span>
          <input className="fld mono" value={timezone} onChange={(event) => setTimezone(event.target.value)} disabled={!scheduleOn} />
        </label>
      </div>
      <div className="deployment-create-actions">
        <button className="btn primary" onClick={create} disabled={!canCreate || Boolean(props.busy)}>
          {props.busy === "create" ? <span className="btn-spin" /> : <Icon name="i-plus" size={15} />} {props.L("创建 Deployment", "Create deployment")}
        </button>
      </div>
    </div>
  );
}

function DeploymentDetail(props: {
  deployment: AgentDeployment | null;
  runs: DeploymentRun[];
  busy: string;
  L: (zh: string, en: string) => string;
  onRun: (deployment: AgentDeployment) => Promise<void>;
  onPause: (deployment: AgentDeployment) => Promise<void>;
  onUnpause: (deployment: AgentDeployment) => Promise<void>;
  onArchive: (deployment: AgentDeployment) => Promise<void>;
  openSession: (sessionId: string) => void;
}) {
  if (!props.deployment) return null;
  const paused = props.deployment.status === "paused";
  return (
    <aside className="deployment-detail card">
      <div className="deployment-detail-head">
        <div><b>{props.deployment.name}</b><span>{props.deployment.id}</span></div>
        {statusPill(props.deployment.status, props.L)}
      </div>
      <div className="deployment-meta-grid">
        <div><span>{props.L("版本", "Version")}</span><b>{props.deployment.version}</b></div>
        <div><span>{props.L("下次运行", "Next run")}</span><b>{formatTime(props.deployment.next_run_at || "") || "-"}</b></div>
        <div><span>{props.L("最近运行", "Last run")}</span><b>{formatTime(props.deployment.last_run_at || "") || "-"}</b></div>
        <div><span>Schedule</span><b>{scheduleLabel(props.deployment, props.L)}</b></div>
      </div>
      <div className="action-row deployment-detail-actions">
        <button className="btn primary compact" onClick={() => props.onRun(props.deployment!)} disabled={Boolean(props.busy)}><Icon name="i-play" size={13} /> {props.L("运行", "Run")}</button>
        {paused ? (
          <button className="btn secondary compact" onClick={() => props.onUnpause(props.deployment!)} disabled={Boolean(props.busy)}>{props.L("启用", "Unpause")}</button>
        ) : (
          <button className="btn secondary compact" onClick={() => props.onPause(props.deployment!)} disabled={Boolean(props.busy)}>{props.L("暂停", "Pause")}</button>
        )}
        <button className="btn secondary compact danger-text" onClick={() => props.onArchive(props.deployment!)} disabled={Boolean(props.busy)}><Icon name="i-trash" size={13} /></button>
      </div>
      <div className="deployment-runs">
        <h3>{props.L("运行记录", "Runs")}</h3>
        {props.runs.length ? props.runs.map((run) => (
          <button key={run.id} className="deployment-run-row" onClick={() => run.session_id ? props.openSession(run.session_id) : undefined}>
            <span>{statusPill(run.status, props.L)}</span>
            <b>{run.triggered_by}</b>
            <small>{formatTime(run.created_at)}</small>
            <code>{run.session_id ?? run.id}</code>
          </button>
        )) : <div className="deployment-runs-empty">{props.L("暂无运行记录", "No runs yet")}</div>}
      </div>
    </aside>
  );
}

function scheduleLabel(deployment: AgentDeployment, L: (zh: string, en: string) => string) {
  if (!deployment.schedule) return L("手动", "Manual");
  return `${deployment.schedule.expression || "-"} · ${deployment.schedule.timezone || "UTC"}`;
}

function agentName(agents: Agent[], id: string) {
  return agents.find((agent) => agent.id === id)?.name ?? id;
}

function selectedAgentName(agents: Agent[], id: string) {
  return agents.find((agent) => agent.id === id)?.name || "Agent";
}

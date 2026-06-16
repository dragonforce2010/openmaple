import { useEntityNav, useI18n, type View } from "../../appConfig";
import { statusPill } from "../../components/shared/labels";
import { formatRelativeTime } from "../../components/shared/misc";
import type { Agent, Environment, ModelConfig, Session, User, Workspace } from "../../types";
import { Icon } from "../../ui";

export function DashboardView(props: {
  currentUser: User;
  workspace: Workspace | null;
  agents: Agent[];
  sessions: Session[];
  environments: Environment[];
  modelConfigs: ModelConfig[];
  setView: (view: View) => void;
  openMetric: (metric: string) => void;
  canManageWorkspace?: boolean;
}) {
  const { language } = useI18n();
  const L = (zh: string, en: string) => (language === "zh" ? zh : en);
  const { openEntity, goView } = useEntityNav();
  const activeSessions = props.sessions.filter((session) => ["bootstrapping", "running", "tool_waiting"].includes(session.status)).length;
  const readyEnvironments = props.environments.filter((environment) => String(environment.config?.status ?? "ready") !== "failed").length;
  const defaultModels = props.modelConfigs.filter((config) => config.is_default).length;
  const hour = new Date().getHours();
  const greet = hour < 12 ? L("上午好", "Good morning") : hour < 18 ? L("下午好", "Good afternoon") : L("晚上好", "Good evening");
  const tiles: Array<{ icon: string; label: string; num: number; delta: string; deltaCls: string; view: View }> = [
    { icon: "i-brain", label: L("活跃 Agent", "Active agents"), num: props.agents.length, delta: L(`共 ${props.agents.length} 个`, `${props.agents.length} total`), deltaCls: "up", view: "agents" },
    { icon: "i-terminal", label: L("运行中 Session", "Running sessions"), num: activeSessions, delta: L(`${props.sessions.length} 个会话`, `${props.sessions.length} sessions`), deltaCls: "", view: "sessions" },
    { icon: "i-server", label: L("环境", "Environments"), num: props.environments.length, delta: L(`${readyEnvironments} 就绪`, `${readyEnvironments} ready`), deltaCls: "", view: "environments" },
    ...(props.canManageWorkspace ? [{ icon: "i-gauge", label: L("模型接入点", "Model endpoints"), num: props.modelConfigs.length, delta: L(`${defaultModels || 1} 默认`, `${defaultModels || 1} default`), deltaCls: "", view: "models" as View }] : [])
  ];
  return (
    <div className="page-frame">
      <div className="page-heading">
        <div>
          <h1>{`${greet}，${props.currentUser.name}`}</h1>
          <div className="sub">{L("当前工作区的托管智能体、会话与用量速览。", "Managed agents, sessions and usage at a glance.")}</div>
        </div>
        <div className="action-row">
          <button className="icon-btn lg" title={L("文档", "Docs")} onClick={() => props.setView("docs")}><Icon name="i-book" size={17} /></button>
          {props.canManageWorkspace ? <button className="btn secondary" onClick={() => props.setView("api_keys")}><Icon name="i-key" size={15} /> {L("获取秘钥", "Get API key")}</button> : null}
          <button className="btn primary" onClick={() => props.setView("quickstart")}><Icon name="i-brain" size={15} /> {L("构建智能体", "Build an agent")}</button>
        </div>
      </div>
      <div className="tile-grid">
        {tiles.map((tile) => (
          <button className="tile clickable" key={tile.view} onClick={() => props.openMetric(tile.view)}>
            <div className="lbl"><Icon name={tile.icon} size={16} /> {tile.label}</div>
            <div className="num">{tile.num}</div>
            <div className={`delta ${tile.deltaCls}`.trim()}>{tile.delta}</div>
            <span className="tile-go"><Icon name="i-chevron-right" size={15} /></span>
          </button>
        ))}
      </div>
      <div className="section-title">{L("最近会话", "Recent sessions")}<button className="more" onClick={() => props.setView("sessions")}>{L("查看全部", "View all")} →</button></div>
      <div className="card">
        <table className="data-table">
          <thead><tr><th>{L("会话", "Session")}</th><th>{L("状态", "Status")}</th><th>Agent</th><th>{L("更新", "Updated")}</th></tr></thead>
          <tbody>
            {props.sessions.slice(0, 4).map((session) => (
              <tr key={session.id} className="clickable-row" onClick={() => goView("sessions", session.id)}>
                <td><span className="t-name">{session.title}</span><small className="mono">{session.id}</small></td>
                <td>{statusPill(session.status, L)}</td>
                <td className="mono">{session.agent_id}</td>
                <td>{formatRelativeTime(session.updated_at, language)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="section-title">{L("智能体", "Agents")}<button className="more" onClick={() => props.setView("agents")}>{L("查看全部", "View all")} →</button></div>
      <div className="card">
        <table className="data-table">
          <thead><tr><th>{L("名称", "Name")}</th><th>{L("状态", "Status")}</th><th>{L("模型", "Model")}</th><th>{L("更新", "Updated")}</th></tr></thead>
          <tbody>
            {props.agents.slice(0, 4).map((agent, index) => {
              const status = index === 0 ? "active" : index === 1 ? "running" : "idle";
              return (
                <tr key={agent.id} className="clickable-row" onClick={() => openEntity("agent", agent.id)}>
                  <td><span className="t-name">{agent.name}</span><small>{agent.description}</small></td>
                  <td>{statusPill(status, L)}</td>
                  <td className="mono">{agent.config.model?.id ?? "-"}</td>
                  <td>{formatRelativeTime(agent.updated_at, language)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

import type { Agent, Environment, ModelConfig, Session } from "../../types";
import { DrawerLayer, Icon } from "../../ui";
import { useEntityNav, useI18n, type View } from "../../appConfig";
import { environmentRuntimeLabel, statusPill } from "../../components/shared/labels";
import { formatRelativeTime } from "../../components/shared/misc";

export function MetricDrawer(props: {
  metric: string;
  agents: Agent[];
  sessions: Session[];
  environments: Environment[];
  modelConfigs: ModelConfig[];
  onClose: () => void;
  onDrill: (target: View) => void;
}) {
  const { language } = useI18n();
  const L = (zh: string, en: string) => (language === "zh" ? zh : en);
  const { openEntity } = useEntityNav();
  const meta: Record<string, { title: string; target: View }> = {
    agents: { title: L("活跃 Agent", "Active agents"), target: "agents" },
    sessions: { title: L("运行中 Session", "Running sessions"), target: "sessions" },
    environments: { title: L("环境", "Environments"), target: "environments" },
    models: { title: L("模型接入点", "Model endpoints"), target: "models" }
  };
  const current = meta[props.metric] ?? meta.agents;

  function block(title: string, count: number, rows: React.ReactNode) {
    return (
      <div className="ref-block">
        <div className="ref-title">{title} <span className="ref-cnt">{count}</span></div>
        <div className="ref-list">{count ? rows : <div className="ref-empty">{L("暂无数据", "Nothing here yet")}</div>}</div>
      </div>
    );
  }
  function row(icon: string, title: string, sub: string, right: React.ReactNode, onClick: () => void) {
    return (
      <button className="ref-row" key={title + sub} onClick={onClick}>
        <span className="rr-ic"><Icon name={icon} size={15} /></span>
        <span className="rr-main"><b>{title}</b><span>{sub}</span></span>
        {right}
        <Icon name="i-chevron-right" size={14} />
      </button>
    );
  }
  function openStack(next: () => void) {
    props.onClose();
    window.requestAnimationFrame(next);
  }

  let body: React.ReactNode = null;
  if (props.metric === "agents") {
    body = block(L("全部 Agent", "All agents"), props.agents.length, props.agents.map((agent, index) =>
      row("i-brain", agent.name, agent.description || agent.id, statusPill(index === 0 ? "active" : index === 1 ? "running" : "idle", L), () => openStack(() => openEntity("agent", agent.id)))
    ));
  } else if (props.metric === "sessions") {
    const run = props.sessions.filter((session) => ["running", "bootstrapping", "tool_waiting"].includes(session.status));
    const rest = props.sessions.filter((session) => !["running", "bootstrapping", "tool_waiting"].includes(session.status));
    body = (
      <>
        {block(L("运行中", "Running"), run.length, run.map((session) => row("i-terminal", session.title, `${session.id} · ${formatRelativeTime(session.updated_at, language)}`, statusPill(session.status, L), () => openStack(() => openEntity("session", session.id)))))}
        {block(L("其他会话", "Other sessions"), rest.length, rest.map((session) => row("i-terminal", session.title, `${session.id} · ${formatRelativeTime(session.updated_at, language)}`, statusPill(session.status, L), () => openStack(() => openEntity("session", session.id)))))}
      </>
    );
  } else if (props.metric === "environments") {
    body = block(L("全部环境", "All environments"), props.environments.length, props.environments.map((environment) =>
      row("i-server", environment.name, `${environment.id} · ${environmentRuntimeLabel(environment)}`, null, () => openStack(() => openEntity("environment", environment.id)))
    ));
  } else {
    body = block(L("全部接入点", "All endpoints"), props.modelConfigs.length, props.modelConfigs.map((config) =>
      row("i-gauge", config.name, config.model_name, config.is_default ? <span className="status active">{L("默认", "default")}</span> : null, () => props.onDrill("models"))
    ));
  }

  return (
    <DrawerLayer onClose={props.onClose}>
      <aside className="ask-drawer" role="dialog" aria-modal="true" aria-label={current.title}>
        <div className="drawer-head">
          <div><b>{current.title}</b><span>{L("指标详情", "Metric details")}</span></div>
          <button className="x" onClick={props.onClose} aria-label={L("关闭", "Close")}><Icon name="i-x" size={18} /></button>
        </div>
        <div className="ask-body">
          <div className="metric-drawer">{body}</div>
          <button className="btn secondary" style={{ margin: "12px 0 0" }} onClick={() => props.onDrill(current.target)}>
            {L("查看全部", "View all")} <Icon name="i-chevron-right" size={14} />
          </button>
        </div>
      </aside>
    </DrawerLayer>
  );
}

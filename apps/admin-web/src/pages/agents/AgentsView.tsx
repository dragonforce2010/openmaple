import type { Agent } from "../../types";
import { Icon } from "../../ui";
import { useEntityNav, useI18n } from "../../appConfig";
import { agentLoopLabel, agentStatusForIndex, statusPill } from "../../components/shared/labels";
import { DataTable, PageFrame } from "../../components/shared/layout";
import { formatTime } from "../../components/shared/misc";

export function AgentsView({
  agents,
  openSession,
  openCreate,
  loading = false
}: {
  agents: Agent[];
  openSession: () => void;
  openCreate: () => void;
  loading?: boolean;
}) {
  const { language } = useI18n();
  const L = (zh: string, en: string) => (language === "zh" ? zh : en);
  const { openEntity } = useEntityNav();

  return (
    <>
      <PageFrame
        title={L("智能体", "Agents")}
        sub={L(
          "受管自治 Agent，点击行查看摘要，点击 ID 进入详情。",
          "Managed autonomous agents. Click a row for summary, the ID to open details."
        )}
        action={
          <>
            <button className="btn secondary" onClick={openSession} disabled={loading || !agents.length} title={!agents.length ? L("先创建 Agent 后再启动 Session", "Create an agent before starting a session") : undefined}>
              <Icon name="i-play" size={15} /> {L("新建 Session", "New session")}
            </button>
            <button className="btn primary" onClick={openCreate}>
              <Icon name="i-plus" size={15} /> {L("\u521b\u5efa Agent", "Create agent")}
            </button>
          </>
        }
      >
        {agents.length || loading ? (
          <DataTable
            headers={["ID", L("名称", "Name"), L("状态", "Status"), L("模型", "Model"), "Loop", L("更新", "Updated")]}
            loading={loading}
          >
            {agents.map((agent, index) => (
              <tr key={agent.id} className="clickable-row" onClick={() => openEntity("agent", agent.id)}>
                <td><span className="id-link">{agent.id}</span></td>
                <td>
                  <span className="t-name">{agent.name}</span>
                  {agent.description ? <small>{agent.description}</small> : null}
                </td>
                <td>{statusPill(agentStatusForIndex(index), L)}</td>
                <td className="mono">{agent.config.model.id}</td>
                <td>{agentLoopLabel(agent.config.agent_loop?.type)}</td>
                <td>{formatTime(agent.created_at)}</td>
              </tr>
            ))}
          </DataTable>
        ) : (
          <div className="resource-empty agents-empty">
            <div className="resource-empty-icon"><Icon name="i-brain" size={26} /></div>
            <h2>{L("还没有智能体", "No agents yet")}</h2>
            <p>{L("创建第一个 Agent 后，才可以启动 Session、绑定环境并观察运行事件。", "Create your first agent before starting sessions, binding environments, and inspecting run events.")}</p>
            <button className="btn primary" onClick={openCreate}><Icon name="i-plus" size={15} /> {L("创建 Agent", "Create agent")}</button>
          </div>
        )}
      </PageFrame>
    </>
  );
}

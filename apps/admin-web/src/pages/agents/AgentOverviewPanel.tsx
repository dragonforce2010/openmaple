import type { Agent, Workspace } from "../../types";
import { Icon } from "../../ui";
import { useEntityNav, useI18n } from "../../appConfig";
import { agentLoopLabel, workspaceLabel } from "../../components/shared/labels";

export function AgentOverviewPanel(props: {
  agent: Agent;
  workspace?: Workspace | null;
  workspaces?: Workspace[];
  className?: string;
}) {
  const { language } = useI18n();
  const L = (zh: string, en: string) => (language === "zh" ? zh : en);
  const { openEntity } = useEntityNav();
  const agent = props.agent;
  const workspaces = props.workspaces ?? [];
  const mcpServers = agent.config.mcp_servers ?? [];
  const tools = agent.config.tools ?? [];
  const skills = agent.config.skills ?? [];
  const workspace =
    workspaceLabel(workspaces, agent.workspace_id) ??
    (props.workspace && (!agent.workspace_id || props.workspace.id === agent.workspace_id) ? props.workspace : null);

  return (
    <div className={`agent-detail-main${props.className ? ` ${props.className}` : ""}`}>
      <div className="agent-version-strip">
        <button type="button" className="btn secondary compact">{L("当前版本", "Current version")} · v{agent.current_version}</button>
        <span className="mono">{agent.id}</span>
      </div>
      <div className="detail-doc">
        <div className="field-block">
          <div className="flabel">{L("模型", "Model")}</div>
          <div className="chip-row">
            <span className="chip"><Icon name="i-gauge" size={14} /> {agent.config.model.provider}/{agent.config.model.id}</span>
            <span className="chip"><Icon name="i-refresh" size={14} /> {agentLoopLabel(agent.config.agent_loop?.type)}</span>
          </div>
        </div>
        <div className="field-block">
          <div className="flabel">{L("描述", "Description")}</div>
          {agent.description ? <div className="prose-box">{agent.description}</div> : <div className="panel-empty">{L("未设置描述", "No description")}</div>}
        </div>
        <div className="field-block">
          <div className="flabel">{L("系统提示词", "System prompt")}</div>
          {agent.config.system ? <div className="prose-box system-prompt-box">{agent.config.system}</div> : <div className="panel-empty">{L("未设置系统提示词", "No system prompt")}</div>}
        </div>
        <div className="field-block">
          <div className="flabel">MCP {L("与工具", "& tools")}</div>
          <div className="chip-row">
            {mcpServers.length ? mcpServers.map((server, i) => (
              <span className="chip" key={i}><Icon name="i-server" size={14} /> {String((server as { name?: unknown }).name ?? `MCP ${i + 1}`)}</span>
            )) : <span className="hint">{L("未配置 MCP", "No MCP configured")}</span>}
          </div>
        </div>
        <div className="field-block">
          <div className="flabel">{L("内置工具", "Built-in tools")}</div>
          <div className="chip-row">
            {tools.length ? tools.map((tool, i) => (
              <span className="chip" key={i}><Icon name="i-terminal" size={14} /> {String((tool as { name?: unknown; type?: unknown }).name ?? (tool as { type?: unknown }).type ?? `tool ${i + 1}`)}</span>
            )) : <span className="hint">{L("未启用内置工具", "No built-in tools")}</span>}
          </div>
        </div>
        <div className="field-block">
          <div className="flabel">{L("技能", "Skills")}</div>
          <div className="chip-row">
            {skills.length ? skills.map((skill, i) => (
              <span className="chip" key={i}><Icon name="i-filecode" size={14} /> {String((skill as { name?: unknown }).name ?? `skill ${i + 1}`)}</span>
            )) : <span className="hint">{L("未启用技能", "No skills enabled")}</span>}
          </div>
        </div>
        <div className="field-block">
          <div className="flabel">{L("所属空间", "Workspace")}</div>
          <div className="chip-row">
            {workspace ? (
              <button type="button" className="chip chip-button" onClick={() => openEntity("workspace", workspace.id)}><Icon name="i-grid" size={14} /> {workspace.name ?? workspace.id}{workspace.name ? <span className="mut mono">{workspace.id}</span> : null}</button>
            ) : agent.workspace_id ? (
              <button type="button" className="chip chip-button" onClick={() => openEntity("workspace", agent.workspace_id!)}><Icon name="i-grid" size={14} /> <span className="mono">{agent.workspace_id}</span></button>
            ) : (
              <span className="hint">{L("未绑定空间", "No workspace bound")}</span>
            )}
            <span className="chip"><Icon name="i-layers" size={14} /> v{agent.current_version}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

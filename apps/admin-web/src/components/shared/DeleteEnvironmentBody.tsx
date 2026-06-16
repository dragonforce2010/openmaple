import { useState } from "react";
import type { Agent, Session } from "../../types";
import { Icon } from "../../ui";

type L = (zh: string, en: string) => string;

// Delete-environment confirmation body: instead of cramming related agents + sessions into one
// run-on sentence, show them as a tabbed list (agents first by default), so the user can scan
// exactly what stays traceable after the archive.
export function DeleteEnvironmentBody({ agents, sessions, intro, L }: { agents: Agent[]; sessions: Session[]; intro: string; L: L }) {
  const [tab, setTab] = useState<"agents" | "sessions">("agents");
  const rows = tab === "agents" ? agents : sessions;
  const label = (item: Agent | Session) => ("title" in item ? item.title : item.name) || item.id;
  const icon = tab === "agents" ? "i-brain" : "i-terminal";
  return (
    <div className="del-env">
      <p className="del-env-intro">{intro}</p>
      <div className="seg settings-seg del-env-tabs" role="tablist">
        <button className={tab === "agents" ? "on" : ""} onClick={() => setTab("agents")}>{L("关联 Agent", "Agents")} ({agents.length})</button>
        <button className={tab === "sessions" ? "on" : ""} onClick={() => setTab("sessions")}>{L("关联 Session", "Sessions")} ({sessions.length})</button>
      </div>
      <div className="del-env-list">
        {rows.length ? rows.map((item) => (
          <div className="del-env-row" key={item.id}>
            <Icon name={icon} size={14} />
            <span className="del-env-name">{label(item)}</span>
            <span className="mut mono">{item.id}</span>
          </div>
        )) : <div className="empty-state">{tab === "agents" ? L("无关联 Agent", "No related agents") : L("无关联 Session", "No related sessions")}</div>}
      </div>
    </div>
  );
}

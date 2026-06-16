import type { Agent, AgentRuntimeInfo, Environment } from "../../types";
import { Icon, useToast } from "../../ui";
import { useI18n } from "../../appConfig";
import { HighlightedCode, agentSampleCode } from "../../components/shared/code";
import { shortText } from "../../components/shared/misc";
import { RuntimePoolDetails } from "../workspaces/RuntimePoolDetails";

export function AgentIntegrationPanel(props: {
  agent: Agent;
  environment?: Environment | null;
  language: "python" | "typescript" | "curl";
  setLanguage: (value: "python" | "typescript" | "curl") => void;
}) {
  const { language } = useI18n();
  const L = (zh: string, en: string) => (language === "zh" ? zh : en);
  const toast = useToast();
  const code = agentSampleCode(props.agent, props.language, { environment: props.environment });
  function copyIntegrationCode() {
    const done = () => toast(L("已复制", "Copied"), "ok");
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(code).then(done, done);
    else done();
  }

  return (
    <div className="section">
      <div className="section-title">
        <span>
          <Icon name="i-code" size={15} /> {L("接入代码", "Integration")}
        </span>
      </div>
      <div className="seg" style={{ width: "max-content", marginBottom: "12px" }}>
        <button
          className={props.language === "curl" ? "on" : ""}
          onClick={() => props.setLanguage("curl")}
        >
          curl
        </button>
        <button
          className={props.language === "typescript" ? "on" : ""}
          onClick={() => props.setLanguage("typescript")}
        >
          TypeScript
        </button>
        <button
          className={props.language === "python" ? "on" : ""}
          onClick={() => props.setLanguage("python")}
        >
          Python
        </button>
      </div>
      <div className="copy-code-block integration-code-block">
        <button className="icon-btn copy-code-icon" title={L("复制", "Copy")} onClick={copyIntegrationCode}><Icon name="i-copy" size={15} /></button>
        <pre className="code-panel">
          <HighlightedCode code={code} language={props.language} />
        </pre>
      </div>
      <small style={{ display: "block", marginTop: "8px", color: "var(--muted)", fontSize: "12px" }}>
        {L(
          "样例已带入 production base URL、workspace、environment、agent 和模型 ID；只需要填入完整 Workspace API key。",
          "Samples include production base URL, workspace, environment, agent, and model IDs; provide only the full workspace API key."
        )}
      </small>
    </div>
  );
}

export function AgentRuntimePanel({ info, error }: { info: AgentRuntimeInfo | null; error: string }) {
  const { language } = useI18n();
  const L = (zh: string, en: string) => (language === "zh" ? zh : en);
  const pool = info?.runtime_pool;
  const recent = info?.recent_sessions ?? [];

  return (
    <div className="section">
      <div className="section-title">
        <span>
          <Icon name="i-server" size={15} /> {L("运行时绑定", "Runtime binding")}
        </span>
      </div>

      {error ? <div className="error-inline">{error}</div> : null}
      {!info && !error ? (
        <div className="panel-empty">{L("正在加载运行时绑定…", "Loading runtime binding…")}</div>
      ) : null}
      {info && !pool ? (
        <div className="panel-empty">
          {L("该 Agent 未绑定 workspace 运行时池。", "No workspace runtime pool is bound to this agent.")}
        </div>
      ) : null}

      {pool ? (
        <RuntimePoolDetails pool={pool} L={L} summaryOnly />
      ) : null}

      {recent.length ? (
        <div className="runtime-session-block">
          <div className="section-title">
            <span>{L("最近会话", "Recent sessions")}</span>
          </div>
          <div className="runtime-session-list">
            {recent.map((session) => (
              <div className="runtime-session-row" key={session.id}>
                <span>
                  <Icon name="i-terminal" size={13} />
                  <b className="mono">{shortText(session.id, 20)}</b>
                  <em className={`status ${session.status === "failed" ? "failed" : session.status === "running" ? "running" : "active"}`}>{session.status}</em>
                </span>
                <code className="mono">
                  {shortText(session.runtime_pool_member_id ?? L("无运行时成员", "no runtime member"), 22)}
                </code>
                <small>
                  {String(session.agent_runtime?.type ?? "unknown")} / {String(session.sandbox_runtime?.type ?? "sandbox")}
                </small>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

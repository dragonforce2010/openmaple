import { Fragment, useEffect, useState, type MutableRefObject } from "react";
import { templateCards, useL, type TemplateCard, type WizardStep } from "../../appConfig";
import { HighlightedCode } from "../../components/shared/code";
import { MarkdownText } from "../../components/shared/events";
import { Select } from "../../components/shared/forms";
import { statusPill } from "../../components/shared/labels";
import type { Agent, Environment, SessionDetail } from "../../types";
import { Icon, useToast } from "../../ui";
import { AgentIntegrationPanel } from "../agents/AgentViews";

type QuickstartFormat = "yaml" | "json";
type QuickstartTab = "config" | "preview";
type PreviewMessage = { who: "user" | "agent" | "system"; text: string };

function templateSlug(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

// Prompt is derived from the SAME card the user clicked (name + description), so the
// conversation always matches the chosen template. A bad index is a bug, not something to
// paper over with a default — fail loud.
export function templatePrompt(index: number) {
  const card = templateCards[index];
  if (!card) throw new Error(`templatePrompt: no template card at index ${index}`);
  const [name, description] = card;
  return `Create a ${name}: ${description}.`;
}

export function templateConfigText(index: number, format: QuickstartFormat) {
  const card = templateCards[index];
  if (!card) return "";
  const [name, description] = card;
  const config = { name, slug: templateSlug(name), description, model: "claude-sonnet-4-6", system: description, mcp_servers: [], tools: [{ type: "agent_toolset_20260401" }], skills: [] };
  if (format === "json") return JSON.stringify(config, null, 2);
  return `name: ${name}\nslug: ${config.slug}\ndescription: ${description}\nmodel: ${config.model}\nsystem: ${description}\nmcp_servers: []\ntools:\n  - type: agent_toolset_20260401\nskills: []`;
}

export function StepProgress({ step }: { step: WizardStep }) {
  const L = useL();
  const steps: Array<[string, string]> = [
    [L("创建 Agent", "Create agent"), "POST /v1/agents"],
    [L("配置环境", "Configure environment"), "POST /v1/environments"],
    [L("启动 Session", "Start session"), "POST /v1/sessions"],
    [L("接入集成", "Integrate"), ""]
  ];
  const rank: Record<WizardStep, number> = { describe: 0, agent_review: 0, environment: 1, vault: 2, session: 2, integration: 3 };
  return (
    <div className="qs2-steps stepper">
      {steps.map(([label, method], index) => {
        const cls = rank[step] > index ? "done" : rank[step] === index ? "active" : "";
        return (
          <Fragment key={label}>
            <div className={`qs-step ${cls}`.trim()}>
              <span className="n">{rank[step] > index ? <Icon name="i-check" size={13} /> : index + 1}</span>
              <b>{label}</b>
              {method && rank[step] === index ? <code className="qs-step-ep">{method}</code> : null}
            </div>
            {index < steps.length - 1 ? <span className="qs-sep" /> : null}
          </Fragment>
        );
      })}
    </div>
  );
}

// Real reasoning (model "thinking") streamed from the Builder Agent. Collapsible: expanded
// while streaming so the user watches it think live, collapsed once final. Replaces the old
// wall-clock fake three-phase progress card.
export function ReasoningBlock({ text, streaming }: { text: string; streaming: boolean }) {
  const L = useL();
  const [open, setOpen] = useState(streaming);
  useEffect(() => { setOpen(streaming); }, [streaming]);
  return (
    <div className="qb-text qs-assistant-card qs-reasoning">
      <button className="qs-reasoning-head" onClick={() => setOpen((value) => !value)}>
        <span className="qs-card-kicker">
          {streaming ? <span className="typing"><i /><i /><i /></span> : <Icon name="i-sparkles" size={14} />}
          {streaming ? L("正在思考…", "Thinking…") : L("思考过程", "Thinking")}
        </span>
        <Icon name={open ? "i-chevron-down" : "i-chevron-right"} size={14} />
      </button>
      {open ? <div className="qs-reasoning-body"><MarkdownText text={text} /></div> : null}
    </div>
  );
}

export function BuilderProgressHints({ label }: { label: string }) {
  const L = useL();
  const items = [
    label || L("Builder Agent 正在处理请求…", "Builder Agent is processing the request..."),
    L("正在等待事件流返回模型思考或工具结果。", "Waiting for streamed reasoning or tool results."),
    L("如果正在创建资源，完成后页面会自动进入下一步。", "If resources are being created, the page will advance automatically.")
  ];
  return (
    <div className="qb-status qs-progress-hints" aria-live="polite">
      <span className="spin-dot" />
      <span className="qs-progress-list">
        {items.map((item) => <span className="qs-progress-step" key={item}>{item}</span>)}
      </span>
    </div>
  );
}

export function ApiResult({ title, method, path, body, kind = "result" }: { title: string; method: string; path: string; body: unknown; kind?: "request" | "result" }) {
  const L = useL();
  const toast = useToast();
  const base = typeof window !== "undefined" ? window.location.origin : "https://api.maple.dev";
  const bodyText = JSON.stringify(body ?? {}, null, 2);
  const curl = [
    `curl -X ${method} ${base}${path} \\`,
    `  -H "Content-Type: application/json" \\`,
    `  -H "Authorization: Bearer $MAPLE_API_KEY" \\`,
    `  -d '${bodyText}'`
  ].join("\n");
  const copy = () => {
    const done = () => toast(L("已复制", "Copied"));
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(curl).then(done, done);
    else done();
  };
  return (
    <div className={`api-result${kind === "request" ? " pending" : ""}`}>
      <div className={`qb-status${kind === "request" ? " req" : ""}`}><Icon name={kind === "request" ? "i-terminal" : "i-check"} size={15} /> {title}</div>
      <div className="qb-code api-card">
        <div className="qb-code-head">
          <span className={`method ${method.toLowerCase()}`}>{method}</span>
          <code>{path}</code>
          <div className="qb-code-actions">
            <span className="qb-fmt-label">cURL</span>
            <button className="qb-fmt" title={L("复制", "Copy")} onClick={copy}><Icon name="i-copy" size={14} /></button>
          </div>
        </div>
        <pre><HighlightedCode code={curl} language="curl" /></pre>
      </div>
    </div>
  );
}

export function QuickstartSidePanel(props: {
  step: WizardStep;
  agent: Agent | null;
  environment: Environment | null;
  sessionDetail: SessionDetail | null;
  fmt: QuickstartFormat;
  setFmt: (value: QuickstartFormat) => void;
  rtab: QuickstartTab;
  setRtab: (value: QuickstartTab) => void;
  viewTpl: number | null;
  setViewTpl: (value: number | null) => void;
  filteredTemplates: Array<readonly [TemplateCard, number]>;
  query: string;
  setQuery: (value: string) => void;
  tplDetailCode: string;
  copyTpl: () => void;
  useTemplate: (index: number) => void;
  sampleLanguage: "python" | "typescript" | "curl";
  setSampleLanguage: (value: "python" | "typescript" | "curl") => void;
  codeText: string;
  copyCode: () => void;
  productionEnvironments: Environment[];
  onSelectEnvironment: (id: string) => void;
  startSession: () => void;
  busy: boolean;
  startingSession: boolean;
  bootstrapping: boolean;
  previewMessages: PreviewMessage[];
  agentWorking: boolean;
  chatInput: string;
  setChatInput: (value: string) => void;
  sendChat: () => void | Promise<void>;
  chatRef: MutableRefObject<HTMLDivElement | null>;
}) {
  const L = useL();
  return (
    <section className="qs2-right">
      {props.step === "describe" ? (
        props.viewTpl != null ? (
          <div className="qs-tpld">
            <div className="qs-tpld-head">
              <button className="icon-btn" onClick={() => props.setViewTpl(null)} aria-label={L("返回", "Back")}><Icon name="i-arrow-left" size={16} /></button>
              <div className="qs-tpld-title"><b>{L(templateCards[props.viewTpl][2], templateCards[props.viewTpl][0])}</b><span>· {L("模板", "Template")}</span></div>
              <div className="qs-tpld-actions">
                <div className="seg sm">
                  <button className={props.fmt === "yaml" ? "on" : ""} onClick={() => props.setFmt("yaml")}>YAML</button>
                  <button className={props.fmt === "json" ? "on" : ""} onClick={() => props.setFmt("json")}>JSON</button>
                </div>
                <button className="icon-btn" title={L("复制", "Copy")} onClick={props.copyTpl}><Icon name="i-copy" size={16} /></button>
                <button className="btn primary compact" onClick={() => props.useTemplate(props.viewTpl!)}>{L("使用模板", "Use template")}</button>
              </div>
            </div>
            <pre className="qs-tpld-code"><HighlightedCode code={props.tplDetailCode} language={props.fmt} /></pre>
          </div>
        ) : (
          <div className="qs-browse">
            <div className="qs-browse-head">{L("浏览模板", "Browse templates")}</div>
            <div className="search-box" style={{ margin: "0 0 14px" }}>
              <Icon name="i-search" size={15} />
              <input value={props.query} onChange={(event) => props.setQuery(event.target.value)} placeholder={L("搜索模板", "Search templates")} />
            </div>
            <div className="tpl-grid2">
              {props.filteredTemplates.length ? props.filteredTemplates.map(([card, index]) => (
                <button key={card[0]} className="tpl2" onClick={() => props.setViewTpl(index)}><b>{L(card[2], card[0])}</b><span>{L(card[3], card[1])}</span></button>
              )) : <div className="hint" style={{ gridColumn: "1 / -1" }}>{L("无匹配模板", "No matching template")}</div>}
            </div>
          </div>
        )
      ) : props.step === "integration" && props.agent ? (
        <div className="qs-integration-panel">
          <AgentIntegrationPanel agent={props.agent} environment={props.environment} language={props.sampleLanguage} setLanguage={props.setSampleLanguage} />
        </div>
      ) : (
        <>
          <div className="qs-rtabs">
            <button className={props.rtab === "config" ? "on" : ""} onClick={() => props.setRtab("config")}>{L("配置", "Config")}</button>
            <button className={props.rtab === "preview" ? "on" : ""} onClick={() => props.setRtab("preview")}>{L("预览", "Preview")}</button>
          </div>
          {props.rtab === "config" ? (
            <div className="qs-config">
              <div className="fmt-tabs" style={{ padding: "0 0 10px" }}>
                <button className={props.fmt === "yaml" ? "on" : ""} onClick={() => props.setFmt("yaml")}>YAML</button>
                <button className={props.fmt === "json" ? "on" : ""} onClick={() => props.setFmt("json")}>JSON</button>
                <div className="right"><button className="icon-btn" title={L("复制", "Copy")} onClick={props.copyCode} disabled={!props.codeText}><Icon name="i-copy" size={15} /></button></div>
              </div>
              {props.codeText ? <pre className="qs-tpld-code"><HighlightedCode code={props.codeText} language={props.fmt} /></pre> : <div className="code-panel empty">{L("发送第一条消息后，这里会显示 Agent YAML。", "Send your first message and the agent YAML shows up here.")}</div>}
            </div>
          ) : (
            <div className="qs-preview-shell">
              <div className="qs-prev-head qs-preview-head">
                {props.step === "session" && props.sessionDetail ? (
                  <>
                    <span className="qs-prev-env-name"><span className="qs-prev-cloud"><Icon name="i-cloud" size={14} /></span><b>{props.sessionDetail.environment?.name ?? props.environment?.name ?? "env"}</b></span>
                    {statusPill(props.sessionDetail.session.status, L)}
                  </>
                ) : (
                  <>
                    <span className="qs-prev-env-name"><span className="qs-prev-cloud"><Icon name="i-cloud" size={14} /></span><b>{L("运行环境", "Runtime")}</b></span>
                    <div className="qs-prev-env">
                      <Select
                        value={props.environment?.id ?? ""}
                        options={props.productionEnvironments.map((environment) => ({ value: environment.id, label: environment.name }))}
                        onChange={props.onSelectEnvironment}
                        placeholder={L("选择环境", "Select environment")}
                      />
                      <button className="btn primary compact" onClick={props.startSession} disabled={props.busy || !props.agent || !props.environment}>{props.startingSession ? <span className="spin-dot" /> : L("开始试运行", "Start test run")}</button>
                    </div>
                  </>
                )}
              </div>
              <div className="chat qs-preview-chat" ref={props.chatRef}>
                {props.bootstrapping ? (
                  <div className="sandbox-boot">
                    <span className="boot-orbit"><i /><i /><i /></span>
                    <div>
                      <b>{L("沙箱正在启动", "Sandbox bootstrapping")}</b>
                      <small>{L("正在准备运行环境、挂载工作区并连接 Agent runtime。", "Preparing runtime, mounting workspace, and connecting the agent runtime.")}</small>
                    </div>
                  </div>
                ) : null}
                {props.previewMessages.map((message, index) => (
                  <div className={`bubble ${message.who}`} key={index}>
                    <span className="who">{message.who === "user" ? L("你", "You") : message.who === "system" ? L("系统", "System") : "Agent"}</span>
                    <MarkdownText text={message.text} />
                  </div>
                ))}
                {props.agentWorking ? (
                  <div className="bubble agent">
                    <span className="who">Agent</span>
                    <span className="typing"><i /><i /><i /></span>
                  </div>
                ) : null}
              </div>
              <div className="composer qs-preview-composer">
                <input
                  value={props.chatInput}
                  onChange={(event) => props.setChatInput(event.target.value)}
                  onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void props.sendChat(); } }}
                  placeholder={L("给 Agent 发条消息…", "Send a message to the agent…")}
                  disabled={!props.sessionDetail}
                />
                <button className="send-btn" onClick={props.sendChat} disabled={!props.sessionDetail || !props.chatInput.trim() || props.agentWorking || props.busy}><Icon name="i-arrow-up" size={16} /></button>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}

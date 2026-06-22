import { useEffect, useMemo, useRef, useState } from "react";
import { templateCards, useL, type WizardStep } from "../../appConfig";
import { MarkdownText, textFromPayload, transcriptMessagesFromEvents } from "../../components/shared/events";
import { isProductionEnvironment } from "../../components/shared/labels";
import type {
  Agent,
  AgentConfig,
  AgentLoopType,
  Environment,
  JsonRecord,
  ModelConfig,
  SessionDetail,
  Vault
} from "../../types";
import { Icon, useToast } from "../../ui";
import { ApiResult, BuilderProgressHints, QuickstartSidePanel, ReasoningBlock, StepProgress, templateConfigText, templatePrompt } from "./QuickstartParts";

export function QuickstartView(props: {
  step: WizardStep;
  prompt: string;
  submittedPrompt: string;
  setPrompt: (value: string) => void;
  draft: AgentConfig | null;
  yaml: string;
  builderDetail: SessionDetail | null;
  busy: boolean;
  busyAction: string;
  busyLabel: string;
  agent: Agent | null;
  environment: Environment | null;
  vault: Vault | null;
  quickSessionId: string;
  environments: Environment[];
  sandboxProvider: "local_docker" | "e2b" | "vefaas" | "daytona";
  modelConfigs: ModelConfig[];
  selectedModelId: string;
  setSelectedModelId: (value: string) => void;
  selectedAgentLoop: AgentLoopType;
  setSelectedAgentLoop: (value: AgentLoopType) => void;
  buildDraft: (prompt?: string) => void;
  createAgent: () => void;
  createEnvironment: (mode: "unrestricted" | "none") => void;
  reuseEnvironment: (environment: Environment) => void;
  onSelectEnvironment: (id: string) => void;
  createVault: () => void;
  startSession: () => void;
  sessionDetail: SessionDetail | null;
  onPreviewSend: (text: string) => void;
  openIntegrationStep: () => void;
}) {
  const L = useL();
  const toast = useToast();
  // Mirror the workspace's configured sandbox provider in the copy (the actual env created
  // by the backend already honors it); never hardcode E2B.
  const sandboxLabel = props.sandboxProvider === "local_docker" ? "Local Docker" : props.sandboxProvider === "vefaas" ? "VeFaaS" : props.sandboxProvider === "daytona" ? "Daytona" : "E2B";
  const [query, setQuery] = useState("");
  const [rtab, setRtab] = useState<"config" | "preview">("config");
  const [fmt, setFmt] = useState<"yaml" | "json">("yaml");
  const [viewTpl, setViewTpl] = useState<number | null>(null);
  const [typing, setTyping] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [sampleLanguage, setSampleLanguage] = useState<"python" | "typescript" | "curl">("curl");
  const [envChoice, setEnvChoice] = useState<"unrestricted" | "none">("unrestricted");
  const [envOtherOpen, setEnvOtherOpen] = useState(false);
  const [envOtherNote, setEnvOtherNote] = useState("");
  const convRef = useRef<HTMLDivElement>(null);
  const chatRef = useRef<HTMLDivElement>(null);
  const visiblePrompt = props.submittedPrompt || props.prompt;
  const builderMessages = transcriptMessagesFromEvents(props.builderDetail?.events ?? []);
  const builderWorking = props.busyAction === "builder_message";
  const creatingAgent = props.busyAction === "create_agent";
  const startingSession = props.busyAction === "start_session";
  const draftPending = props.step === "describe" && builderWorking && Boolean(visiblePrompt.trim());
  const showConversation = props.step !== "describe" || draftPending || builderMessages.length > 0 || Boolean(props.submittedPrompt);
  const modelPoolMissing = props.modelConfigs.length === 0;
  const draftModelConfig = props.draft?.model?.config_id ? props.modelConfigs.find((config) => config.id === props.draft?.model?.config_id) ?? null : null;
  const draftModelName = draftModelConfig?.name || props.draft?.model.name || props.draft?.model.id || "Model";
  const draftModelProtocol = draftModelConfig?.provider_type || props.draft?.model.provider || "";
  const draftModelId = draftModelConfig?.model_name || props.draft?.model.id || "";
  const productionEnvironments = props.environments.filter(isProductionEnvironment);
  const reusableEnvironments = productionEnvironments.filter((environment) => {
    const config = (environment.config ?? {}) as JsonRecord;
    const sandbox = (config.sandbox ?? {}) as JsonRecord;
    return String(config.type ?? "") === props.sandboxProvider || String(sandbox.provider ?? "") === props.sandboxProvider;
  });

  const filteredTemplates = useMemo(() => {
    const q = query.trim().toLowerCase();
    const indexed = templateCards.map((card, index) => [card, index] as const);
    if (!q) return indexed;
    return indexed.filter(([[name, description]]) => name.toLowerCase().includes(q) || description.toLowerCase().includes(q));
  }, [query]);



  const codeText = props.yaml && fmt === "json" && props.draft ? JSON.stringify(props.draft, null, 2) : props.yaml;
  const copyCode = () => {
    if (!codeText) return;
    const done = () => toast(L("已复制", "Copied"));
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(codeText).then(done, done);
    else done();
  };

  const tplDetailCode = viewTpl != null ? templateConfigText(viewTpl, fmt) : "";
  const copyTpl = () => {
    if (!tplDetailCode) return;
    const done = () => toast(L("已复制", "Copied"));
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(tplDetailCode).then(done, done);
    else done();
  };
  const useTemplate = (index: number) => {
    const nextPrompt = templatePrompt(index);
    props.setPrompt(nextPrompt);
    setViewTpl(null);
    props.buildDraft(nextPrompt);
  };

  const detail = props.sessionDetail;
  const quickSessionDetail = props.quickSessionId &&
    detail?.session.id === props.quickSessionId &&
    (!props.agent || detail.session.agent_id === props.agent.id) &&
    (!props.environment || detail.session.environment_id === props.environment.id)
    ? detail
    : null;
  const transcriptMessages = transcriptMessagesFromEvents((props.step === "session" || props.step === "integration") ? quickSessionDetail?.events ?? [] : []);
  // preview chat is a plain user/agent transcript — reasoning blocks belong to the builder
  // conversation, not the test-run chat.
  const realMessages = transcriptMessages.filter((message) => message.kind !== "reasoning").map((message) => ({ who: message.kind as "user" | "agent", text: message.text }));
  const previewComplete = Boolean(
    props.step === "session" &&
    quickSessionDetail &&
    transcriptMessages.some((message) => message.kind === "user") &&
    (quickSessionDetail.events ?? []).some((event) => event.type === "agent.message" && textFromPayload(event.payload))
  );
  const sessionStatus = String(quickSessionDetail?.session.status ?? "");
  const bootstrapping = sessionStatus === "bootstrapping";
  const agentWorking = typing || ["running", "tool_waiting"].includes(sessionStatus);

  async function sendChat() {
    const text = chatInput.trim();
    if (!text || !quickSessionDetail || typing || props.busy) return;
    setChatInput("");
    setTyping(true);
    try {
      await props.onPreviewSend(text);
    } finally {
      setTyping(false);
    }
  }

  const previewMessages: Array<{ who: "user" | "agent" | "system"; text: string }> = realMessages.length
    ? realMessages
    : [{ who: "system", text: quickSessionDetail ? L("Session 已就绪，发条消息开始测试运行。", "Session ready - send a message to start the test run.") : L("启动 Session 后即可在此试运行。", "Start a session to test-run it here.") }];

  useEffect(() => {
    const node = convRef.current;
    if (!node) return;
    node.scrollTo({ top: node.scrollHeight, behavior: "smooth" });
  }, [props.step, props.busyLabel, props.agent?.id, props.environment?.id, props.vault?.id, quickSessionDetail?.session.id, realMessages.length, builderMessages.length]);

  useEffect(() => {
    const node = chatRef.current;
    if (!node || rtab !== "preview") return;
    node.scrollTo({ top: node.scrollHeight, behavior: "smooth" });
  }, [previewMessages.length, agentWorking, rtab]);

  return (
    <div className="qs2 quickstart-grid">
      <div className="qs2-top">
        <div className="qs2-title quick-title"><Icon name="i-sparkles" size={16} /> {L("快速开始", "Quickstart")}</div>
        <StepProgress step={props.step} />
      </div>
      <div className="qs2-body">
        <section className="qs2-left">
          <div className="qs-conv" ref={convRef}>
            {!showConversation ? (
              <div className="qs-hero">
                <h2>{L("你想构建什么？", "What do you want to build?")}</h2>
                <p>{L("描述你的 Agent，或从右侧选择一个模板开始。", "Describe your agent, or pick a template on the right to begin.")}</p>
              </div>
            ) : (
              <>
                {builderMessages.length ? (
                  builderMessages.map((message) =>
                    message.kind === "reasoning" ? (
                      <ReasoningBlock key={message.id} text={message.text} streaming={!message.final} />
                    ) : (
                      <div className={message.kind === "user" ? "qb-user" : "qb-text qs-assistant-card"} key={message.id}>
                        {message.kind === "agent" ? <div className="qs-card-kicker"><Icon name="i-sparkles" size={14} /> Builder Agent</div> : null}
                        <MarkdownText text={message.text} />
                      </div>
                    )
                  )
                ) : (
                  <div className="qb-user">{visiblePrompt}</div>
                )}
                {builderWorking && !builderMessages.some((message) => message.kind === "reasoning" && !message.final) ? <BuilderProgressHints label={props.busyLabel} /> : null}
                {props.step === "agent_review" ? (
                  <div className="qb-text">
                    <p>{L("已根据你的描述草拟好 Agent 定义，右侧可查看。确认创建？", "Drafted an agent definition from your description — see the right panel. Create it?")}</p>
                    {props.draft ? (
                      <div className="qs-mini-facts">
                        <div><span>{L("名称", "Name")}</span><b>{props.draft.name}</b></div>
                        <div><span>{L("模型", "Model")}</span><b title={`${draftModelName} · ${draftModelProtocol} · ${draftModelId}`}>{draftModelName}</b><small>{[draftModelProtocol, draftModelId].filter(Boolean).join(" · ")}</small></div>
                        <div><span>AgentLoop</span><b>{props.draft.agent_loop.type}</b></div>
                        <div><span>{L("工具", "Tools")}</span><b>{props.draft.tools.length}</b></div>
                      </div>
                    ) : null}
                    {modelPoolMissing ? <div className="modal-note warn"><Icon name="i-alert" size={16} /> {L("当前工作区没有可用模型池。请先在模型池配置至少一个模型，再创建 Agent。", "No model pool is available in this workspace. Configure at least one model before creating an Agent.")}</div> : null}
                    <ApiResult kind="request" title={L("将发送的请求", "Request to send")} method="POST" path="/v1/agents" body={props.draft ?? {}} />
                    <div className="qs-confirm action-row">
                      <button className="btn primary" onClick={props.createAgent} disabled={props.busy || modelPoolMissing}>{creatingAgent ? <><span className="spin-dot" />{L("正在创建 Agent…", "Creating agent…")}</> : L("创建这个 Agent", "Create this agent")}</button>
                      <button className="btn secondary" onClick={() => props.setPrompt(L("请基于上一版继续优化：", "Please refine the previous draft: "))} disabled={props.busy}>{L("继续优化", "Keep refining")}</button>
                    </div>
                  </div>
                ) : null}
                {props.agent ? <ApiResult title={L("Agent 已创建", "Agent created")} method="POST" path="/v1/agents" body={props.agent.config} /> : null}
                {props.step === "environment" ? (
                  <>
                    <div className="qb-status done"><Icon name="i-check" size={14} /> {L("环境已加载", "Environments loaded")}</div>
                    <div className="qb-text qs-agent-explain">
                      <p>{L(`${props.agent?.name || "Agent"} 已创建。Agent 是可复用的版本化配置，包含角色设定、模型和工具；它本身不会运行，需要基于它创建 Session。`, `${props.agent?.name || "Agent"} has been created. An Agent is a reusable versioned config with role, model, and tools; it runs only when a Session is created from it.`)}</p>
                      <p>{L("Environment 是运行 Agent 会话的容器配置模板，定义网络访问、沙箱类型和运行参数。", "An Environment is the container template for agent sessions, including network access, sandbox type, and runtime settings.")}</p>
                    </div>
                    <div className="qb-text question-card qs-choice-card">
                      <h3 className="qs-h2">{L("请选择一个已有环境，或创建新环境：", "Choose an existing environment, or create a new one:")}</h3>
                      <div className="qs-choice-list">
                        {reusableEnvironments.map((environment, index) => (
                          <button className="qs-choice-row" key={environment.id} onClick={() => props.reuseEnvironment(environment)} disabled={props.busy}>
                            <span className="qs-choice-num">{index + 1}</span>
                            <span className="qs-choice-main">
                              <b>{environment.name}</b>
                              <small>{String((environment.config.networking as JsonRecord | undefined)?.mode ?? "cloud_limited")}</small>
                            </span>
                          </button>
                        ))}
                        <button className="qs-choice-row" onClick={() => props.createEnvironment(envChoice)} disabled={props.busy}>
                          <span className="qs-choice-num">{reusableEnvironments.length + 1}</span>
                          <span className="qs-choice-main">
                            <b>{L("创建新环境", "Create new environment")}</b>
                            <small>{envChoice === "unrestricted" ? L(`默认 ${sandboxLabel} 云沙箱，可访问公网与包管理器`, `Default ${sandboxLabel} cloud sandbox with internet and package managers`) : L(`默认 ${sandboxLabel} 云沙箱，隔离网络，最小权限`, `Default ${sandboxLabel} cloud sandbox, isolated network, least privilege`)}</small>
                          </span>
                        </button>
                        <button className="qs-choice-row muted" onClick={() => setEnvOtherOpen((value) => !value)} disabled={props.busy}>
                          <span className="qs-choice-num"><Icon name="i-edit" size={13} /></span>
                          <span className="qs-choice-main">
                            <b>{L("其他要求", "Something else")}</b>
                            <small>{L("补充网络或沙箱要求", "Add networking or sandbox requirements")}</small>
                          </span>
                        </button>
                      </div>
                      {envOtherOpen ? (
                        <div className="qs-env-note">
                          <textarea value={envOtherNote} onChange={(event) => setEnvOtherNote(event.target.value)} placeholder={L("例如：需要禁用公网，只允许访问内网知识库。", "For example: disable public internet and only allow the internal knowledge base.")} rows={2} />
                          <div className="action-row">
                            <button className="btn secondary compact" onClick={() => setEnvChoice("none")} disabled={props.busy}>{L("切到禁用联网", "Use no internet")}</button>
                            <button
                              className="btn primary compact"
                              onClick={() => {
                                if (envOtherNote.trim()) props.setPrompt(`${visiblePrompt}\n\n${L("环境要求", "Environment requirements")}: ${envOtherNote.trim()}`);
                                setEnvOtherOpen(false);
                              }}
                              disabled={props.busy}
                            >
                              {L("记录要求", "Save note")}
                            </button>
                          </div>
                        </div>
                      ) : null}
                      <div className="qs-card-footer">
                        <div className="seg sm">
                          <button className={envChoice === "unrestricted" ? "on" : ""} onClick={() => setEnvChoice("unrestricted")} disabled={props.busy}>{L("允许联网", "Internet")}</button>
                          <button className={envChoice === "none" ? "on" : ""} onClick={() => setEnvChoice("none")} disabled={props.busy}>{L("禁用联网", "No internet")}</button>
                        </div>
                        <button
                          className="btn secondary compact"
                          onClick={() => {
                            if (reusableEnvironments[0]) props.reuseEnvironment(reusableEnvironments[0]);
                            else props.createEnvironment(envChoice);
                          }}
                          disabled={props.busy}
                        >
                          {L("跳过", "Skip")}
                        </button>
                      </div>
                    </div>
                  </>
                ) : null}
                {props.environment ? <ApiResult title={L("Environment 已创建", "Environment created")} method="POST" path="/v1/environments" body={props.environment.config} /> : null}
                {props.step === "vault" && props.environment ? (
                  <div className="qb-text">
                    <p>{L("这个 Agent 连接外部 MCP 服务前需要凭证。", "This agent needs credentials before it can reach external MCP services.")}</p>
                    <div className="modal-note"><Icon name="i-alert" size={16} /> {L("Vault 在当前工作区内共享。加入的凭证可被引用该 Vault 的 Session 使用。", "Vaults are shared within this workspace and usable by any session that references them.")}</div>
                    <ApiResult kind="request" title={L("将发送的请求", "Request to send")} method="POST" path="/v1/vaults" body={{ display_name: `${props.agent?.name || "Agent"} Credentials`, metadata: { source: "quickstart", shared_scope: "workspace" } }} />
                    <div className="qs-confirm action-row">
                      <button className="btn primary" onClick={props.createVault} disabled={props.busy}>{L("创建凭证库", "Create vault")}</button>
                      <button className="btn secondary" onClick={props.startSession} disabled={props.busy}>{L("跳过，直接启动 Session", "Skip, start a session")}</button>
                    </div>
                  </div>
                ) : null}
                {props.vault ? <ApiResult title={L("Vault 已就绪", "Vault ready")} method="POST" path="/v1/vaults" body={{ id: props.vault.id, display_name: props.vault.display_name }} /> : null}
                {props.step === "session" ? (
                  quickSessionDetail ? (
                    <div className="qb-text">
                      <p>{previewComplete ? L("Preview 已完成一轮问答。你可以继续测试，也可以进入集成代码。", "Preview completed one message round. You can keep testing or move to integration code.") : L("Session 已启动，切到右侧 Preview 即可试运行。", "Session started — switch to Preview on the right to test-run it.")}</p>
                      <div className="qs-confirm action-row">
                        <button className="btn primary" onClick={() => setRtab("preview")}>{L("打开 Preview", "Open preview")}</button>
                        {previewComplete ? <button className="btn secondary" onClick={props.openIntegrationStep}>{L("进入接入集成", "Open integration")}</button> : null}
                      </div>
                    </div>
                  ) : (
                    <div className="qb-text">
                      <p>{L("创建 Session 所需信息已准备好。", "Everything is ready to create the session.")}</p>
                      <ApiResult kind="request" title={L("将发送的请求", "Request to send")} method="POST" path="/v1/sessions" body={{ agent: props.agent?.id, environment_id: props.environment?.id, title: `${props.agent?.name || "Agent"} run`, vault_ids: props.vault ? [props.vault.id] : [] }} />
                      <div className="qs-confirm action-row">
                        <button className="btn primary" onClick={props.startSession} disabled={props.busy}>{startingSession ? <><span className="spin-dot" />{L("正在启动 Session…", "Starting session…")}</> : L("启动 Session", "Start session")}</button>
                      </div>
                    </div>
                  )
                ) : null}
                {props.step === "integration" && props.agent ? (
                  <div className="qb-text qs-assistant-card">
                    <div className="qs-card-kicker"><Icon name="i-code" size={14} /> {L("接入集成", "Integration")}</div>
                    <p>{L("Preview 已完成一轮问答。下一步用右侧接入代码把这个 Agent 集成到你的应用或脚本里。", "Preview completed one message round. Next, use the integration code on the right to wire this agent into your app or script.")}</p>
                  </div>
                ) : null}
                {props.busyLabel && !builderWorking ? <div className="qb-status"><span className="spin-dot" /> {props.busyLabel}</div> : null}
              </>
            )}
          </div>
          {(
            <div className="qs-composer">
              <textarea
                value={props.prompt}
                onChange={(event) => props.setPrompt(event.target.value)}
                onInput={(event) => { const target = event.currentTarget; target.style.height = "auto"; target.style.height = `${Math.min(160, target.scrollHeight)}px`; }}
                onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !props.busy) { event.preventDefault(); props.buildDraft(); } }}
                placeholder={L("和 Builder Agent 对话…", "Chat with Builder Agent…")}
                rows={1}
              />
              <button className="qs-send" title={L("发送", "Send")} onClick={() => props.buildDraft()} disabled={props.busy}>
                <Icon name="i-arrow-up" size={16} />
              </button>
            </div>
          )}
        </section>

        <QuickstartSidePanel
          step={props.step}
          agent={props.agent}
          environment={props.environment}
          sessionDetail={quickSessionDetail}
          fmt={fmt}
          setFmt={setFmt}
          rtab={rtab}
          setRtab={setRtab}
          viewTpl={viewTpl}
          setViewTpl={setViewTpl}
          filteredTemplates={filteredTemplates}
          query={query}
          setQuery={setQuery}
          tplDetailCode={tplDetailCode}
          copyTpl={copyTpl}
          useTemplate={useTemplate}
          sampleLanguage={sampleLanguage}
          setSampleLanguage={setSampleLanguage}
          codeText={codeText}
          copyCode={copyCode}
          productionEnvironments={productionEnvironments}
          onSelectEnvironment={props.onSelectEnvironment}
          startSession={props.startSession}
          busy={props.busy}
          startingSession={startingSession}
          bootstrapping={bootstrapping}
          previewMessages={previewMessages}
          agentWorking={agentWorking}
          chatInput={chatInput}
          setChatInput={setChatInput}
          sendChat={sendChat}
          chatRef={chatRef}
        />
      </div>
    </div>
  );
}

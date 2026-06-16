import { useState } from "react";
import { apiPost } from "../../api";
import type { Agent, AgentConfig, ModelConfig } from "../../types";
import { Icon } from "../../ui";
import { TEMPLATE_SYSTEMS, templateCards, useL } from "../../appConfig";
import { ModalShell } from "../../components/shared/layout";
import { errorMessage } from "../../components/shared/misc";
import { editableConfigText, parseEditableAgentConfig } from "./modalConfig";

export function AgentCreateModal(props: { workspaceId?: string; modelConfigs: ModelConfig[]; onClose: () => void; onCreated: (agentId: string) => void }) {
  const L = useL();
  const [mode, setMode] = useState<"describe" | "template">("describe");
  const [prompt, setPrompt] = useState("");
  const [draft, setDraft] = useState<AgentConfig | null>(null);
  const [pickedTpl, setPickedTpl] = useState<number | null>(null);
  const [fmt, setFmt] = useState<"yaml" | "json">("yaml");
  const [configDraftText, setConfigDraftText] = useState("");
  const [configError, setConfigError] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const defaultModel = props.modelConfigs.find((config) => config.is_default) ?? props.modelConfigs[0] ?? null;
  function setDraftAndText(nextDraft: AgentConfig, nextFmt = fmt) {
    setDraft(nextDraft);
    setConfigDraftText(editableConfigText(nextDraft, nextFmt));
    setConfigError("");
  }
  function pickTemplate(index: number) {
    setPickedTpl(index);
    setError("");
    const [name, description] = templateCards[index];
    setDraftAndText({
      name,
      description,
      model: { provider: defaultModel?.provider_type ?? "custom", id: defaultModel?.model_name ?? "", config_id: defaultModel?.id },
      system: TEMPLATE_SYSTEMS[index] ?? description,
      mcp_servers: [],
      tools: [{ type: "agent_toolset_20260401" }],
      skills: [],
      agent_loop: { type: "anthropic_claude_code" }
    } as unknown as AgentConfig);
  }
  async function gen() {
    if (!prompt.trim()) return;
    setBusy("gen");
    setError("");
    try {
      const result = await apiPost<{ draft: AgentConfig }>("/v1/agent_drafts", { prompt: prompt.trim() });
      setDraftAndText(result.draft);
      setPickedTpl(null);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy("");
    }
  }
  async function create() {
    if (!draft || configError) return;
    setBusy("create");
    setError("");
    try {
      const agent = await apiPost<Agent>("/v1/agents", { ...draft, workspace_id: props.workspaceId || undefined });
      props.onClose();
      props.onCreated(agent.id);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy("");
    }
  }
  function switchFmt(nextFmt: "yaml" | "json") {
    setFmt(nextFmt);
    if (draft) setConfigDraftText(editableConfigText(draft, nextFmt));
    setConfigError("");
  }
  function editConfig(value: string) {
    setConfigDraftText(value);
    if (!draft) return;
    try {
      setDraft(parseEditableAgentConfig(value, fmt, draft));
      setConfigError("");
    } catch (reason) {
      setConfigError(errorMessage(reason));
    }
  }
  const needsGenerate = mode === "describe" && !draft;
  const primaryDisabled = Boolean(busy) || Boolean(configError) || (needsGenerate ? !prompt.trim() : !draft);
  const primaryLabel = needsGenerate
    ? busy === "gen" ? <><span className="spin-dot" />{L("生成中…", "Generating...")}</> : L("生成", "Generate")
    : busy === "create" ? <><span className="spin-dot btn-spin" />{L("创建中…", "Creating...")}</> : L("创建 Agent", "Create agent");
  const configBlock = draft ? (
    <div className="ac-config">
      <div className="ac-config-head">
        <span className="flabel-in">{L("Agent 配置", "Agent config")}</span>
        <div className="ac-fmt">
          <button type="button" className={fmt === "yaml" ? "on" : ""} onClick={() => switchFmt("yaml")}>YAML</button>
          <button type="button" className={fmt === "json" ? "on" : ""} onClick={() => switchFmt("json")}>JSON</button>
        </div>
      </div>
      {configError ? <div className="modal-note warn"><Icon name="i-alert" size={16} /> {configError}</div> : null}
      <div className="doc-code-wrap">
        <button className="doc-code-copy" onClick={(event) => { void navigator.clipboard?.writeText(configDraftText); const button = event.currentTarget; const original = button.textContent; button.textContent = L("已复制", "Copied"); window.setTimeout(() => { button.textContent = original; }, 1500); }}>{L("复制", "Copy")}</button>
        <textarea className="fld ac-config-editor" value={configDraftText} onChange={(event) => editConfig(event.target.value)} spellCheck={false} />
      </div>
    </div>
  ) : null;
  return (
    <ModalShell title={L("\u521b\u5efa Agent", "Create agent")} onClose={props.onClose} wide className="agent-create-modal">
      <p className="modal-sub">{L("\u4ece\u6a21\u677f\u5f00\u59cb\uff0c\u6216\u63cf\u8ff0\u4f60\u9700\u8981\u7684 Agent\u3002", "Start from a template or describe what you need.")}</p>
      {error ? <div className="modal-note"><Icon name="i-alert" size={16} /> {error}</div> : null}
      <div className="ac-seg">
        <button type="button" className={mode === "describe" ? "on" : ""} onClick={() => setMode("describe")}>{L("\u63cf\u8ff0\u4f60\u7684 Agent", "Describe your agent")}</button>
        <button type="button" className={mode === "template" ? "on" : ""} onClick={() => setMode("template")}>{L("\u6a21\u677f", "Template")}</button>
      </div>
      {mode === "describe" ? (
        <div className="ac-describe">
          <textarea className="fld" rows={3} placeholder={L("\u4f8b\u5982\uff1a\u603b\u7ed3\u65b0\u7684 GitHub PR \u5e76\u53d1\u6458\u8981\u5230 Slack\u3002", "e.g. Summarizes new GitHub PRs and posts a digest to Slack.")} value={prompt} onChange={(event) => setPrompt(event.target.value)} />
        </div>
      ) : (
        <div className="ac-template-layout">
          <div className="ac-tpls">
            {templateCards.map(([name, desc], index) => (
              <button key={name} type="button" className={`ac-tpl${pickedTpl === index ? " on" : ""}`} onClick={() => pickTemplate(index)}>
                <b>{name}</b><span>{desc}</span>
              </button>
            ))}
          </div>
          {configBlock ?? <div className="ac-config-empty">{L("选择模板后会在这里显示 Agent 配置。", "Select a template to preview its agent config here.")}</div>}
        </div>
      )}
      {mode === "describe" ? configBlock : null}
      <div className="modal-foot">
        <button type="button" className="btn secondary" onClick={props.onClose}>{L("\u53d6\u6d88", "Cancel")}</button>
        <button type="button" className="btn primary" disabled={primaryDisabled} onClick={needsGenerate ? gen : create}>{primaryLabel}</button>
      </div>
    </ModalShell>
  );
}

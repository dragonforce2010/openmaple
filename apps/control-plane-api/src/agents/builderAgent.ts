import { QUICKSTART_BUILDER_PURPOSE, createBuilderAgentConfig, createBuilderEnvironmentConfig, createQuickstartEnvironmentConfig } from "@maple/super-agent";
import { normalizeAgentLoop } from "../agentLoops";
import { emitSessionEvent } from "../eventHub";
import { callProvider, type ChatMessage, type ToolCall } from "../provider";
import { createAgent, createEnvironment, createSession, createSessionEvent, getDefaultModelConfig, getEnvironment, getSession, getWorkspace, listAgents, listEnvironments, listSessionEvents, listSessions, updateSessionStatus, workspaceIncludesModelConfig } from "../store";
import type { AgentConfig, AgentLoopType, JsonRecord, SessionEvent } from "../types";
import { buildAgentDraft, buildLocalAgentDraft } from "./agentBuilder";
import { builderProviderTools, builderSystemPrompt } from "./builderPrompts";

export type BuilderContext = {
  userId: string;
  workspaceId: string;
  modelConfigId?: string | null;
  agentLoopType?: AgentLoopType;
};

const maxBuilderProviderTurns = 6;
const builderProviderTimeoutMs = Number(process.env.MAPLE_BUILDER_PROVIDER_TIMEOUT_MS || 30_000);

function asRecord(value: unknown): JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as JsonRecord) : {};
}

export function isQuickstartBuilderSession(session: unknown) {
  const metadata = asRecord(asRecord(session).metadata);
  return metadata.purpose === QUICKSTART_BUILDER_PURPOSE;
}

export function isHiddenSystemRecord(record: unknown) {
  const config = asRecord(asRecord(record).config);
  const metadata = asRecord(config.metadata);
  return metadata.system_agent === true || metadata.hidden === true || metadata.purpose === QUICKSTART_BUILDER_PURPOSE;
}

export function isHiddenSystemEnvironment(record: unknown) {
  const config = asRecord(asRecord(record).config);
  const metadata = asRecord(config.metadata);
  return metadata.system_environment === true || metadata.hidden === true || metadata.purpose === QUICKSTART_BUILDER_PURPOSE;
}

export function isHiddenSession(record: unknown) {
  const metadata = asRecord(asRecord(record).metadata);
  return metadata.hidden === true || metadata.system_session === true || metadata.purpose === QUICKSTART_BUILDER_PURPOSE;
}

function modelFromWorkspace(workspaceId: string) {
  const config = getDefaultModelConfig(workspaceId) as JsonRecord | null;
  if (!config) {
    return { provider: "openai", id: process.env.OPENAI_MODEL || process.env.ARK_MODEL || "doubao-seed-1-6-251015", speed: "standard" };
  }
  return {
    provider: String(config.provider_type || "openai"),
    id: String(config.model_name || "model"),
    config_id: String(config.id || ""),
    name: String(config.name || config.model_name || "Model"),
    speed: "standard"
  };
}

function builderAgentConfig(workspaceId: string): AgentConfig {
  return createBuilderAgentConfig({ model: modelFromWorkspace(workspaceId) }) as AgentConfig;
}

function builderEnvironmentConfig() {
  return createBuilderEnvironmentConfig();
}

function quickEnvConfig(mode: "unrestricted" | "none", workspaceId: string) {
  const workspace = getWorkspace(workspaceId) as JsonRecord | null;
  const rawProvider = String(workspace?.sandbox_provider || "e2b");
  const sandboxProvider = rawProvider === "local_docker" ? "local_docker" : rawProvider === "vefaas" ? "vefaas" : "e2b";
  return createQuickstartEnvironmentConfig(mode, sandboxProvider);
}

function emitEvent(sessionId: string, type: string, payload: JsonRecord, providerEventType?: string | null) {
  const event = createSessionEvent({ session_id: sessionId, type, payload, provider_event_type: providerEventType ?? null });
  emitSessionEvent(event);
  return event;
}

function activeBuilderSessions(context: BuilderContext) {
  return (listSessions() as JsonRecord[]).filter((session) => {
    const metadata = asRecord(session.metadata);
    return (
      metadata.purpose === QUICKSTART_BUILDER_PURPOSE &&
      metadata.owner_user_id === context.userId &&
      session.workspace_id === context.workspaceId &&
      session.status !== "terminated"
    );
  }) as JsonRecord[];
}

function ensureBuilderAgent(workspaceId: string) {
  const existing = (listAgents(workspaceId) as JsonRecord[]).find((agent) => asRecord(asRecord(agent.config).metadata).purpose === QUICKSTART_BUILDER_PURPOSE);
  if (existing) return existing;
  return createAgent({ workspace_id: workspaceId, config: builderAgentConfig(workspaceId) }) as JsonRecord;
}

function ensureBuilderEnvironment(workspaceId: string) {
  const existing = (listEnvironments(workspaceId) as JsonRecord[]).find((environment) => asRecord(asRecord(environment.config).metadata).purpose === QUICKSTART_BUILDER_PURPOSE);
  if (existing) return existing;
  return createEnvironment({ workspace_id: workspaceId, name: "maple-agent-builder-env", config: builderEnvironmentConfig() }) as JsonRecord;
}

export function ensureQuickstartBuilderSession(context: BuilderContext) {
  activeBuilderSessions(context).forEach((session) => {
    updateSessionStatus(String(session.id), "terminated");
  });
  const agent = ensureBuilderAgent(context.workspaceId);
  const environment = ensureBuilderEnvironment(context.workspaceId);
  const session = createSession({
    workspace_id: context.workspaceId,
    agent_id: String(agent.id),
    environment_id: String(environment.id),
    title: "Maple Agent Builder",
    metadata: {
      purpose: QUICKSTART_BUILDER_PURPOSE,
      hidden: true,
      system_session: true,
      owner_user_id: context.userId
    }
  });
  if (session) updateSessionStatus(String(session.id), "idle");
  return getSession(String((session as JsonRecord | null)?.id || ""));
}

function latestCard<T extends JsonRecord>(events: unknown[], cardType: string): T | null {
  for (const event of [...events].reverse()) {
    const record = asRecord(event);
    const payload = asRecord(record.payload);
    if (record.type === "ui.card" && payload.card_type === cardType) return payload as T;
  }
  return null;
}

function latestAgentId(events: unknown[]) {
  for (const event of [...events].reverse()) {
    const payload = asRecord(asRecord(event).payload);
    if (asRecord(event).type === "ui.resource" && payload.resource_type === "agent" && payload.id) return String(payload.id);
  }
  return "";
}

function environmentChoicePayload(workspaceId: string): JsonRecord {
  const environments = (listEnvironments(workspaceId) as JsonRecord[]).filter((environment) => !isHiddenSystemEnvironment(environment));
  return {
    card_type: "environment_choice",
    environments,
    actions: [
      { id: "reuse_environment", label: "Reuse environment" },
      { id: "create_environment", label: "Create new environment" },
      { id: "something_else", label: "Something else" },
      { id: "skip", label: "Skip" }
    ]
  };
}

function textFromPayload(payload: JsonRecord) {
  if (typeof payload.text === "string") return payload.text;
  const content = payload.content;
  if (Array.isArray(content)) {
    return content
      .map((item) => (item && typeof item === "object" ? String((item as JsonRecord).text ?? "") : String(item ?? "")))
      .join("\n")
      .trim();
  }
  if (typeof content === "string") return content;
  return "";
}

function buildBuilderMessages(events: SessionEvent[], context: BuilderContext): ChatMessage[] {
  const messages: ChatMessage[] = [{ role: "system", content: builderSystemPrompt(context) }];
  const draftCard = latestCard<{ draft?: AgentConfig; prompt?: string }>(events, "agent_draft");
  if (draftCard?.draft) {
    messages.push({
      role: "system",
      content: `Current latest draft JSON:\n${JSON.stringify(draftCard.draft)}`
    });
  }
  for (const event of events.slice(-24)) {
    if (event.type !== "user.message" && event.type !== "agent.message") continue;
    const text = textFromPayload(asRecord(event.payload));
    if (!text) continue;
    messages.push({ role: event.type === "user.message" ? "user" : "assistant", content: text });
  }
  return messages;
}

function emitAgentMessage(sessionId: string, text: string, usage?: JsonRecord) {
  emitEvent(sessionId, "agent.message_delta", { text, usage: usage ?? {} }, "message_stop");
  emitEvent(sessionId, "agent.message", { content: [{ type: "text", text }], usage: usage ?? {} }, "message_stop");
}

// Reasoning payload carries accumulated text so detail re-fetch remains idempotent.
function emitAgentReasoning(sessionId: string, text: string, final: boolean) {
  if (!text) return;
  emitEvent(sessionId, final ? "agent.reasoning" : "agent.reasoning_delta", { text }, final ? "reasoning_stop" : null);
}

function emitBuilderStatus(sessionId: string, text: string) {
  emitAgentReasoning(sessionId, text, false);
}

function builderToolLabel(name: string) {
  if (name === "draft_agent_config") return "生成 Agent 草稿";
  if (name === "list_environments") return "读取可复用环境";
  if (name === "create_agent") return "创建 Agent 资源";
  if (name === "create_environment") return "创建运行环境";
  return `执行 ${name}`;
}

function emitAgentDraftCard(sessionId: string, prompt: string, draft: AgentConfig) {
  emitEvent(
    sessionId,
    "ui.card",
    {
      card_type: "agent_draft",
      prompt,
      draft,
      actions: [
        { id: "create_agent", label: "Create this agent" },
        { id: "keep_refining", label: "Keep refining" }
      ]
    },
    "agent_draft"
  );
}

function latestUserText(events: SessionEvent[]) {
  for (const event of [...events].reverse()) {
    if (event.type !== "user.message") continue;
    const text = textFromPayload(asRecord(event.payload));
    if (text) return text;
  }
  return "";
}

async function executeBuilderTool(sessionId: string, call: ToolCall, context: BuilderContext): Promise<JsonRecord> {
  const input = asRecord(call.arguments);
  const events = listSessionEvents(sessionId) as SessionEvent[];

  if (call.name === "draft_agent_config") {
    const prompt = String(input.prompt || latestUserText(events)).trim();
    if (!prompt) return { ok: false, error: "draft_prompt_required" };
    const draft = await buildAgentDraft(prompt, context.userId, context.modelConfigId ?? null, context.agentLoopType, context.workspaceId);
    emitAgentDraftCard(sessionId, prompt, draft);
    return { ok: true, draft, next_action: "Explain the draft and ask whether to create it or refine it." };
  }

  if (call.name === "list_environments") {
    const environments = (listEnvironments(context.workspaceId) as JsonRecord[]).filter((environment) => !isHiddenSystemEnvironment(environment));
    return { ok: true, environments };
  }

  if (call.name === "create_agent") {
    if (input.confirmed !== true) return { ok: false, error: "confirmation_required" };
    const draftCard = latestCard<{ draft?: AgentConfig }>(events, "agent_draft");
    const draft = asRecord(input.draft).name ? (input.draft as AgentConfig) : draftCard?.draft;
    if (!draft) return { ok: false, error: "builder_agent_draft_missing" };
    const modelConfigId = draft.model?.config_id;
    if (modelConfigId && !workspaceIncludesModelConfig(context.workspaceId, modelConfigId)) {
      return { ok: false, error: "model_config_not_in_workspace_pool" };
    }
    const agent = createAgent({ workspace_id: context.workspaceId, config: { ...draft, agent_loop: normalizeAgentLoop(draft.agent_loop) } }) as JsonRecord;
    emitEvent(sessionId, "ui.resource", { resource_type: "agent", id: String(agent.id), resource: agent }, "agent_created");
    emitEvent(sessionId, "ui.card", environmentChoicePayload(context.workspaceId), "environment_choice");
    return { ok: true, agent, next_action: "Ask the user to reuse an environment or create a new one." };
  }

  if (call.name === "create_environment") {
    const agentId = latestAgentId(events);
    const mode = input.networking === "none" ? "none" : "unrestricted";
    const base = String(input.slug || input.name || agentId || "managed-agent")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "");
    const environment = createEnvironment({
      workspace_id: context.workspaceId,
      name: `${base || "managed-agent"}-env`,
      config: quickEnvConfig(mode, context.workspaceId)
    }) as JsonRecord;
    emitEvent(sessionId, "ui.resource", { resource_type: "environment", id: String(environment.id), resource: environment, mode: "created" }, "environment_created");
    return { ok: true, environment };
  }

  return { ok: false, error: `unsupported_builder_tool:${call.name}` };
}

export async function runQuickstartBuilderTurn(sessionId: string, _text: string, context: BuilderContext) {
  updateSessionStatus(sessionId, "running");
  emitEvent(sessionId, "session.status_running", { reason: "quickstart_builder.message" });
  emitBuilderStatus(sessionId, "正在读取工作区上下文、模型池和最近的 Builder 对话。");
  try {
    const messages = buildBuilderMessages(listSessionEvents(sessionId) as SessionEvent[], context);
    for (let turn = 0; turn < maxBuilderProviderTurns; turn += 1) {
      // Throttle thinking to avoid hundreds of DB writes on long streams.
      let reasoningBuf = "";
      let lastReasoningFlush = 0;
      emitBuilderStatus(sessionId, turn === 0 ? "正在调用模型生成 Agent 草稿和下一步建议。" : "正在根据工具执行结果继续整理 Builder 回复。");
      const providerResult = await callProvider(messages, context.userId, context.modelConfigId || undefined, builderProviderTools(), {
        workspaceId: context.workspaceId,
        timeoutMs: builderProviderTimeoutMs,
        onReasoningDelta: (chunk) => {
          reasoningBuf += chunk;
          const now = Date.now();
          if (now - lastReasoningFlush >= 400) {
            lastReasoningFlush = now;
            emitAgentReasoning(sessionId, reasoningBuf, false);
          }
        }
      });
      // Close the thinking block before whatever comes next (message or tool calls).
      emitAgentReasoning(sessionId, reasoningBuf, true);
      if (providerResult.type === "message") {
        emitAgentMessage(sessionId, providerResult.content, providerResult.usage);
        updateSessionStatus(sessionId, "idle");
        emitEvent(sessionId, "session.status_idle", { reason: "quickstart_builder.end_turn", stop_reason: { type: "end_turn" } });
        return;
      }

      messages.push({ role: "assistant", content: null, tool_calls: providerResult.calls.map((call) => ({ id: call.id, type: "function", function: { name: call.name, arguments: JSON.stringify(call.arguments) } })) });

      for (const call of providerResult.calls) {
        emitBuilderStatus(sessionId, `正在${builderToolLabel(call.name)}。`);
        emitEvent(sessionId, "agent.tool_use", { id: call.id, name: call.name, input: call.arguments, permission_policy: "allow" }, "tool_use");
        const output = await executeBuilderTool(sessionId, call, context);
        emitEvent(sessionId, "tool.result", { id: call.id, name: call.name, status: output.ok === false ? "failed" : "completed", output }, "tool_result");
        emitBuilderStatus(sessionId, output.ok === false ? `${builderToolLabel(call.name)}失败，正在整理错误。` : `${builderToolLabel(call.name)}完成，正在更新页面状态。`);
        messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(output) });
      }
    }
    throw new Error(`Builder provider loop exceeded ${maxBuilderProviderTurns} turns`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const events = listSessionEvents(sessionId) as SessionEvent[];
    const prompt = latestUserText(events);
    if (prompt && /timeout|timed out|aborted/i.test(errorMessage) && !latestCard(events, "agent_draft")) {
      const draft = buildLocalAgentDraft(prompt, context.userId, context.modelConfigId ?? null, context.agentLoopType, context.workspaceId);
      emitBuilderStatus(sessionId, "模型调用超时，已生成本地 Agent 草稿。");
      emitAgentDraftCard(sessionId, prompt, draft);
      emitAgentMessage(sessionId, "模型调用超时，OpenMaple 已先生成一个本地草稿。你可以继续修改或直接创建 Agent。", { provider_error: errorMessage });
      updateSessionStatus(sessionId, "idle");
      emitEvent(sessionId, "session.status_idle", { reason: "quickstart_builder.local_draft", provider_error: errorMessage });
      return;
    }
    updateSessionStatus(sessionId, "failed");
    emitEvent(sessionId, "session.status_failed", {
      reason: "quickstart_builder_failed",
      error: errorMessage
    });
    throw error;
  }
}

export function runQuickstartBuilderAction(sessionId: string, actionId: string, payload: JsonRecord, context: BuilderContext) {
  const events = listSessionEvents(sessionId) as SessionEvent[];
  const draftCard = latestCard<{ draft?: AgentConfig }>(events, "agent_draft");
  emitEvent(sessionId, "builder.action", { action_id: actionId, payload });

  if (actionId === "create_agent") {
    emitBuilderStatus(sessionId, "正在创建 Agent 资源。");
    const draft = asRecord(payload.draft).name ? (payload.draft as AgentConfig) : draftCard?.draft;
    if (!draft) throw new Error("builder_agent_draft_missing");
    const modelConfigId = draft.model?.config_id;
    if (modelConfigId && !workspaceIncludesModelConfig(context.workspaceId, modelConfigId)) {
      throw new Error("model_config_not_in_workspace_pool");
    }
    const agent = createAgent({ workspace_id: context.workspaceId, config: { ...draft, agent_loop: normalizeAgentLoop(draft.agent_loop) } }) as JsonRecord;
    emitEvent(sessionId, "ui.resource", { resource_type: "agent", id: String(agent.id), resource: agent }, "agent_created");
    emitEvent(sessionId, "ui.card", environmentChoicePayload(context.workspaceId), "environment_choice");
    emitBuilderStatus(sessionId, "Agent 已创建，正在准备环境选择。");
    return { agent, events: listSessionEvents(sessionId) };
  }

  if (actionId === "reuse_environment") {
    emitBuilderStatus(sessionId, "正在绑定已有环境。");
    const environmentId = String(payload.environment_id || "");
    const environment = getEnvironment(environmentId) as JsonRecord | null;
    if (!environment || environment.workspace_id !== context.workspaceId) throw new Error("environment_not_found");
    emitEvent(sessionId, "ui.resource", { resource_type: "environment", id: environmentId, resource: environment, mode: "reused" }, "environment_selected");
    emitBuilderStatus(sessionId, "环境已绑定，可以启动 Session。");
    return { environment, events: listSessionEvents(sessionId) };
  }

  if (actionId === "create_environment" || actionId === "skip") {
    emitBuilderStatus(sessionId, "正在创建运行环境。");
    const agentId = latestAgentId(events);
    const mode = payload.networking === "none" ? "none" : "unrestricted";
    const environment = createEnvironment({
      workspace_id: context.workspaceId,
      name: `${String(payload.slug || payload.name || agentId || "managed-agent").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "managed-agent"}-env`,
      config: quickEnvConfig(mode, context.workspaceId)
    }) as JsonRecord;
    emitEvent(sessionId, "ui.resource", { resource_type: "environment", id: String(environment.id), resource: environment, mode: "created" }, "environment_created");
    emitBuilderStatus(sessionId, "运行环境已创建，可以启动 Session。");
    return { environment, events: listSessionEvents(sessionId) };
  }

  throw new Error(`unsupported_builder_action:${actionId}`);
}

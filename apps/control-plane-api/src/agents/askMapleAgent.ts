import { MAPLE_AGENT_PURPOSE, createMapleAgentConfig } from "@maple/super-agent";
import { emitSessionEvent } from "../eventHub";
import { visibleModelConfigsForCurrentMode } from "../modelGateway";
import { callProvider, type ChatMessage } from "../provider";
import { isLocalDockerMode } from "../runtime/localDockerMode";
import {
  createAgent,
  createEnvironment,
  createSession,
  createSessionEvent,
  getSession,
  listAgents,
  listEnvironments,
  listModelConfigs,
  listSessionEvents,
  listSessions,
  updateSessionStatus
} from "../store";
import type { AgentConfig, JsonRecord } from "../types";

const askMapleProviderTimeoutMs = Number(process.env.MAPLE_ASK_PROVIDER_TIMEOUT_MS || 60_000);

type AskMapleContext = {
  userId: string;
  workspaceId: string;
  targetSessionId: string;
};

type SessionDetailLike = {
  session: JsonRecord;
  agent?: JsonRecord | null;
  environment?: JsonRecord | null;
  vaults?: JsonRecord[];
  events?: JsonRecord[];
  tool_calls?: JsonRecord[];
};

function asRecord(value: unknown): JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as JsonRecord) : {};
}

export function isAskMapleSession(session: unknown) {
  const metadata = asRecord(asRecord(session).metadata);
  return metadata.purpose === MAPLE_AGENT_PURPOSE;
}

function modelFromWorkspace(workspaceId: string) {
  const configs = visibleModelConfigsForCurrentMode(listModelConfigs(workspaceId) as JsonRecord[]);
  const config = configs.find((modelConfig) => modelConfig.is_default) || configs[0] || null;
  if (!config) {
    return { provider: "openai", id: isLocalDockerMode() ? "local-docker-no-model" : process.env.OPENAI_MODEL || process.env.ARK_MODEL || "doubao-seed-1-6-251015", speed: "standard" };
  }
  return {
    provider: String(config.provider_type || "openai"),
    id: String(config.model_name || "model"),
    config_id: String(config.id || ""),
    name: String(config.name || config.model_name || "Model"),
    speed: "standard"
  };
}

function askMapleAgentConfig(workspaceId: string): AgentConfig {
  return createMapleAgentConfig({ model: modelFromWorkspace(workspaceId) }) as AgentConfig;
}

function askMapleEnvironmentConfig() {
  return {
    type: "control_plane",
    sandbox: { provider: "none" },
    networking: { mode: "control_plane_only" },
    metadata: {
      purpose: MAPLE_AGENT_PURPOSE,
      system_environment: true,
      hidden: true
    }
  };
}

function emitEvent(sessionId: string, type: string, payload: JsonRecord, providerEventType?: string | null) {
  const event = createSessionEvent({ session_id: sessionId, type, payload, provider_event_type: providerEventType ?? null });
  emitSessionEvent(event);
  return event;
}

function ensureAskMapleAgent(workspaceId: string) {
  const existing = (listAgents(workspaceId) as JsonRecord[]).find((agent) => asRecord(asRecord(agent.config).metadata).purpose === MAPLE_AGENT_PURPOSE);
  if (existing) return existing;
  return createAgent({ workspace_id: workspaceId, config: askMapleAgentConfig(workspaceId) }) as JsonRecord;
}

function ensureAskMapleEnvironment(workspaceId: string) {
  const existing = (listEnvironments(workspaceId) as JsonRecord[]).find((environment) => asRecord(asRecord(environment.config).metadata).purpose === MAPLE_AGENT_PURPOSE);
  if (existing) return existing;
  return createEnvironment({ workspace_id: workspaceId, name: "ask-maple-session-context-env", config: askMapleEnvironmentConfig() }) as JsonRecord;
}

function activeAskMapleSession(context: AskMapleContext) {
  return (listSessions() as JsonRecord[]).find((session) => {
    const metadata = asRecord(session.metadata);
    return (
      metadata.purpose === MAPLE_AGENT_PURPOSE &&
      metadata.owner_user_id === context.userId &&
      metadata.target_session_id === context.targetSessionId &&
      session.workspace_id === context.workspaceId &&
      session.status !== "terminated"
    );
  }) as JsonRecord | undefined;
}

export function ensureAskMapleSession(context: AskMapleContext) {
  const existing = activeAskMapleSession(context);
  if (existing) return existing;
  return createAskMapleSession(context);
}

export function createAskMapleSession(context: AskMapleContext) {
  const agent = ensureAskMapleAgent(context.workspaceId);
  const environment = ensureAskMapleEnvironment(context.workspaceId);
  const session = createSession({
    workspace_id: context.workspaceId,
    agent_id: String(agent.id),
    environment_id: String(environment.id),
    title: "Ask Maple",
    metadata: {
      purpose: MAPLE_AGENT_PURPOSE,
      hidden: true,
      system_session: true,
      owner_user_id: context.userId,
      target_session_id: context.targetSessionId
    }
  });
  if (session) updateSessionStatus(String(session.id), "idle");
  return getSession(String((session as JsonRecord | null)?.id || ""));
}

function textFromPayload(payload: unknown) {
  const record = asRecord(payload);
  if (typeof record.text === "string") return record.text;
  const content = Array.isArray(record.content) ? record.content : [];
  return content.map((part) => (typeof part === "object" && part !== null ? String((part as { text?: unknown }).text ?? "") : String(part))).filter(Boolean).join("\n");
}

function lastEventType(detail: SessionDetailLike) {
  const events = Array.isArray(detail.events) ? detail.events : [];
  return String(asRecord(events.at(-1)).type || "unknown");
}

function summarizeToolCalls(detail: SessionDetailLike) {
  const toolCalls = Array.isArray(detail.tool_calls) ? detail.tool_calls : [];
  const completed = toolCalls.filter((call) => call.status === "completed").length;
  const failed = toolCalls.filter((call) => call.status !== "completed").length;
  const names = [...new Set(toolCalls.map((call) => String(call.tool_name || call.name || "tool")))].slice(0, 6);
  return { count: toolCalls.length, completed, failed, names };
}

// Deterministic stats about the target session. These are real numbers (not an LLM guess) used
// two ways: surfaced to the client as `stats`, and folded into the context the LLM reasons over.
export function askMapleSessionStats(detail: SessionDetailLike) {
  const events = Array.isArray(detail.events) ? detail.events : [];
  const toolSummary = summarizeToolCalls(detail);
  return {
    events: events.length,
    tool_calls: toolSummary.count,
    completed_tool_calls: toolSummary.completed,
    non_completed_tool_calls: toolSummary.failed
  };
}

// Compact, LLM-facing snapshot of the target session: identity, status, event-type histogram,
// tool-call outcomes, latest user intent. This is the grounding context — the model reasons over
// it instead of us hand-writing the answer.
function targetSessionContext(detail: SessionDetailLike) {
  const session = asRecord(detail.session);
  const agent = asRecord(detail.agent);
  const environment = asRecord(detail.environment);
  const events = Array.isArray(detail.events) ? detail.events : [];
  const eventTypes = new Map<string, number>();
  for (const event of events) eventTypes.set(String(event.type || "unknown"), (eventTypes.get(String(event.type || "unknown")) ?? 0) + 1);
  const toolSummary = summarizeToolCalls(detail);
  const topEvents = [...eventTypes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([type, count]) => `${type}=${count}`);
  const latestUserText = [...events].reverse().map((event) => (event.type === "user.message" ? textFromPayload(event.payload) : "")).find(Boolean) || "";
  return [
    `Session: ${String(session.id || "")} (status=${String(session.status || "unknown")})`,
    `Agent: ${String(agent.name || agent.id || "unknown")} · Environment: ${String(environment.name || environment.id || "unknown")}`,
    `Events: total=${events.length}, last=${lastEventType(detail)}`,
    `Tool calls: total=${toolSummary.count}, completed=${toolSummary.completed}, non_completed=${toolSummary.failed}, tools=${toolSummary.names.join(", ") || "none"}`,
    topEvents.length ? `Event histogram: ${topEvents.join(", ")}` : "Event histogram: (empty)",
    latestUserText ? `Latest user intent: ${latestUserText.slice(0, 400)}` : "Latest user intent: (none yet)"
  ].join("\n");
}

function askMapleMessages(detail: SessionDetailLike, question: string): ChatMessage[] {
  return [
    {
      role: "system",
      content: [
        "You are Maple Session Assistant. Answer the user's question about ONE specific Maple session,",
        "grounded ONLY in the context snapshot below. Explain session state, event history, tool calls,",
        "and next-step diagnostics. Be concise and concrete; cite real numbers/event types from the context.",
        "Do not invent events or tools that are not present. Reply in the user's language.",
        "",
        "=== SESSION CONTEXT ===",
        targetSessionContext(detail)
      ].join("\n")
    },
    { role: "user", content: question }
  ];
}

function shouldUseLocalAnswer(error: unknown) {
  return isLocalDockerMode();
}

function localAskMapleAnswer(detail: SessionDetailLike, question: string) {
  const stats = askMapleSessionStats(detail);
  return [
    "本地 Docker 模式下模型调用不可用，先返回基于事件日志的确定性摘要。",
    `问题: ${question}`,
    `Session 状态: ${String(asRecord(detail.session).status || "unknown")}`,
    `事件数: ${stats.events}，工具调用: ${stats.tool_calls}，完成: ${stats.completed_tool_calls}，未完成: ${stats.non_completed_tool_calls}`,
    targetSessionContext(detail)
  ].join("\n");
}

const ASK_SUGGESTED_ACTIONS = [
  { id: "summarize", label: "总结上下文", question: "总结这个 session 的上下文和当前状态" },
  { id: "tools", label: "解释工具调用", question: "解释这个 session 里工具调用做了什么" },
  { id: "failure", label: "排查失败", question: "如果这个 session 失败了，原因是什么" }
];

// reasoning side-channel, same contract as the builder: accumulated full text, throttled emit,
// `final` closes the thinking block. Hidden from compat clients by shouldHideCompatEvent.
function emitAskReasoning(sessionId: string, text: string, final: boolean) {
  if (!text) return;
  emitEvent(sessionId, final ? "agent.reasoning" : "agent.reasoning_delta", { text }, final ? "reasoning_stop" : null);
}

export async function runAskMapleTurn(context: AskMapleContext, detail: SessionDetailLike, question: string, askSessionIdOverride?: string) {
  const askSession = (askSessionIdOverride ? getSession(askSessionIdOverride) : ensureAskMapleSession(context)) as JsonRecord | null;
  if (!askSession?.id) throw new Error("ask_maple_session_create_failed");
  const askSessionId = String(askSession.id);
  const stats = askMapleSessionStats(detail);
  updateSessionStatus(askSessionId, "running");
  emitEvent(askSessionId, "session.status_running", { reason: "ask_maple.message", target_session_id: context.targetSessionId });
  emitEvent(askSessionId, "user.message", { content: [{ type: "text", text: question }], target_session_id: context.targetSessionId });
  try {
    let reasoningBuf = "";
    let lastReasoningFlush = 0;
    const providerResult = await callProvider(askMapleMessages(detail, question), context.userId, modelFromWorkspace(context.workspaceId).config_id, [], {
      workspaceId: context.workspaceId,
      timeoutMs: askMapleProviderTimeoutMs,
      onReasoningDelta: (chunk) => {
        reasoningBuf += chunk;
        const now = Date.now();
        if (now - lastReasoningFlush >= 400) {
          lastReasoningFlush = now;
          emitAskReasoning(askSessionId, reasoningBuf, false);
        }
      }
    });
    emitAskReasoning(askSessionId, reasoningBuf, true);
    if (providerResult.type !== "message") throw new Error("ask_maple_unexpected_tool_calls");
    const answer = providerResult.content.trim();
    emitEvent(askSessionId, "ui.card", { card_type: "ask_maple_answer", target_session_id: context.targetSessionId, answer, suggested_actions: ASK_SUGGESTED_ACTIONS, stats }, "ask_maple_answer");
    emitEvent(askSessionId, "agent.message", { content: [{ type: "text", text: answer }], usage: providerResult.usage ?? {} }, "message_stop");
    updateSessionStatus(askSessionId, "idle");
    emitEvent(askSessionId, "session.status_idle", { reason: "ask_maple.answer_ready", stop_reason: { type: "end_turn" } });
    return { answer, suggested_actions: ASK_SUGGESTED_ACTIONS, stats, ask_session: getSession(askSessionId), events: listSessionEvents(askSessionId) };
  } catch (error) {
    if (shouldUseLocalAnswer(error)) {
      const answer = localAskMapleAnswer(detail, question);
      emitAskReasoning(askSessionId, "模型调用不可用，使用本地 session 事件生成摘要。", true);
      emitEvent(askSessionId, "ui.card", { card_type: "ask_maple_answer", target_session_id: context.targetSessionId, answer, suggested_actions: ASK_SUGGESTED_ACTIONS, stats }, "ask_maple_answer");
      emitEvent(askSessionId, "agent.message", { content: [{ type: "text", text: answer }], usage: { provider_error: error instanceof Error ? error.message : String(error), local_fallback: true } }, "message_stop");
      updateSessionStatus(askSessionId, "idle");
      emitEvent(askSessionId, "session.status_idle", { reason: "ask_maple.local_answer", stop_reason: { type: "end_turn" } });
      return { answer, suggested_actions: ASK_SUGGESTED_ACTIONS, stats, ask_session: getSession(askSessionId), events: listSessionEvents(askSessionId) };
    }
    updateSessionStatus(askSessionId, "failed");
    emitEvent(askSessionId, "session.status_failed", { reason: "ask_maple_failed", error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

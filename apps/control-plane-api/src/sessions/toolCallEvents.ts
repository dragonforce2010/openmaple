import type { JsonRecord, SessionEvent } from "../types";

type ToolCallLike = JsonRecord & {
  id: string;
  session_id: string;
  thread_id: string | null;
  event_id: string | null;
  tool_name: string;
  input: JsonRecord;
  output: unknown;
  status: string;
  permission_policy: string;
  created_at: string;
  completed_at?: string | null;
};

export function mergeToolCallsFromEvents(sessionId: string, stored: JsonRecord[], events: SessionEvent[]) {
  const byId = new Map<string, ToolCallLike>();
  for (const call of stored) {
    const id = stringValue(call.id);
    if (!id) continue;
    byId.set(id, normalizeStoredCall(call, id));
  }
  for (const derived of deriveToolCallsFromEvents(sessionId, events)) {
    const existing = byId.get(derived.id);
    byId.set(derived.id, existing ? mergeCall(existing, derived) : derived);
  }
  return Array.from(byId.values()).sort((left, right) => String(left.created_at).localeCompare(String(right.created_at)));
}

export function deriveToolCallsFromEvents(sessionId: string, events: SessionEvent[]) {
  const results = new Map<string, SessionEvent>();
  for (const event of events) {
    if (!isToolResultEvent(event)) continue;
    const id = toolEventId(event.payload);
    if (id && !results.has(id)) results.set(id, event);
  }
  return events.filter(isToolUseEvent).flatMap((event) => {
    const id = toolEventId(event.payload);
    return id ? [toolCallFromEvent(sessionId, event, results.get(id))] : [];
  });
}

function toolCallFromEvent(sessionId: string, event: SessionEvent, result?: SessionEvent): ToolCallLike {
  const payload = event.payload;
  const resultPayload = record(result?.payload);
  const output = result ? resultPayload.output ?? resultPayload.result ?? resultPayload.content ?? null : null;
  const status = result ? toolResultStatus(resultPayload, output) : "running";
  return {
    id: toolEventId(payload),
    session_id: sessionId,
    thread_id: event.thread_id,
    event_id: event.id,
    tool_name: stringValue(payload.name || payload.tool || "tool"),
    input: record(payload.input || payload.arguments),
    output,
    status,
    permission_policy: stringValue(payload.permission_policy) || "allow",
    created_at: event.created_at,
    completed_at: result?.created_at ?? null,
    source: "session_events"
  };
}

function mergeCall(existing: ToolCallLike, derived: ToolCallLike): ToolCallLike {
  return {
    ...derived,
    ...existing,
    output: existing.output ?? derived.output,
    status: existing.status === "running" && derived.status !== "running" ? derived.status : existing.status,
    completed_at: existing.completed_at ?? derived.completed_at,
    source: existing.source || derived.source
  };
}

function normalizeStoredCall(call: JsonRecord, id: string): ToolCallLike {
  return {
    ...call,
    id,
    session_id: stringValue(call.session_id),
    thread_id: call.thread_id == null ? null : stringValue(call.thread_id),
    event_id: call.event_id == null ? null : stringValue(call.event_id),
    tool_name: stringValue(call.tool_name || call.name || "tool"),
    input: record(call.input),
    output: call.output ?? null,
    status: stringValue(call.status) || "running",
    permission_policy: stringValue(call.permission_policy) || "allow",
    created_at: stringValue(call.created_at),
    completed_at: call.completed_at == null ? null : stringValue(call.completed_at)
  };
}

function toolResultStatus(payload: JsonRecord, output: unknown) {
  const explicit = stringValue(payload.status);
  if (explicit) return explicit;
  return record(output).error ? "failed" : "completed";
}

function toolEventId(payload: JsonRecord) {
  return stringValue(payload.id || payload.tool_use_id || payload.custom_tool_use_id);
}

function isToolUseEvent(event: SessionEvent) {
  return event.type === "agent.tool_use" || event.type === "agent.custom_tool_use" || event.provider_event_type === "tool_use";
}

function isToolResultEvent(event: SessionEvent) {
  return event.type === "tool.result" || event.type === "tool_result" || event.type === "user.tool_result" || event.type === "user.custom_tool_result" || event.provider_event_type === "tool_result";
}

function stringValue(value: unknown) {
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

function record(value: unknown): JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as JsonRecord) : {};
}

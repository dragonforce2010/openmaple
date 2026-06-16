import type { JsonRecord, SessionEvent, ToolCall } from "../types";

export function mergeEventDerivedToolCalls(sessionId: string, stored: ToolCall[], events: SessionEvent[]) {
  const byId = new Map<string, ToolCall>();
  for (const call of stored) byId.set(call.id, call);
  for (const derived of deriveToolCalls(sessionId, events)) {
    const existing = byId.get(derived.id);
    byId.set(derived.id, existing ? mergeCall(existing, derived) : derived);
  }
  return Array.from(byId.values()).sort((left, right) => left.created_at.localeCompare(right.created_at));
}

function deriveToolCalls(sessionId: string, events: SessionEvent[]) {
  const results = new Map<string, SessionEvent>();
  for (const event of events) {
    if (!isToolResultEvent(event)) continue;
    const id = toolEventId(record(event.payload));
    if (id && !results.has(id)) results.set(id, event);
  }
  return events.filter(isToolUseEvent).flatMap((event) => {
    const id = toolEventId(record(event.payload));
    return id ? [callFromEvent(sessionId, event, results.get(id))] : [];
  });
}

function callFromEvent(sessionId: string, event: SessionEvent, result?: SessionEvent): ToolCall {
  const payload = record(event.payload);
  const resultPayload = record(result?.payload);
  const output = result ? resultPayload.output ?? resultPayload.result ?? resultPayload.content ?? null : null;
  return {
    id: toolEventId(payload),
    session_id: sessionId,
    thread_id: event.thread_id,
    event_id: event.id,
    tool_name: stringValue(payload.name || payload.tool || "tool"),
    input: record(payload.input || payload.arguments),
    output,
    status: result ? toolResultStatus(resultPayload, output) : "running",
    permission_policy: stringValue(payload.permission_policy) || "allow",
    created_at: event.created_at,
    completed_at: result?.created_at ?? null
  };
}

function mergeCall(existing: ToolCall, derived: ToolCall): ToolCall {
  return {
    ...derived,
    ...existing,
    output: existing.output ?? derived.output,
    status: existing.status === "running" && derived.status !== "running" ? derived.status : existing.status,
    completed_at: existing.completed_at ?? derived.completed_at
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

import type { SessionDetail, SessionEvent, ToolCall } from "../../types";

// Deterministic visualizations of the target session (event histogram, tool table, link/image
// references) shown alongside the streamed Maple conversation. The natural-language answer now
// comes from the real LLM turn (ask session SSE), not from here.
export function buildSessionAnalysis(detail: SessionDetail | null, _question: string) {
  if (!detail) return { eventCounts: [], toolRows: [], references: [] };
  const eventCountMap = new Map<string, number>();
  for (const event of detail.events) eventCountMap.set(event.type, (eventCountMap.get(event.type) ?? 0) + 1);
  const maxCount = Math.max(1, ...eventCountMap.values());
  const eventCounts = [...eventCountMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([type, count]) => ({ type, count, percent: Math.max(8, Math.round((count / maxCount) * 100)) }));
  return {
    eventCounts,
    toolRows: detail.tool_calls.slice(0, 10).map(toolCallRow),
    references: extractRichReferences(detail).slice(0, 8)
  };
}

export function toolCallRow(call: ToolCall) {
  const started = Date.parse(call.created_at);
  const ended = call.completed_at ? Date.parse(call.completed_at) : NaN;
  return {
    id: call.id,
    name: call.tool_name,
    status: call.status,
    latency: Number.isFinite(started) && Number.isFinite(ended) ? `${Math.max(0, ended - started)}ms` : "-",
    input: call.input,
    output: call.output,
    eventId: call.event_id
  };
}

export function extractRichReferences(detail: SessionDetail) {
  const raw = JSON.stringify({ events: detail.events.map((event) => event.payload), tool_calls: detail.tool_calls.map((call) => call.output) });
  const urls = [...raw.matchAll(/https?:\/\/[^\s"'<>\\)]+/g)].map((match) => match[0]);
  return [...new Set(urls)].map((url) => ({
    url,
    kind: /\.(png|jpe?g|gif|webp|svg)(\?|$)/i.test(url) ? "image" : "link"
  }));
}

export function EventBars({ events }: { events: SessionEvent[] }) {
  return (
    <div className="event-bars">
      {events.slice(0, 16).map((event) => <span className={event.type.includes("tool") ? "tool" : event.type.includes("failed") ? "error" : "agent"} key={event.id} />)}
    </div>
  );
}

import type { ReactNode } from "react";
import type { JsonRecord, SessionEvent } from "../../types";

export function eventRole(type: string, event?: SessionEvent) {
  if (event) {
    const loopView = externalLoopView(event);
    if (loopView) return loopView.role;
  }
  if (type.includes("tool")) return "Tool";
  if (type.startsWith("user.")) return "User";
  if (type.startsWith("agent.")) return "Agent";
  if (type.includes("session")) return "Session";
  return "Event";
}

export function eventTitle(event: SessionEvent) {
  const loopView = externalLoopView(event);
  if (loopView) return loopView.title;
  if (event.type === "user.message") return textFromPayload(event.payload) || "Message";
  if (event.type === "agent.message_delta") return textFromPayload(event.payload) || "Message";
  if (event.type === "agent.message") return textFromPayload(event.payload) || "Message";
  if (event.type === "agent.tool_use") return `${String(event.payload.name ?? "tool")} call`;
  if (event.type === "tool.result") return `${String(event.payload.name ?? "tool")} result`;
  if (event.type === "session.status_preparing_runtime") return "preparing runtime";
  return event.type;
}

export function renderEventContent(event: SessionEvent) {
  const loopView = externalLoopView(event);
  if (loopView) return loopView.body;
  const text = textFromPayload(event.payload);
  if (text) return text;
  return JSON.stringify(event.payload, null, 2);
}

type ExternalLoopView = {
  role: "Agent" | "Tool" | "Event";
  title: string;
  body: string;
  // true for loop internals (init/result echoes) that only belong in Debug mode
  debugOnly: boolean;
};

// Unwraps agent.external_loop_event into the transcript-facing pieces: tool calls,
// tool results, and intermediate assistant text from the claude-code loop stream.
export function externalLoopView(event: SessionEvent): ExternalLoopView | null {
  if (event.type !== "agent.external_loop_event") return null;
  const inner = recordFromUnknown(event.payload.event);
  const innerType = String(inner.type || "");
  const message = recordFromUnknown(inner.message);
  const content = Array.isArray(message.content) ? (message.content as unknown[]).map(recordFromUnknown) : [];

  if (innerType === "assistant") {
    const toolUse = content.find((item) => item.type === "tool_use");
    if (toolUse) {
      const name = String(toolUse.name ?? "tool");
      return { role: "Tool", title: `${name} call`, body: stringifyCompact(toolUse.input), debugOnly: false };
    }
    const text = blocksText(content);
    if (text) return { role: "Agent", title: text, body: text, debugOnly: false };
    return { role: "Agent", title: "assistant", body: stringifyCompact(inner), debugOnly: true };
  }
  if (innerType === "user") {
    const toolResult = content.find((item) => item.type === "tool_result");
    if (toolResult) {
      const body = blocksText(Array.isArray(toolResult.content) ? (toolResult.content as unknown[]).map(recordFromUnknown) : []) || stringifyCompact(toolResult.content);
      return { role: "Tool", title: toolResult.is_error ? "tool result (error)" : "tool result", body, debugOnly: false };
    }
    const text = blocksText(content) || (typeof message.content === "string" ? message.content : "");
    return { role: "Event", title: text || "user", body: text || stringifyCompact(inner), debugOnly: true };
  }
  if (innerType === "result") {
    const text = typeof inner.result === "string" ? inner.result : stringifyCompact(inner);
    return { role: "Agent", title: "loop result", body: text, debugOnly: true };
  }
  return { role: "Event", title: `loop ${innerType || "event"}`, body: stringifyCompact(inner), debugOnly: true };
}

function blocksText(blocks: JsonRecord[]) {
  return blocks
    .filter((item) => item.type === "text" || typeof item.text === "string")
    .map((item) => String(item.text ?? ""))
    .join("\n")
    .trim();
}

function stringifyCompact(value: unknown) {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value ?? {}, null, 2);
  } catch {
    return String(value);
  }
}

function inlineMarkdown(text: string, keyPrefix: string) {
  const nodes: ReactNode[] = [];
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let cursor = 0;
  let index = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index == null) continue;
    if (match.index > cursor) nodes.push(text.slice(cursor, match.index));
    const token = match[0];
    const key = `${keyPrefix}-${index}`;
    if (token.startsWith("**")) nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    else nodes.push(<code key={key}>{token.slice(1, -1)}</code>);
    cursor = match.index + token.length;
    index += 1;
  }
  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes;
}

export function MarkdownText({ text }: { text: string }) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }
    if (line.trimStart().startsWith("```")) {
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index].trimStart().startsWith("```")) {
        code.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push(<pre key={`code-${index}`}><code>{code.join("\n")}</code></pre>);
      continue;
    }
    if (/^\s*[-*]\s+/.test(line)) {
      const items: ReactNode[] = [];
      while (index < lines.length && /^\s*[-*]\s+/.test(lines[index])) {
        const value = lines[index].replace(/^\s*[-*]\s+/, "");
        items.push(<li key={`li-${index}`}>{inlineMarkdown(value, `uli-${index}`)}</li>);
        index += 1;
      }
      blocks.push(<ul key={`ul-${index}`}>{items}</ul>);
      continue;
    }
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: ReactNode[] = [];
      while (index < lines.length && /^\s*\d+\.\s+/.test(lines[index])) {
        const value = lines[index].replace(/^\s*\d+\.\s+/, "");
        items.push(<li key={`oli-${index}`}>{inlineMarkdown(value, `oli-${index}`)}</li>);
        index += 1;
      }
      blocks.push(<ol key={`ol-${index}`}>{items}</ol>);
      continue;
    }
    const paragraph: string[] = [];
    while (
      index < lines.length &&
      lines[index].trim() &&
      !lines[index].trimStart().startsWith("```") &&
      !/^\s*[-*]\s+/.test(lines[index]) &&
      !/^\s*\d+\.\s+/.test(lines[index])
    ) {
      paragraph.push(lines[index]);
      index += 1;
    }
    blocks.push(<p key={`p-${index}`}>{inlineMarkdown(paragraph.join("\n"), `p-${index}`)}</p>);
  }
  return <div className="md">{blocks.length ? blocks : <p>{text}</p>}</div>;
}

export function textFromPayload(payload: JsonRecord) {
  if (typeof payload.text === "string") return payload.text;
  const content = payload.content;
  if (Array.isArray(content)) return content.map((item) => typeof item === "object" && item ? String((item as JsonRecord).text ?? "") : String(item)).join("\n").trim();
  if (typeof content === "string") return content;
  return "";
}

export function recordFromUnknown(value: unknown): JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as JsonRecord) : {};
}

// Collapse a delta/final event pair to a single rendered row: keep only the latest still-open
// delta, and drop it if a matching final event already carries the same text. Works for both
// message (agent.message_delta → agent.message) and reasoning (agent.reasoning_delta →
// agent.reasoning), which share the same streaming shape.
function dedupeDeltaPair(events: SessionEvent[], deltaType: string, finalType: string) {
  const finalTexts = new Set(
    events.filter((event) => event.type === finalType).map((event) => textFromPayload(event.payload).trim()).filter(Boolean)
  );
  let latestOpenDeltaIndex = -1;
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (events[index].type === finalType) break;
    if (events[index].type !== deltaType) continue;
    latestOpenDeltaIndex = index;
    break;
  }
  return (event: SessionEvent, index: number) => {
    if (event.type !== deltaType) return true;
    const text = textFromPayload(event.payload).trim();
    if (index !== latestOpenDeltaIndex) return false;
    return !text || !finalTexts.has(text);
  };
}

export function dedupeTranscriptEvents(events: SessionEvent[]) {
  const keepMessage = dedupeDeltaPair(events, "agent.message_delta", "agent.message");
  const keepReasoning = dedupeDeltaPair(events, "agent.reasoning_delta", "agent.reasoning");
  return events.filter((event, index) => keepMessage(event, index) && keepReasoning(event, index));
}

// The vefaas / external agent loop double-writes the final assistant text: once as a streamed
// agent.external_loop_event (driver echo) and once as the terminal agent.message (which carries
// usage). In the Transcript view that surfaces the reply twice. This predicate flags an
// external_loop_event whose assistant text equals a terminal agent.message — callers drop it from
// Transcript only, so the Debug view keeps the full raw loop stream. Tool rows are untouched.
export function isExternalLoopAgentEcho(event: SessionEvent, events: SessionEvent[]) {
  const loopView = externalLoopView(event);
  if (!loopView || loopView.role !== "Agent") return false;
  const body = loopView.body.trim();
  if (!body) return false;
  return events.some((other) => other.type === "agent.message" && textFromPayload(other.payload).trim() === body);
}

const TRANSCRIPT_TYPES = ["user.message", "agent.message", "agent.message_delta", "agent.reasoning", "agent.reasoning_delta"];

export type TranscriptMessage = {
  id: string;
  kind: "user" | "agent" | "reasoning";
  text: string;
  usage: ReturnType<typeof eventUsage>;
  final?: boolean;
};

// Unified, time-ordered stream of bubbles. reasoning rows are emitted in place (they land in
// the event log before their answer, so they sort ahead of the agent bubble they precede) and
// flagged final once the terminal agent.reasoning event has arrived.
export function transcriptMessagesFromEvents(events: SessionEvent[]): TranscriptMessage[] {
  return dedupeTranscriptEvents(events)
    .filter((event) => TRANSCRIPT_TYPES.includes(event.type))
    .map((event) => {
      const kind = event.type === "user.message" ? "user" : event.type.startsWith("agent.reasoning") ? "reasoning" : "agent";
      return {
        id: event.id,
        kind: kind as TranscriptMessage["kind"],
        text: textFromPayload(event.payload),
        usage: eventUsage(event),
        final: event.type === "agent.reasoning" ? true : event.type === "agent.reasoning_delta" ? false : undefined
      };
    })
    .filter((message) => message.text);
}

export function eventUsage(event: SessionEvent) {
  const usage = recordFromUnknown(event.payload.usage);
  const input = numberFromUsage(usage, ["input_tokens", "prompt_tokens", "cache_read_input_tokens"]);
  const output = numberFromUsage(usage, ["output_tokens", "completion_tokens"]);
  return input || output ? { input, output } : null;
}

export function eventUsageLabel(event: SessionEvent) {
  if (eventRole(event.type) !== "Agent") return "";
  const usage = eventUsage(event);
  if (!usage) return "";
  return `${formatTokenCount(usage.input)} / ${formatTokenCount(usage.output)}`;
}

export function numberFromUsage(usage: JsonRecord, keys: string[]) {
  for (const key of keys) {
    const value = usage[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return 0;
}

export function formatTokenCount(value: number) {
  if (!value) return "0";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}m`;
  if (value >= 1000) return `${(value / 1000).toFixed(value >= 10_000 ? 0 : 1)}k`;
  return String(value);
}

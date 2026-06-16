import type { AgentConfig, JsonRecord } from "../types";
import { agentLoopSystemPreamble, normalizeAgentLoop } from "./agentLoops";
import type { ChatContentPart, ChatMessage } from "./provider";

export function eventText(payload: JsonRecord) {
  const content = payload.content;
  if (Array.isArray(content)) {
    return content
      .map((block) => (typeof block === "object" && block !== null && "text" in block ? String((block as JsonRecord).text ?? "") : String(block ?? "")))
      .join("");
  }
  if (typeof content === "string") return content;
  if (payload.result) return typeof payload.result === "string" ? payload.result : JSON.stringify(payload.result);
  return JSON.stringify(payload);
}

export function parseScriptedToolRequests(text: string): Array<{ name: string; input: JsonRecord }> {
  const calls: Array<{ name: string; input: JsonRecord }> = [];
  const writeMatch = text.match(/write_file.*?create\s+([^\s,]+)\s+with content\s+(.+?)(?:,\s*then|\s+then|$)/i);
  if (writeMatch) calls.push({ name: "write_file", input: { path: writeMatch[1], content: writeMatch[2].trim().replace(/\.$/, "") } });
  const listMatch = text.match(/list_files\s+(?:on|in)\s+([^\s,.]+)/i);
  if (listMatch) calls.push({ name: "list_files", input: { path: listMatch[1] } });
  return calls;
}

export function runtimeMessageContent(result: JsonRecord) {
  const message = result.message;
  if (typeof message === "string") return message;
  if (message && typeof message === "object" && !Array.isArray(message)) {
    const record = message as JsonRecord;
    if (typeof record.content === "string") return record.content;
    const content = record.content;
    if (Array.isArray(content)) {
      return content
        .map((item) => (typeof item === "string" ? item : typeof item === "object" && item !== null ? String((item as JsonRecord).text || "") : ""))
        .filter(Boolean)
        .join("\n");
    }
  }
  if (typeof result.text === "string") return result.text;
  return JSON.stringify(result);
}

export function buildMessages(agent: AgentConfig, userText: string | ChatContentPart[]): ChatMessage[] {
  const loop = normalizeAgentLoop(agent.agent_loop);
  const textForLanguage = typeof userText === "string" ? userText : userText.map((part) => (part.type === "text" ? part.text : "")).join("\n");
  const languageInstruction = /[\u3400-\u9fff]/.test(textForLanguage)
    ? "Respond in Simplified Chinese unless the user explicitly requests another language."
    : "Respond in the same language as the user's latest message.";
  return [
    {
      role: "system",
      content: [
        agent.system,
        "",
        agentLoopSystemPreamble(loop),
        "",
        "You are executing inside a real local managed-agent session.",
        "The session owns an isolated workspace mounted at /workspace or the configured sandbox workspace. Use tools for filesystem, shell, and memory actions.",
        "Do not claim that you created, read, searched, or modified anything unless a tool result proves it.",
        "Prefer the narrowest tool needed. Keep final answers concise and include real file paths or command outputs when relevant.",
        languageInstruction
      ].join("\n")
    },
    {
      role: "user",
      content: userText
    }
  ];
}

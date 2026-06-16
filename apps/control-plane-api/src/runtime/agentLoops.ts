import type { AgentLoopConfig, AgentLoopType, JsonRecord } from "../types";

export const agentLoopTypes = ["anthropic_claude_code", "codex_open_source"] as const satisfies readonly AgentLoopType[];

export const defaultAgentLoop: AgentLoopConfig = {
  type: "anthropic_claude_code",
  config: {},
  hooks: []
};

export function isAgentLoopType(value: unknown): value is AgentLoopType {
  return typeof value === "string" && (agentLoopTypes as readonly string[]).includes(value);
}

export function normalizeAgentLoop(value: unknown): AgentLoopConfig {
  if (!value || typeof value !== "object") return { ...defaultAgentLoop };
  const record = value as JsonRecord;
  const type = isAgentLoopType(record.type) ? record.type : defaultAgentLoop.type;
  return {
    type,
    config: record.config && typeof record.config === "object" && !Array.isArray(record.config) ? (record.config as JsonRecord) : {},
    hooks: Array.isArray(record.hooks) ? record.hooks.filter((hook): hook is JsonRecord => Boolean(hook) && typeof hook === "object" && !Array.isArray(hook)) : []
  };
}

export function agentLoopRuntimeLabel(loop: AgentLoopConfig) {
  if (loop.type === "codex_open_source") return "Codex open-source loop";
  return "Maple Code loop";
}

export function agentLoopSystemPreamble(loop: AgentLoopConfig) {
  if (loop.type === "codex_open_source") {
    return [
      "AgentLoop: codex_open_source.",
      "Follow Codex-style repo automation: inspect files first, make tool-backed changes only inside the session workspace, and report concrete command output."
    ].join("\n");
  }
  return [
    "AgentLoop: anthropic_claude_code.",
    "Follow Maple Code-style managed agent behavior: plan briefly, use tool evidence for filesystem claims, and keep user-facing results concise."
  ].join("\n");
}

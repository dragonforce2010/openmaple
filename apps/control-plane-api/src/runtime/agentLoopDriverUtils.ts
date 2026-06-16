import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import type { AgentConfig, JsonRecord } from "../types";
import { normalizeAgentLoop } from "./agentLoops";

export function claudeInitPayload(agent: AgentConfig, cwd: string, env: NodeJS.ProcessEnv, systemPrompt: string) {
  const loop = normalizeAgentLoop(agent.agent_loop);
  const config = asRecord(loop.config);
  return {
    cwd,
    env: { ...claudeRuntimeAuthEnv(env), ...stringRecord(asRecord(config.env)) },
    cli_path: config.cli_path || process.env.MAPLE_CLAUDE_CODE_COMMAND || undefined,
    model: config.model || agent.model?.id || process.env.MAPLE_CLAUDE_CODE_MODEL || undefined,
    system_prompt: systemPrompt,
    output_format: config.output_format || "stream-json",
    permission_mode: config.permission_mode || process.env.MAPLE_CLAUDE_CODE_PERMISSION_MODE || "bypassPermissions",
    tools: config.tools,
    allowed_tools: config.allowed_tools || [],
    disallowed_tools: config.disallowed_tools || [],
    mcp_servers: normalizeMcpServers(agent.mcp_servers),
    max_turns: config.max_turns,
    continue_conversation: config.continue_conversation ?? true,
    resume: config.resume,
    fork_session: config.fork_session ?? false,
    add_dirs: config.add_dirs || [],
    extra_args: asRecord(config.extra_args)
  };
}

export function claudeRuntimeAuthEnv(source: NodeJS.ProcessEnv | Record<string, unknown> = process.env): Record<string, string> {
  const envs = pickEnv(source, [
    "IS_SANDBOX",
    "ANTHROPIC_BASE_URL",
    "ANTHROPIC_MODEL",
    "ANTHROPIC_AUTH_TOKEN",
    "ANTHROPIC_API_KEY",
    "ARK_API_KEY",
    "MAPLE_CLAUDE_CODE_MODEL"
  ]);
  const authToken = envs.ANTHROPIC_AUTH_TOKEN || envs.ANTHROPIC_API_KEY || envs.ARK_API_KEY;
  return {
    IS_SANDBOX: envs.IS_SANDBOX || "1",
    ANTHROPIC_BASE_URL: envs.ANTHROPIC_BASE_URL || "https://ark.cn-beijing.volces.com/api/coding",
    ANTHROPIC_MODEL: envs.ANTHROPIC_MODEL || envs.MAPLE_CLAUDE_CODE_MODEL || "glm-4-7-251222",
    ...(authToken ? { ANTHROPIC_AUTH_TOKEN: authToken } : {}),
    ...envs
  };
}

export function normalizeMcpServers(value: unknown) {
  if (!Array.isArray(value)) return {};
  const entries = value
    .map((item) => asRecord(item))
    .filter((item) => item.name || item.id)
    .map((item) => [String(item.name || item.id), item.config ?? item]);
  return Object.fromEntries(entries);
}

export function messageFromClaudeOutput(parsed: unknown, stdout: string) {
  const record = asRecord(parsed);
  const result = record.result;
  if (typeof result === "string") return result.trim();
  const message = asRecord(record.message);
  const content = message.content ?? record.content ?? record.text;
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((item) => (typeof item === "string" ? item : typeof item === "object" && item !== null ? String((item as JsonRecord).text || "") : ""))
      .filter(Boolean)
      .join("\n")
      .trim();
  }
  return stdout.trim();
}

export function usageFromClaudeOutput(parsed: unknown) {
  const record = asRecord(parsed);
  return asRecord(record.usage || record.total_usage || {});
}

export function messageFromClaudeEvents(events: JsonRecord[]) {
  const result = [...events].reverse().find((event) => event.type === "result");
  const resultText = textFromEvent(result);
  if (resultText) return resultText;
  return events.map(textFromEvent).filter(Boolean).join("\n").trim();
}

export function usageFromClaudeEvents(events: JsonRecord[]) {
  const result = [...events].reverse().find((event) => event.type === "result");
  return asRecord(result?.usage || result?.total_usage || {});
}

export function textFromEvent(event: JsonRecord | undefined) {
  if (!event) return "";
  if (typeof event.result === "string") return event.result.trim();
  if (typeof event.text === "string") return event.text.trim();
  const message = asRecord(event.message);
  const content = message.content ?? event.content;
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((item) => (typeof item === "string" ? item : typeof item === "object" && item !== null ? String((item as JsonRecord).text || "") : ""))
      .filter(Boolean)
      .join("\n")
      .trim();
  }
  return "";
}

export function parseJson(value: string) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export function optionalPair(flag: string, value: unknown) {
  const text = typeof value === "string" ? value.trim() : "";
  return text ? [flag, text] : [];
}

export function stringArray(value: unknown) {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
}

export function numberConfig(value: unknown, fallback: unknown, defaultValue: number) {
  const number = Number(value || fallback || defaultValue);
  return Number.isFinite(number) && number > 0 ? number : defaultValue;
}

export function truthy(value: unknown) {
  return ["1", "true", "yes", "on"].includes(String(value || "").toLowerCase());
}

export function asRecord(value: unknown): JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as JsonRecord) : {};
}

export function stringRecord(value: JsonRecord): Record<string, string> {
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, String(item)]));
}

function pickEnv(source: NodeJS.ProcessEnv | Record<string, unknown>, keys: string[]) {
  const envs: Record<string, string> = {};
  for (const key of keys) {
    const value = source[key];
    if (value !== undefined && value !== null && String(value)) envs[key] = String(value);
  }
  return envs;
}

export function pathCandidates(name: string) {
  return String(process.env.PATH || "")
    .split(delimiter)
    .filter(Boolean)
    .map((dir) => join(dir, name))
    .filter((path) => existsSync(path));
}

export function nvmCodexCandidates() {
  const root = join(homedir(), ".nvm", "versions", "node");
  if (!existsSync(root)) return [];
  return readdirSync(root)
    .map((version) => join(root, version, "bin", "codex"))
    .filter((path) => existsSync(path));
}

export function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

export function splitCommand(value: string) {
  const matches = value.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g);
  return [...matches].map((match) => match[1] ?? match[2] ?? match[3]).filter(Boolean);
}

export function truncate(value: string, max = 4000) {
  return value.length > max ? `${value.slice(0, max)}...<truncated ${value.length - max} chars>` : value;
}

export function redactPromptArg(args: string[]) {
  if (!args.length) return args;
  return args.map((arg, index) => (index === args.length - 1 && arg.length > 200 ? `${arg.slice(0, 200)}...<prompt>` : arg));
}

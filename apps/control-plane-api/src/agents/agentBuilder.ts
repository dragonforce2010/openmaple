import { defaultAgentLoop, isAgentLoopType, normalizeAgentLoop } from "../agentLoops";
import { selectModelForPrompt, type ModelSelection } from "../modelGateway";
import { callProviderText } from "../provider";
import { isLocalDockerMode } from "../runtime/localDockerMode";
import type { AgentConfig, AgentLoopType } from "../types";

// A single draft is one large generation (full agent config). 8s was too tight for
// doubao to emit the config and made the Quickstart builder turn fail with a provider
// timeout; give it room. Still bounded so a stuck call can't hang the background turn.
const agentDraftTimeoutMs = Number(process.env.MAPLE_AGENT_DRAFT_TIMEOUT_MS || 60_000);

export async function buildAgentDraft(
  prompt: string,
  userId?: string,
  modelConfigId?: string | null,
  agentLoopType?: AgentLoopType,
  workspaceId?: string | null
): Promise<AgentConfig> {
  const selectedModel = userId ? selectModelForPrompt({ userId, prompt, modelConfigId, workspaceId }) : undefined;
  const loopType = isAgentLoopType(agentLoopType) ? agentLoopType : defaultAgentLoop.type;
  const messages = [
    {
      role: "system" as const,
      content: [
        "You generate production managed-agent configurations.",
        "Return only JSON. Do not include markdown fences.",
        "Schema: { name, description, model:{provider,id,speed}, agent_loop:{type,config?,hooks?}, system, tools, mcp_servers, skills, multiagent?, metadata? }.",
        "The system prompt, description, tools, skills, MCP servers, and multiagent plan must be reasoned from the user intent. Do not paste a generic template or merely restate the user request.",
        "Write a polished, production-ready system prompt that states role, operating constraints, tool policy, output expectations, and confirmation boundaries for the specific agent.",
        "Use OpenAI-compatible local runtime tools when useful: bash, read_file, write_file, list_files, grep, memory_search, memory_write.",
        "Use mcp_servers for external systems explicitly requested by the user. For preset providers always include the provider key so the platform can attach the connected OAuth credential, e.g. GitHub: {name:'github', provider:'github', url:'https://api.githubcopilot.com/mcp/', type:'url'}; Notion: {name:'notion', provider:'notion', url:'https://mcp.notion.com/mcp', type:'url'}.",
        `Set agent_loop.type exactly to ${loopType}.`,
        selectedModel ? `Set model exactly to provider ${selectedModel.provider}, id ${selectedModel.model}, config_id ${selectedModel.configId || ""}.` : "Default model should use the platform default OpenAI-compatible provider."
      ].join("\n")
    },
    { role: "user" as const, content: prompt }
  ];
  let raw = "";
  try {
    raw = await callProviderText(messages, { temperature: 0.1, max_tokens: 1400, userId, modelConfigId: selectedModel?.configId, workspaceId, timeoutMs: agentDraftTimeoutMs });
  } catch (error) {
    if (shouldFallbackAgentDraft(error, modelConfigId)) return fallbackAgentDraft(prompt, selectedModel, loopType, "", error);
    throw error;
  }
  try {
    return normalizeProviderAgentDraft(raw, prompt, selectedModel, loopType);
  } catch (error) {
    return fallbackAgentDraft(prompt, selectedModel, loopType, raw, error);
  }
}

function isProviderTimeout(error: unknown) {
  return /timeout|timed out|aborted/i.test(error instanceof Error ? error.message : String(error));
}

function shouldFallbackAgentDraft(error: unknown, explicitModelConfigId?: string | null) {
  if (isProviderTimeout(error)) return true;
  if (explicitModelConfigId || !isLocalDockerMode()) return false;
  return true;
}

export function buildLocalAgentDraft(
  prompt: string,
  userId?: string,
  modelConfigId?: string | null,
  agentLoopType?: AgentLoopType,
  workspaceId?: string | null
): AgentConfig {
  const selectedModel = userId ? selectModelForPrompt({ userId, prompt, modelConfigId, workspaceId }) : undefined;
  const loopType = isAgentLoopType(agentLoopType) ? agentLoopType : defaultAgentLoop.type;
  return fallbackAgentDraft(prompt, selectedModel, loopType, "", new Error("provider_timeout"));
}

export function normalizeProviderAgentDraft(raw: string, prompt: string, selectedModel?: ModelSelection, agentLoopType: AgentLoopType = defaultAgentLoop.type): AgentConfig {
  return normalizeAgentConfig(parseJsonObject(raw), prompt, selectedModel, agentLoopType);
}

function parseJsonObject(raw: string) {
  const cleaned = raw.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error(`Provider did not return JSON: ${raw.slice(0, 240)}`);
  return JSON.parse(cleaned.slice(start, end + 1)) as Partial<AgentConfig>;
}

function normalizeAgentConfig(value: Partial<AgentConfig>, prompt: string, selectedModel?: ModelSelection, agentLoopType?: AgentLoopType): AgentConfig {
  const model = requireRecord(value.model, "model");
  const agentLoop = requireRecord(value.agent_loop, "agent_loop");
  const loopType = requiredString(agentLoop.type, "agent_loop.type");
  if (!isAgentLoopType(loopType) || loopType !== agentLoopType) {
    throw new Error(`Provider draft field agent_loop.type must be ${agentLoopType}.`);
  }
  const normalizedModel = selectedModel
    ? {
        provider: selectedModel.provider,
        id: selectedModel.model,
        speed: optionalString(model.speed, "standard"),
        config_id: selectedModel.configId,
        name: selectedModel.name
      }
    : {
        provider: requiredString(model.provider, "model.provider"),
        id: requiredString(model.id, "model.id"),
        speed: optionalString(model.speed, "standard"),
        config_id: optionalString(model.config_id),
        name: optionalString(model.name)
      };
  const tools = normalizeToolRecords(value.tools);
  const mcpServers = normalizeRecords(value.mcp_servers, "mcp_servers", "mcp");
  return {
    name: requiredString(value.name, "name").slice(0, 80),
    description: requiredString(value.description, "description").slice(0, 240),
    model: normalizedModel,
    system: requiredString(value.system, "system"),
    tools,
    mcp_servers: mcpServers,
    skills: normalizeRecords(value.skills, "skills", "skill"),
    agent_loop: withDraftExecution(agentLoop, mcpServers),
    multiagent: value.multiagent,
    metadata: {
      ...(value.metadata ?? {}),
      generated_from_prompt: prompt,
      builder: "provider-generated",
      yaml_authoring_supported: true
    }
  };
}

function fallbackAgentDraft(rawPrompt: string, selectedModel: ModelSelection | undefined, agentLoopType: AgentLoopType, raw: string, error: unknown): AgentConfig {
  const prompt = rawPrompt.trim();
  const name = titleFromPrompt(prompt);
  const mcpServers = mcpServersForPrompt(prompt);
  return {
    name,
    description: `Agent drafted from: ${prompt}`.slice(0, 240),
    model: selectedModel
      ? { provider: selectedModel.provider, id: selectedModel.model, speed: "standard", config_id: selectedModel.configId, name: selectedModel.name }
      : { provider: "openai", id: "default", speed: "standard" },
    system: [
      `你是 ${name}。`,
      "围绕用户目标规划步骤、调用可用工具、保留证据，并在需要外部凭据或破坏性操作时先请求确认。",
      `原始需求: ${prompt}`
    ].join("\n"),
    tools: [{ type: "agent_toolset_20260401" }],
    mcp_servers: mcpServers,
    skills: [],
    agent_loop: withDraftExecution({ type: agentLoopType, config: {}, hooks: [] }, mcpServers),
    metadata: {
      generated_from_prompt: prompt,
      builder: "provider-format-fallback",
      provider_parse_error: error instanceof Error ? error.message : String(error),
      provider_raw_preview: raw.slice(0, 240),
      yaml_authoring_supported: true
    }
  };
}

function titleFromPrompt(prompt: string) {
  const cleaned = prompt.replace(/[^\p{L}\p{N}\s_-]+/gu, " ").trim().replace(/\s+/g, " ");
  return (cleaned.split(" ").slice(0, 6).join(" ") || "Managed Agent").slice(0, 80);
}

function mcpServersForPrompt(prompt: string) {
  const lower = prompt.toLowerCase();
  const servers: Record<string, unknown>[] = [];
  if (lower.includes("github") || lower.includes("repo") || lower.includes("pr") || lower.includes("issue")) {
    servers.push({ name: "github", provider: "github", url: "https://api.githubcopilot.com/mcp/", type: "url" });
  }
  if (lower.includes("notion")) {
    servers.push({ name: "notion", provider: "notion", url: "https://mcp.notion.com/mcp", type: "url" });
  }
  return servers;
}

function withDraftExecution(value: unknown, mcpServers: Record<string, unknown>[]) {
  const loop = normalizeAgentLoop(value);
  return {
    ...loop,
    config: {
      ...(loop.config ?? {}),
      execution: mcpServers.length ? "external" : "provider"
    }
  };
}

function normalizeRecords(value: unknown, field: string, kind: "tool" | "mcp" | "skill") {
  // Fail fast: the provider contract requires every array field. A missing/null field is a
  // real provider problem we want surfaced (the turn fails with a clear error), not silently
  // patched to [] — that would hide a broken draft generation behind a "working" empty agent.
  if (!Array.isArray(value)) throw new Error(`Provider draft field ${field} must be an array.`);
  return value.map((item) => {
    if (item && typeof item === "object") return item as Record<string, unknown>;
    const text = String(item);
    if (kind === "tool") return { type: text };
    if (kind === "mcp") return { name: text, type: "url" };
    return { type: "local", name: text };
  });
}

function normalizeToolRecords(value: unknown) {
  return normalizeRecords(value, "tools", "tool").map((tool) => {
    if (!String(tool.type ?? "").startsWith("agent_toolset")) return tool;
    const configs = normalizeWriteEditPair(tool.configs);
    const defaultConfig = normalizeWriteEditPair(tool.default_config);
    return {
      ...tool,
      ...(tool.default_config ? { default_config: defaultConfig } : {}),
      ...(tool.configs ? { configs } : {})
    };
  });
}

function requireRecord(value: unknown, field: string) {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) return value as Record<string, unknown>;
  throw new Error(`Provider draft field ${field} must be an object.`);
}

function requiredString(value: unknown, field: string) {
  if (typeof value === "string" && value.trim()) return value.trim();
  throw new Error(`Provider draft field ${field} is required.`);
}

function optionalString(value: unknown, defaultValue?: string) {
  if (typeof value === "string" && value.trim()) return value.trim();
  return defaultValue;
}

function normalizeWriteEditPair(value: unknown) {
  const config = typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  if (config.write === true || config.edit === true || config.write_file === true || config.edit_file === true) {
    return { ...config, write: true, edit: true };
  }
  return config;
}

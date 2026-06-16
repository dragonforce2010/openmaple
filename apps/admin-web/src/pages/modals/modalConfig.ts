import type { AgentConfig, AgentLoopType, JsonRecord } from "../../types";


import { toYamlPreview } from "../../components/shared/code";

export const MAX_RUNTIME_INSTANCES = 100;
export const MAX_RUNTIME_CONCURRENCY = 1000;

export function clampNumber(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

export function parseConfigScalar(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if ((trimmed.startsWith("\"") && trimmed.endsWith("\"")) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return trimmed.slice(1, -1);
    }
  }
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  return trimmed;
}

export function yamlRootValue(lines: string[], key: string) {
  const line = lines.find((item) => item.startsWith(`${key}:`));
  return line ? parseConfigScalar(line.slice(key.length + 1)) : "";
}

export function yamlBlockValue(lines: string[], key: string) {
  const start = lines.findIndex((item) => item.trim() === `${key}: |`);
  if (start < 0) return "";
  const block: string[] = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^[A-Za-z_][\w-]*:/.test(line)) break;
    block.push(line.startsWith("  ") ? line.slice(2) : line);
  }
  return block.join("\n").trimEnd();
}

export function yamlSequenceValue(lines: string[], key: string): JsonRecord[] {
  const start = lines.findIndex((item) => item.trim() === `${key}:`);
  if (start < 0) return [];
  const items: JsonRecord[] = [];
  let current: JsonRecord | null = null;
  let nestedKey = "";
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^[A-Za-z_][\w-]*:/.test(line)) break;
    if (line.trim() === "[]") return [];
    const itemMatch = line.match(/^  -\s*(.*)$/);
    if (itemMatch) {
      current = {};
      nestedKey = "";
      items.push(current);
      const rest = itemMatch[1].trim();
      if (rest && rest !== "{}") {
        const pair = rest.match(/^([^:]+):\s*(.*)$/);
        if (pair) current[pair[1].trim()] = parseConfigScalar(pair[2]);
      }
      continue;
    }
    if (!current) continue;
    const nestedMatch = line.match(/^      ([^:]+):\s*(.*)$/);
    if (nestedMatch && nestedKey && typeof current[nestedKey] === "object" && current[nestedKey]) {
      (current[nestedKey] as JsonRecord)[nestedMatch[1].trim()] = parseConfigScalar(nestedMatch[2]);
      continue;
    }
    const pair = line.match(/^    ([^:]+):\s*(.*)$/);
    if (pair) {
      const name = pair[1].trim();
      const value = pair[2].trim();
      if (!value) {
        nestedKey = name;
        current[name] = {};
      } else {
        nestedKey = "";
        current[name] = parseConfigScalar(value);
      }
    }
  }
  return items;
}

export function parseEditableAgentConfig(text: string, fmt: "yaml" | "json", fallback: AgentConfig): AgentConfig {
  if (fmt === "json") {
    const parsed = JSON.parse(text) as AgentConfig;
    return {
      ...fallback,
      ...parsed,
      model: { ...fallback.model, ...(parsed.model ?? {}) },
      agent_loop: { ...fallback.agent_loop, ...(parsed.agent_loop ?? {}) },
      tools: Array.isArray(parsed.tools) ? parsed.tools : fallback.tools,
      mcp_servers: Array.isArray(parsed.mcp_servers) ? parsed.mcp_servers : fallback.mcp_servers,
      skills: Array.isArray(parsed.skills) ? parsed.skills : fallback.skills
    };
  }
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const next = {
    ...fallback,
    name: String(yamlRootValue(lines, "name") || fallback.name),
    description: String(yamlRootValue(lines, "description") || fallback.description),
    system: yamlBlockValue(lines, "system") || fallback.system,
    model: {
      ...fallback.model,
      id: String(yamlRootValue(lines, "model") || fallback.model.id),
      provider: String(yamlRootValue(lines, "model_provider") || fallback.model.provider),
      config_id: String(yamlRootValue(lines, "model_config_id") || fallback.model.config_id || "") || undefined
    },
    agent_loop: {
      ...fallback.agent_loop,
      type: String(lines.find((line, index) => index > lines.findIndex((item) => item.trim() === "agent_loop:") && line.trim().startsWith("type:"))?.trim().replace(/^type:\s*/, "") || fallback.agent_loop.type) as AgentLoopType
    },
    mcp_servers: yamlSequenceValue(lines, "mcp_servers"),
    tools: yamlSequenceValue(lines, "tools"),
    skills: yamlSequenceValue(lines, "skills")
  };
  if (!next.name.trim() || !next.model.id.trim() || !next.system.trim()) throw new Error("name, model and system are required");
  return next;
}

export function editableConfigText(config: AgentConfig, fmt: "yaml" | "json") {
  return fmt === "json" ? JSON.stringify(config, null, 2) : toYamlPreview(config);
}

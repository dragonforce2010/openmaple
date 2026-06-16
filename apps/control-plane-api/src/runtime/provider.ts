import { resolveModelTarget } from "../modelGateway";
import type { JsonRecord } from "../types";

export type ToolCall = {
  id: string;
  name: string;
  arguments: JsonRecord;
};

export type ProviderResult =
  | { type: "message"; content: string; usage?: JsonRecord }
  | { type: "tool_calls"; calls: ToolCall[]; usage?: JsonRecord };

export type ChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | ChatContentPart[] | null;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: {
      name: string;
      arguments: string;
    };
  }>;
};

export type ChatContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export type TextProviderOptions = {
  temperature?: number;
  max_tokens?: number;
  userId?: string;
  modelConfigId?: string;
  workspaceId?: string | null;
  timeoutMs?: number;
  agentTools?: JsonRecord[];
  onTextDelta?: (text: string) => void;
  // reasoning_content side-channel (doubao/glm "thinking"); streamed but never fed back into
  // messages or returned in ProviderResult — same as sanitizeProviderText stripping <think>.
  onReasoningDelta?: (text: string) => void;
};

const toolDefinitions = [
  {
    type: "function",
    function: {
      name: "bash",
      description: "Run a shell command inside the session Docker workspace.",
      parameters: {
        type: "object",
        properties: { command: { type: "string" } },
        required: ["command"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "read_file",
      description: "Read a UTF-8 file from the session workspace.",
      parameters: {
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "write_file",
      description: "Write a UTF-8 file into the session workspace.",
      parameters: {
        type: "object",
        properties: { path: { type: "string" }, content: { type: "string" } },
        required: ["path", "content"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "list_files",
      description: "List files in the session workspace.",
      parameters: {
        type: "object",
        properties: { path: { type: "string" } }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "grep",
      description: "Search files in the session workspace.",
      parameters: {
        type: "object",
        properties: { pattern: { type: "string" }, path: { type: "string" } },
        required: ["pattern"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "memory_search",
      description: "Search the platform's real MySQL-backed long-term memory stores.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string" },
          memory_store_id: { type: "string" }
        },
        required: ["query"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "memory_write",
      description: "Write a durable memory record into a MySQL-backed memory store.",
      parameters: {
        type: "object",
        properties: {
          memory_store_id: { type: "string" },
          path: { type: "string" },
          content: { type: "string" }
        },
        required: ["memory_store_id", "path", "content"]
      }
    }
  }
];

export function getToolDefinitions() {
  return toolDefinitions;
}

export const builtInToolNames = new Set(toolDefinitions.map((tool) => tool.function.name));

export async function callProvider(
  messages: ChatMessage[],
  userId?: string,
  modelConfigId?: string,
  agentTools: JsonRecord[] = [],
  options: Pick<TextProviderOptions, "onTextDelta" | "onReasoningDelta" | "timeoutMs" | "workspaceId"> = {}
): Promise<ProviderResult> {
  return callOpenAI(messages, true, { userId, modelConfigId, agentTools, ...options });
}

export async function callProviderText(messages: ChatMessage[], options: TextProviderOptions = {}) {
  const result = await callOpenAI(messages, false, options);
  if (result.type === "tool_calls") throw new Error("Text provider unexpectedly returned tool calls.");
  return result.content;
}

async function callOpenAI(messages: ChatMessage[], enableTools: boolean, options: TextProviderOptions = {}): Promise<ProviderResult> {
  const target = resolveModelTarget({ userId: options.userId, modelConfigId: options.modelConfigId, workspaceId: options.workspaceId });
  const response = await fetch(`${target.baseUrl}/chat/completions`, {
    method: "POST",
    signal: options.timeoutMs ? AbortSignal.timeout(options.timeoutMs) : undefined,
    headers: {
      Authorization: `Bearer ${target.apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: target.model,
      messages,
      ...(enableTools ? { tools: buildToolDefinitions(options.agentTools ?? []), tool_choice: "auto" } : {}),
      ...(options.onTextDelta || options.onReasoningDelta ? { stream: true } : {}),
      temperature: options.temperature ?? 0.2,
      ...(options.max_tokens ? { max_tokens: options.max_tokens } : {})
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Provider error ${response.status}: ${text}`);
  }
  const contentType = response.headers.get("content-type") || "";
  if ((options.onTextDelta || options.onReasoningDelta) && contentType.includes("text/event-stream")) {
    return readOpenAIStream(response, options.onTextDelta, options.onReasoningDelta);
  }
  const data = (await response.json()) as JsonRecord;
  return providerResultFromResponse(data);
}

function providerResultFromResponse(data: JsonRecord): ProviderResult {
  const choice = (data.choices as JsonRecord[])[0] as JsonRecord;
  const message = choice.message as JsonRecord;
  const toolCalls = (message.tool_calls as JsonRecord[] | undefined) ?? [];
  if (toolCalls.length > 0) {
    return {
      type: "tool_calls",
      calls: toolCalls.map((call) => {
        const fn = call.function as JsonRecord;
        return {
          id: String(call.id),
          name: String(fn.name),
          arguments: parseArguments(String(fn.arguments || "{}"))
        };
      }),
      usage: data.usage as JsonRecord | undefined
    };
  }
  return {
    type: "message",
    content: sanitizeProviderText(String(message.content || "")),
    usage: data.usage as JsonRecord | undefined
  };
}

async function readOpenAIStream(
  response: Response,
  onTextDelta?: (text: string) => void,
  onReasoningDelta?: (text: string) => void
): Promise<ProviderResult> {
  if (!response.body) return providerResultFromResponse((await response.json()) as JsonRecord);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const toolCalls = new Map<number, { id: string; name: string; arguments: string }>();
  let buffer = "";
  let content = "";
  let usage: JsonRecord | undefined;

  for (;;) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const event = parseStreamDataLine(line);
      if (!event || event === "[DONE]") continue;
      const chunk = parseArguments(event);
      usage = (chunk.usage as JsonRecord | undefined) ?? usage;
      const choice = asRecord((chunk.choices as JsonRecord[] | undefined)?.[0]);
      const delta = asRecord(choice.delta);
      const text = typeof delta.content === "string" ? delta.content : "";
      if (text) {
        content += text;
        onTextDelta?.(text);
      }
      const reasoning = typeof delta.reasoning_content === "string" ? delta.reasoning_content : "";
      if (reasoning) onReasoningDelta?.(reasoning);
      for (const call of (delta.tool_calls as JsonRecord[] | undefined) ?? []) appendToolCallDelta(toolCalls, call);
    }
    if (done) break;
  }

  if (toolCalls.size > 0) {
    return {
      type: "tool_calls",
      calls: [...toolCalls.entries()].sort(([left], [right]) => left - right).map(([, call]) => ({
        id: call.id,
        name: call.name,
        arguments: parseArguments(call.arguments || "{}")
      })),
      usage
    };
  }
  return { type: "message", content: sanitizeProviderText(content), usage };
}

function parseStreamDataLine(line: string) {
  const trimmed = line.trim();
  if (!trimmed.startsWith("data:")) return "";
  return trimmed.slice(5).trim();
}

function appendToolCallDelta(toolCalls: Map<number, { id: string; name: string; arguments: string }>, raw: JsonRecord) {
  const index = typeof raw.index === "number" ? raw.index : toolCalls.size;
  const current = toolCalls.get(index) ?? { id: "", name: "", arguments: "" };
  const fn = asRecord(raw.function);
  toolCalls.set(index, {
    id: typeof raw.id === "string" ? raw.id : current.id,
    name: current.name + String(fn.name || ""),
    arguments: current.arguments + String(fn.arguments || "")
  });
}

function buildToolDefinitions(agentTools: JsonRecord[]) {
  const builtIns = toolDefinitions.filter((tool) => isBuiltInToolAllowed(agentTools, tool.function.name));
  const custom = agentTools
    .filter((tool) => tool.type === "custom" && typeof tool.name === "string")
    .map((tool) => ({
      type: "function",
      function: {
        name: String(tool.name),
        description: String(tool.description || `Custom tool ${tool.name}`),
        parameters:
          tool.input_schema && typeof tool.input_schema === "object" && !Array.isArray(tool.input_schema)
            ? (tool.input_schema as JsonRecord)
            : { type: "object", properties: {} }
      }
    }));
  const seen = new Set<string>();
  return [...builtIns, ...custom].filter((tool) => {
    if (seen.has(tool.function.name)) return false;
    seen.add(tool.function.name);
    return true;
  });
}

export function isBuiltInToolAllowed(agentTools: JsonRecord[], toolName: string) {
  const toolset = agentTools.find((tool) => typeof tool.type === "string" && String(tool.type).startsWith("agent_toolset"));
  if (!toolset) return true;
  const configs = {
    ...asRecord(toolset.default_config),
    ...asRecord(toolset.configs)
  };
  if (configs.enabled === false) return false;
  const key = builtInToolConfigKey(toolName);
  if (!key) return true;
  if (key === "write" && configs.edit === true) return true;
  if (Object.prototype.hasOwnProperty.call(configs, key)) return Boolean(configs[key]);
  return true;
}

function builtInToolConfigKey(toolName: string) {
  if (toolName === "read_file" || toolName === "list_files") return "read";
  if (toolName === "write_file") return "write";
  if (toolName === "bash") return "bash";
  if (toolName === "grep") return "grep";
  if (toolName === "memory_search") return "memory_search";
  if (toolName === "memory_write") return "memory_write";
  return "";
}

function parseArguments(raw: string): JsonRecord {
  try {
    return JSON.parse(raw) as JsonRecord;
  } catch {
    return {};
  }
}

function asRecord(value: unknown): JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function sanitizeProviderText(content: string) {
  return content
    .replace(/<think[^>]*>[\s\S]*?<\/think[^>]*>/gi, "")
    .replace(/^[\s\S]*?<\/think[^>]*>/i, "")
    .trim();
}

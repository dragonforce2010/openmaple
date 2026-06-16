import type * as React from "react";
import { Fragment } from "react";
import type { Agent, AgentConfig, Environment, JsonRecord, ModelConfig } from "../../types";

export function maskSecret(value: unknown, visible = 6) {
  const text = String(value ?? "");
  if (!text) return "••••••";
  const suffix = text.slice(-Math.min(visible, text.length));
  return `••••••••${suffix}`;
}

export type CodeLanguage = "python" | "typescript" | "curl" | "json" | "yaml" | "text";

export function HighlightedCode({ code, language, className = "" }: { code: string; language?: CodeLanguage; className?: string }) {
  const lang = language ?? inferCodeLanguage(code);
  return (
    <code className={`syntax-code lang-${lang}${className ? ` ${className}` : ""}`}>
      {code.split("\n").map((line, lineIndex) => (
        <Fragment key={`${lineIndex}:${line}`}>
          {highlightLine(line, lineIndex)}
          {lineIndex < code.split("\n").length - 1 ? "\n" : null}
        </Fragment>
      ))}
    </code>
  );
}

export function inferCodeLanguage(code: string): CodeLanguage {
  const trimmed = code.trim();
  if (!trimmed) return "text";
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return "json";
  if (/^(name|model|tools|skills|agent_loop):/m.test(trimmed)) return "yaml";
  if (/^(curl|export|SESSION_ID=|: "\$\{)/m.test(trimmed)) return "curl";
  if (/^(import json|import os|import requests|base_url =)/m.test(trimmed)) return "python";
  if (/^(import \{|const |await |console\.)/m.test(trimmed)) return "typescript";
  return "text";
}

export function highlightLine(line: string, lineIndex: number) {
  const pattern = /(\/\/.*$|#.*$)|("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')|(\b(?:import|from|const|let|await|async|return|for|in|if|else|def|class|try|catch|export|function|true|false|null|None)\b)|(\$\{[^}]+\}|\$[A-Z_][A-Z0-9_]*|\b[A-Z_][A-Z0-9_]{2,}\b)|(\b\d+(?:\.\d+)?\b)|([{}[\]():,])/g;
  const nodes: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(line))) {
    if (match.index > lastIndex) nodes.push(line.slice(lastIndex, match.index));
    const cls = match[1] ? "hl-comment" : match[2] ? "hl-string" : match[3] ? "hl-keyword" : match[4] ? "hl-var" : match[5] ? "hl-number" : "hl-punc";
    nodes.push(<span className={cls} key={`${lineIndex}:${match.index}`}>{match[0]}</span>);
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < line.length) nodes.push(line.slice(lastIndex));
  return nodes;
}

export function agentSampleCode(agent: Agent, language: "python" | "typescript" | "curl", context: { environment?: Environment | null } = {}) {
  const sample = agentSampleContext(agent, context.environment);
  if (language === "python") {
    return `import json
import os
import threading
import requests

base_url = os.environ["MAPLE_API_BASE_URL"]
api_key = os.environ.get("MAPLE_API_KEY", "maple_ws_xxx")
workspace_id = ${jsonString(sample.workspaceId)}
agent_id = ${jsonString(sample.agentId)}
environment_id = ${jsonString(sample.environmentId)}
model_id = ${jsonString(sample.modelId)}
headers = {"X-Maple-API-Key": api_key, "Content-Type": "application/json"}

session = requests.post(
    f"{base_url}/v1/sessions",
    headers=headers,
    json={
        "workspace_id": workspace_id,
        "agent": agent_id,
        "environment_id": environment_id,
        "metadata": {"integration_model_id": model_id},
        "title": "Integration smoke",
    },
    timeout=30,
).json()

ready = threading.Event()
done = threading.Event()

def consume_stream():
    event_name = ""
    data_lines = []
    with requests.get(
        f"{base_url}/v1/sessions/{session['id']}/events/stream",
        headers=headers,
        stream=True,
        timeout=(10, None),
    ) as stream:
        stream.raise_for_status()
        for line in stream.iter_lines(decode_unicode=True):
            if line == "":
                if data_lines:
                    event = json.loads("\\n".join(data_lines))
                    if event_name == "ready":
                        ready.set()
                    elif event_name == "agent.message_delta":
                        print(event.get("text", ""), end="", flush=True)
                    elif event_name in ("agent.message", "session.status_failed"):
                        done.set()
                        return
                event_name = ""
                data_lines = []
                continue
            if line.startswith("event:"):
                event_name = line[6:].strip()
            elif line.startswith("data:"):
                data_lines.append(line[5:].strip())

threading.Thread(target=consume_stream, daemon=True).start()
if not ready.wait(timeout=10):
    raise TimeoutError("Maple session stream did not become ready.")

requests.post(
    f"{base_url}/v1/sessions/{session['id']}/events",
    headers=headers,
    json={
        "events": [{
            "type": "user.message",
            "content": [{"type": "text", "text": "Summarize the uploaded files."}],
        }]
    },
    timeout=30,
)

if not done.wait(timeout=300):
    raise TimeoutError("Maple session did not finish streaming.")`;
  }
  if (language === "typescript") {
    return `import { MapleClient } from "maple-agent-sdk";

const client = new MapleClient({
  baseURL: process.env.MAPLE_API_BASE_URL,
  apiKey: process.env.MAPLE_API_KEY || "maple_ws_xxx",
  workspaceId: ${jsonString(sample.workspaceId)}
});

const modelId = ${jsonString(sample.modelId)};

const run = await client.createSessionAndStream({
  agent: ${jsonString(sample.agentId)},
  environment_id: ${jsonString(sample.environmentId)},
  title: "Integration smoke",
  metadata: { integration_model_id: modelId },
  message: "Summarize the uploaded files."
}, {
  onEvent(event) {
    if (event.type === "agent.message_delta") process.stdout.write(String(event.text ?? ""));
    if (event.type === "session.status_failed") console.error(event.error ?? event.payload);
  }
});

console.error(\`session \${run.session.id} workspace \${client.workspaceId} model \${modelId}\`);
await run.done;`;
  }
return `export MAPLE_API_BASE_URL=${shellString(sample.baseUrl)}
export MAPLE_API_KEY="maple_ws_xxx"
export MAPLE_WORKSPACE_ID=${shellString(sample.workspaceId)}
export MAPLE_AGENT_ID=${shellString(sample.agentId)}
export MAPLE_ENVIRONMENT_ID=${shellString(sample.environmentId)}
export MAPLE_MODEL_ID=${shellString(sample.modelId)}

SESSION_RESPONSE=$(curl -sS "$MAPLE_API_BASE_URL/v1/sessions" \\
  -H "Content-Type: application/json" \\
  -H "X-Maple-API-Key: $MAPLE_API_KEY" \\
  -d '{
    "workspace_id": "'"$MAPLE_WORKSPACE_ID"'",
    "agent": "'"$MAPLE_AGENT_ID"'",
    "environment_id": "'"$MAPLE_ENVIRONMENT_ID"'",
    "metadata": {"integration_model_id": "'"$MAPLE_MODEL_ID"'"},
    "title": "Integration smoke"
  }')
SESSION_ID=$(printf '%s\\n' "$SESSION_RESPONSE" | sed -n 's/.*"id"[[:space:]]*:[[:space:]]*"\\([^"]*\\)".*/\\1/p' | head -n 1)
if [ -z "$SESSION_ID" ]; then
  printf '%s\\n' "$SESSION_RESPONSE"
  exit 1
fi

curl -sSN "$MAPLE_API_BASE_URL/v1/sessions/$SESSION_ID/events/stream" \\
  -H "X-Maple-API-Key: $MAPLE_API_KEY" \\
  | sed -n '/^data: /{s/^data: //;p;/"type":"agent.message"/q;/"type":"session.status_failed"/q;}' &
STREAM_PID=$!
sleep 1

curl -sS "$MAPLE_API_BASE_URL/v1/sessions/$SESSION_ID/events" \\
  -H "Content-Type: application/json" \\
  -H "X-Maple-API-Key: $MAPLE_API_KEY" \\
  -d '{"events":[{"type":"user.message","content":[{"type":"text","text":"Summarize the uploaded files."}]}]}'

wait "$STREAM_PID"`;
}

function agentSampleContext(agent: Agent, environment?: Environment | null) {
  return {
    baseUrl: "https://sd8ihq8v316pc5mf9c1j0.apigateway-cn-beijing.volceapi.com",
    workspaceId: agent.workspace_id || environment?.workspace_id || "ws_xxx",
    agentId: agent.id,
    environmentId: environment?.id || "env_xxx",
    modelId: agent.config.model.id || "model_xxx"
  };
}

function jsonString(value: string) {
  return JSON.stringify(value);
}

function shellString(value: string) {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

export function toYamlPreview(config: AgentConfig) {
  const lines = [
    `name: ${yamlScalar(config.name)}`,
    `model: ${yamlScalar(config.model.id)}`,
    `model_provider: ${yamlScalar(config.model.provider)}`,
    ...(config.model.config_id ? [`model_config_id: ${yamlScalar(config.model.config_id)}`] : []),
    "agent_loop:",
    `  type: ${yamlScalar(config.agent_loop?.type ?? "anthropic_claude_code")}`,
    `description: ${yamlScalar(config.description)}`,
    "system: |",
    ...config.system.split("\n").map((line) => `  ${line}`),
    "mcp_servers:",
    ...(config.mcp_servers.length ? config.mcp_servers.flatMap((server) => yamlObjectItem(server)) : ["  []"]),
    "tools:",
    ...(config.tools.length ? config.tools.flatMap((tool) => yamlObjectItem(tool)) : ["  []"]),
    "skills:",
    ...(config.skills.length ? config.skills.flatMap((skill) => yamlObjectItem(skill)) : ["  []"])
  ];
  return lines.join("\n");
}

export function agentModelFromModelConfig(config: ModelConfig) {
  return {
    provider: config.provider_type || "openai",
    id: config.model_name,
    config_id: config.id,
    name: config.name,
    speed: "standard"
  };
}

export function agentModelConfigId(agent: Agent, modelConfigs: ModelConfig[]) {
  const explicit = agent.config.model.config_id;
  if (explicit && modelConfigs.some((config) => config.id === explicit)) return explicit;
  return modelConfigs.find((config) => config.model_name === agent.config.model.id)?.id ?? "";
}

export function yamlObjectItem(value: JsonRecord) {
  const entries = Object.entries(value);
  if (entries.length === 0) return ["  - {}"];
  return entries.flatMap(([key, item], index) => {
    const prefix = index === 0 ? "  -" : "   ";
    if (typeof item === "object" && item !== null) return [`${prefix} ${key}:`, ...Object.entries(item as JsonRecord).map(([childKey, child]) => `      ${childKey}: ${yamlScalar(String(child))}`)];
    return [`${prefix} ${key}: ${yamlScalar(String(item))}`];
  });
}

export function yamlScalar(value: string) {
  return value.includes(":") || value.length > 90 ? JSON.stringify(value) : value;
}

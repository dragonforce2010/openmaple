import { mkdir } from "node:fs/promises";
import { traceAsync } from "../perfTrace";
import { updateSessionMetadata } from "../store";
import type { JsonRecord } from "../types";
import { injectMcpCredentials } from "./mcpCredentialInjection";
import { asRecord, parseJsonRecord, runtimePublicMetadata, stringifyRecord } from "./runtimeCommon";
import { sessionResourceManifest } from "./runtimeResources";
import type { RuntimeInfo, VefaasRuntimeInfo } from "./runtimeTypes";
import type { NormalizedAgentRuntimeConfig } from "./sandboxConfig";

export async function ensureVefaasRuntime(
  session: JsonRecord & { id: string; workspace_path: string },
  config: Extract<NormalizedAgentRuntimeConfig, { provider: "vefaas" }>,
  sandboxRuntime?: RuntimeInfo
) {
  if (!config.invoke_url) {
    throw new Error("veFaaS runtime requires a workspace runtime pool member invoke_url or explicit agent_runtime.vefaas.invoke_url.");
  }
  const metadata = session.metadata as JsonRecord;
  const existing = metadata.agent_runtime as RuntimeInfo | undefined;
  if (existing?.type === "vefaas" && isSameVefaasRuntime(existing, config)) {
    return existing;
  }
  const workspacePath = String(session.workspace_path);
  await mkdir(workspacePath, { recursive: true });
  const runtime: VefaasRuntimeInfo = {
    type: "vefaas",
    invoke_url: config.invoke_url,
    api_key: config.api_key || undefined,
    function_id: config.function_id,
    cloud_function_id: config.function_id,
    region: config.region,
    workspace_path: workspacePath,
    sandbox_workspace_path: config.workspace_path,
    timeout_ms: config.timeout_ms,
    envs: config.envs
  };
  updateSessionMetadata(String(session.id), { agent_runtime: runtime });
  const agentConfig = vefaasLoopAgentConfig(session);
  await invokeVefaas(runtime, "bootstrap", {
    session_id: String(session.id),
    workspace_path: runtime.sandbox_workspace_path,
    envs: runtime.envs,
    sandbox_runtime: sandboxRuntime ? runtimePublicMetadata(sandboxRuntime) : undefined,
    resources: await sessionResourceManifest(session),
    // lets the runtime pre-warm the keep-alive agent loop before the first turn
    agent_config: agentConfig,
    agent_env: vefaasLoopAgentEnv(runtime, String(session.id), agentConfig)
  });
  return runtime;
}

export function vefaasLoopAgentConfig(session: JsonRecord) {
  const snapshot = asRecord(session.agent_snapshot);
  // Inject the workspace's connected MCP OAuth tokens into mcp_servers (bearer headers) before the
  // agent config is serialized into MAPLE_AGENT_TEMPLATE and sent to the sandbox loop.
  const withCreds = { ...snapshot, mcp_servers: injectMcpCredentials(snapshot.mcp_servers, String(session.workspace_id ?? "")) };
  return agentConfigForVefaasLoop(withCreds);
}

export function vefaasLoopAgentEnv(runtime: VefaasRuntimeInfo, sessionId: string, agentConfig: JsonRecord) {
  const agentLoop = asRecord(agentConfig.agent_loop);
  return stringifyRecord({
    ...asRecord(runtime.envs),
    MAPLE_SESSION_ID: sessionId,
    MAPLE_AGENT_TEMPLATE: JSON.stringify(agentConfig),
    MAPLE_AGENT_LOOP_TYPE: String(agentLoop.type || "anthropic_claude_code"),
    MAPLE_AGENT_MODEL: JSON.stringify(asRecord(agentConfig.model)),
    MAPLE_AGENT_TOOLS: JSON.stringify(Array.isArray(agentConfig.tools) ? agentConfig.tools : [])
  });
}

function agentConfigForVefaasLoop(agentConfig: JsonRecord) {
  const loop = asRecord(agentConfig.agent_loop);
  const config = asRecord(loop.config);
  if (Array.isArray(config.tools) && config.tools.length > 0) return agentConfig;
  return {
    ...agentConfig,
    agent_loop: {
      ...loop,
      config: {
        ...config,
        tools: claudeCodeToolsForAgentTools(Array.isArray(agentConfig.tools) ? (agentConfig.tools as JsonRecord[]) : [])
      }
    }
  };
}

function claudeCodeToolsForAgentTools(agentTools: JsonRecord[]) {
  const toolset = agentTools.find((tool) => typeof tool.type === "string" && String(tool.type).startsWith("agent_toolset"));
  if (!toolset) return ["AskUserQuestion"];
  const configs = {
    ...asRecord(toolset.default_config),
    ...asRecord(toolset.configs)
  };
  if (configs.enabled === false) return ["AskUserQuestion"];
  const hasExplicitFlags = ["read", "write", "edit", "bash", "grep"].some((key) => Object.prototype.hasOwnProperty.call(configs, key));
  const enabled = (key: string) => (hasExplicitFlags ? Boolean(configs[key]) : true);
  const tools = new Set(["AskUserQuestion"]);
  if (enabled("bash")) tools.add("Bash");
  if (enabled("write") || configs.edit === true) {
    tools.add("Edit");
    tools.add("Write");
  }
  if (enabled("read")) {
    tools.add("Glob");
    tools.add("Read");
  }
  if (enabled("grep")) {
    tools.add("Glob");
    tools.add("Grep");
  }
  return [...tools].sort();
}

export async function invokeVefaas(runtime: VefaasRuntimeInfo, action: string, payload: JsonRecord) {
  return traceAsync("vefaas_agent.invoke", { action, function_id: runtime.function_id, region: runtime.region }, async () => {
    // control-plane actions (bootstrap/health) must fail fast on a degraded runtime instead of hanging the full agent timeout
    const controlTimeout = Number(process.env.MAPLE_VEFAAS_CONTROL_TIMEOUT_MS || 20_000);
    const timeoutMs = action === "run" ? runtime.timeout_ms : Math.min(runtime.timeout_ms, controlTimeout);
    const response = await fetch(runtime.invoke_url, {
      method: "POST",
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        "Content-Type": "application/json",
        ...(runtime.api_key ? { Authorization: `Bearer ${runtime.api_key}` } : {})
      },
      body: JSON.stringify({
        action,
        function_id: runtime.function_id,
        region: runtime.region,
        workspace_path: runtime.sandbox_workspace_path,
        envs: runtime.envs,
        ...payload
      })
    });
    const text = await response.text();
    const body = parseJsonRecord(text);
    if (!response.ok) throw new Error(`veFaaS runtime error ${response.status}: ${text}`);
    if (body.ok === false) throw new Error(String(body.error || "veFaaS runtime returned ok=false"));
    return (body.result && typeof body.result === "object" ? body.result : body) as JsonRecord;
  });
}

function isSameVefaasRuntime(runtime: VefaasRuntimeInfo, config: Extract<NormalizedAgentRuntimeConfig, { provider: "vefaas" }>) {
  return (
    runtime.invoke_url === config.invoke_url &&
    (runtime.api_key ?? "") === config.api_key &&
    runtime.function_id === config.function_id &&
    runtime.region === config.region &&
    runtime.sandbox_workspace_path === config.workspace_path &&
    runtime.timeout_ms === config.timeout_ms &&
    JSON.stringify(runtime.envs) === JSON.stringify(config.envs)
  );
}

import { mkdir } from "node:fs/promises";
import { traceAsync } from "../perfTrace";
import { updateSessionMetadata } from "../store";
import type { JsonRecord } from "../types";
import { asRecord, parseJsonRecord, runtimePublicMetadata, stringifyRecord } from "./runtimeCommon";
import { sessionResourceManifest } from "./runtimeResources";
import type { AliyunFcRuntimeInfo, AliyunFcSandboxRuntimeInfo, RuntimeInfo } from "./runtimeTypes";
import type { NormalizedAgentRuntimeConfig, NormalizedSandboxRuntimeConfig } from "./sandboxConfig";
import { vefaasLoopAgentConfig } from "./vefaasAgentRuntime";

type AliyunFcSandboxAcquireOptions = {
  acquireRuntime?: () => Promise<AliyunFcSandboxRuntimeInfo | null>;
};

export async function ensureAliyunFcRuntime(
  session: JsonRecord & { id: string; workspace_path: string },
  config: Extract<NormalizedAgentRuntimeConfig, { provider: "aliyun_fc" }>,
  sandboxRuntime?: RuntimeInfo
) {
  if (!config.invoke_url) throw new Error("Aliyun FC runtime requires agent_runtime.aliyun_fc.invoke_url or a workspace runtime pool member invoke_url.");
  const metadata = session.metadata as JsonRecord;
  const existing = metadata.agent_runtime as RuntimeInfo | undefined;
  if (existing?.type === "aliyun_fc" && isSameAliyunFcRuntime(existing, config)) return existing;
  const workspacePath = String(session.workspace_path);
  await mkdir(workspacePath, { recursive: true });
  const runtime: AliyunFcRuntimeInfo = {
    type: "aliyun_fc",
    provider: "aliyun_fc",
    invoke_url: config.invoke_url,
    api_key: config.api_key || undefined,
    function_name: config.function_name,
    region: config.region,
    workspace_path: workspacePath,
    sandbox_workspace_path: config.workspace_path,
    timeout_ms: config.timeout_ms,
    envs: config.envs
  };
  updateSessionMetadata(String(session.id), { agent_runtime: runtime });
  const agentConfig = vefaasLoopAgentConfig(session);
  await invokeAliyunFc(runtime, "bootstrap", {
    session_id: String(session.id),
    workspace_path: runtime.sandbox_workspace_path,
    envs: runtime.envs,
    sandbox_runtime: sandboxRuntime ? runtimePublicMetadata(sandboxRuntime) : undefined,
    resources: await sessionResourceManifest(session),
    agent_config: agentConfig,
    agent_env: aliyunFcLoopAgentEnv(runtime, String(session.id), agentConfig)
  });
  return runtime;
}

export async function ensureAliyunFcSandboxRuntime(
  session: JsonRecord & { id: string; workspace_path: string },
  config: Extract<NormalizedSandboxRuntimeConfig, { provider: "aliyun_fc" }>,
  options: AliyunFcSandboxAcquireOptions = {}
) {
  if (!config.invoke_url) throw new Error("Aliyun FC sandbox requires sandbox.aliyun_fc.invoke_url for tool execution.");
  const metadata = session.metadata as JsonRecord;
  const existing = metadata.sandbox_runtime as RuntimeInfo | undefined;
  if (existing?.type === "aliyun_fc_sandbox" && isSameAliyunFcSandbox(existing, config)) return existing;
  await mkdir(String(session.workspace_path), { recursive: true });
  const acquired = options.acquireRuntime ? await options.acquireRuntime() : null;
  const runtime = acquired ?? aliyunFcSandboxRuntime(config, String(session.workspace_path), {
    sandbox_id: config.function_name || config.invoke_url,
    session_id: String(session.id)
  });
  await invokeAliyunFc(runtime, "bootstrap", {
    session_id: String(session.id),
    workspace_path: runtime.sandbox_workspace_path,
    envs: runtime.envs,
    resources: await sessionResourceManifest(session)
  });
  updateSessionMetadata(String(session.id), { runtime, sandbox_runtime: runtime });
  return runtime;
}

export function aliyunFcSandboxRuntime(
  config: Extract<NormalizedSandboxRuntimeConfig, { provider: "aliyun_fc" }>,
  workspacePath: string,
  input: { sandbox_id: string; session_id?: string; pool_member_id?: string; expires_at?: string; pooled?: boolean }
): AliyunFcSandboxRuntimeInfo {
  return {
    type: "aliyun_fc_sandbox",
    provider: "aliyun_fc",
    sandbox_id: input.sandbox_id,
    function_name: config.function_name,
    region: config.region,
    invoke_url: config.invoke_url,
    api_key: config.api_key || undefined,
    workspace_path: workspacePath,
    sandbox_workspace_path: config.workspace_path,
    timeout_ms: config.timeout_ms,
    envs: config.envs,
    metadata: {
      ...config.metadata,
      app: "managed-agents-platform",
      ...(input.session_id ? { session_id: input.session_id } : {}),
      ...(input.pool_member_id ? { pool_member_id: input.pool_member_id } : {})
    },
    pool_member_id: input.pool_member_id,
    pooled: input.pooled,
    expires_at: input.expires_at,
    lifecycle: { on_timeout: "expire", resume_strategy: "warm_fc_instance" }
  };
}

export function aliyunFcLoopAgentEnv(runtime: AliyunFcRuntimeInfo, sessionId: string, agentConfig: JsonRecord) {
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

export async function invokeAliyunFc(runtime: AliyunFcRuntimeInfo | AliyunFcSandboxRuntimeInfo, action: string, payload: JsonRecord) {
  return traceAsync("aliyun_fc.invoke", { action, function_name: runtime.function_name, region: runtime.region }, async () => {
    const controlTimeout = Number(process.env.MAPLE_ALIYUN_FC_CONTROL_TIMEOUT_MS || 20_000);
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
        function_name: runtime.function_name,
        region: runtime.region,
        workspace_path: runtime.sandbox_workspace_path,
        envs: runtime.envs,
        ...payload
      })
    });
    const text = await response.text();
    const body = parseJsonRecord(text);
    if (!response.ok) throw new Error(`Aliyun FC runtime error ${response.status}: ${text}`);
    if (body.ok === false) throw new Error(String(body.error || "Aliyun FC runtime returned ok=false"));
    return (body.result && typeof body.result === "object" ? body.result : body) as JsonRecord;
  });
}

function isSameAliyunFcRuntime(runtime: RuntimeInfo, config: Extract<NormalizedAgentRuntimeConfig, { provider: "aliyun_fc" }>) {
  if (runtime.type !== "aliyun_fc") return false;
  return (
    runtime.invoke_url === config.invoke_url &&
    (runtime.api_key ?? "") === config.api_key &&
    runtime.function_name === config.function_name &&
    runtime.region === config.region &&
    runtime.sandbox_workspace_path === config.workspace_path &&
    runtime.timeout_ms === config.timeout_ms &&
    JSON.stringify(runtime.envs) === JSON.stringify(config.envs)
  );
}

function isSameAliyunFcSandbox(runtime: RuntimeInfo, config: Extract<NormalizedSandboxRuntimeConfig, { provider: "aliyun_fc" }>) {
  if (runtime.type !== "aliyun_fc_sandbox") return false;
  return (
    runtime.invoke_url === config.invoke_url &&
    (runtime.api_key ?? "") === config.api_key &&
    runtime.function_name === config.function_name &&
    runtime.region === config.region &&
    runtime.sandbox_workspace_path === config.workspace_path &&
    runtime.timeout_ms === config.timeout_ms
  );
}

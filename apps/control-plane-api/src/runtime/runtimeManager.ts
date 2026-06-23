/* eslint-disable max-lines */
import { traceAsync } from "../perfTrace";
import { getEnvironment, getSession, getWorkspace, listWorkspaceSandboxPools } from "../store";
import type { JsonRecord } from "../types";
import { ensureDockerRuntime } from "./dockerRuntime";
import { ensureE2BRuntime } from "./e2bRuntime";
import { asRecord, runtimePublicMetadata, stringifyRecord } from "./runtimeCommon";
import { prepareSessionResources } from "./runtimeResources";
import type { AliyunFcRuntimeInfo, RuntimeInfo, VefaasRuntimeInfo, VefaasSandboxRuntimeInfo } from "./runtimeTypes";
import {
  normalizeSandboxConfig,
  type NormalizedAgentRuntimeConfig,
  type NormalizedSandboxRuntimeConfig
} from "./sandboxConfig";
import { installSessionPackages } from "./sandboxPackageInstall";
import { ensureAliyunFcRuntime, ensureAliyunFcSandboxRuntime, invokeAliyunFc, aliyunFcLoopAgentEnv } from "./aliyunFcRuntime";
import { claimPooledAliyunFcSandboxRuntime, claimPooledDockerRuntime, claimPooledSandboxRuntime, ensureAliyunFcSandboxProviderReady, replenishWorkspaceSandboxPool } from "./sandboxPoolManager";
import { ensureVefaasRuntime, invokeVefaas, vefaasLoopAgentConfig, vefaasLoopAgentEnv } from "./vefaasAgentRuntime";
import { ensureVefaasSandboxRuntime, killVefaasSandbox } from "./vefaasSandboxRuntime";

export async function ensureSessionRuntime(sessionId: string): Promise<RuntimeInfo> {
  return traceAsync("runtime.ensure_session", { session_id: sessionId }, async () => {
    const session = getSession(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);
    await prepareSessionResources(session);
    const environment = getEnvironment(String(session.environment_id));
    if (!environment) throw new Error(`Environment not found: ${session.environment_id}`);
    const config = normalizeSandboxConfig(withWorkspaceRuntimeCredentials(environment as JsonRecord));
    const agentRuntime = sessionAgentRuntimeConfig(session, config.agent_runtime) ?? config.agent_runtime;

    if (agentRuntime.provider === "vefaas") {
      // The vefaas agent loop runs its tools inside its own runtime container, so the host
      // sandbox is only needed for bridge tools. Bring the agent runtime up now (fast) and
      // pre-warm the sandbox in the background instead of blocking bootstrap on a ~12s
      // sandbox claim+resume that a simple turn never touches.
      const runtime = await ensureVefaasRuntime(session, agentRuntime);
      if (config.sandbox.provider === "e2b" || config.sandbox.provider === "vefaas") {
        void ensureConfiguredSandboxRuntime(session, config.sandbox).catch((error) => console.warn("sandbox prewarm failed", error));
      }
      return runtime;
    }
    if (agentRuntime.provider === "aliyun_fc") {
      const runtime = await ensureAliyunFcRuntime(session, agentRuntime);
      if (config.sandbox.provider === "e2b" || config.sandbox.provider === "vefaas" || config.sandbox.provider === "aliyun_fc") {
        void ensureConfiguredSandboxRuntime(session, config.sandbox).catch((error) => console.warn("sandbox prewarm failed", error));
      }
      return runtime;
    }
    if (agentRuntime.provider === "aws_lambda") return ensureAwsLambdaRuntime(agentRuntime);
    if (agentRuntime.provider === "local_docker") return ensureConfiguredSandboxRuntime(session, localDockerSandboxFromAgentRuntime(agentRuntime));
    return ensureConfiguredSandboxRuntime(session, config.sandbox);
  });
}

export async function ensureSessionSandboxRuntime(sessionId: string): Promise<RuntimeInfo> {
  return traceAsync("runtime.ensure_sandbox", { session_id: sessionId }, async () => {
    const session = getSession(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);
    await prepareSessionResources(session);
    const environment = getEnvironment(String(session.environment_id));
    if (!environment) throw new Error(`Environment not found: ${session.environment_id}`);
    const config = normalizeSandboxConfig(withWorkspaceRuntimeCredentials(environment as JsonRecord));
    return ensureConfiguredSandboxRuntime(session, config.sandbox);
  });
}

export function sessionUsesVefaasAgentRuntime(sessionId: string) {
  const session = getSession(sessionId);
  if (!session) return false;
  const metadataRuntime = asRecord(asRecord(session.metadata).agent_runtime);
  if (String(metadataRuntime.provider || metadataRuntime.type || "") === "vefaas") return true;
  const environment = getEnvironment(String(session.environment_id));
  if (!environment) return false;
  const config = normalizeSandboxConfig(withWorkspaceRuntimeCredentials(environment as JsonRecord));
  return (sessionAgentRuntimeConfig(session, config.agent_runtime) ?? config.agent_runtime).provider === "vefaas";
}

export function sessionUsesAliyunFcAgentRuntime(sessionId: string) {
  const session = getSession(sessionId);
  if (!session) return false;
  const metadataRuntime = asRecord(asRecord(session.metadata).agent_runtime);
  if (String(metadataRuntime.provider || metadataRuntime.type || "") === "aliyun_fc") return true;
  const environment = getEnvironment(String(session.environment_id));
  if (!environment) return false;
  const config = normalizeSandboxConfig(withWorkspaceRuntimeCredentials(environment as JsonRecord));
  return (sessionAgentRuntimeConfig(session, config.agent_runtime) ?? config.agent_runtime).provider === "aliyun_fc";
}

export async function runAgentLoopOnVefaas(sessionId: string, text: string) {
  return traceAsync("runtime.vefaas_agent_run", { session_id: sessionId, input_length: text.length }, async () => {
    const startedAt = Date.now();
    const session = getSession(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);
    await ensureSessionRuntime(sessionId);
    const readySession = getSession(sessionId);
    if (!readySession) throw new Error(`Session not found after runtime bootstrap: ${sessionId}`);
    const agentRuntime = asRecord(asRecord(readySession.metadata).agent_runtime);
    if (String(agentRuntime.type || agentRuntime.provider || "") !== "vefaas") {
      throw new Error(`Session ${sessionId} is not bound to a veFaaS agent runtime.`);
    }
    const runtime = agentRuntime as unknown as VefaasRuntimeInfo;
    const agentConfig = vefaasLoopAgentConfig(readySession as JsonRecord);
    const token = String(asRecord(readySession.metadata).runtime_tool_bridge_token || "");
    if (!token) throw new Error(`Session ${sessionId} is missing runtime_tool_bridge_token.`);
    const sandboxRuntime = asRecord(asRecord(readySession.metadata).sandbox_runtime ?? asRecord(readySession.metadata).runtime);
    const hasSandboxRuntime = Object.keys(sandboxRuntime).length > 0;
    const controlPlanePrepareMs = Date.now() - startedAt;
    const result = await invokeVefaas(runtime, "run", {
      session_id: sessionId,
      input: { type: "user.message", text },
      agent_config: agentConfig,
      agent_env: vefaasLoopAgentEnv(runtime, sessionId, agentConfig),
      tool_bridge: {
        url: runtimeToolBridgeUrl(sessionId),
        token
      },
      event_callback: {
        url: runtimeLoopEventsUrl(sessionId),
        token
      },
      sandbox_runtime: hasSandboxRuntime ? runtimePublicMetadata(sandboxRuntime as unknown as RuntimeInfo) : undefined
    });
    return withControlPlaneTiming(result, {
      control_plane_prepare_ms: controlPlanePrepareMs,
      sandbox_runtime_snapshot: hasSandboxRuntime
    });
  });
}

export async function runAgentLoopOnAliyunFc(sessionId: string, text: string) {
  return traceAsync("runtime.aliyun_fc_agent_run", { session_id: sessionId, input_length: text.length }, async () => {
    const startedAt = Date.now();
    const session = getSession(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);
    await ensureSessionRuntime(sessionId);
    const readySession = getSession(sessionId);
    if (!readySession) throw new Error(`Session not found after runtime bootstrap: ${sessionId}`);
    const agentRuntime = asRecord(asRecord(readySession.metadata).agent_runtime);
    if (String(agentRuntime.type || agentRuntime.provider || "") !== "aliyun_fc") {
      throw new Error(`Session ${sessionId} is not bound to an Aliyun FC agent runtime.`);
    }
    const runtime = agentRuntime as unknown as AliyunFcRuntimeInfo;
    const agentConfig = vefaasLoopAgentConfig(readySession as JsonRecord);
    const token = String(asRecord(readySession.metadata).runtime_tool_bridge_token || "");
    if (!token) throw new Error(`Session ${sessionId} is missing runtime_tool_bridge_token.`);
    const sandboxRuntime = asRecord(asRecord(readySession.metadata).sandbox_runtime ?? asRecord(readySession.metadata).runtime);
    const hasSandboxRuntime = Object.keys(sandboxRuntime).length > 0;
    const controlPlanePrepareMs = Date.now() - startedAt;
    const result = await invokeAliyunFc(runtime, "run", {
      session_id: sessionId,
      input: { type: "user.message", text },
      agent_config: agentConfig,
      agent_env: aliyunFcLoopAgentEnv(runtime, sessionId, agentConfig),
      tool_bridge: {
        url: runtimeToolBridgeUrl(sessionId),
        token
      },
      event_callback: {
        url: runtimeLoopEventsUrl(sessionId),
        token
      },
      sandbox_runtime: hasSandboxRuntime ? runtimePublicMetadata(sandboxRuntime as unknown as RuntimeInfo) : undefined
    });
    return withControlPlaneTiming(result, {
      control_plane_prepare_ms: controlPlanePrepareMs,
      sandbox_runtime_snapshot: hasSandboxRuntime
    });
  });
}

function withControlPlaneTiming(result: JsonRecord, timings: JsonRecord): JsonRecord {
  const existing = asRecord(result.timings);
  return { ...result, timings: { ...existing, ...timings } };
}

export async function killSessionSandboxRuntime(sessionId: string) {
  const session = getSession(sessionId);
  if (!session) return false;
  const runtime = asRecord(asRecord(session.metadata).sandbox_runtime ?? asRecord(session.metadata).runtime);
  if (String(runtime.type || "") !== "vefaas_sandbox") return false;
  const environment = getEnvironment(String(session.environment_id));
  if (!environment) return false;
  const config = normalizeSandboxConfig(withWorkspaceRuntimeCredentials(environment as JsonRecord));
  if (config.sandbox.provider !== "vefaas") return false;
  await killVefaasSandbox(runtime as unknown as VefaasSandboxRuntimeInfo, config.sandbox);
  return true;
}

async function ensureConfiguredSandboxRuntime(session: JsonRecord & { id: string; workspace_path: string; environment_id: string }, config: NormalizedSandboxRuntimeConfig): Promise<RuntimeInfo> {
  const configs = [config, ...workspaceSandboxFallbackConfigs(session, config.provider)];
  let lastError: unknown;
  for (const candidate of configs) {
    try {
      return await ensureSingleConfiguredSandboxRuntime(session, candidate);
    } catch (error) {
      lastError = error;
      console.warn("[runtime] sandbox provider failed, trying fallback if available", { session_id: session.id, provider: candidate.provider, error: error instanceof Error ? error.message : String(error) });
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError || "sandbox_runtime_unavailable"));
}

async function ensureSingleConfiguredSandboxRuntime(session: JsonRecord & { id: string; workspace_path: string; environment_id: string }, config: NormalizedSandboxRuntimeConfig): Promise<RuntimeInfo> {
  if (config.provider === "e2b") return ensureE2BRuntime(session, config);
  if (config.provider === "daytona") return ensureDaytonaSandboxRuntime(config);
  if (config.provider === "vercel") return ensureVercelSandboxRuntime(config);
  if (config.provider === "vefaas") {
    const canClaimPool = process.env.MAPLE_SANDBOX_POOL_CLAIM !== "false";
    const runtime = await ensureVefaasSandboxRuntime(session, config, { acquireRuntime: canClaimPool ? () => claimPooledSandboxRuntime(session, config) : undefined });
    await installSessionPackages(session, runtime, config.packages);
    const workspaceId = String(session.workspace_id || asRecord(session.metadata).workspace_id || "");
    if (workspaceId && process.env.MAPLE_SANDBOX_POOL_AUTOREPLENISH !== "false") void replenishWorkspaceSandboxPool(workspaceId).catch(() => undefined);
    return runtime;
  }
  if (config.provider === "aliyun_fc") {
    const canClaimPool = process.env.MAPLE_SANDBOX_POOL_CLAIM !== "false";
    const workspaceId = String(session.workspace_id || asRecord(session.metadata).workspace_id || "");
    const activeConfig = workspaceId ? await ensureAliyunFcSandboxProviderReady(workspaceId, config) : config;
    const runtime = await ensureAliyunFcSandboxRuntime(session, activeConfig, { acquireRuntime: canClaimPool ? () => claimPooledAliyunFcSandboxRuntime(session, activeConfig) : undefined });
    if (config.packages.length) console.warn("[runtime] Aliyun FC sandbox package installation is not implemented; packages are expected in the FC image.", { session_id: session.id });
    if (workspaceId && process.env.MAPLE_SANDBOX_POOL_AUTOREPLENISH !== "false") void replenishWorkspaceSandboxPool(workspaceId).catch(() => undefined);
    return runtime;
  }
  return ensureDockerRuntime(session, config, { acquireRuntime: () => claimPooledDockerRuntime(session, config) });
}

function workspaceSandboxFallbackConfigs(session: JsonRecord, currentProvider: string): NormalizedSandboxRuntimeConfig[] {
  const workspaceId = String(session.workspace_id || asRecord(session.metadata).workspace_id || "");
  if (!workspaceId) return [];
  const workspace = getWorkspace(workspaceId) as JsonRecord | null;
  const workspaceConfig = asRecord(workspace?.config);
  const sandboxConfig = asRecord(workspaceConfig.sandbox_config);
  const pools = listWorkspaceSandboxPools(workspaceId)
    .filter((pool) => pool.provider !== currentProvider)
    .sort((a, b) => poolRank(a) - poolRank(b));
  return pools.map((pool) => {
    const poolConfig = asRecord(pool.config);
    const provider = String(pool.provider);
    const normalized = normalizeSandboxConfig(withWorkspaceRuntimeCredentials({
      workspace_id: workspaceId,
      config: {
        sandbox_provider: provider,
        sandbox: {
          provider,
          e2b: { ...asRecord(sandboxConfig.e2b ?? sandboxConfig), ...poolConfig },
          daytona: { ...asRecord(sandboxConfig.daytona ?? sandboxConfig.daytona_sandbox ?? sandboxConfig), ...poolConfig },
          local_docker: { ...asRecord(sandboxConfig.local_docker ?? sandboxConfig.docker ?? sandboxConfig), ...poolConfig },
          vefaas: { ...asRecord(sandboxConfig.vefaas ?? sandboxConfig.vefaas_sandbox ?? sandboxConfig), ...poolConfig },
          aliyun_fc: { ...asRecord(sandboxConfig.aliyun_fc ?? sandboxConfig.aliyun ?? sandboxConfig), ...poolConfig }
        }
      }
    } as JsonRecord));
    return normalized.sandbox;
  });
}

function poolRank(pool: { role?: string; priority?: number }) {
  return (pool.role === "standby" ? 10_000 : 0) + (Number.isFinite(Number(pool.priority)) ? Number(pool.priority) : 0);
}

export function withWorkspaceRuntimeCredentials(environment: JsonRecord): JsonRecord {
  const config = asRecord(environment.config);
  const workspaceId = String(environment.workspace_id || "");
  if (!workspaceId) return config;
  const workspace = getWorkspace(workspaceId) as JsonRecord | null;
  const workspaceConfig = asRecord(workspace?.config);
  const providerCredentials = asRecord(workspaceConfig.provider_credentials);
  const sandboxConfig = asRecord(workspaceConfig.sandbox_config);
  const vefaasCreds = asRecord(providerCredentials.vefaas);
  const vefaasSandboxCreds = asRecord(providerCredentials.vefaas_sandbox);
  const e2bCreds = asRecord(providerCredentials.e2b);
  const daytonaCreds = asRecord(providerCredentials.daytona);
  const aliyunCreds = asRecord(providerCredentials.aliyun ?? providerCredentials.alibaba_cloud);
  const sandbox = asRecord(config.sandbox);
  const agentRuntime = asRecord(config.agent_runtime ?? config.agentRuntime);
  const e2b = asRecord(sandbox.e2b ?? config.e2b);
  const daytona = asRecord(sandbox.daytona ?? sandbox.daytona_sandbox ?? config.daytona ?? config.daytona_sandbox);
  const vefaas = asRecord(sandbox.vefaas ?? sandbox.vefaas_sandbox ?? config.vefaas_sandbox);
  const aliyun = asRecord(sandbox.aliyun_fc ?? sandbox.aliyun ?? config.aliyun_fc ?? config.aliyun);
  const agentAliyun = asRecord(agentRuntime.aliyun_fc ?? agentRuntime.aliyun);
  const workspaceVefaas = asRecord(sandboxConfig.vefaas ?? sandboxConfig.vefaas_sandbox ?? sandboxConfig);
  const workspaceDaytona = asRecord(sandboxConfig.daytona ?? sandboxConfig.daytona_sandbox ?? sandboxConfig);
  const workspaceAliyun = asRecord(sandboxConfig.aliyun_fc ?? sandboxConfig.aliyun ?? sandboxConfig);
  return {
    ...config,
    agent_runtime: {
      ...agentRuntime,
      aliyun_fc: {
        ...agentAliyun,
        access_key_id: agentAliyun.access_key_id || agentAliyun.accessKeyId || aliyunCreds.ALIYUN_ACCESS_KEY_ID || aliyunCreds.access_key_id || aliyunCreds.ak,
        access_key_secret: agentAliyun.access_key_secret || agentAliyun.accessKeySecret || aliyunCreds.ALIYUN_ACCESS_KEY_SECRET || aliyunCreds.access_key_secret || aliyunCreds.sk,
        region: agentAliyun.region || aliyunCreds.ALIYUN_REGION || aliyunCreds.region
      }
    },
    sandbox: {
      ...sandbox,
      e2b: {
        ...e2b,
        api_key: e2b.api_key || e2bCreds.E2B_API_KEY
      },
      daytona: {
        ...daytona,
        ...workspaceDaytona,
        server_url: daytona.server_url || workspaceDaytona.server_url || daytonaCreds.DAYTONA_SERVER_URL,
        api_key: daytona.api_key || workspaceDaytona.api_key || daytonaCreds.DAYTONA_API_KEY,
        workspace_class: daytona.workspace_class || workspaceDaytona.workspace_class || daytonaCreds.DAYTONA_WORKSPACE_CLASS,
        timeout_ms: daytona.timeout_ms || workspaceDaytona.timeout_ms || daytonaCreds.DAYTONA_TIMEOUT_MS
      },
      vefaas: {
        ...vefaas,
        ...workspaceVefaas,
        access_key: vefaas.access_key || vefaasSandboxCreds.VOLCENGINE_ACCESS_KEY || vefaasCreds.VOLCENGINE_ACCESS_KEY,
        secret_key: vefaas.secret_key || vefaasSandboxCreds.VOLCENGINE_SECRET_KEY || vefaasCreds.VOLCENGINE_SECRET_KEY,
        region: vefaas.region || workspaceVefaas.region || vefaasSandboxCreds.VEFAAS_REGION || vefaasCreds.VEFAAS_REGION,
        function_id: vefaas.function_id || workspaceVefaas.function_id || vefaasSandboxCreds.VEFAAS_SANDBOX_FUNCTION_ID,
        gateway_url: vefaas.gateway_url || workspaceVefaas.gateway_url || vefaasSandboxCreds.VEFAAS_SANDBOX_GATEWAY_URL,
        api_token: vefaas.api_token || workspaceVefaas.api_token || vefaasSandboxCreds.VEFAAS_SANDBOX_API_TOKEN
      },
      aliyun_fc: {
        ...aliyun,
        ...workspaceAliyun,
        access_key_id: aliyun.access_key_id || workspaceAliyun.access_key_id || aliyunCreds.ALIYUN_ACCESS_KEY_ID || aliyunCreds.access_key_id || aliyunCreds.ak,
        access_key_secret: aliyun.access_key_secret || workspaceAliyun.access_key_secret || aliyunCreds.ALIYUN_ACCESS_KEY_SECRET || aliyunCreds.access_key_secret || aliyunCreds.sk,
        region: aliyun.region || workspaceAliyun.region || aliyunCreds.ALIYUN_REGION || aliyunCreds.region,
        function_name: aliyun.function_name || workspaceAliyun.function_name || aliyunCreds.ALIYUN_FC_FUNCTION_NAME,
        invoke_url: aliyun.invoke_url || workspaceAliyun.invoke_url || aliyunCreds.ALIYUN_FC_INVOKE_URL,
        api_key: aliyun.api_key || workspaceAliyun.api_key || aliyunCreds.ALIYUN_FC_API_KEY
      }
    }
  };
}

function sessionAgentRuntimeConfig(session: JsonRecord, fallback: NormalizedAgentRuntimeConfig): NormalizedAgentRuntimeConfig | null {
  const metadata = asRecord(session.metadata);
  const agentRuntime = asRecord(metadata.agent_runtime);
  const provider = String(agentRuntime.provider || agentRuntime.type || "");
  if (provider === "local") return { provider: "local" };
  if (provider === "local_docker" || provider === "docker") {
    return {
      provider: "local_docker",
      image: String(agentRuntime.image || "node:22-bookworm"),
      networking: asRecord(agentRuntime.networking),
      timeout_ms: Number(agentRuntime.timeout_ms || 120_000),
      envs: stringifyRecord(asRecord(agentRuntime.envs))
    };
  }
  if (provider === "aws_lambda") {
    return {
      provider: "aws_lambda",
      function_name: String(agentRuntime.function_name || (fallback.provider === "aws_lambda" ? fallback.function_name : "")),
      region: String(agentRuntime.region || (fallback.provider === "aws_lambda" ? fallback.region : "us-east-1")),
      qualifier: String(agentRuntime.qualifier || (fallback.provider === "aws_lambda" ? fallback.qualifier : "")),
      timeout_ms: Number(agentRuntime.timeout_ms || (fallback.provider === "aws_lambda" ? fallback.timeout_ms : 120_000)),
      envs: stringifyRecord({ ...(fallback.provider === "aws_lambda" ? fallback.envs : {}), ...asRecord(agentRuntime.envs) })
    };
  }
  if (provider === "aliyun_fc") {
    return {
      provider: "aliyun_fc",
      access_key_id: String(agentRuntime.access_key_id || agentRuntime.accessKeyId || (fallback.provider === "aliyun_fc" ? fallback.access_key_id : "")),
      access_key_secret: String(agentRuntime.access_key_secret || agentRuntime.accessKeySecret || (fallback.provider === "aliyun_fc" ? fallback.access_key_secret : "")),
      region: String(agentRuntime.region || (fallback.provider === "aliyun_fc" ? fallback.region : "cn-hangzhou")),
      function_name: String(agentRuntime.function_name || agentRuntime.functionName || (fallback.provider === "aliyun_fc" ? fallback.function_name : "")),
      invoke_url: String(agentRuntime.invoke_url || agentRuntime.invokeUrl || (fallback.provider === "aliyun_fc" ? fallback.invoke_url : "")),
      api_key: String(agentRuntime.api_key || agentRuntime.apiKey || (fallback.provider === "aliyun_fc" ? fallback.api_key : "")),
      workspace_path: String(agentRuntime.sandbox_workspace_path || agentRuntime.workspace_path || (fallback.provider === "aliyun_fc" ? fallback.workspace_path : "/workspace")),
      timeout_ms: Number(agentRuntime.timeout_ms || (fallback.provider === "aliyun_fc" ? fallback.timeout_ms : 120_000)),
      envs: stringifyRecord({ ...(fallback.provider === "aliyun_fc" ? fallback.envs : {}), ...asRecord(agentRuntime.envs) })
    };
  }
  if (provider !== "vefaas") return null;
  return {
    provider: "vefaas",
    invoke_url: String(agentRuntime.invoke_url || (fallback.provider === "vefaas" ? fallback.invoke_url : "")),
    api_key: String(agentRuntime.api_key || (fallback.provider === "vefaas" ? fallback.api_key : "")),
    function_id: String(agentRuntime.function_id || agentRuntime.cloud_function_id || (fallback.provider === "vefaas" ? fallback.function_id : "")),
    region: String(agentRuntime.region || (fallback.provider === "vefaas" ? fallback.region : "cn-beijing")),
    workspace_path: String(agentRuntime.sandbox_workspace_path || agentRuntime.workspace_path || (fallback.provider === "vefaas" ? fallback.workspace_path : "/workspace")),
    timeout_ms: Number(agentRuntime.timeout_ms || (fallback.provider === "vefaas" ? fallback.timeout_ms : 120_000)),
    envs: stringifyRecord({ ...(fallback.provider === "vefaas" ? fallback.envs : {}), ...asRecord(agentRuntime.envs) })
  };
}

function localDockerSandboxFromAgentRuntime(config: Extract<NormalizedAgentRuntimeConfig, { provider: "local_docker" }>): Extract<NormalizedSandboxRuntimeConfig, { provider: "local_docker" }> {
  return {
    provider: "local_docker",
    image: config.image,
    networking: config.networking,
    sandbox_options: ["docker"]
  };
}

function runtimeBridgeBaseUrl() {
  const base =
    process.env.MAPLE_RUNTIME_TOOL_BRIDGE_BASE_URL ||
    process.env.MAPLE_CONTROL_PLANE_BASE_URL ||
    `http://${process.env.HOST || "127.0.0.1"}:${process.env.PORT || "27951"}`;
  return base.replace(/\/$/, "");
}

function runtimeToolBridgeUrl(sessionId: string) {
  return `${runtimeBridgeBaseUrl()}/v1/runtime/sessions/${encodeURIComponent(sessionId)}/tools`;
}

function runtimeLoopEventsUrl(sessionId: string) {
  return `${runtimeBridgeBaseUrl()}/v1/runtime/sessions/${encodeURIComponent(sessionId)}/loop_events`;
}

async function ensureAwsLambdaRuntime(config: Extract<NormalizedAgentRuntimeConfig, { provider: "aws_lambda" }>): Promise<RuntimeInfo> {
  if (!config.function_name) {
    throw new Error("AWS Lambda agent runtime requires agent_runtime.aws_lambda.function_name or AWS_LAMBDA_FUNCTION_NAME.");
  }
  throw new Error("AWS Lambda agent runtime provider is configured but the invoke adapter is not implemented yet.");
}

async function ensureVercelSandboxRuntime(config: Extract<NormalizedSandboxRuntimeConfig, { provider: "vercel" }>): Promise<RuntimeInfo> {
  if (!config.project_id) {
    throw new Error("Vercel sandbox requires sandbox.vercel.project_id or VERCEL_SANDBOX_PROJECT_ID.");
  }
  throw new Error("Vercel sandbox provider is configured but the sandbox adapter is not implemented yet.");
}

async function ensureDaytonaSandboxRuntime(config: Extract<NormalizedSandboxRuntimeConfig, { provider: "daytona" }>): Promise<RuntimeInfo> {
  if (!config.server_url) {
    throw new Error("Daytona sandbox requires sandbox.daytona.server_url or DAYTONA_SERVER_URL.");
  }
  throw new Error("Daytona sandbox provider is configured but the sandbox adapter is not implemented yet.");
}

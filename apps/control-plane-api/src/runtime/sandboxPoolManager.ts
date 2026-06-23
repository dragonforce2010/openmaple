/* eslint-disable max-lines */
import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { sessionsDir } from "../paths";
import {
  countSandboxPoolStandbyCapacity,
  createSandboxPoolMember,
  db,
  expireSandboxPoolMembers,
  fromJson,
  getWorkspace,
  getWorkspaceSandboxPool,
  hashString,
  listWorkspaceSandboxPools,
  markSandboxPoolMemberClaimed,
  markSandboxPoolMemberFailed,
  markSandboxPoolMemberReady,
  now,
  toJson,
  updateSandboxPoolMemberRuntime
} from "../store";
import type { JsonRecord } from "../types";
import { createDockerRuntimeContainer } from "./dockerRuntime";
import { aliyunFcSandboxRuntime } from "./aliyunFcRuntime";
import { asRecord } from "./runtimeCommon";
import type { AliyunFcSandboxRuntimeInfo, VefaasSandboxRuntimeInfo } from "./runtimeTypes";
import { normalizeSandboxConfig, type NormalizedSandboxRuntimeConfig } from "./sandboxConfig";
import {
  createVefaasSandbox,
  describeVefaasSandbox,
  prepareVefaasSandboxRuntime,
  setVefaasSandboxTimeout
} from "./vefaasSandboxRuntime";

type VefaasSandboxConfig = Extract<NormalizedSandboxRuntimeConfig, { provider: "vefaas" }>;
type LocalDockerSandboxConfig = Extract<NormalizedSandboxRuntimeConfig, { provider: "local_docker" }>;
type AliyunFcSandboxConfig = Extract<NormalizedSandboxRuntimeConfig, { provider: "aliyun_fc" }>;

const execFileAsync = promisify(execFile);

export async function replenishWorkspaceSandboxPool(workspaceId: string) {
  const pools = listWorkspaceSandboxPools(workspaceId);
  if (!pools.length) return { workspace_id: workspaceId, created: 0, reason: "workspace_not_found" };
  const results = [];
  for (const pool of pools) {
    expireSandboxPoolMembers(workspaceId, pool.provider);
    if (pool.provider === "local_docker") {
      results.push(await replenishLocalDockerSandboxPool(workspaceId, pool.desired_size, pool.standby_ttl_ms));
      continue;
    }
    if (pool.provider === "aliyun_fc") {
      results.push(await replenishAliyunFcSandboxPool(workspaceId, pool.desired_size, pool.standby_ttl_ms));
      continue;
    }
    if (pool.provider !== "vefaas") {
      results.push({ workspace_id: workspaceId, provider: pool.provider, created: 0, reason: "provider_not_implemented" });
      continue;
    }
    const config = workspaceSandboxRuntimeConfig(workspaceId, "vefaas");
    if (config.provider !== "vefaas") {
      results.push({ workspace_id: workspaceId, provider: pool.provider, created: 0, reason: "provider_config_missing" });
      continue;
    }
    const current = countSandboxPoolStandbyCapacity(workspaceId, "vefaas");
    const missing = Math.max(0, pool.desired_size - current);
    const created = await runLimited(Array.from({ length: missing }), 5, () => provisionVefaasStandby(workspaceId, config, pool.standby_ttl_ms));
    results.push({ workspace_id: workspaceId, provider: "vefaas", desired_size: pool.desired_size, created: created.filter(Boolean).length });
  }
  return { workspace_id: workspaceId, pools: results, created: results.reduce((sum, item) => sum + Number((item as JsonRecord).created || 0), 0) };
}

async function replenishLocalDockerSandboxPool(workspaceId: string, desiredSize: number, ttlMs: number) {
  const config = workspaceSandboxRuntimeConfig(workspaceId, "local_docker");
  if (config.provider !== "local_docker") return { workspace_id: workspaceId, provider: "local_docker", created: 0, reason: "provider_config_missing" };
  const current = countSandboxPoolStandbyCapacity(workspaceId, "local_docker");
  const missing = Math.max(0, desiredSize - current);
  const created = await runLimited(Array.from({ length: missing }), 10, () => provisionLocalDockerStandby(workspaceId, config, ttlMs));
  return { workspace_id: workspaceId, provider: "local_docker", desired_size: desiredSize, created: created.filter(Boolean).length };
}

async function replenishAliyunFcSandboxPool(workspaceId: string, desiredSize: number, ttlMs: number) {
  const rawConfig = workspaceSandboxRuntimeConfig(workspaceId, "aliyun_fc");
  if (rawConfig.provider !== "aliyun_fc") return { workspace_id: workspaceId, provider: "aliyun_fc", created: 0, reason: "provider_config_missing" };
  const config = await ensureAliyunFcSandboxProviderReady(workspaceId, rawConfig);
  const current = countSandboxPoolStandbyCapacity(workspaceId, "aliyun_fc");
  const missing = Math.max(0, desiredSize - current);
  const created = await runLimited(Array.from({ length: missing }), 10, () => provisionAliyunFcStandby(workspaceId, config, ttlMs));
  return { workspace_id: workspaceId, provider: "aliyun_fc", desired_size: desiredSize, created: created.filter(Boolean).length };
}

export async function ensureAliyunFcSandboxProviderReady(workspaceId: string, config: AliyunFcSandboxConfig): Promise<AliyunFcSandboxConfig> {
  if (config.invoke_url) return config;
  const deployScript = process.env.MAPLE_ALIYUN_FC_SANDBOX_DEPLOY_SCRIPT || process.env.MAPLE_ALIYUN_FC_RUNTIME_DEPLOY_SCRIPT || "infra/aliyun/deploy_aliyun_fc_runtime.mjs";
  const functionName = config.function_name || `maple-sbx-${workspaceId.replace(/[^a-zA-Z0-9-]/g, "").toLowerCase().slice(0, 24)}-${Date.now()}`;
  const payload = await runAliyunFcDeployScript(deployScript, {
    ...process.env,
    ALIYUN_ACCESS_KEY_ID: config.access_key_id,
    ALIYUN_ACCESS_KEY_SECRET: config.access_key_secret,
    ALIYUN_REGION: config.region || "cn-hangzhou",
    MAPLE_ALIYUN_FC_COMPONENT: "agent-sandbox",
    MAPLE_ALIYUN_FC_FUNCTION_NAME: functionName,
    MAPLE_ALIYUN_FC_MEMORY_MB: String(Number(process.env.MAPLE_ALIYUN_FC_SANDBOX_MEMORY_MB || 1024)),
    MAPLE_RUNTIME_FUNCTION_MAX_CONCURRENCY: String(Number(process.env.MAPLE_ALIYUN_FC_SANDBOX_CONCURRENCY || 20)),
    MAPLE_ALIYUN_FC_RUNTIME_ENVS: JSON.stringify({
      ...config.envs,
      MAPLE_WORKSPACE_ID: workspaceId,
      MAPLE_AGENT_RUNTIME_ROLE: "sandbox",
      MAPLE_AGENT_LOOP_RUNTIME: "managed-agents-platform-aliyun-fc-sandbox",
      MAPLE_SKIP_CLAUDE_AGENT_SDK_INSTALL: "true"
    })
  });
  const invokeUrl = String(payload.invoke_url || "").replace(/\/+$/, "");
  if (!invokeUrl) throw new Error(`Aliyun FC sandbox deploy script returned incomplete payload: ${JSON.stringify(payload)}`);
  const nextConfig = {
    ...config,
    function_name: String(payload.function_name || payload.function_id || functionName),
    invoke_url: invokeUrl,
    region: String(payload.region || config.region || "cn-hangzhou")
  };
  updateWorkspaceAliyunFcSandboxConfig(workspaceId, nextConfig);
  return nextConfig;
}

export async function claimPooledDockerRuntime(
  session: JsonRecord & { id: string; workspace_path: string },
  config: LocalDockerSandboxConfig
) {
  const workspaceId = String(session.workspace_id || asRecord(session.metadata).workspace_id || "");
  if (!workspaceId) return null;
  const pool = sandboxPoolForProvider(workspaceId, "local_docker");
  if (!pool) return null;
  expireSandboxPoolMembers(workspaceId, "local_docker");
  const expiresAt = expiresIn(pool.standby_ttl_ms);
  const member = markSandboxPoolMemberClaimed({
    workspace_id: workspaceId,
    provider: "local_docker",
    session_id: session.id,
    agent_id: String(session.agent_id || ""),
    expires_at: expiresAt
  });
  if (!member) {
    void replenishWorkspaceSandboxPool(workspaceId).catch(() => undefined);
    return null;
  }
  try {
    const runtime = await createDockerRuntimeContainer({
      name: `maple_pool_${String(member.id).replace(/[^a-zA-Z0-9_.-]/g, "_")}_${Date.now()}_${String(session.id).replace(/[^a-zA-Z0-9_.-]/g, "_")}`,
      image: config.image,
      workspacePath: session.workspace_path,
      networking: config.networking
    });
    updateSandboxPoolMemberRuntime(member.id, {
      sandbox_id: runtime.container_id,
      config: { ...poolMemberConfig(config, pool.standby_ttl_ms), container_name: runtime.container_name, session_id: session.id }
    });
    void replenishWorkspaceSandboxPool(workspaceId).catch(() => undefined);
    return runtime;
  } catch (error) {
    markSandboxPoolMemberFailed(member.id, error);
    void replenishWorkspaceSandboxPool(workspaceId).catch(() => undefined);
    return null;
  }
}

export async function claimPooledSandboxRuntime(
  session: JsonRecord & { id: string; workspace_path: string },
  config: VefaasSandboxConfig
) {
  const workspaceId = String(session.workspace_id || asRecord(session.metadata).workspace_id || "");
  if (!workspaceId) return null;
  const pool = sandboxPoolForProvider(workspaceId, "vefaas");
  if (!pool) return null;
  expireSandboxPoolMembers(workspaceId, "vefaas");
  const expiresAt = expiresIn(pool.standby_ttl_ms);
  const member = markSandboxPoolMemberClaimed({
    workspace_id: workspaceId,
    provider: "vefaas",
    session_id: session.id,
    agent_id: String(session.agent_id || ""),
    expires_at: expiresAt
  });
  if (!member) {
    void replenishWorkspaceSandboxPool(workspaceId).catch(() => undefined);
    return null;
  }
  const runtime = vefaasRuntimeFromSandbox(member.sandbox_id, config, session.workspace_path, {
    pool_member_id: member.id,
    session_id: session.id,
    workspace_id: workspaceId,
    expires_at: expiresAt,
    timeout_ms: pool.standby_ttl_ms,
    pooled: true
  });
  try {
    await describeVefaasSandbox(runtime, config);
    await setVefaasSandboxTimeout(runtime, { ...config, timeout_ms: pool.standby_ttl_ms });
  } catch (error) {
    markSandboxPoolMemberFailed(member.id, error);
    void replenishWorkspaceSandboxPool(workspaceId).catch(() => undefined);
    return null;
  }
  void replenishWorkspaceSandboxPool(workspaceId).catch(() => undefined);
  return runtime;
}

export async function claimPooledAliyunFcSandboxRuntime(
  session: JsonRecord & { id: string; workspace_path: string },
  config: AliyunFcSandboxConfig
) {
  const workspaceId = String(session.workspace_id || asRecord(session.metadata).workspace_id || "");
  if (!workspaceId) return null;
  const pool = sandboxPoolForProvider(workspaceId, "aliyun_fc");
  if (!pool) return null;
  expireSandboxPoolMembers(workspaceId, "aliyun_fc");
  const expiresAt = expiresIn(pool.standby_ttl_ms);
  const member = markSandboxPoolMemberClaimed({
    workspace_id: workspaceId,
    provider: "aliyun_fc",
    session_id: session.id,
    agent_id: String(session.agent_id || ""),
    expires_at: expiresAt
  });
  if (!member) {
    void replenishWorkspaceSandboxPool(workspaceId).catch(() => undefined);
    return null;
  }
  const runtime = aliyunFcSandboxRuntime(config, session.workspace_path, {
    sandbox_id: member.sandbox_id || config.function_name || config.invoke_url,
    pool_member_id: member.id,
    session_id: session.id,
    expires_at: expiresAt,
    pooled: true
  });
  void replenishWorkspaceSandboxPool(workspaceId).catch(() => undefined);
  return runtime;
}

function workspaceSandboxRuntimeConfig(workspaceId: string, requestedProvider?: string): NormalizedSandboxRuntimeConfig {
  const workspace = getWorkspace(workspaceId) as JsonRecord | null;
  const workspaceConfig = asRecord(workspace?.config);
  const providerCredentials = asRecord(workspaceConfig.provider_credentials);
  const sandboxConfig = asRecord(workspaceConfig.sandbox_config);
  const poolConfig = requestedProvider ? asRecord(listWorkspaceSandboxPools(workspaceId).find((pool) => pool.provider === requestedProvider)?.config) : {};
  const provider = String(requestedProvider || workspace?.sandbox_provider || workspaceConfig.sandbox_provider || "e2b");
  const vefaasCreds = asRecord(providerCredentials.vefaas);
  const vefaasSandboxCreds = asRecord(providerCredentials.vefaas_sandbox);
  const e2bCreds = asRecord(providerCredentials.e2b);
  const aliyunCreds = asRecord(providerCredentials.aliyun ?? providerCredentials.alibaba_cloud);
  const workspaceVefaas = asRecord(sandboxConfig.vefaas ?? sandboxConfig.vefaas_sandbox ?? sandboxConfig);
  const workspaceE2b = asRecord(sandboxConfig.e2b ?? sandboxConfig);
  const localDocker = asRecord(sandboxConfig.local_docker ?? sandboxConfig.docker ?? sandboxConfig);
  const workspaceAliyun = asRecord(sandboxConfig.aliyun_fc ?? sandboxConfig.aliyun ?? sandboxConfig);
  return normalizeSandboxConfig({
    sandbox_provider: provider,
    sandbox: {
      provider,
      local_docker: { ...localDocker, ...poolConfig },
      e2b: { ...workspaceE2b, ...poolConfig, api_key: workspaceE2b.api_key || poolConfig.api_key || e2bCreds.E2B_API_KEY },
      vefaas: {
        ...workspaceVefaas,
        ...poolConfig,
        access_key: workspaceVefaas.access_key || poolConfig.access_key || vefaasSandboxCreds.VOLCENGINE_ACCESS_KEY || vefaasCreds.VOLCENGINE_ACCESS_KEY,
        secret_key: workspaceVefaas.secret_key || poolConfig.secret_key || vefaasSandboxCreds.VOLCENGINE_SECRET_KEY || vefaasCreds.VOLCENGINE_SECRET_KEY,
        region: workspaceVefaas.region || poolConfig.region || vefaasSandboxCreds.VEFAAS_REGION || vefaasCreds.VEFAAS_REGION,
        function_id: workspaceVefaas.function_id || poolConfig.function_id || vefaasSandboxCreds.VEFAAS_SANDBOX_FUNCTION_ID,
        gateway_url: workspaceVefaas.gateway_url || poolConfig.gateway_url || vefaasSandboxCreds.VEFAAS_SANDBOX_GATEWAY_URL,
        api_token: workspaceVefaas.api_token || poolConfig.api_token || vefaasSandboxCreds.VEFAAS_SANDBOX_API_TOKEN
      },
      aliyun_fc: {
        ...workspaceAliyun,
        ...poolConfig,
        access_key_id: workspaceAliyun.access_key_id || poolConfig.access_key_id || aliyunCreds.ALIYUN_ACCESS_KEY_ID || aliyunCreds.access_key_id || aliyunCreds.ak,
        access_key_secret: workspaceAliyun.access_key_secret || poolConfig.access_key_secret || aliyunCreds.ALIYUN_ACCESS_KEY_SECRET || aliyunCreds.access_key_secret || aliyunCreds.sk,
        region: workspaceAliyun.region || poolConfig.region || aliyunCreds.ALIYUN_REGION || aliyunCreds.region,
        function_name: workspaceAliyun.function_name || poolConfig.function_name || aliyunCreds.ALIYUN_FC_FUNCTION_NAME,
        invoke_url: workspaceAliyun.invoke_url || poolConfig.invoke_url || aliyunCreds.ALIYUN_FC_INVOKE_URL,
        api_key: workspaceAliyun.api_key || poolConfig.api_key || aliyunCreds.ALIYUN_FC_API_KEY
      }
    }
  }).sandbox;
}

async function provisionLocalDockerStandby(workspaceId: string, config: LocalDockerSandboxConfig, ttlMs: number) {
  const member = createSandboxPoolMember({ workspace_id: workspaceId, provider: "local_docker", config: poolMemberConfig(config, ttlMs) });
  if (!member) return null;
  return markSandboxPoolMemberReady(member.id, {
    sandbox_id: `local_docker:${member.id}`,
    expires_at: expiresIn(ttlMs),
    config: poolMemberConfig(config, ttlMs)
  });
}

async function provisionVefaasStandby(workspaceId: string, config: VefaasSandboxConfig, ttlMs: number) {
  const member = createSandboxPoolMember({ workspace_id: workspaceId, provider: "vefaas", config: poolMemberConfig(config, ttlMs) });
  if (!member) return null;
  const workspacePath = join(sessionsDir, ".sandbox-pool", member.id);
  await mkdir(workspacePath, { recursive: true });
  const expiresAt = expiresIn(ttlMs);
  try {
    const sandboxId = await createVefaasSandbox(config, {
      timeout_ms: ttlMs,
      metadata: { ...config.metadata, app: "managed-agents-platform", workspace_id: workspaceId, pool_member_id: member.id, standby: "true" },
      envs: { ...config.envs, MAPLE_WORKSPACE_ID: workspaceId, MAPLE_SANDBOX_POOL_MEMBER_ID: member.id, MAPLE_WORKSPACE_PATH: config.workspace_path }
    });
    const runtime = vefaasRuntimeFromSandbox(sandboxId, config, workspacePath, {
      pool_member_id: member.id,
      workspace_id: workspaceId,
      expires_at: expiresAt,
      timeout_ms: ttlMs,
      pooled: true
    });
    await setVefaasSandboxTimeout(runtime, { ...config, timeout_ms: ttlMs });
    await prepareStandby(runtime);
    return markSandboxPoolMemberReady(member.id, { sandbox_id: sandboxId, expires_at: expiresAt, config: poolMemberConfig(config, ttlMs) });
  } catch (error) {
    markSandboxPoolMemberFailed(member.id, error);
    return null;
  }
}

async function provisionAliyunFcStandby(workspaceId: string, config: AliyunFcSandboxConfig, ttlMs: number) {
  const member = createSandboxPoolMember({ workspace_id: workspaceId, provider: "aliyun_fc", config: poolMemberConfig(config, ttlMs) });
  if (!member) return null;
  return markSandboxPoolMemberReady(member.id, {
    sandbox_id: `aliyun_fc:${config.function_name || member.id}`,
    expires_at: expiresIn(ttlMs),
    config: poolMemberConfig(config, ttlMs)
  });
}

function vefaasRuntimeFromSandbox(
  sandboxId: string,
  config: VefaasSandboxConfig,
  workspacePath: string,
  input: { pool_member_id: string; workspace_id: string; expires_at: string; timeout_ms: number; pooled: boolean; session_id?: string }
): VefaasSandboxRuntimeInfo {
  return {
    type: "vefaas_sandbox",
    provider: "vefaas",
    sandbox_id: sandboxId,
    function_id: config.function_id,
    region: config.region,
    endpoint: config.endpoint,
    gateway_url: config.gateway_url.replace(/\/$/, ""),
    api_token: config.api_token || undefined,
    workspace_path: workspacePath,
    sandbox_workspace_path: config.workspace_path,
    timeout_ms: input.timeout_ms,
    envs: config.envs,
    metadata: { ...config.metadata, app: "managed-agents-platform", workspace_id: input.workspace_id, pool_member_id: input.pool_member_id, ...(input.session_id ? { session_id: input.session_id } : {}) },
    pool_member_id: input.pool_member_id,
    pooled: input.pooled,
    expires_at: input.expires_at,
    lifecycle: { on_timeout: "pause_or_expire", resume_strategy: "ResumeSandbox", timeout_strategy: "SetSandboxTimeout" }
  };
}

async function runAliyunFcDeployScript(script: string, env: NodeJS.ProcessEnv) {
  const command = script.endsWith(".py") ? "python3" : (script.endsWith(".mjs") || script.endsWith(".js")) ? process.execPath : script;
  const args = command === script ? [] : [script];
  const { stdout } = await execFileAsync(command, args, {
    cwd: process.cwd(),
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    timeout: Number(process.env.MAPLE_ALIYUN_FC_RELEASE_TIMEOUT_MS || 10 * 60 * 1000),
    env
  });
  return JSON.parse(stdout) as JsonRecord;
}

function updateWorkspaceAliyunFcSandboxConfig(workspaceId: string, config: AliyunFcSandboxConfig) {
  const row = db.prepare("SELECT config_json FROM workspaces WHERE id = ?").get(workspaceId) as JsonRecord | undefined;
  if (!row) return;
  const workspaceConfig = fromJson<JsonRecord>(String(row.config_json), {});
  const sandboxConfig = asRecord(workspaceConfig.sandbox_config);
  const currentAliyun = asRecord(sandboxConfig.aliyun_fc ?? sandboxConfig.aliyun);
  const aliyunPatch = {
    function_name: config.function_name,
    invoke_url: config.invoke_url,
    region: config.region,
    workspace_path: config.workspace_path,
    timeout_ms: config.timeout_ms
  };
  const sandboxPools = Array.isArray(workspaceConfig.sandbox_pools)
    ? workspaceConfig.sandbox_pools.map((pool) => {
      const poolRecord = asRecord(pool);
      if (String(poolRecord.provider) !== "aliyun_fc") return pool;
      return {
        ...poolRecord,
        config: {
          ...asRecord(poolRecord.config),
          ...aliyunPatch
        }
      };
    })
    : workspaceConfig.sandbox_pools;
  const nextConfig = {
    ...workspaceConfig,
    sandbox_config: {
      ...sandboxConfig,
      aliyun_fc: {
        ...currentAliyun,
        ...aliyunPatch
      }
    },
    sandbox_pools: sandboxPools
  };
  const configJson = toJson(nextConfig);
  db.prepare("UPDATE workspaces SET config_json = ?, config_hash = ?, updated_at = ? WHERE id = ?").run(configJson, hashString(configJson), now(), workspaceId);
}

async function prepareStandby(runtime: VefaasSandboxRuntimeInfo) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await prepareVefaasSandboxRuntime(runtime);
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
    }
  }
  throw lastError;
}

async function runLimited<T>(items: unknown[], limit: number, task: () => Promise<T>) {
  const results: T[] = [];
  for (let index = 0; index < items.length; index += limit) {
    results.push(...(await Promise.all(items.slice(index, index + limit).map(() => task()))));
  }
  return results;
}

function sandboxPoolForProvider(workspaceId: string, provider: string) {
  return listWorkspaceSandboxPools(workspaceId).find((pool) => pool.provider === provider) ?? null;
}

function poolMemberConfig(config: VefaasSandboxConfig | LocalDockerSandboxConfig | AliyunFcSandboxConfig, ttlMs: number) {
  if (config.provider === "local_docker") {
    return {
      image: config.image,
      networking: config.networking,
      standby_ttl_ms: ttlMs
    };
  }
  if (config.provider === "aliyun_fc") {
    return {
      function_name: config.function_name,
      invoke_url: config.invoke_url,
      region: config.region,
      workspace_path: config.workspace_path,
      standby_ttl_ms: ttlMs
    };
  }
  return {
    function_id: config.function_id,
    gateway_url: config.gateway_url,
    endpoint: config.endpoint,
    region: config.region,
    workspace_path: config.workspace_path,
    standby_ttl_ms: ttlMs
  };
}

function expiresIn(ttlMs: number) {
  return new Date(Date.now() + ttlMs).toISOString();
}

import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { sessionsDir } from "../paths";
import {
  countSandboxPoolStandbyCapacity,
  createSandboxPoolMember,
  expireSandboxPoolMembers,
  getWorkspace,
  getWorkspaceSandboxPool,
  markSandboxPoolMemberClaimed,
  markSandboxPoolMemberFailed,
  markSandboxPoolMemberReady,
  updateSandboxPoolMemberRuntime
} from "../store";
import type { JsonRecord } from "../types";
import { createDockerRuntimeContainer } from "./dockerRuntime";
import { asRecord } from "./runtimeCommon";
import type { VefaasSandboxRuntimeInfo } from "./runtimeTypes";
import { normalizeSandboxConfig, type NormalizedSandboxRuntimeConfig } from "./sandboxConfig";
import {
  createVefaasSandbox,
  describeVefaasSandbox,
  prepareVefaasSandboxRuntime,
  setVefaasSandboxTimeout
} from "./vefaasSandboxRuntime";

type VefaasSandboxConfig = Extract<NormalizedSandboxRuntimeConfig, { provider: "vefaas" }>;
type LocalDockerSandboxConfig = Extract<NormalizedSandboxRuntimeConfig, { provider: "local_docker" }>;

export async function replenishWorkspaceSandboxPool(workspaceId: string) {
  const pool = getWorkspaceSandboxPool(workspaceId);
  if (!pool) return { workspace_id: workspaceId, created: 0, reason: "workspace_not_found" };
  expireSandboxPoolMembers(workspaceId, pool.provider);
  if (pool.provider === "local_docker") return replenishLocalDockerSandboxPool(workspaceId, pool.desired_size, pool.standby_ttl_ms);
  if (pool.provider !== "vefaas") return { workspace_id: workspaceId, provider: pool.provider, created: 0, reason: "provider_not_implemented" };
  const config = workspaceSandboxRuntimeConfig(workspaceId);
  if (config.provider !== "vefaas") return { workspace_id: workspaceId, provider: pool.provider, created: 0, reason: "provider_config_missing" };
  const current = countSandboxPoolStandbyCapacity(workspaceId, "vefaas");
  const missing = Math.max(0, pool.desired_size - current);
  const created = await runLimited(Array.from({ length: missing }), 5, () => provisionVefaasStandby(workspaceId, config, pool.standby_ttl_ms));
  return { workspace_id: workspaceId, provider: "vefaas", desired_size: pool.desired_size, created: created.filter(Boolean).length };
}

async function replenishLocalDockerSandboxPool(workspaceId: string, desiredSize: number, ttlMs: number) {
  const config = workspaceSandboxRuntimeConfig(workspaceId);
  if (config.provider !== "local_docker") return { workspace_id: workspaceId, provider: "local_docker", created: 0, reason: "provider_config_missing" };
  const current = countSandboxPoolStandbyCapacity(workspaceId, "local_docker");
  const missing = Math.max(0, desiredSize - current);
  const created = await runLimited(Array.from({ length: missing }), 10, () => provisionLocalDockerStandby(workspaceId, config, ttlMs));
  return { workspace_id: workspaceId, provider: "local_docker", desired_size: desiredSize, created: created.filter(Boolean).length };
}

export async function claimPooledDockerRuntime(
  session: JsonRecord & { id: string; workspace_path: string },
  config: LocalDockerSandboxConfig
) {
  const workspaceId = String(session.workspace_id || asRecord(session.metadata).workspace_id || "");
  if (!workspaceId) return null;
  const pool = getWorkspaceSandboxPool(workspaceId);
  if (!pool || pool.provider !== "local_docker") return null;
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
  const pool = getWorkspaceSandboxPool(workspaceId);
  if (!pool || pool.provider !== "vefaas") return null;
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

function workspaceSandboxRuntimeConfig(workspaceId: string): NormalizedSandboxRuntimeConfig {
  const workspace = getWorkspace(workspaceId) as JsonRecord | null;
  const workspaceConfig = asRecord(workspace?.config);
  const providerCredentials = asRecord(workspaceConfig.provider_credentials);
  const sandboxConfig = asRecord(workspaceConfig.sandbox_config);
  const provider = String(workspace?.sandbox_provider || workspaceConfig.sandbox_provider || "e2b");
  const vefaasCreds = asRecord(providerCredentials.vefaas);
  const vefaasSandboxCreds = asRecord(providerCredentials.vefaas_sandbox);
  const e2bCreds = asRecord(providerCredentials.e2b);
  const workspaceVefaas = asRecord(sandboxConfig.vefaas ?? sandboxConfig.vefaas_sandbox ?? sandboxConfig);
  const workspaceE2b = asRecord(sandboxConfig.e2b ?? sandboxConfig);
  const localDocker = asRecord(sandboxConfig.local_docker ?? sandboxConfig.docker ?? sandboxConfig);
  return normalizeSandboxConfig({
    sandbox_provider: provider,
    sandbox: {
      provider,
      local_docker: localDocker,
      e2b: { ...workspaceE2b, api_key: workspaceE2b.api_key || e2bCreds.E2B_API_KEY },
      vefaas: {
        ...workspaceVefaas,
        access_key: workspaceVefaas.access_key || vefaasSandboxCreds.VOLCENGINE_ACCESS_KEY || vefaasCreds.VOLCENGINE_ACCESS_KEY,
        secret_key: workspaceVefaas.secret_key || vefaasSandboxCreds.VOLCENGINE_SECRET_KEY || vefaasCreds.VOLCENGINE_SECRET_KEY,
        region: workspaceVefaas.region || vefaasSandboxCreds.VEFAAS_REGION || vefaasCreds.VEFAAS_REGION,
        function_id: workspaceVefaas.function_id || vefaasSandboxCreds.VEFAAS_SANDBOX_FUNCTION_ID,
        gateway_url: workspaceVefaas.gateway_url || vefaasSandboxCreds.VEFAAS_SANDBOX_GATEWAY_URL,
        api_token: workspaceVefaas.api_token || vefaasSandboxCreds.VEFAAS_SANDBOX_API_TOKEN
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

function poolMemberConfig(config: VefaasSandboxConfig | LocalDockerSandboxConfig, ttlMs: number) {
  if (config.provider === "local_docker") {
    return {
      image: config.image,
      networking: config.networking,
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

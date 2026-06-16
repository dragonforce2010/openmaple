import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getSandboxDefaults } from "../sandboxConfig";
import { ensureWorkspaceBucket } from "../files/workspaceStorage";
import type { JsonRecord } from "../types";
import { db, now, toJson, type RuntimePoolConfig } from "./storeCore";

const execFileAsync = promisify(execFile);

async function runtimePoolMemberProvisioning(workspaceId: string, index: number, poolConfig: RuntimePoolConfig, providerCredentials?: JsonRecord) {
  const defaults = getSandboxDefaults();
  const vefaasCreds = (providerCredentials?.vefaas ?? {}) as Record<string, unknown>;
  const hasVolcengineCredentials = Boolean(
    (process.env.VOLCENGINE_ACCESS_KEY || process.env.VOLC_ACCESSKEY || vefaasCreds.VOLCENGINE_ACCESS_KEY) &&
      (process.env.VOLCENGINE_SECRET_KEY || process.env.VOLC_SECRETKEY || vefaasCreds.VOLCENGINE_SECRET_KEY)
  );
  if (!hasVolcengineCredentials) {
    throw new Error("workspace runtime pool provisioning requires VOLCENGINE_ACCESS_KEY/VOLCENGINE_SECRET_KEY.");
  }
  return await directVefaasRuntimeProvisioning(workspaceId, index, poolConfig, defaults, providerCredentials);
}

async function directVefaasRuntimeProvisioning(workspaceId: string, index: number, poolConfig: RuntimePoolConfig, defaults: ReturnType<typeof getSandboxDefaults>, providerCredentials?: JsonRecord) {
  const appName = `maple-ws-${workspaceId.replace(/[^a-zA-Z0-9-]/g, "").toLowerCase().slice(0, 20)}-${index + 1}-${Date.now()}`;
  const vefaasCreds = (providerCredentials?.vefaas ?? {}) as Record<string, unknown>;
  const e2bCreds = (providerCredentials?.e2b ?? {}) as Record<string, unknown>;
  const credEnv: Record<string, string> = {};
  if (vefaasCreds.VOLCENGINE_ACCESS_KEY) credEnv.VOLCENGINE_ACCESS_KEY = String(vefaasCreds.VOLCENGINE_ACCESS_KEY);
  if (vefaasCreds.VOLCENGINE_SECRET_KEY) credEnv.VOLCENGINE_SECRET_KEY = String(vefaasCreds.VOLCENGINE_SECRET_KEY);
  if (vefaasCreds.VEFAAS_REGION) credEnv.VEFAAS_REGION = String(vefaasCreds.VEFAAS_REGION);
  if (e2bCreds.E2B_API_KEY) credEnv.E2B_API_KEY = String(e2bCreds.E2B_API_KEY);
  const region = String(vefaasCreds.VEFAAS_REGION || defaults.vefaas.region || "cn-beijing");
  const deployScript = process.env.MAPLE_VEFAAS_RUNTIME_DEPLOY_SCRIPT || "infra/vefaas/deploy_vefaas_runtime.py";
  try {
    const { stdout } = await execFileAsync("python3", [deployScript], {
      cwd: process.cwd(),
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
      timeout: Number(process.env.MAPLE_VEFAAS_RELEASE_TIMEOUT_MS || 5 * 60 * 1000),
      env: {
        ...process.env,
        ...credEnv,
        MAPLE_VEFAAS_APP_NAME: appName,
        MAPLE_VEFAAS_MEMORY_MB: String(poolConfig.memory_mb),
        MAPLE_VEFAAS_REGION: region,
        MAPLE_VEFAAS_RUNTIME_ENVS: JSON.stringify({
          ...runtimePoolMemberEnvs(defaults.vefaas.envs, workspaceId, index),
          MAPLE_RUNTIME_FUNCTION_MEMORY_MB: String(poolConfig.memory_mb),
          MAPLE_RUNTIME_FUNCTION_MIN_INSTANCES: String(poolConfig.min_instances_per_function),
          MAPLE_RUNTIME_FUNCTION_MAX_INSTANCES: String(poolConfig.max_instances_per_function),
          MAPLE_RUNTIME_FUNCTION_MAX_CONCURRENCY: String(poolConfig.max_concurrency_per_instance)
        })
      }
    });
    const payload = JSON.parse(stdout) as JsonRecord;
    if (!payload.invoke_url || !payload.function_id) {
      throw new Error(`deploy_vefaas_runtime.py returned incomplete payload: ${stdout}`);
    }
    return {
      cloud_function_id: String(payload.function_id || ""),
      cloud_app_id: String(payload.app_id || ""),
      invoke_url: String(payload.invoke_url || ""),
      region: String(payload.region || defaults.vefaas.region || "cn-beijing"),
      config: {
        workspace_path: defaults.vefaas.workspace_path,
        timeout_ms: defaults.vefaas.timeout_ms,
        envs: publicRuntimePoolMemberEnvs(runtimePoolMemberEnvs(defaults.vefaas.envs, workspaceId, index)),
        app_name: payload.app_name,
        function_name: payload.function_name,
        gateway: payload.gateway
      }
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`workspace runtime pool veFaaS provisioning failed: ${message}`);
  }
}

function updateRuntimePoolMember(memberId: string, fields: { cloud_function_id?: string; cloud_app_id?: string; invoke_url?: string; region?: string; status?: string; config?: JsonRecord }) {
  const sets: string[] = [];
  const vals: unknown[] = [];
  if (fields.cloud_function_id !== undefined) { sets.push("cloud_function_id = ?"); vals.push(fields.cloud_function_id); }
  if (fields.cloud_app_id !== undefined) { sets.push("cloud_app_id = ?"); vals.push(fields.cloud_app_id); }
  if (fields.invoke_url !== undefined) { sets.push("invoke_url = ?"); vals.push(fields.invoke_url); }
  if (fields.region !== undefined) { sets.push("region = ?"); vals.push(fields.region); }
  if (fields.status !== undefined) { sets.push("status = ?"); vals.push(fields.status); }
  if (fields.config !== undefined) { sets.push("config_json = ?"); vals.push(toJson(fields.config)); }
  if (!sets.length) return;
  sets.push("updated_at = ?");
  vals.push(now());
  vals.push(memberId);
  db.prepare(`UPDATE workspace_runtime_pool_members SET ${sets.join(", ")} WHERE id = ?`).run(...(vals as never[]));
}

// background, non-blocking runtime pool provisioning — keeps the Node event loop free so the API stays responsive
export async function provisionPoolMembersBackground(workspaceId: string, members: Array<{ memberId: string; index: number }>, poolConfig: RuntimePoolConfig, providerCredentials?: JsonRecord) {
  for (const { memberId, index } of members) {
    try {
      const provisioned = await runtimePoolMemberProvisioning(workspaceId, index, poolConfig, providerCredentials);
      updateRuntimePoolMember(memberId, {
        cloud_function_id: provisioned.cloud_function_id,
        cloud_app_id: provisioned.cloud_app_id,
        invoke_url: provisioned.invoke_url,
        region: provisioned.region,
        status: "active",
        config: provisioned.config as JsonRecord
      });
    } catch (error) {
      updateRuntimePoolMember(memberId, { status: "failed", config: { provisioning_error: error instanceof Error ? error.message : String(error) } });
    }
  }
  // Provision the tenant's TOS bucket alongside the runtime pool (best-effort; the upload path
  // re-ensures it, so a failure here is non-fatal — it just defers creation to first upload).
  await ensureWorkspaceBucket(workspaceId).catch((error) => console.warn("[provision] ensureWorkspaceBucket failed", workspaceId, error));
}

function agentLoopModelProviderEnvs() {
  const envs: Record<string, string> = {};
  const arkApiKey = process.env.ARK_API_KEY || "";
  const anthropicToken = process.env.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_API_KEY || arkApiKey;
  if (anthropicToken) envs.ANTHROPIC_AUTH_TOKEN = anthropicToken;
  if (process.env.ANTHROPIC_API_KEY) envs.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  if (arkApiKey) envs.ARK_API_KEY = arkApiKey;
  if (process.env.ANTHROPIC_BASE_URL) envs.ANTHROPIC_BASE_URL = process.env.ANTHROPIC_BASE_URL;
  if (process.env.ANTHROPIC_MODEL) envs.ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL;
  if (process.env.OPENAI_API_KEY) envs.OPENAI_API_KEY = process.env.OPENAI_API_KEY;
  if (process.env.OPENAI_BASE_URL) envs.OPENAI_BASE_URL = process.env.OPENAI_BASE_URL;
  if (process.env.OPENAI_MODEL) envs.OPENAI_MODEL = process.env.OPENAI_MODEL;
  return envs;
}

function runtimePoolMemberEnvs(base: Record<string, string>, workspaceId: string, index: number) {
  return {
    ...base,
    ...agentLoopModelProviderEnvs(),
    MAPLE_WORKSPACE_ID: workspaceId,
    MAPLE_RUNTIME_POOL_MEMBER_INDEX: String(index + 1),
    MAPLE_AGENT_RUNTIME_ROLE: "agent_loop",
    MAPLE_AGENT_TEMPLATE_SOURCE: "runtime_request",
    MAPLE_AGENT_LOOP_RUNTIME: "managed-agents-platform-vefaas"
  };
}

function publicRuntimePoolMemberEnvs(envs: Record<string, string>) {
  return Object.fromEntries(Object.entries(envs).filter(([key]) => !/(TOKEN|API_KEY|SECRET|PASSWORD|CREDENTIAL)/i.test(key)));
}

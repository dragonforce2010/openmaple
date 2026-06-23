import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { aliyunCredentials } from "../cloud/aliyunOpenApi";
import { getSandboxDefaults } from "../sandboxConfig";
import { ensureWorkspaceBucket } from "../files/workspaceStorage";
import type { JsonRecord } from "../types";
import { db, now, toJson, type RuntimePoolConfig } from "./storeCore";

const execFileAsync = promisify(execFile);

async function runtimePoolMemberProvisioning(workspaceId: string, index: number, poolConfig: RuntimePoolConfig, providerCredentials?: JsonRecord) {
  const defaults = getSandboxDefaults();
  const provider = String((poolConfig as RuntimePoolConfig & { provider?: string }).provider || runtimePoolProvider(workspaceId));
  if (provider === "local_docker") return localDockerRuntimeProvisioning(workspaceId, index, poolConfig, defaults);
  if (provider === "aliyun_fc") return directAliyunFcRuntimeProvisioning(workspaceId, index, poolConfig, defaults, providerCredentials);
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

function runtimePoolProvider(workspaceId: string) {
  const row = db.prepare("SELECT provider FROM workspace_runtime_pools WHERE workspace_id = ? ORDER BY created_at ASC LIMIT 1").get(workspaceId) as JsonRecord | undefined;
  return String(row?.provider || "vefaas");
}

function localDockerRuntimeProvisioning(workspaceId: string, index: number, poolConfig: RuntimePoolConfig, defaults: ReturnType<typeof getSandboxDefaults>) {
  const envs = publicRuntimePoolMemberEnvs(runtimePoolMemberEnvs({}, workspaceId, index, "managed-agents-platform-local-docker"));
  return {
    cloud_function_id: "",
    cloud_app_id: "",
    invoke_url: "",
    region: "local",
    config: {
      provider: "local_docker",
      image: defaults.local_docker.image,
      workspace_path: "/workspace",
      timeout_ms: 120_000,
      envs,
      cpu_milli: poolConfig.cpu_milli,
      memory_mb: poolConfig.memory_mb
    }
  };
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
  const configuredImage = String(process.env.MAPLE_VEFAAS_IMAGE || "").trim();
  const baseEnv = {
    ...process.env,
    ...credEnv,
    MAPLE_VEFAAS_MEMORY_MB: String(poolConfig.memory_mb),
    MAPLE_VEFAAS_REGION: region,
    MAPLE_RUNTIME_FUNCTION_MIN_INSTANCES: String(poolConfig.min_instances_per_function),
    MAPLE_RUNTIME_FUNCTION_MAX_INSTANCES: String(poolConfig.max_instances_per_function),
    MAPLE_VEFAAS_RUNTIME_ENVS: JSON.stringify({
      ...runtimeEnvOverrides(process.env.MAPLE_VEFAAS_RUNTIME_ENVS),
      ...runtimePoolMemberEnvs(defaults.vefaas.envs, workspaceId, index),
      MAPLE_RUNTIME_FUNCTION_MEMORY_MB: String(poolConfig.memory_mb),
      MAPLE_RUNTIME_FUNCTION_MIN_INSTANCES: String(poolConfig.min_instances_per_function),
      MAPLE_RUNTIME_FUNCTION_MAX_INSTANCES: String(poolConfig.max_instances_per_function),
      MAPLE_RUNTIME_FUNCTION_MAX_CONCURRENCY: String(poolConfig.max_concurrency_per_instance)
    })
  };
  const runDeploy = async (nextAppName: string, envOverrides: Record<string, string> = {}) => {
    const { stdout } = await execFileAsync("python3", [deployScript], {
      cwd: process.cwd(),
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
      timeout: Number(process.env.MAPLE_VEFAAS_RELEASE_TIMEOUT_MS || 5 * 60 * 1000),
      env: {
        ...baseEnv,
        ...envOverrides,
        MAPLE_VEFAAS_APP_NAME: nextAppName
      }
    });
    const payload = JSON.parse(stdout) as JsonRecord;
    if (!payload.invoke_url || !payload.function_id) {
      throw new Error(`deploy_vefaas_runtime.py returned incomplete payload: ${stdout}`);
    }
    return payload;
  };
  try {
    let payload: JsonRecord;
    let imageFallbackError = "";
    if (configuredImage) {
      try {
        payload = await runDeploy(appName);
      } catch (error) {
        imageFallbackError = error instanceof Error ? error.message : String(error);
        try {
          payload = await runDeploy(`${appName}-src`, { MAPLE_VEFAAS_IMAGE: "" });
        } catch (sourceError) {
          const sourceMessage = sourceError instanceof Error ? sourceError.message : String(sourceError);
          throw new Error(`image deploy failed: ${imageFallbackError}; source fallback failed: ${sourceMessage}`);
        }
      }
    } else {
      payload = await runDeploy(appName, { MAPLE_VEFAAS_IMAGE: "" });
    }
    const sourceType = payload.image ? "image" : "source_zip";
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
        gateway: payload.gateway,
        source_type: sourceType,
        image: payload.image || "",
        image_fallback_error: imageFallbackError
      }
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`workspace runtime pool veFaaS provisioning failed: ${message}`);
  }
}

async function directAliyunFcRuntimeProvisioning(workspaceId: string, index: number, poolConfig: RuntimePoolConfig, defaults: ReturnType<typeof getSandboxDefaults>, providerCredentials?: JsonRecord) {
  const functionName = `maple-ws-${workspaceId.replace(/[^a-zA-Z0-9-]/g, "").toLowerCase().slice(0, 20)}-${index + 1}-${Date.now()}`;
  const creds = aliyunCredentials((providerCredentials?.aliyun ?? providerCredentials?.alibaba_cloud) as JsonRecord | undefined);
  const region = creds.region || defaults.aliyun_fc.region || "cn-hangzhou";
  const configuredInvokeUrl = String(process.env.MAPLE_ALIYUN_FC_INVOKE_URL || defaults.aliyun_fc.invoke_url || "");
  const deployScript = process.env.MAPLE_ALIYUN_FC_RUNTIME_DEPLOY_SCRIPT || (configuredInvokeUrl ? "" : "infra/aliyun/deploy_aliyun_fc_runtime.mjs");
  const configuredFunctionName = String(process.env.MAPLE_ALIYUN_FC_FUNCTION_NAME || defaults.aliyun_fc.function_name || functionName);
  const aliyunRuntimeBaseEnvs = { MAPLE_SKIP_CLAUDE_AGENT_SDK_INSTALL: "true", ...defaults.aliyun_fc.envs };
  const envs = publicRuntimePoolMemberEnvs(runtimePoolMemberEnvs(aliyunRuntimeBaseEnvs, workspaceId, index, "managed-agents-platform-aliyun-fc"));
  if (!deployScript) {
    if (!configuredInvokeUrl) throw new Error("workspace runtime pool Aliyun FC provisioning requires MAPLE_ALIYUN_FC_RUNTIME_DEPLOY_SCRIPT or MAPLE_ALIYUN_FC_INVOKE_URL.");
    return {
      cloud_function_id: configuredFunctionName,
      cloud_app_id: "",
      invoke_url: configuredInvokeUrl,
      region,
      config: {
        provider: "aliyun_fc",
        workspace_path: defaults.aliyun_fc.workspace_path,
        timeout_ms: defaults.aliyun_fc.timeout_ms,
        envs,
        function_name: configuredFunctionName,
        source_type: "existing_http"
      }
    };
  }
  if (!creds.accessKeyId || !creds.accessKeySecret) throw new Error("workspace runtime pool Aliyun FC provisioning requires ALIYUN_ACCESS_KEY_ID/ALIYUN_ACCESS_KEY_SECRET.");
  const payload = await runDeployScript(deployScript, {
    ...process.env,
    ALIYUN_ACCESS_KEY_ID: creds.accessKeyId,
    ALIYUN_ACCESS_KEY_SECRET: creds.accessKeySecret,
    ALIYUN_REGION: region,
    MAPLE_ALIYUN_FC_FUNCTION_NAME: functionName,
    MAPLE_ALIYUN_FC_MEMORY_MB: String(poolConfig.memory_mb),
    MAPLE_ALIYUN_FC_CPU_MILLI: String(poolConfig.cpu_milli),
    MAPLE_RUNTIME_FUNCTION_MIN_INSTANCES: String(poolConfig.min_instances_per_function),
    MAPLE_RUNTIME_FUNCTION_MAX_INSTANCES: String(poolConfig.max_instances_per_function),
    MAPLE_RUNTIME_FUNCTION_MAX_CONCURRENCY: String(poolConfig.max_concurrency_per_instance),
    MAPLE_ALIYUN_FC_RUNTIME_ENVS: JSON.stringify({
      ...runtimeEnvOverrides(process.env.MAPLE_ALIYUN_FC_RUNTIME_ENVS),
      ...runtimePoolMemberEnvs(aliyunRuntimeBaseEnvs, workspaceId, index, "managed-agents-platform-aliyun-fc"),
      MAPLE_RUNTIME_FUNCTION_MEMORY_MB: String(poolConfig.memory_mb),
      MAPLE_RUNTIME_FUNCTION_MIN_INSTANCES: String(poolConfig.min_instances_per_function),
      MAPLE_RUNTIME_FUNCTION_MAX_INSTANCES: String(poolConfig.max_instances_per_function),
      MAPLE_RUNTIME_FUNCTION_MAX_CONCURRENCY: String(poolConfig.max_concurrency_per_instance)
    })
  });
  if (!payload.invoke_url || !(payload.function_name || payload.function_id)) {
    throw new Error(`Aliyun FC deploy script returned incomplete payload: ${JSON.stringify(payload)}`);
  }
  return {
    cloud_function_id: String(payload.function_name || payload.function_id),
    cloud_app_id: String(payload.service_name || payload.serviceName || ""),
    invoke_url: String(payload.invoke_url || ""),
    region: String(payload.region || region),
    config: {
      provider: "aliyun_fc",
      workspace_path: defaults.aliyun_fc.workspace_path,
      timeout_ms: defaults.aliyun_fc.timeout_ms,
      envs,
      function_name: String(payload.function_name || payload.function_id),
      service_name: String(payload.service_name || payload.serviceName || ""),
      source_type: String(payload.source_type || "deploy_script")
    }
  };
}

async function runDeployScript(script: string, env: NodeJS.ProcessEnv) {
  const command = script.endsWith(".py") ? "python3" : (script.endsWith(".mjs") || script.endsWith(".js")) ? process.execPath : script;
  const args = command === script ? [] : [script];
  const { stdout } = await execFileAsync(command, args, {
    cwd: process.cwd(),
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    timeout: Number(process.env.MAPLE_ALIYUN_FC_RELEASE_TIMEOUT_MS || 5 * 60 * 1000),
    env
  });
  return JSON.parse(stdout) as JsonRecord;
}

function runtimeEnvOverrides(raw: string | undefined) {
  if (!raw) return {};
  const parsed = JSON.parse(raw) as JsonRecord;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("runtime env overrides must be a JSON object");
  return Object.fromEntries(Object.entries(parsed).map(([key, value]) => [key, String(value)]));
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
  const rawConcurrency = Number(process.env.MAPLE_VEFAAS_RUNTIME_PROVISION_CONCURRENCY || "4");
  const concurrency = Math.max(1, Math.min(members.length || 1, Number.isFinite(rawConcurrency) ? Math.floor(rawConcurrency) : 4));
  let cursor = 0;
  const provisionNext = async () => {
    while (cursor < members.length) {
      const current = members[cursor++];
      await provisionPoolMember(workspaceId, current, poolConfig, providerCredentials);
    }
  };
  await Promise.all(Array.from({ length: concurrency }, provisionNext));
  if (String((poolConfig as RuntimePoolConfig & { provider?: string }).provider || runtimePoolProvider(workspaceId)) !== "local_docker") {
    // Provision the tenant's TOS bucket alongside cloud runtime pools (best-effort; the upload path
    // re-ensures it, so a failure here is non-fatal — it just defers creation to first upload).
    await ensureWorkspaceBucket(workspaceId).catch((error) => console.warn("[provision] ensureWorkspaceBucket failed", workspaceId, error));
  }
}

async function provisionPoolMember(workspaceId: string, member: { memberId: string; index: number }, poolConfig: RuntimePoolConfig, providerCredentials?: JsonRecord) {
  const { memberId, index } = member;
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

function runtimePoolMemberEnvs(base: Record<string, string>, workspaceId: string, index: number, loopRuntime = "managed-agents-platform-vefaas") {
  return {
    ...base,
    ...agentLoopModelProviderEnvs(),
    MAPLE_WORKSPACE_ID: workspaceId,
    MAPLE_RUNTIME_POOL_MEMBER_INDEX: String(index + 1),
    MAPLE_AGENT_RUNTIME_ROLE: "agent_loop",
    MAPLE_AGENT_TEMPLATE_SOURCE: "runtime_request",
    MAPLE_AGENT_LOOP_RUNTIME: loopRuntime
  };
}

function publicRuntimePoolMemberEnvs(envs: Record<string, string>) {
  return Object.fromEntries(Object.entries(envs).filter(([key]) => !/(TOKEN|API_KEY|SECRET|PASSWORD|CREDENTIAL)/i.test(key)));
}

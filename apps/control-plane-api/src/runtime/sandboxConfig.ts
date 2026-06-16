import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { JsonRecord } from "../types";
import {
  builtInDefaults,
  type AgentRuntimeProvider,
  type EnvironmentPackage,
  type NormalizedAgentRuntimeConfig,
  type NormalizedSandboxConfig,
  type NormalizedSandboxRuntimeConfig,
  type SandboxDefaults,
  type SandboxProvider
} from "./sandboxConfigTypes";

export type { AgentRuntimeProvider,EffectiveRuntimeProvider,NormalizedAgentRuntimeConfig,NormalizedSandboxConfig,NormalizedSandboxRuntimeConfig,SandboxDefaults,SandboxProvider } from "./sandboxConfigTypes";

export function getSandboxDefaults(): SandboxDefaults {
  const fileConfig = readSandboxConfigFile();
  const merged = mergeDefaults(fileConfig);
  const envSandboxProvider = normalizeSandboxProvider(process.env.MAPLE_SANDBOX_PROVIDER || "");
  const envAgentRuntimeProvider =
    normalizeAgentRuntimeProvider(process.env.MAPLE_AGENT_RUNTIME_PROVIDER || process.env.MAPLE_AGENT_PROVIDER || "") ??
    merged.default_agent_runtime_provider;
  return {
    default_provider: envSandboxProvider ?? merged.default_provider,
    default_agent_runtime_provider: envAgentRuntimeProvider ?? merged.default_agent_runtime_provider,
    e2b: {
      ...merged.e2b,
      api_key: process.env.E2B_API_KEY || merged.e2b.api_key,
      template: process.env.E2B_TEMPLATE || merged.e2b.template,
      workspace_path: process.env.E2B_WORKSPACE_PATH || merged.e2b.workspace_path,
      timeout_ms: Number(process.env.E2B_TIMEOUT_MS || merged.e2b.timeout_ms)
    },
    local_docker: {
      ...merged.local_docker,
      image: process.env.MAPLE_DOCKER_IMAGE || merged.local_docker.image
    },
    vercel: {
      ...merged.vercel,
      api_key: process.env.VERCEL_SANDBOX_API_KEY || process.env.MAPLE_VERCEL_SANDBOX_API_KEY || merged.vercel.api_key,
      project_id: process.env.VERCEL_SANDBOX_PROJECT_ID || process.env.MAPLE_VERCEL_SANDBOX_PROJECT_ID || merged.vercel.project_id,
      region: process.env.VERCEL_SANDBOX_REGION || process.env.MAPLE_VERCEL_SANDBOX_REGION || merged.vercel.region,
      runtime: process.env.VERCEL_SANDBOX_RUNTIME || process.env.MAPLE_VERCEL_SANDBOX_RUNTIME || merged.vercel.runtime,
      timeout_ms: Number(process.env.VERCEL_SANDBOX_TIMEOUT_MS || process.env.MAPLE_VERCEL_SANDBOX_TIMEOUT_MS || merged.vercel.timeout_ms)
    },
    vefaas_sandbox: {
      ...merged.vefaas_sandbox,
      access_key:
        process.env.VEFAAS_SANDBOX_ACCESS_KEY ||
        process.env.MAPLE_VEFAAS_SANDBOX_ACCESS_KEY ||
        process.env.VOLCENGINE_ACCESS_KEY ||
        process.env.VOLC_ACCESSKEY ||
        merged.vefaas_sandbox.access_key,
      secret_key:
        process.env.VEFAAS_SANDBOX_SECRET_KEY ||
        process.env.MAPLE_VEFAAS_SANDBOX_SECRET_KEY ||
        process.env.VOLCENGINE_SECRET_KEY ||
        process.env.VOLC_SECRETKEY ||
        merged.vefaas_sandbox.secret_key,
      region: process.env.VEFAAS_SANDBOX_REGION || process.env.MAPLE_VEFAAS_SANDBOX_REGION || process.env.VEFAAS_REGION || process.env.MAPLE_VEFAAS_REGION || merged.vefaas_sandbox.region,
      function_id:
        process.env.VEFAAS_SANDBOX_FUNCTION_ID ||
        process.env.MAPLE_VEFAAS_SANDBOX_FUNCTION_ID ||
        merged.vefaas_sandbox.function_id,
      endpoint:
        process.env.VEFAAS_SANDBOX_ENDPOINT ||
        process.env.MAPLE_VEFAAS_SANDBOX_ENDPOINT ||
        merged.vefaas_sandbox.endpoint,
      gateway_url:
        process.env.VEFAAS_SANDBOX_GATEWAY_URL ||
        process.env.MAPLE_VEFAAS_SANDBOX_GATEWAY_URL ||
        merged.vefaas_sandbox.gateway_url,
      api_token:
        process.env.VEFAAS_SANDBOX_API_TOKEN ||
        process.env.MAPLE_VEFAAS_SANDBOX_API_TOKEN ||
        merged.vefaas_sandbox.api_token,
      workspace_path:
        process.env.VEFAAS_SANDBOX_WORKSPACE_PATH ||
        process.env.MAPLE_VEFAAS_SANDBOX_WORKSPACE_PATH ||
        merged.vefaas_sandbox.workspace_path,
      timeout_ms: Number(process.env.VEFAAS_SANDBOX_TIMEOUT_MS || process.env.MAPLE_VEFAAS_SANDBOX_TIMEOUT_MS || merged.vefaas_sandbox.timeout_ms)
    },
    vefaas: {
      ...merged.vefaas,
      invoke_url: process.env.VEFAAS_INVOKE_URL || process.env.MAPLE_VEFAAS_INVOKE_URL || merged.vefaas.invoke_url,
      api_key: process.env.VEFAAS_API_KEY || process.env.MAPLE_VEFAAS_API_KEY || merged.vefaas.api_key,
      function_id: process.env.VEFAAS_FUNCTION_ID || process.env.MAPLE_VEFAAS_FUNCTION_ID || merged.vefaas.function_id,
      region: process.env.VEFAAS_REGION || process.env.MAPLE_VEFAAS_REGION || merged.vefaas.region,
      workspace_path: process.env.VEFAAS_WORKSPACE_PATH || process.env.MAPLE_VEFAAS_WORKSPACE_PATH || merged.vefaas.workspace_path,
      timeout_ms: Number(process.env.VEFAAS_TIMEOUT_MS || process.env.MAPLE_VEFAAS_TIMEOUT_MS || merged.vefaas.timeout_ms)
    },
    aws_lambda: {
      ...merged.aws_lambda,
      function_name: process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.MAPLE_AWS_LAMBDA_FUNCTION_NAME || merged.aws_lambda.function_name,
      region: process.env.AWS_REGION || process.env.AWS_LAMBDA_REGION || process.env.MAPLE_AWS_LAMBDA_REGION || merged.aws_lambda.region,
      qualifier: process.env.AWS_LAMBDA_QUALIFIER || process.env.MAPLE_AWS_LAMBDA_QUALIFIER || merged.aws_lambda.qualifier,
      timeout_ms: Number(process.env.AWS_LAMBDA_TIMEOUT_MS || process.env.MAPLE_AWS_LAMBDA_TIMEOUT_MS || merged.aws_lambda.timeout_ms)
    }
  };
}

export function normalizeSandboxConfig(config: JsonRecord): NormalizedSandboxConfig {
  const defaults = getSandboxDefaults();
  const sandbox = asRecord(config.sandbox);
  const agentRuntime = asRecord(config.agent_runtime ?? config.agentRuntime);
  const explicitSandboxProvider = normalizeSandboxProvider(String(sandbox.provider || config.sandbox_provider || config.sandboxProvider || ""));
  const legacyProvider = String(config.provider || config.type || config.runtime || "");

  const agentProvider =
    normalizeAgentRuntimeProvider(String(agentRuntime.provider || config.agent_runtime_provider || config.agentRuntimeProvider || "")) ??
    (explicitSandboxProvider ? null : normalizeAgentRuntimeProvider(legacyProvider)) ??
    defaults.default_agent_runtime_provider;
  const sandboxProvider =
    explicitSandboxProvider ??
    normalizeSandboxProvider(legacyProvider) ??
    defaults.default_provider;

  const normalizedAgentRuntime = normalizeAgentRuntime(agentProvider, config, sandbox, agentRuntime, defaults);
  const normalizedSandbox = normalizeSandboxRuntime(sandboxProvider, config, sandbox, defaults);
  return {
    provider: normalizedAgentRuntime.provider === "local" ? normalizedSandbox.provider : normalizedAgentRuntime.provider,
    agent_runtime: normalizedAgentRuntime,
    sandbox: normalizedSandbox
  };
}

function normalizeAgentRuntime(
  provider: AgentRuntimeProvider,
  config: JsonRecord,
  sandbox: JsonRecord,
  agentRuntime: JsonRecord,
  defaults: SandboxDefaults
): NormalizedAgentRuntimeConfig {
  if (provider === "vefaas") {
    const vefaas = asRecord(agentRuntime.vefaas ?? sandbox.vefaas ?? config.vefaas);
    return {
      provider: "vefaas",
      invoke_url: String(vefaas.invoke_url || agentRuntime.invoke_url || config.invoke_url || defaults.vefaas.invoke_url),
      api_key: String(vefaas.api_key || agentRuntime.api_key || config.api_key || defaults.vefaas.api_key),
      function_id: String(vefaas.function_id || agentRuntime.function_id || config.function_id || defaults.vefaas.function_id),
      region: String(vefaas.region || agentRuntime.region || config.region || defaults.vefaas.region),
      workspace_path: String(vefaas.workspace_path || agentRuntime.workspace_path || config.workspace_path || defaults.vefaas.workspace_path),
      timeout_ms: Number(vefaas.timeout_ms || agentRuntime.timeout_ms || config.timeout_ms || defaults.vefaas.timeout_ms),
      envs: stringifyRecord({ ...defaults.vefaas.envs, ...asRecord(vefaas.envs ?? agentRuntime.envs ?? config.envs) })
    };
  }
  if (provider === "aws_lambda") {
    const awsLambda = asRecord(agentRuntime.aws_lambda ?? config.aws_lambda ?? config.lambda);
    return {
      provider: "aws_lambda",
      function_name: String(awsLambda.function_name || agentRuntime.function_name || config.function_name || defaults.aws_lambda.function_name),
      region: String(awsLambda.region || agentRuntime.region || config.region || defaults.aws_lambda.region),
      qualifier: String(awsLambda.qualifier || agentRuntime.qualifier || config.qualifier || defaults.aws_lambda.qualifier),
      timeout_ms: Number(awsLambda.timeout_ms || agentRuntime.timeout_ms || config.timeout_ms || defaults.aws_lambda.timeout_ms),
      envs: stringifyRecord({ ...defaults.aws_lambda.envs, ...asRecord(awsLambda.envs ?? agentRuntime.envs ?? config.envs) })
    };
  }
  return { provider: "local" };
}

function normalizeSandboxRuntime(
  provider: SandboxProvider,
  config: JsonRecord,
  sandbox: JsonRecord,
  defaults: SandboxDefaults
): NormalizedSandboxRuntimeConfig {
  if (provider === "e2b") {
    const e2b = asRecord(sandbox.e2b ?? config.e2b);
    return {
      provider: "e2b",
      api_key: String(e2b.api_key || config.api_key || defaults.e2b.api_key),
      template: String(e2b.template || config.template || defaults.e2b.template),
      workspace_path: String(e2b.workspace_path || config.workspace_path || defaults.e2b.workspace_path),
      timeout_ms: Number(e2b.timeout_ms || config.timeout_ms || defaults.e2b.timeout_ms),
      envs: stringifyRecord({ ...defaults.e2b.envs, ...asRecord(e2b.envs ?? config.envs) })
    };
  }
  if (provider === "vercel") {
    const vercel = asRecord(sandbox.vercel ?? config.vercel);
    return {
      provider: "vercel",
      api_key: String(vercel.api_key || config.api_key || defaults.vercel.api_key),
      project_id: String(vercel.project_id || config.project_id || defaults.vercel.project_id),
      region: String(vercel.region || config.region || defaults.vercel.region),
      runtime: String(vercel.runtime || config.runtime || defaults.vercel.runtime),
      timeout_ms: Number(vercel.timeout_ms || config.timeout_ms || defaults.vercel.timeout_ms),
      envs: stringifyRecord({ ...defaults.vercel.envs, ...asRecord(vercel.envs ?? config.envs) })
    };
  }
  if (provider === "vefaas") {
    const vefaas = asRecord(sandbox.vefaas ?? sandbox.vefaas_sandbox ?? config.vefaas_sandbox ?? config.vefaas);
    return {
      provider: "vefaas",
      access_key: String(vefaas.access_key || vefaas.ak || config.access_key || defaults.vefaas_sandbox.access_key),
      secret_key: String(vefaas.secret_key || vefaas.sk || config.secret_key || defaults.vefaas_sandbox.secret_key),
      region: String(vefaas.region || config.region || defaults.vefaas_sandbox.region),
      function_id: String(vefaas.function_id || vefaas.functionId || config.function_id || defaults.vefaas_sandbox.function_id),
      endpoint: String(vefaas.endpoint || config.endpoint || defaults.vefaas_sandbox.endpoint),
      gateway_url: String(vefaas.gateway_url || vefaas.gatewayUrl || config.gateway_url || defaults.vefaas_sandbox.gateway_url),
      api_token: String(vefaas.api_token || vefaas.apiToken || config.api_token || defaults.vefaas_sandbox.api_token),
      workspace_path: String(vefaas.workspace_path || config.workspace_path || defaults.vefaas_sandbox.workspace_path),
      timeout_ms: Number(vefaas.timeout_ms || config.timeout_ms || defaults.vefaas_sandbox.timeout_ms),
      envs: stringifyRecord({ ...defaults.vefaas_sandbox.envs, ...asRecord(vefaas.envs ?? config.envs) }),
      metadata: stringifyRecord({ ...defaults.vefaas_sandbox.metadata, ...asRecord(vefaas.metadata ?? config.metadata) }),
      packages: normalizeEnvironmentPackages(config)
    };
  }
  const localDocker = asRecord(sandbox.local_docker ?? config.local_docker ?? config.docker);
  const sandboxOptions = localDocker.sandbox_options ?? config.sandbox_options;
  return {
    provider: "local_docker",
    image: String(localDocker.image || config.image || defaults.local_docker.image),
    networking: asRecord(localDocker.networking ?? config.networking ?? defaults.local_docker.networking),
    sandbox_options: Array.isArray(sandboxOptions) ? sandboxOptions.map(String) : defaults.local_docker.sandbox_options
  };
}

function readSandboxConfigFile() {
  const configPath = resolve(process.env.MAPLE_SANDBOX_CONFIG || "sandbox.config.json");
  if (!existsSync(configPath)) return {};
  try {
    return JSON.parse(readFileSync(configPath, "utf8")) as JsonRecord;
  } catch (error) {
    throw new Error(`Failed to parse sandbox config ${configPath}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function mergeDefaults(config: JsonRecord): SandboxDefaults {
  const agentRuntime = asRecord(config.agent_runtime ?? config.agentRuntime);
  const e2b = asRecord(config.e2b);
  const localDocker = asRecord(config.local_docker ?? config.docker);
  const vercel = asRecord(config.vercel ?? config.vercel_sandbox);
  const sandbox = asRecord(config.sandbox);
  const vefaasSandbox = asRecord(sandbox.vefaas ?? sandbox.vefaas_sandbox ?? config.vefaas_sandbox ?? config.cloud_sandbox);
  const vefaas = asRecord(agentRuntime.vefaas ?? config.vefaas ?? config.volcengine_faas);
  const awsLambda = asRecord(agentRuntime.aws_lambda ?? config.aws_lambda ?? config.lambda);
  return {
    default_provider:
      normalizeSandboxProvider(String(config.default_provider || config.defaultProvider || config.default_sandbox_provider || "")) ??
      builtInDefaults.default_provider,
    default_agent_runtime_provider:
      normalizeAgentRuntimeProvider(String(config.default_agent_runtime_provider || config.defaultAgentRuntimeProvider || agentRuntime.provider || "")) ??
      builtInDefaults.default_agent_runtime_provider,
    e2b: {
      ...builtInDefaults.e2b,
      ...e2b,
      envs: stringifyRecord({ ...builtInDefaults.e2b.envs, ...asRecord(e2b.envs) })
    },
    local_docker: {
      ...builtInDefaults.local_docker,
      ...localDocker,
      networking: asRecord(localDocker.networking ?? builtInDefaults.local_docker.networking),
      sandbox_options: Array.isArray(localDocker.sandbox_options)
        ? localDocker.sandbox_options.map(String)
        : builtInDefaults.local_docker.sandbox_options
    },
    vercel: {
      ...builtInDefaults.vercel,
      ...vercel,
      envs: stringifyRecord({ ...builtInDefaults.vercel.envs, ...asRecord(vercel.envs) })
    },
    vefaas_sandbox: {
      ...builtInDefaults.vefaas_sandbox,
      ...vefaasSandbox,
      envs: stringifyRecord({ ...builtInDefaults.vefaas_sandbox.envs, ...asRecord(vefaasSandbox.envs) }),
      metadata: stringifyRecord({ ...builtInDefaults.vefaas_sandbox.metadata, ...asRecord(vefaasSandbox.metadata) })
    },
    vefaas: {
      ...builtInDefaults.vefaas,
      ...vefaas,
      envs: stringifyRecord({ ...builtInDefaults.vefaas.envs, ...asRecord(vefaas.envs) })
    },
    aws_lambda: {
      ...builtInDefaults.aws_lambda,
      ...awsLambda,
      envs: stringifyRecord({ ...builtInDefaults.aws_lambda.envs, ...asRecord(awsLambda.envs) })
    }
  };
}

function normalizeSandboxProvider(value: string): SandboxProvider | null {
  const normalized = value.trim().toLowerCase();
  if (["docker", "local_docker", "local-sandbox"].includes(normalized)) return "local_docker";
  if (normalized === "e2b") return "e2b";
  if (["vercel", "vercel_sandbox", "vercel-sandbox"].includes(normalized)) return "vercel";
  if (["vefaas", "vefaas_sandbox", "vefaas-sandbox", "volcengine_sandbox", "volcengine-sandbox"].includes(normalized)) return "vefaas";
  return null;
}

function normalizeAgentRuntimeProvider(value: string): AgentRuntimeProvider | null {
  const normalized = value.trim().toLowerCase();
  if (["local", "local_agent", "local-agent", "in_process", "in-process"].includes(normalized)) return "local";
  if (["vefaas", "volcengine_faas", "volcengine-faas", "faas"].includes(normalized)) return "vefaas";
  if (["aws_lambda", "aws-lambda", "lambda"].includes(normalized)) return "aws_lambda";
  return null;
}

function asRecord(value: unknown): JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as JsonRecord) : {};
}

export function normalizeEnvironmentPackages(config: JsonRecord): EnvironmentPackage[] {
  const raw = Array.isArray(config.packages) ? config.packages : [];
  return raw
    .map((item) => {
      if (Array.isArray(item)) return { manager: String(item[0] ?? "pip"), name: String(item[1] ?? "").trim() };
      const record = asRecord(item);
      return { manager: String(record.manager ?? "pip"), name: String(record.name ?? "").trim() };
    })
    .filter((pkg) => pkg.name.length > 0);
}

function stringifyRecord(value: JsonRecord) {
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, String(item)]));
}

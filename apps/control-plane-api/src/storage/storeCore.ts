import { nanoid } from "nanoid";
import { createHash } from "node:crypto";
import { normalizeAgentLoop } from "../agentLoops";
import { createMysqlDatabase } from "../mysql";
import type { AgentConfig, JsonRecord } from "../types";

type DatabaseStatement = {
  get: (...params: unknown[]) => unknown;
  all: (...params: unknown[]) => unknown[];
  run: (...params: unknown[]) => unknown;
};

type StoreDatabase = {
  exec: (sql: string) => unknown;
  prepare: (sql: string) => DatabaseStatement;
  transaction: <T extends (...args: never[]) => unknown>(fn: T) => T;
  runAsync?: (sql: string, params: unknown[]) => Promise<void>;
};

export const GLOBAL_SCOPE_ID = "-1";
export const db: StoreDatabase = createMysqlDatabase();

export const now = () => new Date().toISOString();
export const toJson = (value: unknown) => JSON.stringify(value ?? {});
export const fromJson = <T>(value: string | null | undefined, fallback: T): T => {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
};
export const recordValue = (value: unknown): JsonRecord => (typeof value === "object" && value !== null && !Array.isArray(value) ? (value as JsonRecord) : {});

export function hashConfig(config: AgentConfig) {
  return createHash("sha256").update(JSON.stringify(config)).digest("hex");
}

export function normalizeStoredAgentConfig(config: AgentConfig) {
  return {
    ...config,
    agent_loop: normalizeAgentLoop((config as AgentConfig).agent_loop)
  };
}

export type RuntimePoolConfig = {
  desired_size: number;
  min_instances_per_function: number;
  max_instances_per_function: number;
  max_concurrency_per_instance: number;
  cpu_milli: number;
  memory_mb: number;
};

export type SandboxPoolConfig = {
  desired_size: number;
  standby_ttl_ms: number;
};

export type PoolRole = "primary" | "standby";

export type RuntimeProviderPoolConfig = RuntimePoolConfig & {
  provider: string;
  role: PoolRole;
  priority: number;
  name: string;
  config: JsonRecord;
};

export type SandboxProviderPoolConfig = SandboxPoolConfig & {
  provider: string;
  role: PoolRole;
  priority: number;
  name: string;
  config: JsonRecord;
};

export type WorkspaceOnboardingInput = {
  user_id: string;
  tenant: { name: string; description?: string };
  workspace: { name: string; description?: string; slug?: string };
  runtime_provider: "vefaas" | "local_docker" | "aliyun_fc";
  runtime_pools?: Array<Partial<RuntimePoolConfig> & { provider?: string; role?: string; priority?: number; name?: string; config?: JsonRecord }>;
  sandbox_provider: "e2b" | "vefaas" | "local_docker" | "daytona" | "aliyun_fc";
  sandbox_pools?: Array<Partial<SandboxPoolConfig> & { provider?: string; role?: string; priority?: number; name?: string; config?: JsonRecord }>;
  artifact_provider?: "tos" | "oss";
  object_storage?: JsonRecord;
  sandbox_config?: JsonRecord;
  sandbox_pool?: SandboxPoolConfig;
  runtime_pool: RuntimePoolConfig;
  model_config_ids: string[];
  provisioning_mode?: "background" | "manual";
  custom_model_configs?: Array<{
    name: string;
    provider_type: string;
    base_url: string;
    model_name: string;
    preset_key?: string | null;
    api_key_ciphertext?: string | null;
    api_key_hint?: string | null;
    is_default?: boolean;
  }>;
  api_key: { display_name: string; scopes: string[] };
  admin?: { email?: string; name?: string };
  member_emails?: string[];
  provider_credentials?: JsonRecord;
};

export function hashString(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export type PoolMemberStatusCounts = { total: number; by_status: Record<string, number> };

export function countRowsToSummary(rows: JsonRecord[]): PoolMemberStatusCounts {
  const by_status: Record<string, number> = {};
  let total = 0;
  for (const row of rows) {
    const count = Number(row.count || 0);
    by_status[String(row.status)] = count;
    total += count;
  }
  return { total, by_status };
}

export function runtimePoolConfig(input: RuntimePoolConfig) {
  const maxInstances = Math.min(100, Math.max(1, Math.floor(input.max_instances_per_function)));
  return {
    desired_size: Math.max(0, Math.floor(input.desired_size)),
    min_instances_per_function: Math.min(maxInstances, Math.max(0, Math.floor(input.min_instances_per_function ?? 0))),
    max_instances_per_function: maxInstances,
    max_concurrency_per_instance: Math.min(1000, Math.max(1, Math.floor(input.max_concurrency_per_instance))),
    cpu_milli: Math.max(250, Math.floor(input.cpu_milli)),
    memory_mb: Math.max(512, Math.floor(input.memory_mb))
  };
}

export function runtimeProviderPoolConfigs(
  inputs: WorkspaceOnboardingInput["runtime_pools"] | undefined,
  fallbackProvider: string,
  fallbackPool: RuntimePoolConfig
): RuntimeProviderPoolConfig[] {
  const source = inputs?.length ? inputs : [{ provider: fallbackProvider, role: "primary", priority: 0, ...fallbackPool }];
  return source.map((item, index) => {
    const base = runtimePoolConfig({ ...fallbackPool, ...recordValue(item) } as RuntimePoolConfig);
    return {
      ...base,
      provider: String(item.provider || fallbackProvider),
      role: normalizePoolRole(item.role),
      priority: Number.isFinite(Number(item.priority)) ? Math.floor(Number(item.priority)) : index,
      name: String(item.name || `${normalizePoolRole(item.role)}-${item.provider || fallbackProvider}-${index + 1}`),
      config: recordValue(item.config)
    };
  });
}

export function sandboxPoolConfig(input?: SandboxPoolConfig | JsonRecord | null): SandboxPoolConfig {
  const raw = recordValue(input);
  const desired = Number(raw.desired_size ?? raw.size ?? 1);
  const ttl = Number(raw.standby_ttl_ms ?? raw.ttl_ms ?? 30 * 60 * 1000);
  return {
    desired_size: Math.min(100, Math.max(1, Math.floor(Number.isFinite(desired) ? desired : 1))),
    standby_ttl_ms: Math.max(60_000, Math.floor(Number.isFinite(ttl) ? ttl : 30 * 60 * 1000))
  };
}

export function sandboxProviderPoolConfigs(
  inputs: WorkspaceOnboardingInput["sandbox_pools"] | undefined,
  fallbackProvider: string,
  fallbackPool?: SandboxPoolConfig | JsonRecord | null
): SandboxProviderPoolConfig[] {
  const source = inputs?.length ? inputs : [{ provider: fallbackProvider, role: "primary", priority: 0, ...recordValue(fallbackPool) }];
  return source.map((item, index) => {
    const base = sandboxPoolConfig({ ...recordValue(fallbackPool), ...recordValue(item) });
    return {
      ...base,
      provider: String(item.provider || fallbackProvider),
      role: normalizePoolRole(item.role),
      priority: Number.isFinite(Number(item.priority)) ? Math.floor(Number(item.priority)) : index,
      name: String(item.name || `${normalizePoolRole(item.role)}-${item.provider || fallbackProvider}-${index + 1}`),
      config: recordValue(item.config)
    };
  });
}

function normalizePoolRole(value: unknown): PoolRole {
  return String(value || "").toLowerCase() === "standby" ? "standby" : "primary";
}

export const reservedWorkspaceSlugs = new Set([
  "admin", "api", "app", "auth", "billing", "callback", "console", "docs", "health", "login", "logout", "maple", "settings", "signup", "status", "support", "system", "tenant", "tenants", "workspace", "workspaces"
]);

export function workspaceApiKeyMaterial() {
  const raw = `maple_ws_${nanoid(32)}`;
  return {
    raw,
    hash: hashString(raw),
    prefix: raw.slice(0, 18)
  };
}

export function tenantApiKeyMaterial() {
  const raw = `maple_tn_${nanoid(32)}`;
  return {
    raw,
    hash: hashString(raw),
    prefix: raw.slice(0, 18)
  };
}

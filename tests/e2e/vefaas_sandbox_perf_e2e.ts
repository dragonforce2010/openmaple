import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadProjectEnv } from "../../apps/control-plane-api/src/env";
import type { JsonRecord } from "../../apps/control-plane-api/src/types";

loadProjectEnv();

process.env.MAPLE_PERF_TRACE = process.env.MAPLE_PERF_TRACE || "1";
process.env.MAPLE_AGENT_LOOP_EXECUTION = "provider";
process.env.MAPLE_SANDBOX_POOL_CLAIM = process.env.MAPLE_SANDBOX_POOL_CLAIM || "false";
process.env.MAPLE_SANDBOX_POOL_AUTOREPLENISH = "false";
process.env.MAPLE_DATA_DIR = process.env.MAPLE_DATA_DIR || mkdtempSync(join(tmpdir(), "maple-vefaas-sandbox-perf-"));

const binding = vefaasSandboxBinding();
const missing = requiredBindingKeys(binding).filter((key) => !String(binding[key] || "").trim());
const store = await import("../../apps/control-plane-api/src/store");
const runtime = await import("../../apps/control-plane-api/src/runtime");
const runner = await import("../../apps/control-plane-api/src/runtime/runner");
const routeHelpers = await import("../../apps/control-plane-api/src/routes/routeHelpers");
const { killVefaasSandbox } = await import("../../apps/control-plane-api/src/runtime/vefaasSandboxRuntime");

type ResultMap = Record<string, number[]>;

const results: ResultMap = {};
const stamp = Date.now().toString(36);
const created = {
  userId: "",
  tenantId: "",
  workspaceId: "",
  agentId: "",
  environmentId: "",
  sessionId: "",
  ownedWorkspace: false,
  ownedUser: false
};

try {
  await measure("database_init", () => Promise.resolve(store.initDatabase()), results);
  await setupWorkspace(created, binding, missing, results);

  if (created.ownedWorkspace && process.env.MAPLE_PERF_USE_SANDBOX_POOL === "true") {
    await measure("sandbox_pool_replenish", () => runtime.replenishWorkspaceSandboxPool(created.workspaceId), results);
  }

  store.ensureDefaultEnvironments(created.workspaceId);
  const environment = (store.listEnvironments(created.workspaceId) as JsonRecord[]).find((item) => {
    const config = item.config as JsonRecord;
    return String((config.sandbox as JsonRecord | undefined)?.provider || config.type || "") === "vefaas";
  });
  assert.ok(environment?.id, "created workspace must have a veFaaS environment");
  created.environmentId = String(environment.id);

  const agent = await measure("agent_create", () => Promise.resolve(store.createAgent({
    workspace_id: created.workspaceId,
    config: {
      name: "VeFaaS Sandbox Perf Agent",
      description: "Measures real veFaaS sandbox latency.",
      model: { provider: "custom", id: "perf-model" },
      system: "Use runtime tools.",
      tools: [{ type: "agent_toolset_20260401", default_config: { enabled: true } }],
      mcp_servers: [],
      skills: [],
      agent_loop: { type: "anthropic_claude_code", config: {}, hooks: [] }
    }
  }) as JsonRecord), results);
  created.agentId = String(agent.id);

  const session = await measure("session_create", () => Promise.resolve(store.createSession({
    workspace_id: created.workspaceId,
    agent_id: created.agentId,
    environment_id: created.environmentId,
    title: "vefaas sandbox perf session",
    metadata: { agent_runtime: { provider: "local" } }
  }) as JsonRecord), results);
  created.sessionId = String(session.id);

  const runtimeInfo = await measure("runtime_mark_ready", () => runtime.markRuntimeReady(created.sessionId), results) as JsonRecord;
  assert.equal(runtimeInfo.type, "vefaas_sandbox");

  await measure("tool_write_file", () => runtime.executeTool(created.sessionId, "write_file", { path: "perf-input.txt", content: "perf hello from maple\n" }), results);
  await measure("tool_read_file", () => runtime.executeTool(created.sessionId, "read_file", { path: "perf-input.txt" }), results);
  await measure("tool_list_files", () => runtime.executeTool(created.sessionId, "list_files", { path: "." }), results);
  await measure("tool_bash", () => runtime.executeTool(created.sessionId, "bash", { command: "printf 'perf bash ok\\n' > perf-bash.txt && cat perf-bash.txt" }), results);
  await measure("tool_grep", () => runtime.executeTool(created.sessionId, "grep", { pattern: "perf", path: "." }), results);
  await measure("scripted_turn", () => runner.runUserMessage(created.sessionId, "write_file create perf-turn.txt with content turn-ok, then list_files in ."), results);
  await measure("detail_summary", () => Promise.resolve(routeHelpers.sessionDetailPayload(created.sessionId, { summary: true })), results);
  await measure("detail_full", () => Promise.resolve(routeHelpers.sessionDetailPayload(created.sessionId)), results);

  console.log(JSON.stringify({ type: "maple.perf.summary", workspace_id: created.workspaceId, session_id: created.sessionId, results: summarize(results) }));
} finally {
  await cleanupCreatedSandboxMembers(binding, created.workspaceId, created.sessionId, created.ownedWorkspace);
  cleanupCreatedRecords(created);
}

async function measure<T>(name: string, task: () => Promise<T>, results: ResultMap) {
  const startedAt = performance.now();
  try {
    return await task();
  } finally {
    const duration = Number((performance.now() - startedAt).toFixed(2));
    (results[name] ??= []).push(duration);
    console.log(JSON.stringify({ type: "maple.perf.measure", name, duration_ms: duration }));
  }
}

function summarize(results: ResultMap) {
  return Object.fromEntries(Object.entries(results).map(([name, values]) => [name, {
    count: values.length,
    min_ms: percentile(values, 0),
    p50_ms: percentile(values, 0.5),
    p95_ms: percentile(values, 0.95),
    max_ms: percentile(values, 1)
  }]));
}

function percentile(values: number[], percent: number) {
  const sorted = [...values].sort((left, right) => left - right);
  if (!sorted.length) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(percent * sorted.length) - 1));
  return sorted[index];
}

async function setupWorkspace(target: typeof created, binding: Record<string, string>, missing: string[], results: ResultMap) {
  const existing = findConfiguredWorkspace();
  if (existing) {
    target.workspaceId = String(existing.id);
    target.tenantId = String(existing.tenant_id || "");
    console.log(JSON.stringify({ type: "maple.perf.workspace", mode: "existing", workspace_id: target.workspaceId, name: existing.name }));
    return;
  }
  if (missing.length) {
    console.log(`SKIP veFaaS sandbox perf e2e: missing ${missing.join(", ")} and no configured workspace found`);
    process.exit(0);
  }
  const user = await measure("user_create", () => Promise.resolve(store.ensureUserByEmail({
    email: `vefaas-sandbox-perf-${stamp}@example.com`,
    name: "VeFaaS Sandbox Perf"
  }) as JsonRecord), results);
  target.userId = String(user.id);
  target.ownedUser = true;
  const onboarding = await measure("workspace_create", () => Promise.resolve(store.createWorkspaceOnboarding({
    user_id: target.userId,
    tenant: { name: `VeFaaS Sandbox Perf ${stamp}` },
    workspace: { name: "VeFaaS Sandbox Perf", slug: `vefaas-sandbox-perf-${stamp}` },
    runtime_provider: "vefaas",
    sandbox_provider: "vefaas",
    sandbox_config: { vefaas: sandboxConfig(binding) },
    sandbox_pool: { desired_size: 1, standby_ttl_ms: Number(process.env.MAPLE_PERF_SANDBOX_TTL_MS || 10 * 60 * 1000) },
    runtime_pool: {
      desired_size: 0,
      min_instances_per_function: 0,
      max_instances_per_function: 1,
      max_concurrency_per_instance: 1,
      cpu_milli: 1000,
      memory_mb: 1024
    },
    model_config_ids: [],
    api_key: { display_name: "perf key", scopes: ["control_plane", "data_plane"] },
    provider_credentials: {
      vefaas: {
        VOLCENGINE_ACCESS_KEY: binding.access_key,
        VOLCENGINE_SECRET_KEY: binding.secret_key,
        VEFAAS_REGION: binding.region
      },
      vefaas_sandbox: {
        VEFAAS_SANDBOX_FUNCTION_ID: binding.function_id,
        VEFAAS_SANDBOX_GATEWAY_URL: binding.gateway_url,
        VEFAAS_SANDBOX_API_TOKEN: binding.api_token
      }
    }
  }) as JsonRecord), results);
  target.tenantId = String((onboarding.tenant as JsonRecord).id);
  target.workspaceId = String((onboarding.workspace as JsonRecord).id);
  target.ownedWorkspace = true;
  console.log(JSON.stringify({ type: "maple.perf.workspace", mode: "created", workspace_id: target.workspaceId }));
}

function findConfiguredWorkspace() {
  const requested = String(process.env.MAPLE_PERF_WORKSPACE_ID || "");
  const rows = requested
    ? store.db.prepare("SELECT id, tenant_id, name, config_json FROM workspaces WHERE id = ? AND sandbox_provider = 'vefaas'").all(requested) as JsonRecord[]
    : store.db.prepare("SELECT id, tenant_id, name, config_json FROM workspaces WHERE sandbox_provider = 'vefaas' ORDER BY created_at DESC LIMIT 20").all() as JsonRecord[];
  return rows.find((row) => workspaceHasVefaasSandboxConfig(row) && (requested || !workspaceUsesLocalEndpoint(row))) ?? null;
}

function workspaceHasVefaasSandboxConfig(row: JsonRecord) {
  const config = parseJson(String(row.config_json || "{}"));
  const sandboxConfig = (config.sandbox_config || {}) as JsonRecord;
  const providerCredentials = (config.provider_credentials || {}) as JsonRecord;
  const sandbox = ((sandboxConfig.vefaas || sandboxConfig.vefaas_sandbox || sandboxConfig) || {}) as JsonRecord;
  const vefaasCreds = (providerCredentials.vefaas || {}) as JsonRecord;
  const sandboxCreds = (providerCredentials.vefaas_sandbox || {}) as JsonRecord;
  const functionId = String(sandbox.function_id || sandbox.functionId || sandboxCreds.VEFAAS_SANDBOX_FUNCTION_ID || "");
  const accessKey = String(vefaasCreds.VOLCENGINE_ACCESS_KEY || sandboxCreds.VOLCENGINE_ACCESS_KEY || "");
  const secretKey = String(vefaasCreds.VOLCENGINE_SECRET_KEY || sandboxCreds.VOLCENGINE_SECRET_KEY || "");
  const gateway = String(sandbox.gateway_url || sandbox.gatewayUrl || sandboxCreds.VEFAAS_SANDBOX_GATEWAY_URL || "");
  return Boolean(
    isLikelyLiveValue(functionId, 6) &&
    isLikelyLiveValue(accessKey, 10) &&
    isLikelyLiveValue(secretKey, 10) &&
    /^https?:\/\//.test(gateway) &&
    (vefaasCreds.VEFAAS_REGION || sandboxCreds.VEFAAS_REGION || sandbox.region)
  );
}

function isLikelyLiveValue(value: string, minLength: number) {
  return value.length >= minLength && !/^contract-|^example-|^test-|^fake-|^1$/i.test(value);
}

function workspaceUsesLocalEndpoint(row: JsonRecord) {
  const config = parseJson(String(row.config_json || "{}"));
  const sandboxConfig = (config.sandbox_config || {}) as JsonRecord;
  const providerCredentials = (config.provider_credentials || {}) as JsonRecord;
  const sandboxCreds = (providerCredentials.vefaas_sandbox || {}) as JsonRecord;
  const sandbox = ((sandboxConfig.vefaas || sandboxConfig.vefaas_sandbox || sandboxConfig) || {}) as JsonRecord;
  const endpoint = String(sandbox.endpoint || sandboxCreds.VEFAAS_SANDBOX_ENDPOINT || "");
  const gateway = String(sandbox.gateway_url || sandbox.gatewayUrl || sandboxCreds.VEFAAS_SANDBOX_GATEWAY_URL || "");
  return /127\.0\.0\.1|localhost|example\.invalid/.test(`${endpoint} ${gateway}`);
}

function parseJson(raw: string): JsonRecord {
  try {
    return JSON.parse(raw) as JsonRecord;
  } catch {
    return {};
  }
}

function vefaasSandboxBinding(): Record<string, string> {
  return {
    access_key: firstEnv("VEFAAS_SANDBOX_ACCESS_KEY", "MAPLE_VEFAAS_SANDBOX_ACCESS_KEY", "VOLCENGINE_ACCESS_KEY", "VOLC_ACCESSKEY"),
    secret_key: firstEnv("VEFAAS_SANDBOX_SECRET_KEY", "MAPLE_VEFAAS_SANDBOX_SECRET_KEY", "VOLCENGINE_SECRET_KEY", "VOLC_SECRETKEY"),
    region: firstEnv("VEFAAS_SANDBOX_REGION", "MAPLE_VEFAAS_SANDBOX_REGION", "VEFAAS_REGION", "MAPLE_VEFAAS_REGION") || "cn-beijing",
    function_id: firstEnv("VEFAAS_SANDBOX_FUNCTION_ID", "MAPLE_VEFAAS_SANDBOX_FUNCTION_ID"),
    endpoint: firstEnv("VEFAAS_SANDBOX_ENDPOINT", "MAPLE_VEFAAS_SANDBOX_ENDPOINT") || "https://open.volcengineapi.com",
    gateway_url: firstEnv("VEFAAS_SANDBOX_GATEWAY_URL", "MAPLE_VEFAAS_SANDBOX_GATEWAY_URL"),
    api_token: firstEnv("VEFAAS_SANDBOX_API_TOKEN", "MAPLE_VEFAAS_SANDBOX_API_TOKEN"),
    workspace_path: firstEnv("VEFAAS_SANDBOX_WORKSPACE_PATH", "MAPLE_VEFAAS_SANDBOX_WORKSPACE_PATH") || "/home/tiger/workspace",
    timeout_ms: firstEnv("VEFAAS_SANDBOX_TIMEOUT_MS", "MAPLE_VEFAAS_SANDBOX_TIMEOUT_MS") || "3600000"
  };
}

function firstEnv(...keys: string[]) {
  return keys.map((key) => process.env[key]).find((value) => String(value || "").trim()) || "";
}

function requiredBindingKeys(binding: Record<string, string>) {
  return ["access_key", "secret_key", "region", "function_id", "gateway_url"];
}

function sandboxConfig(binding: Record<string, string>) {
  return {
    function_id: binding.function_id,
    endpoint: binding.endpoint,
    gateway_url: binding.gateway_url,
    api_token: binding.api_token,
    workspace_path: binding.workspace_path,
    timeout_ms: Number(binding.timeout_ms)
  };
}

async function cleanupCreatedSandboxMembers(binding: Record<string, string>, workspaceId: string, sessionId: string, killPoolMembers: boolean) {
  if (sessionId) await runtime.killSessionSandboxRuntime(sessionId).catch((error) => console.warn("[perf cleanup] session sandbox kill failed", error));
  if (!workspaceId || !killPoolMembers || requiredBindingKeys(binding).some((key) => !binding[key])) return;
  const pool = store.getWorkspaceSandboxPool(workspaceId) as JsonRecord | null;
  const members = Array.isArray(pool?.members) ? pool.members as JsonRecord[] : [];
  for (const member of members) {
    const sandboxId = String(member.sandbox_id || "");
    if (!sandboxId) continue;
    await killVefaasSandbox({
      type: "vefaas_sandbox",
      provider: "vefaas",
      sandbox_id: sandboxId,
      function_id: binding.function_id,
      region: binding.region,
      endpoint: binding.endpoint,
      gateway_url: binding.gateway_url.replace(/\/$/, ""),
      api_token: binding.api_token || undefined,
      workspace_path: "",
      sandbox_workspace_path: binding.workspace_path,
      timeout_ms: Number(binding.timeout_ms),
      envs: {},
      metadata: {}
    }, {
      provider: "vefaas",
      access_key: binding.access_key,
      secret_key: binding.secret_key,
      region: binding.region,
      function_id: binding.function_id,
      endpoint: binding.endpoint,
      gateway_url: binding.gateway_url,
      api_token: binding.api_token,
      workspace_path: binding.workspace_path,
      timeout_ms: Number(binding.timeout_ms),
      envs: {},
      metadata: {}
    }).catch((error) => console.warn("[perf cleanup] pooled sandbox kill failed", String(error)));
  }
}

function cleanupCreatedRecords(input: typeof created) {
  if (!input.workspaceId) return;
  const sessionIds = input.ownedWorkspace
    ? (store.db.prepare("SELECT id FROM sessions WHERE workspace_id = ?").all(input.workspaceId) as JsonRecord[]).map((row) => String(row.id))
    : [input.sessionId].filter(Boolean);
  resetRuntimePoolSessionCounts(sessionIds);
  for (const sessionId of sessionIds) {
    store.db.prepare("DELETE FROM session_artifacts WHERE session_id = ?").run(sessionId);
    store.db.prepare("DELETE FROM tool_calls WHERE session_id = ?").run(sessionId);
    store.db.prepare("DELETE FROM session_events WHERE session_id = ?").run(sessionId);
    store.db.prepare("DELETE FROM session_threads WHERE session_id = ?").run(sessionId);
  }
  const agentIds = input.ownedWorkspace
    ? (store.db.prepare("SELECT id FROM agents WHERE workspace_id = ?").all(input.workspaceId) as JsonRecord[]).map((row) => String(row.id))
    : [input.agentId].filter(Boolean);
  for (const agentId of agentIds) {
    store.db.prepare("DELETE FROM agent_deployments WHERE agent_id = ?").run(agentId);
    store.db.prepare("DELETE FROM agent_versions WHERE agent_id = ?").run(agentId);
  }
  if (!input.ownedWorkspace) {
    for (const sessionId of sessionIds) store.db.prepare("DELETE FROM sessions WHERE id = ?").run(sessionId);
    for (const agentId of agentIds) store.db.prepare("DELETE FROM agents WHERE id = ?").run(agentId);
    return;
  }
  store.db.prepare("DELETE FROM sessions WHERE workspace_id = ?").run(input.workspaceId);
  store.db.prepare("DELETE FROM environments WHERE workspace_id = ?").run(input.workspaceId);
  store.db.prepare("DELETE FROM agents WHERE workspace_id = ?").run(input.workspaceId);
  store.db.prepare("DELETE FROM workspace_sandbox_pool_members WHERE workspace_id = ?").run(input.workspaceId);
  store.db.prepare("DELETE FROM workspace_runtime_pool_members WHERE workspace_id = ?").run(input.workspaceId);
  store.db.prepare("DELETE FROM workspace_runtime_pools WHERE workspace_id = ?").run(input.workspaceId);
  store.db.prepare("DELETE FROM workspace_api_keys WHERE workspace_id = ?").run(input.workspaceId);
  store.db.prepare("DELETE FROM workspace_members WHERE workspace_id = ?").run(input.workspaceId);
  store.db.prepare("DELETE FROM workspaces WHERE id = ?").run(input.workspaceId);
  if (input.tenantId) {
    store.db.prepare("DELETE FROM tenant_members WHERE tenant_id = ?").run(input.tenantId);
    store.db.prepare("DELETE FROM tenants WHERE id = ?").run(input.tenantId);
  }
  if (input.ownedUser && input.userId) {
    store.db.prepare("DELETE FROM auth_sessions WHERE user_id = ?").run(input.userId);
    store.db.prepare("DELETE FROM users WHERE id = ?").run(input.userId);
  }
}

function resetRuntimePoolSessionCounts(sessionIds: string[]) {
  for (const sessionId of sessionIds) {
    const session = store.getSession(sessionId) as JsonRecord | null;
    const metadata = (session?.metadata || {}) as JsonRecord;
    const memberId = String(metadata.runtime_pool_member_id || "");
    if (!memberId) continue;
    store.db.prepare(`
      UPDATE workspace_runtime_pool_members
      SET active_session_count = CASE WHEN active_session_count > 0 THEN active_session_count - 1 ELSE 0 END
      WHERE id = ?
    `).run(memberId);
  }
}

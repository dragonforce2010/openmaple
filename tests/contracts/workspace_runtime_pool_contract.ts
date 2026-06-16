import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { db } from "../../apps/control-plane-api/src/store";
import { writeFakeVefaasRuntimeDeployScript } from "./helpers/fakeVefaasDeploy";

const dataDir = mkdtempSync(join(tmpdir(), "maple-workspace-runtime-pool-"));
const deployScript = writeFakeVefaasRuntimeDeployScript(dataDir, "https://example.invalid/maple-runtime");
const port = 19_000 + Math.floor(Math.random() * 2000);
const apiBase = `http://127.0.0.1:${port}`;
let authCookie = "";
const stamp = Date.now().toString(36);
let createdUserId = "";
let createdTenantId = "";
const providerCredentials = {
  vefaas: {
    VOLCENGINE_ACCESS_KEY: "contract-access-key",
    VOLCENGINE_SECRET_KEY: "contract-secret-key",
    VEFAAS_REGION: "cn-beijing"
  },
  e2b: { E2B_API_KEY: "contract-e2b-key" }
};

const server = spawn("bun", ["apps/control-plane-api/src/index.ts"], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    PORT: String(port),
    HOST: "127.0.0.1",
    MAPLE_DATA_DIR: dataDir,
    MAPLE_SANDBOX_PROVIDER: "local_docker",
    MAPLE_AGENT_RUNTIME_PROVIDER: "local",
    MAPLE_VEFAAS_RUNTIME_DEPLOY_SCRIPT: deployScript,
    ARK_API_KEY: "contract-ark-key",
    MAPLE_DEV_LOGIN: "true"
  },
  stdio: ["ignore", "pipe", "pipe"]
});

let serverOutput = "";
server.stdout.on("data", (chunk) => (serverOutput += String(chunk)));
server.stderr.on("data", (chunk) => (serverOutput += String(chunk)));

try {
  await waitForHealth();

  const login = await request("/v1/auth/login", {
    method: "POST",
    body: JSON.stringify({ provider: "local", email: `workspace-${Date.now()}@example.com`, name: "Workspace Contract" })
  });
  assert.ok(login.user?.id);
  createdUserId = login.user.id;

  const models = await request("/v1/model_configs");
  const defaultModel = models.data.find((item: Record<string, unknown>) => item.is_default) ?? models.data[0];
  assert.ok(defaultModel?.id);

  const beforeOnboarding = await request("/v1/workspace_onboarding/status");
  assert.equal(beforeOnboarding.required, true);
  assert.equal(beforeOnboarding.workspaces.length, 0);

  const onboarding = await request("/v1/workspace_onboarding", {
    method: "POST",
    body: JSON.stringify({
      tenant: {
        name: "Acme Platform",
        description: "Workspace runtime pool contract tenant"
      },
      workspace: {
        name: "Default Workspace",
        description: "Default immutable workspace",
        slug: `default-workspace-${stamp}`
      },
      runtime_provider: "vefaas",
      runtime_pool: {
        desired_size: 2,
        max_instances_per_function: 200,
        max_concurrency_per_instance: 2000,
        cpu_milli: 2000,
        memory_mb: 4096
      },
      sandbox_provider: "e2b",
      model_config_ids: [defaultModel.id],
      api_key: {
        display_name: "Default workspace key",
        scopes: ["control_plane", "data_plane"]
      },
      provider_credentials: providerCredentials
    })
  });
  assert.ok(onboarding.tenant.id.startsWith("tenant_"));
  createdTenantId = onboarding.tenant.id;
  assert.ok(onboarding.workspace.id.startsWith("ws_"));
  assert.equal(onboarding.workspace.status, "active");
  assert.equal(onboarding.runtime_pool.provider, "vefaas");
  assert.equal(onboarding.runtime_pool.desired_size, 2);
  assert.equal(onboarding.runtime_pool.max_instances_per_function, 100);
  assert.equal(onboarding.runtime_pool.max_concurrency_per_instance, 1000);
  assert.equal(onboarding.runtime_pool.members.length, 2);
  assert.ok(onboarding.api_key.key.startsWith("maple_ws_"));
  assert.equal(onboarding.workspace.config.cloud_provider_identities.volcengine.provider, "volcengine");
  assert.deepEqual(onboarding.workspace.config.cloud_provider_identities.volcengine.services, ["runtime:vefaas", "storage:tos"]);

  const afterOnboarding = await request("/v1/workspace_onboarding/status");
  assert.equal(afterOnboarding.required, false);
  assert.equal(afterOnboarding.workspaces.length, 1);

  const workspaceId = onboarding.workspace.id;
  const workspaceModel = await request("/v1/model_configs", {
    method: "POST",
    body: JSON.stringify({
      workspace_id: workspaceId,
      kind: "custom",
      name: "Workspace Scoped Contract Model",
      base_url: "https://ark.cn-beijing.volces.com/api/v3",
      model_name: "glm-4-7-251222",
      api_key: "workspace-scoped-contract-key",
      is_default: true
    })
  });
  const secondWorkspace = await request("/v1/workspaces", {
    method: "POST",
    body: JSON.stringify({
      tenant_id: createdTenantId,
      workspace: {
        name: "Second Workspace",
        description: "Copies workspace-scoped model configs",
        slug: `second-workspace-${stamp}`
      },
      runtime_provider: "vefaas",
      runtime_pool: {
        desired_size: 1,
        max_instances_per_function: 100,
        max_concurrency_per_instance: 1000,
        cpu_milli: 2000,
        memory_mb: 4096
      },
      sandbox_provider: "e2b",
      model_config_ids: [workspaceModel.id],
      api_key: {
        display_name: "Second workspace key",
        scopes: ["control_plane", "data_plane"]
      },
      provider_credentials: providerCredentials
    })
  });
  const copiedModelIds = secondWorkspace.workspace.config.model_config_ids as string[];
  assert.equal(copiedModelIds.length, 1);
  assert.notEqual(copiedModelIds[0], workspaceModel.id);
  const secondWorkspaceModels = await request(`/v1/model_configs?workspace_id=${secondWorkspace.workspace.id}`);
  const copiedModel = secondWorkspaceModels.data.find((item: Record<string, unknown>) => item.id === copiedModelIds[0]);
  assert.equal(copiedModel?.workspace_id, secondWorkspace.workspace.id);
  assert.equal(copiedModel?.model_name, workspaceModel.model_name);

  const defaultEnvironments = await request(`/v1/environments?workspace_id=${workspaceId}`);
  assert.equal(defaultEnvironments.data.length, 1);
  assert.equal(defaultEnvironments.data[0].config.sandbox.provider, "e2b");
  assert.equal(defaultEnvironments.data.some((environment: Record<string, unknown>) => (environment.config as Record<string, unknown>)?.sandbox && ((environment.config as Record<string, unknown>).sandbox as Record<string, unknown>).provider === "local_docker"), false);

  const activePool = await pollRuntimePoolActive(workspaceId, 2);
  assert.equal(activePool.members[0].status, "active");
  assert.ok(activePool.members[0].cloud_function_id);
  assert.equal(activePool.members[0].config.envs.ANTHROPIC_AUTH_TOKEN, undefined);
  assert.equal(activePool.members[0].config.envs.MAPLE_WORKSPACE_ID, workspaceId);
  // Paginated pool response carries full-pool counts independent of the current page slice.
  assert.equal(activePool.member_total, 2);
  assert.equal(activePool.page, 1);
  assert.equal(activePool.member_status_counts.active, 2);
  const filteredPool = await request(`/v1/workspaces/${workspaceId}/runtime_pool?status=failed&page=1&page_size=20`);
  assert.equal(filteredPool.members.length, 0);
  // member_total reflects the active filter (no failed members); status counts stay full-pool.
  assert.equal(filteredPool.member_total, 0);
  assert.equal(filteredPool.member_status_counts.active, 2);
  const immutablePatch = await requestRaw(`/v1/workspaces/${workspaceId}`, {
    method: "PATCH",
    body: JSON.stringify({ runtime_pool: { desired_size: 99 } })
  });
  assert.equal(immutablePatch.status, 405);

  const rejectedEnvironment = await requestRaw("/v1/environments", {
    method: "POST",
    body: JSON.stringify({
      workspace_id: workspaceId,
      name: "bad-agent-runtime-env",
      config: {
        agent_runtime: { provider: "vefaas" },
        sandbox: { provider: "e2b" }
      }
    })
  });
  assert.equal(rejectedEnvironment.status, 400);
  assert.equal((await rejectedEnvironment.json()).error, "environment_agent_runtime_forbidden");

  const environment = await request("/v1/environments", {
    method: "POST",
    body: JSON.stringify({
      workspace_id: workspaceId,
      name: "maple-hand-env",
      config: {
        type: "e2b",
        sandbox: { provider: "e2b", e2b: { template: "base", workspace_path: "/workspace" } },
        networking: { mode: "limited", allowed_hosts: ["api.maple.local"] },
        packages: [{ manager: "pip", packages: ["pytest==8.0.0"] }]
      }
    })
  });
  assert.equal(environment.workspace_id, workspaceId);
  assert.equal(environment.config.agent_runtime, undefined);
  assert.equal(environment.config.sandbox.provider, "e2b");

  const rejectedAgent = await requestRaw("/v1/agents", {
    method: "POST",
    body: JSON.stringify({
      workspace_id: workspaceId,
      name: "Bad Model Agent",
      description: "Should fail model pool validation",
      model: { provider: "custom", id: "not-in-pool", config_id: "modelcfg_missing" },
      system: "Test",
      tools: [],
      mcp_servers: [],
      skills: []
    })
  });
  assert.equal(rejectedAgent.status, 400);
  assert.equal((await rejectedAgent.json()).error, "model_config_not_in_workspace_pool");

  const nameOnlyAgent = await request("/v1/agents", {
    method: "POST",
    body: JSON.stringify({
      workspace_id: workspaceId,
      name: "Workspace Agent By Model Name",
      description: "Resolves workspace model config from model_name",
      model: workspaceModel.name,
      system: "Use tools when needed.",
      tools: [],
      mcp_servers: [],
      skills: []
    })
  });
  assert.equal(nameOnlyAgent.workspace_id, workspaceId);
  assert.equal(nameOnlyAgent.config.model.config_id, workspaceModel.id);
  assert.equal(nameOnlyAgent.config.model.id, workspaceModel.model_name);

  const agent = await request("/v1/agents", {
    method: "POST",
    body: JSON.stringify({
      workspace_id: workspaceId,
      name: "Workspace Agent",
      description: "Uses workspace model pool and runtime pool",
      model: { provider: "custom", id: defaultModel.model_name, config_id: defaultModel.id, name: defaultModel.name },
      system: "Use tools when needed.",
      tools: [{ type: "agent_toolset", configs: { write: true, bash: true } }],
      mcp_servers: [],
      skills: []
    })
  });
  assert.equal(agent.workspace_id, workspaceId);
  assert.equal(agent.config.agent_loop.type, "anthropic_claude_code");

  const session = await request("/v1/sessions", {
    method: "POST",
    body: JSON.stringify({
      workspace_id: workspaceId,
      agent: agent.id,
      environment_id: environment.id,
      title: "workspace-runtime-pool-session"
    })
  });
  assert.equal(session.workspace_id, workspaceId);
  assert.equal(session.metadata.runtime_pool_id, onboarding.runtime_pool.id);
  assert.ok(session.metadata.runtime_pool_member_id);
  assert.equal(session.metadata.agent_runtime.type, "vefaas");
  assert.ok(session.metadata.agent_runtime.cloud_function_id);
  assert.ok(session.metadata.agent_runtime.invoke_url);

  const pool = await request(`/v1/workspaces/${workspaceId}/runtime_pool`);
  const selected = pool.members.find((member: Record<string, unknown>) => member.id === session.metadata.runtime_pool_member_id);
  assert.ok(selected);
  assert.equal(selected.active_session_count, 1);

  const agentRuntime = await request(`/v1/agents/${agent.id}/runtime`);
  assert.equal(agentRuntime.agent_id, agent.id);
  assert.equal(agentRuntime.workspace.id, workspaceId);
  assert.equal(agentRuntime.runtime_pool.id, onboarding.runtime_pool.id);
  assert.equal(agentRuntime.runtime_pool.members.length, 2);
  assert.equal(agentRuntime.runtime_pool.members[0].provider, "vefaas");
  assert.ok(agentRuntime.runtime_pool.members[0].cloud_function_id);
  assert.equal(agentRuntime.recent_sessions[0].id, session.id);
  assert.equal(agentRuntime.recent_sessions[0].agent_runtime.type, "vefaas");
  assert.equal(agentRuntime.recent_sessions[0].runtime_pool_member_id, session.metadata.runtime_pool_member_id);

  console.log("workspace runtime pool contract passed");
} finally {
  server.kill();
  try {
    cleanupContractRecords();
  } catch (cleanupError) {
    console.error("runtime pool contract cleanup failed", cleanupError);
  }
}

function cleanupContractRecords() {
  const workspaceRows = createdTenantId
    ? (db.prepare("SELECT id FROM workspaces WHERE tenant_id = ?").all(createdTenantId) as Array<{ id: string }>)
    : [];
  // delete child rows before parents so every FK is satisfied without disabling checks
  for (const { id: workspaceId } of workspaceRows) {
    const sessions = db.prepare("SELECT id FROM sessions WHERE workspace_id = ?").all(workspaceId) as Array<{ id: string }>;
    for (const { id: sessionId } of sessions) {
      db.prepare("DELETE FROM session_artifacts WHERE session_id = ?").run(sessionId);
      db.prepare("DELETE FROM tool_calls WHERE session_id = ?").run(sessionId);
      db.prepare("DELETE FROM session_events WHERE session_id = ?").run(sessionId);
      db.prepare("DELETE FROM session_threads WHERE session_id = ?").run(sessionId);
    }
    const agents = db.prepare("SELECT id FROM agents WHERE workspace_id = ?").all(workspaceId) as Array<{ id: string }>;
    for (const { id: agentId } of agents) {
      db.prepare("DELETE FROM agent_deployments WHERE agent_id = ?").run(agentId);
      db.prepare("DELETE FROM agent_versions WHERE agent_id = ?").run(agentId);
    }
    const vaults = db.prepare("SELECT id FROM vaults WHERE workspace_id = ?").all(workspaceId) as Array<{ id: string }>;
    for (const { id: vaultId } of vaults) db.prepare("DELETE FROM vault_credentials WHERE vault_id = ?").run(vaultId);
    for (const table of ["sessions", "agents", "environments", "vaults", "mcp_servers", "memory_stores", "model_configs", "workspace_api_keys", "workspace_runtime_pool_members", "workspace_runtime_pools", "workspace_members"]) {
      db.prepare(`DELETE FROM ${table} WHERE workspace_id = ?`).run(workspaceId);
    }
    db.prepare("DELETE FROM workspaces WHERE id = ?").run(workspaceId);
  }
  if (createdTenantId) {
    db.prepare("DELETE FROM tenant_members WHERE tenant_id = ?").run(createdTenantId);
    db.prepare("DELETE FROM tenants WHERE id = ?").run(createdTenantId);
  }
  if (createdUserId) {
    db.prepare("DELETE FROM model_configs WHERE owner_user_id = ?").run(createdUserId);
    db.prepare("DELETE FROM auth_sessions WHERE user_id = ?").run(createdUserId);
    db.prepare("DELETE FROM users WHERE id = ?").run(createdUserId);
  }
}

async function request(path: string, init: RequestInit = {}) {
  const response = await requestRaw(path, init);
  const text = await response.text();
  const body = text ? parseJsonOrText(text) : null;
  if (!response.ok) throw new Error(`${init.method || "GET"} ${path} failed ${response.status}: ${JSON.stringify(body)}`);
  return body;
}

function parseJsonOrText(text: string) {
  try {
    return JSON.parse(text);
  } catch {
    return { text };
  }
}

async function requestRaw(path: string, init: RequestInit = {}) {
  const response = await fetch(`${apiBase}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(authCookie ? { Cookie: authCookie } : {}),
      ...(init.headers ?? {})
    }
  });
  const setCookie = response.headers.get("set-cookie");
  if (setCookie?.includes("maple_session=")) authCookie = setCookie.split(";")[0];
  return response;
}

async function pollRuntimePoolActive(workspaceId: string, expected: number) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const pool = await request(`/v1/workspaces/${workspaceId}/runtime_pool`);
    if (pool.members.length === expected && pool.members.every((member: Record<string, unknown>) => member.status === "active")) return pool;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("runtime pool members did not become active in time");
}

async function waitForHealth() {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 10_000) {
    try {
      const response = await fetch(`${apiBase}/health`);
      if (response.ok) return;
    } catch {
      // keep waiting
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`server did not start on ${apiBase}\n${serverOutput}`);
}

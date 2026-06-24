import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { db } from "../../apps/control-plane-api/src/store";
import { writeFakeVefaasRuntimeDeployScript } from "./helpers/fakeVefaasDeploy";

const dataDir = mkdtempSync(join(tmpdir(), "maple-memory-contract-"));
const port = 25_000 + Math.floor(Math.random() * 2000);
const apiBase = `http://127.0.0.1:${port}`;
const stamp = Date.now().toString(36);
const email = `memory-${stamp}@example.com`;

let authCookie = "";
let userId = "";
let tenantId = "";
let workspaceId = "";
let secondTenantId = "";
let secondWorkspaceId = "";
let agentId = "";
let environmentId = "";
let localStoreId = "";
let readOnlySessionId = "";

const fakeRuntime = createServer(async (_request, response) => {
  response.writeHead(200, { "Content-Type": "application/json" });
  response.end(JSON.stringify({ ok: true, result: { status: "ready" } }));
});
await new Promise<void>((resolve) => fakeRuntime.listen(0, "127.0.0.1", resolve));
const fakeAddress = fakeRuntime.address();
if (!fakeAddress || typeof fakeAddress === "string") throw new Error("fake runtime did not bind");
const deployScript = writeFakeVefaasRuntimeDeployScript(dataDir, `http://127.0.0.1:${fakeAddress.port}/invoke`);

const server = spawn(process.execPath, ["apps/control-plane-api/src/index.ts"], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    PORT: String(port),
    HOST: "127.0.0.1",
    MAPLE_DATA_DIR: dataDir,
    MAPLE_DEV_LOGIN: "true",
    MAPLE_DISABLE_SESSION_BOOTSTRAP: "true",
    MAPLE_VEFAAS_RUNTIME_DEPLOY_SCRIPT: deployScript,
    ARK_API_KEY: "memory-contract-ark-key",
    MAPLE_VOLCENGINE_CREDENTIAL_VALIDATION: "off",
    MAPLE_ALIYUN_CREDENTIAL_VALIDATION: "off",
    OPENVIKING_BASE_URL: "https://openviking.example.invalid",
    OPENVIKING_API_KEY: "openviking-env-key"
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
    body: JSON.stringify({ provider: "local", email, name: "Memory Contract" })
  });
  userId = login.user.id;
  const models = await request("/v1/model_configs");
  const model = models.data.find((item: Record<string, unknown>) => item.is_default) ?? models.data[0];
  assert.ok(model?.id);

  const primary = await onboard("Memory Workspace", "memory-contract");
  workspaceId = primary.workspace.id;
  tenantId = primary.tenant.id;
  await pollRuntimePoolActive(workspaceId);

  const secondary = await createWorkspace("Memory Foreign Workspace", "memory-foreign");
  secondWorkspaceId = secondary.workspace.id;
  secondTenantId = String(secondary.workspace.tenant_id || tenantId);
  await pollRuntimePoolActive(secondWorkspaceId);

  const environment = await request("/v1/environments", {
    method: "POST",
    body: JSON.stringify({
      workspace_id: workspaceId,
      name: `memory-env-${stamp}`,
      config: { type: "e2b", sandbox: { provider: "e2b" } }
    })
  });
  environmentId = environment.id;
  const agent = await request("/v1/agents", {
    method: "POST",
    body: JSON.stringify({
      workspace_id: workspaceId,
      name: `Memory Agent ${stamp}`,
      description: "Memory contract agent",
      model: { provider: "custom", id: model.model_name, config_id: model.id, name: model.name },
      system: "Use attached memory stores only.",
      tools: [{ name: "memory_search" }, { name: "memory_write" }],
      mcp_servers: [],
      skills: []
    })
  });
  agentId = agent.id;

  const localStore = await request("/v1/memory_stores", {
    method: "POST",
    body: JSON.stringify({
      workspace_id: workspaceId,
      name: `Project Memory ${stamp}`,
      description: "Project conventions",
      provider: "local"
    })
  });
  localStoreId = localStore.id;
  assert.equal(localStore.provider, "local");
  assert.equal(localStore.status, "active");
  assert.equal(localStore.memory_count, 0);

  const openVikingStore = await request("/v1/memory_stores", {
    method: "POST",
    body: JSON.stringify({
      workspace_id: workspaceId,
      name: `OpenViking Memory ${stamp}`,
      description: "OpenViking backed memories",
      provider: "openviking",
      openviking: {
        base_url: "https://openviking.example.invalid",
        target_uri: `viking://user/memories/memory-contract-${stamp}`,
        api_key: "openviking-route-secret"
      }
    })
  });
  assert.equal(openVikingStore.provider, "openviking");
  assert.equal(openVikingStore.external_ref, `viking://user/memories/memory-contract-${stamp}`);
  assert.equal(openVikingStore.api_key_ciphertext, undefined);
  assert.match(String(openVikingStore.api_key_hint || ""), /^ope\.\.\./);
  const storedOpenViking = db
    .prepare("SELECT api_key_ciphertext, api_key_hint FROM memory_stores WHERE id = ?")
    .get(String(openVikingStore.id)) as Record<string, unknown> | undefined;
  assert.ok(String(storedOpenViking?.api_key_ciphertext || "").includes("aes-256-gcm"));
  assert.ok(!String(storedOpenViking?.api_key_ciphertext || "").includes("openviking-route-secret"));

  const write = await request(`/v1/memory_stores/${localStoreId}/memories/projects/conventions.md`, {
    method: "PUT",
    body: JSON.stringify({ actor: "user", content: "# Conventions\n\n- Prefer TDD." })
  });
  assert.equal(write.path, "projects/conventions.md");
  assert.match(String(write.content_sha256 || ""), /^[a-f0-9]{64}$/);
  const update = await request(`/v1/memory_stores/${localStoreId}/memories/projects/conventions.md`, {
    method: "PUT",
    body: JSON.stringify({ actor: "user", content: "# Conventions\n\n- Prefer TDD.\n- Attach memory explicitly." })
  });
  assert.equal(update.id, write.id);
  const versionCount = db
    .prepare("SELECT COUNT(*) AS count FROM memory_versions WHERE memory_id = ? AND memory_store_id = ?")
    .get(String(write.id), localStoreId) as { count?: unknown } | undefined;
  assert.equal(Number(versionCount?.count || 0), 2);

  await assertRequestFails(`/v1/memory_stores/${localStoreId}/memories/%2E%2E%2Fsecret.md`, 400, "memory_path_invalid", {
    method: "PUT",
    body: JSON.stringify({ actor: "user", content: "bad" })
  });
  await assertRequestFails(`/v1/memory_stores/${localStoreId}/memories/too-large.md`, 400, "memory_content_too_large", {
    method: "PUT",
    body: JSON.stringify({ actor: "user", content: "x".repeat(101 * 1024) })
  });

  const session = await request("/v1/sessions", {
    method: "POST",
    body: JSON.stringify({
      workspace_id: workspaceId,
      agent: agentId,
      environment_id: environmentId,
      title: `Memory Session ${stamp}`,
      resources: [
        {
          type: "memory_store",
          memory_store_id: localStoreId,
          access: "read_only",
          instructions: "Use this store for project conventions."
        }
      ]
    })
  });
  readOnlySessionId = session.id;
  assert.deepEqual(session.metadata.resources, [
    {
      type: "memory_store",
      memory_store_id: localStoreId,
      access: "read_only",
      instructions: "Use this store for project conventions."
    }
  ]);

  const foreignStore = await request("/v1/memory_stores", {
    method: "POST",
    body: JSON.stringify({
      workspace_id: secondWorkspaceId,
      name: `Foreign Memory ${stamp}`,
      description: "foreign",
      provider: "local"
    })
  });
  await assertRequestFails("/v1/sessions", 400, "memory_store_workspace_mismatch", {
    method: "POST",
    body: JSON.stringify({
      workspace_id: workspaceId,
      agent: agentId,
      environment_id: environmentId,
      resources: [{ type: "memory_store", memory_store_id: foreignStore.id, access: "read_write" }]
    })
  });

  const { executeSessionMemoryTool } = await import("../../apps/control-plane-api/src/memory/sessionMemoryTools");
  const { runRuntimeToolCall } = await import("../../apps/control-plane-api/src/runtime/runner");
  const attachedSearch = await executeSessionMemoryTool(readOnlySessionId, "memory_search", { query: "TDD" });
  assert.equal(attachedSearch.results.length, 1);
  assert.equal(attachedSearch.results[0].memory_store_id, localStoreId);
  const bridgedSearch = await runRuntimeToolCall(readOnlySessionId, "memory_search", { query: "TDD", memory_store_id: localStoreId });
  assert.equal(bridgedSearch.ok, true);
  assert.equal((bridgedSearch.output as { results: unknown[] }).results.length, 1);
  const bridgedWrite = await runRuntimeToolCall(readOnlySessionId, "memory_write", { memory_store_id: localStoreId, path: "projects/agent.md", content: "blocked" });
  assert.equal(bridgedWrite.ok, false);
  assert.match(String((bridgedWrite.output as { error?: unknown }).error || ""), /memory_store_read_only/);
  await assert.rejects(
    () => executeSessionMemoryTool(readOnlySessionId, "memory_write", { memory_store_id: localStoreId, path: "projects/agent.md", content: "blocked" }),
    /memory_store_read_only/
  );

  const writableSession = await request("/v1/sessions", {
    method: "POST",
    body: JSON.stringify({
      workspace_id: workspaceId,
      agent: agentId,
      environment_id: environmentId,
      title: `Memory Writable Session ${stamp}`,
      resources: [{ type: "memory_store", memory_store_id: localStoreId, access: "read_write" }]
    })
  });
  await executeSessionMemoryTool(writableSession.id, "memory_write", {
    memory_store_id: localStoreId,
    path: "projects/agent.md",
    content: "Agent learned this through a session."
  });
  const agentMemory = await request(`/v1/memory_stores/${localStoreId}/memories?query=Agent%20learned`);
  assert.equal(agentMemory.data.some((item: Record<string, unknown>) => item.path === "projects/agent.md"), true);

  const emptySession = await request("/v1/sessions", {
    method: "POST",
    body: JSON.stringify({
      workspace_id: workspaceId,
      agent: agentId,
      environment_id: environmentId,
      title: `Memory Empty Session ${stamp}`,
      resources: []
    })
  });
  await assert.rejects(
    () => executeSessionMemoryTool(emptySession.id, "memory_search", { query: "TDD", memory_store_id: localStoreId }),
    /memory_store_not_attached/
  );

  const deployment = await request("/v1/deployments", {
    method: "POST",
    body: JSON.stringify({
      workspace_id: workspaceId,
      agent_id: agentId,
      environment_id: environmentId,
      name: `memory-deployment-${stamp}`,
      version: "1",
      initial_events: [{ type: "user.message", payload: { content: [{ type: "text", text: "Use memory." }] } }],
      resources: [{ type: "memory_store", memory_store_id: localStoreId, access: "read_write", instructions: "deployment memory" }]
    })
  });
  assert.deepEqual(deployment.memory_store_ids, [localStoreId]);
  const run = await request(`/v1/deployments/${deployment.id}/run`, { method: "POST", body: JSON.stringify({}) });
  const runSession = await request(`/v1/sessions/${run.session_id}`);
  assert.deepEqual(runSession.metadata.resources, [
    { type: "memory_store", memory_store_id: localStoreId, access: "read_write", instructions: "deployment memory" }
  ]);
  const deletedWorkspace = await request(`/v1/workspaces/${workspaceId}`, { method: "DELETE" });
  assert.equal(deletedWorkspace.ok, true);
  assert.equal(deletedWorkspace.counts.deployment_runs, 1);
  assert.equal(deletedWorkspace.counts.agent_deployments, 1);

  console.log("memory store contract passed");
} finally {
  server.kill();
  fakeRuntime.close();
  cleanupRecords();
}

async function onboard(name: string, slugPrefix: string) {
  const models = await request("/v1/model_configs");
  const model = models.data.find((item: Record<string, unknown>) => item.is_default) ?? models.data[0];
  return request("/v1/workspace_onboarding", {
    method: "POST",
    body: JSON.stringify({
      tenant: { name: `${name} Tenant ${stamp}` },
      workspace: { name: `${name} ${stamp}`, slug: `${slugPrefix}-${stamp}` },
      runtime_provider: "vefaas",
      runtime_pool: {
        desired_size: 1,
        max_instances_per_function: 100,
        max_concurrency_per_instance: 1000,
        cpu_milli: 2000,
        memory_mb: 4096
      },
      sandbox_provider: "e2b",
      model_config_ids: [model.id],
      api_key: { display_name: `${name} key`, scopes: ["control_plane", "data_plane"] },
      provider_credentials: {
        vefaas: { VOLCENGINE_ACCESS_KEY: "ak", VOLCENGINE_SECRET_KEY: "sk", VEFAAS_REGION: "cn-beijing" },
        e2b: { E2B_API_KEY: "e2b" }
      }
    })
  });
}

async function createWorkspace(name: string, slugPrefix: string) {
  const models = await request("/v1/model_configs");
  const model = models.data.find((item: Record<string, unknown>) => item.is_default) ?? models.data[0];
  return request("/v1/workspaces", {
    method: "POST",
    body: JSON.stringify({
      tenant_id: tenantId,
      workspace: { name: `${name} ${stamp}`, slug: `${slugPrefix}-${stamp}` },
      runtime_provider: "vefaas",
      runtime_pool: {
        desired_size: 1,
        max_instances_per_function: 100,
        max_concurrency_per_instance: 1000,
        cpu_milli: 2000,
        memory_mb: 4096
      },
      sandbox_provider: "e2b",
      model_config_ids: [model.id],
      api_key: { display_name: `${name} key`, scopes: ["control_plane", "data_plane"] },
      provider_credentials: {
        vefaas: { VOLCENGINE_ACCESS_KEY: "ak", VOLCENGINE_SECRET_KEY: "sk", VEFAAS_REGION: "cn-beijing" },
        e2b: { E2B_API_KEY: "e2b" }
      }
    })
  });
}

async function request(path: string, init: RequestInit = {}) {
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
  const text = await response.text();
  const body = text ? parseJson(text) : null;
  if (!response.ok) throw new Error(`${init.method || "GET"} ${path} failed ${response.status}: ${JSON.stringify(body)}`);
  return body;
}

async function assertRequestFails(path: string, status: number, error: string, init: RequestInit = {}) {
  const response = await fetch(`${apiBase}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(authCookie ? { Cookie: authCookie } : {}),
      ...(init.headers ?? {})
    }
  });
  const body = parseJson(await response.text());
  assert.equal(response.status, status);
  assert.equal(body.error, error);
}

function parseJson(text: string) {
  try {
    return JSON.parse(text);
  } catch {
    return { text };
  }
}

async function waitForHealth() {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 15_000) {
    try {
      const response = await fetch(`${apiBase}/health`);
      if (response.ok) return;
    } catch {
      // keep waiting
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`api did not become healthy. output=${serverOutput}`);
}

async function pollRuntimePoolActive(id: string) {
  return poll(async () => {
    const pool = await request(`/v1/workspaces/${id}/runtime_pool`);
    return pool.members.length === 1 && pool.members[0].status === "active" ? pool : null;
  }, 15_000, "active runtime pool");
}

async function poll<T>(fn: () => Promise<T | null>, timeoutMs: number, label: string) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const value = await fn();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

function cleanupRecords() {
  for (const id of [workspaceId, secondWorkspaceId].filter(Boolean)) {
    db.prepare("DELETE FROM deployment_runs WHERE workspace_id = ?").run(id);
    const sessions = db.prepare("SELECT id FROM sessions WHERE workspace_id = ?").all(id) as Array<{ id: string }>;
    for (const { id: sessionId } of sessions) {
      db.prepare("DELETE FROM session_artifacts WHERE session_id = ?").run(sessionId);
      db.prepare("DELETE FROM tool_calls WHERE session_id = ?").run(sessionId);
      db.prepare("DELETE FROM session_events WHERE session_id = ?").run(sessionId);
      db.prepare("DELETE FROM session_threads WHERE session_id = ?").run(sessionId);
    }
    const memories = db.prepare("SELECT id FROM memories WHERE workspace_id = ?").all(id) as Array<{ id: string }>;
    for (const { id: memoryId } of memories) db.prepare("DELETE FROM memory_versions WHERE memory_id = ?").run(memoryId);
    const agents = db.prepare("SELECT id FROM agents WHERE workspace_id = ?").all(id) as Array<{ id: string }>;
    for (const { id: scopedAgentId } of agents) {
      db.prepare("DELETE FROM agent_deployments WHERE agent_id = ?").run(scopedAgentId);
      db.prepare("DELETE FROM agent_versions WHERE agent_id = ?").run(scopedAgentId);
    }
    db.prepare("DELETE FROM memories WHERE workspace_id = ?").run(id);
    db.prepare("DELETE FROM memory_stores WHERE workspace_id = ?").run(id);
    db.prepare("DELETE FROM sessions WHERE workspace_id = ?").run(id);
    db.prepare("DELETE FROM agents WHERE workspace_id = ?").run(id);
    db.prepare("DELETE FROM environments WHERE workspace_id = ?").run(id);
    db.prepare("DELETE FROM workspace_api_keys WHERE workspace_id = ?").run(id);
    db.prepare("DELETE FROM workspace_runtime_pool_members WHERE workspace_id = ?").run(id);
    db.prepare("DELETE FROM workspace_runtime_pools WHERE workspace_id = ?").run(id);
    db.prepare("DELETE FROM workspace_members WHERE workspace_id = ?").run(id);
    db.prepare("DELETE FROM workspaces WHERE id = ?").run(id);
  }
  for (const id of [tenantId, secondTenantId].filter(Boolean)) {
    db.prepare("DELETE FROM tenant_members WHERE tenant_id = ?").run(id);
    db.prepare("DELETE FROM tenants WHERE id = ?").run(id);
  }
  if (userId) {
    db.prepare("DELETE FROM model_configs WHERE owner_user_id = ?").run(userId);
    db.prepare("DELETE FROM auth_sessions WHERE user_id = ?").run(userId);
    db.prepare("DELETE FROM users WHERE id = ?").run(userId);
  }
}

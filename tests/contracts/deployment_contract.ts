import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { db } from "../../apps/control-plane-api/src/store";
import { writeFakeVefaasRuntimeDeployScript } from "./helpers/fakeVefaasDeploy";

const dataDir = mkdtempSync(join(tmpdir(), "maple-deployment-contract-"));
const port = 24_000 + Math.floor(Math.random() * 2000);
const apiBase = `http://127.0.0.1:${port}`;
const stamp = Date.now().toString(36);
let authCookie = "";
let userId = "";
let tenantId = "";
let workspaceId = "";

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
    MAPLE_DEPLOYMENT_SCHEDULER_INTERVAL_MS: "1000",
    MAPLE_VEFAAS_RUNTIME_DEPLOY_SCRIPT: deployScript,
    ARK_API_KEY: "deployment-contract-ark-key"
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
    body: JSON.stringify({ provider: "local", email: `deployment-${stamp}@example.com`, name: "Deployment Contract" })
  });
  userId = login.user.id;
  const models = await request("/v1/model_configs");
  const model = models.data.find((item: Record<string, unknown>) => item.is_default) ?? models.data[0];
  assert.ok(model?.id);

  const onboarding = await request("/v1/workspace_onboarding", {
    method: "POST",
    body: JSON.stringify({
      tenant: { name: `Deployment Tenant ${stamp}` },
      workspace: { name: `Deployment Workspace ${stamp}`, slug: `deployment-${stamp}` },
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
      api_key: { display_name: "Deployment contract key", scopes: ["control_plane", "data_plane"] },
      provider_credentials: {
        vefaas: { VOLCENGINE_ACCESS_KEY: "ak", VOLCENGINE_SECRET_KEY: "sk", VEFAAS_REGION: "cn-beijing" },
        e2b: { E2B_API_KEY: "e2b" }
      }
    })
  });
  workspaceId = onboarding.workspace.id;
  tenantId = onboarding.tenant.id;
  await pollRuntimePoolActive(workspaceId);

  const environment = await request("/v1/environments", {
    method: "POST",
    body: JSON.stringify({
      workspace_id: workspaceId,
      name: "deployment-contract-env",
      config: { type: "e2b", sandbox: { provider: "e2b" } }
    })
  });
  const agent = await request("/v1/agents", {
    method: "POST",
    body: JSON.stringify({
      workspace_id: workspaceId,
      name: "Deployment Contract Agent",
      description: "Deployment contract agent",
      model: { provider: "custom", id: model.model_name, config_id: model.id, name: model.name },
      system: "Echo contract evidence.",
      tools: [],
      mcp_servers: [],
      skills: []
    })
  });

  const deployment = await createDeployment(agent.id, environment.id, "manual", null);
  assert.equal(deployment.status, "active");
  assert.equal(deployment.next_run_at, null);
  assert.equal(deployment.initial_events[0].type, "user.message");

  const list = await request(`/v1/deployments?workspace_id=${workspaceId}`);
  assert.equal(list.data.some((item: Record<string, unknown>) => item.id === deployment.id), true);
  const bootstrap = await request(`/v1/bootstrap?workspace_id=${workspaceId}`);
  assert.equal(bootstrap.deployments.some((item: Record<string, unknown>) => item.id === deployment.id), true);

  const manualRun = await request(`/v1/deployments/${deployment.id}/run`, { method: "POST", body: JSON.stringify({}) });
  assert.ok(manualRun.deployment_run_id);
  assert.ok(manualRun.session_id);
  assert.ok(manualRun.event_id);
  let runs = await request(`/v1/deployments/${deployment.id}/runs`);
  assert.equal(runs.data[0].status, "succeeded");
  assert.equal(runs.data[0].session_id, manualRun.session_id);

  const paused = await request(`/v1/deployments/${deployment.id}/pause`, { method: "POST", body: JSON.stringify({ reason: "contract" }) });
  assert.equal(paused.status, "paused");
  assert.equal(paused.next_run_at, null);
  const unpaused = await request(`/v1/deployments/${deployment.id}/unpause`, { method: "POST", body: JSON.stringify({}) });
  assert.equal(unpaused.status, "active");

  const scheduled = await createDeployment(agent.id, environment.id, "scheduled", { type: "cron", expression: "* * * * *", timezone: "UTC" });
  assert.ok(scheduled.next_run_at);
  db.prepare("UPDATE agent_deployments SET next_run_at = ?, scheduler_locked_until = NULL, scheduler_locked_by = NULL WHERE id = ?").run(
    new Date(Date.now() - 60_000).toISOString(),
    scheduled.id
  );
  const scheduledRuns = await poll(async () => {
    const history = await request(`/v1/deployments/${scheduled.id}/runs`);
    return history.data.find((run: Record<string, unknown>) => run.triggered_by === "scheduled" && run.status === "succeeded") ?? null;
  }, 12_000, "scheduled deployment run");
  assert.ok(scheduledRuns.session_id);
  assert.notEqual(scheduledRuns.session_id, manualRun.session_id);

  const archived = await request(`/v1/deployments/${scheduled.id}/archive`, { method: "POST", body: JSON.stringify({}) });
  assert.equal(archived.status, "archived");
  const afterArchive = await request(`/v1/deployments?workspace_id=${workspaceId}`);
  assert.equal(afterArchive.data.some((item: Record<string, unknown>) => item.id === scheduled.id), false);

  console.log("deployment contract passed");
} finally {
  server.kill();
  fakeRuntime.close();
  cleanupRecords();
}

async function createDeployment(agentId: string, environmentId: string, suffix: string, schedule: Record<string, unknown> | null) {
  return request("/v1/deployments", {
    method: "POST",
    body: JSON.stringify({
      workspace_id: workspaceId,
      agent_id: agentId,
      environment_id: environmentId,
      name: `deployment-contract-${suffix}-${stamp}`,
      version: "1",
      initial_events: [
        { type: "user.message", payload: { content: [{ type: "text", text: `deployment contract ${suffix}` }] } }
      ],
      schedule
    })
  });
}

function cleanupRecords() {
  if (!workspaceId) return;
  db.prepare("DELETE FROM deployment_runs WHERE workspace_id = ?").run(workspaceId);
  const sessions = db.prepare("SELECT id FROM sessions WHERE workspace_id = ?").all(workspaceId) as Array<{ id: string }>;
  for (const { id } of sessions) {
    db.prepare("DELETE FROM session_artifacts WHERE session_id = ?").run(id);
    db.prepare("DELETE FROM tool_calls WHERE session_id = ?").run(id);
    db.prepare("DELETE FROM session_events WHERE session_id = ?").run(id);
    db.prepare("DELETE FROM session_threads WHERE session_id = ?").run(id);
  }
  const agents = db.prepare("SELECT id FROM agents WHERE workspace_id = ?").all(workspaceId) as Array<{ id: string }>;
  for (const { id } of agents) {
    db.prepare("DELETE FROM agent_deployments WHERE agent_id = ?").run(id);
    db.prepare("DELETE FROM agent_versions WHERE agent_id = ?").run(id);
  }
  db.prepare("DELETE FROM sessions WHERE workspace_id = ?").run(workspaceId);
  db.prepare("DELETE FROM agents WHERE workspace_id = ?").run(workspaceId);
  db.prepare("DELETE FROM environments WHERE workspace_id = ?").run(workspaceId);
  db.prepare("DELETE FROM workspace_api_keys WHERE workspace_id = ?").run(workspaceId);
  db.prepare("DELETE FROM workspace_runtime_pool_members WHERE workspace_id = ?").run(workspaceId);
  db.prepare("DELETE FROM workspace_runtime_pools WHERE workspace_id = ?").run(workspaceId);
  db.prepare("DELETE FROM workspace_members WHERE workspace_id = ?").run(workspaceId);
  db.prepare("DELETE FROM workspaces WHERE id = ?").run(workspaceId);
  if (tenantId) {
    db.prepare("DELETE FROM tenant_members WHERE tenant_id = ?").run(tenantId);
    db.prepare("DELETE FROM tenants WHERE id = ?").run(tenantId);
  }
  if (userId) {
    db.prepare("DELETE FROM model_configs WHERE owner_user_id = ?").run(userId);
    db.prepare("DELETE FROM auth_sessions WHERE user_id = ?").run(userId);
    db.prepare("DELETE FROM users WHERE id = ?").run(userId);
  }
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

function parseJson(text: string) {
  try {
    return JSON.parse(text);
  } catch {
    return { text };
  }
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

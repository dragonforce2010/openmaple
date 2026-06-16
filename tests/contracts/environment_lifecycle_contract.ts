import assert from "node:assert/strict";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { db } from "../../apps/control-plane-api/src/store";
import { writeFakeVefaasRuntimeDeployScript } from "./helpers/fakeVefaasDeploy";

const contractDir = mkdtempSync(join(tmpdir(), "maple-environment-lifecycle-"));
const deployScript = writeFakeVefaasRuntimeDeployScript(contractDir, "https://example.invalid/maple-runtime");
const port = 26_000 + Math.floor(Math.random() * 1000);
const apiBase = `http://127.0.0.1:${port}`;
const stamp = Date.now().toString(36);
const email = `environment-lifecycle-${stamp}@example.invalid`;

let authCookie = "";
let serverOutput = "";
let server: ChildProcessWithoutNullStreams | null = null;
let userId = "";
let tenantId = "";
let workspaceId = "";
let environmentId = "";
let agentId = "";
let sessionId = "";

server = spawn("bun", ["apps/control-plane-api/src/index.ts"], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    PORT: String(port),
    HOST: "127.0.0.1",
    MAPLE_DATA_DIR: contractDir,
    MAPLE_VEFAAS_RUNTIME_DEPLOY_SCRIPT: deployScript,
    MAPLE_DISABLE_SESSION_BOOTSTRAP: "1",
    MAPLE_DEV_LOGIN: "true",
    ARK_API_KEY: "contract-ark-key"
  },
  stdio: ["ignore", "pipe", "pipe"]
});
server.stdout.on("data", (chunk) => (serverOutput += String(chunk)));
server.stderr.on("data", (chunk) => (serverOutput += String(chunk)));

try {
  await waitForHealth();

  const login = await request("/v1/auth/login", {
    method: "POST",
    body: JSON.stringify({ provider: "local", email, name: "Environment Lifecycle Contract" })
  });
  userId = String(login.user.id);

  const models = await request("/v1/model_configs");
  const model = models.data.find((item: Record<string, unknown>) => item.is_default) ?? models.data[0];
  assert.ok(model?.id);

  const created = await request("/v1/workspaces", {
    method: "POST",
    body: JSON.stringify({
      workspace: { name: `Environment Lifecycle ${stamp}`, description: "environment lifecycle contract", slug: `env-life-${stamp}` },
      runtime_provider: "vefaas",
      runtime_pool: { desired_size: 1, max_instances_per_function: 10, max_concurrency_per_instance: 20, cpu_milli: 1000, memory_mb: 2048 },
      sandbox_provider: "e2b",
      model_config_ids: [model.id],
      api_key: { display_name: "Environment lifecycle key", scopes: ["control_plane", "data_plane"] },
      provider_credentials: {
        vefaas: { VOLCENGINE_ACCESS_KEY: "contract-access-key", VOLCENGINE_SECRET_KEY: "contract-secret-key", VEFAAS_REGION: "cn-beijing" },
        e2b: { E2B_API_KEY: "contract-e2b-key" }
      }
    })
  });
  workspaceId = String(created.workspace.id);
  tenantId = String(created.workspace.tenant_id || "");
  await pollRuntimePoolActive(workspaceId);

  const environment = await request("/v1/environments", {
    method: "POST",
    body: JSON.stringify({
      workspace_id: workspaceId,
      name: `Python Data QA ${stamp}`,
      description: "Runs pandas/openpyxl checks",
      config: {
        type: "e2b",
        sandbox: { provider: "e2b", e2b: { template: "base", workspace_path: "/workspace", timeout_ms: 3600000 } },
        networking: { mode: "cloud_unrestricted", allow_package_managers: true },
        packages: [{ manager: "pip", name: "pandas==2.2.3" }, { manager: "pip", name: "openpyxl==3.1.5" }]
      }
    })
  });
  environmentId = String(environment.id);
  assert.equal(environment.config.description, "Runs pandas/openpyxl checks");
  assert.equal(environment.config.packages.length, 2);

  const patched = await request(`/v1/environments/${environmentId}`, {
    method: "PATCH",
    body: JSON.stringify({
      name: `Python Data QA Renamed ${stamp}`,
      description: "Renamed environment description",
      config: { networking: { mode: "cloud_limited" } }
    })
  });
  assert.equal(patched.name, `Python Data QA Renamed ${stamp}`);
  assert.equal(patched.config.description, "Renamed environment description");
  assert.equal(patched.config.networking.mode, "cloud_limited");
  assert.equal(patched.config.packages.length, 2, "patch must merge and preserve package config");

  const agent = await request("/v1/agents", {
    method: "POST",
    body: JSON.stringify({
      workspace_id: workspaceId,
      name: `Environment Linked Agent ${stamp}`,
      description: "Uses environment lifecycle session",
      model: { provider: model.provider_type, id: model.model_name, config_id: model.id },
      system: "Use the selected environment to inspect files.",
      tools: [{ type: "agent_toolset_20260401" }],
      mcp_servers: [],
      skills: [],
      agent_loop: { type: "anthropic_claude_code" }
    })
  });
  agentId = String(agent.id);

  const session = await request("/v1/sessions", {
    method: "POST",
    body: JSON.stringify({
      workspace_id: workspaceId,
      agent: agentId,
      environment_id: environmentId,
      title: `Environment Linked Session ${stamp}`,
      metadata: { agent_runtime: { provider: "local", type: "local" } }
    })
  });
  sessionId = String(session.id);

  const preview = await request(`/v1/environments/${environmentId}/delete_preview`);
  assert.equal(preview.environment.id, environmentId);
  assert.ok(preview.related_agents.some((item: Record<string, unknown>) => item.id === agentId));
  assert.ok(preview.related_sessions.some((item: Record<string, unknown>) => item.id === sessionId));
  assert.equal(preview.can_delete_without_force, false);

  const blocked = await requestRaw(`/v1/environments/${environmentId}`, { method: "DELETE" });
  assert.equal(blocked.status, 409);
  const blockedBody = await blocked.json();
  assert.equal(blockedBody.error, "environment_has_links");
  assert.ok(blockedBody.related_agents.some((item: Record<string, unknown>) => item.id === agentId));

  const deleted = await request(`/v1/environments/${environmentId}?force=1`, { method: "DELETE" });
  assert.equal(deleted.ok, true);
  assert.equal(deleted.environment.id, environmentId);
  assert.ok(deleted.environment.archived_at);

  const listed = await request(`/v1/environments?workspace_id=${workspaceId}`);
  assert.equal(listed.data.some((item: Record<string, unknown>) => item.id === environmentId), false);

  const detail = await request(`/v1/sessions/${sessionId}/detail`);
  assert.equal(detail.environment.id, environmentId, "session detail should keep archived environment traceability");

  console.log("environment lifecycle contract passed");
} finally {
  cleanupRecords();
  server?.kill();
}

function cleanupRecords() {
  if (sessionId) {
    db.prepare("DELETE FROM session_artifacts WHERE session_id = ?").run(sessionId);
    db.prepare("DELETE FROM tool_calls WHERE session_id = ?").run(sessionId);
    db.prepare("DELETE FROM session_events WHERE session_id = ?").run(sessionId);
    db.prepare("DELETE FROM session_threads WHERE session_id = ?").run(sessionId);
    db.prepare("DELETE FROM sessions WHERE id = ?").run(sessionId);
  }
  if (agentId) {
    db.prepare("DELETE FROM agent_deployments WHERE agent_id = ?").run(agentId);
    db.prepare("DELETE FROM agent_versions WHERE agent_id = ?").run(agentId);
    db.prepare("DELETE FROM agents WHERE id = ?").run(agentId);
  }
  if (environmentId) db.prepare("DELETE FROM environments WHERE id = ?").run(environmentId);
  if (workspaceId) {
    db.prepare("DELETE FROM workspace_api_keys WHERE workspace_id = ?").run(workspaceId);
    db.prepare("DELETE FROM workspace_runtime_pool_members WHERE workspace_id = ?").run(workspaceId);
    db.prepare("DELETE FROM workspace_runtime_pools WHERE workspace_id = ?").run(workspaceId);
    db.prepare("DELETE FROM workspace_members WHERE workspace_id = ?").run(workspaceId);
    db.prepare("DELETE FROM workspaces WHERE id = ?").run(workspaceId);
  }
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
  const response = await requestRaw(path, init);
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(`${init.method || "GET"} ${path} failed ${response.status}: ${text}`);
  return body;
}

async function requestRaw(path: string, init: RequestInit = {}) {
  const method = String(init.method || "GET").toUpperCase();
  const override = method === "PATCH" || method === "DELETE";
  const response = await fetch(`${apiBase}${path}`, {
    ...init,
    method: override ? "POST" : init.method,
    headers: {
      "Content-Type": "application/json",
      ...(override ? { "X-HTTP-Method-Override": method } : {}),
      ...(authCookie ? { Cookie: authCookie } : {}),
      ...(init.headers ?? {})
    }
  });
  const setCookie = response.headers.get("set-cookie");
  if (setCookie?.includes("maple_session=")) authCookie = setCookie.split(";")[0];
  return response;
}

async function pollRuntimePoolActive(id: string) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const pool = await request(`/v1/workspaces/${id}/runtime_pool`);
    if (pool.members.length === 1 && pool.members.every((member: Record<string, unknown>) => member.status === "active")) return pool;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("runtime pool member did not become active");
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

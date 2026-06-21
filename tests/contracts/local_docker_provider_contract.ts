import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

loadEnvFile(join(homedir(), ".agents", ".env"));
loadEnvFile(join(process.cwd(), ".env"));
const { db } = await import("../../apps/control-plane-api/src/store");

const dataDir = mkdtempSync(join(tmpdir(), "maple-local-docker-provider-"));
const port = 21_000 + Math.floor(Math.random() * 2000);
const apiBase = `http://127.0.0.1:${port}`;
const requestTimeoutMs = 180_000;
const stamp = Date.now().toString(36);
let authCookie = "";
let createdUserId = "";
let createdTenantId = "";

const server = spawn("bun", ["apps/control-plane-api/src/index.ts"], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    PORT: String(port),
    HOST: "127.0.0.1",
    MAPLE_DATA_DIR: dataDir,
    MAPLE_LOCAL_DOCKER_MODE: "true",
    MAPLE_AGENT_RUNTIME_PROVIDER: "local_docker",
    MAPLE_SANDBOX_PROVIDER: "local_docker",
    MAPLE_DOCKER_IMAGE: "node:22-bookworm",
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

  const providers = await request("/v1/auth/providers");
  assert.deepEqual(providers.data.map((item: Record<string, unknown>) => item.id), ["local"]);

  const login = await request("/v1/auth/login", {
    method: "POST",
    body: JSON.stringify({ provider: "local", email: `local-docker-${stamp}@example.com`, name: "Local Docker Contract" })
  });
  createdUserId = login.user.id;

  const models = await request("/v1/model_configs");
  assert.equal(models.data.length, 0, "local Docker mode should not expose bundled model configs by default");

  const created = await request("/v1/workspace_onboarding", {
    method: "POST",
    body: JSON.stringify({
      tenant: { name: "Local Docker Tenant", description: "Local Docker provider contract" },
      workspace: { name: "Local Docker Workspace", description: "No cloud credentials", slug: `local-docker-${stamp}` },
      runtime_provider: "local_docker",
      runtime_pool: {
        desired_size: 2,
        min_instances_per_function: 0,
        max_instances_per_function: 10,
        max_concurrency_per_instance: 20,
        cpu_milli: 1000,
        memory_mb: 2048
      },
      sandbox_provider: "local_docker",
      sandbox_config: { local_docker: { image: "node:22-bookworm", networking: { mode: "limited" } } },
      sandbox_pool: { desired_size: 2, standby_ttl_ms: 30 * 60 * 1000 },
      model_config_ids: [],
      api_key: { display_name: "Local Docker workspace key", scopes: ["control_plane", "data_plane"] },
      provider_credentials: {}
    })
  });

  createdTenantId = created.tenant.id;
  const workspaceId = created.workspace.id;
  assert.equal(created.workspace.runtime_provider, "local_docker");
  assert.equal(created.workspace.sandbox_provider, "local_docker");
  assert.equal(created.workspace.config.cloud_provider_identities.local_docker.configured, true);
  assert.equal(created.runtime_pool.provider, "local_docker");
  assert.equal(created.runtime_pool.members.length, 2);
  assert.equal(created.runtime_pool.members.every((member: Record<string, unknown>) => member.status === "active"), true);
  assert.equal(created.sandbox_pool.provider, "local_docker");
  assert.equal(created.sandbox_pool.members.length, 2);
  assert.equal(created.sandbox_pool.members.every((member: Record<string, unknown>) => member.status === "standby"), true);

  const environments = await request(`/v1/environments?workspace_id=${workspaceId}`);
  assert.equal(environments.data.length, 1);
  assert.equal(environments.data[0].config.sandbox.provider, "local_docker");

  const pool = await request(`/v1/workspaces/${workspaceId}/runtime_pool`);
  assert.equal(pool.member_status_counts.active, 2);
  const sandboxPool = await request(`/v1/workspaces/${workspaceId}/sandbox_pool`);
  assert.equal(sandboxPool.member_status_counts.standby, 2);

  console.log("local docker provider contract passed");
} finally {
  await stopServer();
  try {
    cleanupContractRecords();
  } catch (cleanupError) {
    console.error("local docker provider contract cleanup failed", cleanupError);
  }
}

function cleanupContractRecords() {
  const workspaceRows = createdTenantId
    ? (db.prepare("SELECT id FROM workspaces WHERE tenant_id = ?").all(createdTenantId) as Array<{ id: string }>)
    : [];
  for (const { id: workspaceId } of workspaceRows) {
    for (const table of ["workspace_sandbox_pool_members", "workspace_runtime_pool_members", "workspace_runtime_pools", "environments", "model_configs", "workspace_api_keys", "workspace_members"]) {
      db.prepare(`DELETE FROM ${table} WHERE workspace_id = ?`).run(workspaceId);
    }
    db.prepare("DELETE FROM workspaces WHERE id = ?").run(workspaceId);
  }
  if (createdTenantId) {
    db.prepare("DELETE FROM tenant_members WHERE tenant_id = ?").run(createdTenantId);
    db.prepare("DELETE FROM tenants WHERE id = ?").run(createdTenantId);
  }
  if (createdUserId) {
    db.prepare("DELETE FROM auth_sessions WHERE user_id = ?").run(createdUserId);
    db.prepare("DELETE FROM users WHERE id = ?").run(createdUserId);
  }
}

async function request(path: string, init: RequestInit = {}) {
  const response = await requestRaw(path, init);
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(`${init.method || "GET"} ${path} failed ${response.status}: ${JSON.stringify(body)}`);
  return body;
}

async function requestRaw(path: string, init: RequestInit = {}) {
  let response: Response;
  try {
    response = await fetch(`${apiBase}${path}`, {
      ...init,
      signal: AbortSignal.timeout(requestTimeoutMs),
      headers: {
        "Content-Type": "application/json",
        ...(authCookie ? { Cookie: authCookie } : {}),
        ...(init.headers ?? {})
      }
    });
  } catch (error) {
    throw new Error(`${init.method || "GET"} ${path} request failed: ${error instanceof Error ? error.message : String(error)}\n${serverOutput}`);
  }
  const setCookie = response.headers.get("set-cookie");
  if (setCookie?.includes("maple_session=")) authCookie = setCookie.split(";")[0];
  return response;
}

async function stopServer() {
  if (server.exitCode !== null || server.signalCode !== null) return;
  server.kill();
  await Promise.race([
    new Promise((resolve) => server.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 5_000))
  ]);
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

function loadEnvFile(envPath: string) {
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const parsed = parseEnvLine(line);
    if (parsed && process.env[parsed.key] === undefined) process.env[parsed.key] = parsed.value;
  }
}

function parseEnvLine(line: string) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;
  const normalized = trimmed.startsWith("export ") ? trimmed.slice("export ".length).trim() : trimmed;
  const separator = normalized.indexOf("=");
  if (separator <= 0) return null;
  const key = normalized.slice(0, separator).trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) return null;
  return { key, value: unquoteEnvValue(normalized.slice(separator + 1).trim()) };
}

function unquoteEnvValue(value: string) {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) return value.slice(1, -1);
  return value;
}

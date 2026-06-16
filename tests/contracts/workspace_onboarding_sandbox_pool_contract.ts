import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { createServer, type IncomingMessage } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { db } from "../../apps/control-plane-api/src/store";

type RequestRecord = {
  url: string;
  headers: IncomingMessage["headers"];
  body: Record<string, unknown>;
};

const dataDir = mkdtempSync(join(tmpdir(), "maple-onboarding-sandbox-pool-"));
const port = 21_000 + Math.floor(Math.random() * 2000);
const apiBase = `http://127.0.0.1:${port}`;
const openApiRequests: RequestRecord[] = [];
const gatewayRequests: RequestRecord[] = [];
const createdSandboxIds = new Set<string>();
const stamp = Date.now().toString(36);
let authCookie = "";
let createdTenantId = "";
let createdUserId = "";

const openApi = createServer(async (request, response) => {
  const body = parseBody(await readBody(request));
  openApiRequests.push({ url: request.url || "", headers: request.headers, body });
  response.setHeader("Content-Type", "application/json");
  const action = new URL(request.url || "/", "http://127.0.0.1").searchParams.get("Action");
  if (action === "CreateSandbox") {
    const sandboxId = `onboarding-sandbox-${createdSandboxIds.size + 1}`;
    createdSandboxIds.add(sandboxId);
    response.end(JSON.stringify({ ResponseMetadata: { RequestId: "req-create" }, Result: { SandboxId: sandboxId } }));
    return;
  }
  if (action === "SetSandboxTimeout" || action === "DescribeSandbox") {
    response.end(JSON.stringify({ ResponseMetadata: { RequestId: `req-${action}` }, Result: { SandboxId: body.SandboxId, Status: "Running" } }));
    return;
  }
  response.statusCode = 400;
  response.end(JSON.stringify({ ResponseMetadata: { Error: { Code: "UnknownAction", Message: String(action) } } }));
});
const { port: openApiPort } = await listen(openApi);

const gateway = createServer(async (request, response) => {
  const body = parseBody(await readBody(request));
  gatewayRequests.push({ url: request.url || "", headers: request.headers, body });
  response.setHeader("Content-Type", "application/json");
  if (!createdSandboxIds.has(String(request.headers["x-faas-instance-name"] || ""))) {
    response.statusCode = 400;
    response.end(JSON.stringify({ ok: false, error: "missing sandbox instance header" }));
    return;
  }
  response.end(JSON.stringify({ ok: true, result: { stdout: "", stderr: "", exit_code: 0 } }));
});
const { port: gatewayPort } = await listen(gateway);

const server = spawn("bun", ["apps/control-plane-api/src/index.ts"], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    PORT: String(port),
    HOST: "127.0.0.1",
    MAPLE_DATA_DIR: dataDir,
    MAPLE_AGENT_RUNTIME_PROVIDER: "local",
    MAPLE_DEV_LOGIN: "true"
  },
  stdio: ["ignore", "pipe", "pipe"]
});

let serverOutput = "";
server.stdout.on("data", (chunk) => (serverOutput += String(chunk)));
server.stderr.on("data", (chunk) => (serverOutput += String(chunk)));

try {
  await waitForHealth();
  const login = (await request("/v1/auth/login", {
    method: "POST",
    body: JSON.stringify({ provider: "local", email: `onboarding-sandbox-${stamp}@example.com`, name: "Onboarding Sandbox Pool" })
  })) as { user: { id: string } };
  createdUserId = String(login.user.id);
  const models = (await request("/v1/model_configs")) as { data: Array<Record<string, unknown>> };
  const defaultModel = models.data.find((item: Record<string, unknown>) => item.is_default) ?? models.data[0];
  assert.ok(defaultModel?.id);

  const onboarding = (await request("/v1/workspace_onboarding", {
    method: "POST",
    body: JSON.stringify({
      tenant: { name: `Sandbox Pool Tenant ${stamp}` },
      workspace: { name: "Sandbox Pool Workspace", slug: `sandbox-pool-${stamp}` },
      runtime_provider: "vefaas",
      runtime_pool: {
        desired_size: 0,
        min_instances_per_function: 0,
        max_instances_per_function: 1,
        max_concurrency_per_instance: 1,
        cpu_milli: 1000,
        memory_mb: 1024
      },
      sandbox_provider: "vefaas",
      sandbox_config: {
        vefaas: {
          function_id: "contract-sandbox-function",
          endpoint: `http://127.0.0.1:${openApiPort}`,
          gateway_url: `http://127.0.0.1:${gatewayPort}`,
          timeout_ms: 120000,
          workspace_path: "/home/tiger/workspace"
        }
      },
      sandbox_pool: { desired_size: 1, standby_ttl_ms: 30 * 60 * 1000 },
      model_config_ids: [defaultModel.id],
      provider_credentials: {
        vefaas: {
          VOLCENGINE_ACCESS_KEY: "contract-access-key",
          VOLCENGINE_SECRET_KEY: "contract-secret-key",
          VEFAAS_REGION: "cn-beijing"
        }
      }
    })
  })) as { tenant: { id: string }; sandbox_pool: { provider: string; desired_size: number; members: Array<Record<string, unknown>> } };
  createdTenantId = String(onboarding.tenant.id);
  assert.equal(onboarding.sandbox_pool.provider, "vefaas");
  assert.equal(onboarding.sandbox_pool.desired_size, 1);
  assert.equal(onboarding.sandbox_pool.members.length, 1);
  assert.equal(onboarding.sandbox_pool.members[0].status, "standby");
  assert.ok(onboarding.sandbox_pool.members[0].sandbox_id);
  assert.equal(openApiRequests.some((item) => item.url.includes("Action=CreateSandbox")), true);
  assert.equal(gatewayRequests.some((item) => item.url === "/v1/shell/exec"), true);
  console.log("workspace onboarding sandbox pool contract passed");
} finally {
  server.kill();
  cleanupContractRecords();
  await closeServer(gateway);
  await closeServer(openApi);
}

function cleanupContractRecords() {
  const workspaces = createdTenantId
    ? (db.prepare("SELECT id FROM workspaces WHERE tenant_id = ?").all(createdTenantId) as Array<{ id: string }>)
    : [];
  for (const { id: workspaceId } of workspaces) {
    db.prepare("DELETE FROM workspace_sandbox_pool_members WHERE workspace_id = ?").run(workspaceId);
    db.prepare("DELETE FROM workspace_runtime_pool_members WHERE workspace_id = ?").run(workspaceId);
    db.prepare("DELETE FROM workspace_runtime_pools WHERE workspace_id = ?").run(workspaceId);
    db.prepare("DELETE FROM workspace_api_keys WHERE workspace_id = ?").run(workspaceId);
    db.prepare("DELETE FROM environments WHERE workspace_id = ?").run(workspaceId);
    db.prepare("DELETE FROM model_configs WHERE workspace_id = ?").run(workspaceId);
    db.prepare("DELETE FROM workspace_members WHERE workspace_id = ?").run(workspaceId);
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
  const body = text ? parseBody(text) : null;
  if (!response.ok) throw new Error(`${init.method || "GET"} ${path} failed ${response.status}: ${JSON.stringify(body)}`);
  return body;
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

function parseBody(text: string): Record<string, unknown> {
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { text };
  }
}

function readBody(request: IncomingMessage) {
  return new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

function listen(server: ReturnType<typeof createServer>) {
  return new Promise<{ port: number }>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("server did not bind");
      resolve({ port: address.port });
    });
  });
}

function closeServer(server: ReturnType<typeof createServer>) {
  return new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}

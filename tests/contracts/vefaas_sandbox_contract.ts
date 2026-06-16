import assert from "node:assert/strict";
import { createServer, type IncomingMessage } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

type RequestRecord = {
  url: string;
  headers: IncomingMessage["headers"];
  body: Record<string, unknown>;
};

const openApiRequests: RequestRecord[] = [];
const gatewayRequests: RequestRecord[] = [];
const createdSandboxIds = new Set<string>();
let createSandboxCount = 0;
const files = new Map<string, string>();
files.set("/home/tiger/workspace/hello.txt", "hello from vefaas\n");
files.set("/home/tiger/workspace/.session/uploads/app.log", "checkout from uploaded file\n");

const openApi = createServer(async (request, response) => {
  const body = JSON.parse((await readBody(request)) || "{}") as Record<string, unknown>;
  openApiRequests.push({ url: request.url || "", headers: request.headers, body });
  response.setHeader("Content-Type", "application/json");
  const action = new URL(request.url || "/", "http://127.0.0.1").searchParams.get("Action");
  if (action === "CreateSandbox") {
    assert.equal(body.FunctionId, "contract-sandbox-function");
    assert.ok(Array.isArray(body.Envs));
    assert.ok(Number(body.Timeout) >= 3 && Number(body.Timeout) <= 1440, `CreateSandbox Timeout must be minutes in [3,1440], got ${body.Timeout}`);
    createSandboxCount += 1;
    const sandboxId = `vefaas-contract-sandbox-${createSandboxCount}`;
    createdSandboxIds.add(sandboxId);
    response.end(JSON.stringify({ ResponseMetadata: { RequestId: "req-create" }, Result: { SandboxId: sandboxId } }));
    return;
  }
  if (action === "DescribeSandbox" || action === "ResumeSandbox" || action === "SetSandboxTimeout" || action === "KillSandbox") {
    if (action === "ResumeSandbox" || action === "SetSandboxTimeout") {
      assert.ok(Number(body.Timeout) >= 3 && Number(body.Timeout) <= 1440, `${action} Timeout must be minutes in [3,1440], got ${body.Timeout}`);
    }
    response.end(JSON.stringify({ ResponseMetadata: { RequestId: `req-${action}` }, Result: { SandboxId: body.SandboxId, Status: "Running" } }));
    return;
  }
  response.statusCode = 400;
  response.end(JSON.stringify({ ResponseMetadata: { Error: { Code: "UnknownAction", Message: String(action) } } }));
});
const { port: openApiPort } = await listen(openApi);

const gateway = createServer(async (request, response) => {
  const body = JSON.parse((await readBody(request)) || "{}") as Record<string, unknown>;
  gatewayRequests.push({ url: request.url || "", headers: request.headers, body });
  response.setHeader("Content-Type", "application/json");
  if (!createdSandboxIds.has(String(request.headers["x-faas-instance-name"] || ""))) {
    response.statusCode = 400;
    response.end(JSON.stringify({ ok: false, error: "missing sandbox instance header" }));
    return;
  }
  if (request.url === "/v1/file/write") {
    files.set(String(body.file || body.path || ""), String(body.content || ""));
    response.end(JSON.stringify({ success: true, data: { path: body.file || body.path } }));
    return;
  }
  if (request.url === "/v1/file/read") {
    const path = String(body.file || body.path || "");
    response.end(JSON.stringify({ success: files.has(path), data: { content: files.get(path) || "" } }));
    return;
  }
  if (request.url === "/v1/file/list") {
    const root = String(body.path || "/home/tiger/workspace").replace(/\/$/, "");
    response.end(JSON.stringify({ success: true, data: { files: Array.from(files.keys()).filter((path) => path === root || path.startsWith(`${root}/`)).sort() } }));
    return;
  }
  const command = String(body.command || body.cmd || "");
  const result = runFakeShell(command);
  response.end(JSON.stringify({ ok: true, result }));
});
const { port: gatewayPort } = await listen(gateway);

process.env.MAPLE_DATA_DIR = mkdtempSync(join(tmpdir(), "maple-vefaas-sandbox-"));
process.env.MAPLE_AGENT_RUNTIME_PROVIDER = "local";

try {
  await import("../../apps/control-plane-api/src/env");
  const store = await import("../../apps/control-plane-api/src/store");
  const runtime = await import("../../apps/control-plane-api/src/runtime");

  store.initDatabase();
  const user = store.ensureUserByEmail({ email: "vefaas-sandbox-contract@example.com", name: "VeFaaS Sandbox Contract" });
  assert.ok(user?.id);
  const onboarding = store.createWorkspaceOnboarding({
    user_id: String(user.id),
    tenant: { name: "VeFaaS Sandbox Tenant" },
    workspace: { name: "VeFaaS Sandbox Workspace", slug: `vefaas-sandbox-${Date.now().toString(36)}` },
    runtime_provider: "vefaas",
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
    runtime_pool: {
      desired_size: 0,
      min_instances_per_function: 0,
      max_instances_per_function: 1,
      max_concurrency_per_instance: 1,
      cpu_milli: 1000,
      memory_mb: 1024
    },
    sandbox_pool: { desired_size: 1, standby_ttl_ms: 30 * 60 * 1000 },
    model_config_ids: [],
    api_key: { display_name: "contract key", scopes: ["control_plane", "data_plane"] },
    provider_credentials: {
      vefaas: {
        VOLCENGINE_ACCESS_KEY: "contract-access-key",
        VOLCENGINE_SECRET_KEY: "contract-secret-key",
        VEFAAS_REGION: "cn-beijing"
      }
    }
  });
  const workspaceId = String((onboarding.workspace as Record<string, unknown>).id);
  await runtime.replenishWorkspaceSandboxPool(workspaceId);
  const sandboxPool = store.getWorkspaceSandboxPool(workspaceId) as Record<string, unknown>;
  const sandboxMembers = sandboxPool.members as Array<Record<string, unknown>>;
  assert.equal(sandboxPool.provider, "vefaas");
  assert.equal(sandboxPool.desired_size, 1);
  assert.equal(sandboxMembers.filter((member) => member.status === "standby").length, 1);
  const environment = (store.listEnvironments(workspaceId) as Array<Record<string, unknown>>).find((item) => ((item.config as Record<string, unknown>).sandbox as Record<string, unknown>)?.provider === "vefaas");
  assert.ok(environment?.id);

  const agent = store.createAgent({
    workspace_id: workspaceId,
    config: {
      name: "VeFaaS Sandbox Contract Agent",
      description: "Contract agent",
      model: { provider: "custom", id: "contract-model" },
      system: "Use tools.",
      tools: [],
      mcp_servers: [],
      skills: []
    }
  });
  const session = store.createSession({
    workspace_id: workspaceId,
    agent_id: String(agent?.id),
    environment_id: String(environment.id),
    title: "vefaas sandbox contract"
  });
  assert.ok(session?.id);

  const runtimeInfo = await runtime.markRuntimeReady(String(session.id));
  assert.equal(runtimeInfo.type, "vefaas_sandbox");
  assert.equal((runtimeInfo as Record<string, unknown>).sandbox_id, "vefaas-contract-sandbox-1");
  assert.equal((runtimeInfo as Record<string, unknown>).pooled, true);
  assert.ok((runtimeInfo as Record<string, unknown>).pool_member_id);
  assert.equal(runtime.sessionUsesVefaasAgentRuntime(String(session.id)), false);
  assert.equal(hasMkdirMntSessionCommand(), false);

  const bash = await runtime.executeTool(String(session.id), "bash", { command: "echo from-vefaas" });
  assert.equal((bash as Record<string, unknown>).stdout, "from-vefaas\n");
  await runtime.executeTool(String(session.id), "write_file", { path: "created.txt", content: "created in vefaas\n" });
  const read = await runtime.executeTool(String(session.id), "read_file", { path: "created.txt" });
  assert.equal((read as Record<string, unknown>).content, "created in vefaas\n");
  const listed = await runtime.executeTool(String(session.id), "list_files", { path: "." });
  assert.deepEqual((listed as Record<string, unknown>).files, [".session/uploads/app.log", "created.txt", "hello.txt"]);
  const grep = await runtime.executeTool(String(session.id), "grep", { pattern: "hello", path: "." });
  assert.deepEqual((grep as Record<string, unknown>).matches, ["/home/tiger/workspace/hello.txt:1:hello from vefaas"]);
  const uploadedRead = await runtime.executeTool(String(session.id), "read_file", { path: "/mnt/session/uploads/app.log" });
  assert.equal((uploadedRead as Record<string, unknown>).content, "checkout from uploaded file\n");
  const uploadedGrep = await runtime.executeTool(String(session.id), "grep", { pattern: "checkout", path: "/mnt/session/uploads" });
  assert.deepEqual((uploadedGrep as Record<string, unknown>).matches, ["/home/tiger/workspace/.session/uploads/app.log:1:checkout from uploaded file"]);

  assert.equal(openApiRequests[0].headers["x-content-sha256"] ? "present" : "missing", "present");
  assert.match(String(openApiRequests[0].headers.authorization), /HMAC-SHA256 Credential=contract-access-key/);
  assert.ok(gatewayRequests.length >= 5);
  console.log("veFaaS sandbox contract passed");
} finally {
  await closeServer(gateway);
  await closeServer(openApi);
}

function runFakeShell(command: string) {
  const normalizedCommand = command.replace(/^cd '[^']+' && /, "");
  if (normalizedCommand.includes("mkdir -p") && normalizedCommand.includes("/mnt/session")) {
    return { stdout: "", stderr: "mkdir: cannot create directory '/mnt/session': Permission denied", exit_code: 1 };
  }
  const writeMatch = normalizedCommand.match(/printf %s '([^']*)' \| base64 -d > '([^']*)'/);
  if (writeMatch) {
    files.set(writeMatch[2], Buffer.from(writeMatch[1], "base64").toString("utf8"));
    return { stdout: "", stderr: "", exit_code: 0 };
  }
  const catMatch = normalizedCommand.match(/^cat '([^']*)'$/);
  if (catMatch) return { stdout: files.get(catMatch[1]) || "", stderr: "", exit_code: files.has(catMatch[1]) ? 0 : 1 };
  if (normalizedCommand.includes("echo from-vefaas")) return { stdout: "from-vefaas\n", stderr: "", exit_code: 0 };
  if (normalizedCommand.startsWith("find ")) return { stdout: Array.from(files.keys()).sort().join("\n") + "\n", stderr: "", exit_code: 0 };
  if (normalizedCommand.startsWith("grep ")) {
    const match = normalizedCommand.match(/grep -RIn -- '([^']*)' '([^']*)'/);
    const pattern = match?.[1] ?? "";
    const rawRoot = match?.[2] ?? "/home/tiger/workspace";
    const root = (rawRoot === "." ? "/home/tiger/workspace" : rawRoot.startsWith("/") ? rawRoot : `/home/tiger/workspace/${rawRoot}`).replace(/\/$/, "");
    return {
      stdout: Array.from(files.entries())
        .filter(([path, content]) => (path === root || path.startsWith(`${root}/`)) && content.includes(pattern))
        .map(([path, content]) => `${path}:1:${content.trimEnd()}`)
        .join("\n") + "\n",
      stderr: "",
      exit_code: 0
    };
  }
  return { stdout: "", stderr: "", exit_code: 0 };
}

function hasMkdirMntSessionCommand() {
  return gatewayRequests.some((request) => {
    const command = String(request.body.command || request.body.cmd || "");
    return command.includes("mkdir -p") && command.includes("/mnt/session");
  });
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

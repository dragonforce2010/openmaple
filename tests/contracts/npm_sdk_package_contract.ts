import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { spawn } from "node:child_process";
import { writeFakeVefaasRuntimeDeployScript } from "./helpers/fakeVefaasDeploy";

const execFileAsync = promisify(execFile);
const repoRoot = process.cwd();
const dataDir = mkdtempSync(join(tmpdir(), "maple-npm-sdk-e2e-"));
const packageProject = mkdtempSync(join(tmpdir(), "maple-npm-sdk-project-"));
const port = 23_000 + Math.floor(Math.random() * 2000);
const apiBase = `http://127.0.0.1:${port}`;
const packageName = "maple-agent-sdk";
const registry = "https://registry.npmjs.org/";
const runId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
const runtimeActions: string[] = [];
const providerCredentials = {
  vefaas: {
    VOLCENGINE_ACCESS_KEY: "contract-access-key",
    VOLCENGINE_SECRET_KEY: "contract-secret-key",
    VEFAAS_REGION: "cn-beijing"
  },
  e2b: { E2B_API_KEY: "contract-e2b-key" }
};

const packageSpec = await installSdkPackage();
const sdkPath = join(packageProject, "node_modules", packageName, "index.mjs");
const { MapleClient } = await import(pathToFileURL(sdkPath).href);
await verifyTypes();

const fakeRuntime = createServer(async (request, response) => {
  const body = await readRequestBody(request);
  const payload = body ? JSON.parse(body) : {};
  runtimeActions.push(String(payload.action || ""));
  const result =
    payload.action === "run"
      ? { content: "npm sdk package contract response", usage: { input_tokens: 1, output_tokens: 2 } }
      : { status: "ready" };
  response.writeHead(200, { "Content-Type": "application/json" });
  response.end(JSON.stringify({ ok: true, result }));
});

await new Promise<void>((resolve) => fakeRuntime.listen(0, "127.0.0.1", resolve));
const fakeRuntimeAddress = fakeRuntime.address();
if (!fakeRuntimeAddress || typeof fakeRuntimeAddress === "string") throw new Error("fake runtime did not bind to a TCP port");
const fakeRuntimeInvokeUrl = `http://127.0.0.1:${fakeRuntimeAddress.port}/invoke`;
const deployScript = writeFakeVefaasRuntimeDeployScript(dataDir, fakeRuntimeInvokeUrl);

const server = spawn("bun", ["apps/control-plane-api/src/index.ts"], {
  cwd: repoRoot,
  env: {
    ...process.env,
    PORT: String(port),
    HOST: "127.0.0.1",
    MAPLE_DATA_DIR: dataDir,
    MAPLE_DEV_LOGIN: "true",
    MAPLE_VEFAAS_RUNTIME_DEPLOY_SCRIPT: deployScript
  },
  stdio: ["ignore", "pipe", "pipe"]
});

let serverOutput = "";
server.stdout.on("data", (chunk) => (serverOutput += String(chunk)));
server.stderr.on("data", (chunk) => (serverOutput += String(chunk)));

try {
  await waitForHealth();

  const loginClient = new MapleClient({ baseURL: apiBase });
  const login = await loginClient.loginLocal({ email: `npm-sdk-${Date.now()}@example.com`, name: "NPM SDK Contract" });
  const authed = loginClient.withToken(login.token);
  const models = await authed.listModelConfigs();
  const defaultModel = models.data.find((model: Record<string, unknown>) => model.is_default) ?? models.data[0];
  assert.ok(defaultModel?.id);

  const onboarding = await authed.onboardWorkspace({
    tenant: { name: `NPM SDK Tenant ${runId}` },
    workspace: { name: `NPM SDK Workspace ${runId}` },
    runtime_provider: "vefaas",
    runtime_pool: {
      desired_size: 1,
      max_instances_per_function: 100,
      max_concurrency_per_instance: 100,
      cpu_milli: 2000,
      memory_mb: 4096
    },
    sandbox_provider: "e2b",
    model_config_ids: [defaultModel.id],
    api_key: { display_name: "NPM SDK integration key", scopes: ["control_plane", "data_plane"] },
    provider_credentials: providerCredentials
  });
  const tenantId = String((onboarding.tenant as Record<string, unknown>).id);
  const secondWorkspace = await createExtraWorkspace(login.token, tenantId, defaultModel.id);
  const workspaceId = String((secondWorkspace.workspace as Record<string, unknown>).id);
  const workspaceKey = String((secondWorkspace.api_key as Record<string, unknown>).key);
  assert.ok(workspaceKey.startsWith("maple_ws_"));

  const client = new MapleClient({ baseURL: apiBase, apiKey: workspaceKey });
  const me = await client.me();
  assert.equal((me.user as Record<string, unknown>).metadata && ((me.user as Record<string, unknown>).metadata as Record<string, unknown>).source, "workspace_api_key");

  const environment = await client.createEnvironment({
    workspace_id: workspaceId,
    name: "npm-sdk-local-tools",
    config: {
      type: "local_docker",
      sandbox: { provider: "local_docker" },
      image: "node:22-bookworm",
      networking: { mode: "limited" }
    }
  });
  const agent = await client.createAgent({
    workspace_id: workspaceId,
    name: "NPM SDK Agent",
    description: "Created through the published Maple Agent SDK package.",
    model: defaultModel.model_name,
    agent_loop: { type: "codex_open_source", config: { execution: "runtime" }, hooks: [] },
    system: "Respond with concise evidence.",
    tools: [],
    mcp_servers: [],
    skills: []
  });
  assert.equal(agent.config.model.config_id, defaultModel.id);

  const streamedEvents: Array<Record<string, unknown>> = [];
  const run = await client.createSessionAndStream({
    agent: agent.id,
    environment_id: environment.id,
    title: "npm-sdk-package-contract",
    metadata: { integration_model_id: defaultModel.model_name },
    message: "Use the npm package SDK path."
  }, {
    onEvent(event: Record<string, unknown>) {
      streamedEvents.push(event);
    }
  });
  const session = run.session;
  assert.equal(session.workspace_id, workspaceId);
  const finalEvent = await withTimeout(run.done, 30_000, () => `agent.message event; streamed events: ${streamedEvents.map((event) => String(event.type)).join(", ") || "(none)"}; runtime actions: ${runtimeActions.join(", ") || "(none)"}`);
  assert.equal((finalEvent as Record<string, unknown> | null)?.type, "agent.message");
  assert.ok(streamedEvents.some((event) => event.type === "agent.message_delta"));
  assert.ok(JSON.stringify(streamedEvents).includes("npm sdk package contract response"));
  assert.ok(runtimeActions.includes("bootstrap"));
  assert.ok(runtimeActions.includes("run"));

  console.log(`npm sdk package contract passed (${packageSpec})`);
} finally {
  server.kill();
  fakeRuntime.close();
}

async function installSdkPackage() {
  const explicitSpec = process.env.MAPLE_NPM_SDK_SPEC;
  const spec = explicitSpec || (await packLocalSdk());
  writeFileSync(join(packageProject, "package.json"), JSON.stringify({ type: "module", private: true }, null, 2) + "\n");
  await execFileAsync("npm", ["install", "--ignore-scripts", "--package-lock=false", "--registry", registry, spec], {
    cwd: packageProject
  });
  const installed = JSON.parse(readFileSync(join(packageProject, "node_modules", packageName, "package.json"), "utf8"));
  assert.equal(installed.name, packageName);
  assert.ok(installed.version);
  return explicitSpec || basename(spec);
}

async function packLocalSdk() {
  await execFileAsync("npm", ["pack", resolve(repoRoot, "packages/sdk"), "--pack-destination", dataDir, "--registry", registry], {
    cwd: repoRoot
  });
  const tarball = readdirSync(dataDir).find((file) => file.startsWith(`${packageName}-`) && file.endsWith(".tgz"));
  if (!tarball) throw new Error(`npm pack did not create ${packageName} tarball in ${dataDir}`);
  return join(dataDir, tarball);
}

async function verifyTypes() {
  const sample = `import { MapleClient } from "${packageName}";

const client = new MapleClient({
  baseURL: "http://127.0.0.1:27951",
  apiKey: "maple_ws_xxx",
  workspaceId: "ws_xxx"
});

const run = await client.createSessionAndStream({
  agent: "agent_xxx",
  environment_id: "env_xxx",
  title: "Integration smoke",
  metadata: { integration_model_id: "model_xxx" },
  message: "Summarize the uploaded files."
}, {
  onEvent(event) {
    if (event.type === "agent.message_delta") console.log(String(event.text ?? ""));
  }
});

await run.done;
`;
  const samplePath = join(packageProject, "sample.ts");
  writeFileSync(samplePath, sample);
  await execFileAsync(
    resolve(repoRoot, "node_modules", ".bin", "tsc"),
    ["--noEmit", "--strict", "--target", "ES2022", "--module", "NodeNext", "--moduleResolution", "NodeNext", "--skipLibCheck", samplePath],
    { cwd: packageProject }
  );
}

async function createExtraWorkspace(token: string, tenantId: string, modelConfigId: unknown) {
  const response = await fetch(`${apiBase}/v1/workspaces`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      tenant_id: tenantId,
      workspace: { name: `NPM SDK Second Workspace ${runId}` },
      runtime_provider: "vefaas",
      runtime_pool: {
        desired_size: 1,
        max_instances_per_function: 100,
        max_concurrency_per_instance: 100,
        cpu_milli: 2000,
        memory_mb: 4096
      },
      sandbox_provider: "e2b",
      model_config_ids: [modelConfigId],
      api_key: { display_name: "NPM SDK second integration key", scopes: ["control_plane", "data_plane"] },
      provider_credentials: providerCredentials
    })
  });
  const body = await response.json();
  assert.equal(response.status, 201, JSON.stringify(body));
  return body as Record<string, unknown>;
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

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string | (() => string)) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Timed out waiting for ${typeof label === "function" ? label() : label}`)), timeoutMs);
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function readRequestBody(request: NodeJS.ReadableStream) {
  let body = "";
  for await (const chunk of request) body += String(chunk);
  return body;
}

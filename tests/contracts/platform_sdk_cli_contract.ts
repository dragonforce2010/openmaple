import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { spawn } from "node:child_process";
import { MapleClient } from "../../packages/sdk/index.mjs";
import { writeFakeVefaasRuntimeDeployScript } from "./helpers/fakeVefaasDeploy";

const execFileAsync = promisify(execFile);
const dataDir = mkdtempSync(join(tmpdir(), "maple-platform-sdk-cli-"));
const cliConfig = join(dataDir, "maple-config.json");
const cliProject = mkdtempSync(join(tmpdir(), "maple-cli-project-"));
const skillRoot = join(dataDir, "skills-root");
const bunBin = process.execPath;
const port = 21_000 + Math.floor(Math.random() * 2000);
const apiBase = `http://127.0.0.1:${port}`;
const runId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
const runtimeActions: string[] = [];
const providerRequests: string[] = [];
const providerCredentials = {
  vefaas: {
    VOLCENGINE_ACCESS_KEY: "contract-access-key",
    VOLCENGINE_SECRET_KEY: "contract-secret-key",
    VEFAAS_REGION: "cn-beijing"
  },
  e2b: { E2B_API_KEY: "contract-e2b-key" }
};

const fakeRuntime = createServer(async (request, response) => {
  const body = await readRequestBody(request);
  const payload = body ? JSON.parse(body) : {};
  runtimeActions.push(String(payload.action || ""));
  const result =
    payload.action === "run"
      ? { content: "platform sdk cli contract response", usage: { input_tokens: 1, output_tokens: 2 } }
      : { status: "ready" };
  response.writeHead(200, { "Content-Type": "application/json" });
  response.end(JSON.stringify({ ok: true, result }));
});

await new Promise<void>((resolve) => fakeRuntime.listen(0, "127.0.0.1", resolve));
const fakeRuntimeAddress = fakeRuntime.address();
if (!fakeRuntimeAddress || typeof fakeRuntimeAddress === "string") throw new Error("fake runtime did not bind to a TCP port");
const fakeRuntimeInvokeUrl = `http://127.0.0.1:${fakeRuntimeAddress.port}/invoke`;
const deployScript = writeFakeVefaasRuntimeDeployScript(dataDir, fakeRuntimeInvokeUrl);

const fakeProvider = createServer(async (request, response) => {
  providerRequests.push(String(request.url || ""));
  await readRequestBody(request);
  response.writeHead(200, { "Content-Type": "application/json" });
  response.end(
    JSON.stringify({
      choices: [{ message: { content: "AskMaple fake answer for platform SDK contract." } }],
      usage: { input_tokens: 3, output_tokens: 4 }
    })
  );
});
await new Promise<void>((resolve) => fakeProvider.listen(0, "127.0.0.1", resolve));
const fakeProviderAddress = fakeProvider.address();
if (!fakeProviderAddress || typeof fakeProviderAddress === "string") throw new Error("fake provider did not bind to a TCP port");
const fakeProviderBaseUrl = `http://127.0.0.1:${fakeProviderAddress.port}`;

const server = spawn(bunBin, ["apps/control-plane-api/src/index.ts"], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    PORT: String(port),
    HOST: "127.0.0.1",
    MAPLE_DATA_DIR: dataDir,
    MAPLE_SKILLS_ROOT: skillRoot,
    MAPLE_MYSQL_FORCE_HELPER: "true",
    MAPLE_DEV_LOGIN: "true",
    MAPLE_VEFAAS_RUNTIME_DEPLOY_SCRIPT: deployScript,
    HOME: dataDir
  },
  stdio: ["ignore", "pipe", "pipe"]
});

let serverOutput = "";
server.stdout.on("data", (chunk) => (serverOutput += String(chunk)));
server.stderr.on("data", (chunk) => (serverOutput += String(chunk)));

try {
  await waitForHealth();

  const loginClient = new MapleClient({ baseUrl: apiBase });
  const login = await loginClient.loginLocal({ email: `platform-sdk-${Date.now()}@example.com`, name: "Platform SDK Contract" });
  const authed = loginClient.withToken(login.token);

  const onboarding = await authed.onboardWorkspace({
    tenant: { name: `Platform SDK Tenant ${runId}` },
    workspace: { name: `Platform SDK Workspace ${runId}` },
    runtime_provider: "vefaas",
    runtime_pool: {
      desired_size: 1,
      max_instances_per_function: 100,
      max_concurrency_per_instance: 100,
      cpu_milli: 2000,
      memory_mb: 4096
    },
    sandbox_provider: "e2b",
    model_config_ids: [],
    custom_model_configs: [
      {
        kind: "custom",
        name: "Contract Fake Provider",
        protocol: "openai",
        base_url: fakeProviderBaseUrl,
        model_name: "contract-fake-chat",
        api_key: "contract-provider-key",
        is_default: true
      }
    ],
    api_key: { display_name: "Platform integration key", scopes: ["control_plane", "data_plane"] },
    provider_credentials: providerCredentials
  });
  const workspaceId = String((onboarding.workspace as Record<string, unknown>).id);
  const workspaceKey = String((onboarding.api_key as Record<string, unknown>).key);
  assert.ok(workspaceKey.startsWith("maple_ws_"));

  const client = new MapleClient({ baseUrl: apiBase, apiKey: workspaceKey });
  const me = await client.me();
  assert.equal((me.user as Record<string, unknown>).metadata && ((me.user as Record<string, unknown>).metadata as Record<string, unknown>).source, "workspace_api_key");
  const workspaces = await client.listWorkspaces();
  assert.equal(workspaces.data.length, 1);
  assert.equal(workspaces.data[0].id, workspaceId);
  const models = await client.listModelConfigs();
  const defaultModel = models.data.find((model: Record<string, unknown>) => model.name === "Contract Fake Provider") ?? models.data[0];
  assert.ok(defaultModel?.id);

  const environment = await client.createEnvironment({
    workspace_id: workspaceId,
    name: "platform-sdk-local-tools",
    config: {
      type: "local_docker",
      sandbox: { provider: "local_docker" },
      image: "node:22-bookworm",
      networking: { mode: "limited" }
    }
  });
  const agent = await client.createAgent({
    workspace_id: workspaceId,
    name: "Platform SDK Agent",
    description: "Created through the Maple SDK without external provider credentials.",
    model: defaultModel.model_name,
    agent_loop: { type: "codex_open_source", config: { execution: "runtime" }, hooks: [] },
    system: "Respond with concise evidence.",
    tools: [],
    mcp_servers: [],
    skills: []
  });
  assert.equal(agent.workspace_id, workspaceId);
  assert.equal(agent.config.model.config_id, defaultModel.id);

  const session = await client.createSession({
    workspace_id: workspaceId,
    agent: agent.id,
    environment_id: environment.id,
    title: "platform-sdk-cli-contract"
  });
  await client.sendSessionMessage(String(session.id), "Use the platform SDK path.");
  let lastSessionDetail: unknown = null;
  const events = await poll(async () => {
    const listed = await client.listSessionEvents(String(session.id));
    lastSessionDetail = listed;
    return listed.data.some((event: Record<string, unknown>) => event.type === "agent.message") ? listed : null;
  }, 30_000, "agent.message event").catch((error) => {
    console.error(JSON.stringify(lastSessionDetail, null, 2));
    throw error;
  });
  assert.ok(JSON.stringify(events).includes("platform sdk cli contract response"));
  assert.ok(runtimeActions.includes("bootstrap"));
  assert.ok(runtimeActions.includes("run"));
  // AskMaple is async + real LLM now: the POST returns an ask session id, the answer streams over
  // that session's event log. Poll until the turn settles, then read the agent.message answer.
  const askMaple = await client.askMaple(String(session.id), "总结这个 session 的上下文");
  const askSessionId = String((askMaple as Record<string, unknown>).ask_session_id || "");
  assert.ok(askSessionId, "askMaple must return an ask_session_id");
  const askAnswer = await poll(async () => {
    const detail = await client.sessionDetail(askSessionId);
    const settled = ["idle", "failed"].includes(String((detail.session as Record<string, unknown>)?.status ?? ""));
    if (!settled) return null;
    const answerEvent = (detail.events as Array<Record<string, unknown>>)?.find((event) => event.type === "agent.message");
    const content = (answerEvent?.content as Array<Record<string, unknown>>) || (answerEvent?.payload as Record<string, unknown>)?.content as Array<Record<string, unknown>>;
    const text = String(content?.[0]?.text ?? "");
    return text.trim() ? text : settled ? "" : null;
  }, 180_000, "ask maple answer");
  assert.ok(String(askAnswer).trim(), "AskMaple must stream a non-empty LLM answer");
  assert.ok(providerRequests.includes("/chat/completions"), "AskMaple must call the configured provider");

  const sdkSkillName = `platform-sdk-skill-${runId}`;
  const sdkSkill = await client.createSkill({
    name: sdkSkillName,
    description: "Use when verifying Maple SDK skill APIs."
  });
  assert.equal(sdkSkill.name, sdkSkillName);
  const savedSkill = await client.saveSkillFile(
    String(sdkSkill.id),
    "SKILL.md",
    `---\nname: ${sdkSkillName}\ndescription: Use when verifying Maple SDK skill APIs.\n---\n\n# Workflow\n\nUse Maple SDK evidence.\n`
  );
  assert.equal(savedSkill.path, "SKILL.md");
  const rereadSkill = await client.getSkillFile(String(sdkSkill.id), "SKILL.md");
  assert.match(String(rereadSkill.content), new RegExp(sdkSkillName));

  const cliEnv = { ...process.env, MAPLE_CONFIG: cliConfig, MAPLE_API_BASE_URL: apiBase, MAPLE_API_KEY: "", MAPLE_SKILLS_ROOT: skillRoot, HOME: dataDir };
  const loginOutput = await execFileAsync(bunBin, ["packages/cli/maple.mjs", "config", "login", "--api-key", workspaceKey], {
    cwd: process.cwd(),
    env: cliEnv
  });
  assert.match(loginOutput.stdout, /api_key_logged_in/);
  const cliSkillName = `platform-cli-skill-${runId}`;
  const cliSkillOutput = await execFileAsync(
    bunBin,
    ["packages/cli/maple.mjs", "skill", "push", "--name", cliSkillName, "--description", "Use when verifying Maple CLI skill push.", "--json"],
    { cwd: process.cwd(), env: cliEnv }
  );
  const cliSkill = JSON.parse(cliSkillOutput.stdout);
  assert.equal(cliSkill.name, cliSkillName);
  assert.ok(cliSkill.id);
  const cliSkillListOutput = await execFileAsync(bunBin, ["packages/cli/maple.mjs", "skill", "list", "--json"], {
    cwd: process.cwd(),
    env: cliEnv
  });
  const cliSkills = JSON.parse(cliSkillListOutput.stdout);
  assert.equal(cliSkills.data.some((skill: Record<string, unknown>) => skill.name === cliSkillName), true);
  await execFileAsync(
    bunBin,
    ["packages/cli/maple.mjs", "init", "--name", "platform-cli-contract", "--loop", "codex_open_source", "--runtime", "local_docker", "--directory", cliProject, "--yes"],
    { cwd: process.cwd(), env: cliEnv }
  );
  assert.equal(existsSync(join(cliProject, "maple.manifest.json")), true);
  assert.equal(existsSync(join(cliProject, "mag.manifest.json")), false);

  await execFileAsync(bunBin, ["packages/cli/maple.mjs", "build", "--project", cliProject], {
    cwd: process.cwd(),
    env: cliEnv
  });
  const bundlePath = join(cliProject, ".maple", "build", "bundle.json");
  assert.equal(existsSync(bundlePath), true);
  const bundle = JSON.parse(readFileSync(bundlePath, "utf8"));
  assert.equal(bundle.manifest.agent.agent_loop.type, "codex_open_source");
  assert.equal(bundle.bundle.files.some((file: Record<string, unknown>) => file.path === "maple.manifest.json"), true);

  const deployOutput = await execFileAsync(bunBin, ["packages/cli/maple.mjs", "deploy", "--project", cliProject, "--json"], {
    cwd: process.cwd(),
    env: cliEnv
  });
  const deployed = JSON.parse(deployOutput.stdout);
  assert.ok(deployed.deployment_id);
  assert.ok(deployed.agent_id);
  assert.ok(deployed.environment_id);

  const statusOutput = await execFileAsync(bunBin, ["packages/cli/maple.mjs", "status", "--json"], {
    cwd: process.cwd(),
    env: cliEnv
  });
  const status = JSON.parse(statusOutput.stdout);
  assert.ok(Array.isArray(status.data));
  assert.equal(status.data.some((deployment: Record<string, unknown>) => deployment.id === deployed.deployment_id), true);

  console.log("platform sdk cli contract passed");
} finally {
  server.kill();
  fakeRuntime.close();
  fakeProvider.close();
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

async function poll<T>(fn: () => Promise<T | null>, timeoutMs: number, label: string) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const value = await fn();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function readRequestBody(request: NodeJS.ReadableStream) {
  let body = "";
  for await (const chunk of request) body += String(chunk);
  return body;
}

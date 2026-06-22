import { execFile, execFileSync, spawn } from "node:child_process";
import { appendFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, rmdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { chromium } from "playwright";

loadAgentsEnv();
normalizeLocalDockerE2EEnv();

const execFileAsync = promisify(execFile);
const isolated = ["1", "true", "yes"].includes(String(process.env.E2E_ISOLATED || "").toLowerCase());
if (isolated && !process.env.MAPLE_DATA_DIR && !process.env.E2E_API_BASE) {
  process.env.MAPLE_DATA_DIR = mkdtempSync(join(tmpdir(), "maple-e2e-data-"));
}
const { db } = await import("../../apps/control-plane-api/src/store.ts");
const e2eDataDir = process.env.MAPLE_DATA_DIR || join(process.cwd(), ".managed-agents");
const isolatedBasePort = Number(process.env.E2E_PORT_BASE || 24_000 + Math.floor(Math.random() * 1000) * 2);
const apiBase = process.env.E2E_API_BASE || (isolated ? `http://127.0.0.1:${isolatedBasePort}` : "http://127.0.0.1:27951");
const webBase = process.env.E2E_WEB_BASE || (isolated ? `http://127.0.0.1:${isolatedBasePort + 1}` : "http://127.0.0.1:5173");
const cloudTarget = !isLocalhost(new URL(apiBase));
const e2eSandboxProvider = String(process.env.E2E_SANDBOX_PROVIDER || process.env.MAPLE_SANDBOX_PROVIDER || "e2b").toLowerCase();
const useE2BSandbox = e2eSandboxProvider === "e2b";
const expectedRuntimeType = useE2BSandbox ? "e2b" : "docker";
const onboardingRuntimeProvider = useE2BSandbox ? "vefaas" : "local_docker";
const onboardingSandboxProvider = useE2BSandbox ? "e2b" : "local_docker";
const onboardingRuntimeLabel = providerDisplayName(onboardingRuntimeProvider);
const onboardingSandboxLabel = providerDisplayName(onboardingSandboxProvider);
const onboardingRuntimeCardTitle = onboardingRuntimeProvider === "local_docker" ? "Local Docker Runtime" : "VeFaaS Runtime";
const onboardingSandboxCardTitle =
  onboardingSandboxProvider === "local_docker" ? "Local Docker Sandbox" : onboardingSandboxProvider === "vefaas" ? "VeFaaS Sandbox" : onboardingSandboxLabel;
const askMapleTimeoutMs = Number(process.env.E2E_ASK_TIMEOUT_MS || 90_000);
const sessionAgentRuntimeMetadata = cloudTarget || !useE2BSandbox ? {} : { agent_runtime: { provider: "local", type: "local" } };
const stamp = Date.now();
const testStart = Date.now();
const prompt = `E2E ${stamp}: Create an agent that uses local tools to write files, remembers findings, and can use a Notion MCP server when credentials are provided.`;
const fileContent = `e2e-real-runtime-${stamp}`;
const filePath = `qa/e2e-${stamp}.txt`;
const e2bFileContent = `e2e-real-e2b-runtime-${stamp}`;
const e2bFilePath = `qa/e2b-${stamp}.txt`;
const mapleProject = join("/tmp", `maple-e2e-${stamp}`);
const mapleConfig = join("/tmp", `maple-e2e-${stamp}.json`);
const e2eDeployScript = process.env.MAPLE_VEFAAS_RUNTIME_DEPLOY_SCRIPT || writeFakeVefaasRuntimeDeployScript(mkdtempSync(join(tmpdir(), "maple-e2e-deploy-")));
const results = [];
const spawnedProcesses = [];
const e2bSandboxIds = new Set();
let authCookie = "";
const createdUserEmails = new Set();
const createdUserIds = new Set();

const clientSkillDirs = [
  ".claude/skills",
  ".codex/skills",
  ".cursor/skills",
  ".antigravity/skills",
  ".gemini/antigravity/skills",
  ".gemini/antigravity-ide/skills",
  ".gemini/skills"
];

const expectedButtonAudit = [
  "template:Customer knowledge assistant",
  "quickstart:send-feedback",
  "quickstart:create-agent-feedback",
  "agents:update-model",
  "nav:Agents",
  "nav:Environments",
  "nav:Vaults",
  "nav:Tenant",
  "nav:API Keys",
  "nav:Documentation",
  "nav:Models",
  "workspace-settings:open",
  "workspace-settings:runtime",
  "workspace-settings:providers",
  "workspace-settings:models",
  "workspace-settings:create-key",
  "docs:three-pane",
  "environments:error-inline",
  "environments:create-e2b",
  "models:create",
  "models:test",
  "models:issue-key-modal",
  "sessions:enter-send"
];

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function loadAgentsEnv() {
  loadEnvFile(process.env.AGENTS_ENV_PATH || join(homedir(), ".agents", ".env"));
  loadEnvFile(join(process.cwd(), ".env"));
  loadEnvFile(process.env.MAPLE_LOCAL_ENV_FILE || join(process.cwd(), ".env.local"));
}

function providerDisplayName(provider) {
  if (provider === "local_docker") return "Local Docker";
  if (provider === "vefaas") return "VeFaaS";
  if (provider === "e2b") return "E2B";
  if (provider === "daytona") return "Daytona";
  return String(provider || "").toUpperCase();
}

function normalizeLocalDockerE2EEnv() {
  if (!process.env.MAPLE_BUILDER_PROVIDER_TIMEOUT_MS) process.env.MAPLE_BUILDER_PROVIDER_TIMEOUT_MS = "10000";
  if (!process.env.MAPLE_AGENT_DRAFT_TIMEOUT_MS) process.env.MAPLE_AGENT_DRAFT_TIMEOUT_MS = "15000";
  const mysqlTimeoutMs = Number(process.env.MAPLE_MYSQL_HELPER_TIMEOUT_MS || "0");
  const e2eMysqlTimeoutMs = Number(process.env.E2E_MYSQL_HELPER_TIMEOUT_MS || "180000");
  if (!Number.isFinite(mysqlTimeoutMs) || mysqlTimeoutMs < e2eMysqlTimeoutMs) process.env.MAPLE_MYSQL_HELPER_TIMEOUT_MS = String(e2eMysqlTimeoutMs);
  const localMode = ["1", "true", "yes"].includes(String(process.env.MAPLE_LOCAL_DOCKER_MODE || "").toLowerCase()) ||
    process.env.MAPLE_AGENT_RUNTIME_PROVIDER === "local_docker" ||
    process.env.MAPLE_SANDBOX_PROVIDER === "local_docker" ||
    process.env.E2E_SANDBOX_PROVIDER === "local_docker";
  if (localMode && !process.env.MAPLE_MYSQL_PORT && !process.env.MYSQL_PORT) {
    process.env.MAPLE_MYSQL_PORT = process.env.MAPLE_MYSQL_HOST_PORT || "3307";
  }
  if (localMode && !process.env.MAPLE_MYSQL_DATABASE && !process.env.MYSQL_DATABASE) process.env.MAPLE_MYSQL_DATABASE = "maple";
  if (localMode && !process.env.MAPLE_MYSQL_USER && !process.env.MYSQL_USER) process.env.MAPLE_MYSQL_USER = "root";
  if (localMode && !process.env.MAPLE_MYSQL_PASSWORD && !process.env.MYSQL_PASSWORD) process.env.MAPLE_MYSQL_PASSWORD = "maple";
}

function writeFakeVefaasRuntimeDeployScript(dir) {
  const script = join(dir, "fake_vefaas_runtime_deploy.py");
  writeFileSync(
    script,
    [
      "import json",
      "import os",
      "if not os.environ.get('VOLCENGINE_ACCESS_KEY') or not os.environ.get('VOLCENGINE_SECRET_KEY'):",
      "    raise SystemExit('missing Volcengine credentials')",
      "app_name = os.environ.get('MAPLE_VEFAAS_APP_NAME', 'maple-e2e-runtime')",
      "print(json.dumps({",
      "    'invoke_url': 'https://example.invalid/maple-runtime',",
      "    'function_id': app_name + '-fn',",
      "    'app_id': app_name + '-app',",
      "    'region': os.environ.get('MAPLE_VEFAAS_REGION', 'cn-beijing'),",
      "    'app_name': app_name,",
      "    'function_name': app_name + '-function'",
      "}))"
    ].join("\n")
  );
  return script;
}

function loadEnvFile(envPath) {
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const parsed = parseEnvLine(line);
    if (parsed && process.env[parsed.key] === undefined) process.env[parsed.key] = parsed.value;
  }
}

function parseEnvLine(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;
  const normalized = trimmed.startsWith("export ") ? trimmed.slice("export ".length).trim() : trimmed;
  const separator = normalized.indexOf("=");
  if (separator <= 0) return null;
  const key = normalized.slice(0, separator).trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) return null;
  return { key, value: unquoteEnvValue(normalized.slice(separator + 1).trim()) };
}

function unquoteEnvValue(value) {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) return value.slice(1, -1);
  return value;
}

function pass(name, details = {}) {
  results.push({ status: "PASS", name, details });
}

function fail(name, error) {
  results.push({ status: "FAIL", name, error: error instanceof Error ? error.message : String(error) });
  throw error;
}

async function step(name, fn) {
  process.stderr.write(`\n[E2E STEP] ${name}\n`);
  try {
    const value = await fn();
    pass(name, value && typeof value === "object" ? value : {});
    return value;
  } catch (error) {
    process.stderr.write(`[E2E FAIL] ${name}: ${error instanceof Error ? error.message : String(error)}\n`);
    fail(name, error);
  }
}

async function request(path, options = {}) {
  const response = await requestRaw(path, options);
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch (parseError) {
    throw new Error(`${options.method || "GET"} ${path} returned non-JSON ${response.status}: ${text.slice(0, 600)}`);
  }
  if (!response.ok) throw new Error(`${options.method || "GET"} ${path} failed ${response.status}: ${text}`);
  return data;
}

async function requestRaw(path, options = {}) {
  const method = String(options.method || "GET").toUpperCase();
  const overrideMethod = method === "PATCH" || method === "DELETE";
  return fetch(`${apiBase}${path}`, {
    ...options,
    method: overrideMethod ? "POST" : options.method,
    headers: {
      "Content-Type": "application/json",
      ...(overrideMethod ? { "X-HTTP-Method-Override": method } : {}),
      ...(authCookie ? { Cookie: authCookie } : {}),
      ...(options.headers || {})
    }
  });
}

async function poll(fn, timeoutMs, label) {
  const start = Date.now();
  let last;
  while (Date.now() - start < timeoutMs) {
    last = await fn();
    if (last) return last;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function endpointOk(url, validate) {
  try {
    const response = await fetch(url);
    if (!response.ok) return false;
    return validate ? validate(await response.clone().text(), response) : true;
  } catch {
    return false;
  }
}

function canAutoStart() {
  const api = new URL(apiBase);
  const web = new URL(webBase);
  return isLocalhost(api) && isLocalhost(web) && Boolean(api.port && web.port);
}

function isLocalhost(url) {
  return url.hostname === "127.0.0.1" || url.hostname === "localhost";
}

function gatewayKeyHeaders(key) {
  return isLocalhost(new URL(apiBase)) ? { Authorization: `Bearer ${key}` } : { "X-Maple-Gateway-Key": key };
}

function startProcess(name, command, args, env = {}) {
  const child = spawn(command, args, {
    cwd: process.cwd(),
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"]
  });
  return trackProcess(name, child);
}

function startBunScript(name, script, env = {}) {
  const child = spawn("bun", ["run", script], {
    cwd: process.cwd(),
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"]
  });
  return trackProcess(name, child);
}

function trackProcess(name, child) {
  const output = [];
  const capture = (chunk) => {
    output.push(chunk.toString());
    if (output.length > 80) output.shift();
    if (process.env.E2E_SERVER_LOG && name === "api") { try { appendFileSync(process.env.E2E_SERVER_LOG, chunk.toString()); } catch {} }
  };
  child.stdout.on("data", capture);
  child.stderr.on("data", capture);
  child.on("exit", (code) => {
    if (code !== null && code !== 0) {
      console.error(`[${name}] exited with ${code}\n${output.join("")}`);
    }
  });
  spawnedProcesses.push(child);
  return { name, pid: child.pid };
}

async function ensureServers() {
  const apiReady = await endpointOk(`${apiBase}/health`, isMapleHealth);
  const webReady = await endpointOk(webBase, isMapleWebHtml);
  const started = [];
  if ((!apiReady || !webReady) && !canAutoStart()) {
    throw new Error(`E2E servers are not reachable and auto-start only supports ${apiBase} + ${webBase}`);
  }
  const api = new URL(apiBase);
  const web = new URL(webBase);
  if (!apiReady) {
    started.push(
      startBunScript("api", "start", {
        HOST: api.hostname,
        PORT: api.port,
        MAPLE_AGENT_RUNTIME_PROVIDER: process.env.MAPLE_AGENT_RUNTIME_PROVIDER || "local",
        MAPLE_SANDBOX_PROVIDER: e2eSandboxProvider,
        MAPLE_AGENT_LOOP_EXECUTION: process.env.E2E_AGENT_LOOP_EXECUTION || "provider",
        MAPLE_VEFAAS_RUNTIME_DEPLOY_SCRIPT: e2eDeployScript,
        MAPLE_DEV_LOGIN: "true"
      })
    );
  }
  if (!webReady) {
    started.push(
      startProcess("web", "bunx", ["vite", "--config", "apps/admin-web/vite.config.ts", "--host", web.hostname, "--port", web.port], {
        MAPLE_WEB_PORT: web.port,
        MAPLE_API_PROXY_TARGET: apiBase
      })
    );
  }
  await poll(async () => endpointOk(`${apiBase}/health`, isMapleHealth), 30_000, "API server");
  await poll(async () => endpointOk(webBase, isMapleWebHtml), 30_000, "web server");
  return { apiBase, webBase, autoStarted: started };
}

async function cleanupSpawnedProcesses() {
  for (const child of spawnedProcesses) {
    if (!child.killed) child.kill("SIGTERM");
  }
  if (spawnedProcesses.length) await wait(500);
}

function isMapleHealth(text) {
  return text.includes('"ok":true') && text.includes('"service":"maple"');
}

function isMapleWebHtml(text) {
  const normalized = text.toLowerCase();
  return normalized.includes("<!doctype html") || text.includes("<div id=\"root\">") || text.includes("Maple · Managed Agent Platform");
}

async function cleanupTrackedE2BSandboxes() {
  if (e2bSandboxIds.size === 0) return;
  if (!process.env.E2B_API_KEY) throw new Error(`E2B cleanup requires E2B_API_KEY; leaked sandbox ids: ${[...e2bSandboxIds].join(", ")}`);
  const { Sandbox } = await import("e2b");
  const failed = [];
  for (const sandboxId of e2bSandboxIds) {
    let lastError = "";
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const sandbox = await Sandbox.connect(sandboxId, { apiKey: process.env.E2B_API_KEY });
        await sandbox.kill();
        lastError = "";
        break;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (/not found|does not exist|404/i.test(message)) {
          lastError = "";
          break;
        }
        lastError = message;
        await wait(1000 * (attempt + 1));
      }
    }
    if (lastError) failed.push(`${sandboxId}: ${lastError}`);
  }
  if (failed.length) throw new Error(`E2B cleanup failed: ${failed.join("; ")}`);
}

const dbRun = (sql, params = []) => {
  try {
    db.prepare(sql).run(...params);
  } catch (error) {
    // best-effort: a missing child row must not abort the rest of the teardown
    console.error(`[E2E cleanup] ${sql} -> ${error instanceof Error ? error.message : String(error)}`);
  }
};

const dbAll = (sql, params = []) => {
  try {
    return db.prepare(sql).all(...params);
  } catch {
    return [];
  }
};

function cleanupSessionRecord(sessionId) {
  cleanupDockerRuntimeForSession(sessionId);
  dbRun("DELETE FROM deployment_runs WHERE session_id = ?", [sessionId]);
  dbRun("DELETE FROM session_artifacts WHERE session_id = ?", [sessionId]);
  dbRun("DELETE FROM tool_calls WHERE session_id = ?", [sessionId]);
  dbRun("DELETE FROM session_events WHERE session_id = ?", [sessionId]);
  dbRun("DELETE FROM session_threads WHERE session_id = ?", [sessionId]);
  dbRun("DELETE FROM sessions WHERE id = ?", [sessionId]);
}

function cleanupAgentRecord(agentId) {
  for (const { id } of dbAll("SELECT id FROM agent_deployments WHERE agent_id = ?", [agentId])) {
    dbRun("DELETE FROM deployment_runs WHERE deployment_id = ?", [id]);
  }
  dbRun("DELETE FROM agent_deployments WHERE agent_id = ?", [agentId]);
  dbRun("DELETE FROM agent_versions WHERE agent_id = ?", [agentId]);
  dbRun("DELETE FROM agents WHERE id = ?", [agentId]);
}

function cleanupWorkspaceRecord(workspaceId) {
  dbRun("DELETE FROM deployment_runs WHERE workspace_id = ?", [workspaceId]);
  for (const { id } of dbAll("SELECT id FROM sessions WHERE workspace_id = ?", [workspaceId])) cleanupSessionRecord(id);
  for (const { id } of dbAll("SELECT id FROM agents WHERE workspace_id = ?", [workspaceId])) cleanupAgentRecord(id);
  for (const { id } of dbAll("SELECT id FROM vaults WHERE workspace_id = ?", [workspaceId])) {
    dbRun("DELETE FROM vault_credentials WHERE vault_id = ?", [id]);
    dbRun("DELETE FROM vaults WHERE id = ?", [id]);
  }
  for (const { id } of dbAll("SELECT id FROM memory_stores WHERE workspace_id = ?", [workspaceId])) {
    for (const memory of dbAll("SELECT id FROM memories WHERE memory_store_id = ?", [id])) {
      dbRun("DELETE FROM memory_versions WHERE memory_id = ?", [memory.id]);
    }
    dbRun("DELETE FROM memories WHERE memory_store_id = ?", [id]);
    dbRun("DELETE FROM memory_stores WHERE id = ?", [id]);
  }
  dbRun("DELETE FROM environments WHERE workspace_id = ?", [workspaceId]);
  dbRun("DELETE FROM mcp_servers WHERE workspace_id = ?", [workspaceId]);
  dbRun("DELETE FROM workspace_api_keys WHERE workspace_id = ?", [workspaceId]);
  dbRun("DELETE FROM workspace_sandbox_pool_members WHERE workspace_id = ?", [workspaceId]);
  dbRun("DELETE FROM workspace_runtime_pool_members WHERE workspace_id = ?", [workspaceId]);
  dbRun("DELETE FROM workspace_runtime_pools WHERE workspace_id = ?", [workspaceId]);
  dbRun("DELETE FROM workspace_members WHERE workspace_id = ?", [workspaceId]);
  dbRun("DELETE FROM workspaces WHERE id = ?", [workspaceId]);
}

function cleanupLocalSkill(name) {
  try {
    const skillDir = join(homedir(), ".agents", "skills", name);
    for (const relativeDir of clientSkillDirs) {
      const link = join(homedir(), relativeDir, name);
      try { if (lstatSync(link).isSymbolicLink()) unlinkSync(link); } catch {}
    }
    try { unlinkSync(join(skillDir, "SKILL.md")); } catch {}
    try { rmdirSync(skillDir); } catch {}
  } catch {}
}

function cleanupDockerRuntimeForSession(sessionId) {
  const row = dbAll("SELECT metadata_json FROM sessions WHERE id = ?", [sessionId])[0];
  const metadata = parseJsonObject(row?.metadata_json);
  const containerIds = new Set([metadata.runtime?.container_id, metadata.sandbox_runtime?.container_id].filter(Boolean).map(String));
  for (const containerId of containerIds) {
    try { execFileSync("docker", ["rm", "-f", containerId], { stdio: "ignore", timeout: 30_000 }); } catch {}
  }
}

function parseJsonObject(value) {
  try {
    const parsed = value ? JSON.parse(String(value)) : {};
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

// Tear down every record this run created. Resources are deleted child -> parent so
// the FK chain (PR1 hardened: tenant_id/workspace_id NOT NULL + CASCADE) stays satisfied
// without disabling FK checks. The global model configs this run created (workspace_id="-1")
// MUST be removed too: they otherwise leak into other suites' "global model == 3" assertions.
function cleanupE2ERecords() {
  const userIds = new Set([...createdUserIds].map(String));
  for (const email of createdUserEmails) {
    const row = dbAll("SELECT id FROM users WHERE email = ?", [email])[0];
    if (row?.id) userIds.add(String(row.id));
  }

  // workspaces (and their full child trees) owned by any user this run created
  for (const userId of userIds) {
    const workspaces = dbAll("SELECT id, tenant_id FROM workspaces WHERE created_by_user_id = ?", [userId]);
    const tenantIds = new Set();
    for (const workspace of workspaces) {
      cleanupWorkspaceRecord(String(workspace.id));
      if (workspace.tenant_id != null) tenantIds.add(String(workspace.tenant_id));
    }
    for (const tenantId of tenantIds) {
      dbRun("DELETE FROM tenant_members WHERE tenant_id = ?", [tenantId]);
      dbRun("DELETE FROM tenants WHERE id = ?", [tenantId]);
    }
  }

  // CLI deployments (Maple CLI) create global-scoped (workspace_id="-1") agents/environments
  // not covered by the workspace sweep above; agent_deployments.user_id FKs users, so they must
  // be torn down before the user row is deleted.
  for (const userId of userIds) {
    const deployments = dbAll("SELECT id, agent_id, environment_id FROM agent_deployments WHERE user_id = ?", [userId]);
    for (const deployment of deployments) {
      for (const session of dbAll("SELECT id FROM sessions WHERE agent_id = ? OR environment_id = ?", [deployment.agent_id || "", deployment.environment_id || ""])) {
        cleanupSessionRecord(String(session.id));
      }
      dbRun("DELETE FROM deployment_runs WHERE deployment_id = ?", [deployment.id]);
      dbRun("DELETE FROM agent_deployments WHERE id = ?", [deployment.id]);
      if (deployment.agent_id) cleanupAgentRecord(String(deployment.agent_id));
      if (deployment.environment_id) dbRun("DELETE FROM environments WHERE id = ?", [deployment.environment_id]);
    }
  }

  // agent_templates created by this run (no owner column -> match by stamped name)
  dbRun("DELETE FROM agent_templates WHERE name LIKE ?", [`E2E Template ${stamp}%`]);

  // skills created by this run (DB rows + on-disk source/symlinks)
  for (const skill of dbAll("SELECT id, name FROM skills WHERE name IN (?, ?)", [`maple-e2e-${stamp}`, `maple-skill-e2e-${stamp}`])) {
    dbRun("DELETE FROM skill_versions WHERE skill_id = ?", [skill.id]);
    dbRun("DELETE FROM skills WHERE id = ?", [skill.id]);
    cleanupLocalSkill(String(skill.name));
  }

  // global + private model configs created by this run (owner-scoped; clears the -1 sentinel pollution)
  for (const userId of userIds) {
    dbRun("DELETE FROM model_configs WHERE owner_user_id = ?", [userId]);
    dbRun("DELETE FROM auth_sessions WHERE user_id = ?", [userId]);
    dbRun("DELETE FROM users WHERE id = ?", [userId]);
  }
}

async function main() {
await step("E2E servers reachable", ensureServers);

await step("API health", async () => {
  const health = await request("/health");
  if (!health.ok) throw new Error("health.ok is false");
  return health;
});

const testSession = await step("Post-login test session bootstrap", async () => {
  const response = await requestRaw("/v1/auth/login", {
    method: "POST",
    body: JSON.stringify({ provider: "local", email: `e2e-${stamp}@example.com`, name: `E2E User ${stamp}` })
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`test session bootstrap failed ${response.status}: ${text}`);
  const setCookie = response.headers.get("set-cookie");
  if (!setCookie?.includes("maple_session=")) throw new Error(`missing test session cookie: ${setCookie}`);
  authCookie = setCookie.split(";")[0];
  const body = JSON.parse(text);
  if (!body.user?.id) throw new Error(`test session body missing user: ${text}`);
  createdUserIds.add(String(body.user.id));
  createdUserEmails.add(`e2e-${stamp}@example.com`);
  return body;
});

const defaultModelConfigs = await step(useE2BSandbox ? "Model gateway seeds four default VolcoEngine configs" : "Local Docker starts without bundled model pool", async () => {
  const listed = await request("/v1/model_configs");
  const expectedModels = ["glm-4-7-251222", "doubao-seed-1-6-flash-250615", "doubao-seed-2-0-lite-260428", "deepseek-v4-flash-260425"];
  if (!useE2BSandbox) {
    const bundled = listed.data?.filter((item) => item.base_url === "https://ark.cn-beijing.volces.com/api/v3" && expectedModels.includes(item.model_name)) ?? [];
    if (bundled.length) throw new Error(`local Docker must not expose bundled VolcoEngine configs: ${JSON.stringify(listed.data)}`);
    return [];
  }
  const configs = expectedModels.map((modelName) => listed.data?.find((item) => item.base_url === "https://ark.cn-beijing.volces.com/api/v3" && item.model_name === modelName));
  if (configs.some((config) => !config)) throw new Error(`default VolcoEngine configs missing: ${JSON.stringify(listed.data)}`);
  for (const config of configs) {
    if (config.api_key_ref || config.api_key_ciphertext) throw new Error(`default config exposed secret material: ${JSON.stringify(config)}`);
    if (process.env.ARK_API_KEY && !config.has_api_key) throw new Error(`default config did not store ARK_API_KEY in DB: ${JSON.stringify(config)}`);
  }
  return configs.map((config) => ({
    id: config.id,
    name: config.name,
    provider_type: config.provider_type,
    model: config.model_name,
    is_default: config.is_default,
    credential: config.has_api_key ? "stored" : "env_fallback"
  }));
});

const workspaceOnboarding = await step("Workspace onboarding enforces tenant slug contract and admin-visible API key", async () => {
  const invalid = await request("/v1/tenants/slug/ab");
  if (invalid.available || invalid.reason !== "invalid") throw new Error(`expected invalid slug response: ${JSON.stringify(invalid)}`);
  const reserved = await request("/v1/tenants/slug/api");
  if (reserved.available || reserved.reason !== "reserved") throw new Error(`expected reserved slug response: ${JSON.stringify(reserved)}`);
  const slug = `e2e-tenant-${stamp}`;
  const created = await request("/v1/workspace_onboarding", {
    method: "POST",
    body: JSON.stringify({
      tenant: {
        name: `E2E Tenant ${stamp}`,
        description: "E2E tenant onboarding contract"
      },
      workspace: {
        name: `E2E Workspace ${stamp}`,
        description: "E2E workspace onboarding contract",
        slug
      },
      runtime_provider: onboardingRuntimeProvider,
      runtime_pool: {
        desired_size: 3,
        max_instances_per_function: 10,
        max_concurrency_per_instance: 20,
        cpu_milli: 1000,
        memory_mb: 2048
      },
      sandbox_provider: onboardingSandboxProvider,
      sandbox_config: useE2BSandbox ? {} : { local_docker: { image: "node:22-bookworm", networking: { mode: "limited", allow_mcp_servers: true, allow_package_managers: true } } },
      model_config_ids: defaultModelConfigs.map((config) => config.id),
      api_key: {
        display_name: `E2E Workspace Key ${stamp}`,
        scopes: ["control_plane", "data_plane"]
      },
      provider_credentials: {
        vefaas: useE2BSandbox ? {
          VOLCENGINE_ACCESS_KEY: process.env.VOLCENGINE_ACCESS_KEY || process.env.VOLC_ACCESSKEY || "e2e-access-key",
          VOLCENGINE_SECRET_KEY: process.env.VOLCENGINE_SECRET_KEY || process.env.VOLC_SECRETKEY || "e2e-secret-key",
          VEFAAS_REGION: process.env.MAPLE_VEFAAS_REGION || process.env.VEFAAS_REGION || "cn-beijing"
        } : {},
        e2b: useE2BSandbox ? {
          E2B_API_KEY: process.env.E2B_API_KEY || "e2e-e2b-key"
        } : {}
      }
    })
  });
  if (created.tenant?.metadata?.slug !== slug) throw new Error(`tenant metadata missing slug: ${JSON.stringify(created.tenant)}`);
  if (created.workspace?.config?.slug !== slug) throw new Error(`workspace config missing slug: ${JSON.stringify(created.workspace)}`);
  if (!created.api_key?.key?.startsWith("maple_ws_")) throw new Error("workspace onboarding did not issue one-time key");
  if (created.runtime_pool?.desired_size !== 3) throw new Error(`workspace runtime pool should prewarm 3 functions: ${JSON.stringify(created.runtime_pool)}`);
  const keys = await request(`/v1/workspaces/${created.workspace.id}/api_keys`);
  const listedKey = keys.data?.find((item) => item.id === created.api_key.id);
  if (listedKey?.key !== created.api_key.key) throw new Error(`workspace admin key list must include the issued full key: ${JSON.stringify(keys.data)}`);
  const taken = await request(`/v1/tenants/slug/${slug}`);
  const workspaceTaken = await request(`/v1/workspace_slugs/${slug}`);
  if (taken.available || taken.reason !== "taken" || workspaceTaken.available || workspaceTaken.reason !== "taken") {
    throw new Error(`expected taken slug responses: ${JSON.stringify({ taken, workspaceTaken })}`);
  }
  return {
    tenant: created.tenant.id,
    workspace: created.workspace.id,
    workspaceRecord: created.workspace,
    workspaceKey: created.api_key.key,
    slug,
    key_prefix: created.api_key.key_prefix,
    runtime_pool_size: created.runtime_pool.desired_size,
    model_config_count: defaultModelConfigs.length,
    invalid: invalid.reason,
    reserved: reserved.reason,
    taken: taken.reason
  };
});

await step("Quickstart builder super-agent creates draft, agent, and environment", async () => {
  const builder = await request("/v1/quickstart/builder_session", {
    method: "POST",
    body: JSON.stringify({
      workspace_id: workspaceOnboarding.workspace,
      model_config_id: defaultModelConfigs[0]?.id,
      agent_loop_type: "anthropic_claude_code"
    })
  });
  if (builder.session?.metadata?.purpose !== "quickstart_builder") throw new Error(`builder session missing purpose: ${JSON.stringify(builder.session)}`);

  const visibleAgents = await request(`/v1/agents?workspace_id=${encodeURIComponent(workspaceOnboarding.workspace)}`);
  if (visibleAgents.data?.some((agent) => agent.config?.metadata?.purpose === "quickstart_builder")) {
    throw new Error(`hidden builder agent leaked into agent list: ${JSON.stringify(visibleAgents.data)}`);
  }

  // The builder turn now runs on the background queue: /message returns 202 immediately and
  // the draft card arrives asynchronously over the session detail. Assert the route returns
  // fast (no synchronous multi-LLM await), then poll the detail for the draft card.
  const messageStartedAt = Date.now();
  const message = await request(`/v1/quickstart/builder_session/${builder.session.id}/message`, {
    method: "POST",
    body: JSON.stringify({
      text: `Create a customer onboarding analyst agent ${stamp}`,
      model_config_id: defaultModelConfigs[0]?.id,
      agent_loop_type: "anthropic_claude_code"
    })
  });
  const messageAckMs = Date.now() - messageStartedAt;
  if (messageAckMs > 15_000) throw new Error(`builder /message blocked for ${messageAckMs}ms — expected async 202 ack`);
  if (!message.detail?.events?.some((event) => event.type === "user.message")) {
    throw new Error(`builder /message ack missing user.message: ${JSON.stringify(message.detail?.events)}`);
  }
  const draftDetail = await poll(async () => {
    const value = await request(`/v1/sessions/${builder.session.id}/detail`);
    const settled = ["idle", "failed"].includes(String(value.session?.status ?? ""));
    const card = value.events?.find((event) => event.type === "ui.card" && event.payload?.card_type === "agent_draft");
    return card?.payload?.draft?.name ? value : (settled ? value : null);
  }, 150_000, "builder draft card");
  const draftCard = draftDetail.events?.find((event) => event.type === "ui.card" && event.payload?.card_type === "agent_draft");
  if (!draftCard?.payload?.draft?.name) throw new Error(`builder did not emit draft card: ${JSON.stringify(draftDetail.events)}`);

  const createdAgent = await request(`/v1/quickstart/builder_session/${builder.session.id}/action`, {
    method: "POST",
    body: JSON.stringify({ action_id: "create_agent", payload: {} })
  });
  const agentResource = createdAgent.detail?.events?.find((event) => event.type === "ui.resource" && event.payload?.resource_type === "agent");
  if (!agentResource?.payload?.id) throw new Error(`builder did not create agent resource: ${JSON.stringify(createdAgent.detail?.events)}`);

  const createdEnvironment = await request(`/v1/quickstart/builder_session/${builder.session.id}/action`, {
    method: "POST",
    body: JSON.stringify({ action_id: "create_environment", payload: { slug: `builder-${stamp}`, networking: "none" } })
  });
  const environmentResource = createdEnvironment.detail?.events?.find(
    (event) => event.type === "ui.resource" && event.payload?.resource_type === "environment" && event.payload?.mode === "created"
  );
  const environmentConfig = environmentResource?.payload?.resource?.config ?? {};
  if (!environmentResource?.payload?.id || environmentConfig.agent_runtime) {
    throw new Error(`builder environment invalid: ${JSON.stringify(environmentResource)}`);
  }

  const visibleEnvironments = await request("/v1/environments");
  if (visibleEnvironments.data?.some((environment) => environment.config?.metadata?.purpose === "quickstart_builder")) {
    throw new Error(`hidden builder environment leaked into environment list: ${JSON.stringify(visibleEnvironments.data)}`);
  }

  return {
    session: builder.session.id,
    agent: agentResource.payload.id,
    environment: environmentResource.payload.id,
    builder: draftCard.payload.draft.metadata?.builder ?? "unknown"
  };
});

await step("Agent draft fails fast when provider config is invalid", async () => {
  const brokenModel = await request("/v1/model_configs", {
    method: "POST",
    body: JSON.stringify({
      workspace_id: workspaceOnboarding.workspace,
      kind: "custom",
      name: `E2E Broken Default Model ${stamp}`,
      base_url: "http://127.0.0.1:9/v1",
      model_name: `broken-model-${stamp}`,
      api_key: `broken-key-${stamp}`,
      is_default: false
    })
  });
  const startedAt = Date.now();
  const response = await requestRaw("/v1/agent_drafts", {
    method: "POST",
    body: JSON.stringify({ prompt: `Create a test engineering agent with repo tools ${stamp}`, model_config_id: brokenModel.id })
  });
  const body = await response.json();
  const elapsedMs = Date.now() - startedAt;
  if (response.status !== 502) throw new Error(`expected 502 for broken provider, got ${response.status}: ${JSON.stringify(body)}`);
  if (body.error !== "agent_draft_generation_failed") throw new Error(`unexpected draft error: ${JSON.stringify(body)}`);
  if (body.draft) throw new Error(`broken provider must not return a draft: ${JSON.stringify(body.draft)}`);
  if (elapsedMs > 25_000) throw new Error(`provider failure was too slow: ${elapsedMs}ms`);
  await requestRaw(`/v1/model_configs/${brokenModel.id}`, { method: "DELETE" });
  return { elapsedMs, error: body.error };
});

await step("API rejects invalid agent payload", async () => {
  const response = await requestRaw("/v1/agents", {
    method: "POST",
    body: JSON.stringify({ name: "" })
  });
  const text = await response.text();
  if (response.status !== 400) throw new Error(`expected 400, got ${response.status}: ${text}`);
  if (!text.includes("fieldErrors")) throw new Error(`unexpected validation body: ${text}`);
  return { status: response.status };
});

const modelConfig = await step("Model gateway creates custom model config", async () => {
  const created = await request("/v1/model_configs", {
    method: "POST",
    body: JSON.stringify({
      workspace_id: workspaceOnboarding.workspace,
      kind: "custom",
      name: `E2E Custom Model ${stamp}`,
      base_url: "https://example.invalid/v1",
      model_name: `e2e-model-${stamp}`,
      api_key: `e2e-real-key-${stamp}`,
      is_default: false
    })
  });
  if (!created.id || !created.has_api_key || created.api_key_ref) throw new Error(`unsafe model config response: ${JSON.stringify(created)}`);
  const listed = await request("/v1/model_configs");
  if (!listed.data?.some((item) => item.id === created.id)) throw new Error("created model config not listed");
  return created;
});

await step("Model gateway connectivity test returns structured status", async () => {
  const saved = await request(`/v1/model_configs/${modelConfig.id}/test`, { method: "POST" });
  if (saved.ok !== false) throw new Error(`example.invalid test should fail structurally: ${JSON.stringify(saved)}`);
  if (saved.model !== modelConfig.model_name || saved.base_url !== modelConfig.base_url) throw new Error(`saved test target mismatch: ${JSON.stringify(saved)}`);
  if (JSON.stringify(saved).includes(`e2e-real-key-${stamp}`)) throw new Error(`saved test leaked API key: ${JSON.stringify(saved)}`);
  const unsaved = await request("/v1/model_configs/test", {
    method: "POST",
    body: JSON.stringify({
      kind: "custom",
      base_url: "https://example.invalid/v1",
      model_name: `unsaved-e2e-model-${stamp}`,
      api_key: `unsaved-e2e-key-${stamp}`
    })
  });
  if (unsaved.ok !== false || unsaved.model !== `unsaved-e2e-model-${stamp}`) throw new Error(`unexpected unsaved test result: ${JSON.stringify(unsaved)}`);
  if (JSON.stringify(unsaved).includes(`unsaved-e2e-key-${stamp}`)) throw new Error(`unsaved test leaked API key: ${JSON.stringify(unsaved)}`);
  return { savedStatus: saved.status, unsavedStatus: unsaved.status };
});

if (useE2BSandbox) {
  await step("E2B credentials", async () => {
    if (!process.env.E2B_API_KEY) throw new Error("E2B_API_KEY is required for E2E_SANDBOX_PROVIDER=e2b");
    return { provider: e2eSandboxProvider, apiKey: "present" };
  });
} else {
  await step("Docker daemon", async () => {
    const { stdout } = await execFileAsync("docker", ["info", "--format", "{{.ServerVersion}}"], { timeout: 10_000 });
    return { serverVersion: stdout.trim() };
  });
}

const e2bEnvironment = await step(useE2BSandbox ? "Sandbox infrastructure defaults to E2B and can persist E2B environments" : "Sandbox infrastructure defaults to Local Docker", async () => {
  const listed = await request("/v1/environments");
  const defaultE2B = listed.data?.find((item) => item.config?.sandbox?.provider === "e2b" || item.config?.type === "e2b");
  const defaultDocker = listed.data?.find((item) => item.config?.sandbox?.provider === "local_docker" || item.config?.type === "local_docker");
  if (!useE2BSandbox) {
    if (!defaultDocker) throw new Error(`default Local Docker environment missing: ${JSON.stringify(listed.data?.map((item) => item.name))}`);
    return { id: defaultDocker.id, default: defaultDocker.name, fallback: defaultE2B?.name ?? null };
  }
  if (!defaultE2B) throw new Error(`default E2B environment missing: ${JSON.stringify(listed.data?.map((item) => item.name))}`);
  const created = await request("/v1/environments", {
    method: "POST",
    body: JSON.stringify({
      workspace_id: workspaceOnboarding.workspace,
      name: `e2e-e2b-env-${stamp}`,
      config: {
        type: "e2b",
        sandbox: {
          provider: "e2b",
          e2b: { template: "base", workspace_path: "/workspace", timeout_ms: 3600000 }
        },
        networking: { mode: "cloud_limited", allow_internet_access: true }
      }
    })
  });
  if (created.config?.sandbox?.provider !== "e2b") throw new Error(`created env is not E2B: ${JSON.stringify(created)}`);
  return { id: created.id, default: defaultE2B.name, fallback: defaultDocker?.name ?? null, created: created.name };
});

const draft = await step("Natural-language agent draft generation", async () => {
  const body = await request("/v1/agent_drafts", {
    method: "POST",
    body: JSON.stringify({ prompt })
  });
  if (!body.draft?.name || !body.draft?.system) throw new Error("draft missing name/system");
  if (!Array.isArray(body.draft.tools)) throw new Error("draft.tools is not normalized array");
  if (useE2BSandbox && !body.draft.model?.config_id) throw new Error(`draft did not select a model config: ${JSON.stringify(body.draft.model)}`);
  if (!["anthropic_claude_code", "codex_open_source"].includes(body.draft.agent_loop?.type)) throw new Error(`draft missing agent_loop: ${JSON.stringify(body.draft.agent_loop)}`);
  return { name: body.draft.name, model: body.draft.model, toolCount: body.draft.tools.length, mcpCount: body.draft.mcp_servers?.length ?? 0, draft: body.draft };
});

const stableModelConfig = defaultModelConfigs.find((config) => config.model === "glm-4-7-251222") ?? defaultModelConfigs[0];
const runtimeAgentModel = stableModelConfig ? {
  provider: stableModelConfig.provider_type || "custom",
  id: stableModelConfig.model,
  name: stableModelConfig.name || stableModelConfig.model,
  config_id: stableModelConfig.id,
  speed: "standard"
} : { ...(draft.draft.model ?? {}), provider: draft.draft.model?.provider || "openai", id: draft.draft.model?.id || "default", speed: "standard" };

const agent = await step("Create reviewed agent", async () => {
  const body = await request("/v1/agents", {
    method: "POST",
    body: JSON.stringify({
      ...draft.draft,
      workspace_id: workspaceOnboarding.workspace,
      model: runtimeAgentModel,
      // This flow verifies the provider-loop runtime bridge. Drafted MCP servers force the
      // external-loop path, which would make the E2B tool bridge check depend on the host CLI.
      mcp_servers: [],
      tools: [{ type: "agent_toolset_20260401", default_config: { enabled: true, read: true, write: true, bash: true, grep: true } }],
      agent_loop: { type: "anthropic_claude_code", config: {}, hooks: [] }
    })
  });
  if (!body.id) throw new Error("agent id missing");
  if (body.config?.agent_loop?.type !== "anthropic_claude_code") throw new Error(`agent loop did not persist: ${JSON.stringify(body.config?.agent_loop)}`);
  return body;
});

await step("Agent API accepts Codex open-source loop selection", async () => {
  const body = await request("/v1/agents", {
    method: "POST",
    body: JSON.stringify({
      ...draft.draft,
      workspace_id: workspaceOnboarding.workspace,
      name: `${draft.draft.name} Codex ${stamp}`,
      agent_loop: { type: "codex_open_source", config: { harness: "maple" }, hooks: [] }
    })
  });
  if (body.config?.agent_loop?.type !== "codex_open_source") throw new Error(`codex loop missing: ${JSON.stringify(body.config?.agent_loop)}`);
  return { id: body.id, loop: body.config.agent_loop };
});

await step("Agent model can be updated without losing versioned config", async () => {
  const body = await request("/v1/agents", {
    method: "POST",
    body: JSON.stringify({ ...draft.draft, workspace_id: workspaceOnboarding.workspace })
  });
  const updated = await request(`/v1/agents/${body.id}`, {
    method: "PATCH",
    body: JSON.stringify({
      model: {
        provider: modelConfig.provider_type,
        id: modelConfig.model_name,
        config_id: modelConfig.id,
        name: modelConfig.name,
        speed: "standard"
      }
    })
  });
  if (updated.current_version <= body.current_version) throw new Error(`agent version did not advance: ${JSON.stringify(updated)}`);
  if (updated.config.model.config_id !== modelConfig.id || updated.config.model.id !== modelConfig.model_name) {
    throw new Error(`agent model update did not persist: ${JSON.stringify(updated.config.model)}`);
  }
  return { id: updated.id, version: updated.current_version, model: updated.config.model };
});

const environment = useE2BSandbox
  ? e2bEnvironment
  : await step("Create Docker environment", async () => {
      const body = await request("/v1/environments", {
        method: "POST",
        body: JSON.stringify({
          workspace_id: workspaceOnboarding.workspace,
          name: `e2e-env-${stamp}`,
          config: {
            type: "local_docker",
            sandbox: { provider: "local_docker" },
            image: "node:22-bookworm",
            networking: { mode: "limited", allow_mcp_servers: true, allow_package_managers: true }
          }
        })
      });
      if (!body.id) throw new Error("environment id missing");
      if (body.config?.sandbox?.provider !== "local_docker") throw new Error(`docker fallback provider missing: ${JSON.stringify(body.config)}`);
      return body;
    });

const vault = await step("Create credential vault", async () => {
  const body = await request("/v1/vaults", {
    method: "POST",
    body: JSON.stringify({ workspace_id: workspaceOnboarding.workspace, display_name: `E2E Vault ${stamp}`, metadata: { source: "e2e", shared_scope: "workspace" } })
  });
  if (!body.id) throw new Error("vault id missing");
  return body;
});

const credential = await step("Create encrypted vault credential", async () => {
  const secret = `e2e-secret-${stamp}`;
  const body = await request(`/v1/vaults/${vault.id}/credentials`, {
    method: "POST",
    body: JSON.stringify({
      name: "Notion MCP server",
      mcp_server_url: "https://mcp.notion.com/mcp",
      auth_type: "oauth",
      secret,
      metadata: { registry_name: "Notion" }
    })
  });
  if (!body.id || body.secret_ref || body.secret_cipher) throw new Error("credential response must not expose secret material");
  if (!isLocalhost(new URL(apiBase))) {
    const listed = await request(`/v1/vaults/${vault.id}/credentials`);
    const record = listed.data?.find((item) => item.id === body.id);
    if (!record) throw new Error("created credential not listed");
    if (JSON.stringify(record).includes(secret) || record.secret_ref || record.secret_cipher) throw new Error(`credential list leaked secret material: ${JSON.stringify(record)}`);
    return { id: body.id, auth_type: body.auth_type, mcp_server_url: body.mcp_server_url, secretStorage: "remote" };
  }
  const secretDir = join(e2eDataDir, "secrets");
  const secretFiles = existsSync(secretDir)
    ? readdirSync(secretDir)
        .filter((file) => file.endsWith(".json"))
        .map((file) => join(secretDir, file))
        .filter((file) => statSync(file).mtimeMs >= testStart)
    : [];
  if (secretFiles.length === 0) throw new Error("no encrypted secret file was created");
  const leaked = secretFiles.some((path) => readFileSync(path, "utf8").includes(secret));
  if (leaked) throw new Error("encrypted secret file contains raw secret");
  return { id: body.id, auth_type: body.auth_type, mcp_server_url: body.mcp_server_url, secretFileCount: secretFiles.length };
});

const memoryStore = await step("Memory store API persists and queries memory", async () => {
  const store = await request("/v1/memory_stores", {
    method: "POST",
    body: JSON.stringify({
      workspace_id: workspaceOnboarding.workspace,
      name: `E2E Memory ${stamp}`,
      description: "E2E memory persistence store",
      metadata: { source: "e2e" }
    })
  });
  if (!store.id) throw new Error("memory store id missing");
  const memoryPath = `e2e/${stamp}.md`;
  const content = `# E2E Memory\n\nfinding=${fileContent}`;
  const memory = await request(`/v1/memory_stores/${store.id}/memories/${memoryPath}`, {
    method: "PUT",
    body: JSON.stringify({ actor: "e2e", content })
  });
  if (!memory?.id) throw new Error("memory id missing");
  const queried = await request(`/v1/memory_stores/${store.id}/memories?query=${encodeURIComponent(fileContent)}`);
  if (!queried.data?.some((item) => item.path === memoryPath && item.content.includes(fileContent))) {
    throw new Error("memory query did not return persisted record");
  }
  return { store: store.id, name: store.name, memory: memory.id, path: memoryPath };
});

const templateRecord = await step("Template API creates and edits template", async () => {
  const created = await request("/v1/templates", {
    method: "POST",
    body: JSON.stringify({
      name: `E2E Template ${stamp}`,
      description: "E2E template create check",
      category: "e2e",
      template: { model: "doubao-seed-1-6-251015", tools: ["write_file"] }
    })
  });
  if (!created.id) throw new Error("template id missing");
  const updated = await request(`/v1/templates/${created.id}`, {
    method: "PATCH",
    body: JSON.stringify({
      name: `E2E Template ${stamp} Edited`,
      description: "E2E template edit check",
      category: "e2e-updated",
      template: { model: "doubao-seed-1-6-251015", tools: ["write_file", "list_files"] }
    })
  });
  if (updated.name !== `E2E Template ${stamp} Edited` || updated.category !== "e2e-updated") {
    throw new Error(`template update failed: ${JSON.stringify(updated)}`);
  }
  return updated;
});

const skillRecord = await step("Skill API creates and edits local skill", async () => {
  const name = `maple-e2e-${stamp}`;
  const created = await request("/v1/skills", {
    method: "POST",
    body: JSON.stringify({
      name,
      description: "Use when verifying managed-agents platform E2E skill creation."
    })
  });
  if (!created.id || created.name !== name) throw new Error(`skill create failed: ${JSON.stringify(created)}`);
  const updated = await request(`/v1/skills/${created.id}`, {
    method: "PATCH",
    body: JSON.stringify({
      description: "Use when verifying managed-agents platform E2E skill editing."
    })
  });
  if (updated.name !== name || !updated.metadata?.description?.includes("editing")) {
    throw new Error(`skill update failed: ${JSON.stringify(updated)}`);
  }
  if (cloudTarget) {
    if (!String(updated.source_path || "").endsWith(`/${name}`)) throw new Error(`cloud skill source_path mismatch: ${updated.source_path}`);
    return { ...updated, symlink_count: Array.isArray(updated.metadata?.symlinks) ? updated.metadata.symlinks.length : 0, mode: "cloud" };
  }
  const expectedSourcePath = join(process.env.HOME || "", ".agents", "skills", name);
  if (updated.source_path !== expectedSourcePath) {
    throw new Error(`skill source_path mismatch: ${updated.source_path}`);
  }
  const skillFile = join(expectedSourcePath, "SKILL.md");
  if (!existsSync(skillFile)) throw new Error(`skill SKILL.md missing: ${skillFile}`);
  const skillText = readFileSync(skillFile, "utf8");
  if (!skillText.includes(`name: ${name}`) || !skillText.includes("description:")) {
    throw new Error(`skill SKILL.md content invalid: ${skillText}`);
  }
  const symlinks = Array.isArray(updated.metadata?.symlinks) ? updated.metadata.symlinks : [];
  if (symlinks.length !== clientSkillDirs.length) {
    throw new Error(`expected ${clientSkillDirs.length} skill symlinks, got ${symlinks.length}: ${JSON.stringify(symlinks)}`);
  }
  for (const relativeDir of clientSkillDirs) {
    const link = join(process.env.HOME || "", relativeDir, name);
    if (!existsSync(link) || !lstatSync(link).isSymbolicLink()) throw new Error(`skill symlink missing: ${link}`);
    const target = readlinkSync(link);
    if (target !== expectedSourcePath) throw new Error(`skill symlink target mismatch for ${link}: ${target}`);
  }
  return { ...updated, symlink_count: symlinks.length };
});

const skillFileRecord = await step("Skill file API reads tree and saves SKILL.md", async () => {
  const tree = await request(`/v1/skills/${skillRecord.id}/files`);
  if (!tree.root || !tree.tree?.some((entry) => entry.path === "SKILL.md" && entry.type === "file")) {
    throw new Error(`skill tree missing SKILL.md: ${JSON.stringify(tree)}`);
  }
  const file = await request(`/v1/skills/${skillRecord.id}/files/SKILL.md`);
  if (!file.content?.includes(skillRecord.name) || !file.editable) throw new Error(`unexpected skill file body: ${JSON.stringify(file)}`);
  const nextContent = file.content.includes(`file tree save ${stamp}`)
    ? file.content
    : `${file.content.trim()}\n\nFile tree save ${stamp}.\n`;
  const saved = await request(`/v1/skills/${skillRecord.id}/files/SKILL.md`, {
    method: "PUT",
    body: JSON.stringify({ content: nextContent })
  });
  if (!saved.content.includes(`File tree save ${stamp}.`)) throw new Error("saved SKILL.md content was not returned");
  const reread = await request(`/v1/skills/${skillRecord.id}/files/SKILL.md`);
  if (!reread.content.includes(`File tree save ${stamp}.`)) throw new Error("saved SKILL.md content did not persist");
  return { skill: skillRecord.name, path: saved.path, bytes: saved.size };
});

const mapleDeployment = await step("Maple CLI init/build/deploy publishes codex loop manifest", async () => {
  const cli = join(process.cwd(), "packages", "cli", "maple.mjs");
  const mapleRuntime = useE2BSandbox ? "e2b" : "local_docker";
  createdUserEmails.add(`maple-e2e-${stamp}@example.com`);
  const env = { ...process.env, MAPLE_CONFIG: mapleConfig, MAPLE_API_BASE_URL: apiBase, MAPLE_API_KEY: "" };
  await execFileAsync("bun", [cli, "config", "set", "api.baseUrl", apiBase], { env, timeout: 10_000 });
  await execFileAsync("bun", [cli, "config", "login", "--local", "--email", `maple-e2e-${stamp}@example.com`, "--name", `Maple E2E ${stamp}`], {
    env,
    timeout: 10_000
  });
  await execFileAsync(
    "bun",
    [cli, "init", "--name", `maple-e2e-${stamp}`, "--loop", "codex_open_source", "--runtime", mapleRuntime, "--directory", mapleProject, "--yes"],
    { env, timeout: 10_000 }
  );
  await execFileAsync("bun", [cli, "build", "--project", mapleProject], { env, timeout: 10_000 });
  const { stdout } = await execFileAsync("bun", [cli, "deploy", "--project", mapleProject, "--json"], { env, timeout: 20_000 });
  const deployed = JSON.parse(stdout.trim());
  if (!deployed.deployment_id || !deployed.agent_id || !deployed.environment_id) throw new Error(`bad Maple CLI deploy output: ${stdout}`);
  const status = await execFileAsync("bun", [cli, "status", "--json"], { env, timeout: 10_000 });
  const listed = JSON.parse(status.stdout.trim());
  if (!listed.data?.some((deployment) => deployment.id === deployed.deployment_id && deployment.manifest?.agent?.agent_loop?.type === "codex_open_source")) {
    throw new Error(`Maple CLI deployment not listed with codex loop: ${status.stdout}`);
  }
  return deployed;
});

await step("Maple CLI skill deploy-run creates skill-backed agent session and sandbox", async () => {
  const cli = join(process.cwd(), "packages", "cli", "maple.mjs");
  const mapleRuntime = useE2BSandbox ? "e2b" : "local_docker";
  const skillProject = join("/tmp", `maple-skill-e2e-${stamp}`);
  const skillConfig = join("/tmp", `maple-skill-e2e-${stamp}.json`);
  const skillName = `maple-skill-e2e-${stamp}`;
  createdUserEmails.add(`maple-skill-e2e-${stamp}@example.com`);
  const env = { ...process.env, MAPLE_CONFIG: skillConfig, MAPLE_API_BASE_URL: apiBase, MAPLE_API_KEY: "" };
  await execFileAsync("bun", [cli, "config", "set", "api.baseUrl", apiBase], { env, timeout: 10_000 });
  await execFileAsync("bun", [cli, "config", "login", "--local", "--email", `maple-skill-e2e-${stamp}@example.com`, "--name", `Maple Skill E2E ${stamp}`], {
    env,
    timeout: 10_000
  });
  const { stdout } = await execFileAsync(
    "bun",
    [
      cli,
      "skill",
      "deploy-run",
      "--name",
      skillName,
      "--description",
      "Use when verifying Maple CLI skill cloud deployment and session interaction.",
      "--project",
      skillProject,
      "--loop",
      "codex_open_source",
      "--runtime",
      mapleRuntime,
      "--prompt",
      `Use write_file to create qa/cli-skill-${stamp}.txt with content cli-skill-${stamp}, then use list_files on qa.`,
      "--json"
    ],
    { env, timeout: 240_000, maxBuffer: 1024 * 1024 * 4 }
  );
  const deployed = JSON.parse(stdout.trim());
  if (!deployed.skill_id || !deployed.deployment_id || !deployed.session_id) throw new Error(`bad Maple CLI skill deploy-run output: ${stdout}`);
  if (deployed.session_status !== "idle") throw new Error(`CLI skill session did not finish idle: ${stdout}`);
  let deployedRuntimeId = deployed.runtime_id ?? null;
  if (deployed.runtime_type === "e2b") {
    const row = dbAll("SELECT metadata_json FROM sessions WHERE id = ?", [deployed.session_id])[0];
    const metadata = row?.metadata_json ? JSON.parse(String(row.metadata_json)) : {};
    deployedRuntimeId ||= metadata.runtime?.sandbox_id ?? metadata.sandbox_runtime?.sandbox_id ?? null;
    if (deployedRuntimeId) e2bSandboxIds.add(String(deployedRuntimeId));
  }
  if (!deployed.tool_calls?.some((call) => call.name === "write_file" && call.status === "completed")) {
    throw new Error(`CLI skill deploy-run did not complete write_file: ${stdout}`);
  }
  return {
    skill_id: deployed.skill_id,
    deployment_id: deployed.deployment_id,
    session_id: deployed.session_id,
    runtime_type: deployed.runtime_type,
    runtime_id: deployedRuntimeId,
    tool_calls: deployed.tool_calls
  };
});

const e2bSession = await step(useE2BSandbox ? "Create real E2B sandbox session with deferred runtime" : "Create local Docker sandbox session with deferred runtime", async () => {
  const body = await request("/v1/sessions", {
    method: "POST",
    body: JSON.stringify({
      workspace_id: workspaceOnboarding.workspace,
      agent: agent.id,
      environment_id: environment.id,
      title: useE2BSandbox ? `E2E E2B Runtime Session ${stamp}` : `E2E Docker Runtime Session ${stamp}`,
      vault_ids: [vault.id],
      resources: [],
      metadata: sessionAgentRuntimeMetadata
    })
  });
  if (!body.id) throw new Error("sandbox session id missing");
  const detail = await poll(async () => {
    const value = await request(`/v1/sessions/${body.id}/detail`);
    const runtime = value.session.metadata?.runtime;
    const sandboxId = runtime?.sandbox_id;
    if (sandboxId) e2bSandboxIds.add(String(sandboxId));
    if (value.session.status === "failed") {
      const failed = value.events.find((event) => event.type === "session.status_failed");
      const error = String(failed?.payload?.error || "");
      throw new Error(`sandbox runtime bootstrap failed: ${error || JSON.stringify(value.session)}`);
    }
    const deferred = value.events.some((event) => event.type === "session.status_idle" && event.payload?.reason === "runtime_deferred");
    const runtimeReady = runtime?.type === expectedRuntimeType;
    return value.session.status === "idle" && (deferred || runtimeReady) ? value : null;
  }, 180_000, "sandbox session idle or deferred runtime");
  const sandboxId = detail.session.metadata?.runtime?.sandbox_id ?? null;
  if (sandboxId) e2bSandboxIds.add(String(sandboxId));
  return { ...body, sandbox_id: sandboxId, status: detail.session.status };
});

await step(useE2BSandbox ? "Real E2B provider/tool loop writes and lists workspace file" : "Local Docker provider/tool loop writes and lists workspace file", async () => {
  await request(`/v1/sessions/${e2bSession.id}/events`, {
    method: "POST",
    body: JSON.stringify({
      events: [
        {
          type: "user.message",
          content: [{ type: "text", text: `Use write_file to create ${e2bFilePath} with content ${e2bFileContent}, then use list_files on qa.` }]
        }
      ]
    })
  });
  const detail = await poll(async () => {
    const value = await request(`/v1/sessions/${e2bSession.id}/detail`);
    const writeCall = value.tool_calls.find(
      (call) => call.tool_name === "write_file" && call.status === "completed" && call.input?.path === e2bFilePath && call.input?.content === e2bFileContent
    );
    const bashWriteCall = value.tool_calls.find(
      (call) =>
        call.tool_name === "bash" &&
        call.status === "completed" &&
        typeof call.input?.command === "string" &&
        call.input.command.includes(e2bFilePath) &&
        call.input.command.includes(e2bFileContent)
    );
    const listCall = value.tool_calls.find((call) => call.tool_name === "list_files" && call.status === "completed");
    const runtime = value.session.metadata?.runtime;
    const sandboxId = runtime?.sandbox_id;
    if (sandboxId) e2bSandboxIds.add(String(sandboxId));
    process.stderr.write(`[E2E step51] status=${value.session.status} runtime=${runtime?.type} tools=${JSON.stringify(value.tool_calls.map((c) => c.tool_name + ":" + c.status))} write=${!!writeCall} bashWrite=${!!bashWriteCall} list=${!!listCall}\n`);
    return value.session.status === "idle" && runtime?.type === expectedRuntimeType && (writeCall || bashWriteCall) && listCall ? value : null;
  }, 240_000, "completed sandbox provider tool loop");
  const runtime = detail.session.metadata?.runtime;
  const runtimeId = runtime?.sandbox_id ?? runtime?.container_id ?? null;
  if (useE2BSandbox && !runtimeId) throw new Error(`E2B runtime missing sandbox_id after tool loop: ${JSON.stringify(runtime)}`);
  if (useE2BSandbox) e2bSandboxIds.add(String(runtimeId));
  if (cloudTarget) {
    return {
      session: e2bSession.id,
      runtime_id: runtimeId,
      toolCalls: detail.tool_calls.map((call) => ({ name: call.tool_name, status: call.status })),
      target: useE2BSandbox ? "cloud:e2b-workspace" : "cloud:workspace"
    };
  }
  const target = join(e2eDataDir, "sessions", e2bSession.id, e2bFilePath);
  if (!existsSync(target)) throw new Error(`E2B host-synced file not found: ${target}`);
  const content = readFileSync(target, "utf8");
  if (content.trimEnd() !== e2bFileContent) throw new Error(`unexpected E2B file content: ${content}`);
  return {
    session: e2bSession.id,
    runtime_id: runtimeId,
    toolCalls: detail.tool_calls.map((call) => ({ name: call.tool_name, status: call.status })),
    target
  };
});

const session = useE2BSandbox
  ? e2bSession
  : await step("Create session with agent/environment/vault", async () => {
      const body = await request("/v1/sessions", {
        method: "POST",
        body: JSON.stringify({
          workspace_id: workspaceOnboarding.workspace,
          agent: agent.id,
          environment_id: environment.id,
          title: `E2E Runtime Session ${stamp}`,
          vault_ids: [vault.id],
          resources: [],
          metadata: sessionAgentRuntimeMetadata
        })
      });
      if (!body.id) throw new Error("session id missing");
      return body;
    });

await step("Session detail API includes immutable snapshot and linked resources", async () => {
  const detail = await request(`/v1/sessions/${session.id}/detail`);
  if (detail.agent?.id !== agent.id) throw new Error("detail agent mismatch");
  if (detail.environment?.id !== environment.id) throw new Error("detail environment mismatch");
  if (!detail.vaults.some((item) => item.id === vault.id)) throw new Error("linked vault missing");
  if (detail.session.agent_snapshot?.name !== agent.name) throw new Error("agent snapshot missing from session");
  if (detail.session.agent_snapshot?.agent_loop?.type !== "anthropic_claude_code") throw new Error(`agent loop missing from snapshot: ${JSON.stringify(detail.session.agent_snapshot?.agent_loop)}`);
  return {
    agent: detail.agent.id,
    environment: detail.environment.id,
    vaults: detail.vaults.map((item) => item.id),
    loop: detail.session.agent_snapshot.agent_loop
  };
});

await step("Client event API rejects forged agent/system events", async () => {
  const response = await requestRaw(`/v1/sessions/${session.id}/events`, {
    method: "POST",
    body: JSON.stringify({ events: [{ type: "agent.tool_use", payload: { name: "bash" } }] })
  });
  const text = await response.text();
  if (response.status !== 400 || !text.includes("event_type_not_client_writable")) throw new Error(`expected forged event 400, got ${response.status}: ${text}`);
  return { status: response.status };
});

await step("Session runtime is idle before message", async () => {
  const detail = await poll(async () => {
    const value = await request(`/v1/sessions/${session.id}/detail`);
    const deferred = value.events.some((event) => event.type === "session.status_idle" && event.payload?.reason === "runtime_deferred");
    const runtimeReady = value.session.metadata?.runtime?.type === expectedRuntimeType;
    return value.session.status === "idle" && (deferred || runtimeReady) ? value : null;
  }, 60_000, "session idle before message");
  return {
    status: detail.session.status,
    runtimeType: detail.session.metadata?.runtime?.type ?? "deferred",
    runtimeId: detail.session.metadata?.runtime?.container_name ?? detail.session.metadata?.runtime?.sandbox_id ?? null,
    vaultCount: detail.vaults.length
  };
});

await step("Send user message into real provider/tool loop", async () => {
  await request(`/v1/sessions/${session.id}/events`, {
    method: "POST",
    body: JSON.stringify({
      events: [
        {
          type: "user.message",
          content: [{ type: "text", text: `Use write_file to create ${filePath} with content ${fileContent}, then use list_files on qa.` }]
        }
      ]
    })
  });
  return { session: session.id, filePath };
});

const finalDetail = await step("Provider tool loop records user/agent/tool/session events", async () => {
  const detail = await poll(async () => {
    const value = await request(`/v1/sessions/${session.id}/detail`);
    const eventTypes = value.events.map((event) => event.type);
    const writeCall = value.tool_calls.find(
      (call) => call.tool_name === "write_file" && call.status === "completed" && call.input?.path === filePath && call.input?.content === fileContent
    );
    const bashWriteCall = value.tool_calls.find(
      (call) =>
        call.tool_name === "bash" &&
        call.status === "completed" &&
        typeof call.input?.command === "string" &&
        call.input.command.includes(filePath)
    );
    const listCall = value.tool_calls.find((call) => call.tool_name === "list_files" && call.status === "completed");
    const runtimeReady = value.session.metadata?.runtime?.type === expectedRuntimeType;
    const done = value.session.status === "idle" && runtimeReady && eventTypes.includes("user.message") && eventTypes.includes("agent.message_delta") && (writeCall || bashWriteCall) && listCall;
    return done ? value : null;
  }, 180_000, "completed provider tool loop");
  const eventTypes = [...new Set(detail.events.map((event) => event.type))];
  const requiredEventTypes = ["user.message", "agent.loop_selected", "session.status_running", "agent.tool_use", "tool.result", "agent.message_delta", "session.status_idle"];
  const missingEventTypes = requiredEventTypes.filter((type) => !eventTypes.includes(type));
  if (missingEventTypes.length) throw new Error(`missing required event types: ${missingEventTypes.join(", ")}`);
  return {
    status: detail.session.status,
    runtimeType: detail.session.metadata?.runtime?.type,
    eventTypes,
    toolCalls: detail.tool_calls.map((call) => ({ name: call.tool_name, status: call.status }))
  };
});

await step("AskMaple streams a real LLM answer over the ask session", async () => {
  // The turn is async now: POST returns 202 with the ask session id, then the real LLM answer
  // streams over that session's SSE / event log (no synchronous template string).
  const askStartedAt = Date.now();
  const asked = await request(`/v1/ask_maple/sessions/${session.id}/message`, {
    method: "POST",
    body: JSON.stringify({ question: "解释这个 session 的上下文和工具调用" })
  });
  const ackMs = Date.now() - askStartedAt;
  if (ackMs > 15_000) throw new Error(`ask_maple /message blocked for ${ackMs}ms — expected async 202 ack`);
  if (!asked.ask_session_id) throw new Error(`ask_maple ack missing ask_session_id: ${JSON.stringify(asked)}`);
  if (asked.ask_session?.metadata?.purpose !== "maple_session_assistant") {
    throw new Error(`AskMaple hidden session missing purpose: ${JSON.stringify(asked.ask_session)}`);
  }
  if (Number(asked.stats?.tool_calls ?? 0) < 1) throw new Error(`AskMaple did not see tool calls: ${JSON.stringify(asked.stats)}`);
  const askSessionId = asked.ask_session_id;
  const askDetail = await poll(async () => {
    const value = await request(`/v1/sessions/${askSessionId}/detail`);
    const settled = ["idle", "failed"].includes(String(value.session?.status ?? ""));
    return settled ? value : null;
  }, askMapleTimeoutMs, "ask maple turn settles");
  if (String(askDetail.session?.status) === "failed") {
    throw new Error(`AskMaple turn failed: ${JSON.stringify(askDetail.events?.find((event) => event.type === "session.status_failed")?.payload)}`);
  }
  const answerEvent = askDetail.events?.find((event) => event.type === "agent.message");
  const answerText = answerEvent?.payload?.content?.[0]?.text ?? answerEvent?.content?.[0]?.text ?? "";
  if (!answerText.trim()) throw new Error(`AskMaple produced no answer message: ${JSON.stringify(askDetail.events?.map((event) => event.type))}`);
  const visibleSessions = await request("/v1/sessions");
  if (visibleSessions.data?.some((item) => item.id === askSessionId)) {
    throw new Error(`AskMaple hidden session leaked into normal session list: ${askSessionId}`);
  }
  return { ask_session: askSessionId, answer_prefix: answerText.slice(0, 120), tool_calls: asked.stats.tool_calls };
});

await step("Session workspace file is real on host", async () => {
  if (cloudTarget) {
    const sessionArtifacts = await request(`/v1/sessions/${session.id}/artifacts`);
    if (!sessionArtifacts.data?.some((item) => item.path === filePath)) {
      throw new Error(`artifact missing from cloud session list: ${JSON.stringify(sessionArtifacts.data)}`);
    }
    const download = await requestRaw(`/v1/sessions/${session.id}/artifacts/${filePath.split("/").map(encodeURIComponent).join("/")}/download`);
    const content = await download.text();
    if (!download.ok || content.trimEnd() !== fileContent) throw new Error(`cloud artifact download failed ${download.status}: ${content}`);
    return { target: "cloud:session-artifact", content };
  }
  const target = join(e2eDataDir, "sessions", session.id, filePath);
  if (!existsSync(target)) throw new Error(`file not found: ${target}`);
  const content = readFileSync(target, "utf8");
  if (!content.trimEnd().startsWith(fileContent)) throw new Error(`unexpected file content: ${content}`);
  return { target, content };
});

await step("Artifact API lists and downloads session output", async () => {
  const allArtifacts = await request("/v1/artifacts");
  if (!allArtifacts.data?.some((item) => item.session_id === session.id && item.path === filePath)) {
    throw new Error(`artifact missing from global list: ${JSON.stringify(allArtifacts.data?.slice(0, 5))}`);
  }
  const sessionArtifacts = await request(`/v1/sessions/${session.id}/artifacts`);
  if (!sessionArtifacts.data?.some((item) => item.path === filePath)) {
    throw new Error(`artifact missing from session list: ${JSON.stringify(sessionArtifacts.data)}`);
  }
  const download = await requestRaw(`/v1/sessions/${session.id}/artifacts/${filePath.split("/").map(encodeURIComponent).join("/")}/download`);
  const content = await download.text();
  if (!download.ok || content.trimEnd() !== fileContent) throw new Error(`download failed ${download.status}: ${content}`);
  return { artifact: filePath, bytes: content.length };
});

await step("React console customer UI walkthrough", async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 920 } });
  const [cookieName, cookieValue] = authCookie.split("=");
  if (cookieName !== "maple_session" || !cookieValue) throw new Error(`missing Playwright auth cookie: ${authCookie}`);
  await context.addCookies([
    {
      name: cookieName,
      value: cookieValue,
      url: webBase,
      httpOnly: true,
      secure: new URL(webBase).protocol === "https:",
      sameSite: "Lax"
    }
  ]);
  const page = await context.newPage();
  const auditDir = join(process.cwd(), "test-results", "local-docker-ui-audit");
  mkdirSync(auditDir, { recursive: true });
  const auditScreenshots = [];
  await page.addInitScript((cookie) => {
    document.cookie = `${cookie}; path=/; SameSite=Lax`;
    window.localStorage.setItem("cc_authed", "1");
    window.localStorage.setItem("maple.dev_login", "1");
  }, authCookie);
  const consoleIssues = [];
  const buttonAudit = [];
  await page.route("**/v1/**", (route) => {
    const headers = { ...route.request().headers(), authorization: `Bearer ${workspaceOnboarding.workspaceKey}` };
    route.continue({ headers });
  });
  page.on("console", (msg) => {
    if (["error", "warning"].includes(msg.type())) consoleIssues.push(`${msg.type()}: ${msg.text()}`);
  });
  const waitForBodyText = async (text, timeout = 20_000) => {
    try {
      await page.waitForFunction((expected) => document.body.innerText.includes(expected), text, { timeout });
    } catch (error) {
      const body = await page.locator("body").innerText().catch(() => "");
      throw new Error(`Timed out waiting for ${JSON.stringify(text)}. Body: ${body.slice(0, 1400)}`);
    }
  };
  const waitForAnyBodyText = async (texts, timeout = 20_000) => {
    try {
      await page.waitForFunction((expected) => expected.some((text) => document.body.innerText.includes(text)), texts, { timeout });
    } catch (error) {
      const body = await page.locator("body").innerText().catch(() => "");
      throw new Error(`Timed out waiting for one of ${JSON.stringify(texts)}. Body: ${body.slice(0, 1400)}`);
    }
  };
  const waitForExpectedText = (expected) => Array.isArray(expected) ? waitForAnyBodyText(expected) : waitForBodyText(expected);
  const waitForConsoleShell = async () => {
    try {
      await page.waitForSelector(".console-shell", { timeout: 60_000 });
    } catch (error) {
      const body = await page.locator("body").innerText().catch(() => "");
      throw new Error(`Console shell did not render: ${error instanceof Error ? error.message : String(error)}; body=${body.slice(0, 1400)}; console=${consoleIssues.join("; ")}`);
    }
  };
  const clickButtonText = async (label, expected, auditLabel = label) => {
    await page.getByRole("button", { name: new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) }).first().click();
    await waitForExpectedText(expected);
    buttonAudit.push(auditLabel);
  };
  const clickSidebarButtonText = async (label, expected, auditLabel = label) => {
    await page.locator(".console-sidebar").getByRole("button", { name: new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) }).first().click();
    await waitForExpectedText(expected);
    buttonAudit.push(auditLabel);
  };
  const screenshotAudit = async (name) => {
    const path = join(auditDir, `${name}.png`);
    await page.screenshot({ path, fullPage: false });
    auditScreenshots.push(path);
    return path;
  };
  const drawerText = async (selector) => page.locator(selector).innerText({ timeout: 10_000 });
  const waitForDrawerSettled = async (selector) => {
    try {
      await page.waitForFunction((target) => {
        const element = document.querySelector(target);
        const text = element?.innerText || "";
        return Boolean(element) && !text.includes("加载中") && !text.includes("Loading");
      }, selector, { timeout: 20_000 });
    } catch (error) {
      const body = await page.locator(selector).innerText().catch(() => "");
      throw new Error(`Timed out waiting for ${selector} to finish loading: ${body.slice(0, 1400)}`);
    }
  };
  const poolDrawerHasMembers = (text) => !text.includes("当前筛选下没有成员") && !text.includes("No members match this filter");
  const expectTextIncludes = (label, text, required) => {
    const missing = required.filter((item) => !text.includes(item));
    if (missing.length) throw new Error(`${label} missing text: ${missing.join(", ")}; body=${text.slice(0, 1600)}`);
  };
  const expectTextExcludes = (label, text, forbidden) => {
    const present = forbidden.filter((item) => text.includes(item));
    if (present.length) throw new Error(`${label} leaked cloud/local-wrong text: ${present.join(", ")}; body=${text.slice(0, 1600)}`);
  };
  const openWorkspaceSettings = async () => {
    await page.locator(".ws-settings").first().click();
    await page.locator(".settings-drawer").waitFor({ state: "visible", timeout: 10_000 });
    await waitForAnyBodyText(["工作区设置", "Workspace settings"]);
    buttonAudit.push("workspace-settings:open");
  };
  const clickSettingsTab = async (label, expected, auditLabel) => {
    await page.locator(".settings-drawer .settings-seg").getByRole("button", { name: label }).click();
    await waitForExpectedText(expected);
    buttonAudit.push(auditLabel);
  };
  try {
    await page.goto(`${webBase}/?dev_login=1`, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.evaluate((cookie) => {
      document.cookie = `${cookie}; path=/; SameSite=Lax`;
    }, authCookie);
    const bootstrapProbe = await page.evaluate(async () => {
      const response = await fetch("/v1/auth/bootstrap", { credentials: "include" });
      return { status: response.status, text: await response.text() };
    });
    if (bootstrapProbe.status !== 200 || bootstrapProbe.text.includes("\"user\":null")) {
      throw new Error(`browser bootstrap probe failed: ${JSON.stringify(bootstrapProbe)}`);
    }
    await page.reload({ waitUntil: "domcontentloaded" });
    await waitForConsoleShell();
    await waitForBodyText("仪表盘");
    await waitForBodyText(agent.name);
    buttonAudit.push("dashboard:real-data");

    await openWorkspaceSettings();
    let settingsText = await drawerText(".settings-drawer");
    expectTextIncludes("settings overview", settingsText, [onboardingRuntimeLabel, onboardingSandboxLabel, workspaceOnboarding.workspaceRecord.name]);
    if (onboardingRuntimeProvider === "local_docker") expectTextExcludes("settings overview", settingsText, ["VeFaaS Runtime", "E2B_API_KEY"]);
    else expectTextExcludes("settings overview", settingsText, ["Local Docker Runtime", "DOCKER_SOCKET", "PREWARMED_MEMBERS"]);
    await screenshotAudit("settings-overview");

    await clickSettingsTab(/运行时配置|Runtime/, onboardingRuntimeCardTitle, "workspace-settings:runtime");
    await waitForAnyBodyText(onboardingRuntimeProvider === "local_docker" ? ["预热 Runtime", "Prewarmed runtimes"] : ["函数容量", "Functions", "QPS"]);
    settingsText = await drawerText(".settings-drawer");
    if (onboardingRuntimeProvider === "local_docker") {
      expectTextIncludes("settings runtime", settingsText, ["Local Docker Runtime", "DOCKER_SOCKET", "IMAGE", "PREWARMED_MEMBERS", "Image", "/workspace"]);
      expectTextExcludes("settings runtime", settingsText, ["VeFaaS Runtime", "cloud_function_id", "CPU Milli", "QPS"]);
    } else {
      expectTextIncludes("settings runtime", settingsText, ["VeFaaS Runtime", "VOLCENGINE_ACCESS_KEY", "VOLCENGINE_SECRET_KEY", "QPS"]);
      expectTextExcludes("settings runtime", settingsText, ["Local Docker Runtime", "DOCKER_SOCKET", "PREWARMED_MEMBERS"]);
    }
    await screenshotAudit("settings-runtime");

    await page.locator(".settings-drawer .provider-detail-btn").first().click();
    await page.locator(".pool-detail-drawer").waitFor({ state: "visible", timeout: 10_000 });
    await waitForAnyBodyText(
      onboardingRuntimeProvider === "local_docker"
        ? ["Local Docker runtime member 状态", "Local Docker runtime member status"]
        : ["VeFaaS runtime pool member 状态", "VeFaaS runtime pool member status"]
    );
    await waitForDrawerSettled(".pool-detail-drawer");
    let poolText = await drawerText(".pool-detail-drawer");
    if (onboardingRuntimeProvider === "local_docker") {
      if (poolDrawerHasMembers(poolText)) expectTextIncludes("runtime pool drawer", poolText, ["local_docker", "image", "/workspace", "活跃会话"]);
      expectTextExcludes("runtime pool drawer", poolText, ["cloud_function_id", "invoke_url", "VeFaaS function", "managed-agents-platform-vefaas"]);
    } else {
      if (poolDrawerHasMembers(poolText)) expectTextIncludes("runtime pool drawer", poolText, ["cloud_function_id", "invoke_url", "VeFaaS function"]);
      expectTextExcludes("runtime pool drawer", poolText, ["local_docker", "container_name"]);
    }
    await screenshotAudit("runtime-pool-drawer");
    buttonAudit.push("workspace-settings:runtime-pool-drawer");
    await page.locator(".pool-detail-drawer .x").click();
    await page.locator(".pool-detail-drawer").waitFor({ state: "detached", timeout: 5_000 });

    await clickSettingsTab(/沙箱配置|Providers/, onboardingSandboxCardTitle, "workspace-settings:providers");
    settingsText = await drawerText(".settings-drawer");
    if (onboardingSandboxProvider === "local_docker") {
      expectTextIncludes("settings sandbox", settingsText, ["Local Docker Sandbox", "DOCKER_SOCKET", "IMAGE", "NETWORKING", "Local Docker"]);
      expectTextExcludes("settings sandbox", settingsText, ["E2B_API_KEY", "VEFAAS_SANDBOX_FUNCTION_ID", "gateway_url"]);
    } else if (onboardingSandboxProvider === "e2b") {
      expectTextIncludes("settings sandbox", settingsText, ["E2B", "E2B_API_KEY"]);
      expectTextExcludes("settings sandbox", settingsText, ["Local Docker Sandbox", "DOCKER_SOCKET", "VEFAAS_SANDBOX_FUNCTION_ID"]);
    } else {
      expectTextIncludes("settings sandbox", settingsText, [onboardingSandboxCardTitle]);
      expectTextExcludes("settings sandbox", settingsText, ["Local Docker Sandbox", "DOCKER_SOCKET"]);
    }
    await screenshotAudit("settings-sandbox");

    await page.locator(".settings-drawer .provider-detail-btn").first().click();
    await page.locator(".pool-detail-drawer").waitFor({ state: "visible", timeout: 10_000 });
    await waitForAnyBodyText(
      onboardingSandboxProvider === "local_docker"
        ? ["Local Docker standby / claimed / failed", "Local Docker standby / claimed / failed member status"]
        : ["standby / claimed / failed 沙箱状态", "standby / claimed / failed sandbox status"]
    );
    await waitForDrawerSettled(".pool-detail-drawer");
    poolText = await drawerText(".pool-detail-drawer");
    if (onboardingSandboxProvider === "local_docker") {
      if (poolDrawerHasMembers(poolText)) expectTextIncludes("sandbox pool drawer", poolText, ["docker_member_id", "image", "container_name"]);
      expectTextExcludes("sandbox pool drawer", poolText, ["E2B_API_KEY", "function_id", "gateway_url"]);
    } else {
      if (poolDrawerHasMembers(poolText)) expectTextIncludes("sandbox pool drawer", poolText, ["sandbox_id", "claimed_session_id"]);
      expectTextExcludes("sandbox pool drawer", poolText, ["docker_member_id", "container_name"]);
    }
    await screenshotAudit("sandbox-pool-drawer");
    buttonAudit.push("workspace-settings:sandbox-pool-drawer");
    await page.locator(".pool-detail-drawer .x").click();
    await page.locator(".pool-detail-drawer").waitFor({ state: "detached", timeout: 5_000 });

    await clickSettingsTab(/模型管理|Model pool/, modelConfig.name, "workspace-settings:models");
    settingsText = await drawerText(".settings-drawer");
    expectTextIncludes("settings models", settingsText, [modelConfig.name, modelConfig.model_name]);
    if (!useE2BSandbox) expectTextExcludes("settings models", settingsText, ["VolcoEngine", "doubao"]);
    await screenshotAudit("settings-models");

    await clickSettingsTab(/用户管理|Users/, testSession.user.email, "workspace-settings:members");
    settingsText = await drawerText(".settings-drawer");
    expectTextIncludes("settings members", settingsText, [testSession.user.email]);
    await screenshotAudit("settings-members");

    await clickSettingsTab(/秘钥管理|API keys/, ["工作区 API 秘钥", "Workspace API keys"], "workspace-settings:keys");
    await page.locator(".settings-drawer .key-create-row input").fill(`E2E Settings Key ${stamp}`);
    await page.locator(".settings-drawer .key-create-row").getByRole("button", { name: /创建 Key|Create key/ }).click();
    await page.waitForFunction((expected) => document.body.innerText.includes(expected), `E2E Settings Key ${stamp}`, { timeout: 40_000 });
    settingsText = await drawerText(".settings-drawer");
    expectTextIncludes("settings keys", settingsText, [`E2E Settings Key ${stamp}`, "maple_ws_"]);
    await screenshotAudit("settings-keys");
    buttonAudit.push("workspace-settings:create-key");
    await page.locator(".settings-drawer .x").click();
    await page.locator(".settings-drawer").waitFor({ state: "detached", timeout: 5_000 });

    await clickButtonText("构建智能体", "浏览模板", "quickstart:open-from-dashboard");
    const expectedTemplates = [
      ["Data insights analyst", "数据洞察分析师"],
      ["Customer knowledge assistant", "客户知识助手"],
      ["Market monitoring brief", "市场监测简报"],
      ["Incident response commander", "应急响应指挥官"],
      ["Compliance audit investigator", "合规审计调查员"],
      ["Developer productivity assistant", "研发效率助手"],
      ["Growth experiment designer", "增长实验设计师"],
      ["Finance reconciliation bot", "财务对账机器人"]
    ];
    for (const [templateName, localizedName] of expectedTemplates) {
      await waitForAnyBodyText([templateName, localizedName]);
      buttonAudit.push(`template-visible:${templateName}`);
    }
    await page.getByText(/Customer knowledge assistant|客户知识助手/).first().click();
    await page.waitForTimeout(120);
    buttonAudit.push("template:Customer knowledge assistant");

    const uiDeployment = await request("/v1/deployments", {
      method: "POST",
      body: JSON.stringify({
        workspace_id: workspaceOnboarding.workspace,
        agent_id: agent.id,
        environment_id: e2bEnvironment.id,
        name: `e2e-ui-deployment-${stamp}`,
        version: "1",
        initial_events: [
          { type: "user.message", payload: { content: [{ type: "text", text: `deployment UI smoke ${stamp}` }] } }
        ]
      })
    });

    await clickSidebarButtonText("智能体", agent.name, "nav:agents");
    await clickSidebarButtonText("会话", "会话", "nav:sessions");
    if ((await page.getByText(session.title).count()) > 0) {
      await page.locator(".session-pill-main").filter({ hasText: session.title }).first().click();
      await waitForAnyBodyText(["Transcript", "对话"]);
      await waitForAnyBodyText(["Debug", "调试"]);
      buttonAudit.push("sessions:detail");
      await page.waitForFunction(() => {
        const button = [...document.querySelectorAll("button")].find((item) => item.textContent?.includes("Ask Maple"));
        return Boolean(button && !button.disabled);
      }, null, { timeout: 20_000 });
      await page.getByRole("button", { name: /Ask Maple/ }).first().click();
      await page.locator(".ask-drawer input").fill("解释这个 session 的上下文和工具调用");
      await page.locator(".ask-drawer").getByRole("button", { name: /Ask Maple/ }).click();
      // The answer is a real LLM stream now (no fixed string); assert the conversation renders —
      // the question lands as a user bubble and Maple replies in the transcript.
      await page.locator(".ask-transcript .ask-user").waitFor({ state: "visible", timeout: 20_000 });
      await page.locator(".ask-transcript .ask-agent").waitFor({ state: "visible", timeout: askMapleTimeoutMs });
      buttonAudit.push("sessions:ask-maple");
      await page.keyboard.press("Escape");
      await page.locator(".ask-drawer").waitFor({ state: "detached", timeout: 5_000 });
    } else {
      buttonAudit.push("sessions:list-visible");
    }

    await clickSidebarButtonText("环境", e2bEnvironment.created ?? e2bEnvironment.default, "nav:environments");
    await clickSidebarButtonText("凭证库", vault.display_name, "nav:vaults");
    await clickSidebarButtonText("租户", testSession.user.email, "nav:tenant");
    await clickSidebarButtonText("模型", modelConfig.name, "nav:models");
    await clickSidebarButtonText("秘钥", "API Keys", "nav:api-keys");
    await page.getByRole("button", { name: /^(Create key|创建 Key|创建 key)$/ }).first().click();
    const createKeyDialog = page.locator("[role='dialog']").filter({ hasText: /创建 API Key|Create API key/ });
    await createKeyDialog.waitFor({ state: "visible", timeout: 5_000 });
    await createKeyDialog.getByRole("button", { name: /^(Create key|创建 Key|创建 key)$/ }).click();
    await page.waitForFunction(
      () => ["Workspace API key issued", "Workspace API key 已创建", "完整 Workspace API key 已创建"].some((text) => document.body.innerText.includes(text)),
      null,
      { timeout: 40_000 }
    ).catch(async (error) => {
      throw new Error(`API key success message missing: ${error.message}; body=${(await page.locator("body").innerText()).slice(0, 1200)}`);
    });
    buttonAudit.push("api-keys:create-workspace-key");

    await clickSidebarButtonText("文档", "OpenMaple API", "nav:docs");
    await page.waitForSelector(".docs-shell .doc-nav", { timeout: 10_000 });
    await page.waitForSelector(".docs-shell .doc-main", { timeout: 10_000 });
    await page.waitForSelector(".docs-shell .doc-toc", { timeout: 10_000 });
    const docsText = await page.locator(".docs-shell").innerText();
    if (!docsText.includes("基础 URL 与版本") || !docsText.includes("资源关系") || !docsText.includes("本页目录")) {
      throw new Error("React documentation three-pane content is incomplete");
    }
    buttonAudit.push("docs:three-pane");

    await clickSidebarButtonText("部署", uiDeployment.name, "nav:deployments");
    const desktopScreenshot = `/tmp/managed-agents-e2e-${stamp}.png`;
    await page.screenshot({ path: desktopScreenshot, fullPage: false });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload({ waitUntil: "domcontentloaded" });
    await waitForConsoleShell();
    if ((await page.getByText("你想构建什么？").count()) === 0) {
      await page.getByRole("button", { name: /快速开始/ }).first().click();
    }
    await waitForBodyText("你想构建什么？");
    const mobileHasHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    if (mobileHasHorizontalOverflow) throw new Error("mobile quickstart has horizontal overflow");
    const mobileScreenshot = `/tmp/managed-agents-e2e-mobile-${stamp}.png`;
    await page.screenshot({ path: mobileScreenshot, fullPage: false });
    if (consoleIssues.length > 0) throw new Error(`console issues: ${consoleIssues.join("; ")}`);
    return { screenshots: [...auditScreenshots, desktopScreenshot, mobileScreenshot], navChecks: 10, buttonAudit };
  } finally {
    await browser.close();
  }
});

console.log(JSON.stringify({ ok: true, stamp, session_id: session.id, checks: results }, null, 2));
}

try {
  await main();
} finally {
  let cleanupError;
  try {
    await cleanupTrackedE2BSandboxes();
  } catch (error) {
    cleanupError = error;
  }
  await cleanupSpawnedProcesses();
  try {
    cleanupE2ERecords();
  } catch (error) {
    console.error("[E2E cleanup] failed:", error instanceof Error ? error.message : String(error));
  }
  if (cleanupError) throw cleanupError;
}

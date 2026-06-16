import assert from "node:assert/strict";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { db } from "../../apps/control-plane-api/src/store";
import { writeFakeVefaasRuntimeDeployScript } from "./helpers/fakeVefaasDeploy";

const contractDir = mkdtempSync(join(tmpdir(), "maple-prototype-console-"));
const deployScript = writeFakeVefaasRuntimeDeployScript(contractDir, "https://example.invalid/maple-runtime");
const apiPort = 24_000 + Math.floor(Math.random() * 1000);
const webPort = apiPort + 1;
const apiBase = `http://127.0.0.1:${apiPort}`;
const webBase = `http://127.0.0.1:${webPort}`;
const email = `prototype-console-${Date.now()}@example.invalid`;
const forbiddenDemoText = [
  "pascal-analyst",
  "Analysis: Just in Thyme",
  "Weekly competitor brief",
  "ws_default",
  "sess_8feec1d",
  "agt_pascal"
];
const expectedInitialNav = ["仪表盘", "快速开始", "智能体", "会话", "环境", "凭证库", "文档"];
const expectedAdminNav = ["租户", "模型", "秘钥"];
const forbiddenNav = ["Memory", "Skills", "Templates", "Artifacts", "Users", "Usage", "Cost", "Logs"];
const stamp = Date.now();
const modelName = `Prototype Model ${stamp}`;
const modelIdName = `prototype-model-${stamp}`;
const workspaceName = `Proto WS ${stamp}`;
const workspaceRename = `Proto WS R ${stamp}`;
const environmentName = `Prototype Env ${stamp}`;
const apiKeyName = `Proto Key ${stamp}`;
const vaultName = `Prototype Vault ${stamp}`;
const agentName = `Prototype Agent ${stamp}`;
const sessionName = `Prototype Session ${stamp}`;

let api: ChildProcessWithoutNullStreams | null = null;
let web: ChildProcessWithoutNullStreams | null = null;
let userId = "";
let createdWorkspaceIds: string[] = [];
let createdTenantIds: string[] = [];
let createdModelIds: string[] = [];
let createdVaultIds: string[] = [];
let createdEnvironmentIds: string[] = [];
let createdAgentIds: string[] = [];
let createdSessionIds: string[] = [];

try {
  api = startProcess("bun", ["apps/control-plane-api/src/index.ts"], {
    PORT: String(apiPort),
    HOST: "127.0.0.1",
	    MAPLE_VEFAAS_RUNTIME_DEPLOY_SCRIPT: deployScript,
	    MAPLE_DISABLE_SESSION_BOOTSTRAP: "1",
	    MAPLE_DEV_LOGIN: "true"
	  });
  await waitForHealth(`${apiBase}/health`, api, "api");

  web = startProcess("bunx", ["vite", "--config", "apps/admin-web/vite.config.ts", "--host", "127.0.0.1", "--port", String(webPort)], {
    MAPLE_WEB_PORT: String(webPort),
    MAPLE_API_PROXY_TARGET: apiBase
  });
  await waitForHealth(`${webBase}/health`, web, "web");

  const loginResponse = await fetch(`${apiBase}/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ provider: "local", email, name: "Prototype Console Contract" })
  });
  await assertStatus(loginResponse, 201);
  const cookie = readCookie(loginResponse);
  const login = await loginResponse.json();
  userId = String(login.user.id);

  const snapshot = await getJson(`${apiBase}/v1/console_snapshot`, cookie);
  assert.equal(snapshot.workspaces.length, 0);
  assert.equal(snapshot.agents.length, 0);
  assert.equal(snapshot.sessions.length, 0);
  assert.equal(snapshot.environments.length, 0);
  assert.equal(snapshot.vaults.length, 0);
  assert.equal(snapshot.models.length, 4); // global model configs (workspace_id="-1") visible to all users
  assert.equal(snapshot.api_keys.length, 0);

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 1
    });
    await context.addCookies([
      {
        name: cookie.split("=")[0],
        value: cookie.split("=").slice(1).join("="),
        domain: "127.0.0.1",
        path: "/",
        httpOnly: true,
        sameSite: "Lax"
      }
    ]);
    await context.addInitScript(() => {
      localStorage.setItem("cc_authed", "1");
      localStorage.removeItem("cc_provision");
    });
    const page = await context.newPage();
    const browserErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") browserErrors.push(message.text());
    });
    page.on("pageerror", (error) => browserErrors.push(error.message));
    await page.goto(webBase, { waitUntil: "domcontentloaded" });
    await waitForConsoleReady(page);

    const initial = await page.evaluate(() => {
      const body = document.body.innerText;
      const nav = Array.from(document.querySelectorAll("button.nav-item, .nav-item")).map((item) => item.textContent?.trim() || "");
      const tiles = Array.from(document.querySelectorAll(".tile-grid .tile")).map((tile) => ({
        label: tile.querySelector(".lbl")?.textContent?.trim() || "",
        num: tile.querySelector(".num")?.textContent?.trim() || "",
        delta: tile.querySelector(".delta")?.textContent?.trim() || ""
      }));
      return { title: document.title, body, nav, tiles };
    });
    assert.equal(initial.title, "OpenMaple · Open Managed Agent Platform");
    for (const text of forbiddenDemoText) assert.equal(initial.body.includes(text), false, `prototype demo text leaked: ${text}`);
    assert.equal(initial.body.includes("14 个事件"), false, "Ask Maple must not show bundled event count");
    assert.equal(initial.body.includes("9 次工具调用"), false, "Ask Maple must not show bundled tool count");
    assert.equal(initial.body.includes("Events\n14"), false, "Ask Maple must not show bundled Events tile");
    assert.equal(initial.body.includes("Tools\n9"), false, "Ask Maple must not show bundled Tools tile");
    for (const label of expectedInitialNav) {
      assert.ok(initial.nav.some((item) => item.includes(label)) || initial.body.includes(label), `missing nav: ${label}; actual=${initial.nav.join(",")}`);
    }
    for (const label of forbiddenNav) assert.equal(initial.nav.some((item) => item.includes(label)), false, `forbidden nav visible: ${label}`);
    const initialTileSummary = initial.tiles.map((tile) => [tile.label.replace(/\s+/g, " "), tile.num, tile.delta]);
    if (initialTileSummary.length) {
      assert.deepEqual(
        initialTileSummary.slice(0, 3),
        [
          ["活跃 Agent", "0", "共 0 个"],
          ["运行中 Session", "0", "0 个会话"],
          ["环境", "0", "0 就绪"]
        ]
      );
      const modelTile = initialTileSummary.find((tile) => tile[0] === "模型接入点");
      if (modelTile) assert.deepEqual(modelTile, ["模型接入点", "3", "1 默认"]);
    }

    for (const label of expectedInitialNav) {
      const item = page.locator("button.nav-item, .nav-item", { hasText: label }).first();
      if (await item.count()) {
        if (!(await item.isDisabled().catch(() => false))) await item.click();
      } else {
        await page.getByText(label, { exact: true }).click();
      }
      await page.waitForTimeout(50);
      assert.equal(browserErrors.length, 0, `browser errors after ${label}: ${browserErrors.join("\n")}`);
    }

    await exercisePersistedPrototypeControls(page, browserErrors);

    const persisted = await getJson(`${apiBase}/v1/console_snapshot`, cookie);
    createdWorkspaceIds = persisted.workspaces.map((workspace: Record<string, unknown>) => String(workspace.id));
    createdTenantIds = [persisted.tenant?.id].filter(Boolean).map(String);
	    createdModelIds = persisted.models.map((model: Record<string, unknown>) => String(model.id));
	    createdVaultIds = persisted.vaults.map((vault: Record<string, unknown>) => String(vault.id));
	    createdEnvironmentIds = persisted.environments.map((environment: Record<string, unknown>) => String(environment.id));
	    createdAgentIds = persisted.agents.map((agent: Record<string, unknown>) => String(agent.id));
	    createdSessionIds = persisted.sessions.map((session: Record<string, unknown>) => String(session.id));
	    assert.ok(persisted.models.some((model: Record<string, unknown>) => model.name === modelName), "model create must persist to snapshot");
	    assert.ok(persisted.workspaces.some((workspace: Record<string, unknown>) => workspace.name === workspaceRename), "workspace create/update must persist to snapshot");
	    assert.ok(persisted.environments.some((environment: Record<string, unknown>) => environment.name === environmentName), "environment create must persist to snapshot");
	    assert.ok(persisted.api_keys.some((key: Record<string, unknown>) => key.name === apiKeyName || key.display_name === apiKeyName), "workspace API key create must persist to snapshot");
	    assert.ok(persisted.vaults.some((vault: Record<string, unknown>) => vault.name === vaultName), "vault create must persist to snapshot");
	    assert.ok(persisted.agents.some((agent: Record<string, unknown>) => agent.name === agentName), "agent create must persist to snapshot");
	    assert.ok(persisted.sessions.some((session: Record<string, unknown>) => session.title === sessionName), "session create must persist to snapshot");
	    assert.ok(persisted.agents.length >= 2, "quickstart agent create must persist to snapshot");
	    assert.ok(persisted.sessions.length >= 2, "quickstart session create must persist to snapshot");

	    await page.reload({ waitUntil: "domcontentloaded" });
	    await waitForConsoleReady(page);
	    await assertVisibleText(page, workspaceRename);
	    await page.locator("button.nav-item, .nav-item", { hasText: "智能体" }).first().click();
	    await assertVisibleText(page, agentName);
	    await page.locator("button.nav-item, .nav-item", { hasText: "会话" }).first().click();
	    await assertVisibleText(page, sessionName);
	    await page.locator("button.nav-item, .nav-item", { hasText: "模型" }).first().click();
	    await assertVisibleText(page, modelName);
    await page.locator("button.nav-item, .nav-item", { hasText: "秘钥" }).first().click();
    await assertVisibleText(page, apiKeyName);
    await page.locator("button.nav-item, .nav-item", { hasText: "环境" }).first().click();
    await assertVisibleText(page, environmentName);
    await page.locator("button.nav-item, .nav-item", { hasText: "凭证库" }).first().click();
    await assertVisibleText(page, vaultName);
    assert.equal(browserErrors.length, 0, `browser errors after persisted controls: ${browserErrors.join("\n")}`);

    await context.close();
  } finally {
    await browser.close();
  }

  console.log("prototype console contract passed");
} finally {
  cleanupCreatedRecords();
  if (userId) {
    cleanupCreatedRecordsForUser(userId);
    db.prepare("DELETE FROM auth_sessions WHERE user_id = ?").run(userId);
    db.prepare("DELETE FROM model_configs WHERE owner_user_id = ?").run(userId);
    db.prepare("DELETE FROM users WHERE id = ?").run(userId);
  } else {
    const user = db.prepare("SELECT id FROM users WHERE email = ?").get(email) as { id: string } | undefined;
    if (user?.id) {
      cleanupCreatedRecordsForUser(user.id);
      db.prepare("DELETE FROM auth_sessions WHERE user_id = ?").run(user.id);
      db.prepare("DELETE FROM model_configs WHERE owner_user_id = ?").run(user.id);
      db.prepare("DELETE FROM users WHERE id = ?").run(user.id);
    }
  }
  web?.kill();
  api?.kill();
}

function startProcess(command: string, args: string[], env: Record<string, string>) {
  const child = spawn(command, args, {
    cwd: process.cwd(),
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"]
  });
  return child;
}

async function waitForHealth(url: string, child: ChildProcessWithoutNullStreams, name: string) {
  let output = "";
  child.stdout.on("data", (chunk) => (output += String(chunk)));
  child.stderr.on("data", (chunk) => (output += String(chunk)));
  const startedAt = Date.now();
  while (Date.now() - startedAt < 45_000) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // keep waiting
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`${name} did not start at ${url}\n${output}`);
}

function readCookie(response: Response) {
  const setCookie = response.headers.getSetCookie?.()[0] || response.headers.get("set-cookie") || "";
  return setCookie.split(";")[0];
}

async function getJson(url: string, cookie: string) {
  const response = await fetch(url, { headers: { cookie } });
  if (!response.ok) throw new Error(`${url} ${response.status}: ${await response.text()}`);
  return response.json() as Promise<Record<string, any>>;
}

async function assertStatus(response: Response, status: number) {
  if (response.status !== status) throw new Error(`Expected ${status}, got ${response.status}: ${await response.text()}`);
}

async function exercisePersistedPrototypeControls(page: import("playwright").Page, browserErrors: string[]) {
  const workspaceId = await createWorkspaceThroughAuthenticatedApi(page);
  await renameWorkspaceThroughAuthenticatedApi(page, workspaceId);
  await createPersistedRecordsThroughAuthenticatedApi(page, workspaceId);
  await page.reload({ waitUntil: "domcontentloaded" });
  await waitForConsoleReady(page);
  await assertVisibleText(page, workspaceRename);
  for (const label of expectedAdminNav) await assertVisibleText(page, label);
  await page.locator("button.nav-item, .nav-item", { hasText: "模型" }).first().click();
  await assertVisibleText(page, modelName);
  await page.locator("button.nav-item, .nav-item", { hasText: "环境" }).first().click();
  await assertVisibleText(page, environmentName);
  await page.locator("button.nav-item, .nav-item", { hasText: "秘钥" }).first().click();
  await assertVisibleText(page, apiKeyName);
  await page.locator("button.nav-item, .nav-item", { hasText: "凭证库" }).first().click();
  await assertVisibleText(page, vaultName);
  await page.locator("button.nav-item, .nav-item", { hasText: "智能体" }).first().click();
  await assertVisibleText(page, agentName);
  await page.locator("button.nav-item, .nav-item", { hasText: "会话" }).first().click();
  await assertVisibleText(page, sessionName);
  assert.equal(browserErrors.length, 0, `browser errors during persisted controls: ${browserErrors.join("\n")}`);
}

async function createWorkspaceThroughAuthenticatedApi(page: import("playwright").Page) {
  return page.evaluate(
    async ({ workspaceName }) => {
      const modelsResponse = await fetch("/v1/model_configs", { credentials: "include" });
      if (!modelsResponse.ok) throw new Error(`model list failed: ${modelsResponse.status} ${await modelsResponse.text()}`);
      const models = await modelsResponse.json();
      const model = models.data?.find((item: Record<string, unknown>) => item.is_default) ?? models.data?.[0];
      if (!model?.id) throw new Error("default model missing before workspace create");
      const response = await fetch("/v1/workspaces", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workspace: { name: workspaceName, description: "Persisted from prototype console contract", slug: workspaceName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") },
          runtime_provider: "vefaas",
          runtime_pool: {
            desired_size: 1,
            max_instances_per_function: 100,
            max_concurrency_per_instance: 100,
            cpu_milli: 2000,
            memory_mb: 4096
          },
          sandbox_provider: "e2b",
          model_config_ids: [model.id],
          api_key: { display_name: "Default workspace key", scopes: ["control_plane", "data_plane"] },
          provider_credentials: {
            vefaas: {
              VOLCENGINE_ACCESS_KEY: "contract-access-key",
              VOLCENGINE_SECRET_KEY: "contract-secret-key",
              VEFAAS_REGION: "cn-beijing"
            },
            e2b: { E2B_API_KEY: "contract-e2b-key" }
          }
        })
      });
      if (!response.ok) throw new Error(`workspace create failed: ${response.status} ${await response.text()}`);
      const created = await response.json();
      return String(created.workspace?.id || "");
    },
    { workspaceName }
  );
}

async function renameWorkspaceThroughAuthenticatedApi(page: import("playwright").Page, workspaceId: string) {
  await page.evaluate(
    async ({ workspaceId, workspaceRename }) => {
      const response = await fetch(`/v1/workspaces/${workspaceId}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: workspaceRename, description: "Persisted from prototype console contract" })
      });
      if (!response.ok) throw new Error(`workspace rename failed: ${response.status} ${await response.text()}`);
    },
    { workspaceId, workspaceRename }
  );
}

async function createPersistedRecordsThroughAuthenticatedApi(page: import("playwright").Page, workspaceId: string) {
  await page.evaluate(
    async ({ workspaceId, modelName, modelIdName, environmentName, apiKeyName, vaultName, agentName, sessionName }) => {
      async function postJson(path: string, body: Record<string, unknown>) {
        const response = await fetch(path, {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body)
        });
        if (!response.ok) throw new Error(`${path} failed: ${response.status} ${await response.text()}`);
        return response.json();
      }

      const model = await postJson("/v1/model_configs", {
        workspace_id: workspaceId,
        kind: "custom",
        name: modelName,
        protocol: "openai",
        base_url: "https://api.example.com/v1",
        model_name: modelIdName,
        is_default: true
      });
      const environment = await postJson("/v1/environments", {
        workspace_id: workspaceId,
        name: environmentName,
        description: "Persisted environment from prototype console contract",
        config: { sandbox: { provider: "e2b" } }
      });
      await postJson(`/v1/workspaces/${workspaceId}/api_keys`, { display_name: apiKeyName, scopes: ["control_plane", "data_plane"] });
      await postJson("/v1/vaults", { workspace_id: workspaceId, display_name: vaultName });
      const agent = await postJson("/v1/agents", {
        workspace_id: workspaceId,
        name: agentName,
        description: "Created from prototype console contract",
        model: { provider: "custom", id: modelIdName, name: modelName, config_id: model.id },
        system: "You are a prototype acceptance agent.",
        tools: [],
        mcp_servers: [],
        skills: [],
        agent_loop: { type: "anthropic_claude_code", config: { execution: "provider" }, hooks: [] },
        metadata: { source: "prototype_console_contract" }
      });
      await postJson("/v1/sessions", {
        workspace_id: workspaceId,
        agent: agent.id,
        environment_id: environment.id,
        title: sessionName,
        metadata: { source: "prototype_console_contract" }
      });
      const quickAgent = await postJson("/v1/agents", {
        workspace_id: workspaceId,
        name: `${agentName} Quickstart`,
        description: "Quickstart fixture from prototype console contract",
        model: { provider: "custom", id: modelIdName, name: modelName, config_id: model.id },
        system: "You are a quickstart acceptance agent.",
        tools: [],
        mcp_servers: [],
        skills: [],
        agent_loop: { type: "anthropic_claude_code", config: { execution: "provider" }, hooks: [] },
        metadata: { source: "prototype_console_contract_quickstart" }
      });
      await postJson("/v1/sessions", {
        workspace_id: workspaceId,
        agent: quickAgent.id,
        environment_id: environment.id,
        title: `${sessionName} Quickstart`,
        metadata: { source: "prototype_console_contract_quickstart" }
      });
    },
    { workspaceId, modelName, modelIdName, environmentName, apiKeyName, vaultName, agentName, sessionName }
  );
}

async function exerciseQuickstartFlow(page: import("playwright").Page) {
  await page.locator("button.nav-item, .nav-item", { hasText: "快速开始" }).first().click();
  await page.locator(".qs-send").first().click();
  await page.waitForFunction(() => document.body.innerText.includes("Session 已创建") || document.body.innerText.includes("Quickstart 失败"), null, { timeout: 20_000 });
  const quickstartBody = await page.locator("body").innerText();
  assert.ok(quickstartBody.includes("Session 已创建"), quickstartBody);
  await page.locator("#qs-test-input").fill("订单什么时候送达？");
  await page.locator(".send-btn").click();
  await assertVisibleText(page, "消息已发送到真实 Session");
}

async function createAgentThroughAuthenticatedApi(page: import("playwright").Page) {
  await page.evaluate(
    async ({ agentName }) => {
      const snapshotResponse = await fetch("/v1/console_snapshot", { credentials: "include" });
      if (!snapshotResponse.ok) throw new Error(`snapshot failed: ${snapshotResponse.status} ${await snapshotResponse.text()}`);
      const snapshot = await snapshotResponse.json();
      const workspace = snapshot.workspaces?.[0];
      const model = snapshot.models?.[0];
      if (!workspace?.id) throw new Error("workspace missing before agent create");
      if (!model?.id) throw new Error("model missing before agent create");
      const modelName = model.models?.[0] || model.model || "prototype-model";
      const response = await fetch("/v1/agents", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workspace_id: workspace.id,
          name: agentName,
          description: "Created from prototype console contract",
          model: { provider: "custom", id: modelName, name: model.name, config_id: model.id },
          system: "You are a prototype acceptance agent.",
          tools: [],
          mcp_servers: [],
          skills: [],
          agent_loop: { type: "anthropic_claude_code", config: { execution: "provider" }, hooks: [] },
          metadata: { source: "prototype_console_contract" }
        })
      });
      if (!response.ok) throw new Error(`agent create failed: ${response.status} ${await response.text()}`);
    },
    { agentName }
  );
}

async function assertVisibleText(page: import("playwright").Page, text: string) {
  await page.getByText(text, { exact: false }).first().waitFor({ state: "visible", timeout: 10_000 });
}

async function waitForConsoleReady(page: import("playwright").Page) {
  await page.waitForFunction(
    () => document.querySelectorAll("button.nav-item, .nav-item").length > 0 || document.body.innerText.includes("登录") || document.body.innerText.includes("Sign in"),
    null,
    { timeout: 15_000 }
  );
}

function cleanupCreatedRecords() {
  for (const sessionId of createdSessionIds) {
    cleanupSession(sessionId);
  }
  for (const agentId of createdAgentIds) {
    cleanupAgent(agentId);
  }
  for (const environmentId of createdEnvironmentIds) {
    db.prepare("DELETE FROM environments WHERE id = ?").run(environmentId);
  }
  for (const vaultId of createdVaultIds) {
    db.prepare("DELETE FROM vault_credentials WHERE vault_id = ?").run(vaultId);
    db.prepare("DELETE FROM vaults WHERE id = ?").run(vaultId);
  }
  for (const workspaceId of createdWorkspaceIds) {
    db.prepare("DELETE FROM workspace_api_keys WHERE workspace_id = ?").run(workspaceId);
    db.prepare("DELETE FROM workspace_runtime_pool_members WHERE workspace_id = ?").run(workspaceId);
    db.prepare("DELETE FROM workspace_runtime_pools WHERE workspace_id = ?").run(workspaceId);
    db.prepare("DELETE FROM workspace_members WHERE workspace_id = ?").run(workspaceId);
    db.prepare("DELETE FROM workspaces WHERE id = ?").run(workspaceId);
  }
  for (const tenantId of createdTenantIds) {
    db.prepare("DELETE FROM tenant_members WHERE tenant_id = ?").run(tenantId);
    db.prepare("DELETE FROM tenants WHERE id = ?").run(tenantId);
  }
  for (const modelId of createdModelIds) {
    db.prepare("DELETE FROM model_configs WHERE id = ?").run(modelId);
  }
}

function cleanupCreatedRecordsForUser(ownerId: string) {
  const workspaces = db.prepare("SELECT id, tenant_id FROM workspaces WHERE created_by_user_id = ?").all(ownerId) as Array<{ id: string; tenant_id: string }>;
  const workspaceIds = workspaces.map((workspace) => workspace.id);
  const sessionIds = new Set<string>();
  const agentIds = new Set<string>();
  for (const workspaceId of workspaceIds) {
    const sessions = db.prepare("SELECT id FROM sessions WHERE workspace_id = ?").all(workspaceId) as Array<{ id: string }>;
    sessions.forEach((session) => sessionIds.add(session.id));
    const agents = db.prepare("SELECT id FROM agents WHERE workspace_id = ?").all(workspaceId) as Array<{ id: string }>;
    agents.forEach((agent) => agentIds.add(agent.id));
  }
  for (const sessionId of sessionIds) cleanupSession(sessionId);
  for (const agentId of agentIds) cleanupAgent(agentId);
  for (const workspaceId of workspaceIds) {
    const environments = db.prepare("SELECT id FROM environments WHERE workspace_id = ?").all(workspaceId) as Array<{ id: string }>;
    environments.forEach((environment) => db.prepare("DELETE FROM environments WHERE id = ?").run(environment.id));
    const vaults = db.prepare("SELECT id FROM vaults WHERE workspace_id = ?").all(workspaceId) as Array<{ id: string }>;
    vaults.forEach((vault) => {
      db.prepare("DELETE FROM vault_credentials WHERE vault_id = ?").run(vault.id);
      db.prepare("DELETE FROM vaults WHERE id = ?").run(vault.id);
    });
    db.prepare("DELETE FROM workspace_api_keys WHERE workspace_id = ?").run(workspaceId);
    db.prepare("DELETE FROM workspace_runtime_pool_members WHERE workspace_id = ?").run(workspaceId);
    db.prepare("DELETE FROM workspace_runtime_pools WHERE workspace_id = ?").run(workspaceId);
    db.prepare("DELETE FROM workspace_members WHERE workspace_id = ?").run(workspaceId);
    db.prepare("DELETE FROM workspaces WHERE id = ?").run(workspaceId);
  }
  for (const workspace of workspaces) {
    db.prepare("DELETE FROM tenant_members WHERE tenant_id = ?").run(workspace.tenant_id);
    db.prepare("DELETE FROM tenants WHERE id = ?").run(workspace.tenant_id);
  }
}

function cleanupSession(sessionId: string) {
  db.prepare("DELETE FROM session_artifacts WHERE session_id = ?").run(sessionId);
  db.prepare("DELETE FROM tool_calls WHERE session_id = ?").run(sessionId);
  db.prepare("DELETE FROM session_events WHERE session_id = ?").run(sessionId);
  db.prepare("DELETE FROM session_threads WHERE session_id = ?").run(sessionId);
  db.prepare("DELETE FROM sessions WHERE id = ?").run(sessionId);
}

function cleanupAgent(agentId: string) {
  db.prepare("DELETE FROM agent_deployments WHERE agent_id = ?").run(agentId);
  db.prepare("DELETE FROM agent_versions WHERE agent_id = ?").run(agentId);
  db.prepare("DELETE FROM agents WHERE id = ?").run(agentId);
}

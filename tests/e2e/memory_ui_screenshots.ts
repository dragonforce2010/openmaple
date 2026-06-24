import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

const apiBase = process.env.MAPLE_E2E_API_BASE || "http://127.0.0.1:27651";
const webBase = process.env.MAPLE_E2E_WEB_BASE || "http://127.0.0.1:27652";
const outDir = process.env.MAPLE_E2E_SCREENSHOT_DIR || join(process.cwd(), "artifacts", "memory-e2e");
const cleanup = process.env.MAPLE_E2E_CLEANUP === "1";
const useExistingTenant = process.env.MAPLE_E2E_USE_EXISTING_TENANT === "1";
mkdirSync(outDir, { recursive: true });

const stamp = Date.now().toString(36);
let authCookie = "";
let workspaceId = "";
let workspaceRoute = "";
let createdWorkspaceId = "";
let cleanupResult: unknown = null;

const login = await request("/v1/auth/login", {
  method: "POST",
  body: JSON.stringify({
    provider: "local",
    email: process.env.MAPLE_E2E_LOGIN_EMAIL || (useExistingTenant ? "admin@example.com" : `memory-ui-${stamp}@example.com`),
    name: process.env.MAPLE_E2E_LOGIN_NAME || (useExistingTenant ? "Platform Admin" : "Memory UI E2E")
  })
});
const models = await request("/v1/model_configs");
const model = models.data.find((item: Record<string, unknown>) => item.is_default) ?? models.data[0] ?? null;
const modelConfigIds = model?.id ? [model.id] : [];
const agentModel = model?.id
  ? { provider: "custom", id: model.model_name, config_id: model.id, name: model.name }
  : { provider: "custom", id: "local-e2e-model", name: "Local E2E Model" };

if (useExistingTenant) {
  const existing = await request("/v1/workspaces");
  if (!Array.isArray(existing.data) || existing.data.length === 0) {
    await request("/v1/workspace_onboarding", {
      method: "POST",
      body: JSON.stringify(workspacePayload({
        tenant: { name: `Memory UI Baseline Tenant ${stamp}` },
        workspace: { name: `Memory UI Baseline ${stamp}`, slug: `memory-ui-base-${stamp}` },
        runtime_provider: "local_docker",
        sandbox_provider: "local_docker",
        model_config_ids: modelConfigIds
      }))
    });
  }
  const created = await request("/v1/workspaces", {
    method: "POST",
    body: JSON.stringify(workspacePayload({
      workspace: { name: `Memory UI Workspace ${stamp}`, slug: `memory-ui-${stamp}` },
      runtime_provider: "local_docker",
      sandbox_provider: "local_docker",
      model_config_ids: modelConfigIds
    }))
  });
  workspaceId = String(created.workspace.id);
  workspaceRoute = workspaceRouteFor(created.workspace);
  createdWorkspaceId = workspaceId;
} else {
  const onboarding = await request("/v1/workspace_onboarding", {
    method: "POST",
    body: JSON.stringify(workspacePayload({
      tenant: { name: `Memory UI Tenant ${stamp}` },
      workspace: { name: `Memory UI Workspace ${stamp}`, slug: `memory-ui-${stamp}` },
      runtime_provider: "vefaas",
      sandbox_provider: "e2b",
      model_config_ids: modelConfigIds,
      provider_credentials: {
        vefaas: { VOLCENGINE_ACCESS_KEY: "ak", VOLCENGINE_SECRET_KEY: "sk", VEFAAS_REGION: "cn-beijing" },
        e2b: { E2B_API_KEY: "e2b" }
      }
    }))
  });
  workspaceId = String(onboarding.workspace.id);
  workspaceRoute = workspaceRouteFor(onboarding.workspace);
}
await pollRuntimePoolActive(workspaceId);

const environment = await request("/v1/environments", {
  method: "POST",
  body: JSON.stringify({
    workspace_id: workspaceId,
    name: `Memory UI Env ${stamp}`,
    config: useExistingTenant ? { type: "local_docker", sandbox: { provider: "local_docker" } } : { type: "e2b", sandbox: { provider: "e2b" } }
  })
});
const agent = await request("/v1/agents", {
  method: "POST",
  body: JSON.stringify({
    workspace_id: workspaceId,
    name: `Memory UI Agent ${stamp}`,
    description: "Memory UI e2e agent",
    model: agentModel,
    system: "Use memory resource UI evidence.",
    tools: [{ name: "memory_search" }, { name: "memory_write" }],
    mcp_servers: [],
    skills: []
  })
});
const store = await request("/v1/memory_stores", {
  method: "POST",
  body: JSON.stringify({
    workspace_id: workspaceId,
    name: `Memory UI Store ${stamp}`,
    description: "Screenshot proof memory store",
    provider: "local"
  })
});
await request(`/v1/memory_stores/${store.id}/memories/projects/conventions.md`, {
  method: "PUT",
  body: JSON.stringify({ actor: "user", content: "# Memory UI\n\n- Screenshot evidence passes through the real console." })
});
await request("/v1/deployments", {
  method: "POST",
  body: JSON.stringify({
    workspace_id: workspaceId,
    agent_id: agent.id,
    environment_id: environment.id,
    name: `memory-ui-deployment-${stamp}`,
    version: "1",
    initial_events: [{ type: "user.message", payload: { content: [{ type: "text", text: "Use attached memory." }] } }],
    resources: [{ type: "memory_store", memory_store_id: store.id, access: "read_write", instructions: "UI screenshot proof" }]
  })
});

const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1 });
  const [cookieName, ...cookieValueParts] = authCookie.split("=");
  await context.addCookies([{ name: cookieName, value: cookieValueParts.join("="), url: new URL(webBase).origin, httpOnly: true, sameSite: "Lax" }]);
  await context.addInitScript(() => {
    localStorage.setItem("cc_authed", "1");
    localStorage.setItem("maple.language", "zh");
  });
  const page = await context.newPage();
  const browserErrors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") browserErrors.push(message.text()); });
  page.on("pageerror", (error) => browserErrors.push(error.message));
  await page.goto(appUrl(workspaceRoute, "auth_return=1"), { waitUntil: "domcontentloaded" });
  await page.locator(".console-shell").waitFor({ timeout: 20_000 });

  await clickNav(page, "记忆库");
  await page.getByText(store.name).first().waitFor({ timeout: 10_000 });
  await page.screenshot({ path: join(outDir, "01-memory-detail.png"), fullPage: true });
  await page.locator(".memory-detail .btn", { hasText: /添加记忆|Add memory/ }).click();
  await page.getByRole("dialog", { name: /添加记忆|Add memory/ }).waitFor({ timeout: 10_000 });
  await page.getByText(/目录由路径里的斜杠自动派生|folders are derived/).waitFor({ timeout: 10_000 });
  await page.screenshot({ path: join(outDir, "02-memory-add-modal.png"), fullPage: true });
  await page.keyboard.press("Escape");

  await clickNav(page, "会话");
  await page.getByRole("button", { name: /新建 Session|New session/ }).first().click();
  await page.getByRole("button", { name: /添加记忆库|Add memory store/ }).first().click();
  await page.getByText(/读写|Read & write/).first().waitFor({ timeout: 10_000 });
  await page.screenshot({ path: join(outDir, "03-session-memory-resource.png"), fullPage: true });
  await page.keyboard.press("Escape");

  await clickNav(page, "部署");
  await page.getByText(`memory-ui-deployment-${stamp}`).first().waitFor({ timeout: 10_000 });
  const addMemoryButtons = page.getByRole("button", { name: /添加记忆库|Add memory store/ });
  if (await addMemoryButtons.count()) await addMemoryButtons.first().click();
  await page.getByText(store.name).first().waitFor({ timeout: 10_000 });
  await page.screenshot({ path: join(outDir, "04-deployment-memory-resource.png"), fullPage: true });
  if (browserErrors.length) throw new Error(`browser errors: ${browserErrors.join("\n")}`);
} finally {
  await browser.close();
  if (cleanup && createdWorkspaceId) {
    try {
      cleanupResult = await request(`/v1/workspaces/${createdWorkspaceId}`, { method: "DELETE" });
    } catch (error) {
      cleanupResult = { error: error instanceof Error ? error.message : String(error) };
    }
  }
}

console.log(JSON.stringify({ outDir, workspaceId, cleanup: cleanupResult, screenshots: ["01-memory-detail.png", "02-memory-add-modal.png", "03-session-memory-resource.png", "04-deployment-memory-resource.png"] }, null, 2));

async function clickNav(page: import("playwright").Page, label: string) {
  const item = page.locator("button.nav-item, .nav-item", { hasText: label }).first();
  await item.waitFor({ timeout: 10_000 });
  await item.click();
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
  const body = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(`${init.method || "GET"} ${path} failed ${response.status}: ${JSON.stringify(body)}`);
  return body;
}

async function pollRuntimePoolActive(id: string) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 15_000) {
    const pool = await request(`/v1/workspaces/${id}/runtime_pool`);
    if (pool.members.length === 1 && pool.members[0].status === "active") return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Timed out waiting for active runtime pool");
}

function workspacePayload(input: {
  tenant?: { name: string };
  workspace: { name: string; slug: string };
  runtime_provider: "vefaas" | "local_docker";
  sandbox_provider: "e2b" | "local_docker";
  model_config_ids: string[];
  provider_credentials?: Record<string, Record<string, string>>;
}) {
  return {
    ...(input.tenant ? { tenant: input.tenant } : {}),
    workspace: input.workspace,
    runtime_provider: input.runtime_provider,
    runtime_pool: {
      desired_size: 1,
      max_instances_per_function: 100,
      max_concurrency_per_instance: 1000,
      cpu_milli: 2000,
      memory_mb: 4096
    },
    sandbox_provider: input.sandbox_provider,
    sandbox_pool: { desired_size: 1, standby_ttl_ms: 1800000 },
    model_config_ids: input.model_config_ids,
    api_key: { display_name: "Memory UI key", scopes: ["control_plane", "data_plane"] },
    provider_credentials: input.provider_credentials ?? {}
  };
}

function workspaceRouteFor(workspace: unknown) {
  const record = asRecord(workspace);
  const config = asRecord(record.config);
  const tenantSlug = String(config.tenant_slug || "");
  const slug = String(config.slug || "");
  return tenantSlug && slug ? `/t/${encodeURIComponent(tenantSlug)}/w/${encodeURIComponent(slug)}` : "";
}

function appUrl(path: string, query: string) {
  const base = webBase.replace(/\/+$/, "");
  const suffix = path || "/";
  return `${base}${suffix}${suffix.includes("?") ? "&" : "?"}${query}`;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

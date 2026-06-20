import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFakeVefaasRuntimeDeployScript } from "./helpers/fakeVefaasDeploy";

const dataDir = mkdtempSync(join(tmpdir(), "maple-auth-tenant-flow-"));
const deployScript = writeFakeVefaasRuntimeDeployScript(dataDir, "https://example.invalid/maple-runtime");
const port = 21_000 + Math.floor(Math.random() * 2000);
const apiBase = `http://127.0.0.1:${port}`;
const stamp = Date.now().toString(36);
const providerCredentials = {
  vefaas: {
    VOLCENGINE_ACCESS_KEY: "contract-access-key",
    VOLCENGINE_SECRET_KEY: "contract-secret-key",
    VEFAAS_REGION: "cn-beijing"
  },
  e2b: { E2B_API_KEY: "contract-e2b-key" }
};

const server = spawn("bun", ["apps/control-plane-api/src/index.ts"], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    PORT: String(port),
    HOST: "127.0.0.1",
    MAPLE_DATA_DIR: dataDir,
    MAPLE_WEB_BASE_URL: "https://maple.example.test",
    MAPLE_VEFAAS_RUNTIME_DEPLOY_SCRIPT: deployScript,
    MAPLE_DEV_LOGIN: "true"
  },
  stdio: ["ignore", "pipe", "pipe"]
});
let serverOutput = "";
server.stdout.on("data", (chunk) => (serverOutput += String(chunk)));
server.stderr.on("data", (chunk) => (serverOutput += String(chunk)));

try {
  await waitForHealth();

  const staleBoot = await staleBootstrap();
  assert.equal(staleBoot.recommended_view, "login");
  assert.equal(staleBoot.owned_count, 0);
  assert.equal(staleBoot.member_only_count, 0);

  // U_A — brand-new user with no tenant → onboarding
  const a = await login(`uA-${stamp}@example.com`);
  const models = await getJson("/v1/model_configs", a.cookie);
  const model = models.data.find((item: Record<string, unknown>) => item.is_default) ?? models.data[0];
  assert.ok(model?.id, "a global default model must exist");
  const aBoot = await bootstrap(a.cookie);
  assert.equal(aBoot.recommended_view, "onboarding");
  assert.equal(aBoot.owned_count, 0);
  assert.equal(aBoot.member_only_count, 0);

  // U_C — owns exactly one tenant → dashboard
  const c = await login(`uC-${stamp}@example.com`);
  const cOnboard = await onboard(c.cookie, `C ${stamp}`, `tc-${stamp}`, model.id);
  const workspaceC = cOnboard.workspace.id as string;
  const cBoot = await bootstrap(c.cookie);
  assert.equal(cBoot.recommended_view, "dashboard");
  assert.equal(cBoot.owned_count, 1);
  assert.equal(cBoot.member_only_count, 0);
  const cWorkspace = await appBootstrap(c.cookie, workspaceC);
  assert.equal(cWorkspace.workspaces[0].config?.console_url, `https://maple.example.test/t/tc-${stamp}/w/tc-${stamp}`);

  // U_B — member of C's workspace only (no own tenant) → tenant_choice
  const b = await login(`uB-${stamp}@example.com`);
  await addMember(c.cookie, workspaceC, b.email);
  const bBoot = await bootstrap(b.cookie);
  assert.equal(bBoot.recommended_view, "tenant_choice");
  assert.equal(bBoot.owned_count, 0);
  assert.equal(bBoot.member_only_count, 1);

  // U_E — workspace admin of C's workspace only (no tenant admin) → can manage workspace resources
  const e = await login(`uE-${stamp}@example.com`);
  await addAdmin(c.cookie, workspaceC, e.email);
  const eBoot = await bootstrap(e.cookie);
  assert.equal(eBoot.recommended_view, "tenant_choice");
  assert.equal(eBoot.owned_count, 0);
  assert.equal(eBoot.member_only_count, 1);
  const eWorkspace = await appBootstrap(e.cookie, workspaceC);
  assert.equal(eWorkspace.is_tenant_admin, false);
  assert.equal(eWorkspace.can_admin_workspace, true);
  assert.equal(eWorkspace.selected_workspace_id, workspaceC);
  assert.ok(eWorkspace.users.length >= 2);
  assert.equal(eWorkspace.users.some((user) => user.email === e.email.toLowerCase() && user.effective_role === "admin"), true);
  assert.equal(eWorkspace.api_keys.length, 1);
  assert.match(String((eWorkspace.api_keys[0] as Record<string, unknown>).key || ""), /^maple_ws_/, "workspace admin bootstrap must include the full encrypted-at-rest API key");
  assert.equal(eWorkspace.workspaces[0].tenant_id, cOnboard.tenant.id);
  assert.equal(Boolean(eWorkspace.workspaces[0].config?.provider_credentials), true);
  assert.equal(String(eWorkspace.workspaces[0].config?.cloud_provider_identities?.volcengine?.provider), "volcengine");
  assert.equal(String(eWorkspace.workspaces[0].config?.cloud_provider_identities?.volcengine?.credential_source), "provider_credentials.vefaas");

  const tenantKey = await createTenantKey(c.cookie, cOnboard.tenant.id);
  assert.match(String(tenantKey.key), /^maple_tn_/, "tenant API key must return full tenant AKSK material");
  const keyWorkspaces = await getJsonWithApiKey("/v1/workspaces", String(tenantKey.key));
  assert.equal(keyWorkspaces.data.some((workspace: Record<string, unknown>) => workspace.id === workspaceC), true);
  const tenantAdmin = await login(`tenant-admin-${stamp}@example.com`);
  const tenantMember = await login(`tenant-member-${stamp}@example.com`);
  await postJsonWithApiKey(`/v1/tenants/${cOnboard.tenant.id}/admins`, String(tenantKey.key), { email: tenantAdmin.email });
  await postJsonWithApiKey(`/v1/tenants/${cOnboard.tenant.id}/members`, String(tenantKey.key), { email: tenantMember.email });
  const tenantMembers = await getJsonWithApiKey(`/v1/tenants/${cOnboard.tenant.id}/members`, String(tenantKey.key));
  assert.equal(tenantMembers.data.some((user: Record<string, unknown>) => user.email === tenantAdmin.email.toLowerCase() && user.effective_role === "admin"), true);
  assert.equal(tenantMembers.data.some((user: Record<string, unknown>) => user.email === tenantMember.email.toLowerCase()), true);
  const keyWorkspace = await createWorkspaceWithApiKey(String(tenantKey.key), cOnboard.tenant.id, `tc-${stamp}-key`, model.id);
  const keyWorkspaceId = keyWorkspace.workspace.id as string;
  await postJsonWithApiKey(`/v1/workspaces/${keyWorkspaceId}/members`, String(tenantKey.key), { email: tenantMember.email });
  const managedWorkspaceKey = await postJsonWithApiKey(`/v1/workspaces/${keyWorkspaceId}/api_keys`, String(tenantKey.key), { display_name: "Managed by tenant key", scopes: ["control_plane"] });
  assert.match(String(managedWorkspaceKey.key), /^maple_ws_/, "tenant API key must manage workspace API keys under the tenant");
  await patchJson(`/v1/tenants/${cOnboard.tenant.id}/api_keys/${tenantKey.id}`, c.cookie, { enabled: false });
  const disabledResponse = await fetch(`${apiBase}/v1/workspaces`, { headers: { "x-maple-api-key": String(tenantKey.key) } });
  assert.equal(disabledResponse.status, 401, "disabled tenant API key must stop authenticating");

  // U_D — owns one tenant AND member of C's → tenant_select
  const d = await login(`uD-${stamp}@example.com`);
  const dOnboard = await onboard(d.cookie, `D ${stamp}`, `td-${stamp}`, model.id);
  await addMember(c.cookie, workspaceC, d.email);
  const dBoot = await bootstrap(d.cookie);
  assert.equal(dBoot.recommended_view, "tenant_select");
  assert.equal(dBoot.owned_count, 1);
  assert.equal(dBoot.member_only_count, 1);
  const dDirectBoot = await bootstrap(d.cookie, `tc-${stamp}`);
  assert.equal(dDirectBoot.recommended_view, "dashboard");
  assert.equal(dDirectBoot.selected_tenant_id, cOnboard.tenant.id);
  assert.equal(dDirectBoot.selected_workspace_id, workspaceC);
  const dDirectWorkspace = await appBootstrapByTenant(d.cookie, `tc-${stamp}`);
  assert.equal(dDirectWorkspace.selected_workspace_id, workspaceC);
  assert.equal(dDirectWorkspace.workspaces.length, 1);

  // regression: U_C still routes to dashboard, never onboarding, after others joined
  assert.equal((await bootstrap(c.cookie)).recommended_view, "dashboard");

  // security: /v1/auth/login must never issue a session for an IdP provider — those have
  // to complete their OAuth callback flow. Otherwise anyone could impersonate any account
  // (incl. admins) by posting {provider: "lark_sso", email}. Rejected even with dev login on.
  for (const provider of ["lark_sso", "oauth", "oidc", "bytesso"]) {
    const response = await fetch(`${apiBase}/v1/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider, email: `uC-${stamp}@example.com` })
    });
    assert.equal(response.status, 403, `${provider} login must be rejected, got ${response.status}`);
    assert.equal(response.headers.get("set-cookie"), null, `${provider} login must not set a session cookie`);
  }

  console.log("auth tenant flow contract passed");
} finally {
  server.kill();
}

async function login(email: string) {
  const response = await fetch(`${apiBase}/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ provider: "local", email, name: email })
  });
  if (!response.ok) throw new Error(`login ${email} failed ${response.status}: ${await response.text()}`);
  const setCookie = response.headers.get("set-cookie") || "";
  const cookie = setCookie.split(";")[0];
  await response.json();
  return { cookie, email };
}

async function bootstrap(cookie: string, tenantSlug = "") {
  const route = tenantSlug ? `/t/${encodeURIComponent(tenantSlug)}` : "";
  const response = await fetch(`${apiBase}/v1/auth/bootstrap${route}`, { headers: { cookie } });
  if (!response.ok) throw new Error(`bootstrap failed ${response.status}: ${await response.text()}`);
  return response.json() as Promise<{ recommended_view: string; owned_count: number; member_only_count: number; selected_tenant_id?: string; selected_workspace_id?: string }>;
}

async function staleBootstrap() {
  const response = await fetch(`${apiBase}/v1/auth/bootstrap`, { headers: { cookie: "maple_session=bogus_stale_session" } });
  if (!response.ok) throw new Error(`stale bootstrap failed ${response.status}: ${await response.text()}`);
  return response.json() as Promise<{ recommended_view: string; owned_count: number; member_only_count: number }>;
}

async function appBootstrap(cookie: string, workspaceId: string) {
  const response = await fetch(`${apiBase}/v1/bootstrap?workspace_id=${encodeURIComponent(workspaceId)}`, { headers: { cookie } });
  if (!response.ok) throw new Error(`app bootstrap failed ${response.status}: ${await response.text()}`);
  return response.json() as Promise<{
    is_tenant_admin: boolean;
    can_admin_workspace: boolean;
    selected_workspace_id: string;
    users: Array<{ email: string; effective_role: string }>;
    api_keys: unknown[];
    workspaces: Array<{ tenant_id: string; config?: Record<string, unknown> }>;
  }>;
}

async function appBootstrapByTenant(cookie: string, tenantSlug: string) {
  const response = await fetch(`${apiBase}/v1/bootstrap/t/${encodeURIComponent(tenantSlug)}`, { headers: { cookie } });
  if (!response.ok) throw new Error(`app bootstrap by tenant failed ${response.status}: ${await response.text()}`);
  return response.json() as Promise<{
    selected_workspace_id: string;
    workspaces: Array<{ tenant_id: string; config?: Record<string, unknown> }>;
  }>;
}

async function getJson(path: string, cookie: string) {
  const response = await fetch(`${apiBase}${path}`, { headers: { cookie } });
  if (!response.ok) throw new Error(`${path} failed ${response.status}: ${await response.text()}`);
  return response.json() as Promise<Record<string, any>>;
}

async function getJsonWithApiKey(path: string, apiKey: string) {
  const response = await fetch(`${apiBase}${path}`, { headers: { "x-maple-api-key": apiKey } });
  if (!response.ok) throw new Error(`${path} with api key failed ${response.status}: ${await response.text()}`);
  return response.json() as Promise<Record<string, any>>;
}

async function postJsonWithApiKey(path: string, apiKey: string, body: Record<string, unknown>) {
  const response = await fetch(`${apiBase}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-maple-api-key": apiKey },
    body: JSON.stringify(body)
  });
  if (!response.ok) throw new Error(`${path} with api key failed ${response.status}: ${await response.text()}`);
  return response.json() as Promise<Record<string, any>>;
}

async function patchJson(path: string, cookie: string, body: Record<string, unknown>) {
  const response = await fetch(`${apiBase}${path}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify(body)
  });
  if (!response.ok) throw new Error(`patch ${path} failed ${response.status}: ${await response.text()}`);
  return response.json() as Promise<Record<string, any>>;
}

async function onboard(cookie: string, label: string, slug: string, modelId: string) {
  const response = await fetch(`${apiBase}/v1/workspace_onboarding`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({
      tenant: { name: `Tenant ${label}`, description: "auth tenant flow contract" },
      workspace: { name: `Workspace ${label}`, description: "", slug },
      runtime_provider: "vefaas",
      sandbox_provider: "e2b",
      runtime_pool: { desired_size: 1, max_instances_per_function: 100, max_concurrency_per_instance: 100, cpu_milli: 2000, memory_mb: 4096 },
      model_config_ids: [modelId],
      api_key: { display_name: "Default workspace key", scopes: ["control_plane", "data_plane"] },
      provider_credentials: providerCredentials
    })
  });
  if (!response.ok) throw new Error(`onboard ${label} failed ${response.status}: ${await response.text()}`);
  return response.json() as Promise<{ tenant: { id: string }; workspace: { id: string } }>;
}

async function createWorkspaceWithApiKey(apiKey: string, tenantId: string, slug: string, modelId: string) {
  const response = await fetch(`${apiBase}/v1/workspaces`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-maple-api-key": apiKey },
    body: JSON.stringify({
      tenant_id: tenantId,
      workspace: { name: `Tenant key ${slug}`, description: "", slug },
      runtime_provider: "vefaas",
      sandbox_provider: "e2b",
      runtime_pool: { desired_size: 1, max_instances_per_function: 100, max_concurrency_per_instance: 100, cpu_milli: 2000, memory_mb: 4096 },
      model_config_ids: [modelId],
      api_key: { display_name: "Default workspace key", scopes: ["control_plane", "data_plane"] },
      provider_credentials: providerCredentials
    })
  });
  if (!response.ok) throw new Error(`tenant key workspace create failed ${response.status}: ${await response.text()}`);
  return response.json() as Promise<{ workspace: { id: string } }>;
}

async function createTenantKey(cookie: string, tenantId: string) {
  const response = await fetch(`${apiBase}/v1/tenants/${tenantId}/api_keys`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ display_name: "Tenant Admin Key", scopes: ["tenant_admin", "control_plane", "data_plane"] })
  });
  if (!response.ok) throw new Error(`tenant key create failed ${response.status}: ${await response.text()}`);
  return response.json() as Promise<{ id: string; key: string }>;
}

async function addMember(adminCookie: string, workspaceId: string, email: string) {
  const response = await fetch(`${apiBase}/v1/workspaces/${workspaceId}/members`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: adminCookie },
    body: JSON.stringify({ email })
  });
  if (!response.ok) throw new Error(`add member ${email} failed ${response.status}: ${await response.text()}`);
}

async function addAdmin(adminCookie: string, workspaceId: string, email: string) {
  const response = await fetch(`${apiBase}/v1/workspaces/${workspaceId}/admins`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: adminCookie },
    body: JSON.stringify({ email })
  });
  if (!response.ok) throw new Error(`add admin ${email} failed ${response.status}: ${await response.text()}`);
}

async function waitForHealth() {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 15_000) {
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

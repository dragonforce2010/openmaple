import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { writeFakeVefaasRuntimeDeployScript } from "./helpers/fakeVefaasDeploy";

loadEnvFile(join(homedir(), ".agents", ".env"));
loadEnvFile(join(process.cwd(), ".env"));

const dataDir = mkdtempSync(join(tmpdir(), "maple-tenant-cloud-provider-"));
const deployScript = writeFakeVefaasRuntimeDeployScript(dataDir, "https://example.invalid/maple-runtime");
const port = 23_000 + Math.floor(Math.random() * 2000);
const apiBase = `http://127.0.0.1:${port}`;
const stamp = Date.now().toString(36);
const requestTimeoutMs = Number(process.env.MAPLE_CONTRACT_REQUEST_TIMEOUT_MS || 180_000);
const customModelConfigs = [{ kind: "custom", name: "Contract model", protocol: "openai", base_url: "https://example.invalid/v1", model_name: "contract-model", api_key: "model-key", is_default: true }];

const server = spawn("bun", ["apps/control-plane-api/src/index.ts"], {
  cwd: process.cwd(),
    env: { ...process.env, PORT: String(port), HOST: "127.0.0.1", MAPLE_DATA_DIR: dataDir, MAPLE_MYSQL_HELPER_TIMEOUT_MS: String(requestTimeoutMs), MAPLE_VEFAAS_RUNTIME_DEPLOY_SCRIPT: deployScript, MAPLE_ALIYUN_FC_INVOKE_URL: "https://example.invalid/aliyun-runtime", MAPLE_DEV_LOGIN: "true", MAPLE_VOLCENGINE_CREDENTIAL_VALIDATION: "off", MAPLE_ALIYUN_CREDENTIAL_VALIDATION: "off" },
  stdio: ["ignore", "pipe", "pipe"]
});
let serverOutput = "";
server.stdout.on("data", (chunk) => (serverOutput += String(chunk)));
server.stderr.on("data", (chunk) => (serverOutput += String(chunk)));

try {
  await waitForHealth();
  const user = await login(`cloud-${stamp}@example.com`);
  const onboarded = await postJson("/v1/workspace_onboarding", user.cookie, {
    tenant: { name: `Cloud ${stamp}` },
    workspace: { name: `Cloud ${stamp}`, slug: `cloud-${stamp}` },
    runtime_provider: "vefaas",
    sandbox_provider: "e2b",
    runtime_pool: { desired_size: 1, min_instances_per_function: 0, max_instances_per_function: 1, max_concurrency_per_instance: 1, cpu_milli: 250, memory_mb: 512 },
    sandbox_config: {},
    sandbox_pool: { desired_size: 1, standby_ttl_ms: 60_000 },
    model_config_ids: [],
    custom_model_configs: customModelConfigs,
    api_key: { display_name: "contract", scopes: ["control_plane"] },
    provider_credentials: { vefaas: { VOLCENGINE_ACCESS_KEY: "onboard-ak", VOLCENGINE_SECRET_KEY: "onboard-sk", VEFAAS_REGION: "cn-beijing" }, e2b: { E2B_API_KEY: "e2b-key" } }
  });
  const tenantId = onboarded.tenant.id as string;

  const saved = await postJson(`/v1/tenants/${tenantId}/cloud_providers/volcengine`, user.cookie, { access_key: "tenant-ak-1234", secret_key: "tenant-sk-5678", region: "cn-shanghai" });
  assert.equal(saved.provider, "volcengine");
  assert.equal(saved.connected, true);
  assert.equal(saved.region, "cn-shanghai");
  assert.equal(saved.access_key, "tenant-ak-1234", "tenant cloud provider response should return the access key for admin editing");
  assert.equal(saved.secret_key, undefined, "tenant cloud provider response must not leak plaintext secret key");
  assert.equal(saved.secret_key_masked, true, "tenant cloud provider response should mark the secret key as masked");
  assert.equal(saved.credentials, undefined, "tenant cloud provider response must not leak raw credential bundles");

  const updatedWithoutSecret = await postJson(`/v1/tenants/${tenantId}/cloud_providers/volcengine`, user.cookie, { access_key: "tenant-ak-1234", region: "cn-beijing" });
  assert.equal(updatedWithoutSecret.region, "cn-beijing", "tenant cloud provider update should preserve the existing secret key when it is not resubmitted");
  const savedAliyun = await postJson(`/v1/tenants/${tenantId}/cloud_providers/aliyun`, user.cookie, { access_key: "aliyun-ak-1234", secret_key: "aliyun-sk-5678", region: "cn-hangzhou" });
  assert.equal(savedAliyun.provider, "aliyun");
  assert.equal(savedAliyun.connected, true);
  assert.equal(savedAliyun.region, "cn-hangzhou");
  assert.equal(savedAliyun.access_key, "aliyun-ak-1234");
  assert.equal(savedAliyun.secret_key, undefined);

  const providers = await getJson(`/v1/tenants/${tenantId}/cloud_providers`, user.cookie);
  assert.equal(providers.data.length, 2);
  const volcengineProvider = providers.data.find((item: Record<string, unknown>) => item.provider === "volcengine");
  const aliyunProvider = providers.data.find((item: Record<string, unknown>) => item.provider === "aliyun");
  assert.equal(volcengineProvider.access_key, "tenant-ak-1234", "tenant cloud provider listing should return access key for admin editing");
  assert.equal(volcengineProvider.secret_key, undefined, "tenant cloud provider listing must not leak plaintext secret key");
  assert.equal(volcengineProvider.credentials, undefined, "tenant cloud provider listing must not leak raw credential bundles");
  assert.equal(aliyunProvider.access_key, "aliyun-ak-1234");
  assert.equal(aliyunProvider.secret_key, undefined);
  const providerListingText = await getText(`/v1/tenants/${tenantId}/cloud_providers`, user.cookie);
  assert.equal(providerListingText.includes("tenant-sk-5678"), false, "tenant cloud provider listing must not include plaintext secret");
  assert.equal(providerListingText.includes("aliyun-sk-5678"), false, "tenant cloud provider listing must not include plaintext Aliyun secret");
  assert.equal(providerListingText.includes("aes-256-gcm"), false, "tenant cloud provider listing must not include encrypted secret payloads");
  const onboardingStatusText = await getText("/v1/workspace_onboarding/status", user.cookie);
  assert.equal(onboardingStatusText.includes("tenant-sk-5678"), false, "tenant metadata response must not include plaintext cloud secret");
  assert.equal(onboardingStatusText.includes("aes-256-gcm"), false, "tenant metadata response must not include cloud secret ciphertext");

  const aliyunUser = await login(`aliyun-cloud-${stamp}@example.com`);
  const aliyunOnly = await postJson("/v1/workspace_onboarding", aliyunUser.cookie, {
    tenant: { name: `Aliyun ${stamp}` },
    workspace: { name: `Aliyun ${stamp}`, slug: `aliyun-${stamp}` },
    runtime_provider: "aliyun_fc",
    sandbox_provider: "aliyun_fc",
    runtime_pool: { desired_size: 1, min_instances_per_function: 0, max_instances_per_function: 1, max_concurrency_per_instance: 1, cpu_milli: 250, memory_mb: 512 },
    sandbox_config: { aliyun_fc: { region: "cn-hangzhou" } },
    sandbox_pool: { desired_size: 1, standby_ttl_ms: 60_000 },
    model_config_ids: [],
    custom_model_configs: customModelConfigs,
    api_key: { display_name: "aliyun", scopes: ["control_plane"] },
    provider_credentials: { aliyun: { ALIYUN_ACCESS_KEY_ID: "aliyun-ak-lazy", ALIYUN_ACCESS_KEY_SECRET: "aliyun-sk-lazy", ALIYUN_REGION: "cn-hangzhou" } }
  });
  assert.equal(aliyunOnly.workspace.runtime_provider, "aliyun_fc", "Aliyun FC runtime should accept AK/SK provisioning without a pre-created invoke URL");
  assert.equal(aliyunOnly.workspace.sandbox_provider, "aliyun_fc", "Aliyun FC sandbox should accept AK/SK provisioning without a pre-created invoke URL");
  assert.equal(aliyunOnly.workspace.config.cloud_provider_identities.aliyun.services.includes("runtime:aliyun_fc"), true);
  assert.equal(aliyunOnly.workspace.config.cloud_provider_identities.aliyun.services.includes("sandbox:aliyun_fc"), true);

  const created = await postJson("/v1/workspaces", user.cookie, {
    tenant_id: tenantId,
    workspace: { name: `Second ${stamp}`, slug: `cloud-${stamp}-second` },
    runtime_provider: "vefaas",
    sandbox_provider: "daytona",
    runtime_pool: { desired_size: 1, min_instances_per_function: 0, max_instances_per_function: 1, max_concurrency_per_instance: 1, cpu_milli: 250, memory_mb: 512 },
    sandbox_config: { daytona: { server_url: "https://daytona.example.invalid", api_key: "daytona-key" } },
    sandbox_pool: { desired_size: 1, standby_ttl_ms: 60_000 },
    model_config_ids: [],
    custom_model_configs: customModelConfigs,
    api_key: { display_name: "second", scopes: ["control_plane"] },
    provider_credentials: {}
  });
  assert.equal(created.workspace.runtime_provider, "vefaas", "workspace creation should reuse tenant-level Volcengine credentials");
  assert.equal(created.workspace.sandbox_provider, "daytona", "Daytona sandbox provider should be accepted as an independent provider");

  const mixed = await postJson("/v1/workspaces", user.cookie, {
    tenant_id: tenantId,
    workspace: { name: `Mixed ${stamp}`, slug: `cloud-${stamp}-mixed` },
    runtime_provider: "vefaas",
    runtime_pools: [
      { provider: "vefaas", role: "primary", priority: 0, desired_size: 1, min_instances_per_function: 0, max_instances_per_function: 1, max_concurrency_per_instance: 1, cpu_milli: 250, memory_mb: 512 },
      { provider: "aliyun_fc", role: "standby", priority: 10, desired_size: 1, min_instances_per_function: 0, max_instances_per_function: 1, max_concurrency_per_instance: 1, cpu_milli: 250, memory_mb: 512 }
    ],
    runtime_pool: { desired_size: 1, min_instances_per_function: 0, max_instances_per_function: 1, max_concurrency_per_instance: 1, cpu_milli: 250, memory_mb: 512 },
    sandbox_provider: "aliyun_fc",
    sandbox_pools: [
      { provider: "aliyun_fc", role: "primary", priority: 0, desired_size: 1, standby_ttl_ms: 60_000, config: { invoke_url: "https://example.invalid/aliyun-sandbox", function_name: "maple-contract-sandbox" } },
      { provider: "e2b", role: "standby", priority: 10, desired_size: 1, standby_ttl_ms: 60_000 }
    ],
    sandbox_config: { aliyun_fc: { invoke_url: "https://example.invalid/aliyun-sandbox", function_name: "maple-contract-sandbox" } },
    sandbox_pool: { desired_size: 1, standby_ttl_ms: 60_000 },
    artifact_provider: "oss",
    model_config_ids: [],
    custom_model_configs: customModelConfigs,
    api_key: { display_name: "mixed", scopes: ["control_plane"] },
    provider_credentials: { e2b: { E2B_API_KEY: "e2b-key" } }
  });
  assert.equal(mixed.workspace.config.runtime_pools.length, 2);
  assert.equal(mixed.workspace.config.sandbox_pools.length, 2);
  assert.equal(mixed.workspace.config.artifact_provider, "oss");
  assert.deepEqual(mixed.workspace.config.cloud_provider_identities.aliyun.services, ["runtime:aliyun_fc", "sandbox:aliyun_fc", "storage:oss"]);
  const mixedRuntimePool = await getJson(`/v1/workspaces/${mixed.workspace.id}/runtime_pool`, user.cookie);
  assert.equal(mixedRuntimePool.pools.length, 2);
  assert.equal(mixedRuntimePool.pools[0].provider, "vefaas");
  assert.equal(mixedRuntimePool.pools[1].provider, "aliyun_fc");
  const mixedSandboxPool = await getJson(`/v1/workspaces/${mixed.workspace.id}/sandbox_pool`, user.cookie);
  assert.equal(mixedSandboxPool.pools.length, 2);
  assert.equal(mixedSandboxPool.pools[0].provider, "aliyun_fc");
  assert.equal(mixedSandboxPool.pools[1].provider, "e2b");

  const localUser = await login(`local-cloud-${stamp}@example.com`);
  const localTenant = await postJson("/v1/workspace_onboarding", localUser.cookie, {
    tenant: { name: `Local ${stamp}` },
    workspace: { name: `Local ${stamp}`, slug: `local-${stamp}` },
    runtime_provider: "local_docker",
    sandbox_provider: "local_docker",
    runtime_pool: { desired_size: 1, min_instances_per_function: 0, max_instances_per_function: 1, max_concurrency_per_instance: 1, cpu_milli: 250, memory_mb: 512 },
    sandbox_config: { local_docker: { image: "node:22-bookworm" } },
    sandbox_pool: { desired_size: 1, standby_ttl_ms: 60_000 },
    model_config_ids: [],
    api_key: { display_name: "local", scopes: ["control_plane"] },
    provider_credentials: {}
  });
  const blocked = await postRaw("/v1/workspaces", localUser.cookie, {
    tenant_id: localTenant.tenant.id,
    workspace: { name: `Blocked ${stamp}`, slug: `blocked-${stamp}` },
    runtime_provider: "vefaas",
    sandbox_provider: "e2b",
    runtime_pool: { desired_size: 1, min_instances_per_function: 0, max_instances_per_function: 1, max_concurrency_per_instance: 1, cpu_milli: 250, memory_mb: 512 },
    sandbox_config: {},
    sandbox_pool: { desired_size: 1, standby_ttl_ms: 60_000 },
    model_config_ids: [],
    custom_model_configs: customModelConfigs,
    api_key: { display_name: "blocked", scopes: ["control_plane"] },
    provider_credentials: { vefaas: { VOLCENGINE_ACCESS_KEY: "body-ak", VOLCENGINE_SECRET_KEY: "body-sk", VEFAAS_REGION: "cn-beijing" }, e2b: { E2B_API_KEY: "e2b-key" } }
  });
  assert.equal(blocked.status, 400);
  assert.equal((await blocked.json()).error, "cloud_provider_not_connected");
} finally {
  server.kill("SIGTERM");
}

async function waitForHealth() {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try { const response = await fetch(`${apiBase}/health`); if (response.ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`server did not become healthy: ${serverOutput}`);
}
async function login(email: string) {
  const response = await requestRaw("/v1/auth/login", { method: "POST", body: JSON.stringify({ provider: "local", email, name: email.split("@")[0] }) });
  await assertResponseOk(response);
  return { ...(await response.json()), cookie: response.headers.get("set-cookie")?.split(";")[0] ?? "" };
}
async function getJson(path: string, cookie: string) {
  const response = await requestRaw(path, { headers: { cookie } });
  await assertResponseOk(response);
  return response.json() as Promise<any>;
}
async function getText(path: string, cookie: string) {
  const response = await requestRaw(path, { headers: { cookie } });
  await assertResponseOk(response);
  return response.text();
}
async function postJson(path: string, cookie: string, body: unknown) {
  const response = await requestRaw(path, { method: "POST", headers: { cookie }, body: JSON.stringify(body) });
  await assertResponseOk(response);
  return response.json() as Promise<any>;
}
async function postRaw(path: string, cookie: string, body: unknown) {
  return requestRaw(path, { method: "POST", headers: { cookie }, body: JSON.stringify(body) });
}
async function assertResponseOk(response: Response) {
  if (response.status >= 200 && response.status < 300) return;
  assert.fail(await response.text());
}
async function requestRaw(path: string, init: RequestInit = {}) {
  try {
    return await fetch(`${apiBase}${path}`, {
      ...init,
      signal: AbortSignal.timeout(requestTimeoutMs),
      headers: {
        "content-type": "application/json",
        ...(init.headers ?? {})
      }
    });
  } catch (error) {
    throw new Error(`${init.method || "GET"} ${path} request failed: ${error instanceof Error ? error.message : String(error)}\n${serverOutput}`);
  }
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

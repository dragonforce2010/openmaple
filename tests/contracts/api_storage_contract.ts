import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import "../../apps/control-plane-api/src/env";
import { db, initDatabase } from "../../apps/control-plane-api/src/store";
import { deleteObject, readObject } from "../../apps/control-plane-api/src/objectStorage";
import { workspaceTosCreds } from "../../apps/control-plane-api/src/files/workspaceStorage";
import { writeFakeVefaasRuntimeDeployScript } from "./helpers/fakeVefaasDeploy";

const dataDir = mkdtempSync(join(tmpdir(), "maple-api-storage-"));
const deployScript = writeFakeVefaasRuntimeDeployScript(dataDir, "https://example.invalid/maple-runtime");
const port = 22_000 + Math.floor(Math.random() * 2000);
const apiBase = `http://127.0.0.1:${port}`;
const email = `api-storage-${Date.now()}@example.invalid`;
const stamp = Date.now().toString(36);
const reusableTosBucket = process.env.MAPLE_TEST_TOS_BUCKET || process.env.MAPLE_TOS_BUCKET || process.env.DATABASE_TOS_BUCKET || "";
const seedNames = [
  "e2b-cloud-sandbox",
  "mac-local-docker",
  "volcengine-vefaas-runtime",
  "Engineering Agent",
  "Research Agent",
  "Project Memory",
  "Local Development Vault"
];
const bundledDefaultModelNames = [
  "glm-4-7-251222",
  "doubao-seed-1-6-flash-250615",
  "doubao-seed-2-0-lite-260428",
  "deepseek-v4-flash-260425"
];

const server = spawn("bun", ["apps/control-plane-api/src/index.ts"], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    PORT: String(port),
    HOST: "127.0.0.1",
    MAPLE_VEFAAS_RUNTIME_DEPLOY_SCRIPT: deployScript,
    MAPLE_DEV_LOGIN: "true"
  },
  stdio: ["ignore", "pipe", "pipe"]
});

let serverOutput = "";
let userId = "";
let workspaceId = "";
let tenantId = "";
let file: Record<string, unknown> | null = null;
server.stdout.on("data", (chunk) => (serverOutput += String(chunk)));
server.stderr.on("data", (chunk) => (serverOutput += String(chunk)));

try {
  await waitForHealth();
  initDatabase();
  assert.equal(countRows("environments", "name", seedNames), 0, "initDatabase must not seed default environments");
  assert.equal(countRows("agent_templates", "name", seedNames), 0, "initDatabase must not seed default agent_templates");
  assert.equal(countRows("memory_stores", "name", seedNames), 0, "initDatabase must not seed default memory stores");
  assert.equal(countRows("vaults", "display_name", seedNames), 0, "initDatabase must not seed default vaults");

  const loginResponse = await fetch(`${apiBase}/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ provider: "local", email, name: "API Storage Contract" })
  });
  await assertStatus(loginResponse, 201);
  const cookie = readCookie(loginResponse);
  assert.match(cookie, /^maple_session=/);
  const login = await loginResponse.json();
  userId = String(login.user.id);

  const configs = await getJson(`${apiBase}/v1/model_configs`, cookie);
  const configItems = configs.data as Array<Record<string, unknown>>;
  const defaultModelNames = configItems.map((item) => item.model_name);
  assert.ok(defaultModelNames.includes("glm-4-7-251222"), "model config listing must ensure GLM-4.7");
  assert.ok(defaultModelNames.includes("doubao-seed-1-6-flash-250615"), "model config listing must ensure Doubao Seed Flash");
  assert.ok(defaultModelNames.includes("doubao-seed-2-0-lite-260428"), "model config listing must ensure Doubao Seed 2.0 Lite Multimodal");
  assert.ok(defaultModelNames.includes("deepseek-v4-flash-260425"), "model config listing must ensure DeepSeek V4 Flash");
  const bundledDefaultConfigs = bundledDefaultModelNames.map((name) => configItems.find((item) => item.model_name === name));
  for (const config of configItems) {
    assert.equal(config.api_key_ref, undefined);
    assert.equal(config.api_key_ciphertext, undefined);
  }
  for (const config of bundledDefaultConfigs) {
    assert.ok(config, "model config listing must include bundled VolcoEngine defaults");
    if (process.env.ARK_API_KEY) {
      assert.equal(config.has_api_key, true);
      assert.match(config.api_key_hint, /^[^*]{3}\.\.\./);
    }
  }
  const selectedDefaultConfig = bundledDefaultConfigs[0]!;

  const workspaceResponse = await fetch(`${apiBase}/v1/workspaces`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({
      workspace: { name: `API Storage Workspace ${stamp}`, description: "api storage contract", slug: `api-storage-${stamp}` },
      runtime_provider: "vefaas",
      runtime_pool: {
        desired_size: 1,
        max_instances_per_function: 100,
        max_concurrency_per_instance: 100,
        cpu_milli: 2000,
        memory_mb: 4096
      },
      sandbox_provider: "e2b",
      model_config_ids: [String(selectedDefaultConfig.id)],
      api_key: { display_name: "API storage workspace key", scopes: ["control_plane", "data_plane"] },
      provider_credentials: {
        vefaas: {
          VOLCENGINE_ACCESS_KEY: process.env.VOLCENGINE_ACCESS_KEY || process.env.VOLC_ACCESSKEY || "contract-access-key",
          VOLCENGINE_SECRET_KEY: process.env.VOLCENGINE_SECRET_KEY || process.env.VOLC_SECRETKEY || "contract-secret-key",
          VEFAAS_REGION: process.env.MAPLE_VEFAAS_REGION || process.env.VEFAAS_REGION || "cn-beijing"
        },
        e2b: { E2B_API_KEY: process.env.E2B_API_KEY || "contract-e2b-key" }
      }
    })
  });
  await assertStatus(workspaceResponse, 201);
  const workspaceCreated = await workspaceResponse.json();
  workspaceId = String(workspaceCreated.workspace.id);
  tenantId = String(workspaceCreated.workspace.tenant_id || "");
  seedReusableBucket(workspaceId);

  const modelSecret = `contract-secret-${Date.now()}`;
  const modelResponse = await fetch(`${apiBase}/v1/model_configs`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({
      workspace_id: workspaceId,
      kind: "custom",
      name: "Contract GLM",
      base_url: "https://ark.cn-beijing.volces.com/api/v3",
      model_name: "glm-4-7-251222",
      api_key: modelSecret
    })
  });
  await assertStatus(modelResponse, 201);
  const modelConfig = await modelResponse.json();
  assert.equal(modelConfig.has_api_key, true);
  assert.equal(modelConfig.api_key_ref, undefined);
  assert.equal(modelConfig.api_key_ciphertext, undefined);
  assert.match(modelConfig.api_key_hint, /^con\.\.\./);
  const dbModel = db
    .prepare("SELECT api_key_ref, api_key_ciphertext, api_key_hint FROM model_configs WHERE id = ? AND owner_user_id = ?")
    .get(String(modelConfig.id), userId) as Record<string, unknown> | undefined;
  assert.equal(dbModel?.api_key_ref, null);
  assert.equal(dbModel?.api_key_hint, modelConfig.api_key_hint);
  assert.ok(String(dbModel?.api_key_ciphertext || "").includes("aes-256-gcm"));
  assert.ok(!String(dbModel?.api_key_ciphertext || "").includes(modelSecret));

  const uploadResponse = await fetch(`${apiBase}/v1/files?filename=contract.txt`, {
    method: "POST",
    headers: { cookie, "content-type": "text/plain" },
    body: "maple api storage contract"
  });
  await assertStatus(uploadResponse, 201);
  file = await uploadResponse.json();
  assert.equal(file.storage_provider, "tos");
  const workspaceRow = db.prepare("SELECT config_json FROM workspaces WHERE id = ?").get(workspaceId) as Record<string, unknown>;
  const workspaceConfig = JSON.parse(String(workspaceRow.config_json || "{}"));
  assert.equal(file.bucket, workspaceConfig.tos_bucket);
  if (reusableTosBucket) {
    assert.equal(file.bucket, reusableTosBucket);
  } else {
    assert.match(String(file.bucket), /^maple-api-storage-/);
  }
  assert.ok(file.object_key);

  const metadata = await getJson(`${apiBase}/v1/files/${file.id}`, cookie);
  assert.equal(metadata.object_key, file.object_key);
  const fileCreds = { ...workspaceTosCreds(workspaceId)!, bucket: String(file.bucket) };
  const body = Buffer.from(await readObject(fileCreds, String(file.object_key))).toString("utf8");
  assert.equal(body, "maple api storage contract");

  const dbFile = db
    .prepare("SELECT id, storage_provider, bucket, object_key FROM managed_files WHERE id = ?")
    .get(String(file.id)) as Record<string, unknown> | undefined;
  assert.equal(dbFile?.object_key, file.object_key);

  console.log("api storage contract passed");
} finally {
  if (file?.object_key) {
    try {
      await deleteObject({ ...workspaceTosCreds(workspaceId)!, bucket: String(file.bucket) }, String(file.object_key));
    } catch (error) {
      console.error(`cleanup_tos_failed:${String(file.object_key)}:${error instanceof Error ? error.message : String(error)}`);
    }
    db.prepare("DELETE FROM managed_files WHERE id = ?").run(String(file.id));
  }
  if (userId) {
    cleanupWorkspaceRecords();
    db.prepare("DELETE FROM auth_sessions WHERE user_id = ?").run(userId);
    db.prepare("DELETE FROM model_configs WHERE owner_user_id = ?").run(userId);
    db.prepare("DELETE FROM users WHERE id = ?").run(userId);
  } else {
    const user = db.prepare("SELECT id FROM users WHERE email = ?").get(email) as { id: string } | undefined;
    if (user?.id) {
      cleanupWorkspaceRecords();
      db.prepare("DELETE FROM auth_sessions WHERE user_id = ?").run(user.id);
      db.prepare("DELETE FROM model_configs WHERE owner_user_id = ?").run(user.id);
      db.prepare("DELETE FROM users WHERE id = ?").run(user.id);
    }
  }
  server.kill();
}

function countRows(table: string, column: string, names: string[]) {
  const placeholders = names.map(() => "?").join(",");
  const row = db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE ${column} IN (${placeholders})`).get(...names) as { count: number };
  return Number(row.count);
}

function cleanupWorkspaceRecords() {
  if (!workspaceId) return;
  db.prepare("DELETE FROM model_configs WHERE workspace_id = ?").run(workspaceId);
  db.prepare("DELETE FROM environments WHERE workspace_id = ?").run(workspaceId);
  db.prepare("DELETE FROM workspace_api_keys WHERE workspace_id = ?").run(workspaceId);
  db.prepare("DELETE FROM workspace_runtime_pool_members WHERE workspace_id = ?").run(workspaceId);
  db.prepare("DELETE FROM workspace_runtime_pools WHERE workspace_id = ?").run(workspaceId);
  db.prepare("DELETE FROM workspace_members WHERE workspace_id = ?").run(workspaceId);
  db.prepare("DELETE FROM workspaces WHERE id = ?").run(workspaceId);
  if (tenantId) {
    db.prepare("DELETE FROM tenant_members WHERE tenant_id = ?").run(tenantId);
    db.prepare("DELETE FROM tenants WHERE id = ?").run(tenantId);
  }
}

function seedReusableBucket(id: string) {
  if (!reusableTosBucket) return;
  const row = db.prepare("SELECT config_json FROM workspaces WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  const config = JSON.parse(String(row?.config_json || "{}"));
  db.prepare("UPDATE workspaces SET config_json = ?, updated_at = ? WHERE id = ?").run(
    JSON.stringify({ ...config, tos_bucket: reusableTosBucket }),
    new Date().toISOString(),
    id
  );
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

import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { createServer, type IncomingMessage } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dataDir = mkdtempSync(join(tmpdir(), "maple-aliyun-orchestration-"));
process.env.MAPLE_DATA_DIR = dataDir;
process.env.MAPLE_AGENT_RUNTIME_PROVIDER = "local";
process.env.MAPLE_SANDBOX_POOL_AUTOREPLENISH = "false";
process.env.MAPLE_ALIYUN_CREDENTIAL_VALIDATION = "off";
process.env.MAPLE_VOLCENGINE_CREDENTIAL_VALIDATION = "off";
delete process.env.E2B_API_KEY;

const fcRequests: Array<{ action: string; body: Record<string, unknown> }> = [];
const fcServer = createServer(async (request, response) => {
  const body = parseBody(await readBody(request));
  fcRequests.push({ action: String(body.action || ""), body });
  response.setHeader("Content-Type", "application/json");
  response.end(JSON.stringify({ ok: true, result: { stdout: "aliyun-fc-ok", stderr: "", exit_code: 0 } }));
});
const { port: fcPort } = await listen(fcServer);
const fcInvokeUrl = `http://127.0.0.1:${fcPort}/invoke`;

try {
  await import("../../apps/control-plane-api/src/env");
  const store = await import("../../apps/control-plane-api/src/store");
  const runtime = await import("../../apps/control-plane-api/src/runtime");
  const runner = await import("../../apps/control-plane-api/src/runtime/runner");
  const artifacts = await import("../../apps/control-plane-api/src/files/artifacts");
  const workspaceStorage = await import("../../apps/control-plane-api/src/files/workspaceStorage");
  const objectStorage = await import("../../apps/control-plane-api/src/files/objectStorage");

  store.initDatabase();

  const user = store.ensureUserByEmail({ email: "aliyun-orchestration-contract@example.com", name: "Aliyun Orchestration Contract" });
  assert.ok(user?.id);
  const onboarding = store.createWorkspaceOnboarding({
    user_id: String(user.id),
    tenant: { name: "Aliyun Orchestration Tenant" },
    workspace: { name: "Aliyun Orchestration Workspace", slug: `aliyun-orch-${Date.now().toString(36)}` },
    runtime_provider: "local_docker",
    runtime_pool: { desired_size: 0, min_instances_per_function: 0, max_instances_per_function: 1, max_concurrency_per_instance: 1, cpu_milli: 1000, memory_mb: 1024 },
    runtime_pools: [{ provider: "local_docker", role: "primary", priority: 0, desired_size: 0, min_instances_per_function: 0, max_instances_per_function: 1, max_concurrency_per_instance: 1, cpu_milli: 1000, memory_mb: 1024 }],
    sandbox_provider: "daytona",
    sandbox_config: {
      daytona: { server_url: "https://daytona.example.invalid", api_key: "daytona-contract-key" },
      aliyun_fc: { invoke_url: fcInvokeUrl, function_name: "maple-contract-fc", region: "cn-hangzhou", workspace_path: "/tmp/maple-workspace" }
    },
    sandbox_pool: { desired_size: 1, standby_ttl_ms: 60_000 },
    sandbox_pools: [
      { provider: "daytona", role: "primary", priority: 0, desired_size: 1, standby_ttl_ms: 60_000, config: { server_url: "https://daytona.example.invalid", api_key: "daytona-contract-key" } },
      { provider: "aliyun_fc", role: "standby", priority: 10, desired_size: 1, standby_ttl_ms: 60_000, config: { invoke_url: fcInvokeUrl, function_name: "maple-contract-fc" } }
    ],
    artifact_provider: "oss",
    object_storage: { provider: "oss", bucket: "maple-contract-oss", endpoint: "oss-cn-hangzhou.aliyuncs.com" },
    model_config_ids: [],
    api_key: { display_name: "contract key", scopes: ["control_plane", "data_plane"] },
    provider_credentials: {
      aliyun: { ALIYUN_ACCESS_KEY_ID: "aliyun-contract-ak", ALIYUN_ACCESS_KEY_SECRET: "aliyun-contract-sk", ALIYUN_REGION: "cn-hangzhou" }
    }
  });
  const workspace = onboarding.workspace as Record<string, unknown>;
  const workspaceId = String(workspace.id);

  const replenish = await runtime.replenishWorkspaceSandboxPool(workspaceId);
  assert.equal((replenish as Record<string, unknown>).created, 1);
  const sandboxPools = store.listWorkspaceSandboxPools(workspaceId) as Array<Record<string, unknown>>;
  assert.equal(sandboxPools[0].provider, "daytona");
  assert.equal(sandboxPools[0].role, "primary");
  assert.equal(sandboxPools[1].provider, "aliyun_fc");
  assert.equal(sandboxPools[1].role, "standby");

  const environment = (store.listEnvironments(workspaceId) as Array<Record<string, unknown>>).find((item) => ((item.config as Record<string, unknown>).sandbox as Record<string, unknown>)?.provider === "daytona");
  assert.ok(environment?.id);
  const agent = store.createAgent({
    workspace_id: workspaceId,
    config: {
      name: "Aliyun Sandbox Fallback Agent",
      description: "Contract agent",
      model: { provider: "custom", id: "contract-model" },
      system: "Use tools.",
      tools: [],
      mcp_servers: [],
      skills: []
    }
  });
  const session = store.createSession({ agent_id: String(agent.id), environment_id: String(environment.id), workspace_id: workspaceId, title: "aliyun-sandbox-fallback" });
  assert.ok(session?.id);

  const sandboxRuntime = await runtime.ensureSessionSandboxRuntime(String(session.id));
  assert.equal(sandboxRuntime.type, "aliyun_fc_sandbox");
  assert.equal((sandboxRuntime as Record<string, unknown>).pooled, true);
  assert.ok((sandboxRuntime as Record<string, unknown>).pool_member_id);
  assert.equal(fcRequests.some((item) => item.action === "bootstrap"), true);

  await runner.runRuntimeToolCall(String(session.id), "bash", { command: "pwd" });
  const toolRequest = fcRequests.find((item) => item.action === "tool" && item.body.tool === "bash");
  assert.equal(toolRequest?.body.session_id, session.id);
  assert.deepEqual(toolRequest?.body.input, { command: "pwd" });

  const claimedAliyunMembers = (store.listWorkspaceSandboxPoolMembers(workspaceId, "aliyun_fc") as Array<Record<string, unknown>>).filter((member) => member.status === "claimed");
  assert.equal(claimedAliyunMembers.length, 1);
  assert.equal(claimedAliyunMembers[0].claimed_session_id, session.id);

  const ossCreds = workspaceStorage.workspaceObjectStorageCreds(workspaceId, "oss");
  assert.equal(ossCreds?.provider, "oss");
  assert.equal(ossCreds?.bucket, "maple-contract-oss");
  const signed = await objectStorage.presignedObjectUrl({ ...ossCreds!, bucket: "maple-contract-oss" }, "session-artifacts/demo/report.txt");
  assert.match(signed, /maple-contract-oss/);
  assert.match(signed, /OSSAccessKeyId=aliyun-contract-ak|AccessKeyId=aliyun-contract-ak/);

  store.upsertSessionArtifactRecord({
    session_id: String(session.id),
    path: "report.txt",
    filename: "report.txt",
    media_type: "text/plain",
    size_bytes: 12,
    sha256: "abc123",
    storage_provider: "oss",
    bucket: "maple-contract-oss",
    object_key: "session-artifacts/demo/report.txt"
  });
  let redirectUrl = "";
  await artifacts.downloadArtifact(
    { params: { sessionId: String(session.id), path: "report.txt" } } as never,
    {
      status(code: number) {
        throw new Error(`unexpected artifact status ${code}`);
      },
      json(body: unknown) {
        throw new Error(`unexpected artifact json ${JSON.stringify(body)}`);
      },
      redirect(url: string) {
        redirectUrl = url;
      },
      sendFile(path: string) {
        throw new Error(`unexpected local artifact ${path}`);
      }
    } as never
  );
  assert.match(redirectUrl, /maple-contract-oss/);
  assert.match(redirectUrl, /session-artifacts\/demo\/report\.txt/);

  console.log("aliyun provider orchestration contract passed");
} finally {
  await closeServer(fcServer);
}

function parseBody(text: string): Record<string, unknown> {
  try {
    return JSON.parse(text || "{}") as Record<string, unknown>;
  } catch {
    return {};
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

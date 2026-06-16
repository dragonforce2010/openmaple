import { createHash } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { loadProjectEnv } from "../../apps/control-plane-api/src/env";

loadProjectEnv();

const invokeUrl = process.env.VEFAAS_INVOKE_URL || process.env.MAPLE_VEFAAS_INVOKE_URL || "";
if (!invokeUrl) {
  console.log("SKIP veFaaS real e2e: VEFAAS_INVOKE_URL/MAPLE_VEFAAS_INVOKE_URL is not set in environment or project .env");
  process.exit(0);
}

const dataDir = mkdtempSync(join(tmpdir(), "maple-vefaas-real-"));
process.env.MAPLE_DATA_DIR = dataDir;
process.env.VEFAAS_INVOKE_URL = invokeUrl;
process.env.VEFAAS_API_KEY = process.env.VEFAAS_API_KEY || process.env.MAPLE_VEFAAS_API_KEY || "";
process.env.VEFAAS_FUNCTION_ID = process.env.VEFAAS_FUNCTION_ID || process.env.MAPLE_VEFAAS_FUNCTION_ID || "managed-agents-runtime";
process.env.VEFAAS_REGION = process.env.VEFAAS_REGION || process.env.MAPLE_VEFAAS_REGION || "cn-beijing";
process.env.VEFAAS_WORKSPACE_PATH = process.env.VEFAAS_WORKSPACE_PATH || process.env.MAPLE_VEFAAS_WORKSPACE_PATH || "/workspace";
process.env.VEFAAS_TIMEOUT_MS = process.env.VEFAAS_TIMEOUT_MS || process.env.MAPLE_VEFAAS_TIMEOUT_MS || "120000";
const e2bApiKey = process.env.E2B_API_KEY || "";
if (!e2bApiKey) {
  console.log("SKIP veFaaS + E2B real e2e: E2B_API_KEY is not set in environment or project .env");
  process.exit(0);
}

const store = await import("../../apps/control-plane-api/src/store");
const runtime = await import("../../apps/control-plane-api/src/runtime");
const objectStorage = await import("../../apps/control-plane-api/src/objectStorage");

let agentId = "";
let environmentId = "";
let sessionId = "";
let sandboxId = "";
let fileObjectKey = "";
const fileId = "file_real_vefaas_fixture";

try {
  store.initDatabase();
  const fixtureContent = Buffer.from("checkout latency spike from real veFaaS e2e\n");
  const sha256 = createHash("sha256").update(fixtureContent).digest("hex");
  const stored = await objectStorage.putObject({
    key: objectStorage.objectKey("managed-files", fileId, "app.log"),
    body: fixtureContent,
    contentType: "text/plain",
    metadata: { sha256, filename: "app.log" }
  });
  fileObjectKey = stored.key;
  store.createManagedFileRecord({
    id: fileId,
    filename: "app.log",
    media_type: "text/plain",
    bytes: fixtureContent.length,
    sha256,
    storage_provider: stored.provider,
    bucket: stored.bucket,
    object_key: stored.key,
    public_url: stored.public_url,
    metadata: { source: "vefaas-real-e2e" }
  });

  const agent = store.createAgent({
    config: {
      name: "Real veFaaS E2E Agent",
      description: "Real Volcengine veFaaS runtime e2e agent",
      model: { provider: "custom", id: "glm-4-7-251222" },
      system: "Use runtime tools.",
      tools: [{ type: "agent_toolset_20260401", default_config: { enabled: true } }],
      mcp_servers: [],
      skills: [],
      agent_loop: { type: "anthropic_claude_code", config: {}, hooks: [] }
    }
  });
  assert.ok(agent?.id);
  agentId = String(agent.id);

  const environment = store.createEnvironment({
    name: "real-vefaas-e2e-env",
    config: {
      type: "managed_agent",
      agent_runtime: {
        provider: "vefaas",
        vefaas: {
          invoke_url: process.env.VEFAAS_INVOKE_URL,
          api_key: process.env.VEFAAS_API_KEY,
          function_id: process.env.VEFAAS_FUNCTION_ID,
          region: process.env.VEFAAS_REGION,
          workspace_path: process.env.VEFAAS_WORKSPACE_PATH,
          timeout_ms: Number(process.env.VEFAAS_TIMEOUT_MS)
        }
      },
      sandbox: {
        provider: "e2b",
        e2b: {
          api_key: e2bApiKey,
          template: process.env.E2B_TEMPLATE || "base",
          workspace_path: process.env.E2B_WORKSPACE_PATH || "/workspace",
          timeout_ms: Number(process.env.E2B_TIMEOUT_MS || 3_600_000)
        }
      }
    }
  });
  assert.ok(environment?.id);
  environmentId = String(environment.id);

  const session = store.createSession({
    agent_id: agentId,
    environment_id: environmentId,
    title: "real veFaaS e2e session",
    metadata: { resources: [{ type: "file", file_id: fileId, mount_path: "app.log" }] }
  });
  assert.ok(session?.id);
  sessionId = String(session.id);

  const runtimeInfo = await runtime.markRuntimeReady(sessionId);
  assert.equal(runtimeInfo.type, "e2b");
  assert.ok("sandbox_id" in runtimeInfo && runtimeInfo.sandbox_id);
  sandboxId = String(runtimeInfo.sandbox_id);
  const readySession = store.getSession(sessionId);
  const metadata = readySession?.metadata as Record<string, unknown>;
  assert.equal((metadata.agent_runtime as Record<string, unknown>)?.type, "vefaas");
  assert.equal((metadata.sandbox_runtime as Record<string, unknown>)?.type, "e2b");

  const bash = (await runtime.executeTool(sessionId, "bash", { command: "printf managed-agents-e2b-ok" })) as Record<string, unknown>;
  assert.equal(String(bash.stdout || "").trim(), "managed-agents-e2b-ok");

  const grep = (await runtime.executeTool(sessionId, "grep", { pattern: "checkout", path: "/mnt/session/uploads/app.log" })) as Record<string, unknown>;
  assert.ok(JSON.stringify(grep).includes("checkout"));

  console.log(`veFaaS + E2B real e2e passed session=${sessionId} sandbox=${sandboxId}`);
} finally {
  if (!sandboxId && sessionId) {
    const current = store.getSession(sessionId);
    const metadata = (current?.metadata || {}) as Record<string, unknown>;
    const runtimeInfo = (metadata.sandbox_runtime || metadata.runtime || {}) as Record<string, unknown>;
    if (runtimeInfo.sandbox_id) sandboxId = String(runtimeInfo.sandbox_id);
  }
  if (sandboxId) {
    const { Sandbox } = await import("e2b");
    try {
      const sandbox = await Sandbox.connect(sandboxId, { apiKey: e2bApiKey });
      await sandbox.kill();
      console.log(`cleaned E2B sandbox=${sandboxId}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/not found|does not exist|404/i.test(message)) throw error;
    }
  }
  if (sessionId) {
    store.db.prepare("DELETE FROM session_artifacts WHERE session_id = ?").run(sessionId);
    store.db.prepare("DELETE FROM tool_calls WHERE session_id = ?").run(sessionId);
    store.db.prepare("DELETE FROM session_events WHERE session_id = ?").run(sessionId);
    store.db.prepare("DELETE FROM session_threads WHERE session_id = ?").run(sessionId);
    store.db.prepare("DELETE FROM sessions WHERE id = ?").run(sessionId);
  }
  if (environmentId) store.db.prepare("DELETE FROM environments WHERE id = ?").run(environmentId);
  if (agentId) {
    store.db.prepare("DELETE FROM agent_versions WHERE agent_id = ?").run(agentId);
    store.db.prepare("DELETE FROM agents WHERE id = ?").run(agentId);
  }
  store.db.prepare("DELETE FROM managed_files WHERE id = ?").run(fileId);
  if (fileObjectKey) {
    await objectStorage.deleteObject(fileObjectKey);
    console.log(`cleaned TOS object=${fileObjectKey}`);
  }
}

import { createServer, type IncomingMessage } from "node:http";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";

type RecordedRequest = {
  headers: IncomingMessage["headers"];
  body: Record<string, unknown>;
};

const requests: RecordedRequest[] = [];
const bridgeRequests: RecordedRequest[] = [];

const server = createServer(async (request, response) => {
  const body = JSON.parse((await readBody(request)) || "{}") as Record<string, unknown>;
  requests.push({ headers: request.headers, body });
  response.setHeader("Content-Type", "application/json");

  if (body.action === "bootstrap") {
    response.end(JSON.stringify({ ok: true, result: { runtime: "ready", resources: body.resources } }));
    return;
  }

  if (body.action === "tool") {
    const input = (body.input && typeof body.input === "object" ? body.input : {}) as Record<string, unknown>;
    const result =
      body.tool === "bash"
        ? { stdout: `ran ${input.command}`, stderr: "", exit_code: 0 }
        : body.tool === "read_file"
          ? { path: input.path, content: "contract file content" }
          : body.tool === "write_file"
            ? { path: input.path, bytes: String(input.content || "").length }
            : body.tool === "list_files"
              ? { path: input.path, files: ["app.log", "notes.md"] }
              : body.tool === "grep"
                ? { pattern: input.pattern, path: input.path, matches: ["app.log:1:checkout"] }
                : { error: `unknown tool ${body.tool}` };
    response.end(JSON.stringify({ ok: true, result }));
    return;
  }

  if (body.action === "run") {
    const bridge = (body.tool_bridge && typeof body.tool_bridge === "object" ? body.tool_bridge : {}) as Record<string, unknown>;
    assert.equal((body.agent_config as Record<string, unknown>)?.name, "veFaaS Contract Agent");
    assert.equal(((body.agent_config as Record<string, unknown>)?.agent_loop as Record<string, unknown>)?.type, "anthropic_claude_code");
    assert.deepEqual(
      (((body.agent_config as Record<string, unknown>)?.agent_loop as Record<string, unknown>)?.config as Record<string, unknown>)?.tools,
      ["AskUserQuestion", "Bash", "Edit", "Glob", "Grep", "Read", "Write"]
    );
    assert.equal((body.agent_env as Record<string, unknown>)?.MAPLE_AGENT_LOOP_TYPE, "anthropic_claude_code");
    assert.ok(String((body.agent_env as Record<string, unknown>)?.MAPLE_AGENT_TEMPLATE || "").includes("veFaaS Contract Agent"));
    assert.ok(String(bridge.url || "").includes(`/v1/runtime/sessions/${body.session_id}/tools`));

    const toolResponse = await fetch(String(bridge.url), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${bridge.token}`
      },
      body: JSON.stringify({ tool: "list_files", input: { path: "." } })
    });
    assert.equal(toolResponse.ok, true);
    const toolBody = (await toolResponse.json()) as Record<string, unknown>;
    response.end(
      JSON.stringify({
        ok: true,
        result: {
          message: {
            content: `veFaaS loop answered after sandbox files: ${JSON.stringify((toolBody.output as Record<string, unknown>)?.files ?? [])}`
          },
          events: [
            { type: "assistant", message: { content: [{ type: "text", text: "streamed from fake veFaaS runtime" }] } },
            { type: "result", result: "veFaaS result" }
          ],
          usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 }
        }
      })
    );
    return;
  }

  response.statusCode = 400;
  response.end(JSON.stringify({ ok: false, error: "unknown action" }));
});

const { port } = await listen(server);
let expectedBridgeToken = "";
const bridgeServer = createServer(async (request, response) => {
  const body = JSON.parse((await readBody(request)) || "{}") as Record<string, unknown>;
  bridgeRequests.push({ headers: request.headers, body });
  response.setHeader("Content-Type", "application/json");
  if (request.headers.authorization !== `Bearer ${expectedBridgeToken}`) {
    response.statusCode = 401;
    response.end(JSON.stringify({ ok: false, error: "invalid token" }));
    return;
  }
  response.end(JSON.stringify({ ok: true, status: "completed", output: { path: body.input && (body.input as Record<string, unknown>).path, files: ["sandbox-note.md"] } }));
});
const { port: bridgePort } = await listen(bridgeServer);
const dataDir = mkdtempSync(join(tmpdir(), "maple-vefaas-contract-"));
process.env.MAPLE_DATA_DIR = dataDir;
process.env.VEFAAS_INVOKE_URL = `http://127.0.0.1:${port}/invoke`;
process.env.VEFAAS_API_KEY = "contract-vefaas-key";
process.env.VEFAAS_FUNCTION_ID = "contract-function";
process.env.VEFAAS_REGION = "cn-test";
process.env.VEFAAS_WORKSPACE_PATH = "/workspace";
process.env.VEFAAS_TIMEOUT_MS = "30000";
process.env.MAPLE_RUNTIME_TOOL_BRIDGE_BASE_URL = `http://127.0.0.1:${bridgePort}`;
process.env.MAPLE_AGENT_LOOP_EXECUTION = "external";

let storeModule: typeof import("../../apps/control-plane-api/src/store") | null = null;
let agentId = "";
let environmentId = "";
let sessionId = "";

try {
  await import("../../apps/control-plane-api/src/env");
  const store = await import("../../apps/control-plane-api/src/store");
  storeModule = store;
  const runtime = await import("../../apps/control-plane-api/src/runtime");
  const runner = await import("../../apps/control-plane-api/src/runner");
  const paths = await import("../../apps/control-plane-api/src/paths");

  store.initDatabase();
  mkdirSync(paths.filesDir, { recursive: true });
  const fileContent = Buffer.from("checkout latency spike\n");

  const agent = store.createAgent({
    config: {
      name: "veFaaS Contract Agent",
      description: "veFaaS runtime contract test agent",
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
    name: "vefaas-contract-env",
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
          timeout_ms: 30000
        }
      },
      sandbox: {
        provider: "local_docker"
      }
    }
  });
  assert.ok(environment?.id);
  environmentId = String(environment.id);

  const session = store.createSession({
    agent_id: String(agent.id),
    environment_id: String(environment.id),
    title: "veFaaS contract session",
    metadata: { resources: [] }
  });
  assert.ok(session?.id);
  sessionId = String(session.id);
  const uploadDir = join(String(session.workspace_path), ".session", "uploads");
  mkdirSync(uploadDir, { recursive: true });
  writeFileSync(join(uploadDir, "app.log"), fileContent);

  const runtimeInfo = await runtime.markRuntimeReady(String(session.id));
  assert.equal(runtimeInfo.type, "vefaas");
  const readySession = store.getSession(String(session.id));
  assert.equal((readySession?.metadata as Record<string, unknown>)?.agent_runtime && ((readySession?.metadata as Record<string, unknown>).agent_runtime as Record<string, unknown>).type, "vefaas");
  assert.equal(runtime.sessionUsesVefaasAgentRuntime(String(session.id)), true);
  expectedBridgeToken = String((readySession?.metadata as Record<string, unknown>)?.runtime_tool_bridge_token || "");
  assert.ok(expectedBridgeToken);
  assert.equal(requests[0].body.action, "bootstrap");
  assert.equal(requests[0].headers.authorization, "Bearer contract-vefaas-key");
  assert.deepEqual((requests[0].body.resources as Array<Record<string, unknown>>)[0].mount_path, "/mnt/session/uploads/app.log");

  await runner.runUserMessage(String(session.id), "List the sandbox files.");

  const toolRequests = requests.filter((entry) => entry.body.action === "tool");
  const runRequests = requests.filter((entry) => entry.body.action === "run");
  const bootstrapRequests = requests.filter((entry) => entry.body.action === "bootstrap");
  assert.equal(bootstrapRequests.length, 1);
  assert.equal(toolRequests.length, 0, "tools must not be executed by veFaaS tool action when veFaaS hosts the agent loop");
  if (runRequests.length !== 1) {
    console.error(JSON.stringify(store.listSessionEvents(String(session.id)), null, 2));
  }
  assert.equal(runRequests.length, 1);
  assert.equal(bridgeRequests.length, 1);
  assert.equal(bridgeRequests[0].body.tool, "list_files");
  const messageEvent = (store.listSessionEvents(String(session.id)) as Array<Record<string, unknown>>).find((event) => event.type === "agent.message");
  assert.ok(JSON.stringify(messageEvent?.payload ?? {}).includes("veFaaS loop answered after sandbox files"));
  console.log("veFaaS runtime contract passed");
} finally {
  if (storeModule) {
    const db = storeModule.db;
    if (sessionId) {
      db.prepare("DELETE FROM tool_calls WHERE session_id = ?").run(sessionId);
      db.prepare("DELETE FROM session_artifacts WHERE session_id = ?").run(sessionId);
      db.prepare("DELETE FROM session_events WHERE session_id = ?").run(sessionId);
      db.prepare("DELETE FROM session_threads WHERE session_id = ?").run(sessionId);
      db.prepare("DELETE FROM sessions WHERE id = ?").run(sessionId);
    }
    if (environmentId) db.prepare("DELETE FROM environments WHERE id = ?").run(environmentId);
    if (agentId) {
      db.prepare("DELETE FROM agent_versions WHERE agent_id = ?").run(agentId);
      db.prepare("DELETE FROM agents WHERE id = ?").run(agentId);
    }
    db.prepare("DELETE FROM managed_files WHERE id = ?").run("file_contract_fixture");
  }
  server.close();
  bridgeServer.close();
}

function readBody(request: IncomingMessage) {
  return new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

function listen(input: ReturnType<typeof createServer>) {
  return new Promise<{ port: number }>((resolve) => {
    input.listen(0, "127.0.0.1", () => {
      const address = input.address();
      assert.ok(address && typeof address === "object");
      resolve({ port: address.port });
    });
  });
}

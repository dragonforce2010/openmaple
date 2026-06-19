import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { MapleClient } from "../../packages/sdk/index.mjs";

type RecordedRequest = {
  method: string;
  path: string;
  headers: IncomingMessage["headers"];
  body: Record<string, unknown>;
};

const requests: RecordedRequest[] = [];
const sessionId = "sess_mock_core";
let streamResponse: ServerResponse | null = null;
let postedEvents: Array<Record<string, unknown>> = [];

const server = createServer(async (request, response) => {
  const url = new URL(request.url || "/", "http://127.0.0.1");
  const body = await readJson(request);
  requests.push({ method: request.method || "GET", path: url.pathname, headers: request.headers, body });

  if (url.pathname === "/v1/sessions/sess_mock_core/events/stream") {
    assertAuth(request.headers);
    response.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive"
    });
    streamResponse = response;
    emitSse(response, "ready", { session_id: sessionId });
    return;
  }

  response.setHeader("Content-Type", "application/json");

  if (url.pathname === "/health") return json(response, { ok: true });
  if (url.pathname === "/v1/platform/version") return json(response, { version: "mock-core" });

  if (url.pathname === "/v1/auth/login" && request.method === "POST") {
    assert.equal(body.provider, "local");
    response.setHeader("Set-Cookie", "maple_session=maple_sess_mock_core; Path=/; HttpOnly");
    return json(response, { user: { id: "user_mock_core", email: body.email } }, 201);
  }

  if (url.pathname === "/v1/workspaces" && request.method === "GET") {
    assertAuth(request.headers);
    return json(response, { data: [{ id: "ws_mock_core", name: "Mock Workspace" }] });
  }

  if (url.pathname === "/v1/agents" && request.method === "POST") {
    assertAuth(request.headers);
    assert.equal(body.workspace_id, "ws_mock_core");
    return json(response, { id: "agent_mock_core", ...body }, 201);
  }

  if (url.pathname === "/v1/environments" && request.method === "POST") {
    assertAuth(request.headers);
    assert.equal(body.workspace_id, "ws_mock_core");
    return json(response, { id: "env_mock_core", ...body }, 201);
  }

  if (url.pathname === "/v1/sessions" && request.method === "POST") {
    assertAuth(request.headers);
    assert.equal(body.workspace_id, "ws_mock_core");
    return json(response, { id: sessionId, status: "running", ...body }, 201);
  }

  if (url.pathname === "/v1/sessions/sess_mock_core/events" && request.method === "POST") {
    assertAuth(request.headers);
    postedEvents = Array.isArray(body.events) ? (body.events as Array<Record<string, unknown>>) : [];
    queueMicrotask(() => {
      if (!streamResponse) return;
      emitSse(streamResponse, "message", {
        id: "evt_agent_message",
        type: "agent.message",
        session_id: sessionId,
        payload: { content: "mock agent response" }
      });
    });
    return json(response, {
      data: postedEvents.map((event, index) => ({ id: `evt_client_${index}`, session_id: sessionId, ...event }))
    });
  }

  if (url.pathname === "/v1/fail") {
    return json(response, { error: "mock_failure" }, 418);
  }

  return json(response, { error: "not_found", path: url.pathname }, 404);
});

try {
  const baseUrl = await listen(server);
  const client = new MapleClient({ baseUrl, workspaceId: "ws_mock_core" });

  assert.deepEqual(await client.health(), { ok: true });
  assert.deepEqual(await client.version(), { version: "mock-core" });

  const login = await client.loginLocal({ email: "core@example.invalid", name: "Core Mock" });
  assert.equal(login.token, "maple_sess_mock_core");

  const workspaces = await client.listWorkspaces();
  assert.equal(workspaces.data[0].id, "ws_mock_core");
  assert.equal(headerFor("/v1/workspaces", "cookie"), "maple_session=maple_sess_mock_core");

  const agent = await client.createAgent({ name: "Core Agent" });
  assert.equal(agent.workspace_id, "ws_mock_core");

  const apiKeyClient = client.withToken("maple_ws_mock_core");
  const environment = await apiKeyClient.createEnvironment({ name: "Core Environment" });
  assert.equal(environment.workspace_id, "ws_mock_core");
  assert.equal(headerFor("/v1/environments", "x-maple-api-key"), "maple_ws_mock_core");

  const seenEvents: Array<Record<string, unknown>> = [];
  const run = await client.createSessionAndStream(
    { agent: agent.id, environment_id: environment.id, title: "Core stream", message: "hello mock api" },
    { readyTimeoutMs: 1_000, onEvent: (event) => seenEvents.push(event as Record<string, unknown>) }
  );
  const finalEvent = await run.done;

  assert.equal(run.session.id, sessionId);
  assert.equal(postedEvents[0].type, "user.message");
  assert.deepEqual(postedEvents[0].content, [{ type: "text", text: "hello mock api" }]);
  assert.equal(finalEvent?.type, "agent.message");
  assert.equal(seenEvents.some((event) => event.type === "agent.message"), true);

  await assert.rejects(() => apiKeyClient.request("/v1/fail"), /mock_failure/);

  console.log("mock api core contract passed");
} finally {
  streamResponse?.end();
  server.close();
}

function listen(input: ReturnType<typeof createServer>) {
  return new Promise<string>((resolve) => {
    input.listen(0, "127.0.0.1", () => {
      const address = input.address();
      assert.ok(address && typeof address === "object");
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

function assertAuth(headers: IncomingMessage["headers"]) {
  const cookie = String(headers.cookie || "");
  const apiKey = String(headers["x-maple-api-key"] || "");
  assert.equal(cookie === "maple_session=maple_sess_mock_core" || apiKey === "maple_ws_mock_core", true);
}

function headerFor(path: string, name: string) {
  return requests.find((request) => request.path === path)?.headers[name.toLowerCase()];
}

function json(response: ServerResponse, body: Record<string, unknown>, status = 200) {
  response.statusCode = status;
  response.end(JSON.stringify(body));
}

function emitSse(response: ServerResponse, event: string, data: Record<string, unknown>) {
  response.write(`event: ${event}\n`);
  response.write(`data: ${JSON.stringify(data)}\n\n`);
}

function readJson(request: IncomingMessage) {
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    request.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8");
      resolve(text ? JSON.parse(text) as Record<string, unknown> : {});
    });
    request.on("error", reject);
  });
}

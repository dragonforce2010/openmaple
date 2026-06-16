import { EventEmitter } from "node:events";

export const defaultAgentLoopType = "anthropic_claude_code";

export function defineHarness(harness) {
  return harness;
}

function envValue(name) {
  return typeof process !== "undefined" && process.env ? process.env[name] : undefined;
}

export class MapleClient {
  constructor(options = {}) {
    this.baseUrl = String(options.baseUrl || options.baseURL || envValue("MAPLE_API_BASE_URL") || "https://sd8ihq8v316pc5mf9c1j0.apigateway-cn-beijing.volceapi.com").replace(/\/$/, "");
    this.token = options.token || options.apiKey || envValue("MAPLE_API_KEY") || "";
    this.workspaceId = options.workspaceId || options.workspace_id || envValue("MAPLE_WORKSPACE_ID") || "";
  }

  withToken(token) {
    return new MapleClient({ baseUrl: this.baseUrl, token, workspaceId: this.workspaceId });
  }

  async health() {
    return this.request("/health", { auth: false });
  }

  async version() {
    return this.request("/v1/platform/version", { auth: false });
  }

  async loginLocal({ email, name }) {
    const response = await fetch(`${this.baseUrl}/v1/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "local", email, name })
    });
    const body = await parseResponse(response);
    const cookie = response.headers.get("set-cookie") || "";
    const token = cookie.split(";").find((part) => part.trim().startsWith("maple_session="))?.trim().slice("maple_session=".length) || "";
    if (!token) throw new Error("Login succeeded but did not return maple_session cookie.");
    this.token = token;
    return { ...body, token };
  }

  async me() {
    return this.request("/v1/auth/me");
  }

  async listWorkspaces() {
    return this.request("/v1/workspaces");
  }

  async getWorkspaceRuntimePool(workspaceId) {
    return this.request(`/v1/workspaces/${encodeURIComponent(workspaceId)}/runtime_pool`);
  }

  async workspaceOnboardingStatus() {
    return this.request("/v1/workspace_onboarding/status");
  }

  async onboardWorkspace(input) {
    return this.request("/v1/workspace_onboarding", { method: "POST", body: input });
  }

  async createWorkspace(input) {
    return this.request("/v1/workspaces", { method: "POST", body: input });
  }

  async listTenantMembers(tenantId) {
    return this.request(`/v1/tenants/${encodeURIComponent(tenantId)}/members`);
  }

  async addTenantMember(tenantId, input) {
    return this.request(`/v1/tenants/${encodeURIComponent(tenantId)}/members`, { method: "POST", body: input });
  }

  async removeTenantMember(tenantId, userId) {
    return this.request(`/v1/tenants/${encodeURIComponent(tenantId)}/members/${encodeURIComponent(userId)}`, { method: "DELETE" });
  }

  async addTenantAdmin(tenantId, input) {
    return this.request(`/v1/tenants/${encodeURIComponent(tenantId)}/admins`, { method: "POST", body: input });
  }

  async removeTenantAdmin(tenantId, userId) {
    return this.request(`/v1/tenants/${encodeURIComponent(tenantId)}/admins/${encodeURIComponent(userId)}`, { method: "DELETE" });
  }

  async listTenantApiKeys(tenantId) {
    return this.request(`/v1/tenants/${encodeURIComponent(tenantId)}/api_keys`);
  }

  async createTenantApiKey(tenantId, input) {
    return this.request(`/v1/tenants/${encodeURIComponent(tenantId)}/api_keys`, { method: "POST", body: input });
  }

  async updateTenantApiKey(tenantId, keyId, input) {
    return this.request(`/v1/tenants/${encodeURIComponent(tenantId)}/api_keys/${encodeURIComponent(keyId)}`, { method: "PATCH", body: input });
  }

  async deleteTenantApiKey(tenantId, keyId) {
    return this.request(`/v1/tenants/${encodeURIComponent(tenantId)}/api_keys/${encodeURIComponent(keyId)}`, { method: "DELETE" });
  }

  async listWorkspaceMembers(workspaceId) {
    return this.request(`/v1/workspaces/${encodeURIComponent(workspaceId)}/members`);
  }

  async addWorkspaceMember(workspaceId, input) {
    return this.request(`/v1/workspaces/${encodeURIComponent(workspaceId)}/members`, { method: "POST", body: input });
  }

  async addWorkspaceAdmin(workspaceId, input) {
    return this.request(`/v1/workspaces/${encodeURIComponent(workspaceId)}/admins`, { method: "POST", body: input });
  }

  async listWorkspaceApiKeys(workspaceId) {
    return this.request(`/v1/workspaces/${encodeURIComponent(workspaceId)}/api_keys`);
  }

  async createWorkspaceApiKey(workspaceId, input) {
    return this.request(`/v1/workspaces/${encodeURIComponent(workspaceId)}/api_keys`, { method: "POST", body: input });
  }

  async listModelConfigs() {
    return this.request("/v1/model_configs");
  }

  async listAgents(params = {}) {
    const query = params.workspaceId ? `?workspace_id=${encodeURIComponent(params.workspaceId)}` : "";
    return this.request(`/v1/agents${query}`);
  }

  async createAgent(input) {
    return this.request("/v1/agents", { method: "POST", body: this.withWorkspace(input) });
  }

  async getAgent(id) {
    return this.request(`/v1/agents/${encodeURIComponent(id)}`);
  }

  async createEnvironment(input) {
    return this.request("/v1/environments", { method: "POST", body: this.withWorkspace(input) });
  }

  async listDeployments(params = {}) {
    const workspaceId = params.workspaceId || params.workspace_id || this.workspaceId;
    const query = workspaceId ? `?workspace_id=${encodeURIComponent(workspaceId)}` : "";
    return this.request(`/v1/deployments${query}`);
  }

  async createDeployment(input) {
    return this.request("/v1/deployments", { method: "POST", body: this.withWorkspace(input) });
  }

  async getDeployment(id) {
    return this.request(`/v1/deployments/${encodeURIComponent(id)}`);
  }

  async invokeDeployment(id, input) {
    return this.request(`/v1/deployments/${encodeURIComponent(id)}/invoke`, { method: "POST", body: input });
  }

  async runDeployment(id, input = {}) {
    return this.request(`/v1/deployments/${encodeURIComponent(id)}/run`, { method: "POST", body: input });
  }

  async listDeploymentRuns(id, params = {}) {
    const query = params.limit ? `?limit=${encodeURIComponent(params.limit)}` : "";
    return this.request(`/v1/deployments/${encodeURIComponent(id)}/runs${query}`);
  }

  async pauseDeployment(id, input = {}) {
    return this.request(`/v1/deployments/${encodeURIComponent(id)}/pause`, { method: "POST", body: input });
  }

  async unpauseDeployment(id) {
    return this.request(`/v1/deployments/${encodeURIComponent(id)}/unpause`, { method: "POST", body: {} });
  }

  async archiveDeployment(id) {
    return this.request(`/v1/deployments/${encodeURIComponent(id)}/archive`, { method: "POST", body: {} });
  }

  async createSession(input) {
    return this.request("/v1/sessions", { method: "POST", body: this.withWorkspace(input) });
  }

  async sessionDetail(id) {
    return this.request(`/v1/sessions/${encodeURIComponent(id)}/detail`);
  }

  async listSessionEvents(id) {
    return this.request(`/v1/sessions/${encodeURIComponent(id)}/events`);
  }

  async askMaple(sessionId, question) {
    return this.request(`/v1/ask_maple/sessions/${encodeURIComponent(sessionId)}/message`, {
      method: "POST",
      body: { question }
    });
  }

  async postSessionEvents(id, events) {
    return this.request(`/v1/sessions/${encodeURIComponent(id)}/events`, {
      method: "POST",
      body: { events }
    });
  }

  async postSessionMessage(id, message) {
    return this.postSessionEvents(id, [userMessageEvent(message)]);
  }

  async createSessionAndStream(input = {}, options = {}) {
    const { message, events, ...sessionInput } = input;
    const outboundEvents = Array.isArray(events) ? events : message === undefined ? null : [userMessageEvent(message)];
    if (!outboundEvents) throw new Error("createSessionAndStream requires message or events.");

    const session = await this.createSession(sessionInput);
    const stream = this.streamSessionEvents(session.id, options);
    const done = streamDone(stream, options);
    try {
      await waitForStreamReady(stream, options.readyTimeoutMs);
      const posted = await this.postSessionEvents(session.id, outboundEvents);
      return { session, stream, posted, done };
    } catch (error) {
      stream.close();
      throw error;
    }
  }

  async sendSessionMessage(id, message) {
    return this.postSessionMessage(id, message);
  }

  streamSessionEvents(id, options = {}) {
    const emitter = new EventEmitter();
    const controller = new AbortController();
    if (typeof options.onReady === "function") emitter.on("ready", options.onReady);
    if (typeof options.onEvent === "function") emitter.on("event", options.onEvent);
    if (typeof options.onError === "function") emitter.on("error", options.onError);
    const abortFromSignal = () => controller.abort();
    if (options.signal?.aborted) controller.abort();
    else options.signal?.addEventListener?.("abort", abortFromSignal, { once: true });
    fetch(`${this.baseUrl}/v1/sessions/${encodeURIComponent(id)}/events/stream`, {
      headers: this.authHeaders(),
      signal: controller.signal
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`SSE failed ${response.status}: ${await response.text()}`);
        if (!response.body) throw new Error("SSE response did not include a body.");
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const chunks = buffer.split(/\r?\n\r?\n/);
          buffer = chunks.pop() || "";
          for (const chunk of chunks) {
            const parsed = parseSseMessage(chunk);
            if (!parsed) continue;
            if (parsed.event === "ready") {
              emitter.emit("ready", parsed.data);
              continue;
            }
            emitter.emit("event", parsed.data);
          }
        }
      })
      .catch((error) => {
        if (!controller.signal.aborted) emitter.emit("error", error);
      })
      .finally(() => {
        options.signal?.removeEventListener?.("abort", abortFromSignal);
        emitter.emit("close");
      });
    emitter.close = () => controller.abort();
    return emitter;
  }

  async listSkills() {
    return this.request("/v1/skills");
  }

  async createSkill(input) {
    return this.request("/v1/skills", { method: "POST", body: input });
  }

  async updateSkill(id, input) {
    return this.request(`/v1/skills/${encodeURIComponent(id)}`, { method: "PATCH", body: input });
  }

  async getSkillFiles(id) {
    return this.request(`/v1/skills/${encodeURIComponent(id)}/files`);
  }

  async getSkillFile(id, path) {
    return this.request(`/v1/skills/${encodeURIComponent(id)}/files/${encodePath(path)}`);
  }

  async saveSkillFile(id, path, content) {
    return this.request(`/v1/skills/${encodeURIComponent(id)}/files/${encodePath(path)}`, {
      method: "PUT",
      body: { content }
    });
  }

  async request(path, options = {}) {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: options.method || "GET",
      headers: {
        "Content-Type": "application/json",
        ...(options.auth === false ? {} : this.authHeaders()),
        ...(options.headers || {})
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body)
    });
    return parseResponse(response);
  }

  authHeaders() {
    if (!this.token) return {};
    if (String(this.token).startsWith("maple_sess_")) return { Cookie: `maple_session=${this.token}` };
    return { "X-Maple-API-Key": this.token };
  }

  withWorkspace(input = {}) {
    if (!this.workspaceId || input.workspace_id) return input;
    return { ...input, workspace_id: this.workspaceId };
  }
}

function encodePath(path) {
  return String(path).split("/").map((part) => encodeURIComponent(part)).join("/");
}

async function parseResponse(response) {
  const text = await response.text();
  let body = {};
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = { raw: text };
    }
  }
  if (!response.ok) {
    const message = body.message || body.error || text || `${response.status} ${response.statusText}`;
    const error = new Error(message);
    error.status = response.status;
    error.body = body;
    throw error;
  }
  return body;
}

function userMessageEvent(message) {
  const content = Array.isArray(message) ? message : [{ type: "text", text: String(message ?? "") }];
  return { type: "user.message", content };
}

function parseSseMessage(chunk) {
  const lines = chunk.split(/\r?\n/);
  const data = [];
  let event = "message";
  for (const line of lines) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
  }
  if (!data.length) return null;
  return { event, data: JSON.parse(data.join("\n")) };
}

function waitForStreamReady(stream, timeoutMs = 10_000) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      stream.off?.("ready", onReady);
      stream.off?.("error", onError);
      fn(value);
    };
    const timer = setTimeout(() => finish(reject, new Error("Timed out waiting for Maple session stream.")), timeoutMs);
    const onReady = (event) => finish(resolve, event);
    const onError = (error) => finish(reject, error);
    stream.once("ready", onReady);
    stream.once("error", onError);
  });
}

function streamDone(stream, options) {
  const stopOn = new Set(options.stopOn || ["agent.message", "session.status_failed"]);
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      stream.off?.("event", onEvent);
      stream.off?.("error", onError);
      stream.off?.("close", onClose);
      fn(value);
    };
    const onEvent = (event) => {
      if (!stopOn.has(String(event.type || ""))) return;
      finish(resolve, event);
      stream.close();
    };
    const onError = (error) => finish(reject, error);
    const onClose = () => finish(resolve, null);
    stream.on("event", onEvent);
    stream.on("error", onError);
    stream.on("close", onClose);
  });
}

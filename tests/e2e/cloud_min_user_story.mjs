import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { loadProjectEnv } from "../../apps/control-plane-api/src/env";
import { MapleClient } from "../../packages/sdk/index.mjs";

const execFileAsync = promisify(execFile);

loadProjectEnv();

const baseUrl = (process.env.MAPLE_CLOUD_BASE_URL || process.env.E2E_API_BASE || "https://sd8ihq8v316pc5mf9c1j0.apigateway-cn-beijing.volceapi.com").replace(/\/$/, "");
const runtimeInvokeUrl = process.env.VEFAAS_INVOKE_URL || `${baseUrl}/maple-ark`;
const platformDevKey = process.env.MAPLE_CLOUD_DEV_API_KEY || process.env.MAPLE_DEV_API_KEY || "maple_dev_key";
const runId = String(Date.now());

for (const key of ["VOLCENGINE_ACCESS_KEY", "VOLCENGINE_SECRET_KEY", "E2B_API_KEY"]) {
  if (!process.env[key]) throw new Error(`${key} is required in project .env`);
}

const { authed, authHeaders, authMode } = await createCloudTestClient(baseUrl, runId, platformDevKey);

const modelConfigs = await authed.listModelConfigs();
const defaultModel = modelConfigs.data.find((item) => item.model_name === "glm-4-7-251222" || item.model === "glm-4-7-251222") ?? modelConfigs.data[0];
if (!defaultModel?.id) throw new Error("No default model config available after login.");

const workspaceInput = {
  tenant: { name: `Min Story Tenant ${runId}`, slug: `min-story-${runId}` },
  workspace: { name: `Min Story Workspace ${runId}`, slug: `min-story-${runId}` },
  runtime_provider: "vefaas",
  runtime_pool: {
    desired_size: 1,
    min_instances_per_function: 1,
    max_instances_per_function: 10,
    max_concurrency_per_instance: 20,
    cpu_milli: 1000,
    memory_mb: 2048
  },
  sandbox_provider: "e2b",
  model_config_ids: [defaultModel.id],
  api_key: { display_name: "Min story workspace key", scopes: ["control_plane", "data_plane"] },
  provider_credentials: {
    vefaas: {
      VOLCENGINE_ACCESS_KEY: process.env.VOLCENGINE_ACCESS_KEY,
      VOLCENGINE_SECRET_KEY: process.env.VOLCENGINE_SECRET_KEY,
      VEFAAS_REGION: process.env.MAPLE_VEFAAS_REGION || process.env.VEFAAS_REGION || "cn-beijing"
    },
    e2b: { E2B_API_KEY: process.env.E2B_API_KEY }
  }
};
const onboarding = authMode === "platform_dev_key"
  ? await authed.createWorkspace(withoutTenant(workspaceInput))
  : await authed.onboardWorkspace(workspaceInput);

const workspaceId = String(onboarding.workspace?.id || "");
const tenantId = String(onboarding.tenant?.id || onboarding.workspace?.tenant_id || "");
const workspaceKey = String(onboarding.api_key?.key || "");
if (!workspaceId || !tenantId || !workspaceKey.startsWith("maple_ws_")) throw new Error(`Invalid onboarding response: ${JSON.stringify(mask(onboarding))}`);
await waitForRuntimePoolActive(authed, workspaceId);

const secondKeyResponse = await fetch(`${baseUrl}/v1/workspaces/${workspaceId}/api_keys`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    ...authHeaders
  },
  body: JSON.stringify({ display_name: "Min story curl key", scopes: ["control_plane", "data_plane"] })
});
if (!secondKeyResponse.ok) throw new Error(`Workspace key creation failed: ${secondKeyResponse.status} ${await secondKeyResponse.text()}`);
const secondKey = await secondKeyResponse.json();

const client = new MapleClient({ baseUrl, apiKey: workspaceKey });
const environment = await client.createEnvironment({
  workspace_id: workspaceId,
  name: "min-story-e2b",
  config: {
    type: "e2b",
    sandbox: {
      provider: "e2b",
      e2b: {
        template: process.env.E2B_TEMPLATE || "base",
        workspace_path: "/workspace",
        timeout_ms: 3_600_000
      }
    },
    networking: { mode: "cloud_limited", allow_internet_access: true }
  }
});

const modelName = defaultModel.model_name || defaultModel.model || "glm-4-7-251222";
const agent = await client.createAgent({
  workspace_id: workspaceId,
  name: "Min Story Agent",
  description: "Minimum cloud user story agent",
  model: {
    provider: "custom",
    id: modelName,
    config_id: defaultModel.id,
    name: defaultModel.name || "VolcoEngine"
  },
  agent_loop: { type: "anthropic_claude_code", config: {}, hooks: [] },
  system: "Use runtime tools to write and list files. Keep responses concise.",
  tools: [{ type: "agent_toolset_20260401", default_config: { enabled: true, read: true, write: true, bash: true, grep: true } }],
  mcp_servers: [],
  skills: []
});

const session = await client.createSession({
  workspace_id: workspaceId,
  agent: agent.id,
  environment_id: environment.id,
  title: "min-story-session"
});

const sdkPath = `qa/min-sdk-${runId}.txt`;
const sdkContent = `min-story-sdk-${runId}`;
await client.sendSessionMessage(session.id, `Use write_file to create ${sdkPath} with content ${sdkContent}, then use list_files on qa.`);
const sdkDetail = await waitForToolLoop(client, session.id, sdkPath, "SDK", { minCompletedListFiles: 1 });
const completedListFilesAfterSdk = countCompletedListFiles(sdkDetail);

const curlPath = `qa/min-curl-${runId}.txt`;
const curlContent = `min-story-curl-${runId}`;
const curlBody = JSON.stringify({
  events: [
    {
      type: "user.message",
      content: [{ type: "text", text: `Use write_file to create ${curlPath} with content ${curlContent}, then use list_files on qa.` }]
    }
  ]
});
const { stdout: curlStdout } = await execFileAsync("curl", [
  "-sS",
  "-X",
  "POST",
  "-H",
  "Content-Type: application/json",
  "-H",
  `X-Maple-API-Key: ${workspaceKey}`,
  "--data",
  curlBody,
  `${baseUrl}/v1/sessions/${encodeURIComponent(session.id)}/events`
]);
const curlResponse = JSON.parse(curlStdout || "{}");
if (!curlResponse.accepted && !Array.isArray(curlResponse.data)) throw new Error(`curl message was not accepted: ${curlStdout}`);
const curlDetail = await waitForToolLoop(client, session.id, curlPath, "curl", { minCompletedListFiles: completedListFilesAfterSdk + 1 });

console.log(
  JSON.stringify(
    {
      ok: true,
      base_url: baseUrl,
      auth_mode: authMode,
      runtime_invoke_url: runtimeInvokeUrl,
      tenant_id: tenantId,
      workspace_id: workspaceId,
      workspace_key_prefix: workspaceKey.slice(0, 18),
      curl_key_id: secondKey.id,
      curl_key_prefix: String(secondKey.key || "").slice(0, 18),
      agent_id: agent.id,
      environment_id: environment.id,
      session_id: session.id,
      session_status: curlDetail.session.status,
      sandbox_id: sandboxId(curlDetail),
      sdk_tool_calls: summarizeToolCalls(sdkDetail, sdkPath),
      curl_tool_calls: summarizeToolCalls(curlDetail, curlPath)
    },
    null,
    2
  )
);

async function waitForToolLoop(client, sessionId, path, label, options = {}) {
  return poll(async () => {
    const detail = await client.sessionDetail(sessionId);
    if (detail.session?.status === "failed") {
      const failed = detail.events?.findLast?.((event) => event.type === "session.status_failed");
      throw new Error(`${label} session failed: ${JSON.stringify(failed || detail.session)}`);
    }
    const write = completedWrite(detail, path);
    const listCount = countCompletedListFiles(detail);
    return detail.session?.status === "idle" && write && listCount >= (options.minCompletedListFiles || 1) ? detail : null;
  }, 240_000, `${label} tool loop`);
}

async function waitForRuntimePoolActive(client, workspaceId) {
  await poll(async () => {
    const pool = await client.getWorkspaceRuntimePool(workspaceId);
    return (pool.members || []).some((member) => member.status === "active" && member.invoke_url) ? pool : null;
  }, 300_000, `runtime pool active for ${workspaceId}`);
}

async function poll(fn, timeoutMs, label) {
  const start = Date.now();
  let last = null;
  while (Date.now() - start < timeoutMs) {
    last = await fn();
    if (last) return last;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`Timed out waiting for ${label}: ${JSON.stringify(last)}`);
}

function summarizeToolCalls(detail, path) {
  const platformCalls = (detail.tool_calls || [])
    .filter((call) => call.input?.path === path || call.tool_name === "list_files")
    .map((call) => ({ name: call.tool_name, status: call.status, path: call.input?.path || call.input?.command || "" }));
  const externalCalls = externalToolEvents(detail)
    .filter((item) => item.path?.endsWith(path) || item.name === "Bash")
    .map((item) => ({ name: item.name, status: item.status, path: item.path || item.command || "" }));
  return [...platformCalls, ...externalCalls];
}

function countCompletedListFiles(detail) {
  const platformCount = (detail.tool_calls || []).filter((call) => call.tool_name === "list_files" && call.status === "completed").length;
  const externalCount = externalToolEvents(detail).filter((item) => item.name === "Bash" && item.status === "completed" && /\bls\b/.test(item.command || "")).length;
  return platformCount + externalCount;
}

function completedWrite(detail, path) {
  const platformWrite = detail.tool_calls?.find((call) => call.tool_name === "write_file" && call.status === "completed" && call.input?.path === path);
  if (platformWrite) return platformWrite;
  return externalToolEvents(detail).find((item) => item.name === "Write" && item.status === "completed" && item.path?.endsWith(path));
}

function externalToolEvents(detail) {
  const events = detail.events || [];
  const pending = new Map();
  const completed = [];
  for (const event of events) {
    const external = event.payload?.event;
    const content = external?.message?.content || [];
    for (const part of content) {
      if (part.type === "tool_use") {
        pending.set(part.id, {
          name: part.name,
          status: "running",
          path: part.input?.file_path || part.input?.path || "",
          command: part.input?.command || ""
        });
      }
      if (part.type === "tool_result") {
        const item = pending.get(part.tool_use_id);
        if (item) completed.push({ ...item, status: part.is_error ? "failed" : "completed" });
      }
    }
  }
  return completed;
}

function sandboxId(detail) {
  const metadata = detail.session?.metadata || {};
  return metadata.runtime?.sandbox_id || metadata.sandbox_runtime?.sandbox_id || "";
}

function mask(value) {
  return JSON.parse(
    JSON.stringify(value, (key, inner) => {
      if (/key|secret|token|credential/i.test(key) && typeof inner === "string") return `${inner.slice(0, 4)}...`;
      return inner;
    })
  );
}

function withoutTenant(input) {
  const { tenant: _tenant, ...workspaceInput } = input;
  return workspaceInput;
}

async function createCloudTestClient(baseUrl, runId, platformDevKey) {
  const loginClient = new MapleClient({ baseUrl });
  try {
    const login = await loginClient.loginLocal({
      email: `maple-min-story-${runId}@example.com`,
      name: `Maple Min Story ${runId}`
    });
    return {
      authed: loginClient.withToken(login.token),
      authHeaders: { Cookie: `maple_session=${login.token}` },
      authMode: "local_login"
    };
  } catch (error) {
    if (error?.body?.error !== "dev_login_disabled" && error?.message !== "dev_login_disabled") throw error;
    return {
      authed: new MapleClient({ baseUrl, apiKey: platformDevKey }),
      authHeaders: { "X-Maple-API-Key": platformDevKey },
      authMode: "platform_dev_key"
    };
  }
}

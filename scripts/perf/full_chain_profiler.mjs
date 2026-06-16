// End-to-end Maple latency profiler: times each stage of the main chain — create agent,
// create session, bootstrap (sandbox + runtime pre-warm), and N message turns with their
// warmup/body/tool/finalize breakdown plus the runtime-side timings event.
// Auth: MAPLE_COOKIE (a maple_session=... cookie) is preferred; falls back to local dev login.
// Usage: MAPLE_COOKIE="maple_session=..." node scripts/perf/full_chain_profiler.mjs [turns]
import { readFileSync } from "node:fs";

const BASE = (process.env.MAPLE_BASE_URL || "https://sd8ihq8v316pc5mf9c1j0.apigateway-cn-beijing.volceapi.com").replace(/\/$/, "");
const WORKSPACE = process.env.MAPLE_WORKSPACE_ID || "ws_g0VdNVB6th";
const ENVIRONMENT = process.env.MAPLE_ENVIRONMENT_ID || "env_irT9LJToTF";
const TURNS = Number(process.argv[2] || 3);

function cookie() {
  if (process.env.MAPLE_COOKIE) return process.env.MAPLE_COOKIE.trim();
  try {
    return readFileSync("/tmp/maple_cookie.txt", "utf8").trim();
  } catch {
    return "";
  }
}

const H = { "Content-Type": "application/json", Cookie: cookie() };

async function api(method, path, body) {
  const t0 = performance.now();
  const resp = await fetch(`${BASE}${path}`, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
  const ms = performance.now() - t0;
  const text = await resp.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* non-json */
  }
  return { status: resp.status, ms, json, text };
}

function ms(n) {
  return `${(n / 1000).toFixed(2)}s`;
}

const me = await api("GET", "/v1/auth/me");
if (me.status !== 200 || !me.json?.user) throw new Error(`auth failed (${me.status}); set MAPLE_COOKIE. ${me.text.slice(0, 120)}`);
console.log(`auth ok: ${me.json.user.email}\n`);

// --- stage: create agent ---
let agentId = process.env.MAPLE_AGENT_ID;
if (agentId) {
  console.log(`[create agent]    skipped (MAPLE_AGENT_ID=${agentId})`);
} else {
  const mc = await api("GET", `/v1/model_configs?workspace_id=${WORKSPACE}`);
  const modelConfig = (mc.json?.data || []).find((c) => c.is_default) || (mc.json?.data || [])[0];
  const agentBody = {
    workspace_id: WORKSPACE,
    name: `perf-agent-${Date.now()}`,
    description: "full-chain profiler agent",
    system: "You are a concise test agent. Answer briefly.",
    model: modelConfig ? { config_id: modelConfig.id, provider: modelConfig.provider, id: modelConfig.model || modelConfig.model_name } : { provider: "custom", id: "glm-4-7-251222" },
    tools: [{ type: "agent_toolset", default_config: { bash: true, read: true } }],
    agent_loop: { type: "anthropic_claude_code", config: { execution: "external" } }
  };
  const agent = await api("POST", "/v1/agents", agentBody);
  console.log(`[create agent]    ${ms(agent.ms)}  status=${agent.status}  id=${agent.json?.id || agent.text.slice(0, 90)}`);
  agentId = agent.json?.id;
  if (!agentId) throw new Error("agent create failed");
}

// --- stage: create session (triggers bootstrap: sandbox + runtime pre-warm) ---
const session = await api("POST", "/v1/sessions", { workspace_id: WORKSPACE, agent: agentId, environment_id: ENVIRONMENT, title: `perf-${Date.now()}` });
console.log(`[create session]  ${ms(session.ms)}  status=${session.status}  id=${session.json?.id || session.text.slice(0, 80)}`);
const sessionId = session.json?.id;
if (!sessionId) throw new Error("session create failed");

// --- stage: bootstrap to idle (sandbox provision + runtime ready) ---
const bootStart = performance.now();
let status = "";
let sandboxReadyMs = null;
while (performance.now() - bootStart < 120000) {
  const d = await api("GET", `/v1/sessions/${sessionId}/detail`);
  status = String(d.json?.session?.status || "");
  const sandbox = d.json?.session?.metadata?.sandbox_runtime || d.json?.session?.metadata?.runtime;
  if (sandboxReadyMs === null && sandbox && (sandbox.sandbox_id || sandbox.type)) sandboxReadyMs = performance.now() - bootStart;
  if (["idle", "failed"].includes(status)) break;
  await new Promise((r) => setTimeout(r, 500));
}
console.log(`[bootstrap->idle] ${ms(performance.now() - bootStart)}  status=${status}  sandbox_ready=${sandboxReadyMs === null ? "?" : ms(sandboxReadyMs)}`);
if (status !== "idle") throw new Error(`bootstrap ended ${status}`);

// --- stage: message turns ---
for (let n = 1; n <= TURNS; n++) {
  const t0 = performance.now();
  await api("POST", `/v1/sessions/${sessionId}/events`, { events: [{ type: "user.message", content: [{ type: "text", text: `say the number ${n} and nothing else` }] }] });
  const seen = new Set();
  let firstSys = null;
  let firstAssist = null;
  let firstTool = null;
  let timings = null;
  let lastId = "";
  let done = false;
  while (performance.now() - t0 < 90000) {
    const d = await api("GET", `/v1/sessions/${sessionId}/detail${lastId ? `?after=${lastId}` : ""}`);
    for (const e of d.json?.events || []) {
      if (seen.has(e.id)) continue;
      seen.add(e.id);
      const t = performance.now() - t0;
      const inner = e.payload?.event?.type || "";
      if (firstSys === null && e.type === "agent.external_loop_event" && inner === "system") firstSys = t;
      if (firstAssist === null && e.type === "agent.external_loop_event" && inner === "assistant") firstAssist = t;
      if (firstTool === null && e.type === "agent.external_loop_event" && Array.isArray(e.payload?.event?.message?.content) && e.payload.event.message.content.some((b) => b?.type === "tool_use")) firstTool = t;
      if (e.type === "session.runtime_timings") timings = e.payload;
    }
    const evs = d.json?.events || [];
    if (evs.length) lastId = evs[evs.length - 1].id;
    if (["idle", "failed"].includes(String(d.json?.session?.status || ""))) done = true;
    if (done && firstSys !== null) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  const total = performance.now() - t0;
  const tline = timings
    ? `acquire=${timings.acquire_ms}ms first_event=${timings.first_event_ms}ms turn=${timings.turn_ms}ms posts=${timings.callback_posts}(${timings.callback_post_ms}ms) events=${timings.events}`
    : "no runtime_timings";
  console.log(`[turn ${n}] total=${ms(total)} warmup=${firstSys === null ? "?" : ms(firstSys)} firstAssistant=${firstAssist === null ? "?" : ms(firstAssist)} firstTool=${firstTool === null ? "—" : ms(firstTool)}\n          runtime: ${tline}`);
}

console.log(`\nDONE. session=${sessionId} agent=${agentId} (clean up after profiling)`);

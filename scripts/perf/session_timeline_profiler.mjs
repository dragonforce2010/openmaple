// Reconstructs the server-side per-turn timeline of a Maple session from event
// created_at timestamps, segmenting by user.message into turns and printing the
// inter-event gaps. Used to profile TTFT / latency without redeploying with
// MAPLE_PERF_TRACE. Usage: node scripts/perf/session_timeline_profiler.mjs <sessionId>
// Env: MAPLE_BASE_URL, MAPLE_LOGIN_EMAIL (lark_sso upsert login).
const BASE = (process.env.MAPLE_BASE_URL || "https://sd8ihq8v316pc5mf9c1j0.apigateway-cn-beijing.volceapi.com").replace(/\/$/, "");
const SESSION = process.argv[2] || process.env.MAPLE_SESSION_ID;
const EMAIL = process.env.MAPLE_LOGIN_EMAIL || "michael.zhang@bytedance.com";
if (!SESSION) throw new Error("usage: node session_timeline_profiler.mjs <sessionId>");

const login = await fetch(`${BASE}/v1/auth/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ provider: "lark_sso", email: EMAIL })
});
const cookie = (login.headers.get("set-cookie") || "").split(";")[0];
const d = await fetch(`${BASE}/v1/sessions/${SESSION}/detail`, { headers: { Cookie: cookie } }).then((r) => r.json());

const ev = d.events.map((e) => ({
  t: e.type,
  pet: e.provider_event_type || "",
  at: new Date(e.created_at).getTime(),
  inner: e.payload?.event?.type || ""
}));

const turns = [];
let cur = null;
for (const e of ev) {
  if (e.t === "user.message") { if (cur) turns.push(cur); cur = { start: e.at, ev: [] }; }
  if (cur) cur.ev.push(e);
}
if (cur) turns.push(cur);

console.log(`session ${SESSION}: ${ev.length} events, ${turns.length} turns\n`);
for (let i = 0; i < turns.length; i++) {
  const T = turns[i];
  const s = T.start;
  console.log(`========== TURN ${i + 1} (${((T.ev.at(-1).at - s) / 1000).toFixed(1)}s total) ==========`);
  let prev = s;
  for (const e of T.ev) {
    const rel = ((e.at - s) / 1000).toFixed(2);
    const gap = ((e.at - prev) / 1000).toFixed(2);
    const label = e.t === "agent.external_loop_event" ? `external_loop[${e.inner}]` : e.t;
    console.log(`  +${rel.padStart(6)}s  (Δ${gap.padStart(6)}s)  ${label}${e.pet ? ` <${e.pet}>` : ""}`);
    prev = e.at;
  }
  console.log();
}

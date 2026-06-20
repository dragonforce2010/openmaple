import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { MapleClient } from "maple-agent-sdk";

const here = dirname(fileURLToPath(import.meta.url));
const projectEnv = loadEnv(resolve(here, "../../.env"));
for (const name of ["MAPLE_API_BASE_URL", "MAPLE_API_KEY", "MAPLE_DEV_API_KEY", "MAPLE_WORKSPACE_ID", "MAPLE_AGENT_ID", "MAPLE_ENVIRONMENT_ID", "MAPLE_SMOKE_MESSAGE", "MAPLE_SMOKE_TIMEOUT_MS"]) {
  if (projectEnv[name]) process.env[name] = projectEnv[name];
}

const baseUrl = process.env.MAPLE_API_BASE_URL || "http://127.0.0.1:27951";
const required = ["MAPLE_API_KEY", "MAPLE_WORKSPACE_ID", "MAPLE_AGENT_ID", "MAPLE_ENVIRONMENT_ID"];
for (const name of required) {
  if (!process.env[name]) {
    console.error(`Missing ${name}. Set it in project .env or in the shell environment.`);
    process.exit(1);
  }
}

const authCandidates = [
  { label: "MAPLE_API_KEY", key: process.env.MAPLE_API_KEY },
  { label: "MAPLE_DEV_API_KEY", key: process.env.MAPLE_DEV_API_KEY }
].filter((item, index, items) => item.key && items.findIndex((candidate) => candidate.key === item.key) === index);

const message =
  process.env.MAPLE_SMOKE_MESSAGE ||
  "用一句话说明你已经通过 maple-agent-sdk npm 包收到了这条消息。";

console.log("Maple Agent SDK smoke");
console.log(`baseUrl=${baseUrl}`);
console.log(`workspace=${process.env.MAPLE_WORKSPACE_ID}`);
console.log(`agent=${process.env.MAPLE_AGENT_ID}`);
console.log(`environment=${process.env.MAPLE_ENVIRONMENT_ID}`);

try {
  const { client, session, authLabel } = await createSessionWithFallback();
  console.log(`auth=${authLabel}`);
  console.log(`session=${session.id}`);

  const stream = client.streamSessionEvents(session.id);
  await waitForStreamReady(stream, session.id);
  await client.sendSessionMessage(session.id, message);
  console.log("message_sent");

  const agentMessage = await waitForAgentMessage(stream, Number(process.env.MAPLE_SMOKE_TIMEOUT_MS || 120000));
  console.log("agent_message");
  console.log(eventText(agentMessage));
  stream.close();
  process.exit(0);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  if (error?.body) console.error(JSON.stringify(error.body, null, 2));
  process.exit(1);
}

function eventText(event) {
  const payload = event.payload || {};
  if (Array.isArray(payload.content)) {
    return payload.content.map((item) => item?.text || "").join("");
  }
  return payload.text || JSON.stringify(payload);
}

async function createSessionWithFallback() {
  let lastError;
  for (const candidate of authCandidates) {
    const client = new MapleClient({ baseUrl, apiKey: candidate.key, workspaceId: process.env.MAPLE_WORKSPACE_ID });
    try {
      const session = await client.createSession({
        workspace_id: process.env.MAPLE_WORKSPACE_ID,
        agent: process.env.MAPLE_AGENT_ID,
        environment_id: process.env.MAPLE_ENVIRONMENT_ID,
        title: `npm-sdk-current-agent-${new Date().toISOString()}`
      });
      return { client, session, authLabel: candidate.label };
    } catch (error) {
      lastError = error;
      const code = error?.body?.error || error?.message || "";
      if (!["invalid_or_expired_session", "login_required"].includes(String(code))) throw error;
      console.error(`${candidate.label}_auth_failed=${code}`);
    }
  }
  throw lastError || new Error("No Maple auth candidate configured.");
}

function loadEnv(filePath) {
  const values = {};
  if (!existsSync(filePath)) return values;
  for (const rawLine of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (!match) continue;
    values[match[1]] = unquote(match[2].trim());
  }
  return values;
}

function unquote(value) {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

function waitForStreamReady(stream, sessionId) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timed out waiting for SSE ready.")), 5_000);
    stream.on("event", (event) => {
      if (!event.type && event.session_id === sessionId) {
        clearTimeout(timer);
        resolve();
      }
    });
    stream.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function waitForAgentMessage(stream, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timed out waiting for agent.message.")), timeoutMs);
    stream.on("event", (event) => {
      if (event.type === "session.status_failed") {
        clearTimeout(timer);
        reject(new Error("session_failed=" + JSON.stringify(event.payload || event, null, 2)));
        return;
      }
      if (event.type === "agent.message") {
        clearTimeout(timer);
        resolve(event);
      }
    });
    stream.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

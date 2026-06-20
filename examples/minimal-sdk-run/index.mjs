import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { MapleClient } from "../../packages/sdk/index.mjs";

const here = dirname(fileURLToPath(import.meta.url));
loadEnv(resolve(here, ".env"));

const config = {
  baseUrl: process.env.MAPLE_API_BASE_URL || "http://127.0.0.1:27951",
  apiKey: process.env.MAPLE_API_KEY,
  workspaceId: process.env.MAPLE_WORKSPACE_ID,
  agentId: process.env.MAPLE_AGENT_ID,
  environmentId: process.env.MAPLE_ENVIRONMENT_ID,
  message: process.env.MAPLE_MESSAGE || "Summarize what OpenMaple is in one sentence.",
  timeoutMs: Number(process.env.MAPLE_RUN_TIMEOUT_MS || 120000)
};

const missing = [
  ["MAPLE_API_KEY", config.apiKey],
  ["MAPLE_WORKSPACE_ID", config.workspaceId],
  ["MAPLE_AGENT_ID", config.agentId],
  ["MAPLE_ENVIRONMENT_ID", config.environmentId]
].filter(([, value]) => !value);

if (missing.length) {
  console.error("Missing required environment variables:");
  for (const [name] of missing) console.error(`- ${name}`);
  console.error("\nStart from examples/minimal-sdk-run/.env.example.");
  process.exit(1);
}

console.log("OpenMaple minimal SDK run");
console.log(`baseUrl=${config.baseUrl}`);
console.log(`workspace=${config.workspaceId}`);
console.log(`agent=${config.agentId}`);
console.log(`environment=${config.environmentId}`);

const client = new MapleClient({
  baseUrl: config.baseUrl,
  apiKey: config.apiKey,
  workspaceId: config.workspaceId
});

const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), config.timeoutMs);

try {
  await client.health();
  const run = await client.createSessionAndStream({
    workspace_id: config.workspaceId,
    agent: config.agentId,
    environment_id: config.environmentId,
    title: `minimal-sdk-run-${new Date().toISOString()}`,
    message: config.message
  }, {
    signal: controller.signal,
    stopOn: ["agent.message", "session.status_failed"],
    onReady(event) {
      console.log(`stream_ready=${event.session_id}`);
    },
    onEvent(event) {
      if (event.type === "agent.message_delta") process.stdout.write(String(event.text || event.payload?.text || ""));
      if (event.type === "session.status_failed") console.error(`\nsession_failed=${JSON.stringify(event.payload || event, null, 2)}`);
    }
  });

  console.log(`session=${run.session.id}`);
  const finalEvent = await run.done;
  console.log("\nagent_message");
  console.log(eventText(finalEvent));
  run.stream.close();
} catch (error) {
  if (error?.name === "AbortError") {
    console.error(`Timed out after ${config.timeoutMs}ms.`);
  } else {
    console.error(error instanceof Error ? error.message : String(error));
    if (error?.body) console.error(JSON.stringify(error.body, null, 2));
  }
  process.exitCode = 1;
} finally {
  clearTimeout(timer);
}

function loadEnv(filePath) {
  if (!existsSync(filePath)) return;
  for (const rawLine of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (!match || process.env[match[1]]) continue;
    process.env[match[1]] = unquote(match[2].trim());
  }
}

function unquote(value) {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

function eventText(event) {
  if (!event) return "";
  const payload = event.payload || {};
  if (Array.isArray(payload.content)) return payload.content.map((item) => item?.text || "").join("");
  return payload.text || event.text || JSON.stringify(payload || event);
}

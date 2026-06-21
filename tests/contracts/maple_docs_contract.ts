import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const docsView = readFileSync("apps/admin-web/src/pages/docs/DocumentationView.tsx", "utf8");
const docs = readSources([
  "apps/admin-web/src/pages/docs/DocumentationView.tsx",
  "apps/admin-web/src/pages/docs/documentationContent.ts",
  "apps/admin-web/src/pages/docs/documentationIntroContent.tsx",
  "apps/admin-web/src/pages/docs/documentationWorkspaceContent.tsx",
  "apps/admin-web/src/pages/docs/documentationRuntimeContent.tsx",
  "apps/admin-web/src/pages/docs/documentationIntegrationContent.tsx",
  "apps/admin-web/src/pages/docs/documentationSdkContent.tsx"
]);
const integration = readSources([
  "apps/admin-web/src/pages/agents/AgentDetailView.tsx",
  "apps/admin-web/src/pages/agents/AgentPanels.tsx",
  "apps/admin-web/src/pages/quickstart/QuickstartView.tsx",
  "apps/admin-web/src/components/shared/code.tsx",
  "apps/admin-web/src/components/shared/events.tsx",
  "apps/admin-web/src/components/shared/layout.tsx",
  "apps/admin-web/src/components/shared/misc.ts"
]);
const server = readSources([
  "apps/control-plane-api/src/routes/agentEnvironmentRoutes.ts",
  "apps/control-plane-api/src/routes/deploymentRoutes.ts",
  "apps/control-plane-api/src/routes/mcpRoutes.ts",
  "apps/control-plane-api/src/routes/sessionRoutes.ts",
  "apps/control-plane-api/src/routes/vaultRoutes.ts",
  "apps/control-plane-api/src/routes/workspaceRoutes.ts"
]);
const sdk = readFileSync("packages/sdk/index.mjs", "utf8");
const sdkTypes = readFileSync("packages/sdk/index.d.ts", "utf8");
const providerReadiness = readFileSync("PROVIDER_READINESS.md", "utf8");
assert.match(docsView, /function DocumentationView\(\)/, "DocumentationView should exist");

for (const forbidden of [
  "api.console.example.com",
  "console-agents",
  "@console/agents",
  "@maple/sdk",
  "from maple import Maple",
  "CONSOLE_API_KEY",
  "sk-ant-api03",
  "gpt-5.5",
  "\"agent_id\": \"agt_pascal\"",
  "\"input\": \"ping\"",
  "Free</td><td>60</td><td>2</td>",
  "rate_limit_error",
  "localhost",
  "开发环境默认",
  "本地服务默认",
  "The development API base URL",
  "The local API defaults",
  "GET /health",
  "health()",
  "本地登录",
  "本地开发",
  "Local login",
  "Local dev",
  "local_docker",
  "local-first",
  "api.maple.local",
  "loginLocal",
  "本地 secret store",
  "local secret store",
  "MAPLE_MODEL_CONFIG_ID"
]) {
  assert.equal(docs.includes(forbidden), false, `DocumentationView should not contain stale placeholder: ${forbidden}`);
}

for (const required of [
  "OpenMaple API",
  "MAPLE_API_BASE_URL",
  "GET <MAPLE_API_BASE_URL>/v1/platform/version",
  "X-Maple-API-Key: maple_ws_xxx",
  "Authorization: Bearer maple_sess_xxx",
  "Cookie: maple_session=maple_sess_xxx",
  "Workspaces & keys",
  "GET /v1/workspace_onboarding/status",
  "POST /v1/workspace_onboarding",
  "GET /v1/workspaces/:workspaceId/runtime_pool",
  "POST /v1/workspaces/:workspaceId/members",
  "POST /v1/workspaces/:workspaceId/api_keys",
  "sandbox_config.vefaas.function_id",
  "sandbox_config.vefaas.gateway_url",
  "provider_credentials.vefaas.VOLCENGINE_ACCESS_KEY",
  "provider_credentials.e2b.E2B_API_KEY",
  "POST /v1/agents",
  "GET /v1/agents/:agentId/runtime",
  "POST /v1/environments",
  "environment_agent_runtime_forbidden",
  "POST /v1/sessions",
  "GET /v1/sessions/:sessionId/detail",
  "GET /v1/sessions/:sessionId/events/stream",
  "event_type_not_client_writable",
  "POST /v1/vaults",
  "POST /v1/vaults/:vaultId/credentials",
  "POST /v1/vaults/:vaultId/credentials/:credId/oauth/start",
  "GET /v1/mcp_catalog",
  "POST /v1/mcp_servers/:mcpId/oauth/start",
  "agent_loop",
  "codex_open_source",
  "anthropic_claude_code",
  "MapleClient",
  "maple-agent-sdk",
  "streamSessionEvents",
  "createSessionAndStream",
  "Vault/MCP 仍直接使用 REST API",
  "Maple CLI",
  "maple init --name repo-auditor --loop codex_open_source",
  "maple skill deploy-run",
  "POST /v1/deployments/:deploymentId/invoke",
  "session.status_failed",
  "openmaple-agent",
  "openmaple-runtime",
  "openmaple-session",
  "openmaple-vault",
  "openmaple-mcp",
  "openmaple-workspace",
  "OpenMaple"
]) {
  assert.match(docs, new RegExp(escapeRegExp(required)), `DocumentationView missing required anchor: ${required}`);
}

for (const forbidden of [
  "python3 -c",
  "json.load(sys.stdin)",
  "full key material is never returned",
  "只有创建响应含完整 key"
]) {
  assert.equal(docs.includes(forbidden), false, `DocumentationView should not require Python in curl snippets: ${forbidden}`);
}

assert.match(docs, /export MAPLE_API_BASE_URL=.*http:\/\/127\.0\.0\.1:27951/, "DocumentationView should provide a paste-ready local MAPLE_API_BASE_URL default");
assert.equal(integration.includes('useState<"python" | "typescript" | "curl">("python")'), false, "Agent integration should not default to Python");
assert.match(integration, /useState<"python" \| "typescript" \| "curl">\("curl"\)/, "Agent integration should default to paste-ready curl");
assert.equal(integration.includes("python3 -c 'import json,sys"), false, "Agent integration curl snippets should not shell out to Python");
assert.match(integration, /SESSION_RESPONSE=\$\(curl -sS "\$MAPLE_API_BASE_URL\/v1\/sessions"/, "Agent integration curl snippet should keep the create-session response for error reporting");
assert.match(integration, /SESSION_ID=\$\(printf '%s\\\\n' "\$SESSION_RESPONSE" \| sed -n/, "Agent integration curl snippet should extract session id with shell tools");
assert.match(integration, /\/v1\/sessions\/\$SESSION_ID\/events\/stream/, "Agent integration curl snippet should stream session events");
assert.match(integration, /createSessionAndStream/, "Agent integration TypeScript snippet should use the streaming SDK helper");
assert.equal(integration.includes("Authorization: Bearer $MAPLE_API_KEY"), false, "Agent integration snippets should use workspace-key headers");
assert.equal(integration.includes("listSessionEvents(session.id)"), false, "Agent integration snippets should not poll events after sending");

for (const route of [
  "app.post(\"/v1/agents\"",
  "app.get(\"/v1/workspace_onboarding/status\"",
  "app.post(\"/v1/workspace_onboarding\"",
  "app.get(\"/v1/workspaces/:workspaceId/runtime_pool\"",
  "app.post(\"/v1/workspaces/:workspaceId/members\"",
  "app.post(\"/v1/workspaces/:workspaceId/api_keys\"",
  "app.get(\"/v1/agents/:agentId/runtime\"",
  "app.post(\"/v1/environments\"",
  "app.post(\"/v1/sessions\"",
  "app.get(\"/v1/sessions/:sessionId/detail\"",
  "app.get(\"/v1/sessions/:sessionId/events/stream\"",
  "app.post(\"/v1/vaults\"",
  "app.post(\"/v1/vaults/:vaultId/credentials\"",
  "app.post(\"/v1/vaults/:vaultId/credentials/:credId/oauth/start\"",
  "app.get(\"/v1/mcp_catalog\"",
  "app.post(\"/v1/mcp_servers/:mcpId/oauth/start\"",
  "app.get(\"/v1/deployments\"",
  "app.post(\"/v1/deployments\"",
  "app.post(\"/v1/deployments/:deploymentId/run\"",
  "app.post(\"/v1/deployments/:deploymentId/invoke\"",
  "app.post(\"/v1/deployments/:deploymentId/archive\""
]) {
  assert.match(server, new RegExp(escapeRegExp(route)), `server route missing for documented endpoint: ${route}`);
}

for (const method of [
  "class MapleClient",
  "async createAgent",
  "async createEnvironment",
  "async createSession",
  "async sessionDetail",
  "async listSessionEvents",
  "async postSessionEvents",
  "async postSessionMessage",
  "async sendSessionMessage",
  "async createSessionAndStream",
  "streamSessionEvents"
]) {
  assert.match(sdk, new RegExp(escapeRegExp(method)), `SDK implementation missing documented method: ${method}`);
}

for (const typeAnchor of [
  "export declare class MapleClient",
  "createAgent(input: JsonRecord)",
  "createEnvironment(input: JsonRecord)",
  "createSession(input: JsonRecord)",
  "postSessionEvents(id: string, events: MapleSessionClientEvent[])",
  "createSessionAndStream(input: MapleSessionStreamInput, options?: MapleSessionStreamOptions)",
  "streamSessionEvents(id: string, options?: MapleSessionStreamOptions)"
]) {
  assert.match(sdkTypes, new RegExp(escapeRegExp(typeAnchor)), `SDK types missing documented method: ${typeAnchor}`);
}

for (const readinessAnchor of [
  "| AWS Lambda agent runtime | Configuration stub |",
  "AWS Lambda agent runtime provider is configured but the invoke adapter is not implemented yet.",
  "| Vercel sandbox | Configuration stub |",
  "Vercel sandbox provider is configured but the sandbox adapter is not implemented yet.",
  "| local_docker | Runnable locally |",
  "| E2B | Implemented with credentials |",
  "| veFaaS sandbox | Implemented with credentials |"
]) {
  assert.match(providerReadiness, new RegExp(escapeRegExp(readinessAnchor)), `provider readiness missing honest status anchor: ${readinessAnchor}`);
}

for (const evidencePath of [...providerReadiness.matchAll(/`(apps\/[^`]+|tests\/[^`]+)`/g)].map((match) => match[1])) {
  assert.equal(existsSync(evidencePath), true, `provider readiness evidence path missing: ${evidencePath}`);
}

console.log("maple docs contract passed");

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function readSources(paths: string[]) {
  return paths.map((path) => readFileSync(path, "utf8")).join("\n");
}

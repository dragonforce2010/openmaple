import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";

const compose = readFileSync("compose.yaml", "utf8");
const dockerfile = readFileSync("Dockerfile", "utf8");
const envExample = readFileSync(".env.example", "utf8");
const packageJson = readFileSync("package.json", "utf8");
const setup = readFileSync("scripts/setup-local-docker.sh", "utf8");
const localDockerMode = readFileSync("apps/control-plane-api/src/runtime/localDockerMode.ts", "utf8");
const modelGatewaySeed = readFileSync("apps/control-plane-api/src/catalog/modelGatewaySeed.ts", "utf8");
const modelGateway = readFileSync("apps/control-plane-api/src/catalog/modelGateway.ts", "utf8");
const onboardingSteps = readFileSync("apps/admin-web/src/pages/workspaces/WorkspaceOnboardingSteps.tsx", "utf8");
const quickstartController = readFileSync("apps/admin-web/src/app/useQuickstartController.ts", "utf8");
const agentRoutes = readFileSync("apps/control-plane-api/src/routes/agentEnvironmentRoutes.ts", "utf8");
const quickstartRoutes = readFileSync("apps/control-plane-api/src/routes/quickstartRoutes.ts", "utf8");
const viteConfig = readFileSync("apps/admin-web/vite.config.ts", "utf8");
const webServer = readFileSync("apps/control-plane-api/src/web/web.ts", "utf8");

for (const service of ["api", "web", "mysql"]) {
  assert.match(compose, new RegExp(`^  ${service}:$`, "m"), `compose must expose a clear ${service} service`);
}

assert.equal(compose.includes("managed-agents-platform:"), false, "compose should not hide frontend behind the old monolithic service name");
assert.match(compose, /api:[\s\S]*SERVE_STATIC: "false"/, "api service must not serve the frontend");
assert.match(compose, /web:[\s\S]*MAPLE_WEB_STATIC_DIR: \/app\/dist/, "web service must serve built admin-web assets");
assert.match(compose, /web:[\s\S]*MAPLE_API_PROXY_TARGET: http:\/\/api:27951/, "web service must proxy API calls to the api service");
assert.match(compose, /\$\{MAPLE_WEB_PORT:-8080\}:8080/, "web service must default to host port 8080");
assert.match(compose, /MAPLE_WEB_BASE_URL: \$\{MAPLE_WEB_BASE_URL:-http:\/\/127\.0\.0\.1:\$\{MAPLE_WEB_PORT:-8080\}\}/, "api service must derive the local web base URL from MAPLE_WEB_PORT");
assert.match(compose, /MAPLE_LOCAL_MODEL_CONFIG_FILE: \$\{MAPLE_LOCAL_MODEL_CONFIG_FILE:-config\/local-model\.json\}/, "api service must read local model config from config/local-model.json");
assert.match(compose, /OPENAI_API_KEY: \$\{MAPLE_LOCAL_OPENAI_API_KEY:-\}/, "compose must not read host OPENAI_API_KEY implicitly");
assert.match(compose, /ARK_API_KEY: \$\{MAPLE_LOCAL_ARK_API_KEY:-\}/, "compose must not read host ARK_API_KEY implicitly");
assert.match(compose, /\$\{MAPLE_API_PORT:-27951\}:27951/, "api service must keep direct API access on 27951");
assert.match(compose, /\/var\/run\/docker\.sock:\/var\/run\/docker\.sock/, "api service must mount the host Docker socket for local_docker");
assert.match(compose, /\.\/config:\/app\/config:ro/, "api service must mount local model config read-only");
assert.match(dockerfile, /SERVE_STATIC=false/, "image default should not make API serve static assets");
assert.match(localDockerMode, /MAPLE_LOCAL_DOCKER_MODE/, "model seed logic must detect local Docker mode through the shared helper");
assert.match(localDockerMode, /falsy\(process\.env\.MAPLE_LOCAL_DOCKER_MODE\)/, "explicit MAPLE_LOCAL_DOCKER_MODE=false must override inherited local env");
assert.match(localDockerMode, /runtimeProvider && runtimeProvider !== "local_docker"/, "non-local runtime provider must override inherited local env");
assert.match(modelGatewaySeed, /MAPLE_SEED_DEFAULT_MODELS/, "model seed logic must keep an explicit default seed override");
assert.match(modelGatewaySeed, /config\/local-model\.json/, "local Docker model seed must come from a user-owned config file");
assert.match(modelGatewaySeed, /return !isLocalDockerMode\(\)/, "bundled VolcoEngine seed must be off by default in local Docker mode");
assert.match(modelGateway, /MAPLE_LOCAL_ALLOW_ENV_MODEL/, "local Docker must not silently use host provider env without explicit opt-in");
assert.match(onboardingSteps, /runtimeProvider === "local_docker"[\s\S]*预热 Runtime 数/, "local Docker runtime UI must expose only the useful runtime pool size");
assert.match(onboardingSteps, /runtimeProvider === "local_docker"[\s\S]*本机 Docker runtime member/, "local Docker runtime UI must explain the pool target");
assert.equal(/runtimeProvider === "local_docker"[\s\S]{0,500}CPU Milli/.test(onboardingSteps), false, "local Docker runtime UI must not expose cloud CPU fields");
assert.equal(quickstartController.includes("当前工作区没有可用模型池。请先配置模型池。"), false, "local Quickstart must not block before the backend can apply local fallback");
assert.match(agentRoutes, /workspaceAllowsUnconfiguredModel/, "agent creation must allow empty model pool only for local Docker workspaces");
assert.match(quickstartRoutes, /workspaceRequiresModelPool/, "Quickstart route must keep cloud model-pool validation but allow local Docker fallback");

assert.match(viteConfig, /process\.env\.MAPLE_WEB_PORT \|\| process\.env\.PORT \|\| 8080/, "Vite dev server must default to 8080");
assert.match(webServer, /process\.env\.MAPLE_WEB_PORT \|\| process\.env\.PORT \|\| 8080/, "standalone web server must default to 8080");
assert.match(packageJson, /"dev:web": "bunx vite --config apps\/admin-web\/vite\.config\.ts --host 127\.0\.0\.1 --port 8080"/, "dev:web should use 8080");
assert.match(packageJson, /"setup:local": "bash scripts\/setup-local-docker\.sh"/, "package scripts should expose one-command local setup");
assert.match(packageJson, /"test:local-docker-compose": "bun tests\/contracts\/local_docker_compose_contract\.ts"/, "contract test should be runnable");

for (const required of [
  "MAPLE_WEB_PORT=8080",
  "MAPLE_API_PORT=27951",
  "MAPLE_MYSQL_HOST_PORT=3307",
  "MAPLE_WEB_BASE_URL=http://127.0.0.1:8080",
  "MAPLE_LOCAL_DOCKER_MODE=true",
  "MAPLE_AGENT_RUNTIME_PROVIDER=local_docker",
  "MAPLE_SANDBOX_PROVIDER=local_docker",
  "MAPLE_DOCKER_IMAGE=node:22-bookworm",
  "MAPLE_LOCAL_MODEL_CONFIG_FILE=config/local-model.json",
  "MAPLE_SEED_DEMO_DATA=false",
  "MAPLE_DOCKER_WORKSPACE_HOST_ROOT=",
  "MAPLE_LOCAL_OPENAI_API_KEY=",
  "MAPLE_LOCAL_ARK_API_KEY="
]) {
  assert.match(envExample, new RegExp(escapeRegExp(required)), `.env.example missing local setting: ${required}`);
}

for (const forbidden of [
  "VOLCENGINE_ACCESS_KEY",
  "VOLCENGINE_SECRET_KEY",
  "MAPLE_VEFAAS",
  "MAPLE_TOS",
  "E2B_API_KEY",
  "MAPLE_OAUTH",
  "MAPLE_OIDC",
  "MAPLE_LARK",
  "MAPLE_BYTESSO",
  "MAPLE_MCP_",
  "MAPLE_SECRET_MASTER_KEY"
]) {
  assert.equal(envExample.includes(forbidden), false, `.env.example should not expose online-only setting: ${forbidden}`);
}

assert.equal(Boolean(statSync("scripts/setup-local-docker.sh").mode & 0o111), true, "setup script must be executable");
for (const required of [
  "ensure_docker_cli",
  "wait_for_docker",
  "pick_port",
  "MAPLE_SETUP_IMPORT_MODEL_KEYS",
  "MAPLE_SEED_DEMO_DATA",
  "import_demo_data",
  "docker/local-demo-data.sql",
  "write_env_file",
  "docker pull",
  "--env-file \"$env_file\" up --build -d mysql api web",
  "Web console: http://127.0.0.1:%s/",
  "API health:   http://127.0.0.1:%s/health",
  "open \"http://127.0.0.1:${web_port}/?dev_login=1\""
]) {
  assert.match(setup, new RegExp(escapeRegExp(required)), `setup script missing anchor: ${required}`);
}

console.log("local docker compose contract passed");

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

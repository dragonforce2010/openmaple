import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AliyunFcRuntimeDeployer,
  createHttpTriggerRequest,
  resolveFcEndpointConfig,
  resolveDeployConfig
} from "../../infra/aliyun/deploy_aliyun_fc_runtime.mjs";

const tempDir = mkdtempSync(join(tmpdir(), "maple-aliyun-fc-contract-"));
const sourceDir = join(tempDir, "runtime-app");
const accountFile = join(tempDir, "account.yaml");
mkdirSync(sourceDir);
writeFileSync(join(sourceDir, ".keep"), "");
writeFileSync(join(sourceDir, "run.sh"), "#!/bin/bash\nexec python3 app.py\n");
chmodSync(join(sourceDir, "run.sh"), 0o755);
writeFileSync(accountFile, `
cloudProviders:
  aliyun:
    accessKeyId: contract-ak
    accessKeySecret: contract-sk
    region: cn-hangzhou
`);

const config = resolveDeployConfig({
  MAPLE_ALIYUN_ACCOUNT_FILE: accountFile,
  MAPLE_ALIYUN_FC_FUNCTION_NAME: "1 invalid name",
  MAPLE_ALIYUN_FC_TRIGGER_NAME: "contract-trigger",
  MAPLE_ALIYUN_FC_MEMORY_MB: "512",
  MAPLE_ALIYUN_FC_RUNTIME_ENVS: JSON.stringify({ MAPLE_SKIP_CLAUDE_AGENT_SDK_INSTALL: "true" })
}, { sourceDir });

assert.equal(config.accessKeyId, "contract-ak");
assert.equal(config.accessKeySecret, "contract-sk");
assert.equal(config.region, "cn-hangzhou");
assert.equal(config.runtime, "custom.debian10");
assert.equal(config.memoryMb, 512);
assert.equal(config.cpu, 0.25);
assert.match(config.functionName, /^m-/);
assert.equal(config.envs.MAPLE_SKIP_CLAUDE_AGENT_SDK_INSTALL, "true");

const endpointConfig = await resolveFcEndpointConfig({ ...config, accountId: "1234567890123456", endpoint: "" });
assert.equal(endpointConfig.endpoint, "1234567890123456.cn-hangzhou.fc.aliyuncs.com");

const calls: Array<Record<string, unknown>> = [];
const fakeClient = {
  async createFunction(request: Record<string, unknown>) {
    calls.push({ type: "createFunction", request });
    return { body: { functionId: "fc-contract-function-id" } };
  },
  async createTrigger(functionName: string, request: Record<string, unknown>) {
    calls.push({ type: "createTrigger", functionName, request });
    return { body: { httpTrigger: { urlInternet: "https://contract-fc.cn-hangzhou.fcapp.run/" } } };
  },
  async putConcurrencyConfig(functionName: string, request: Record<string, unknown>) {
    calls.push({ type: "putConcurrencyConfig", functionName, request });
    return {};
  },
  async deleteTrigger(functionName: string, triggerName: string) {
    calls.push({ type: "deleteTrigger", functionName, triggerName });
    return {};
  },
  async deleteFunction(functionName: string) {
    calls.push({ type: "deleteFunction", functionName });
    return {};
  }
};

const deployer = new AliyunFcRuntimeDeployer({
  client: fakeClient,
  zipSourceDir: async () => Buffer.from("zip-bytes")
});
const deployResult = await deployer.deploy({
  ...config,
  functionName: "maple_contract_fc",
  triggerName: "maple_contract_fc_http",
  reservedConcurrency: 2
});

assert.equal(deployResult.provider, "aliyun_fc");
assert.equal(deployResult.function_name, "maple_contract_fc");
assert.equal(deployResult.function_id, "fc-contract-function-id");
assert.equal(deployResult.invoke_url, "https://contract-fc.cn-hangzhou.fcapp.run");

const createFunctionCall = calls.find((call) => call.type === "createFunction") as Record<string, unknown>;
assert.ok(createFunctionCall);
const createFunctionBody = ((createFunctionCall.request as Record<string, unknown>).body ?? {}) as Record<string, unknown>;
assert.equal(createFunctionBody.functionName, "maple_contract_fc");
assert.equal(createFunctionBody.runtime, "custom.debian10");
assert.equal(createFunctionBody.memorySize, 512);
assert.equal(createFunctionBody.cpu, 0.25);
assert.equal(createFunctionBody.instanceConcurrency, 20);
assert.equal(((createFunctionBody.code as Record<string, unknown>).zipFile), Buffer.from("zip-bytes").toString("base64"));
assert.deepEqual((createFunctionBody.customRuntimeConfig as Record<string, unknown>).command, ["./run.sh"]);
assert.equal((createFunctionBody.customRuntimeConfig as Record<string, unknown>).port, 8000);
assert.equal((createFunctionBody.environmentVariables as Record<string, unknown>).MAPLE_SKIP_CLAUDE_AGENT_SDK_INSTALL, "true");

const createTriggerCall = calls.find((call) => call.type === "createTrigger") as Record<string, unknown>;
assert.ok(createTriggerCall);
const createTriggerBody = ((createTriggerCall.request as Record<string, unknown>).body ?? {}) as Record<string, unknown>;
assert.equal(createTriggerBody.triggerName, "maple_contract_fc_http");
assert.equal(createTriggerBody.triggerType, "http");
const triggerConfig = JSON.parse(String(createTriggerBody.triggerConfig));
assert.equal(triggerConfig.authType, "anonymous");
assert.equal(triggerConfig.disableURLInternet, false);
assert.deepEqual(triggerConfig.methods, ["GET", "POST", "OPTIONS"]);

const request = createHttpTriggerRequest("maple_contract_fc_http");
assert.equal((request.body as Record<string, unknown>).triggerType, "http");

await deployer.cleanup({ ...config, functionName: "maple_contract_fc", triggerName: "maple_contract_fc_http" });
assert.deepEqual(calls.slice(-2).map((call) => call.type), ["deleteTrigger", "deleteFunction"]);

const provisioningSource = readFileSync("apps/control-plane-api/src/storage/storeWorkspaceProvisioning.ts", "utf8");
assert.match(provisioningSource, /infra\/aliyun\/deploy_aliyun_fc_runtime\.mjs/);
assert.match(provisioningSource, /MAPLE_ALIYUN_FC_CPU_MILLI/);
const sandboxPoolSource = readFileSync("apps/control-plane-api/src/runtime/sandboxPoolManager.ts", "utf8");
assert.match(sandboxPoolSource, /MAPLE_ALIYUN_FC_SANDBOX_DEPLOY_SCRIPT/);
assert.match(sandboxPoolSource, /ensureAliyunFcSandboxProviderReady/);

console.log("aliyun fc deploy contract passed");

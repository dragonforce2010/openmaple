#!/usr/bin/env node
import { execFile } from "node:child_process";
import { createHash, createHmac, randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmdirSync, statSync, unlinkSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, join, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import FCClient, {
  CreateFunctionInput,
  CreateFunctionRequest,
  CreateTriggerInput,
  CreateTriggerRequest,
  CustomRuntimeConfig,
  GetFunctionRequest,
  InputCodeLocation,
  PutConcurrencyConfigRequest,
  PutConcurrencyInput,
  Tag
} from "@alicloud/fc20230330";
import { $OpenApiUtil } from "@alicloud/openapi-core";
import { parse as parseYaml } from "yaml";

const execFileAsync = promisify(execFile);
const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const defaultSourceDir = join(repoRoot, "infra/vefaas/runtime-app");
const defaultAccountFile = join(homedir(), ".agents/.account.yaml");
const defaultTimeoutMs = 10 * 60 * 1000;

export function parseCliArgs(argv) {
  const args = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith("--")) {
      args._.push(item);
      continue;
    }
    const [rawKey, rawValue] = item.slice(2).split("=", 2);
    const key = rawKey.replace(/-([a-z])/g, (_, char) => char.toUpperCase());
    if (rawValue !== undefined) {
      args[key] = rawValue;
      continue;
    }
    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      args[key] = next;
      index += 1;
    } else {
      args[key] = "true";
    }
  }
  return args;
}

export function resolveDeployConfig(env = process.env, args = {}) {
  const accountFile = stringValue(args.accountFile || env.MAPLE_ALIYUN_ACCOUNT_FILE || env.ALIYUN_ACCOUNT_FILE || defaultAccountFile);
  const accountAliyun = aliyunAccountFromFile(accountFile);
  const functionName = safeAliyunName(stringValue(args.functionName || env.MAPLE_ALIYUN_FC_FUNCTION_NAME) || generatedName("maple-fc"), 64);
  const triggerName = safeAliyunName(stringValue(args.triggerName || env.MAPLE_ALIYUN_FC_TRIGGER_NAME) || `${functionName}-http`, 128);
  const memoryMb = normalizeMemoryMb(numberValue(args.memoryMb ?? env.MAPLE_ALIYUN_FC_MEMORY_MB, 2048));
  const rawCpu = numberValue(args.cpu ?? env.MAPLE_ALIYUN_FC_CPU, numberValue(env.MAPLE_ALIYUN_FC_CPU_MILLI, NaN) / 1000);
  const runtimeEnvs = {
    SERVER_PORT: String(numberValue(env.MAPLE_ALIYUN_FC_RUNTIME_PORT, 8000)),
    ...parseJsonObject(env.MAPLE_ALIYUN_FC_RUNTIME_ENVS)
  };
  return {
    accessKeyId: stringValue(args.accessKeyId || env.ALIYUN_ACCESS_KEY_ID || env.MAPLE_ALIYUN_ACCESS_KEY_ID || accountAliyun.accessKeyId),
    accessKeySecret: stringValue(args.accessKeySecret || env.ALIYUN_ACCESS_KEY_SECRET || env.MAPLE_ALIYUN_ACCESS_KEY_SECRET || accountAliyun.accessKeySecret),
    securityToken: stringValue(args.securityToken || env.ALIYUN_SECURITY_TOKEN || env.MAPLE_ALIYUN_SECURITY_TOKEN || accountAliyun.securityToken),
    accountId: stringValue(args.accountId || env.ALIYUN_ACCOUNT_ID || env.MAPLE_ALIYUN_ACCOUNT_ID || accountAliyun.accountId),
    region: stringValue(args.region || env.ALIYUN_REGION || env.MAPLE_ALIYUN_REGION || accountAliyun.region) || "cn-hangzhou",
    endpoint: stringValue(args.endpoint || env.MAPLE_ALIYUN_FC_ENDPOINT),
    functionName,
    triggerName,
    sourceDir: resolve(repoRoot, stringValue(args.sourceDir || env.MAPLE_ALIYUN_FC_SOURCE_DIR) || defaultSourceDir),
    runtime: stringValue(args.runtime || env.MAPLE_ALIYUN_FC_RUNTIME) || "custom.debian10",
    handler: stringValue(args.handler || env.MAPLE_ALIYUN_FC_HANDLER) || "index.handler",
    command: splitCommand(args.command || env.MAPLE_ALIYUN_FC_COMMAND || "./run.sh"),
    commandArgs: splitCommand(args.commandArgs || env.MAPLE_ALIYUN_FC_COMMAND_ARGS || ""),
    port: numberValue(args.port ?? env.MAPLE_ALIYUN_FC_RUNTIME_PORT, 8000),
    memoryMb,
    cpu: normalizeCpu(numberValue(rawCpu, memoryMb / 2048), memoryMb),
    diskMb: normalizeDiskMb(numberValue(args.diskMb ?? env.MAPLE_ALIYUN_FC_DISK_MB, 512)),
    timeoutSeconds: normalizeTimeoutSeconds(numberValue(args.timeoutSeconds ?? env.MAPLE_ALIYUN_FC_TIMEOUT_SECONDS, 1800)),
    instanceConcurrency: Math.max(1, Math.floor(numberValue(args.instanceConcurrency ?? env.MAPLE_RUNTIME_FUNCTION_MAX_CONCURRENCY ?? env.MAPLE_ALIYUN_FC_INSTANCE_CONCURRENCY, 20))),
    reservedConcurrency: optionalInteger(args.reservedConcurrency ?? env.MAPLE_ALIYUN_FC_RESERVED_CONCURRENCY),
    envs: runtimeEnvs,
    tags: {
      app: "openmaple",
      managed_by: "openmaple",
      component: stringValue(args.component || env.MAPLE_ALIYUN_FC_COMPONENT) || "agent-runtime"
    },
    replaceExisting: stringValue(args.replaceExisting || env.MAPLE_ALIYUN_FC_REPLACE_EXISTING).toLowerCase() === "true",
    keepFailed: stringValue(args.keepFailed || env.MAPLE_ALIYUN_FC_KEEP_FAILED).toLowerCase() === "true"
  };
}

export class AliyunFcRuntimeDeployer {
  constructor(options = {}) {
    this.client = options.client;
    this.zipSourceDir = options.zipSourceDir || zipSourceDir;
    this.now = options.now || (() => new Date().toISOString());
  }

  getClient(config) {
    if (this.client) return this.client;
    return createAliyunFcClient(config);
  }

  async resolvedClient(config) {
    if (this.client) return this.client;
    return createAliyunFcClient(await resolveFcEndpointConfig(config));
  }

  async deploy(config) {
    validateDeployConfig(config);
    const client = await this.resolvedClient(config);
    if (config.replaceExisting) await this.cleanup(config).catch(() => undefined);
    const zipBuffer = await this.zipSourceDir(config.sourceDir);
    const createFunctionRequest = new CreateFunctionRequest({
      body: new CreateFunctionInput({
        code: new InputCodeLocation({ zipFile: zipBuffer.toString("base64") }),
        cpu: config.cpu,
        customRuntimeConfig: new CustomRuntimeConfig({
          command: config.command,
          ...(config.commandArgs.length ? { args: config.commandArgs } : {}),
          port: config.port
        }),
        description: "OpenMaple managed agent runtime and sandbox function",
        diskSize: config.diskMb,
        environmentVariables: config.envs,
        functionName: config.functionName,
        handler: config.handler,
        instanceConcurrency: config.instanceConcurrency,
        internetAccess: true,
        memorySize: config.memoryMb,
        runtime: config.runtime,
        tags: objectToTags(config.tags),
        timeout: config.timeoutSeconds
      })
    });
    let createdFunction = false;
    try {
      const functionResponse = await client.createFunction(createFunctionRequest);
      createdFunction = true;
      if (config.reservedConcurrency !== null) {
        await client.putConcurrencyConfig(config.functionName, new PutConcurrencyConfigRequest({
          body: new PutConcurrencyInput({ reservedConcurrency: config.reservedConcurrency })
        }));
      }
      const triggerResponse = await client.createTrigger(config.functionName, createHttpTriggerRequest(config.triggerName));
      const invokeUrl = stringValue(triggerResponse?.body?.httpTrigger?.urlInternet).replace(/\/+$/, "");
      if (!invokeUrl) throw new Error("Aliyun FC createTrigger returned no httpTrigger.urlInternet.");
      return {
        provider: "aliyun_fc",
        region: config.region,
        function_name: config.functionName,
        function_id: stringValue(functionResponse?.body?.functionId || config.functionName),
        service_name: "",
        trigger_name: config.triggerName,
        invoke_url: invokeUrl,
        source_type: "source_zip",
        runtime: config.runtime,
        memory_mb: config.memoryMb,
        cpu: config.cpu
      };
    } catch (error) {
      if (createdFunction && !config.keepFailed) await this.cleanup(config).catch(() => undefined);
      throw error;
    }
  }

  async cleanup(config) {
    if (!config.functionName) throw new Error("cleanup requires MAPLE_ALIYUN_FC_FUNCTION_NAME or --function-name.");
    const client = await this.resolvedClient(config);
    const result = { provider: "aliyun_fc", region: config.region, function_name: config.functionName, trigger_name: config.triggerName, deleted: [], skipped: [] };
    try {
      await client.deleteTrigger(config.functionName, config.triggerName);
      result.deleted.push("trigger");
    } catch (error) {
      if (isNotFoundError(error)) result.skipped.push("trigger_not_found");
      else throw error;
    }
    try {
      await client.deleteFunction(config.functionName);
      result.deleted.push("function");
    } catch (error) {
      if (isNotFoundError(error)) result.skipped.push("function_not_found");
      else throw error;
    }
    return result;
  }

  async status(config) {
    if (!config.functionName) throw new Error("status requires MAPLE_ALIYUN_FC_FUNCTION_NAME or --function-name.");
    const client = await this.resolvedClient(config);
    const response = await client.getFunction(config.functionName, new GetFunctionRequest({}));
    return {
      provider: "aliyun_fc",
      region: config.region,
      function_name: config.functionName,
      state: stringValue(response?.body?.state),
      last_update_status: stringValue(response?.body?.lastUpdateStatus),
      runtime: stringValue(response?.body?.runtime)
    };
  }
}

export function createAliyunFcClient(config) {
  const clientConfig = new $OpenApiUtil.Config({
    accessKeyId: config.accessKeyId,
    accessKeySecret: config.accessKeySecret,
    securityToken: config.securityToken || undefined,
    regionId: config.region
  });
  if (config.endpoint) clientConfig.endpoint = config.endpoint;
  const ClientCtor = aliyunFcClientConstructor();
  return new ClientCtor(clientConfig);
}

function aliyunFcClientConstructor() {
  const candidates = [FCClient, FCClient?.default, FCClient?.default?.default];
  const ctor = candidates.find((candidate) => typeof candidate === "function");
  if (!ctor) throw new Error("Aliyun FC SDK client constructor not found.");
  return ctor;
}

export async function resolveFcEndpointConfig(config) {
  if (config.endpoint) return config;
  const accountId = config.accountId || await resolveAliyunAccountId(config);
  return {
    ...config,
    accountId,
    endpoint: `${accountId}.${config.region}.fc.aliyuncs.com`
  };
}

export function createHttpTriggerRequest(triggerName) {
  return new CreateTriggerRequest({
    body: new CreateTriggerInput({
      description: "OpenMaple HTTP invoke trigger",
      triggerName,
      triggerType: "http",
      triggerConfig: JSON.stringify({
        authType: "anonymous",
        methods: ["GET", "POST", "OPTIONS"],
        disableURLInternet: false
      })
    })
  });
}

export async function zipSourceDir(sourceDir) {
  if (!existsSync(sourceDir) || !statSync(sourceDir).isDirectory()) throw new Error(`source directory not found: ${sourceDir}`);
  const tempDir = mkdtempSync(join(tmpdir(), "maple-aliyun-fc-"));
  const zipPath = join(tempDir, "runtime.zip");
  const script = `
import os, stat, sys, zipfile
src = os.path.abspath(sys.argv[1])
out = os.path.abspath(sys.argv[2])
ignore = {".git", "__pycache__", ".pytest_cache", ".venv", "node_modules"}
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as zf:
    for root, dirs, files in os.walk(src):
        dirs[:] = [d for d in dirs if d not in ignore]
        for name in files:
            path = os.path.join(root, name)
            rel = os.path.relpath(path, src)
            info = zipfile.ZipInfo(rel)
            st = os.stat(path)
            info.external_attr = (st.st_mode & 0xFFFF) << 16
            with open(path, "rb") as fh:
                zf.writestr(info, fh.read(), zipfile.ZIP_DEFLATED)
`;
  try {
    await execFileAsync("python3", ["-c", script, sourceDir, zipPath], { encoding: "utf8", timeout: defaultTimeoutMs });
    return readFileSync(zipPath);
  } finally {
    if (existsSync(zipPath)) unlinkSync(zipPath);
    if (existsSync(tempDir)) rmdirSync(tempDir);
  }
}

function validateDeployConfig(config) {
  if (!config.accessKeyId || !config.accessKeySecret) throw new Error("Aliyun FC deploy requires ALIYUN_ACCESS_KEY_ID/ALIYUN_ACCESS_KEY_SECRET or cloudProviders.aliyun in ~/.agents/.account.yaml.");
  if (!config.region) throw new Error("Aliyun FC deploy requires ALIYUN_REGION.");
  if (!/^[A-Za-z_][A-Za-z0-9_-]{0,63}$/.test(config.functionName)) throw new Error(`invalid Aliyun FC function name: ${config.functionName}`);
  if (!/^[A-Za-z_][A-Za-z0-9_-]{0,127}$/.test(config.triggerName)) throw new Error(`invalid Aliyun FC trigger name: ${config.triggerName}`);
}

function aliyunAccountFromFile(filePath) {
  if (!filePath || !existsSync(filePath)) return {};
  const parsed = parseYaml(readFileSync(filePath, "utf8")) || {};
  const providerRoot = recordValue(parsed.cloudProviders ?? parsed.cloud_providers ?? parsed.providers);
  const aliyun = recordValue(providerRoot.aliyun ?? providerRoot.alibaba_cloud ?? parsed.aliyun ?? parsed.alibaba_cloud);
  return {
    accessKeyId: stringValue(aliyun.ALIYUN_ACCESS_KEY_ID ?? aliyun.access_key_id ?? aliyun.accessKeyId ?? aliyun.ak ?? aliyun.access_key),
    accessKeySecret: stringValue(aliyun.ALIYUN_ACCESS_KEY_SECRET ?? aliyun.access_key_secret ?? aliyun.accessKeySecret ?? aliyun.sk ?? aliyun.secret_key),
    securityToken: stringValue(aliyun.ALIYUN_SECURITY_TOKEN ?? aliyun.security_token ?? aliyun.securityToken),
    accountId: stringValue(aliyun.ALIYUN_ACCOUNT_ID ?? aliyun.account_id ?? aliyun.accountId),
    region: stringValue(aliyun.ALIYUN_REGION ?? aliyun.region)
  };
}

async function resolveAliyunAccountId(config) {
  const params = {
    AccessKeyId: config.accessKeyId,
    Action: "GetCallerIdentity",
    Format: "JSON",
    SignatureMethod: "HMAC-SHA1",
    SignatureNonce: randomUUID(),
    SignatureVersion: "1.0",
    Timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    Version: "2015-04-01"
  };
  if (config.securityToken) params.SecurityToken = config.securityToken;
  const canonical = canonicalQuery(params);
  const signature = createHmac("sha1", `${config.accessKeySecret}&`).update(`POST&%2F&${encodeRfc3986(canonical)}`).digest("base64");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch("https://sts.aliyuncs.com/", {
      method: "POST",
      body: `${canonical}&Signature=${encodeRfc3986(signature)}`,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      signal: controller.signal
    });
    const body = await response.json().catch(() => ({}));
    const accountId = stringValue(body.AccountId || body.AccountID || body.accountId);
    if (!response.ok || !accountId) throw new Error(`Aliyun STS GetCallerIdentity failed: ${stringValue(body.Code || body.code || response.status)}`);
    return accountId;
  } finally {
    clearTimeout(timeout);
  }
}

function canonicalQuery(query) {
  return Object.keys(query).sort().map((key) => `${encodeRfc3986(key)}=${encodeRfc3986(query[key])}`).join("&");
}

function encodeRfc3986(value) {
  return encodeURIComponent(String(value)).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

function safeAliyunName(value, maxLength) {
  const base = String(value || "maple-fc")
    .replace(/[^A-Za-z0-9_-]/g, "-")
    .replace(/^[0-9-]+/, "m-")
    .slice(0, maxLength)
    .replace(/[-_]+$/g, "");
  return /^[A-Za-z_]/.test(base) ? base || "maple-fc" : `m-${base}`.slice(0, maxLength);
}

function generatedName(prefix) {
  const seed = `${Date.now()}-${process.pid}-${Math.random()}`;
  return `${prefix}-${createHash("sha1").update(seed).digest("hex").slice(0, 10)}`;
}

function normalizeMemoryMb(value) {
  const rounded = Math.ceil(Math.max(128, Number(value) || 2048) / 64) * 64;
  return Math.min(32768, rounded);
}

function normalizeCpu(value, memoryMb) {
  const memoryGb = memoryMb / 1024;
  const min = memoryGb / 4;
  const max = memoryGb;
  const clamped = Math.min(max, Math.max(min, Number.isFinite(value) ? value : memoryGb / 2));
  return Math.round(clamped * 20) / 20;
}

function normalizeDiskMb(value) {
  return Number(value) >= 10240 ? 10240 : 512;
}

function normalizeTimeoutSeconds(value) {
  return Math.min(86400, Math.max(1, Math.floor(Number(value) || 1800)));
}

function optionalInteger(value) {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : null;
}

function parseJsonObject(value) {
  if (!value) return {};
  const parsed = JSON.parse(String(value));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("MAPLE_ALIYUN_FC_RUNTIME_ENVS must be a JSON object.");
  return Object.fromEntries(Object.entries(parsed).map(([key, val]) => [key, String(val)]));
}

function splitCommand(value) {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  return String(value || "").split(/\s+/).map((item) => item.trim()).filter(Boolean);
}

function objectToTags(tags) {
  return Object.entries(tags || {}).filter(([, value]) => value !== undefined && value !== "").map(([key, value]) => new Tag({ key, value: String(value) }));
}

function isNotFoundError(error) {
  const message = String(error?.message || error?.data?.message || error?.data?.Message || "");
  const code = String(error?.code || error?.data?.code || error?.data?.Code || "");
  return /not.?found|404|FunctionNotFound|TriggerNotFound/i.test(`${code} ${message}`);
}

function numberValue(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function stringValue(value) {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

function recordValue(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

async function main() {
  const args = parseCliArgs(process.argv.slice(2));
  const command = stringValue(args._[0] || "deploy");
  const config = resolveDeployConfig(process.env, args);
  const deployer = new AliyunFcRuntimeDeployer();
  const result = command === "cleanup"
    ? await deployer.cleanup(config)
    : command === "status"
      ? await deployer.status(config)
      : await deployer.deploy(config);
  const printable = { ...result };
  if (printable.source_dir) printable.source_dir = relative(repoRoot, printable.source_dir);
  process.stdout.write(`${JSON.stringify(printable)}\n`);
}

if (basename(process.argv[1] || "") === basename(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}

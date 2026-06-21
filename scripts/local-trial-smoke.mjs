#!/usr/bin/env node

const DEFAULT_BASE_URL = "http://127.0.0.1:27951";
const DEFAULT_TIMEOUT_MS = 5000;

const options = parseArgs(process.argv.slice(2));
if (options.help) {
  printUsage();
  process.exit(0);
}

if (typeof fetch !== "function") {
  fail("global fetch is unavailable. Use Node 18+ or Bun.");
}

const baseUrl = trimTrailingSlash(options.baseUrl || process.env.MAPLE_API_BASE_URL || process.env.MAPLE_BASE_URL || DEFAULT_BASE_URL);
const timeoutMs = options.timeoutMs;
const results = [];

try {
  const health = await getJson(`${baseUrl}/health`, timeoutMs);
  assertEqual(health.ok, true, "/health ok must be true");
  assertEqual(health.service, "maple", "/health service must be maple");
  results.push({ endpoint: "/health", status: "ok", service: health.service });

  const authBootstrap = await getJson(`${baseUrl}/v1/auth/bootstrap`, timeoutMs);
  assertHas(authBootstrap, "recommended_view", "/v1/auth/bootstrap must include recommended_view");
  assertHas(authBootstrap, "tenants", "/v1/auth/bootstrap must include tenants");
  results.push({
    endpoint: "/v1/auth/bootstrap",
    status: "ok",
    recommended_view: authBootstrap.recommended_view
  });

  const platform = await getJson(`${baseUrl}/v1/platform/version`, timeoutMs);
  assertEqual(platform.service, "maple", "/v1/platform/version service must be maple");
  assertHas(platform, "version", "/v1/platform/version must include version");
  results.push({
    endpoint: "/v1/platform/version",
    status: "ok",
    version: platform.version,
    agent_loop_types: Array.isArray(platform.agent_loop_types) ? platform.agent_loop_types.length : 0
  });
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}

const payload = { status: "ok", base_url: baseUrl, checks: results };
if (options.json) {
  console.log(JSON.stringify(payload, null, 2));
} else {
  console.log(`OpenMaple local trial smoke passed: ${baseUrl}`);
  for (const result of results) {
    const detail = Object.entries(result)
      .filter(([key]) => !["endpoint", "status"].includes(key))
      .map(([key, value]) => `${key}=${value}`)
      .join(" ");
    console.log(`- ${result.endpoint}: ${result.status}${detail ? ` ${detail}` : ""}`);
  }
}

function parseArgs(args) {
  const parsed = { baseUrl: "", timeoutMs: DEFAULT_TIMEOUT_MS, json: false, help: false };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
    } else if (arg === "--json") {
      parsed.json = true;
    } else if (arg === "--base") {
      parsed.baseUrl = requireValue(args, index, arg);
      index += 1;
    } else if (arg === "--timeout-ms") {
      parsed.timeoutMs = Number(requireValue(args, index, arg));
      if (!Number.isFinite(parsed.timeoutMs) || parsed.timeoutMs <= 0) {
        fail("--timeout-ms must be a positive number");
      }
      index += 1;
    } else {
      fail(`unknown argument: ${arg}`);
    }
  }
  return parsed;
}

function requireValue(args, index, flag) {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) fail(`${flag} requires a value`);
  return value;
}

async function getJson(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: { accept: "application/json" },
      signal: controller.signal
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`${url} returned HTTP ${response.status}: ${text.slice(0, 300)}`);
    }
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`${url} did not return JSON: ${text.slice(0, 300)}`);
    }
  } catch (error) {
    if (error?.name === "AbortError") throw new Error(`${url} timed out after ${timeoutMs}ms`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) throw new Error(`${message}; got ${JSON.stringify(actual)}`);
}

function assertHas(value, key, message) {
  if (!value || typeof value !== "object" || !(key in value)) throw new Error(message);
}

function trimTrailingSlash(value) {
  return String(value || DEFAULT_BASE_URL).replace(/\/+$/, "");
}

function printUsage() {
  console.log(`Usage: node scripts/local-trial-smoke.mjs [--base URL] [--timeout-ms MS] [--json]

Checks a running local OpenMaple control plane without creating data.

Examples:
  node scripts/local-trial-smoke.mjs
  node scripts/local-trial-smoke.mjs --base http://127.0.0.1:27951 --json`);
}

function fail(message) {
  console.error(`OpenMaple local trial smoke failed: ${message}`);
  process.exit(1);
}

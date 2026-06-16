import { createHmac } from "node:crypto";
import { traceAsync } from "../perfTrace";
import type { JsonRecord } from "../types";
import { canonicalQuery, hmacSha256, parseJsonRecord, sha256Hex } from "./runtimeCommon";
import type { NormalizedSandboxRuntimeConfig } from "./sandboxConfig";

type VefaasSandboxConfig = Extract<NormalizedSandboxRuntimeConfig, { provider: "vefaas" }>;

export async function callVefaasSandboxOpenApi(config: VefaasSandboxConfig, action: string, payload: JsonRecord) {
  return traceAsync("vefaas_sandbox.openapi", { action, function_id: config.function_id, region: config.region }, async () => {
    const endpoint = openApiEndpoint(config.endpoint, action);
    const body = JSON.stringify(payload);
    const headers = signVolcengineRequest({
      method: "POST",
      host: endpoint.host,
      path: endpoint.pathname || "/",
      query: Object.fromEntries(endpoint.searchParams.entries()),
      body,
      accessKey: config.access_key,
      secretKey: config.secret_key,
      region: config.region,
      service: "vefaas"
    });
    const response = await fetch(endpoint, {
      method: "POST",
      signal: AbortSignal.timeout(Math.min(config.timeout_ms, 120_000)),
      headers,
      body
    });
    const text = await response.text();
    const parsed = parseJsonRecord(text);
    if (!response.ok) throw new Error(`Volcengine OpenAPI ${action} failed with HTTP ${response.status}: ${text}`);
    const responseError = asRecord(asRecord(parsed.ResponseMetadata).Error);
    if (parsed.Error || Object.keys(responseError).length) throw new Error(`Volcengine OpenAPI ${action} failed: ${JSON.stringify(parsed)}`);
    return parsed;
  });
}

function openApiEndpoint(endpoint: string, action: string) {
  const url = new URL(endpoint || "https://open.volcengineapi.com");
  url.pathname = url.pathname && url.pathname !== "/" ? url.pathname : "/";
  url.search = canonicalQuery({ Action: action, Version: "2024-06-06" });
  return url;
}

function signVolcengineRequest(input: {
  method: string;
  host: string;
  path: string;
  query: Record<string, string>;
  body: string;
  accessKey: string;
  secretKey: string;
  region: string;
  service: string;
}) {
  const xDate = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const shortDate = xDate.slice(0, 8);
  const bodyHash = sha256Hex(input.body);
  const signedHeaders = "content-type;host;x-content-sha256;x-date";
  const canonicalRequest = [
    input.method.toUpperCase(),
    input.path || "/",
    canonicalQuery(input.query),
    [`content-type:application/json`, `host:${input.host}`, `x-content-sha256:${bodyHash}`, `x-date:${xDate}`].join("\n"),
    "",
    signedHeaders,
    bodyHash
  ].join("\n");
  const scope = `${shortDate}/${input.region}/${input.service}/request`;
  const stringToSign = ["HMAC-SHA256", xDate, scope, sha256Hex(canonicalRequest)].join("\n");
  const kDate = hmacSha256(Buffer.from(input.secretKey, "utf8"), shortDate);
  const kRegion = hmacSha256(kDate, input.region);
  const kService = hmacSha256(kRegion, input.service);
  const kSigning = hmacSha256(kService, "request");
  const signature = createHmac("sha256", kSigning).update(stringToSign).digest("hex");
  return {
    Host: input.host,
    "Content-Type": "application/json",
    "X-Date": xDate,
    "X-Content-Sha256": bodyHash,
    Authorization: `HMAC-SHA256 Credential=${input.accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`
  };
}

function asRecord(value: unknown): JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as JsonRecord) : {};
}

import { createHash, createHmac } from "node:crypto";
import type { JsonRecord } from "../types";

const credentialValidationOff = new Set(["0", "false", "off", "skip"]);

export type VolcengineCredentialValidationInput = {
  accessKey: string;
  secretKey: string;
  region: string;
  timeoutMs?: number;
};

export type VolcengineCredentialValidationResult =
  | { ok: true; skipped?: boolean; identity?: JsonRecord }
  | { ok: false; error: "cloud_provider_credentials_invalid"; message: string; provider_code?: string; request_id?: string };

export async function validateVolcengineCredentials(input: VolcengineCredentialValidationInput): Promise<VolcengineCredentialValidationResult> {
  if (credentialValidationOff.has(String(process.env.MAPLE_VOLCENGINE_CREDENTIAL_VALIDATION || "").toLowerCase())) return { ok: true, skipped: true };
  try {
    const parsed = await signedVolcengineOpenApiPost({
      accessKey: input.accessKey.trim(),
      secretKey: input.secretKey,
      region: input.region.trim() || "cn-beijing",
      host: "sts.volcengineapi.com",
      service: "sts",
      version: "2018-01-01",
      action: "GetCallerIdentity",
      body: {},
      timeoutMs: input.timeoutMs
    });
    return { ok: true, identity: asRecord(parsed.Result ?? parsed.result) };
  } catch (error) {
    const detail = parseVolcengineError(error);
    return {
      ok: false,
      error: "cloud_provider_credentials_invalid",
      message: "云厂商凭据验证失败，请检查 Access Key、SecretKey 和 Region。",
      provider_code: detail.code,
      request_id: detail.requestId
    };
  }
}

async function signedVolcengineOpenApiPost(input: {
  accessKey: string;
  secretKey: string;
  region: string;
  host: string;
  service: string;
  version: string;
  action: string;
  body: JsonRecord;
  timeoutMs?: number;
}) {
  const body = JSON.stringify(input.body);
  const query = { Action: input.action, Version: input.version };
  const headers = signVolcengineRequest({ ...input, method: "POST", path: "/", query, body });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs ?? 10_000);
  try {
    const response = await fetch(`https://${input.host}/?${canonicalQuery(query)}`, {
      method: "POST",
      body,
      headers,
      signal: controller.signal
    });
    const text = await response.text();
    const parsed = parseJson(text);
    const providerError = asRecord(parsed.ResponseMetadata).Error ?? parsed.Error;
    if (!response.ok || providerError) throw new VolcengineOpenApiError(response.status, parsed);
    return parsed;
  } finally {
    clearTimeout(timeout);
  }
}

function signVolcengineRequest(input: {
  accessKey: string;
  secretKey: string;
  region: string;
  host: string;
  service: string;
  method: string;
  path: string;
  query: Record<string, string>;
  body: string;
}) {
  const contentType = "application/json";
  const now = new Date();
  const xDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const shortDate = xDate.slice(0, 8);
  const bodyHash = sha256Hex(input.body);
  const signedHeaders = "content-type;host;x-content-sha256;x-date";
  const canonicalRequest = [
    input.method.toUpperCase(),
    input.path,
    canonicalQuery(input.query),
    [`content-type:${contentType}`, `host:${input.host}`, `x-content-sha256:${bodyHash}`, `x-date:${xDate}`].join("\n"),
    "",
    signedHeaders,
    bodyHash
  ].join("\n");
  const scope = `${shortDate}/${input.region}/${input.service}/request`;
  const stringToSign = ["HMAC-SHA256", xDate, scope, sha256Hex(canonicalRequest)].join("\n");
  const kDate = hmac(Buffer.from(input.secretKey, "utf8"), shortDate);
  const kRegion = hmac(kDate, input.region);
  const kService = hmac(kRegion, input.service);
  const kSigning = hmac(kService, "request");
  const signature = createHmac("sha256", kSigning).update(stringToSign).digest("hex");
  return {
    Host: input.host,
    "Content-Type": contentType,
    "X-Date": xDate,
    "X-Content-Sha256": bodyHash,
    Authorization: `HMAC-SHA256 Credential=${input.accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`
  };
}

function canonicalQuery(query: Record<string, string>) {
  return Object.keys(query).sort().map((key) => `${encodeRfc3986(key)}=${encodeRfc3986(query[key])}`).join("&");
}

function encodeRfc3986(value: string) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

function sha256Hex(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function hmac(key: Buffer, value: string) {
  return createHmac("sha256", key).update(value).digest();
}

function parseJson(text: string): JsonRecord {
  try {
    return JSON.parse(text || "{}") as JsonRecord;
  } catch {
    return { raw: text };
  }
}

function asRecord(value: unknown): JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as JsonRecord) : {};
}

class VolcengineOpenApiError extends Error {
  constructor(readonly status: number, readonly body: JsonRecord) {
    super("Volcengine OpenAPI request failed");
  }
}

function parseVolcengineError(error: unknown) {
  const body = error instanceof VolcengineOpenApiError ? error.body : {};
  const metadata = asRecord(body.ResponseMetadata);
  const providerError = asRecord(metadata.Error ?? body.Error);
  return {
    code: String(providerError.Code || providerError.code || ""),
    requestId: String(metadata.RequestId || metadata.RequestID || "")
  };
}

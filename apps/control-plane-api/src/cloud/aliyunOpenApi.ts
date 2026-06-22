import { createHmac, randomUUID } from "node:crypto";
import type { JsonRecord } from "../types";

const credentialValidationOff = new Set(["0", "false", "off", "skip"]);

export type AliyunCredentialValidationInput = {
  accessKeyId: string;
  accessKeySecret: string;
  region: string;
  timeoutMs?: number;
};

export type AliyunCredentialValidationResult =
  | { ok: true; skipped?: boolean; identity?: JsonRecord }
  | { ok: false; error: "cloud_provider_credentials_invalid"; message: string; provider_code?: string; request_id?: string };

export function aliyunCredentials(input: JsonRecord | undefined) {
  const record = asRecord(input);
  return {
    accessKeyId: stringValue(record.ALIYUN_ACCESS_KEY_ID ?? record.access_key_id ?? record.accessKeyId ?? record.ak),
    accessKeySecret: stringValue(record.ALIYUN_ACCESS_KEY_SECRET ?? record.access_key_secret ?? record.accessKeySecret ?? record.sk),
    region: stringValue(record.ALIYUN_REGION ?? record.region) || "cn-hangzhou"
  };
}

export async function validateAliyunCredentials(input: AliyunCredentialValidationInput): Promise<AliyunCredentialValidationResult> {
  if (credentialValidationOff.has(String(process.env.MAPLE_ALIYUN_CREDENTIAL_VALIDATION || "").toLowerCase())) return { ok: true, skipped: true };
  try {
    const parsed = await signedAliyunRpcRequest({
      accessKeyId: input.accessKeyId.trim(),
      accessKeySecret: input.accessKeySecret,
      action: "GetCallerIdentity",
      version: "2015-04-01",
      host: "sts.aliyuncs.com",
      timeoutMs: input.timeoutMs
    });
    return { ok: true, identity: asRecord(parsed) };
  } catch (error) {
    const detail = parseAliyunError(error);
    return {
      ok: false,
      error: "cloud_provider_credentials_invalid",
      message: "阿里云凭据验证失败，请检查 AccessKeyId、AccessKeySecret 和 Region。",
      provider_code: detail.code,
      request_id: detail.requestId
    };
  }
}

async function signedAliyunRpcRequest(input: {
  accessKeyId: string;
  accessKeySecret: string;
  action: string;
  version: string;
  host: string;
  timeoutMs?: number;
}) {
  const params: Record<string, string> = {
    AccessKeyId: input.accessKeyId,
    Action: input.action,
    Format: "JSON",
    SignatureMethod: "HMAC-SHA1",
    SignatureNonce: randomUUID(),
    SignatureVersion: "1.0",
    Timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    Version: input.version
  };
  const canonical = canonicalQuery(params);
  const stringToSign = `POST&%2F&${encodeRfc3986(canonical)}`;
  const signature = createHmac("sha1", `${input.accessKeySecret}&`).update(stringToSign).digest("base64");
  const body = `${canonical}&Signature=${encodeRfc3986(signature)}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs ?? 10_000);
  try {
    const response = await fetch(`https://${input.host}/`, {
      method: "POST",
      body,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      signal: controller.signal
    });
    const text = await response.text();
    const parsed = parseJson(text);
    if (!response.ok || parsed.Code || parsed.Error) throw new AliyunOpenApiError(response.status, parsed);
    return parsed;
  } finally {
    clearTimeout(timeout);
  }
}

function canonicalQuery(query: Record<string, string>) {
  return Object.keys(query).sort().map((key) => `${encodeRfc3986(key)}=${encodeRfc3986(query[key])}`).join("&");
}

function encodeRfc3986(value: string) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
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

function stringValue(value: unknown) {
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

class AliyunOpenApiError extends Error {
  constructor(readonly status: number, readonly body: JsonRecord) {
    super("Aliyun OpenAPI request failed");
  }
}

function parseAliyunError(error: unknown) {
  const body = error instanceof AliyunOpenApiError ? error.body : {};
  return {
    code: String(body.Code || body.code || asRecord(body.Error).Code || ""),
    requestId: String(body.RequestId || body.RequestID || body.requestId || "")
  };
}

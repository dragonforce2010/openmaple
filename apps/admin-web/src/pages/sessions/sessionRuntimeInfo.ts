import type { JsonRecord, SessionDetail } from "../../types";

export function sandboxRuntime(detail: SessionDetail | null) {
  const metadata = record(detail?.session.metadata);
  return record(metadata.sandbox_runtime ?? metadata.runtime);
}

export function providerLabel(runtime: JsonRecord, detail: SessionDetail | null) {
  const type = String(runtime.type || runtime.provider || "");
  if (type === "vefaas_sandbox" || (type === "vefaas" && runtime.sandbox_id)) return "VeFaaS Sandbox";
  if (type === "e2b") return "E2B";
  if (type === "docker") return "Docker";
  const sandbox = record(record(detail?.environment?.config).sandbox);
  const configured = String(sandbox.provider || record(detail?.environment?.config).type || "");
  if (configured === "vefaas" || configured === "vefaas_sandbox") return "VeFaaS Sandbox";
  if (configured === "e2b") return "E2B";
  return configured || "—";
}

export function statusClass(status: string) {
  if (status === "failed") return "failed";
  if (status === "running" || status === "provisioning") return "running";
  return status ? "active" : "idle";
}

export function runtimeStatus(detail: SessionDetail | null, runtime: JsonRecord) {
  return stringValue(runtime.status || detail?.session.status);
}

export function runtimeFunctionId(detail: SessionDetail | null, runtime: JsonRecord) {
  const config = configVefaas(detail);
  return stringValue(runtime.function_id || runtime.cloud_function_id || config.function_id || config.functionId);
}

export function runtimeGatewayUrl(detail: SessionDetail | null, runtime: JsonRecord) {
  const config = configVefaas(detail);
  return stringValue(runtime.gateway_url || config.gateway_url || config.gatewayUrl);
}

export function runtimeInvokeUrl(detail: SessionDetail | null, runtime: JsonRecord) {
  const config = configVefaas(detail);
  return stringValue(runtime.invoke_url || config.invoke_url);
}

export function runtimeRegion(detail: SessionDetail | null, runtime: JsonRecord) {
  const config = configVefaas(detail);
  return stringValue(runtime.region || config.region || config.VEFAAS_REGION) || "cn-beijing";
}

export function vefaasFunctionConsoleHref(detail: SessionDetail | null, runtime: JsonRecord) {
  const functionId = runtimeFunctionId(detail, runtime);
  if (!functionId) return "";
  return `https://console.volcengine.com/vefaas/region:${encodeURIComponent(runtimeRegion(detail, runtime))}/function/${encodeURIComponent(functionId)}`;
}

export function vefaasSandboxInstanceConsoleHref(functionId: string, region = "cn-beijing") {
  if (!functionId) return "";
  return `https://console.volcengine.com/vefaas/region:vefaas+${encodeURIComponent(region)}/sandbox/detail/${encodeURIComponent(functionId)}?tab=instance`;
}

export function shortValue(value: string, max = 64) {
  return value.length > max ? `${value.slice(0, max - 3)}...` : value;
}

export function configVefaas(detail: SessionDetail | null) {
  const config = record(detail?.environment?.config);
  const sandbox = record(config.sandbox);
  return record(sandbox.vefaas ?? config.vefaas ?? config.vefaas_sandbox);
}

export function stringValue(value: unknown) {
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

export function record(value: unknown): JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as JsonRecord) : {};
}

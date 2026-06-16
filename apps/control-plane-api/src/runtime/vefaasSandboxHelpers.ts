import { isSandboxAbsolutePath, normalizeSandboxPath, safeSandboxReadPath } from "./runtimeCommon";
import type { VefaasSandboxRuntimeInfo } from "./runtimeTypes";
import type { NormalizedSandboxRuntimeConfig } from "./sandboxConfig";
import type { JsonRecord } from "../types";

type VefaasConfig = Extract<NormalizedSandboxRuntimeConfig, { provider: "vefaas" }>;

export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function shouldRetryGatewayStatus(status: number) {
  return status === 408 || status === 409 || status === 425 || status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

export function openApiTimeoutMinutes(timeoutMs: number) {
  const minutes = Math.ceil(Number(timeoutMs || 0) / 60_000);
  return Math.min(1440, Math.max(3, minutes));
}

export function extractVefaasSandboxId(response: JsonRecord) {
  const result = asRecord(response.Result ?? response.result ?? response);
  const sandbox = asRecord(result.Sandbox ?? result.sandbox);
  return String(result.SandboxId || result.SandboxID || result.sandbox_id || result.id || sandbox.SandboxId || sandbox.SandboxID || sandbox.Id || "");
}

export function normalizeCommandLikeResult(result: JsonRecord) {
  const output = result.output ?? result.Output;
  return {
    stdout: String(result.stdout ?? result.Stdout ?? output ?? ""),
    stderr: String(result.stderr ?? result.Stderr ?? result.error ?? result.Error ?? ""),
    exit_code: Number(result.exit_code ?? result.exitCode ?? result.ExitCode ?? result.code ?? 0)
  };
}

export function asRecord(value: unknown): JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as JsonRecord) : {};
}

export function toVefaasSandboxWorkspacePath(runtime: VefaasSandboxRuntimeInfo, path: string) {
  const normalized = normalizeSandboxPath(path);
  if (normalized.startsWith("..") || normalized.startsWith("/") || normalized.includes("/../")) {
    throw new Error(`Path escapes workspace: ${path}`);
  }
  return `${runtime.sandbox_workspace_path.replace(/\/$/, "")}/${normalized === "." ? "" : normalized}`.replace(/\/$/, "");
}

export function toVefaasSandboxReadablePath(runtime: VefaasSandboxRuntimeInfo, path: string) {
  if (isSandboxAbsolutePath(path)) return toVefaasSandboxMountedPath(runtime, safeSandboxReadPath(runtime, path));
  return toVefaasSandboxWorkspacePath(runtime, path);
}

export function toVefaasSandboxMountedPath(runtime: VefaasSandboxRuntimeInfo, path: string) {
  const normalized = normalizeSandboxPath(path);
  const uploadRoot = "/mnt/session/uploads";
  if (normalized === uploadRoot) return `${runtime.sandbox_workspace_path.replace(/\/$/, "")}/.session/uploads`;
  if (normalized.startsWith(`${uploadRoot}/`)) {
    return `${runtime.sandbox_workspace_path.replace(/\/$/, "")}/.session/uploads/${normalized.slice(uploadRoot.length + 1)}`;
  }
  return normalized;
}

export function normalizeListedFile(item: unknown, workspaceRoot: string) {
  const raw = typeof item === "string" ? item : String(asRecord(item).path || "");
  if (!raw) return "";
  const normalized = normalizeSandboxPath(raw).replace(/^\.\//, "");
  const root = normalizeSandboxPath(workspaceRoot).replace(/\/$/, "");
  return normalized === root ? "" : normalized.startsWith(`${root}/`) ? normalized.slice(root.length + 1) : normalized.replace(/^\//, "");
}

export function nonEmptyString(value: string): value is string {
  return Boolean(value);
}

export function runtimeNotExpired(runtime: VefaasSandboxRuntimeInfo) {
  return !runtime.expires_at || Date.parse(runtime.expires_at) > Date.now();
}

export function runtimeRecentlyReady(runtime: VefaasSandboxRuntimeInfo) {
  const checkedAt = Date.parse(runtime.last_ready_at || "");
  return Number.isFinite(checkedAt) && Date.now() - checkedAt < runtimeReadyReuseTtlMs();
}

export function markRuntimeReady(runtime: VefaasSandboxRuntimeInfo): VefaasSandboxRuntimeInfo {
  return { ...runtime, last_ready_at: new Date().toISOString() };
}

function runtimeReadyReuseTtlMs() {
  const raw = Number(process.env.MAPLE_VEFAAS_SANDBOX_REUSE_READY_TTL_MS || 30_000);
  return Number.isFinite(raw) && raw > 0 ? raw : 30_000;
}

export function isSameVefaasSandbox(runtime: VefaasSandboxRuntimeInfo, config: VefaasConfig) {
  return runtime.function_id === config.function_id && stripTrailingSlash(runtime.gateway_url) === stripTrailingSlash(config.gateway_url);
}

function stripTrailingSlash(value: string) {
  return value.replace(/\/$/, "");
}

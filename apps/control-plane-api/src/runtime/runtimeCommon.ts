import { createHash, createHmac } from "node:crypto";
import { readdirSync, statSync } from "node:fs";
import { join, normalize, posix, relative } from "node:path";
import type { JsonRecord } from "../types";
import type { RuntimeInfo } from "./runtimeTypes";

export function runtimePublicMetadata(runtime: RuntimeInfo): JsonRecord {
  if (runtime.type === "vefaas") {
    return {
      type: runtime.type,
      function_id: runtime.function_id,
      cloud_function_id: runtime.cloud_function_id || runtime.function_id,
      region: runtime.region,
      workspace_path: runtime.workspace_path,
      sandbox_workspace_path: runtime.sandbox_workspace_path
    };
  }
  if (runtime.type === "vefaas_sandbox") {
    return {
      type: runtime.type,
      provider: runtime.provider,
      sandbox_id: runtime.sandbox_id,
      function_id: runtime.function_id,
      region: runtime.region,
      workspace_path: runtime.workspace_path,
      sandbox_workspace_path: runtime.sandbox_workspace_path,
      lifecycle: runtime.lifecycle
    };
  }
  return runtime as unknown as JsonRecord;
}

export function assertSafeWorkspacePath(workspacePath: string, requestedPath: string) {
  const normalized = normalize(requestedPath || ".");
  if (normalized.startsWith("..") || normalized.startsWith("/") || normalized.includes("/../")) {
    throw new Error(`Path escapes workspace: ${requestedPath}`);
  }
  const target = join(workspacePath, normalized);
  const rel = relative(workspacePath, target);
  if (rel.startsWith("..") || rel === "") {
    if (rel === "") return target;
    throw new Error(`Path escapes workspace: ${requestedPath}`);
  }
  return target;
}

export function safeWorkspaceRelativePath(requestedPath: string) {
  const normalized = normalize(requestedPath || ".").replace(/\\/g, "/");
  if (normalized.startsWith("..") || normalized.startsWith("/") || normalized.includes("/../")) {
    throw new Error(`Path escapes workspace: ${requestedPath}`);
  }
  return normalized || ".";
}

export function listHostFiles(root: string, current = root, collected: string[] = [], options: { maxFileSize?: number } = {}) {
  const maxFileSize = options.maxFileSize ?? 512 * 1024;
  if (collected.length >= 200) return collected;
  for (const entry of readdirSync(current, { withFileTypes: true })) {
    if (collected.length >= 200) return collected;
    if (["node_modules", ".git"].includes(entry.name)) continue;
    const absolute = join(current, entry.name);
    if (entry.isDirectory()) {
      listHostFiles(root, absolute, collected, options);
      continue;
    }
    if (!entry.isFile()) continue;
    const stats = statSync(absolute);
    if (stats.size > maxFileSize) continue;
    collected.push(relative(root, absolute));
  }
  return collected;
}

export function safeSandboxReadPath(runtime: RuntimeInfo, requestedPath: string) {
  const normalized = normalizeSandboxPath(requestedPath);
  if (!normalized.startsWith("/")) return safeWorkspaceRelativePath(normalized);

  if (runtime.type === "docker") {
    if (isWithinSandboxRoot(normalized, "/workspace") || isWithinSandboxRoot(normalized, "/mnt/session/uploads")) return normalized;
  }
  if (runtime.type === "e2b" || runtime.type === "vefaas" || runtime.type === "vefaas_sandbox") {
    if (isWithinSandboxRoot(normalized, runtime.sandbox_workspace_path) || isWithinSandboxRoot(normalized, "/mnt/session/uploads")) return normalized;
  }
  throw new Error(`Path escapes workspace: ${requestedPath}`);
}

export function isSandboxAbsolutePath(path: string) {
  return normalizeSandboxPath(path).startsWith("/");
}

export function isWithinSandboxRoot(path: string, root: string) {
  const normalizedRoot = normalizeSandboxPath(root).replace(/\/$/, "");
  return path === normalizedRoot || path.startsWith(`${normalizedRoot}/`);
}

export function normalizeSandboxPath(path: string) {
  return posix.normalize(path || ".").replace(/\\/g, "/");
}

export function shellQuote(value: string) {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

export function parseJsonRecord(text: string) {
  if (!text) return {};
  try {
    return JSON.parse(text) as JsonRecord;
  } catch {
    return { output: text };
  }
}

export function asRecord(value: unknown): JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as JsonRecord) : {};
}

export function stringifyRecord(value: JsonRecord) {
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, String(item)]));
}

export function canonicalQuery(query: Record<string, string>) {
  return Object.keys(query)
    .sort()
    .map((key) => `${encodeRfc3986(key)}=${encodeRfc3986(query[key])}`)
    .join("&");
}

export function encodeRfc3986(value: string) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

export function sha256Hex(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function hmacSha256(key: Buffer, value: string) {
  return createHmac("sha256", key).update(value).digest();
}

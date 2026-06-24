import { createHash } from "node:crypto";
import type { JsonRecord } from "../types";

export function normalizeMemoryProvider(value: unknown) {
  return String(value || "local").toLowerCase() === "openviking" ? "openviking" : "local";
}

export function hashMemoryContent(content: string) {
  return createHash("sha256").update(content).digest("hex");
}

export function secretHint(value: string) {
  const trimmed = value.trim();
  if (trimmed.length <= 8) return `${trimmed.slice(0, 3)}...`;
  return `${trimmed.slice(0, 3)}...${trimmed.slice(-4)}`;
}

export function record(value: unknown): JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as JsonRecord : {};
}

export function normalizeMemoryPath(value: unknown) {
  const raw = String(value ?? "").trim().replace(/^\/+/, "");
  if (!raw) throw new Error("memory_path_required");
  if (raw.length > 512) throw new Error("memory_path_too_long");
  if (raw.includes("\\")) throw new Error("memory_path_invalid");
  const parts = raw.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) throw new Error("memory_path_invalid");
  return parts.join("/");
}

export function assertMemoryContent(value: unknown) {
  const content = String(value ?? "");
  if (Buffer.byteLength(content, "utf8") > 100 * 1024) throw new Error("memory_content_too_large");
  return content;
}

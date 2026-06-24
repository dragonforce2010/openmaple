import type { JsonRecord } from "../types";
import { getMemoryStore } from "../store";

export type MemoryAccess = "read_write" | "read_only";

export type MemoryStoreResource = {
  type: "memory_store";
  memory_store_id: string;
  access: MemoryAccess;
  instructions?: string;
};

export const MAX_MEMORY_STORES_PER_SESSION = 8;
export const MAX_MEMORY_INSTRUCTIONS_CHARS = 4096;
export const MAX_MEMORY_CONTENT_BYTES = 100 * 1024;
export const MAX_MEMORY_PATH_CHARS = 512;

export class MemoryResourceError extends Error {
  constructor(readonly code: string, message = code) {
    super(message);
    this.name = "MemoryResourceError";
  }
}

export function normalizeMemoryPath(value: unknown) {
  const raw = String(value ?? "").trim().replace(/^\/+/, "");
  if (!raw) throw new MemoryResourceError("memory_path_required");
  if (raw.length > MAX_MEMORY_PATH_CHARS) throw new MemoryResourceError("memory_path_too_long");
  if (raw.includes("\\")) throw new MemoryResourceError("memory_path_invalid");
  const parts = raw.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) throw new MemoryResourceError("memory_path_invalid");
  return parts.join("/");
}

export function assertMemoryContent(value: unknown) {
  const content = String(value ?? "");
  if (Buffer.byteLength(content, "utf8") > MAX_MEMORY_CONTENT_BYTES) throw new MemoryResourceError("memory_content_too_large");
  return content;
}

export function normalizeMemoryAccess(value: unknown): MemoryAccess {
  return String(value || "read_write") === "read_only" ? "read_only" : "read_write";
}

export function normalizeMemoryStoreResources(resources: JsonRecord[], workspaceId?: string | null): MemoryStoreResource[] {
  const normalized: MemoryStoreResource[] = [];
  const seen = new Set<string>();
  for (const resource of resources) {
    if (resource.type !== "memory_store") continue;
    const memoryStoreId = String(resource.memory_store_id || "").trim();
    if (!memoryStoreId || seen.has(memoryStoreId)) continue;
    const store = getMemoryStore(memoryStoreId) as JsonRecord | null;
    if (!store) throw new MemoryResourceError("memory_store_not_found");
    if (workspaceId && String(store.workspace_id || "") !== workspaceId) throw new MemoryResourceError("memory_store_workspace_mismatch");
    const instructions = String(resource.instructions || "").trim();
    if (instructions.length > MAX_MEMORY_INSTRUCTIONS_CHARS) throw new MemoryResourceError("memory_store_instructions_too_long");
    normalized.push({
      type: "memory_store",
      memory_store_id: memoryStoreId,
      access: normalizeMemoryAccess(resource.access),
      ...(instructions ? { instructions } : {})
    });
    seen.add(memoryStoreId);
    if (normalized.length > MAX_MEMORY_STORES_PER_SESSION) throw new MemoryResourceError("memory_store_limit_exceeded");
  }
  return normalized;
}

export function resourcesWithNormalizedMemoryStores(resources: JsonRecord[], workspaceId?: string | null): JsonRecord[] {
  const memoryResources = normalizeMemoryStoreResources(resources, workspaceId);
  const nonMemory = resources.filter((resource) => resource.type !== "memory_store");
  return [...nonMemory, ...memoryResources];
}

export function memoryStoreIdsFromResources(resources: JsonRecord[]) {
  return normalizeMemoryStoreResources(resources).map((resource) => resource.memory_store_id);
}

export function legacyMemoryResources(memoryStoreIds: unknown, workspaceId?: string | null): MemoryStoreResource[] {
  const ids = Array.isArray(memoryStoreIds) ? memoryStoreIds.map((id) => String(id || "").trim()).filter(Boolean) : [];
  return normalizeMemoryStoreResources(ids.map((id) => ({ type: "memory_store", memory_store_id: id, access: "read_write" })), workspaceId);
}

export function responseStatusForMemoryError(error: unknown) {
  if (!(error instanceof MemoryResourceError)) return 400;
  if (error.code === "memory_store_not_found") return 404;
  return 400;
}

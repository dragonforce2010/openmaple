import { OpenVikingMemoryClient } from "./openVikingMemory";
import {
  assertMemoryContent,
  legacyMemoryResources,
  normalizeMemoryPath,
  normalizeMemoryStoreResources,
  type MemoryStoreResource
} from "./memoryResources";
import {
  getMemory,
  getMemoryStore,
  getRawMemoryStore,
  getSession,
  listMemories,
  readMemoryStoreApiKey,
  upsertMemory
} from "../store";
import type { JsonRecord } from "../types";

export async function executeSessionMemoryTool(sessionId: string, name: "memory_search" | "memory_write", input: JsonRecord) {
  const session = getSession(sessionId);
  if (!session) throw new Error(`Session not found: ${sessionId}`);
  if (name === "memory_search") return searchSessionMemories(session, input);
  if (name === "memory_write") return writeSessionMemory(session, input);
  throw new Error(`Unknown memory tool: ${name}`);
}

export function attachedMemoryStoreResources(session: JsonRecord): MemoryStoreResource[] {
  const metadata = record(session.metadata);
  const rawResources = Array.isArray(metadata.resources) ? metadata.resources as JsonRecord[] : [];
  const memoryResources = rawResources.filter((resource) => resource.type === "memory_store");
  const workspaceId = String(session.workspace_id || metadata.workspace_id || "");
  if (memoryResources.length) return normalizeMemoryStoreResources(memoryResources, workspaceId);
  return legacyMemoryResources(metadata.memory_store_ids, workspaceId);
}

async function searchSessionMemories(session: JsonRecord, input: JsonRecord) {
  const query = String(input.query || "");
  const requestedStoreId = input.memory_store_id ? String(input.memory_store_id) : "";
  const resources = attachedMemoryStoreResources(session);
  if (requestedStoreId && !resources.some((resource) => resource.memory_store_id === requestedStoreId)) {
    throw new Error("memory_store_not_attached");
  }
  const searchable = requestedStoreId ? resources.filter((resource) => resource.memory_store_id === requestedStoreId) : resources;
  const results: JsonRecord[] = [];
  for (const resource of searchable) {
    const store = getMemoryStore(resource.memory_store_id) as JsonRecord | null;
    if (!store) continue;
    if (String(store.provider || "local") === "openviking") {
      results.push(...await searchOpenVikingStore(store, resource, query));
    } else {
      results.push(...listMemories(resource.memory_store_id, query).map((memory) => ({
        memory_store_id: store.id,
        memory_store_name: store.name,
        access: resource.access,
        provider: store.provider || "local",
        path: memory.path,
        preview: String(memory.content).slice(0, 1000)
      })));
    }
  }
  return { query, results: results.slice(0, 20) };
}

async function writeSessionMemory(session: JsonRecord, input: JsonRecord) {
  const memoryStoreId = String(input.memory_store_id || "");
  if (!memoryStoreId) throw new Error("Missing memory_store_id");
  const resource = attachedMemoryStoreResources(session).find((item) => item.memory_store_id === memoryStoreId);
  if (!resource) throw new Error("memory_store_not_attached");
  if (resource.access !== "read_write") throw new Error("memory_store_read_only");
  const path = normalizeMemoryPath(input.path);
  const content = assertMemoryContent(input.content);
  const memory = await writeMemoryStorePath(memoryStoreId, path, content, "agent", String(session.id || ""));
  return { memory_store_id: memoryStoreId, path, memory_id: memory?.id, content_sha256: memory?.content_sha256 };
}

export async function writeMemoryStorePath(memoryStoreId: string, pathInput: unknown, contentInput: unknown, actor: string, sessionId?: string | null) {
  const path = normalizeMemoryPath(pathInput);
  const content = assertMemoryContent(contentInput);
  const store = getMemoryStore(memoryStoreId) as JsonRecord | null;
  if (!store) throw new Error("memory_store_not_found");
  if (String(store.provider || "local") === "openviking") {
    const existing = getMemory(memoryStoreId, path);
    await openVikingClientForStore(memoryStoreId).write(path, content, existing ? "replace" : "create");
  }
  return upsertMemory({ memory_store_id: memoryStoreId, path, content, actor, session_id: sessionId ?? null });
}

async function searchOpenVikingStore(store: JsonRecord, resource: MemoryStoreResource, query: string) {
  const raw = getRawMemoryStore(String(store.id)) as JsonRecord | null;
  if (!raw) return [];
  const client = openVikingClientForRawStore(raw);
  const results = await client.search(query, { limit: 20 });
  return results.map((result) => ({
    memory_store_id: store.id,
    memory_store_name: store.name,
    access: resource.access,
    provider: "openviking",
    path: result.path,
    preview: result.preview.slice(0, 1000),
    score: result.score
  }));
}

function openVikingClientForStore(memoryStoreId: string) {
  const raw = getRawMemoryStore(memoryStoreId) as JsonRecord | null;
  if (!raw) throw new Error("memory_store_not_found");
  return openVikingClientForRawStore(raw);
}

function openVikingClientForRawStore(store: JsonRecord) {
  const config = record(store.config);
  const baseUrl = String(config.base_url || process.env.OPENVIKING_BASE_URL || "");
  const targetUri = String(store.external_ref || config.target_uri || "");
  if (!baseUrl || !targetUri) throw new Error("openviking_config_missing");
  return new OpenVikingMemoryClient({
    baseUrl,
    targetUri,
    apiKey: readMemoryStoreApiKey(store)
  });
}

function record(value: unknown): JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as JsonRecord : {};
}

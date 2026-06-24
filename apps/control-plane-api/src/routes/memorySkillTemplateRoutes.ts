import type { Express } from "express";
import { responseStatusForMemoryError } from "../memory/memoryResources";
import { writeMemoryStorePath } from "../memory/sessionMemoryTools";
import type { AuthenticatedRequest } from "./routeDeps";
import {
  canAccessWorkspace,
  createMemoryStore,
  createOrUpdateLocalSkill,
  createTemplate,
  currentUser,
  getMemoryStore,
  getMemory,
  getSkill,
  getSkillTree,
  getTemplate,
  listMemories,
  listMemoryStores,
  listSkills,
  listTemplates,
  localSkillSchema,
  readSkillFile,
  templateSchema,
  updateTemplate,
  writeSkillFile,
  z
} from "./routeDeps";
import { accessibleWorkspaceIds, canAccessScopedRecord, routeParam, scopeByWorkspace } from "./routeHelpers";
export function registerMemorySkillTemplateRoutes(app: Express) {
app.get("/v1/memory_stores", (request: AuthenticatedRequest, response) => {
  const userId = currentUser(request).id;
  const workspaceId = typeof request.query.workspace_id === "string" ? request.query.workspace_id : null;
  if (workspaceId && !canAccessWorkspace(userId, workspaceId)) return response.status(403).json({ error: "workspace_forbidden" });
  const stores = workspaceId ? listMemoryStores(workspaceId) : scopeByWorkspace(listMemoryStores(), accessibleWorkspaceIds(userId));
  response.json({ data: stores });
});

app.post("/v1/memory_stores", (request: AuthenticatedRequest, response) => {
  const schema = z.object({
    workspace_id: z.string().optional(),
    name: z.string().min(1),
    description: z.string().default(""),
    provider: z.enum(["local", "openviking"]).default("local"),
    openviking: z.record(z.string(), z.unknown()).default({}),
    metadata: z.record(z.string(), z.unknown()).default({})
  });
  const parsed = schema.safeParse(request.body);
  if (!parsed.success) return response.status(400).json(parsed.error.flatten());
  if (parsed.data.workspace_id && !canAccessWorkspace(currentUser(request).id, parsed.data.workspace_id)) {
    return response.status(403).json({ error: "workspace_forbidden" });
  }
  response.status(201).json(createMemoryStore(parsed.data));
});

app.get("/v1/memory_stores/:memoryStoreId/memories", (request: AuthenticatedRequest, response) => {
  const store = getMemoryStore(routeParam(request.params.memoryStoreId));
  if (!store) return response.status(404).json({ error: "memory_store_not_found" });
  if (!canAccessScopedRecord(currentUser(request).id, store)) return response.status(403).json({ error: "workspace_forbidden" });
  response.json({ data: listMemories(routeParam(request.params.memoryStoreId), String(request.query.query ?? "")) });
});

app.get("/v1/memory_stores/:memoryStoreId/memories/*path", (request: AuthenticatedRequest, response) => {
  const store = getMemoryStore(routeParam(request.params.memoryStoreId));
  if (!store) return response.status(404).json({ error: "memory_store_not_found" });
  if (!canAccessScopedRecord(currentUser(request).id, store)) return response.status(403).json({ error: "workspace_forbidden" });
  try {
    const memory = getMemory(routeParam(request.params.memoryStoreId), routeParam(request.params.path));
    if (!memory) return response.status(404).json({ error: "memory_not_found" });
    response.json(memory);
  } catch (error) {
    response.status(memoryErrorStatus(error)).json({ error: memoryErrorCode(error), message: error instanceof Error ? error.message : String(error) });
  }
});

app.put("/v1/memory_stores/:memoryStoreId/memories/*path", (request: AuthenticatedRequest, response) => {
  const store = getMemoryStore(routeParam(request.params.memoryStoreId));
  if (!store) return response.status(404).json({ error: "memory_store_not_found" });
  if (!canAccessScopedRecord(currentUser(request).id, store)) return response.status(403).json({ error: "workspace_forbidden" });
  const schema = z.object({
    content: z.string(),
    actor: z.string().default("user")
  });
  const parsed = schema.safeParse(request.body);
  if (!parsed.success) return response.status(400).json(parsed.error.flatten());
  const path = Array.isArray(request.params.path) ? request.params.path.join("/") : request.params.path;
  void writeMemoryStorePath(routeParam(request.params.memoryStoreId), path, parsed.data.content, parsed.data.actor)
    .then((memory) => response.json(memory))
    .catch((error) => response.status(memoryErrorStatus(error)).json({ error: memoryErrorCode(error), message: error instanceof Error ? error.message : String(error) }));
});

app.get("/v1/skills", (_request, response) => response.json({ data: listSkills() }));

app.post("/v1/skills", (request, response) => {
  const parsed = localSkillSchema.safeParse(request.body);
  if (!parsed.success) return response.status(400).json(parsed.error.flatten());
  try {
    response.status(201).json(createOrUpdateLocalSkill(parsed.data));
  } catch (error) {
    response.status(400).json({ error: "skill_write_failed", message: error instanceof Error ? error.message : String(error) });
  }
});

app.patch("/v1/skills/:skillId", (request, response) => {
  const current = getSkill(routeParam(request.params.skillId));
  if (!current) return response.status(404).json({ error: "skill_not_found" });
  const currentSkill = current as Record<string, unknown> & { metadata: Record<string, unknown> };
  const parsed = localSkillSchema.partial({ name: true }).safeParse(request.body);
  if (!parsed.success) return response.status(400).json(parsed.error.flatten());
  try {
    response.json(
      createOrUpdateLocalSkill({
        name: String(parsed.data.name || currentSkill.name),
        description: String(parsed.data.description || currentSkill.metadata.description || "")
      })
    );
  } catch (error) {
    response.status(400).json({ error: "skill_write_failed", message: error instanceof Error ? error.message : String(error) });
  }
});

app.get("/v1/skills/:skillId/files", (request, response) => {
  const skill = getSkill(routeParam(request.params.skillId));
  if (!skill) return response.status(404).json({ error: "skill_not_found" });
  try {
    response.json(getSkillTree(skill));
  } catch (error) {
    response.status(400).json({ error: "skill_tree_failed", message: error instanceof Error ? error.message : String(error) });
  }
});

app.get("/v1/skills/:skillId/files/*path", (request, response) => {
  const skill = getSkill(routeParam(request.params.skillId));
  if (!skill) return response.status(404).json({ error: "skill_not_found" });
  try {
    response.json(readSkillFile(skill, routeParam(request.params.path)));
  } catch (error) {
    response.status(400).json({ error: "skill_file_read_failed", message: error instanceof Error ? error.message : String(error) });
  }
});

app.put("/v1/skills/:skillId/files/*path", (request, response) => {
  const skill = getSkill(routeParam(request.params.skillId));
  if (!skill) return response.status(404).json({ error: "skill_not_found" });
  const parsed = z.object({ content: z.string() }).safeParse(request.body);
  if (!parsed.success) return response.status(400).json(parsed.error.flatten());
  try {
    const saved = writeSkillFile(skill, routeParam(request.params.path), parsed.data.content);
    response.json(saved);
  } catch (error) {
    response.status(400).json({ error: "skill_file_write_failed", message: error instanceof Error ? error.message : String(error) });
  }
});

app.get("/v1/templates", (_request, response) => response.json({ data: listTemplates() }));

app.post("/v1/templates", (request, response) => {
  const parsed = templateSchema.safeParse(request.body);
  if (!parsed.success) return response.status(400).json(parsed.error.flatten());
  response.status(201).json(createTemplate(parsed.data));
});

app.get("/v1/templates/:templateId", (request, response) => {
  const template = getTemplate(routeParam(request.params.templateId));
  if (!template) return response.status(404).json({ error: "template_not_found" });
  response.json(template);
});

app.patch("/v1/templates/:templateId", (request, response) => {
  const current = getTemplate(routeParam(request.params.templateId));
  if (!current) return response.status(404).json({ error: "template_not_found" });
  const parsed = templateSchema.safeParse({ ...current, ...request.body });
  if (!parsed.success) return response.status(400).json(parsed.error.flatten());
  response.json(updateTemplate(routeParam(request.params.templateId), parsed.data));
});
}

function memoryErrorCode(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message || "memory_write_failed";
}

function memoryErrorStatus(error: unknown) {
  const direct = responseStatusForMemoryError(error);
  if (direct !== 400) return direct;
  const code = memoryErrorCode(error);
  if (code === "memory_store_not_found" || code === "memory_not_found") return 404;
  return 400;
}

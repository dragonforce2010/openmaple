import type { Express } from "express";
import type { AuthenticatedRequest, JsonRecord } from "./routeDeps";
import {
  GLOBAL_SCOPE_ID,
  canAccessWorkspace,
  canAdminWorkspace,
  createModelConfig,
  currentUser,
  defaultVolcoEngineModel,
  deleteModelConfig,
  encryptSecret,
  ensureGlobalModelConfigs,
  getModelConfig,
  getWorkspace,
  listModelConfigs,
  listTenantAdminTenants,
  modelConfigPatchSchema,
  modelConfigSchema,
  modelConfigTestSchema,
  presetToTarget,
  testSavedModelConfig,
  testUnsavedModelConfig,
  updateModelConfig,
  visibleModelConfigsForCurrentMode
} from "./routeDeps";
import { fallbackWorkspaceId, maskSecretHint, routeParam, tenantIdOf } from "./routeHelpers";
export function registerModelConfigRoutes(app: Express) {
app.get("/v1/model_configs", (request: AuthenticatedRequest, response) => {
  const user = currentUser(request);
  const workspaceId = fallbackWorkspaceId(user, typeof request.query.workspace_id === "string" ? request.query.workspace_id : null);
  if (workspaceId && !canAccessWorkspace(user.id, workspaceId)) return response.status(403).json({ error: "workspace_forbidden" });
  ensureGlobalModelConfigs();
  response.json({ data: visibleModelConfigsForCurrentMode(listModelConfigs(workspaceId || GLOBAL_SCOPE_ID) as JsonRecord[]) });
});

app.post("/v1/model_configs", (request: AuthenticatedRequest, response) => {
  const parsed = modelConfigSchema.safeParse(request.body);
  if (!parsed.success) return response.status(400).json(parsed.error.flatten());
  const user = currentUser(request);
  const workspaceId = fallbackWorkspaceId(user, parsed.data.workspace_id ?? null);
  if (!workspaceId) return response.status(400).json({ error: "workspace_required" });
  const workspace = getWorkspace(workspaceId);
  if (!workspace) return response.status(404).json({ error: "workspace_not_found" });
  if (!canAdminWorkspace(user.id, workspaceId)) return response.status(403).json({ error: "workspace_admin_required" });
  const preset = parsed.data.kind === "preset" ? presetToTarget(parsed.data.preset_key || "gpt-5.5") : null;
  const apiKeyCiphertext = parsed.data.api_key ? encryptSecret(parsed.data.api_key) : null;
  const modelConfig = createModelConfig({
    workspace_id: workspaceId,
    tenant_id: tenantIdOf(workspace) || GLOBAL_SCOPE_ID,
    owner_user_id: user.id,
    created_by_user_id: user.id,
    name: parsed.data.name || preset?.name || "Model config",
    provider_type: parsed.data.protocol || "openai",
    base_url: parsed.data.base_url || preset?.baseUrl || "https://api.openai.com/v1",
    model_name: parsed.data.model_name || preset?.modelName || "gpt-5.5",
    preset_key: parsed.data.preset_key || null,
    api_key_ciphertext: apiKeyCiphertext,
    api_key_hint: parsed.data.api_key ? maskSecretHint(parsed.data.api_key) : null,
    is_default: parsed.data.is_default
  });
  response.status(201).json(modelConfig);
});

app.patch("/v1/model_configs/:modelConfigId", (request: AuthenticatedRequest, response) => {
  const user = currentUser(request);
  const current = getModelConfig(routeParam(request.params.modelConfigId)) as JsonRecord | null;
  if (!current) return response.status(404).json({ error: "model_config_not_found" });
  const workspaceId = String(current.workspace_id || GLOBAL_SCOPE_ID);
  if (workspaceId === GLOBAL_SCOPE_ID) {
    if (listTenantAdminTenants(user.id).length === 0) return response.status(403).json({ error: "tenant_admin_required" });
  } else if (!canAdminWorkspace(user.id, workspaceId)) {
    return response.status(403).json({ error: "workspace_admin_required" });
  }
  const parsed = modelConfigPatchSchema.safeParse(request.body);
  if (!parsed.success) return response.status(400).json(parsed.error.flatten());
  const modelConfig = updateModelConfig(routeParam(request.params.modelConfigId), { ...parsed.data, updated_by_user_id: user.id });
  if (!modelConfig) return response.status(404).json({ error: "model_config_not_found" });
  response.json(modelConfig);
});

app.delete("/v1/model_configs/:modelConfigId", (request: AuthenticatedRequest, response) => {
  const user = currentUser(request);
  const current = getModelConfig(routeParam(request.params.modelConfigId)) as JsonRecord | null;
  if (!current) return response.status(404).json({ error: "model_config_not_found" });
  const workspaceId = String(current.workspace_id || GLOBAL_SCOPE_ID);
  if (workspaceId === GLOBAL_SCOPE_ID) {
    if (listTenantAdminTenants(user.id).length === 0) return response.status(403).json({ error: "tenant_admin_required" });
  } else if (!canAdminWorkspace(user.id, workspaceId)) {
    return response.status(403).json({ error: "workspace_admin_required" });
  }
  const deleted = deleteModelConfig(routeParam(request.params.modelConfigId), workspaceId);
  if (!deleted) return response.status(404).json({ error: "model_config_not_found" });
  response.status(204).send();
});

app.post("/v1/model_configs/test", async (request: AuthenticatedRequest, response) => {
  const parsed = modelConfigTestSchema.safeParse(request.body);
  if (!parsed.success) return response.status(400).json(parsed.error.flatten());
  const preset = parsed.data.kind === "preset" ? presetToTarget(parsed.data.preset_key || defaultVolcoEngineModel.presetKey) : null;
  const result = await testUnsavedModelConfig({
    baseUrl: parsed.data.base_url || preset?.baseUrl || defaultVolcoEngineModel.baseUrl,
    modelName: parsed.data.model_name || preset?.modelName || defaultVolcoEngineModel.modelName,
    apiKey: parsed.data.api_key
  });
  response.json(result);
});

app.post("/v1/model_configs/:modelConfigId/test", async (request: AuthenticatedRequest, response) => {
  const user = currentUser(request);
  ensureGlobalModelConfigs();
  const current = getModelConfig(routeParam(request.params.modelConfigId)) as JsonRecord | null;
  if (!current) return response.status(404).json({ error: "model_config_not_found" });
  const workspaceId = String(current.workspace_id || GLOBAL_SCOPE_ID);
  if (workspaceId !== GLOBAL_SCOPE_ID && !canAdminWorkspace(user.id, workspaceId)) return response.status(403).json({ error: "workspace_admin_required" });
  const result = await testSavedModelConfig({ userId: user.id, modelConfigId: routeParam(request.params.modelConfigId) });
  response.json(result);
});
}

import type { Express } from "express";
import {
  countRuntimePoolMembersByStatus,
  countSandboxPoolMembersByStatus,
  getWorkspaceSandboxPool,
  listRuntimePoolMembersPage,
  listSandboxPoolMembersPage
} from "../store";
import type { AuthenticatedRequest, JsonRecord } from "./routeDeps";
import {
  GLOBAL_SCOPE_ID,
  addWorkspaceAdminByEmail,
  addWorkspaceMemberByEmail,
  canAccessWorkspace,
  canAdminTenant,
  canAdminWorkspace,
  createWorkspaceApiKey,
  createWorkspaceForUser,
  createWorkspaceOnboarding,
  currentUser,
  defaultVolcoEngineModel,
  deleteWorkspaceApiKey,
  deleteWorkspaceCascade,
  encryptSecret,
  ensureGlobalModelConfigs,
  getModelConfig,
  getWorkspace,
  getWorkspaceRuntimePool,
  listCreatedTenantsForUser,
  listLoginTenantsForUser,
  listTenantAdminTenants,
  listWorkspaceApiKeys,
  listWorkspaceMembers,
  listWorkspacesForUser,
  presetToTarget,
  removeWorkspaceAdmin,
  removeWorkspaceMember,
  updateWorkspace,
  updateWorkspaceApiKey,
  workspaceAdminSchema,
  workspaceApiKeySchema,
  workspaceCreateSchema,
  workspaceOnboardingSchema,
  workspacePatchSchema,
  workspaceSlugAvailable,
  z
} from "./routeDeps";
import {
  asRecord,
  maskSecretHint,
  poolMemberPageQuery,
  poolMemberTotal,
  routeParam,
  sameTenantWorkspaces,
  tenantIdOf,
  workspaceResponse
} from "./routeHelpers";
import { finishWorkspaceProvisioning } from "./workspaceProvisioning";
export function registerWorkspaceRoutes(app: Express) {
app.get("/v1/workspace_onboarding/status", (request: AuthenticatedRequest, response) => {
  const userId = currentUser(request).id;
  const tenants = listLoginTenantsForUser(userId);
  const createdTenants = listCreatedTenantsForUser(userId);
  const workspaces = listWorkspacesForUser(userId);
  response.json({ required: createdTenants.length === 0 && tenants.length === 0, workspaces: workspaces.map((workspace) => workspaceResponse(workspace, userId)), tenants });
});

app.get("/v1/workspace_slugs/:slug", (_request, response) => {
  response.json(workspaceSlugAvailable(routeParam(_request.params.slug)));
});

app.get("/v1/tenants/slug/:slug", (_request, response) => {
  response.json(workspaceSlugAvailable(routeParam(_request.params.slug)));
});

function modelConfigAvailableForProvisioning(modelConfigId: string, userId: string) {
  const config = getModelConfig(modelConfigId) as JsonRecord | null;
  if (!config) return false;
  const workspaceId = String(config.workspace_id || GLOBAL_SCOPE_ID);
  return workspaceId === GLOBAL_SCOPE_ID || canAdminWorkspace(userId, workspaceId);
}

app.post("/v1/workspace_onboarding", async (request: AuthenticatedRequest, response) => {
  const user = currentUser(request);
  const ownedCount = listCreatedTenantsForUser(user.id).length;
  if (ownedCount > 0) return response.status(409).json({ error: "workspace_onboarding_already_completed" });
  const parsed = workspaceOnboardingSchema.safeParse(request.body);
  if (!parsed.success) return response.status(400).json(parsed.error.flatten());
  const onboardingCreds = parsed.data.provider_credentials as Record<string, Record<string, unknown> | undefined>;
  const missingCreds = missingWorkspaceProvisioningCredentials(parsed.data.runtime_provider, parsed.data.sandbox_provider, onboardingCreds, parsed.data.sandbox_config);
  if (missingCreds.length) return response.status(400).json({ error: "provider_credentials_required", missing: missingCreds });
  ensureGlobalModelConfigs();
  const missingModelConfigId = parsed.data.model_config_ids.find((modelConfigId) => !modelConfigAvailableForProvisioning(modelConfigId, user.id));
  if (missingModelConfigId) return response.status(404).json({ error: "model_config_not_found", model_config_id: missingModelConfigId });
  try {
    const { custom_model_configs: customModelConfigs, ...onboarding } = parsed.data;
    const created = createWorkspaceOnboarding({
      user_id: user.id,
      provisioning_mode: "manual",
      ...onboarding,
      custom_model_configs: customModelConfigs.map((config) => {
        const preset = config.kind === "preset" ? presetToTarget(config.preset_key || defaultVolcoEngineModel.presetKey) : null;
        return {
          name: config.name || preset?.name || "Model config",
          provider_type: config.protocol || "openai",
          base_url: config.base_url || preset?.baseUrl || defaultVolcoEngineModel.baseUrl,
          model_name: config.model_name || preset?.modelName || defaultVolcoEngineModel.modelName,
          preset_key: config.kind === "preset" ? config.preset_key || null : null,
          api_key_ciphertext: config.api_key ? encryptSecret(config.api_key) : null,
          api_key_hint: config.api_key ? maskSecretHint(config.api_key) : null,
          is_default: config.is_default
        };
      })
    });
    const provisioning = await finishWorkspaceProvisioning(created as JsonRecord, parsed.data.provider_credentials as JsonRecord);
    response.status(201).json({ ...created, ...provisioning });
  } catch (error) {
    response.status(400).json({ error: "workspace_onboarding_failed", message: error instanceof Error ? error.message : String(error) });
  }
});

app.get("/v1/workspaces", (request: AuthenticatedRequest, response) => {
  const userId = currentUser(request).id;
  const allWorkspaces = listWorkspacesForUser(userId);
  const queryWorkspaceId = typeof request.query.workspace_id === "string" ? request.query.workspace_id : "";
  const requestedWorkspace = queryWorkspaceId ? allWorkspaces.find((workspace) => String((workspace as JsonRecord).id) === queryWorkspaceId) ?? null : null;
  const selectedTenantId = requestedWorkspace ? tenantIdOf(requestedWorkspace) : tenantIdOf(allWorkspaces[0] ?? null);
  response.json({ data: sameTenantWorkspaces(allWorkspaces, selectedTenantId).map((workspace) => workspaceResponse(workspace, userId)) });
});

app.post("/v1/workspaces", async (request: AuthenticatedRequest, response) => {
  const user = currentUser(request);
  const parsed = workspaceCreateSchema.safeParse(request.body);
  if (!parsed.success) return response.status(400).json(parsed.error.flatten());
  const createCreds = parsed.data.provider_credentials as Record<string, Record<string, unknown> | undefined>;
  const missingCreateCreds = missingWorkspaceProvisioningCredentials(parsed.data.runtime_provider, parsed.data.sandbox_provider, createCreds, parsed.data.sandbox_config);
  if (missingCreateCreds.length) return response.status(400).json({ error: "provider_credentials_required", missing: missingCreateCreds });
  const tenantId = parsed.data.tenant_id || String(((listTenantAdminTenants(user.id) as JsonRecord[])[0]?.id ?? ""));
  // brand-new users (no tenant yet) onboard their first tenant+workspace here; only enforce
  // tenant-admin when targeting an existing tenant
  if (tenantId && !canAdminTenant(user.id, tenantId)) return response.status(403).json({ error: "tenant_admin_required" });
  ensureGlobalModelConfigs();
  const missingWorkspaceModelConfigId = parsed.data.model_config_ids.find((modelConfigId) => !modelConfigAvailableForProvisioning(modelConfigId, user.id));
  if (missingWorkspaceModelConfigId) return response.status(404).json({ error: "model_config_not_found", model_config_id: missingWorkspaceModelConfigId });
  try {
    const { custom_model_configs: _customModelConfigs, ...workspaceInput } = parsed.data;
    const created = createWorkspaceForUser({ user_id: user.id, provisioning_mode: "manual", ...workspaceInput, tenant_id: tenantId });
    const provisioning = await finishWorkspaceProvisioning(created as JsonRecord, parsed.data.provider_credentials as JsonRecord);
    response.status(201).json({ ...created, ...provisioning, workspace: workspaceResponse((created as JsonRecord).workspace, user.id) });
  } catch (error) {
    response.status(400).json({ error: "workspace_create_failed", message: error instanceof Error ? error.message : String(error) });
  }
});

function missingWorkspaceProvisioningCredentials(
  runtimeProvider: "vefaas" | "local_docker",
  sandboxProvider: "e2b" | "vefaas" | "local_docker" | "daytona",
  providerCredentials: Record<string, Record<string, unknown> | undefined>,
  sandboxConfig: Record<string, unknown>
) {
  const vefaasCreds = providerCredentials?.vefaas ?? {};
  const e2bCreds = providerCredentials?.e2b ?? {};
  const vefaasSandboxCreds = providerCredentials?.vefaas_sandbox ?? {};
  const daytonaCreds = providerCredentials?.daytona ?? {};
  const vefaasSandboxConfig = asRecord(sandboxConfig.vefaas ?? sandboxConfig.vefaas_sandbox ?? sandboxConfig);
  const daytonaConfig = asRecord(sandboxConfig.daytona ?? sandboxConfig.daytona_sandbox ?? sandboxConfig);
  const required: Array<[string, unknown]> = [];
  if (runtimeProvider === "vefaas") {
    required.push(
      ["VOLCENGINE_ACCESS_KEY", vefaasCreds.VOLCENGINE_ACCESS_KEY],
      ["VOLCENGINE_SECRET_KEY", vefaasCreds.VOLCENGINE_SECRET_KEY],
      ["VEFAAS_REGION", vefaasCreds.VEFAAS_REGION]
    );
  }
  if (sandboxProvider === "e2b") required.push(["E2B_API_KEY", e2bCreds.E2B_API_KEY]);
  if (sandboxProvider === "vefaas") {
    required.push(
      ["VEFAAS_SANDBOX_FUNCTION_ID", vefaasSandboxConfig.function_id ?? vefaasSandboxCreds.VEFAAS_SANDBOX_FUNCTION_ID],
      ["VEFAAS_SANDBOX_GATEWAY_URL", vefaasSandboxConfig.gateway_url ?? vefaasSandboxCreds.VEFAAS_SANDBOX_GATEWAY_URL]
    );
  }
  if (sandboxProvider === "daytona") {
    required.push(
      ["DAYTONA_SERVER_URL", daytonaConfig.server_url ?? daytonaCreds.DAYTONA_SERVER_URL],
      ["DAYTONA_API_KEY", daytonaConfig.api_key ?? daytonaCreds.DAYTONA_API_KEY]
    );
  }
  return required.filter(([, value]) => !String(value ?? "").trim()).map(([key]) => key);
}

app.delete("/v1/workspaces/:workspaceId", (request: AuthenticatedRequest, response) => {
  const workspaceId = routeParam(request.params.workspaceId);
  const workspace = getWorkspace(workspaceId);
  if (!workspace) return response.status(404).json({ error: "workspace_not_found" });
  if (!canAdminWorkspace(currentUser(request).id, workspaceId)) return response.status(403).json({ error: "workspace_admin_required" });
  const result = deleteWorkspaceCascade(workspaceId);
  if (!result.deleted) return response.status(400).json({ error: "reason" in result ? result.reason : "workspace_not_deleted" });
  response.json({ ok: true, counts: result.counts });
});

app.get("/v1/workspaces/:workspaceId", (request: AuthenticatedRequest, response) => {
  const workspaceId = routeParam(request.params.workspaceId);
  if (!canAccessWorkspace(currentUser(request).id, workspaceId)) return response.status(403).json({ error: "workspace_forbidden" });
  const workspace = getWorkspace(workspaceId);
  if (!workspace) return response.status(404).json({ error: "workspace_not_found" });
  response.json(workspaceResponse(workspace, currentUser(request).id));
});

app.patch("/v1/workspaces/:workspaceId", (request: AuthenticatedRequest, response) => {
  const workspaceId = routeParam(request.params.workspaceId);
  if (!canAdminWorkspace(currentUser(request).id, workspaceId)) return response.status(403).json({ error: "workspace_admin_required" });
  // onboarding workspaces are immutable: runtime pool / provider / slug are fixed at creation
  const patchBody = (request.body ?? {}) as Record<string, unknown>;
  const immutableFields = ["runtime_pool", "runtime_provider", "sandbox_provider", "slug", "model_config_ids"];
  if (immutableFields.some((field) => field in patchBody)) return response.status(405).json({ error: "workspace_runtime_immutable" });
  const parsed = workspacePatchSchema.safeParse(request.body);
  if (!parsed.success) return response.status(400).json(parsed.error.flatten());
  const workspace = updateWorkspace(workspaceId, parsed.data);
  if (!workspace) return response.status(404).json({ error: "workspace_not_found" });
  response.json(workspaceResponse(workspace, currentUser(request).id));
});

app.get("/v1/workspaces/:workspaceId/members", (request: AuthenticatedRequest, response) => {
  const workspaceId = routeParam(request.params.workspaceId);
  if (!getWorkspace(workspaceId)) return response.status(404).json({ error: "workspace_not_found" });
  if (!canAdminWorkspace(currentUser(request).id, workspaceId)) return response.status(403).json({ error: "workspace_admin_required" });
  response.json({ data: listWorkspaceMembers(workspaceId) });
});

app.post("/v1/workspaces/:workspaceId/members", (request: AuthenticatedRequest, response) => {
  const workspaceId = routeParam(request.params.workspaceId);
  if (!getWorkspace(workspaceId)) return response.status(404).json({ error: "workspace_not_found" });
  if (!canAdminWorkspace(currentUser(request).id, workspaceId)) return response.status(403).json({ error: "workspace_admin_required" });
  const parsed = workspaceAdminSchema.safeParse(request.body);
  if (!parsed.success) return response.status(400).json(parsed.error.flatten());
  const member = addWorkspaceMemberByEmail(workspaceId, parsed.data.email);
  response.status(201).json(member);
});

app.delete("/v1/workspaces/:workspaceId/members/:userId", (request: AuthenticatedRequest, response) => {
  const workspaceId = routeParam(request.params.workspaceId);
  const userId = routeParam(request.params.userId);
  if (!getWorkspace(workspaceId)) return response.status(404).json({ error: "workspace_not_found" });
  if (!canAdminWorkspace(currentUser(request).id, workspaceId)) return response.status(403).json({ error: "workspace_admin_required" });
  const result = removeWorkspaceMember(workspaceId, userId);
  if (!result.removed) return response.status(400).json({ error: "reason" in result ? result.reason : "workspace_member_not_removed" });
  response.json({ ok: true });
});

app.post("/v1/workspaces/:workspaceId/admins", (request: AuthenticatedRequest, response) => {
  const workspaceId = routeParam(request.params.workspaceId);
  if (!getWorkspace(workspaceId)) return response.status(404).json({ error: "workspace_not_found" });
  if (!canAdminWorkspace(currentUser(request).id, workspaceId)) return response.status(403).json({ error: "workspace_admin_required" });
  const parsed = workspaceAdminSchema.safeParse(request.body);
  if (!parsed.success) return response.status(400).json(parsed.error.flatten());
  const member = addWorkspaceAdminByEmail(workspaceId, parsed.data.email);
  response.status(201).json(member);
});

app.delete("/v1/workspaces/:workspaceId/admins/:userId", (request: AuthenticatedRequest, response) => {
  const workspaceId = routeParam(request.params.workspaceId);
  const userId = routeParam(request.params.userId);
  if (!getWorkspace(workspaceId)) return response.status(404).json({ error: "workspace_not_found" });
  if (!canAdminWorkspace(currentUser(request).id, workspaceId)) return response.status(403).json({ error: "workspace_admin_required" });
  const result = removeWorkspaceAdmin(workspaceId, userId);
  if (!result.removed) return response.status(400).json({ error: "reason" in result ? result.reason : "workspace_admin_not_removed" });
  response.json({ ok: true });
});

app.get("/v1/workspaces/:workspaceId/runtime_pool", (request: AuthenticatedRequest, response) => {
  const workspaceId = routeParam(request.params.workspaceId);
  if (!canAccessWorkspace(currentUser(request).id, workspaceId)) return response.status(403).json({ error: "workspace_forbidden" });
  const pool = getWorkspaceRuntimePool(workspaceId);
  if (!pool) return response.status(404).json({ error: "runtime_pool_not_found" });
  const { page, pageSize, status, offset } = poolMemberPageQuery(request.query as JsonRecord);
  const counts = countRuntimePoolMembersByStatus(pool.id);
  const { members: _all, ...meta } = pool;
  response.json({
    ...meta,
    members: listRuntimePoolMembersPage(pool.id, { limit: pageSize, offset, status }),
    member_total: poolMemberTotal(counts, status),
    member_status_counts: counts.by_status,
    page,
    page_size: pageSize
  });
});

app.get("/v1/workspaces/:workspaceId/sandbox_pool", (request: AuthenticatedRequest, response) => {
  const workspaceId = routeParam(request.params.workspaceId);
  if (!canAccessWorkspace(currentUser(request).id, workspaceId)) return response.status(403).json({ error: "workspace_forbidden" });
  const pool = getWorkspaceSandboxPool(workspaceId);
  if (!pool) return response.status(404).json({ error: "sandbox_pool_not_found" });
  const { page, pageSize, status, offset } = poolMemberPageQuery(request.query as JsonRecord);
  const counts = countSandboxPoolMembersByStatus(workspaceId, pool.provider);
  const { members: _all, ...meta } = pool;
  response.json({
    ...meta,
    members: listSandboxPoolMembersPage(workspaceId, pool.provider, { limit: pageSize, offset, status }),
    member_total: poolMemberTotal(counts, status),
    member_status_counts: counts.by_status,
    page,
    page_size: pageSize
  });
});

app.get("/v1/workspaces/:workspaceId/api_keys", (request: AuthenticatedRequest, response) => {
  const workspaceId = routeParam(request.params.workspaceId);
  if (!canAdminWorkspace(currentUser(request).id, workspaceId)) return response.status(403).json({ error: "workspace_admin_required" });
  response.json({ data: listWorkspaceApiKeys(workspaceId) });
});

app.post("/v1/workspaces/:workspaceId/api_keys", (request: AuthenticatedRequest, response) => {
  const workspaceId = routeParam(request.params.workspaceId);
  if (!canAdminWorkspace(currentUser(request).id, workspaceId)) return response.status(403).json({ error: "workspace_admin_required" });
  const parsed = workspaceApiKeySchema.safeParse(request.body);
  if (!parsed.success) return response.status(400).json(parsed.error.flatten());
  response.status(201).json(createWorkspaceApiKey({ workspace_id: workspaceId, ...parsed.data }));
});

app.patch("/v1/workspaces/:workspaceId/api_keys/:keyId", (request: AuthenticatedRequest, response) => {
  const workspaceId = routeParam(request.params.workspaceId);
  if (!canAdminWorkspace(currentUser(request).id, workspaceId)) return response.status(403).json({ error: "workspace_admin_required" });
  const parsed = workspaceApiKeySchema.partial().extend({ enabled: z.boolean().optional() }).safeParse(request.body);
  if (!parsed.success) return response.status(400).json(parsed.error.flatten());
  const key = updateWorkspaceApiKey(workspaceId, routeParam(request.params.keyId), parsed.data);
  if (!key) return response.status(404).json({ error: "workspace_api_key_not_found" });
  response.json(key);
});

app.delete("/v1/workspaces/:workspaceId/api_keys/:keyId", (request: AuthenticatedRequest, response) => {
  const workspaceId = routeParam(request.params.workspaceId);
  if (!canAdminWorkspace(currentUser(request).id, workspaceId)) return response.status(403).json({ error: "workspace_admin_required" });
  const deleted = deleteWorkspaceApiKey(workspaceId, routeParam(request.params.keyId));
  if (!deleted) return response.status(404).json({ error: "workspace_api_key_not_found" });
  response.status(204).send();
});
}

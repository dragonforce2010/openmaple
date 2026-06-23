/* eslint-disable max-lines */
import type { Express } from "express";
import { validateAliyunCredentials } from "../cloud/aliyunOpenApi";
import { validateVolcengineCredentials } from "../cloud/volcengineOpenApi";
import {
  countRuntimePoolMembersByStatus,
  countSandboxPoolMembersByStatus,
  getWorkspaceSandboxPool,
  listWorkspaceSandboxPools,
  listRuntimePoolMembersPage,
  listSandboxPoolMembersPage,
  listWorkspaceRuntimePools
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
  tenantCloudProviderCredentials,
  upsertTenantCloudProvider,
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
  const onboardingCreds = withTenantCloudCredentials("", parsed.data.provider_credentials as Record<string, Record<string, unknown> | undefined>);
  const missingCreds = missingWorkspaceProvisioningCredentials(parsed.data.runtime_provider, parsed.data.sandbox_provider, onboardingCreds, parsed.data.sandbox_config, parsed.data.runtime_pools, parsed.data.sandbox_pools, parsed.data.artifact_provider);
  if (missingCreds.length) return response.status(400).json({ error: "provider_credentials_required", missing: missingCreds });
  const onboardingCloudValidation = await validateWorkspaceVolcengineCredentials(onboardingCreds);
  if (!onboardingCloudValidation.ok) return response.status(400).json(onboardingCloudValidation);
  const onboardingAliyunValidation = await validateWorkspaceAliyunCredentials(onboardingCreds);
  if (!onboardingAliyunValidation.ok) return response.status(400).json(onboardingAliyunValidation);
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
    const tenantId = String(((created as JsonRecord).tenant as JsonRecord | undefined)?.id || ((created as JsonRecord).workspace as JsonRecord | undefined)?.tenant_id || "");
    if (tenantId && onboardingCreds.vefaas?.VOLCENGINE_ACCESS_KEY) {
      upsertTenantCloudProvider(tenantId, "volcengine", onboardingCreds.vefaas as JsonRecord);
    }
    if (tenantId && onboardingCreds.aliyun?.ALIYUN_ACCESS_KEY_ID) {
      upsertTenantCloudProvider(tenantId, "aliyun", onboardingCreds.aliyun as JsonRecord);
    }
    const provisioning = await finishWorkspaceProvisioning(created as JsonRecord, onboardingCreds as JsonRecord);
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
  const tenantId = parsed.data.tenant_id || String(((listTenantAdminTenants(user.id) as JsonRecord[])[0]?.id ?? ""));
  // brand-new users (no tenant yet) onboard their first tenant+workspace here; only enforce
  // tenant-admin when targeting an existing tenant
  if (tenantId && !canAdminTenant(user.id, tenantId)) return response.status(403).json({ error: "tenant_admin_required" });
  const missingCloudAccess = missingTenantCloudProviderAccess(tenantId, parsed.data.runtime_provider, parsed.data.sandbox_provider, parsed.data.runtime_pools, parsed.data.sandbox_pools, parsed.data.artifact_provider);
  if (missingCloudAccess.length) return response.status(400).json({ error: "cloud_provider_not_connected", missing: missingCloudAccess });
  const createCreds = withTenantCloudCredentials(tenantId, parsed.data.provider_credentials as Record<string, Record<string, unknown> | undefined>);
  const missingCreateCreds = missingWorkspaceProvisioningCredentials(parsed.data.runtime_provider, parsed.data.sandbox_provider, createCreds, parsed.data.sandbox_config, parsed.data.runtime_pools, parsed.data.sandbox_pools, parsed.data.artifact_provider);
  if (missingCreateCreds.length) return response.status(400).json({ error: "provider_credentials_required", missing: missingCreateCreds });
  if (!tenantId) {
    const createCloudValidation = await validateWorkspaceVolcengineCredentials(createCreds);
    if (!createCloudValidation.ok) return response.status(400).json(createCloudValidation);
    const createAliyunValidation = await validateWorkspaceAliyunCredentials(createCreds);
    if (!createAliyunValidation.ok) return response.status(400).json(createAliyunValidation);
  }
  ensureGlobalModelConfigs();
  const missingWorkspaceModelConfigId = parsed.data.model_config_ids.find((modelConfigId) => !modelConfigAvailableForProvisioning(modelConfigId, user.id));
  if (missingWorkspaceModelConfigId) return response.status(404).json({ error: "model_config_not_found", model_config_id: missingWorkspaceModelConfigId });
  try {
    const { custom_model_configs: _customModelConfigs, ...workspaceInput } = parsed.data;
    const created = createWorkspaceForUser({ user_id: user.id, provisioning_mode: "manual", ...workspaceInput, tenant_id: tenantId, provider_credentials: createCreds as JsonRecord });
    const createdTenantId = String(((created as JsonRecord).tenant as JsonRecord | undefined)?.id || ((created as JsonRecord).workspace as JsonRecord | undefined)?.tenant_id || "");
    if (!tenantId && createdTenantId && createCreds.vefaas?.VOLCENGINE_ACCESS_KEY) {
      upsertTenantCloudProvider(createdTenantId, "volcengine", createCreds.vefaas as JsonRecord);
    }
    if (!tenantId && createdTenantId && createCreds.aliyun?.ALIYUN_ACCESS_KEY_ID) {
      upsertTenantCloudProvider(createdTenantId, "aliyun", createCreds.aliyun as JsonRecord);
    }
    const provisioning = await finishWorkspaceProvisioning(created as JsonRecord, createCreds as JsonRecord);
    response.status(201).json({ ...created, ...provisioning, workspace: workspaceResponse((created as JsonRecord).workspace, user.id) });
  } catch (error) {
    response.status(400).json({ error: "workspace_create_failed", message: error instanceof Error ? error.message : String(error) });
  }
});

function withTenantCloudCredentials(tenantId: string, providerCredentials: Record<string, Record<string, unknown> | undefined>) {
  if (!tenantId) return providerCredentials;
  const volcengine = tenantCloudProviderCredentials(tenantId, "volcengine");
  const aliyun = tenantCloudProviderCredentials(tenantId, "aliyun");
  return {
    ...providerCredentials,
    ...(Object.keys(volcengine).length ? { vefaas: { ...volcengine, ...(providerCredentials.vefaas ?? {}) } } : {}),
    ...(Object.keys(aliyun).length ? { aliyun: { ...aliyun, ...(providerCredentials.aliyun ?? {}) } } : {})
  };
}

async function validateWorkspaceCloudCredentials(providerCredentials: Record<string, Record<string, unknown> | undefined>) {
  const volcengine = await validateWorkspaceVolcengineCredentials(providerCredentials);
  if (!volcengine.ok) return volcengine;
  return validateWorkspaceAliyunCredentials(providerCredentials);
}

async function validateWorkspaceVolcengineCredentials(providerCredentials: Record<string, Record<string, unknown> | undefined>) {
  const vefaas = providerCredentials.vefaas ?? {};
  const accessKey = String(vefaas.VOLCENGINE_ACCESS_KEY || vefaas.access_key || "");
  const secretKey = String(vefaas.VOLCENGINE_SECRET_KEY || vefaas.secret_key || "");
  if (!accessKey && !secretKey) return { ok: true as const };
  return validateVolcengineCredentials({
    accessKey,
    secretKey,
    region: String(vefaas.VEFAAS_REGION || vefaas.region || "cn-beijing")
  });
}

async function validateWorkspaceAliyunCredentials(providerCredentials: Record<string, Record<string, unknown> | undefined>) {
  const aliyun = providerCredentials.aliyun ?? providerCredentials.alibaba_cloud ?? {};
  const accessKeyId = String(aliyun.ALIYUN_ACCESS_KEY_ID || aliyun.access_key_id || aliyun.ak || "");
  const accessKeySecret = String(aliyun.ALIYUN_ACCESS_KEY_SECRET || aliyun.access_key_secret || aliyun.sk || "");
  if (!accessKeyId && !accessKeySecret) return { ok: true as const };
  return validateAliyunCredentials({
    accessKeyId,
    accessKeySecret,
    region: String(aliyun.ALIYUN_REGION || aliyun.region || "cn-hangzhou")
  });
}

type RuntimeProviderInput = "vefaas" | "local_docker" | "aliyun_fc";
type SandboxProviderInput = "e2b" | "vefaas" | "local_docker" | "daytona" | "aliyun_fc";
type ProviderPoolInput = Array<{ provider?: string; config?: Record<string, unknown> }>;

function missingTenantCloudProviderAccess(tenantId: string, runtimeProvider: RuntimeProviderInput, sandboxProvider: SandboxProviderInput, runtimePools: ProviderPoolInput = [], sandboxPools: ProviderPoolInput = [], artifactProvider?: "tos" | "oss") {
  if (!tenantId) return [];
  const missing: string[] = [];
  const runtimeProviders = providerSet(runtimeProvider, runtimePools);
  const sandboxProviders = providerSet(sandboxProvider, sandboxPools);
  const needsVolcengine = runtimeProviders.has("vefaas") || sandboxProviders.has("vefaas") || artifactProvider === "tos";
  const needsAliyun = runtimeProviders.has("aliyun_fc") || sandboxProviders.has("aliyun_fc") || artifactProvider === "oss";
  if (needsVolcengine && !Object.keys(tenantCloudProviderCredentials(tenantId, "volcengine")).length) missing.push("volcengine");
  if (needsAliyun && !Object.keys(tenantCloudProviderCredentials(tenantId, "aliyun")).length) missing.push("aliyun");
  return missing;
}

function missingWorkspaceProvisioningCredentials(
  runtimeProvider: RuntimeProviderInput,
  sandboxProvider: SandboxProviderInput,
  providerCredentials: Record<string, Record<string, unknown> | undefined>,
  sandboxConfig: Record<string, unknown>,
  runtimePools: ProviderPoolInput = [],
  sandboxPools: ProviderPoolInput = [],
  artifactProvider?: "tos" | "oss"
) {
  const vefaasCreds = providerCredentials?.vefaas ?? {};
  const aliyunCreds = providerCredentials?.aliyun ?? providerCredentials?.alibaba_cloud ?? {};
  const e2bCreds = providerCredentials?.e2b ?? {};
  const vefaasSandboxCreds = providerCredentials?.vefaas_sandbox ?? {};
  const daytonaCreds = providerCredentials?.daytona ?? {};
  const vefaasSandboxConfig = asRecord(sandboxConfig.vefaas ?? sandboxConfig.vefaas_sandbox ?? sandboxConfig);
  const aliyunSandboxConfig = asRecord(sandboxConfig.aliyun_fc ?? sandboxConfig.aliyun ?? sandboxConfig);
  const daytonaConfig = asRecord(sandboxConfig.daytona ?? sandboxConfig.daytona_sandbox ?? sandboxConfig);
  const required: Array<[string, unknown]> = [];
  const runtimeProviders = providerSet(runtimeProvider, runtimePools);
  const sandboxProviders = providerSet(sandboxProvider, sandboxPools);
  const aliyunSandboxInvokeUrl = String(
    aliyunSandboxConfig.invoke_url ??
    aliyunSandboxConfig.invokeUrl ??
    aliyunCreds.ALIYUN_FC_INVOKE_URL ??
    aliyunCreds.invoke_url ??
    aliyunCreds.invokeUrl ??
    sandboxPools.find((pool) => pool.provider === "aliyun_fc" && String(asRecord(pool.config).invoke_url ?? "").trim())?.config?.invoke_url ??
    ""
  );
  if (runtimeProviders.has("vefaas") || artifactProvider === "tos") {
    required.push(
      ["VOLCENGINE_ACCESS_KEY", vefaasCreds.VOLCENGINE_ACCESS_KEY],
      ["VOLCENGINE_SECRET_KEY", vefaasCreds.VOLCENGINE_SECRET_KEY],
      ["VEFAAS_REGION", vefaasCreds.VEFAAS_REGION]
    );
  }
  if (runtimeProviders.has("aliyun_fc") || artifactProvider === "oss") {
    required.push(
      ["ALIYUN_ACCESS_KEY_ID", aliyunCreds.ALIYUN_ACCESS_KEY_ID ?? aliyunCreds.access_key_id ?? aliyunCreds.ak],
      ["ALIYUN_ACCESS_KEY_SECRET", aliyunCreds.ALIYUN_ACCESS_KEY_SECRET ?? aliyunCreds.access_key_secret ?? aliyunCreds.sk],
      ["ALIYUN_REGION", aliyunCreds.ALIYUN_REGION ?? aliyunCreds.region]
    );
  }
  if (sandboxProviders.has("e2b")) required.push(["E2B_API_KEY", e2bCreds.E2B_API_KEY]);
  if (sandboxProviders.has("vefaas")) {
    required.push(
      ["VEFAAS_SANDBOX_FUNCTION_ID", vefaasSandboxConfig.function_id ?? vefaasSandboxCreds.VEFAAS_SANDBOX_FUNCTION_ID],
      ["VEFAAS_SANDBOX_GATEWAY_URL", vefaasSandboxConfig.gateway_url ?? vefaasSandboxCreds.VEFAAS_SANDBOX_GATEWAY_URL]
    );
  }
  if (sandboxProviders.has("aliyun_fc")) {
    if (!aliyunSandboxInvokeUrl.trim()) {
      required.push(
        ["ALIYUN_ACCESS_KEY_ID", aliyunCreds.ALIYUN_ACCESS_KEY_ID ?? aliyunCreds.access_key_id ?? aliyunCreds.ak],
        ["ALIYUN_ACCESS_KEY_SECRET", aliyunCreds.ALIYUN_ACCESS_KEY_SECRET ?? aliyunCreds.access_key_secret ?? aliyunCreds.sk],
        ["ALIYUN_REGION", aliyunCreds.ALIYUN_REGION ?? aliyunCreds.region]
      );
    }
  }
  if (sandboxProviders.has("daytona")) {
    required.push(
      ["DAYTONA_SERVER_URL", daytonaConfig.server_url ?? daytonaCreds.DAYTONA_SERVER_URL],
      ["DAYTONA_API_KEY", daytonaConfig.api_key ?? daytonaCreds.DAYTONA_API_KEY]
    );
  }
  return Array.from(new Set(required.filter(([, value]) => !String(value ?? "").trim()).map(([key]) => key)));
}

function providerSet(primary: string, pools: ProviderPoolInput) {
  const providers = new Set([primary]);
  for (const pool of pools) {
    if (pool.provider) providers.add(String(pool.provider));
  }
  return providers;
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
  const pools = listWorkspaceRuntimePools(workspaceId);
  const { page, pageSize, status, offset } = poolMemberPageQuery(request.query as JsonRecord);
  const counts = countRuntimePoolMembersByStatus(pool.id);
  const { members: _all, ...meta } = pool;
  response.json({
    ...meta,
    pools: pools.map((item) => {
      const { members: _members, ...poolMeta } = item as JsonRecord;
      return { ...poolMeta, member_status_counts: countRuntimePoolMembersByStatus(String((item as JsonRecord).id)).by_status };
    }),
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
  const pools = listWorkspaceSandboxPools(workspaceId);
  const { page, pageSize, status, offset } = poolMemberPageQuery(request.query as JsonRecord);
  const counts = countSandboxPoolMembersByStatus(workspaceId, pool.provider);
  const { members: _all, ...meta } = pool;
  response.json({
    ...meta,
    pools: pools.map((item) => {
      const { members: _members, ...poolMeta } = item as JsonRecord;
      return { ...poolMeta, member_status_counts: countSandboxPoolMembersByStatus(workspaceId, String((item as JsonRecord).provider)).by_status };
    }),
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

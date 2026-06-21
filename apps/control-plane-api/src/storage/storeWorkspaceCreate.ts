import { nanoid } from "nanoid";
import { encryptSecret } from "../secrets";
import type { JsonRecord } from "../types";
import {
  db,
  hashString,
  now,
  runtimePoolConfig,
  sandboxPoolConfig,
  toJson,
  workspaceApiKeyMaterial,
  type WorkspaceOnboardingInput
} from "./storeCore";
import { hydrateTenantRow } from "./storeHydrators";
import { ensureDefaultEnvironments } from "./storeAgentsEnvironments";
import { ensureUserByEmail, getUser, normalizeEmail } from "./storeTemplatesSkillsUsers";
import { listTenantAdminTenants, tenantSlugFromRecord } from "./storeTenant";
import {
  getWorkspace,
  getWorkspaceRuntimePool,
  normalizeWorkspaceSlug,
  workspaceConsoleUrl,
  workspaceSlugAvailable
} from "./storeWorkspace";
import { getWorkspaceApiKey } from "./storeWorkspaceKeys";
import { insertWorkspaceModelConfigClone, workspaceModelConfigsForCreate } from "./storeWorkspaceModels";
import { provisionPoolMembersBackground } from "./storeWorkspaceProvisioning";
import { cloudProviderIdentities } from "./cloudProviderIdentity";

// Explicit slugs fail loudly; auto-derived slugs must never block creation, so
// short or taken candidates fall back to an id-suffixed slug.
function resolveWorkspaceSlug(explicitSlug: string | undefined, name: string, workspaceId: string) {
  if (explicitSlug?.trim()) {
    const slug = normalizeWorkspaceSlug(explicitSlug);
    const status = workspaceSlugAvailable(slug);
    if (!status.available) throw new Error(`workspace slug is ${status.reason}: ${slug}`);
    return slug;
  }
  const idFragment = normalizeWorkspaceSlug(workspaceId.replace(/^ws_/, ""));
  const base = normalizeWorkspaceSlug(name);
  const candidates = [base, normalizeWorkspaceSlug(`${base}-${idFragment}`), normalizeWorkspaceSlug(`ws-${idFragment}`)];
  for (const candidate of candidates) {
    if (candidate && workspaceSlugAvailable(candidate).available) return candidate;
  }
  throw new Error(`workspace slug is unavailable: ${base || workspaceId}`);
}

function pendingWorkspaceMemberUsers(input: { user_id: string; member_emails?: string[] }) {
  const owner = getUser(input.user_id) as JsonRecord | null;
  const ownerEmail = String(owner?.email || "").toLowerCase();
  const emails = Array.from(
    new Set(
      (input.member_emails ?? [])
        .map((email) => normalizeEmail(email))
        .filter((email) => email && email !== ownerEmail)
    )
  );
  return emails
    .map((email) => ensureUserByEmail({ email, metadata: { source: "workspace_member_invite" } }))
    .filter(Boolean) as JsonRecord[];
}

function runtimePoolProvisioner(provider: string) {
  return provider === "local_docker"
    ? { strategy: "least_active_sessions", provisioner: "local_docker" }
    : { strategy: "least_active_sessions", provisioner: "vefaas_direct" };
}

function runtimePoolMemberRegion(provider: string, providerCredentials?: JsonRecord) {
  if (provider === "local_docker") return "local";
  return String((providerCredentials?.vefaas as Record<string, unknown> | undefined)?.VEFAAS_REGION || "cn-beijing");
}

export function createWorkspaceOnboarding(input: WorkspaceOnboardingInput) {
  const stamp = now();
  const tenantId = `tenant_${nanoid(10)}`;
  const workspaceId = `ws_${nanoid(10)}`;
  const poolId = `rpool_${nanoid(10)}`;
  const poolConfig = runtimePoolConfig(input.runtime_pool);
  const sandboxPool = sandboxPoolConfig(input.sandbox_pool);
  const slug = resolveWorkspaceSlug(input.workspace.slug, input.workspace.name, workspaceId);
  const tenantSlug = slug;
  const customModelConfigs = (input.custom_model_configs ?? []).map((config) => ({ id: `modelcfg_${nanoid(10)}`, config }));
  const selectedModelConfigs = workspaceModelConfigsForCreate({ model_config_ids: input.model_config_ids, workspaceId });
  const modelConfigIds = [...selectedModelConfigs.map((item) => item.id), ...customModelConfigs.map((item) => item.id)];
  const workspaceConfig = {
    slug,
    tenant_slug: tenantSlug,
    console_url: workspaceConsoleUrl(tenantSlug, slug),
    admin: input.admin ?? {},
    runtime_provider: input.runtime_provider,
    sandbox_provider: input.sandbox_provider,
    sandbox_config: input.sandbox_config ?? {},
    sandbox_pool: sandboxPool,
    runtime_pool: poolConfig,
    model_config_ids: modelConfigIds,
    provider_credentials: input.provider_credentials ?? {},
    cloud_provider_identities: cloudProviderIdentities({
      providerCredentials: input.provider_credentials,
      runtimeProvider: input.runtime_provider,
      sandboxProvider: input.sandbox_provider
    }),
    immutable: true
  };
  const apiKey = workspaceApiKeyMaterial();
  const apiKeyId = `wskey_${nanoid(10)}`;
  const memberIds = Array.from({ length: poolConfig.desired_size }, () => `rpmem_${nanoid(10)}`);
  const workspaceMemberUsers = pendingWorkspaceMemberUsers(input);

  const tx = db.transaction(() => {
    db.prepare(`
      INSERT INTO tenants (id, name, description, status, metadata_json, created_by_user_id, created_at, updated_at)
      VALUES (?, ?, ?, 'active', ?, ?, ?, ?)
    `).run(
      tenantId,
      input.tenant.name,
      input.tenant.description ?? "",
	      toJson({ slug: tenantSlug, console_url: workspaceConsoleUrl(tenantSlug, slug), admin: input.admin ?? {}, source: "workspace_onboarding" }),
      input.user_id,
      stamp,
      stamp
    );
    db.prepare("INSERT OR IGNORE INTO tenant_members (id, tenant_id, user_id, role, created_at) VALUES (?, ?, ?, 'admin', ?)").run(
      `tnmem_${nanoid(10)}`,
      tenantId,
      input.user_id,
      stamp
    );
    db.prepare(`
      INSERT INTO workspaces
      (id, tenant_id, name, description, status, runtime_provider, sandbox_provider, config_json, config_hash, created_by_user_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?)
    `).run(
      workspaceId,
      tenantId,
      input.workspace.name,
      input.workspace.description ?? "",
      input.runtime_provider,
      input.sandbox_provider,
      toJson(workspaceConfig),
      hashString(toJson(workspaceConfig)),
      input.user_id,
      stamp,
      stamp
    );
    db.prepare("INSERT INTO workspace_members (id, workspace_id, user_id, role, created_at) VALUES (?, ?, ?, 'admin', ?)").run(
      `wsmem_${nanoid(10)}`,
      workspaceId,
      input.user_id,
      stamp
    );
    workspaceMemberUsers.forEach((user) => {
      db.prepare("INSERT OR IGNORE INTO workspace_members (id, workspace_id, user_id, role, created_at) VALUES (?, ?, ?, 'member', ?)").run(
        `wsmem_${nanoid(10)}`,
        workspaceId,
        user.id,
        stamp
      );
    });
    selectedModelConfigs.forEach((item) => insertWorkspaceModelConfigClone(item, { workspaceId, tenantId, userId: input.user_id, stamp }));
    customModelConfigs.forEach((item, index) => {
      const isDefault = item.config.is_default ?? ((input.model_config_ids ?? []).length === 0 && index === 0);
      if (isDefault) db.prepare("UPDATE model_configs SET is_default = 0 WHERE workspace_id = ?").run(workspaceId);
      db.prepare(`
        INSERT INTO model_configs
        (id, owner_user_id, workspace_id, tenant_id, created_by_user_id, name, provider_type, base_url, model_name, api_key_ref, api_key_ciphertext, api_key_hint, preset_key, is_default, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?)
      `).run(
        item.id,
        input.user_id,
        workspaceId,
        tenantId,
        input.user_id,
        item.config.name,
        item.config.provider_type,
        item.config.base_url.replace(/\/$/, ""),
        item.config.model_name,
        item.config.api_key_ciphertext ?? null,
        item.config.api_key_hint ?? null,
        item.config.preset_key ?? null,
        isDefault ? 1 : 0,
        stamp,
        stamp
      );
    });
    db.prepare(`
      INSERT INTO workspace_runtime_pools
      (id, workspace_id, provider, desired_size, min_instances_per_function, max_instances_per_function, max_concurrency_per_instance, cpu_milli, memory_mb, status, config_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)
    `).run(
      poolId,
      workspaceId,
      input.runtime_provider,
      poolConfig.desired_size,
      poolConfig.min_instances_per_function,
      poolConfig.max_instances_per_function,
      poolConfig.max_concurrency_per_instance,
      poolConfig.cpu_milli,
      poolConfig.memory_mb,
      toJson(runtimePoolProvisioner(input.runtime_provider)),
      stamp,
      stamp
    );
    memberIds.forEach((memberId) => {
      db.prepare(`
        INSERT INTO workspace_runtime_pool_members
        (id, runtime_pool_id, workspace_id, provider, cloud_function_id, cloud_app_id, invoke_url, region, status, weight, active_session_count, config_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, '', '', '', ?, 'provisioning', 100, 0, ?, ?, ?)
      `).run(
        memberId,
        poolId,
        workspaceId,
        input.runtime_provider,
        runtimePoolMemberRegion(input.runtime_provider, input.provider_credentials),
        toJson({ provisioning: true }),
        stamp,
        stamp
      );
    });
    db.prepare(`
      INSERT INTO workspace_api_keys
      (id, workspace_id, display_name, key_hash, key_prefix, key_ciphertext, scopes_json, enabled, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
    `).run(apiKeyId, workspaceId, input.api_key.display_name, apiKey.hash, apiKey.prefix, encryptSecret(apiKey.raw), toJson(input.api_key.scopes), stamp, stamp);
    // data migration: bind any orphan resources (no workspace) to this first workspace
    for (const table of ["agents", "environments", "sessions", "vaults", "memory_stores"]) {
      db.prepare(`UPDATE ${table} SET workspace_id = ? WHERE workspace_id IS NULL OR workspace_id = ''`).run(workspaceId);
    }
  });
  tx();

  ensureDefaultEnvironments(workspaceId);
  if (input.provisioning_mode !== "manual") {
    void provisionPoolMembersBackground(workspaceId, memberIds.map((memberId, index) => ({ memberId, index })), poolConfig, input.provider_credentials);
  }

  const tenant = db.prepare("SELECT * FROM tenants WHERE id = ?").get(tenantId) as JsonRecord;
  return {
    tenant: hydrateTenantRow(tenant),
    workspace: getWorkspace(workspaceId),
    runtime_pool: getWorkspaceRuntimePool(workspaceId),
    api_key: {
      ...(getWorkspaceApiKey(apiKeyId) as JsonRecord),
      key: apiKey.raw
    }
  };
}

export function createWorkspaceForUser(input: Omit<WorkspaceOnboardingInput, "tenant" | "api_key"> & { tenant_id?: string; api_key?: { display_name: string; scopes: string[] } }) {
  const adminTenants = listTenantAdminTenants(input.user_id) as JsonRecord[];
  const targetTenant = input.tenant_id
    ? adminTenants.find((tenant) => String(tenant.id) === input.tenant_id)
    : adminTenants[0];
  if (!targetTenant) {
    // brand-new user with no tenant yet: onboard their first tenant + workspace here
    return createWorkspaceOnboarding({
      ...input,
      tenant: { name: input.workspace.name, description: input.workspace.description },
      api_key: input.api_key ?? { display_name: "Default workspace key", scopes: ["control_plane", "data_plane"] }
    });
  }
  const stamp = now();
  const workspaceId = `ws_${nanoid(10)}`;
  const poolId = `rpool_${nanoid(10)}`;
  const poolConfig = runtimePoolConfig(input.runtime_pool);
  const sandboxPool = sandboxPoolConfig(input.sandbox_pool);
  const slug = resolveWorkspaceSlug(input.workspace.slug, input.workspace.name, workspaceId);
  const tenantSlug = tenantSlugFromRecord(targetTenant);
  const selectedModelConfigs = workspaceModelConfigsForCreate({ model_config_ids: input.model_config_ids, workspaceId });
  const workspaceConfig = {
    slug,
    tenant_slug: tenantSlug,
    console_url: workspaceConsoleUrl(tenantSlug, slug),
    admin: input.admin ?? {},
    runtime_provider: input.runtime_provider,
    sandbox_provider: input.sandbox_provider,
    sandbox_config: input.sandbox_config ?? {},
    sandbox_pool: sandboxPool,
    runtime_pool: poolConfig,
    model_config_ids: selectedModelConfigs.map((item) => item.id),
    provider_credentials: input.provider_credentials ?? {},
    cloud_provider_identities: cloudProviderIdentities({
      providerCredentials: input.provider_credentials,
      runtimeProvider: input.runtime_provider,
      sandboxProvider: input.sandbox_provider
    }),
    immutable: true
  };
  const apiKey = workspaceApiKeyMaterial();
  const apiKeyId = `wskey_${nanoid(10)}`;
  const memberIds = Array.from({ length: poolConfig.desired_size }, () => `rpmem_${nanoid(10)}`);
  const apiKeyInput = input.api_key ?? { display_name: "Default workspace key", scopes: ["control_plane", "data_plane"] };
  const workspaceMemberUsers = pendingWorkspaceMemberUsers(input);

  const tx = db.transaction(() => {
    db.prepare(`
      INSERT INTO workspaces
      (id, tenant_id, name, description, status, runtime_provider, sandbox_provider, config_json, config_hash, created_by_user_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?)
    `).run(
      workspaceId,
      targetTenant.id,
      input.workspace.name,
      input.workspace.description ?? "",
      input.runtime_provider,
      input.sandbox_provider,
      toJson(workspaceConfig),
      hashString(toJson(workspaceConfig)),
      input.user_id,
      stamp,
      stamp
    );
    db.prepare("INSERT INTO workspace_members (id, workspace_id, user_id, role, created_at) VALUES (?, ?, ?, 'admin', ?)").run(
      `wsmem_${nanoid(10)}`,
      workspaceId,
      input.user_id,
      stamp
    );
    workspaceMemberUsers.forEach((user) => {
      db.prepare("INSERT OR IGNORE INTO workspace_members (id, workspace_id, user_id, role, created_at) VALUES (?, ?, ?, 'member', ?)").run(
        `wsmem_${nanoid(10)}`,
        workspaceId,
        user.id,
        stamp
      );
    });
    selectedModelConfigs.forEach((item) => insertWorkspaceModelConfigClone(item, { workspaceId, tenantId: String(targetTenant.id), userId: input.user_id, stamp }));
    db.prepare(`
      INSERT INTO workspace_runtime_pools
      (id, workspace_id, provider, desired_size, min_instances_per_function, max_instances_per_function, max_concurrency_per_instance, cpu_milli, memory_mb, status, config_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)
    `).run(
      poolId,
      workspaceId,
      input.runtime_provider,
      poolConfig.desired_size,
      poolConfig.min_instances_per_function,
      poolConfig.max_instances_per_function,
      poolConfig.max_concurrency_per_instance,
      poolConfig.cpu_milli,
      poolConfig.memory_mb,
      toJson(runtimePoolProvisioner(input.runtime_provider)),
      stamp,
      stamp
    );
    memberIds.forEach((memberId) => {
      db.prepare(`
        INSERT INTO workspace_runtime_pool_members
        (id, runtime_pool_id, workspace_id, provider, cloud_function_id, cloud_app_id, invoke_url, region, status, weight, active_session_count, config_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, '', '', '', ?, 'provisioning', 100, 0, ?, ?, ?)
      `).run(
        memberId,
        poolId,
        workspaceId,
        input.runtime_provider,
        runtimePoolMemberRegion(input.runtime_provider, input.provider_credentials),
        toJson({ provisioning: true }),
        stamp,
        stamp
      );
    });
    db.prepare(`
      INSERT INTO workspace_api_keys
      (id, workspace_id, display_name, key_hash, key_prefix, key_ciphertext, scopes_json, enabled, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
    `).run(apiKeyId, workspaceId, apiKeyInput.display_name, apiKey.hash, apiKey.prefix, encryptSecret(apiKey.raw), toJson(apiKeyInput.scopes), stamp, stamp);
  });
  tx();

  ensureDefaultEnvironments(workspaceId);
  if (input.provisioning_mode !== "manual") {
    void provisionPoolMembersBackground(workspaceId, memberIds.map((memberId, index) => ({ memberId, index })), poolConfig, input.provider_credentials);
  }

  return {
    workspace: getWorkspace(workspaceId),
    runtime_pool: getWorkspaceRuntimePool(workspaceId),
    api_key: {
      ...(getWorkspaceApiKey(apiKeyId) as JsonRecord),
      key: apiKey.raw
    }
  };
}

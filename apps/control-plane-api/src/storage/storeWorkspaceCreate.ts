/* eslint-disable max-lines */
import { nanoid } from "nanoid";
import { encryptSecret } from "../secrets";
import type { JsonRecord } from "../types";
import {
  db,
  hashString,
  now,
  runtimePoolConfig,
  runtimeProviderPoolConfigs,
  sandboxPoolConfig,
  sandboxProviderPoolConfigs,
  toJson,
  workspaceApiKeyMaterial,
  type RuntimeProviderPoolConfig,
  type SandboxProviderPoolConfig,
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
  if (provider === "local_docker") return { strategy: "least_active_sessions", provisioner: "local_docker" };
  if (provider === "aliyun_fc") return { strategy: "least_active_sessions", provisioner: "aliyun_fc_direct" };
  return { strategy: "least_active_sessions", provisioner: "vefaas_direct" };
}

function runtimePoolMemberRegion(provider: string, providerCredentials?: JsonRecord) {
  if (provider === "local_docker") return "local";
  if (provider === "aliyun_fc") return String(((providerCredentials?.aliyun ?? providerCredentials?.alibaba_cloud) as Record<string, unknown> | undefined)?.ALIYUN_REGION || "cn-hangzhou");
  return String((providerCredentials?.vefaas as Record<string, unknown> | undefined)?.VEFAAS_REGION || "cn-beijing");
}

function primaryProvider<T extends { provider: string; role: string; priority: number }>(pools: T[], fallback: string) {
  return (pools.find((pool) => pool.role === "primary") ?? pools[0])?.provider ?? fallback;
}

function artifactProvider(input: Pick<WorkspaceOnboardingInput, "artifact_provider" | "object_storage">) {
  const configured = String(input.artifact_provider || input.object_storage?.provider || "");
  if (configured === "oss" || configured === "tos") return configured;
  return undefined;
}

function runtimePoolInsertConfig(pool: RuntimeProviderPoolConfig) {
  return {
    ...runtimePoolProvisioner(pool.provider),
    role: pool.role,
    priority: pool.priority,
    name: pool.name,
    provider: pool.provider,
    ...pool.config
  };
}

function sandboxPoolRecord(pool: SandboxProviderPoolConfig) {
  return {
    provider: pool.provider,
    role: pool.role,
    priority: pool.priority,
    name: pool.name,
    desired_size: pool.desired_size,
    standby_ttl_ms: pool.standby_ttl_ms,
    config: pool.config
  };
}

export function createWorkspaceOnboarding(input: WorkspaceOnboardingInput) {
  const stamp = now();
  const tenantId = `tenant_${nanoid(10)}`;
  const workspaceId = `ws_${nanoid(10)}`;
  const poolConfig = runtimePoolConfig(input.runtime_pool);
  const runtimePools = runtimeProviderPoolConfigs(input.runtime_pools, input.runtime_provider, poolConfig);
  const sandboxPool = sandboxPoolConfig(input.sandbox_pool);
  const sandboxPools = sandboxProviderPoolConfigs(input.sandbox_pools, input.sandbox_provider, sandboxPool);
  const primaryRuntimeProvider = primaryProvider(runtimePools, input.runtime_provider);
  const primarySandboxProvider = primaryProvider(sandboxPools, input.sandbox_provider);
  const selectedArtifactProvider = artifactProvider(input);
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
    runtime_provider: primaryRuntimeProvider,
    runtime_pools: runtimePools,
    sandbox_provider: primarySandboxProvider,
    sandbox_config: input.sandbox_config ?? {},
    sandbox_pool: sandboxPool,
    sandbox_pools: sandboxPools.map(sandboxPoolRecord),
    ...(selectedArtifactProvider ? { artifact_provider: selectedArtifactProvider } : {}),
    object_storage: { ...(input.object_storage ?? {}), ...(selectedArtifactProvider ? { provider: selectedArtifactProvider } : {}) },
    runtime_pool: poolConfig,
    model_config_ids: modelConfigIds,
    provider_credentials: input.provider_credentials ?? {},
    cloud_provider_identities: cloudProviderIdentities({
      providerCredentials: input.provider_credentials,
      runtimeProvider: primaryRuntimeProvider,
      sandboxProvider: primarySandboxProvider,
      runtimePools,
      sandboxPools,
      artifactProvider: selectedArtifactProvider
    }),
    immutable: true
  };
  const apiKey = workspaceApiKeyMaterial();
  const apiKeyId = `wskey_${nanoid(10)}`;
  const runtimePoolRows = runtimePools.map((pool) => ({
    pool,
    poolId: `rpool_${nanoid(10)}`,
    memberIds: Array.from({ length: pool.desired_size }, () => `rpmem_${nanoid(10)}`)
  }));
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
    db.prepare("INSERT IGNORE INTO tenant_members (id, tenant_id, user_id, role, created_at) VALUES (?, ?, ?, 'admin', ?)").run(
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
      primaryRuntimeProvider,
      primarySandboxProvider,
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
      db.prepare("INSERT IGNORE INTO workspace_members (id, workspace_id, user_id, role, created_at) VALUES (?, ?, ?, 'member', ?)").run(
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
    runtimePoolRows.forEach(({ pool, poolId, memberIds }) => {
      db.prepare(`
        INSERT INTO workspace_runtime_pools
        (id, workspace_id, provider, desired_size, min_instances_per_function, max_instances_per_function, max_concurrency_per_instance, cpu_milli, memory_mb, status, config_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)
      `).run(
        poolId,
        workspaceId,
        pool.provider,
        pool.desired_size,
        pool.min_instances_per_function,
        pool.max_instances_per_function,
        pool.max_concurrency_per_instance,
        pool.cpu_milli,
        pool.memory_mb,
        toJson(runtimePoolInsertConfig(pool)),
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
          pool.provider,
          runtimePoolMemberRegion(pool.provider, input.provider_credentials),
          toJson({ provisioning: true, role: pool.role, priority: pool.priority, pool_name: pool.name }),
          stamp,
          stamp
        );
      });
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
    runtimePoolRows.forEach(({ pool, memberIds }) => {
      void provisionPoolMembersBackground(workspaceId, memberIds.map((memberId, index) => ({ memberId, index })), pool, input.provider_credentials);
    });
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
  const poolConfig = runtimePoolConfig(input.runtime_pool);
  const runtimePools = runtimeProviderPoolConfigs(input.runtime_pools, input.runtime_provider, poolConfig);
  const sandboxPool = sandboxPoolConfig(input.sandbox_pool);
  const sandboxPools = sandboxProviderPoolConfigs(input.sandbox_pools, input.sandbox_provider, sandboxPool);
  const primaryRuntimeProvider = primaryProvider(runtimePools, input.runtime_provider);
  const primarySandboxProvider = primaryProvider(sandboxPools, input.sandbox_provider);
  const selectedArtifactProvider = artifactProvider(input);
  const slug = resolveWorkspaceSlug(input.workspace.slug, input.workspace.name, workspaceId);
  const tenantSlug = tenantSlugFromRecord(targetTenant);
  const selectedModelConfigs = workspaceModelConfigsForCreate({ model_config_ids: input.model_config_ids, workspaceId });
  const workspaceConfig = {
    slug,
    tenant_slug: tenantSlug,
    console_url: workspaceConsoleUrl(tenantSlug, slug),
    admin: input.admin ?? {},
    runtime_provider: primaryRuntimeProvider,
    runtime_pools: runtimePools,
    sandbox_provider: primarySandboxProvider,
    sandbox_config: input.sandbox_config ?? {},
    sandbox_pool: sandboxPool,
    sandbox_pools: sandboxPools.map(sandboxPoolRecord),
    ...(selectedArtifactProvider ? { artifact_provider: selectedArtifactProvider } : {}),
    object_storage: { ...(input.object_storage ?? {}), ...(selectedArtifactProvider ? { provider: selectedArtifactProvider } : {}) },
    runtime_pool: poolConfig,
    model_config_ids: selectedModelConfigs.map((item) => item.id),
    provider_credentials: input.provider_credentials ?? {},
    cloud_provider_identities: cloudProviderIdentities({
      providerCredentials: input.provider_credentials,
      runtimeProvider: primaryRuntimeProvider,
      sandboxProvider: primarySandboxProvider,
      runtimePools,
      sandboxPools,
      artifactProvider: selectedArtifactProvider
    }),
    immutable: true
  };
  const apiKey = workspaceApiKeyMaterial();
  const apiKeyId = `wskey_${nanoid(10)}`;
  const runtimePoolRows = runtimePools.map((pool) => ({
    pool,
    poolId: `rpool_${nanoid(10)}`,
    memberIds: Array.from({ length: pool.desired_size }, () => `rpmem_${nanoid(10)}`)
  }));
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
      primaryRuntimeProvider,
      primarySandboxProvider,
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
      db.prepare("INSERT IGNORE INTO workspace_members (id, workspace_id, user_id, role, created_at) VALUES (?, ?, ?, 'member', ?)").run(
        `wsmem_${nanoid(10)}`,
        workspaceId,
        user.id,
        stamp
      );
    });
    selectedModelConfigs.forEach((item) => insertWorkspaceModelConfigClone(item, { workspaceId, tenantId: String(targetTenant.id), userId: input.user_id, stamp }));
    runtimePoolRows.forEach(({ pool, poolId, memberIds }) => {
      db.prepare(`
        INSERT INTO workspace_runtime_pools
        (id, workspace_id, provider, desired_size, min_instances_per_function, max_instances_per_function, max_concurrency_per_instance, cpu_milli, memory_mb, status, config_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)
      `).run(
        poolId,
        workspaceId,
        pool.provider,
        pool.desired_size,
        pool.min_instances_per_function,
        pool.max_instances_per_function,
        pool.max_concurrency_per_instance,
        pool.cpu_milli,
        pool.memory_mb,
        toJson(runtimePoolInsertConfig(pool)),
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
          pool.provider,
          runtimePoolMemberRegion(pool.provider, input.provider_credentials),
          toJson({ provisioning: true, role: pool.role, priority: pool.priority, pool_name: pool.name }),
          stamp,
          stamp
        );
      });
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
    runtimePoolRows.forEach(({ pool, memberIds }) => {
      void provisionPoolMembersBackground(workspaceId, memberIds.map((memberId, index) => ({ memberId, index })), pool, input.provider_credentials);
    });
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

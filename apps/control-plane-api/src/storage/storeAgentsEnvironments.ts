import { nanoid } from "nanoid";
import type { AgentConfig, JsonRecord } from "../types";
import {
  GLOBAL_SCOPE_ID,
  db,
  fromJson,
  hashConfig,
  normalizeStoredAgentConfig,
  now,
  recordValue,
  toJson
} from "./storeCore";
import { hydrateAgentDeploymentRow, hydrateConfigRow, hydrateSessionRow } from "./storeHydrators";
import { getWorkspace } from "./storeWorkspace";

export function scopeForWorkspace(workspaceId: string | null | undefined): { workspace_id: string; tenant_id: string } {
  if (!workspaceId) return { workspace_id: GLOBAL_SCOPE_ID, tenant_id: GLOBAL_SCOPE_ID };
  const row = db.prepare("SELECT tenant_id FROM workspaces WHERE id = ?").get(workspaceId) as { tenant_id?: unknown } | undefined;
  return { workspace_id: String(workspaceId), tenant_id: row && row.tenant_id != null ? String(row.tenant_id) : GLOBAL_SCOPE_ID };
}

export function scopeForParent(table: "agents" | "sessions" | "vaults" | "memory_stores", parentId: string): { workspace_id: string; tenant_id: string } {
  const row = db.prepare(`SELECT workspace_id, tenant_id FROM ${table} WHERE id = ?`).get(parentId) as { workspace_id?: unknown; tenant_id?: unknown } | undefined;
  return {
    workspace_id: row && row.workspace_id != null ? String(row.workspace_id) : GLOBAL_SCOPE_ID,
    tenant_id: row && row.tenant_id != null ? String(row.tenant_id) : GLOBAL_SCOPE_ID
  };
}

export function createAgent(input: { config: AgentConfig; workspace_id?: string | null }) {
  const config = normalizeStoredAgentConfig(input.config);
  const stamp = now();
  const id = `agent_${nanoid(10)}`;
  const versionId = `agentver_${nanoid(10)}`;
  const configHash = hashConfig(config);
  const scope = scopeForWorkspace(input.workspace_id);

  const insertAgent = db.prepare(`
    INSERT INTO agents (id, name, description, current_version, workspace_id, tenant_id, created_at, updated_at)
    VALUES (?, ?, ?, 1, ?, ?, ?, ?)
  `);
  const insertVersion = db.prepare(`
    INSERT INTO agent_versions (id, agent_id, version, config_json, config_hash, workspace_id, tenant_id, created_at)
    VALUES (?, ?, 1, ?, ?, ?, ?, ?)
  `);

  const tx = db.transaction(() => {
    insertAgent.run(id, config.name, config.description, scope.workspace_id, scope.tenant_id, stamp, stamp);
    insertVersion.run(versionId, id, toJson(config), configHash, scope.workspace_id, scope.tenant_id, stamp);
  });
  tx();
  return getAgent(id);
}

export function updateAgent(agentId: string, patch: Partial<AgentConfig>) {
  const current = getAgent(agentId);
  if (!current) return null;
  const nextVersion = current.current_version + 1;
  const nextConfig = normalizeStoredAgentConfig({ ...current.config, ...patch } as AgentConfig);
  const stamp = now();
  const versionId = `agentver_${nanoid(10)}`;
  // read scope outside the transaction: the MySQL sync adapter forbids reads inside db.transaction
  const versionScope = scopeForParent("agents", agentId);

  const tx = db.transaction(() => {
    db.prepare("UPDATE agents SET name = ?, description = ?, current_version = ?, updated_at = ? WHERE id = ?").run(
      nextConfig.name,
      nextConfig.description,
      nextVersion,
      stamp,
      agentId
    );
    db.prepare(`
      INSERT INTO agent_versions (id, agent_id, version, config_json, config_hash, workspace_id, tenant_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(versionId, agentId, nextVersion, toJson(nextConfig), hashConfig(nextConfig), versionScope.workspace_id, versionScope.tenant_id, stamp);
  });
  tx();
  return getAgent(agentId);
}

export function listAgents(workspaceId?: string | null) {
  const sql = `
    SELECT a.*, v.config_json, v.config_hash
    FROM agents a
    JOIN agent_versions v ON v.agent_id = a.id AND v.version = a.current_version
    WHERE a.archived_at IS NULL
    ${workspaceId ? "AND a.workspace_id = ?" : ""}
    ORDER BY a.updated_at DESC
  `;
  const rows = (workspaceId ? db.prepare(sql).all(workspaceId) : db.prepare(sql).all()) as JsonRecord[];
  return rows.map((row) => ({
    ...row,
    config: normalizeStoredAgentConfig(fromJson<AgentConfig>(String(row.config_json), {} as AgentConfig)),
    config_hash: row.config_hash
  }));
}

export function getAgent(agentId: string) {
  const agent = db.prepare("SELECT * FROM agents WHERE id = ?").get(agentId) as JsonRecord | undefined;
  if (!agent) return null;
  const version = db
    .prepare("SELECT * FROM agent_versions WHERE agent_id = ? AND version = ?")
    .get(agentId, agent.current_version) as JsonRecord;
  return {
    ...agent,
    config: normalizeStoredAgentConfig(fromJson<AgentConfig>(String(version.config_json), {} as AgentConfig)),
    config_hash: version.config_hash
  } as JsonRecord & { id: string; name: string; current_version: number; config: AgentConfig; config_hash: string };
}

export function listAgentVersions(agentId: string) {
  return db
    .prepare("SELECT id, agent_id, version, config_json, config_hash, created_at FROM agent_versions WHERE agent_id = ? ORDER BY version DESC")
    .all(agentId)
    .map((row) => {
      const item = row as JsonRecord;
      return { ...item, config: normalizeStoredAgentConfig(fromJson<AgentConfig>(String(item.config_json), {} as AgentConfig)) };
    });
}

export function createEnvironment(input: { name: string; config: JsonRecord; workspace_id?: string | null }) {
  const stamp = now();
  const id = `env_${nanoid(10)}`;
  const scope = scopeForWorkspace(input.workspace_id);
  db.prepare(`
    INSERT INTO environments (id, name, config_json, workspace_id, tenant_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, input.name, toJson(input.config), scope.workspace_id, scope.tenant_id, stamp, stamp);
  return getEnvironment(id);
}

export function getEnvironmentDeletePreview(environmentId: string) {
  const environment = getEnvironment(environmentId) as JsonRecord | null;
  if (!environment) return null;
  const relatedSessions = (db
    .prepare("SELECT * FROM sessions WHERE environment_id = ? ORDER BY updated_at DESC")
    .all(environmentId) as JsonRecord[]).map((row) => hydrateSessionRow(row) as JsonRecord);
  const relatedDeployments = (db
    .prepare("SELECT * FROM agent_deployments WHERE environment_id = ? ORDER BY updated_at DESC")
    .all(environmentId) as JsonRecord[]).map((row) => hydrateAgentDeploymentRow(row) as JsonRecord);
  const agentIds = Array.from(
    new Set(
      [
        ...relatedSessions.map((session) => String(session.agent_id || "")),
        ...relatedDeployments.map((deployment) => String(deployment.agent_id || ""))
      ].filter(Boolean)
    )
  );
  const relatedAgents = agentIds.map((agentId) => getAgent(agentId)).filter(Boolean);
  return {
    environment,
    related_agents: relatedAgents,
    related_sessions: relatedSessions,
    related_deployments: relatedDeployments,
    can_delete_without_force: relatedAgents.length === 0 && relatedSessions.length === 0 && relatedDeployments.length === 0
  };
}

export function archiveEnvironment(id: string, userId?: string | null) {
  const current = getEnvironment(id) as JsonRecord | null;
  if (!current) return null;
  const stamp = now();
  db.prepare("UPDATE environments SET archived_at = ?, deleted_at = ?, deleted_by_user_id = ?, updated_at = ? WHERE id = ?").run(
    stamp,
    stamp,
    userId ?? null,
    stamp,
    id
  );
  return getEnvironment(id);
}

export function ensureDefaultEnvironments(workspaceId: string) {
  const environments = listEnvironments(workspaceId);
  const workspace = getWorkspace(workspaceId) as JsonRecord | null;
  const workspaceConfig = recordValue(workspace?.config);
  const sandboxProvider = String(workspace?.sandbox_provider || workspaceConfig.sandbox_provider || "e2b");
  const sandboxConfig = recordValue(workspaceConfig.sandbox_config);
  const hasSelectedSandbox = environments.some((environment) => {
    const config = recordValue((environment as JsonRecord).config);
    return config.type === sandboxProvider || recordValue(config.sandbox).provider === sandboxProvider;
  });
  if (hasSelectedSandbox) return;
  if (sandboxProvider === "vefaas") {
    const vefaas = recordValue(sandboxConfig.vefaas ?? sandboxConfig.vefaas_sandbox ?? sandboxConfig);
    createEnvironment({
      name: "VeFaaS Cloud Sandbox",
      config: {
        type: "vefaas",
        sandbox: {
          provider: "vefaas",
          vefaas: {
            function_id: String(vefaas.function_id || vefaas.functionId || process.env.VEFAAS_SANDBOX_FUNCTION_ID || process.env.MAPLE_VEFAAS_SANDBOX_FUNCTION_ID || ""),
            endpoint: String(vefaas.endpoint || process.env.VEFAAS_SANDBOX_ENDPOINT || process.env.MAPLE_VEFAAS_SANDBOX_ENDPOINT || "https://open.volcengineapi.com"),
            gateway_url: String(vefaas.gateway_url || vefaas.gatewayUrl || process.env.VEFAAS_SANDBOX_GATEWAY_URL || process.env.MAPLE_VEFAAS_SANDBOX_GATEWAY_URL || ""),
            workspace_path: String(vefaas.workspace_path || process.env.VEFAAS_SANDBOX_WORKSPACE_PATH || process.env.MAPLE_VEFAAS_SANDBOX_WORKSPACE_PATH || "/home/tiger/workspace"),
            timeout_ms: Number(vefaas.timeout_ms || process.env.VEFAAS_SANDBOX_TIMEOUT_MS || process.env.MAPLE_VEFAAS_SANDBOX_TIMEOUT_MS || 3_600_000)
          }
        },
        networking: { mode: "cloud_limited", allow_internet_access: true }
      },
      workspace_id: workspaceId
    });
    return;
  }
  createEnvironment({
    name: "E2B Cloud Sandbox",
    config: {
      type: "e2b",
      sandbox: {
        provider: "e2b",
        e2b: {
          template: process.env.E2B_TEMPLATE || "base",
          workspace_path: process.env.E2B_WORKSPACE_PATH || "/workspace",
          timeout_ms: Number(process.env.E2B_TIMEOUT_MS || 3_600_000)
        }
      },
      networking: { mode: "cloud_limited", allow_internet_access: true }
    },
    workspace_id: workspaceId
  });
}

export function updateEnvironment(id: string, input: { name?: string; config?: JsonRecord; workspace_id?: string | null }) {
  const current = getEnvironment(id) as JsonRecord | null;
  if (!current) return null;
  db.prepare("UPDATE environments SET name = ?, config_json = ?, workspace_id = ?, updated_at = ? WHERE id = ?").run(
    input.name ?? String(current.name || ""),
    toJson(input.config ?? ((current.config as JsonRecord | undefined) || {})),
    input.workspace_id ?? (typeof current.workspace_id === "string" ? current.workspace_id : null),
    now(),
    id
  );
  return getEnvironment(id);
}

export function listEnvironments(workspaceId?: string | null) {
  return ((workspaceId
    ? db.prepare("SELECT * FROM environments WHERE archived_at IS NULL AND workspace_id = ? ORDER BY created_at DESC").all(workspaceId)
    : db.prepare("SELECT * FROM environments WHERE archived_at IS NULL ORDER BY created_at DESC").all()) as JsonRecord[])
    .map(hydrateConfigRow);
}

export function getEnvironment(id: string) {
  const row = db.prepare("SELECT * FROM environments WHERE id = ?").get(id) as JsonRecord | undefined;
  return row ? hydrateConfigRow(row) : null;
}

export function selectRuntimePoolMember(workspaceId: string) {
  return db
    .prepare(
      `SELECT workspace_runtime_pool_members.*, workspace_runtime_pools.id AS runtime_pool_id
       FROM workspace_runtime_pool_members
       JOIN workspace_runtime_pools ON workspace_runtime_pools.id = workspace_runtime_pool_members.runtime_pool_id
       WHERE workspace_runtime_pool_members.workspace_id = ?
         AND workspace_runtime_pool_members.status = 'active'
         AND workspace_runtime_pools.status = 'active'
       ORDER BY workspace_runtime_pool_members.active_session_count ASC,
                workspace_runtime_pool_members.weight DESC,
                workspace_runtime_pool_members.created_at ASC
       LIMIT 1`
    )
    .get(workspaceId) as JsonRecord | undefined;
}

export function runtimePoolMemberAgentRuntime(member: JsonRecord) {
  const config = fromJson<JsonRecord>(String(member.config_json), {});
  return {
    type: "vefaas",
    provider: "vefaas",
    runtime_pool_id: member.runtime_pool_id,
    runtime_pool_member_id: member.id,
    cloud_function_id: member.cloud_function_id,
    function_id: member.cloud_function_id,
    cloud_app_id: member.cloud_app_id,
    invoke_url: member.invoke_url,
    region: member.region,
    workspace_path: String(config.workspace_path || "/workspace"),
    timeout_ms: Number(config.timeout_ms || 120_000),
    envs: fromJson<Record<string, string>>(toJson(config.envs), {})
  };
}

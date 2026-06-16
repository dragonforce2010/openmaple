import type { Request } from "express";
import { normalizeAgentLoop } from "../agentLoops";
import { canAccessSession } from "../artifacts";
import { isHiddenSession, isHiddenSystemEnvironment, isHiddenSystemRecord } from "../builderAgent";
import { bootstrapSession, runUserMessage } from "../runner";
import { mergeToolCallsFromEvents } from "../sessions/toolCallEvents";
import {
  canAccessWorkspace,
  canAdminTenant,
  canAdminWorkspace,
  getAgent,
  getEnvironment,
  getSession,
  getVault,
  getWorkspace,
  listSessionEvents,
  listToolCalls,
  listWorkspaceMembers,
  listWorkspacesForUser,
  workspaceConsoleUrl
} from "../store";
import type { AgentConfig, JsonRecord, SessionEvent } from "../types";

type WorkspaceFallbackUser = {
  id: string;
  metadata?: JsonRecord;
};

export const routeParam = (value: string | string[] | undefined) => (Array.isArray(value) ? value.join("/") : String(value ?? ""));

const POOL_PAGE_SIZE_MAX = 100;
export function poolMemberPageQuery(query: JsonRecord) {
  const rawPage = Number(query.page);
  const rawSize = Number(query.page_size);
  const page = Number.isFinite(rawPage) && rawPage >= 1 ? Math.floor(rawPage) : 1;
  const pageSize = Number.isFinite(rawSize) && rawSize >= 1 ? Math.min(POOL_PAGE_SIZE_MAX, Math.floor(rawSize)) : 20;
  const status = typeof query.status === "string" && query.status ? query.status : undefined;
  return { page, pageSize, status, offset: (page - 1) * pageSize };
}

// member_total drives pagination, so it must reflect the active status filter; member_status_counts
// stays full-pool so the filter chips always show every status's real count.
export function poolMemberTotal(counts: { total: number; by_status: Record<string, number> }, status?: string) {
  return status ? counts.by_status[status] ?? 0 : counts.total;
}
export const maskSecretHint = (value: string) => {
  const trimmed = value.trim();
  if (trimmed.length <= 8) return `${"*".repeat(Math.max(0, trimmed.length - 2))}${trimmed.slice(-2)}`;
  return `${trimmed.slice(0, 3)}...${trimmed.slice(-4)}`;
};
const sessionBootstrapDisabled = () => ["1", "true", "yes"].includes(String(process.env.MAPLE_DISABLE_SESSION_BOOTSTRAP || "").toLowerCase());
export function maybeBootstrapSession(sessionId: string) {
  if (!sessionBootstrapDisabled()) void bootstrapSession(sessionId);
}
export async function maybeRunUserMessage(sessionId: string, text: string) {
  if (!sessionBootstrapDisabled()) await runUserMessage(sessionId, text);
}

export function normalizeAgentConfigBody(body: unknown): AgentConfig {
  const record = asRecord(body);
  const modelRecord = asRecord(record.model);
  const model =
    typeof record.model === "string"
      ? { provider: "custom", id: record.model, speed: "standard" }
      : {
          provider: String(modelRecord.provider || "custom"),
          id: String(modelRecord.id || modelRecord.model || "glm-4-7-251222"),
          speed: typeof modelRecord.speed === "string" ? modelRecord.speed : undefined,
          config_id: typeof modelRecord.config_id === "string" ? modelRecord.config_id : undefined,
          name: typeof modelRecord.name === "string" ? modelRecord.name : undefined
        };
  return {
    name: String(record.name || "Managed Agent"),
    description: String(record.description || record.name || "Managed Agent"),
    model,
    system: String(record.system || "You are a managed agent."),
    tools: Array.isArray(record.tools) ? (record.tools as JsonRecord[]) : [],
    mcp_servers: Array.isArray(record.mcp_servers) ? (record.mcp_servers as JsonRecord[]) : [],
    skills: Array.isArray(record.skills) ? (record.skills as JsonRecord[]) : [],
    agent_loop: normalizeAgentLoop(record.agent_loop),
    multiagent: asOptionalRecord(record.multiagent),
    metadata: asOptionalRecord(record.metadata)
  };
}

export function blankAgentConfigFieldErrors(body: unknown) {
  const record = asRecord(body);
  const fieldErrors: Record<string, string[]> = {};
  for (const key of ["name", "description", "system"]) {
    if (Object.prototype.hasOwnProperty.call(record, key) && typeof record[key] === "string" && !record[key].trim()) {
      fieldErrors[key] = ["Required"];
    }
  }
  if (Object.prototype.hasOwnProperty.call(record, "model")) {
    if (typeof record.model === "string" && !record.model.trim()) fieldErrors.model = ["Required"];
    const model = asRecord(record.model);
    if (Object.prototype.hasOwnProperty.call(model, "id") && typeof model.id === "string" && !model.id.trim()) fieldErrors.model = ["Required"];
  }
  return Object.keys(fieldErrors).length ? { formErrors: [], fieldErrors } : null;
}

export function agentReferenceId(value: unknown) {
  if (typeof value === "string") return value;
  const record = asRecord(value);
  return String(record.id || "");
}

export function asRecord(value: unknown): JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as JsonRecord) : {};
}

export function asOptionalRecord(value: unknown) {
  const record = asRecord(value);
  return Object.keys(record).length > 0 ? record : undefined;
}

export function optionalWorkspaceId(body: unknown) {
  const record = asRecord(body);
  return typeof record.workspace_id === "string" && record.workspace_id.trim() ? record.workspace_id.trim() : null;
}

// every resource must belong to a workspace: workspace keys carry an explicit workspace scope
export function fallbackWorkspaceId(user: string | WorkspaceFallbackUser, requested?: string | null): string | null {
  if (requested) return requested;
  const keyWorkspaceId = workspaceKeyScope(user);
  if (keyWorkspaceId) return keyWorkspaceId;
  const userId = typeof user === "string" ? user : user.id;
  const ws = listWorkspacesForUser(userId)[0] as { id?: string } | undefined;
  return ws?.id ?? null;
}

function workspaceKeyScope(user: string | WorkspaceFallbackUser) {
  if (typeof user === "string") return "";
  const workspaceId = asRecord(user.metadata).workspace_id;
  return typeof workspaceId === "string" && workspaceId.trim() ? workspaceId.trim() : "";
}

export function hasAgentRuntimeEnvironmentConfig(body: unknown) {
  const record = asRecord(body);
  const config = asRecord(record.config);
  return (
    Object.prototype.hasOwnProperty.call(config, "agent_runtime") ||
    Object.prototype.hasOwnProperty.call(config, "agentRuntime") ||
    Object.prototype.hasOwnProperty.call(config, "agent_runtime_provider") ||
    Object.prototype.hasOwnProperty.call(config, "agentRuntimeProvider") ||
    String(config.type || "") === "managed_agent"
  );
}

// workspace-scoped listing: without an explicit workspace_id, a list must be limited to the
// workspaces the user is a member of — never the whole table (that leaked other tenants' resources)
export function accessibleWorkspaceIds(userId: string): Set<string> {
  const allWorkspaces = listWorkspacesForUser(userId);
  const tenantId = tenantIdOf(allWorkspaces[0] ?? null);
  return new Set(sameTenantWorkspaces(allWorkspaces, tenantId).map((workspace) => String((workspace as { id?: unknown }).id)));
}

export function scopeByWorkspace<T>(items: T[], accessible: Set<string>): T[] {
  return items.filter((item) => accessible.has(String((item as { workspace_id?: unknown }).workspace_id)));
}

export function sameTenantWorkspaces<T>(workspaces: T[], tenantId: string): T[] {
  if (!tenantId) return [];
  return workspaces.filter((workspace) => tenantIdOf(workspace) === tenantId);
}

export function tenantIdOf(workspace: unknown) {
  const record = asRecord(workspace);
  return typeof record.tenant_id === "string" && record.tenant_id ? record.tenant_id : "";
}

export function normalizeRouteSlug(value: unknown) {
  const slug = String(value ?? "").trim().toLowerCase();
  return /^[a-z0-9]([a-z0-9-]{1,58}[a-z0-9])?$/.test(slug) ? slug : "";
}

export function tenantSlugOf(tenant: unknown) {
  const record = asRecord(tenant);
  const metadata = asRecord(record.metadata);
  return normalizeRouteSlug(record.slug || metadata.slug || record.name || record.id);
}

export function workspaceSlugOf(workspace: unknown) {
  const config = asRecord(asRecord(workspace).config);
  return normalizeRouteSlug(config.slug);
}

export function accessibleTenantBySlug(tenants: Array<{ slug?: unknown; name?: unknown; id?: unknown; primary_workspace_id?: unknown; metadata?: unknown }>, tenantSlug: string) {
  if (!tenantSlug) return null;
  return tenants.find((tenant) => tenantSlugOf(tenant) === tenantSlug && String(tenant.primary_workspace_id || "")) ?? null;
}

export function firstWorkspaceForTenant<T>(workspaces: T[], tenantId: string) {
  if (!tenantId) return null;
  return workspaces.find((workspace) => tenantIdOf(workspace) === tenantId) ?? null;
}

export function workspaceForTenantRoute<T>(workspaces: T[], tenantId: string, workspaceSlug: string) {
  const tenantWorkspaces = sameTenantWorkspaces(workspaces, tenantId);
  if (!workspaceSlug) return tenantWorkspaces[0] ?? null;
  return tenantWorkspaces.find((workspace) => workspaceSlugOf(workspace) === workspaceSlug) ?? tenantWorkspaces[0] ?? null;
}

export function requestedWorkspaceRoute(request: Request) {
  return {
    tenantSlug: normalizeRouteSlug(request.params.tenantSlug),
    workspaceSlug: normalizeRouteSlug(request.params.workspaceSlug)
  };
}

export function webRedirectUrl(path = "") {
  const base = (process.env.MAPLE_WEB_BASE_URL || "").replace(/\/+$/, "");
  const suffix = path && path.startsWith("/") ? path : "/";
  return `${base || ""}${suffix}`;
}

export function isTenantAdminForWorkspace(userId: string, workspace: unknown) {
  const tenantId = tenantIdOf(workspace);
  return tenantId ? canAdminTenant(userId, tenantId) : false;
}

export function workspaceResponse(workspace: unknown, userId: string) {
  const record = asRecord(workspace);
  const workspaceId = typeof record.id === "string" ? record.id : "";
  const canSeeTenant = isTenantAdminForWorkspace(userId, record) || (workspaceId ? canAdminWorkspace(userId, workspaceId) : false);
  const config = asRecord(record.config);
  const tenantId = String(record.tenant_id || "");
  const slug = typeof config.slug === "string" && config.slug ? config.slug : "";
  const tenantSlug = normalizeRouteSlug(config.tenant_slug || config.slug || tenantId);
  const tenantConfig = slug ? { ...config, tenant_slug: tenantSlug, console_url: workspaceConsoleUrl(tenantSlug, slug) } : config;
  const { tenant_name: _tenantName, console_url: _consoleUrl, admin: _admin, provider_credentials: _providerCredentials, ...memberConfig } = config;
  return {
    ...record,
    tenant_id: canSeeTenant ? tenantId : "",
    config: canSeeTenant ? tenantConfig : memberConfig
  };
}

export function listUsersForWorkspace(workspaceId: string) {
  const workspace = getWorkspace(workspaceId) as JsonRecord | null;
  const workspaceName = String(workspace?.name || workspaceId);
  return (listWorkspaceMembers(workspaceId) as JsonRecord[]).map((member) => {
    const role = String(member.role || "member");
    return {
      id: String(member.user_id || ""),
      email: String(member.email || ""),
      name: String(member.name || ""),
      auth_provider: String(member.auth_provider || "local"),
      role: String(member.user_role || "member"),
      tenant_role: null,
      effective_role: role,
      workspace_ids: [workspaceId],
      workspace_names: [workspaceName],
      workspace_roles: [role],
      workspace_count: 1,
      metadata: {},
      created_at: String(member.created_at || ""),
      updated_at: String(member.created_at || "")
    };
  });
}

export function canAccessScopedRecord(userId: string, record: unknown) {
  const workspaceId = String(asRecord(record).workspace_id || "");
  return workspaceId ? canAccessWorkspace(userId, workspaceId) : false;
}

export function agentResponse(agent: unknown) {
  const record = asRecord(agent);
  const config = asRecord(record.config);
  return {
    type: "agent",
    ...record,
    ...config,
    id: record.id,
    version: record.current_version,
    current_version: record.current_version,
    config
  };
}

export function sessionResponse(session: unknown) {
  const record = asRecord(session);
  return {
    type: "session",
    ...record,
    agent: {
      type: "agent",
      id: record.agent_id,
      version: record.agent_version
    }
  };
}

export function includeSystemRecords(request: Request) {
  return String(request.query.include_system || "") === "1";
}

export function visibleAgents(items: unknown[], includeSystem = false) {
  return includeSystem ? items : items.filter((item) => !isHiddenSystemRecord(item));
}

export function visibleEnvironments(items: unknown[], includeSystem = false) {
  return includeSystem ? items : items.filter((item) => !isHiddenSystemEnvironment(item));
}

export function visibleSessions(items: unknown[], includeSystem = false) {
  return includeSystem ? items : items.filter((item) => !isHiddenSession(item));
}

export function sessionDetailPayload(sessionId: string, options: { summary?: boolean; session?: JsonRecord | null; afterEventId?: string } = {}) {
  const session = options.session ?? getSession(sessionId);
  if (!session) return null;
  const vaultIds = Array.isArray((session.metadata as Record<string, unknown>).vault_ids)
    ? ((session.metadata as Record<string, unknown>).vault_ids as string[])
    : [];
  const after = options.afterEventId?.trim() || "";
  const events = (options.summary ? [] : listSessionEvents(sessionId, after || undefined)) as SessionEvent[];
  // Incremental polling ("append") only needs the session row + new events. agent / environment
  // / vaults / tool_calls don't change within a session and the client already holds them from
  // the initial full load (mergeDetail keeps them), so skip those queries — they were most of
  // the per-poll MySQL round-trips behind the session-detail latency.
  if (after) {
    return { session, agent: null, environment: null, vaults: [], events, events_mode: "append" as const, tool_calls: [] };
  }
  return {
    session,
    agent: getAgent(String(session.agent_id)),
    environment: getEnvironment(String(session.environment_id)),
    vaults: vaultIds.map((id) => getVault(id)).filter(Boolean),
    events,
    events_mode: "full" as const,
    tool_calls: options.summary ? [] : mergeToolCallsFromEvents(sessionId, listToolCalls(sessionId) as JsonRecord[], events)
  };
}

export function canReadSessionRecord(userId: string, session: unknown) {
  if (!canAccessSession(userId, session as JsonRecord)) return false;
  if (!isHiddenSession(session)) return true;
  const owner = asRecord(asRecord(session).metadata).owner_user_id;
  return !owner || owner === userId;
}

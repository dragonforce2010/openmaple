import type { Express, Response } from "express";
import type { AuthenticatedRequest, JsonRecord } from "./routeDeps";
import {
  GLOBAL_SCOPE_ID,
  buildConsoleSnapshot,
  canAdminTenant,
  canAdminWorkspace,
  currentUser,
  ensureGlobalModelConfigs,
  getWorkspace,
  listAgents,
  listEnvironments,
  listGlobalModelConfigs,
  listAgentDeploymentsForWorkspace,
  listLoginTenantsForUser,
  listMemoryStores,
  listModelConfigs,
  listSessions,
  listTenantAdminTenants,
  listUsersForTenant,
  listVaults,
  listWorkspaceApiKeys,
  listWorkspacesForUser,
  removeTenantUserFromTenant
} from "./routeDeps";
import {
  accessibleTenantBySlug,
  listUsersForWorkspace,
  requestedWorkspaceRoute,
  routeParam,
  sameTenantWorkspaces,
  tenantIdOf,
  visibleAgents,
  visibleEnvironments,
  visibleSessions,
  workspaceForTenantRoute,
  workspaceResponse
} from "./routeHelpers";
export function registerBootstrapRoutes(app: Express) {
app.get("/v1/console_snapshot", (request: AuthenticatedRequest, response) => {
  response.json(buildConsoleSnapshot(currentUser(request)));
});

// Aggregated first-paint endpoint: one HTTP round-trip instead of ~9 parallel list calls.
// The MySQL worker serializes queries anyway, so collapsing the fan-out removes per-request
// scheduling overhead and cuts cold first-paint from ~15s to a single in-handler pass.
function appBootstrap(request: AuthenticatedRequest, response: Response) {
  const user = currentUser(request);
  const queryWorkspaceId = typeof request.query.workspace_id === "string" ? request.query.workspace_id : "";
  const { tenantSlug, workspaceSlug } = requestedWorkspaceRoute(request);
  const allWorkspaces = listWorkspacesForUser(user.id) as unknown as Array<{ id: string; tenant_id?: string; config?: JsonRecord }>;
  const tenants = listTenantAdminTenants(user.id);
  const loginTenants = listLoginTenantsForUser(user.id);
  const createdTenantCount = (loginTenants as JsonRecord[]).filter((tenant) => Number(tenant.is_creator) === 1).length;
  const requestedWorkspace = queryWorkspaceId ? allWorkspaces.find((workspace) => workspace.id === queryWorkspaceId) ?? null : null;
  const requestedTenant = requestedWorkspace ? null : accessibleTenantBySlug(loginTenants as JsonRecord[], tenantSlug);
  const requestedTenantWorkspace = requestedTenant ? workspaceForTenantRoute(allWorkspaces, String(requestedTenant.id || ""), workspaceSlug) : null;
  const selectedTenantId = requestedWorkspace ? tenantIdOf(requestedWorkspace) : requestedTenantWorkspace ? tenantIdOf(requestedTenantWorkspace) : tenantIdOf(allWorkspaces[0] ?? null);
  const workspaces = sameTenantWorkspaces(allWorkspaces, selectedTenantId);
  const nextWorkspaceId =
    requestedWorkspace
      ? requestedWorkspace.id
      : requestedTenantWorkspace
        ? requestedTenantWorkspace.id
      : workspaces[0]?.id ?? "";
  const isTenantAdmin = selectedTenantId ? canAdminTenant(user.id, selectedTenantId) : false;
  ensureGlobalModelConfigs();
  const sessions = listSessions() as Array<JsonRecord & { workspace_id?: string | null }>;
  const scopedSessions = nextWorkspaceId
    ? visibleSessions(sessions.filter((session) => session.workspace_id === nextWorkspaceId)) as Array<JsonRecord & { workspace_id?: string | null }>
    : [];
  const canManageSelectedWorkspace = nextWorkspaceId ? canAdminWorkspace(user.id, nextWorkspaceId) : false;
  response.json({
    me: user,
    required: createdTenantCount === 0 && loginTenants.length === 0,
    tenants,
    login_tenants: loginTenants,
    is_tenant_admin: isTenantAdmin,
    can_admin_workspace: canManageSelectedWorkspace,
    workspaces: workspaces.map((workspace) => workspaceResponse(workspace, user.id)),
    selected_workspace_id: nextWorkspaceId,
    users: nextWorkspaceId && canManageSelectedWorkspace ? listUsersForWorkspace(nextWorkspaceId) : [],
    agents: nextWorkspaceId ? visibleAgents(listAgents(nextWorkspaceId)) : [],
    environments: nextWorkspaceId ? visibleEnvironments(listEnvironments(nextWorkspaceId)) : [],
    sessions: scopedSessions,
    deployments: nextWorkspaceId ? listAgentDeploymentsForWorkspace(nextWorkspaceId) : [],
    vaults: nextWorkspaceId ? listVaults(nextWorkspaceId) : [],
    memory_stores: nextWorkspaceId ? listMemoryStores(nextWorkspaceId) : [],
    models: listModelConfigs(nextWorkspaceId || GLOBAL_SCOPE_ID),
    onboarding_models: listGlobalModelConfigs(),
    api_keys: nextWorkspaceId && canManageSelectedWorkspace ? listWorkspaceApiKeys(nextWorkspaceId) : []
  });
}

app.get("/v1/bootstrap/t/:tenantSlug/w/:workspaceSlug", appBootstrap);
app.get("/v1/bootstrap/t/:tenantSlug", appBootstrap);
app.get("/v1/bootstrap", appBootstrap);

app.get("/v1/users", (_request, response) => {
  const request = _request as AuthenticatedRequest;
  const user = currentUser(request);
  const workspaceId = typeof request.query.workspace_id === "string" ? request.query.workspace_id : "";
  if (workspaceId) {
    const workspace = getWorkspace(workspaceId);
    if (!workspace) return response.status(404).json({ error: "workspace_not_found" });
    if (!canAdminWorkspace(user.id, workspaceId)) return response.status(403).json({ error: "workspace_admin_required" });
    return response.json({ data: listUsersForWorkspace(workspaceId) });
  }
  const tenant = (listTenantAdminTenants(user.id) as JsonRecord[])[0];
  if (!tenant) return response.status(403).json({ error: "tenant_admin_required" });
  response.json({ data: listUsersForTenant(String(tenant.id)) });
});

app.delete("/v1/tenants/:tenantId/users/:userId", (request: AuthenticatedRequest, response) => {
  const tenantId = routeParam(request.params.tenantId);
  const userId = routeParam(request.params.userId);
  if (!canAdminTenant(currentUser(request).id, tenantId)) return response.status(403).json({ error: "tenant_admin_required" });
  const result = removeTenantUserFromTenant(tenantId, userId);
  if (!result.removed) return response.status(400).json({ error: "reason" in result ? result.reason : "tenant_user_not_removed" });
  response.json({ ok: true });
});
}

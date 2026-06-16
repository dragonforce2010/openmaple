import type { Express } from "express";
import type { AuthenticatedRequest } from "./routeDeps";
import {
  addTenantAdminByEmail,
  addTenantMemberByEmail,
  canAdminTenant,
  createTenantApiKey,
  currentUser,
  deleteTenantApiKey,
  listTenantApiKeys,
  listUsersForTenant,
  removeTenantAdmin,
  removeTenantMember,
  tenantApiKeySchema,
  updateTenantApiKey,
  workspaceAdminSchema,
  z
} from "./routeDeps";
import { routeParam } from "./routeHelpers";

export function registerTenantRoutes(app: Express) {
  app.get("/v1/tenants/:tenantId/members", (request: AuthenticatedRequest, response) => {
    const tenantId = routeParam(request.params.tenantId);
    if (!canAdminTenant(currentUser(request).id, tenantId)) return response.status(403).json({ error: "tenant_admin_required" });
    response.json({ data: listUsersForTenant(tenantId) });
  });

  app.post("/v1/tenants/:tenantId/members", (request: AuthenticatedRequest, response) => {
    const tenantId = routeParam(request.params.tenantId);
    if (!canAdminTenant(currentUser(request).id, tenantId)) return response.status(403).json({ error: "tenant_admin_required" });
    const parsed = workspaceAdminSchema.safeParse(request.body);
    if (!parsed.success) return response.status(400).json(parsed.error.flatten());
    response.status(201).json(addTenantMemberByEmail(tenantId, parsed.data.email));
  });

  app.delete("/v1/tenants/:tenantId/members/:userId", (request: AuthenticatedRequest, response) => {
    const tenantId = routeParam(request.params.tenantId);
    if (!canAdminTenant(currentUser(request).id, tenantId)) return response.status(403).json({ error: "tenant_admin_required" });
    const result = removeTenantMember(tenantId, routeParam(request.params.userId));
    if (!result.removed) return response.status(404).json({ error: "tenant_member_not_found" });
    response.json({ ok: true });
  });

  app.post("/v1/tenants/:tenantId/admins", (request: AuthenticatedRequest, response) => {
    const tenantId = routeParam(request.params.tenantId);
    if (!canAdminTenant(currentUser(request).id, tenantId)) return response.status(403).json({ error: "tenant_admin_required" });
    const parsed = workspaceAdminSchema.safeParse(request.body);
    if (!parsed.success) return response.status(400).json(parsed.error.flatten());
    response.status(201).json(addTenantAdminByEmail(tenantId, parsed.data.email));
  });

  app.delete("/v1/tenants/:tenantId/admins/:userId", (request: AuthenticatedRequest, response) => {
    const tenantId = routeParam(request.params.tenantId);
    if (!canAdminTenant(currentUser(request).id, tenantId)) return response.status(403).json({ error: "tenant_admin_required" });
    const result = removeTenantAdmin(tenantId, routeParam(request.params.userId));
    if (!result.removed) return response.status(400).json({ error: "reason" in result ? result.reason : "tenant_admin_not_removed" });
    response.json({ ok: true });
  });

  app.get("/v1/tenants/:tenantId/api_keys", (request: AuthenticatedRequest, response) => {
    const tenantId = routeParam(request.params.tenantId);
    if (!canAdminTenant(currentUser(request).id, tenantId)) return response.status(403).json({ error: "tenant_admin_required" });
    response.json({ data: listTenantApiKeys(tenantId) });
  });

  app.post("/v1/tenants/:tenantId/api_keys", (request: AuthenticatedRequest, response) => {
    const tenantId = routeParam(request.params.tenantId);
    const user = currentUser(request);
    if (!canAdminTenant(user.id, tenantId)) return response.status(403).json({ error: "tenant_admin_required" });
    const parsed = tenantApiKeySchema.safeParse(request.body);
    if (!parsed.success) return response.status(400).json(parsed.error.flatten());
    response.status(201).json(createTenantApiKey({ tenant_id: tenantId, created_by_user_id: user.id, ...parsed.data }));
  });

  app.patch("/v1/tenants/:tenantId/api_keys/:keyId", (request: AuthenticatedRequest, response) => {
    const tenantId = routeParam(request.params.tenantId);
    if (!canAdminTenant(currentUser(request).id, tenantId)) return response.status(403).json({ error: "tenant_admin_required" });
    const parsed = tenantApiKeySchema.partial().extend({ enabled: z.boolean().optional() }).safeParse(request.body);
    if (!parsed.success) return response.status(400).json(parsed.error.flatten());
    const key = updateTenantApiKey(tenantId, routeParam(request.params.keyId), parsed.data);
    if (!key) return response.status(404).json({ error: "tenant_api_key_not_found" });
    response.json(key);
  });

  app.delete("/v1/tenants/:tenantId/api_keys/:keyId", (request: AuthenticatedRequest, response) => {
    const tenantId = routeParam(request.params.tenantId);
    if (!canAdminTenant(currentUser(request).id, tenantId)) return response.status(403).json({ error: "tenant_admin_required" });
    const deleted = deleteTenantApiKey(tenantId, routeParam(request.params.keyId));
    if (!deleted) return response.status(404).json({ error: "tenant_api_key_not_found" });
    response.status(204).send();
  });
}

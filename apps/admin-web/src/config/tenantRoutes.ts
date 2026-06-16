import type { AccessibleTenant } from "./appTypes";

function selectedTenantStorageKey(userId: string) {
  return `maple.selectedTenantId.${userId}`;
}

export function rememberTenantSelection(userId: string, tenantId: string) {
  if (!userId || !tenantId) return;
  try {
    window.localStorage.setItem(selectedTenantStorageKey(userId), tenantId);
  } catch {
  }
}

export function clearRememberedTenant(userId: string) {
  if (!userId) return;
  try {
    window.localStorage.removeItem(selectedTenantStorageKey(userId));
  } catch {
  }
}

export function rememberedAccessibleTenant(userId: string, tenants: AccessibleTenant[]) {
  try {
    const key = selectedTenantStorageKey(userId);
    const tenantId = window.localStorage.getItem(key);
    if (!tenantId) return null;
    const tenant = tenants.find((item) => item.id === tenantId && item.primary_workspace_id);
    if (!tenant) window.localStorage.removeItem(key);
    return tenant ?? null;
  } catch {
    return null;
  }
}

export type WorkspaceRoute = { tenantSlug: string; workspaceSlug: string };

function normalizeRouteSlug(value: unknown) {
  try {
    const slug = decodeURIComponent(String(value ?? "")).trim().toLowerCase();
    return /^[a-z0-9]([a-z0-9-]{1,58}[a-z0-9])?$/.test(slug) ? slug : "";
  } catch {
    return "";
  }
}

export function requestedWorkspaceRouteFromLocation(): WorkspaceRoute {
  const match = window.location.pathname.match(/^\/t\/([^/]+)(?:\/w\/([^/]+))?(?:\/|$)/);
  return {
    tenantSlug: normalizeRouteSlug(match?.[1] ?? ""),
    workspaceSlug: normalizeRouteSlug(match?.[2] ?? "")
  };
}

export function tenantRouteSlug(tenant: AccessibleTenant) {
  return normalizeRouteSlug(tenant.slug || tenant.name || tenant.id);
}

export function authBootstrapPath(route: WorkspaceRoute) {
  if (!route.tenantSlug) return "/v1/auth/bootstrap";
  const tenant = encodeURIComponent(route.tenantSlug);
  return `/v1/auth/bootstrap/t/${tenant}${route.workspaceSlug ? `/w/${encodeURIComponent(route.workspaceSlug)}` : ""}`;
}

export function oauthStartPath(provider: string, route: WorkspaceRoute) {
  if (!route.tenantSlug) return `/v1/auth/oauth/${provider}/start`;
  const tenant = encodeURIComponent(route.tenantSlug);
  return `/v1/auth/oauth/${provider}/start/t/${tenant}${route.workspaceSlug ? `/w/${encodeURIComponent(route.workspaceSlug)}` : ""}`;
}

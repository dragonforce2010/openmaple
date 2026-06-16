import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { useEffect, useRef, useState } from "react";
import { apiGet, type ApiList } from "../api";
import {
  authBootstrapPath,
  consoleRouteFromLocation,
  rememberedAccessibleTenant,
  rememberTenantSelection,
  requestedWorkspaceRouteFromLocation,
  TENANT_ADMIN_ONLY_VIEWS,
  tenantRouteSlug,
  WORKSPACE_ADMIN_ONLY_VIEWS,
  type AccessibleTenant,
  type View
} from "../appConfig";
import { errorMessage } from "../components/shared/misc";
import type {
  Agent,
  AgentDeployment,
  AuthProvider,
  Environment,
  MemoryStore,
  ModelConfig,
  Session,
  SessionDetail,
  User,
  Vault,
  Workspace,
  WorkspaceApiKey
} from "../types";
import type { ToastType } from "../ui";

type Toast = (message: string, kind?: ToastType) => void;

export function useBootstrapController(input: {
  toast: Toast;
  view: View;
  currentUser: User | null;
  selectedWorkspaceId: string;
  selectedSession: string;
  onboardingRequired: boolean;
  loadedWorkspaceIdRef: MutableRefObject<string>;
  setAuthChecked: Dispatch<SetStateAction<boolean>>;
  setCurrentUser: Dispatch<SetStateAction<User | null>>;
  setAuthProviders: Dispatch<SetStateAction<AuthProvider[]>>;
  setIsTenantAdmin: Dispatch<SetStateAction<boolean>>;
  setCanAdminWorkspace: Dispatch<SetStateAction<boolean>>;
  setAccessibleTenants: Dispatch<SetStateAction<AccessibleTenant[]>>;
  setWorkspaces: Dispatch<SetStateAction<Workspace[]>>;
  setOnboardingRequired: Dispatch<SetStateAction<boolean>>;
  setView: Dispatch<SetStateAction<View>>;
  setRouteId: Dispatch<SetStateAction<string>>;
  setRouteEdit: Dispatch<SetStateAction<boolean>>;
  setSelectedWorkspaceId: Dispatch<SetStateAction<string>>;
  setUsers: Dispatch<SetStateAction<User[]>>;
  setAgents: Dispatch<SetStateAction<Agent[]>>;
  setEnvironments: Dispatch<SetStateAction<Environment[]>>;
  setSessions: Dispatch<SetStateAction<Session[]>>;
  setDeployments: Dispatch<SetStateAction<AgentDeployment[]>>;
  setVaults: Dispatch<SetStateAction<Vault[]>>;
  setMemoryStores: Dispatch<SetStateAction<MemoryStore[]>>;
  setModelConfigs: Dispatch<SetStateAction<ModelConfig[]>>;
  setOnboardingModelConfigs: Dispatch<SetStateAction<ModelConfig[]>>;
  setWorkspaceKeys: Dispatch<SetStateAction<WorkspaceApiKey[]>>;
  setSelectedSession: Dispatch<SetStateAction<string>>;
  setSelectedEventId: Dispatch<SetStateAction<string>>;
  setSessionDetail: Dispatch<SetStateAction<SessionDetail | null>>;
  setUserMenuOpen: Dispatch<SetStateAction<boolean>>;
  setSwitchingTenant: Dispatch<SetStateAction<AccessibleTenant | null>>;
  setError: Dispatch<SetStateAction<string>>;
}) {
  const [switchingWorkspace, setSwitchingWorkspace] = useState<Workspace | null>(null);
  const [resourceLoading, setResourceLoading] = useState(false);
  const bootstrapStartedRef = useRef(false);

  async function refresh(workspaceIdOverride?: string) {
    input.setError("");
    setResourceLoading(true);
    try {
      const effectiveWorkspaceId = workspaceIdOverride ?? input.selectedWorkspaceId;
      const bootstrapQuery = effectiveWorkspaceId ? `?workspace_id=${encodeURIComponent(effectiveWorkspaceId)}` : "";
      const snapshot = await apiGet<{
        required: boolean;
        is_tenant_admin?: boolean;
        can_admin_workspace?: boolean;
        tenants?: AccessibleTenant[];
        login_tenants?: AccessibleTenant[];
        workspaces: Workspace[];
        selected_workspace_id: string;
        users?: User[];
        agents: Agent[];
        environments: Environment[];
        sessions: Session[];
        deployments?: AgentDeployment[];
        vaults: Vault[];
        memory_stores: MemoryStore[];
        models: ModelConfig[];
        onboarding_models?: ModelConfig[];
        api_keys: WorkspaceApiKey[];
      }>(`/v1/bootstrap${bootstrapQuery}`, { timeoutMs: 30_000 });
      const nextWorkspaceId = snapshot.selected_workspace_id;
      const scopedSessions = nextWorkspaceId ? snapshot.sessions.filter((session) => !session.workspace_id || session.workspace_id === nextWorkspaceId) : snapshot.sessions;
      const nextTenantAdmin = Boolean(snapshot.is_tenant_admin);
      const nextCanAdminWorkspace = Boolean(snapshot.can_admin_workspace);
      input.setIsTenantAdmin(nextTenantAdmin);
      input.setCanAdminWorkspace(nextCanAdminWorkspace);
      input.setAccessibleTenants(snapshot.login_tenants ?? snapshot.tenants ?? []);
      input.setWorkspaces(snapshot.workspaces);
      input.setOnboardingRequired(snapshot.required);
      if (snapshot.required) {
        input.setView("provision");
        input.setRouteId("");
        input.setRouteEdit(false);
      }
      if ((!nextTenantAdmin && TENANT_ADMIN_ONLY_VIEWS.has(input.view)) || (!nextCanAdminWorkspace && WORKSPACE_ADMIN_ONLY_VIEWS.has(input.view))) input.setView("dashboard");
      if (nextWorkspaceId && nextWorkspaceId !== input.selectedWorkspaceId) input.setSelectedWorkspaceId(nextWorkspaceId);
      input.setUsers(snapshot.users ?? []);
      input.setAgents(snapshot.agents);
      input.setEnvironments(snapshot.environments);
      input.setSessions(scopedSessions);
      input.setDeployments(snapshot.deployments ?? []);
      input.setVaults(snapshot.vaults);
      input.setMemoryStores(snapshot.memory_stores);
      input.setModelConfigs(snapshot.models);
      input.setOnboardingModelConfigs(snapshot.onboarding_models ?? snapshot.models);
      input.setWorkspaceKeys(snapshot.api_keys);
      input.loadedWorkspaceIdRef.current = nextWorkspaceId;
      if (!input.selectedSession || !scopedSessions.some((session) => session.id === input.selectedSession)) {
        input.setSelectedSession(input.view === "quickstart" ? "" : scopedSessions[0]?.id ?? "");
        input.setSelectedEventId("");
        input.setSessionDetail(null);
      }
    } finally {
      setResourceLoading(false);
    }
  }

  async function routeAfterAuth() {
    const requestedRoute = requestedWorkspaceRouteFromLocation();
    const boot = await apiGet<{ user: User | null; tenants?: AccessibleTenant[]; recommended_view?: string; selected_tenant_id?: string; selected_workspace_id?: string }>(authBootstrapPath(requestedRoute));
    input.setCurrentUser(boot.user);
    const tenants = boot.tenants ?? [];
    input.setAccessibleTenants(tenants);
    if (!boot.user) return;
    const recommended = boot.recommended_view;
    const requestedTenant = (boot.selected_tenant_id || requestedRoute.tenantSlug)
      ? tenants.find((tenant) => (boot.selected_tenant_id ? tenant.id === boot.selected_tenant_id : tenantRouteSlug(tenant) === requestedRoute.tenantSlug) && tenant.primary_workspace_id)
      : null;
    if (requestedTenant?.primary_workspace_id) {
      rememberTenantSelection(boot.user.id, requestedTenant.id);
      input.setOnboardingRequired(false);
      input.setSelectedWorkspaceId(boot.selected_workspace_id || requestedTenant.primary_workspace_id);
      input.setView("dashboard");
      input.setRouteId("");
      input.setRouteEdit(false);
      await refresh(boot.selected_workspace_id || requestedTenant.primary_workspace_id);
      return;
    }
    const rememberedTenant = rememberedAccessibleTenant(boot.user.id, tenants);
    if (rememberedTenant?.primary_workspace_id) {
      input.setOnboardingRequired(false);
      input.setSelectedWorkspaceId(rememberedTenant.primary_workspace_id);
      input.setView("dashboard");
      input.setRouteId("");
      input.setRouteEdit(false);
      await refresh(rememberedTenant.primary_workspace_id);
      return;
    }
    if (recommended === "onboarding") {
      input.setOnboardingRequired(true);
      input.setView("provision");
      await refresh();
      return;
    }
    if (recommended === "no_access") { input.setView("no_access"); return; }
    if (recommended === "tenant_choice") { input.setView("tenant_choice"); void refresh(); return; }
    if (recommended === "tenant_select") { input.setView("tenant_select"); return; }
    if (recommended === "dashboard") {
      const owned = tenants.filter((tenant) => Number(tenant.is_owner) === 1);
      const tenant = owned[0] ?? tenants[0] ?? null;
      if (tenant) rememberTenantSelection(boot.user.id, tenant.id);
      const primary = tenant?.primary_workspace_id ?? "";
      if (primary) input.setSelectedWorkspaceId(primary);
      await refresh(primary || undefined);
      return;
    }
    await refresh();
  }

  async function enterTenant(tenant: AccessibleTenant) {
    if (input.currentUser) rememberTenantSelection(input.currentUser.id, tenant.id);
    input.setUserMenuOpen(false);
    input.setSwitchingTenant(tenant);
    input.setSelectedWorkspaceId(tenant.primary_workspace_id);
    input.setView("dashboard");
    input.setRouteId("");
    input.setRouteEdit(false);
    try {
      await refresh(tenant.primary_workspace_id);
    } catch (reason) {
      input.setError(errorMessage(reason));
    } finally {
      input.setSwitchingTenant(null);
    }
  }

  function switchWorkspace(workspaceId: string, workspace: Workspace | null) {
    if (workspaceId === input.selectedWorkspaceId) return;
    setSwitchingWorkspace(workspace);
    input.setSelectedWorkspaceId(workspaceId);
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const credentialConnected = params.get("credential_connected");
    const connected = credentialConnected || params.get("mcp_connected");
    const connectedVault = params.get("vault");
    const mcpError = params.get("mcp_error");
    if (!connected && !mcpError) return;
    if (connected) {
      input.toast(`Connected to ${connected}`, "ok");
      const route = consoleRouteFromLocation();
      if (!route.hasConsoleAnchor && credentialConnected) {
        if (connectedVault) {
          input.setRouteId(connectedVault);
          input.setView("vault");
        } else {
          input.setView("vaults");
        }
      }
      void refresh();
    } else if (mcpError) {
      input.toast(`MCP connection failed: ${mcpError}`, "err");
    }
    const url = new URL(window.location.href);
    for (const key of ["credential_connected", "mcp_connected", "mcp_error", "vault", "quickstart_restore"]) url.searchParams.delete(key);
    window.history.replaceState({}, "", `${url.pathname}${url.search}`);
  }, []);

  useEffect(() => {
    if (bootstrapStartedRef.current) return;
    bootstrapStartedRef.current = true;
    (async () => {
      try {
        const providers = await apiGet<ApiList<AuthProvider>>("/v1/auth/providers");
        input.setAuthProviders(providers.data);
        await routeAfterAuth();
      } catch {
        input.setCurrentUser((current) => current ?? null);
      } finally {
        input.setAuthChecked(true);
      }
    })();
  }, []);

  useEffect(() => {
    if (!input.currentUser || input.onboardingRequired || !input.selectedWorkspaceId) return;
    if (input.loadedWorkspaceIdRef.current === input.selectedWorkspaceId) {
      setSwitchingWorkspace(null);
      return;
    }
    refresh(input.selectedWorkspaceId)
      .catch((reason: unknown) => input.setError(errorMessage(reason)))
      .finally(() => setSwitchingWorkspace(null));
  }, [input.selectedWorkspaceId]);

  return { refresh, routeAfterAuth, enterTenant, switchWorkspace, switchingWorkspace, resourceLoading };
}

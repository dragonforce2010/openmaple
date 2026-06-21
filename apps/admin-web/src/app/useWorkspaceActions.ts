import type { Dispatch, SetStateAction } from "react";
import { apiDelete, apiPatch, apiPost, apiPut } from "../api";
import {
  clearRememberedTenant,
  rememberTenantSelection,
  type AccessibleTenant,
  type Modal,
  type OnboardingCustomModelConfig,
  type View
} from "../appConfig";
import { errorMessage } from "../components/shared/misc";
import type { MemoryStore, Session, SessionDetail, User, Workspace, WorkspaceApiKey } from "../types";
import type { ToastType } from "../ui";

type L = (zh: string, en: string) => string;
type Toast = (message: string, kind?: ToastType) => void;
type Confirm = (input: { title: string; body: string; confirmLabel: string; cancelLabel: string; danger?: boolean }) => Promise<boolean>;

export function useWorkspaceActions(input: {
  L: L;
  toast: Toast;
  confirm: Confirm;
  currentUser: User | null;
  selectedWorkspaceId: string;
  selectedWorkspace: Workspace | null;
  tenantWorkspaces: Workspace[];
  workspaceKeys: WorkspaceApiKey[];
  sessions: Session[];
  selectedSession: string;
  memoryStores: MemoryStore[];
  refresh: (workspaceIdOverride?: string) => Promise<void>;
  resetQuickstartState: () => void;
  setCurrentUser: Dispatch<SetStateAction<User | null>>;
  setIsTenantAdmin: Dispatch<SetStateAction<boolean>>;
  setAccessibleTenants: Dispatch<SetStateAction<AccessibleTenant[]>>;
  setSelectedSession: Dispatch<SetStateAction<string>>;
  setSelectedEventId: Dispatch<SetStateAction<string>>;
  setSessionDetail: Dispatch<SetStateAction<SessionDetail | null>>;
  setSessions: Dispatch<SetStateAction<Session[]>>;
  setWorkspaces: Dispatch<SetStateAction<Workspace[]>>;
  setSelectedWorkspaceId: Dispatch<SetStateAction<string>>;
  setOnboardingRequired: Dispatch<SetStateAction<boolean>>;
  setIssuedWorkspaceKey: Dispatch<SetStateAction<string>>;
  setIssuedWorkspaceApiKey: Dispatch<SetStateAction<string>>;
  setView: Dispatch<SetStateAction<View>>;
  setRouteId: Dispatch<SetStateAction<string>>;
  setRouteEdit: Dispatch<SetStateAction<boolean>>;
  setModal: Dispatch<SetStateAction<Modal>>;
  setWorkspacePickerOpen: Dispatch<SetStateAction<boolean>>;
  setError: Dispatch<SetStateAction<string>>;
}) {
  async function seedMemory() {
    const store = input.memoryStores[0];
    if (!store) return;
    await apiPut(`/v1/memory_stores/${store.id}/memories/projects/managed-agents-platform.md`, {
      actor: "user",
      content: "# Project conventions\n\n- Keep implementation API-first.\n- Session events are append-only.\n- Runtime work must be backed by real Docker containers and persisted events."
    });
    await input.refresh();
  }

  async function logout() {
    if (input.currentUser) clearRememberedTenant(input.currentUser.id);
    await apiPost("/v1/auth/logout");
    input.setCurrentUser(null);
    input.setIsTenantAdmin(false);
    input.setAccessibleTenants([]);
    input.setSelectedSession("");
    input.setSessionDetail(null);
    input.setWorkspaces([]);
    input.setSelectedWorkspaceId("");
    input.setOnboardingRequired(false);
    input.setIssuedWorkspaceKey("");
    input.setIssuedWorkspaceApiKey("");
  }

  async function completeOnboarding(onboarding: {
    tenantName: string;
    tenantDescription: string;
    workspaceName: string;
    workspaceDescription: string;
    workspaceSlug: string;
    desiredSize: number;
    minInstances: number;
    maxInstances: number;
    maxConcurrency: number;
    cpuMilli: number;
    memoryMb: number;
    modelConfigIds: string[];
    customModelConfigs: OnboardingCustomModelConfig[];
    apiKeyName: string;
    runtimeProvider: "local_docker" | "vefaas";
    vefaasAccessKey: string;
    vefaasSecretKey: string;
    vefaasRegion: string;
    sandboxProvider: "local_docker" | "e2b" | "vefaas";
    e2bApiKey: string;
    vefaasSandboxFunctionId: string;
    vefaasSandboxGatewayUrl: string;
    vefaasSandboxTimeoutMs: number;
    sandboxPoolSize: number;
  }) {
    const result = await apiPost<{ workspace: Workspace; api_key: WorkspaceApiKey }>("/v1/workspace_onboarding", {
      tenant: { name: onboarding.tenantName, description: onboarding.tenantDescription },
      workspace: { name: onboarding.workspaceName, description: onboarding.workspaceDescription, slug: onboarding.workspaceSlug || undefined },
      runtime_provider: onboarding.runtimeProvider,
      runtime_pool: {
        desired_size: onboarding.desiredSize,
        min_instances_per_function: onboarding.minInstances,
        max_instances_per_function: onboarding.maxInstances,
        max_concurrency_per_instance: onboarding.maxConcurrency,
        cpu_milli: onboarding.cpuMilli,
        memory_mb: onboarding.memoryMb
      },
      sandbox_provider: onboarding.sandboxProvider,
      sandbox_config: onboarding.sandboxProvider === "vefaas"
        ? { vefaas: { function_id: onboarding.vefaasSandboxFunctionId, gateway_url: onboarding.vefaasSandboxGatewayUrl, timeout_ms: onboarding.vefaasSandboxTimeoutMs, workspace_path: "/home/tiger/workspace" } }
        : onboarding.sandboxProvider === "local_docker"
          ? { local_docker: { image: "node:22-bookworm", networking: { mode: "limited", allow_mcp_servers: true, allow_package_managers: true } } }
        : {},
      sandbox_pool: { desired_size: onboarding.sandboxPoolSize, standby_ttl_ms: 30 * 60 * 1000 },
      model_config_ids: onboarding.modelConfigIds,
      custom_model_configs: onboarding.customModelConfigs.map(({ local_id: _localId, ...config }) => config),
      api_key: { display_name: onboarding.apiKeyName, scopes: ["control_plane", "data_plane"] },
      admin: { email: input.currentUser?.email, name: input.currentUser?.name },
      provider_credentials: {
        vefaas: onboarding.runtimeProvider === "vefaas" ? { VOLCENGINE_ACCESS_KEY: onboarding.vefaasAccessKey, VOLCENGINE_SECRET_KEY: onboarding.vefaasSecretKey, VEFAAS_REGION: onboarding.vefaasRegion } : {},
        e2b: onboarding.sandboxProvider === "e2b" ? { E2B_API_KEY: onboarding.e2bApiKey } : {}
      }
    });
    const issuedKey = result.api_key.key ?? "";
    input.setIssuedWorkspaceKey(issuedKey);
    input.setIssuedWorkspaceApiKey(issuedKey);
    input.toast(input.L("Workspace API key 已创建", "Workspace API key issued"), "ok");
    input.setSelectedWorkspaceId(result.workspace.id);
    if (input.currentUser && result.workspace.tenant_id) rememberTenantSelection(input.currentUser.id, result.workspace.tenant_id);
    input.setWorkspaces([result.workspace]);
    input.setOnboardingRequired(false);
    input.setView("api_keys");
    input.setRouteId("");
    input.setRouteEdit(false);
    input.setModal(null);
    input.resetQuickstartState();
    input.setWorkspacePickerOpen(false);
    try {
      await input.refresh(result.workspace.id);
    } catch (reason) {
      input.setError(errorMessage(reason));
    }
  }

  async function createWorkspaceApiKey(displayName = `Workspace integration ${input.workspaceKeys.length + 1}`) {
    const workspaceId = input.selectedWorkspaceId || input.selectedWorkspace?.id || "";
    if (!workspaceId) throw new Error(input.L("没有可用的工作区。", "No workspace is selected."));
    const trimmedName = displayName.trim();
    if (!trimmedName) return;
    const key = await apiPost<WorkspaceApiKey>(`/v1/workspaces/${workspaceId}/api_keys`, {
      display_name: trimmedName,
      scopes: ["control_plane", "data_plane"]
    });
    input.setIssuedWorkspaceApiKey(key.key ?? "");
    input.toast(input.L("Workspace API key 已创建", "Workspace API key issued"), "ok");
    input.setView("api_keys");
    void input.refresh(workspaceId).catch((reason) => input.setError(errorMessage(reason)));
  }

  async function renameWorkspaceApiKey(key: WorkspaceApiKey, displayName: string) {
    const nextName = displayName.trim();
    if (!nextName || !input.selectedWorkspaceId) return;
    await apiPatch(`/v1/workspaces/${input.selectedWorkspaceId}/api_keys/${key.id}`, { display_name: nextName });
    await input.refresh(input.selectedWorkspaceId);
    input.toast(input.L("已重命名", "Renamed"));
  }

  async function toggleWorkspaceApiKey(key: WorkspaceApiKey) {
    if (!input.selectedWorkspaceId) return;
    await apiPatch(`/v1/workspaces/${input.selectedWorkspaceId}/api_keys/${key.id}`, { enabled: !key.enabled });
    await input.refresh(input.selectedWorkspaceId);
    input.toast(key.enabled ? input.L("已停用", "Disabled") : input.L("已启用", "Enabled"));
  }

  async function deleteWorkspaceApiKeyRecord(key: WorkspaceApiKey) {
    if (!input.selectedWorkspaceId) return;
    const ok = await input.confirm({
      title: input.L("删除 API Key", "Delete API key"),
      body: input.L(`确定删除「${key.display_name}」？此操作不可撤销，使用该 Key 的集成将立即失效。`, `Delete "${key.display_name}"? This cannot be undone and integrations using this key stop working immediately.`),
      confirmLabel: input.L("删除", "Delete"),
      cancelLabel: input.L("取消", "Cancel"),
      danger: true
    });
    if (!ok) return;
    await apiDelete(`/v1/workspaces/${input.selectedWorkspaceId}/api_keys/${key.id}`);
    await input.refresh(input.selectedWorkspaceId);
    input.toast(input.L("已删除", "Deleted"));
  }

  async function deleteSessionRecord(session: Session) {
    const ok = await input.confirm({
      title: input.L("删除 Session", "Delete session"),
      body: input.L(`确定删除「${session.title}」？该 Session 会停止并从默认列表隐藏。`, `Delete "${session.title}"? This session will stop and be hidden from the default list.`),
      confirmLabel: input.L("删除", "Delete"),
      cancelLabel: input.L("取消", "Cancel"),
      danger: true
    });
    if (!ok) return;
    try {
      await apiDelete(`/v1/sessions/${session.id}`);
      input.setSessions((current) => current.filter((item) => item.id !== session.id));
      if (input.selectedSession === session.id) {
        const next = input.sessions.find((item) => item.id !== session.id) ?? null;
        input.setSelectedSession(next?.id ?? "");
        input.setSelectedEventId("");
        input.setSessionDetail(null);
      }
      await input.refresh(input.selectedWorkspaceId);
      input.toast(input.L("Session 已删除", "Session deleted"), "ok");
    } catch (reason) {
      input.setError(errorMessage(reason));
    }
  }

  async function deleteWorkspaceRecord(workspace: Workspace) {
    const slug = String(workspace.config?.slug ?? workspace.id);
    const ok = await input.confirm({
      title: input.L("删除工作区", "Delete workspace"),
      body: input.L(
        `确定删除「${workspace.name}」？工作区下的 Agent、Session、环境、凭证、记忆库、模型、API Key 与成员关系都会被级联删除。`,
        `Delete "${workspace.name}"? Agents, sessions, environments, vaults, memories, models, API keys, and memberships in this workspace will be deleted.`
      ),
      confirmLabel: input.L("删除工作区", "Delete workspace"),
      cancelLabel: input.L("取消", "Cancel"),
      danger: true
    });
    if (!ok) return;
    try {
      await apiDelete(`/v1/workspaces/${workspace.id}`);
      const deletingSelected = input.selectedWorkspaceId === workspace.id;
      const nextWorkspace = deletingSelected ? input.tenantWorkspaces.find((item) => item.id !== workspace.id) ?? null : input.selectedWorkspace;
      input.setWorkspaces((current) => current.filter((item) => item.id !== workspace.id));
      if (deletingSelected) input.setSelectedWorkspaceId(nextWorkspace?.id ?? "");
      await input.refresh(nextWorkspace?.id || undefined);
      input.toast(input.L(`已删除工作区 ${slug}`, `Workspace ${slug} deleted`), "ok");
    } catch (reason) {
      input.setError(errorMessage(reason));
    }
  }

  async function removeWorkspaceUser(user: User) {
    if (!input.selectedWorkspaceId) return;
    const ok = await input.confirm({
      title: input.L("移除用户", "Remove user"),
      body: input.L(`确定将 ${user.email} 从当前工作区移除？`, `Remove ${user.email} from this workspace?`),
      confirmLabel: input.L("移除", "Remove"),
      cancelLabel: input.L("取消", "Cancel"),
      danger: true
    });
    if (!ok) return;
    try {
      await apiDelete(`/v1/workspaces/${input.selectedWorkspaceId}/members/${user.id}`);
      await input.refresh(input.selectedWorkspaceId);
      input.toast(input.L("用户已移除", "User removed"), "ok");
    } catch (reason) {
      input.setError(errorMessage(reason));
    }
  }

  return {
    seedMemory,
    logout,
    completeOnboarding,
    createWorkspaceApiKey,
    renameWorkspaceApiKey,
    toggleWorkspaceApiKey,
    deleteWorkspaceApiKeyRecord,
    deleteSessionRecord,
    deleteWorkspaceRecord,
    removeWorkspaceUser
  };
}

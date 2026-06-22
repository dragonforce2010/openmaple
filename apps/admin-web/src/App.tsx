import { useCallback, useMemo, useRef, useState } from "react";
import { apiGet, apiPost, type ApiList } from "./api";
import { useBootstrapController } from "./app/useBootstrapController";
import { useConsoleShortcuts } from "./app/useConsoleShortcuts";
import { useQuickstartController } from "./app/useQuickstartController";
import { useSelectedSessionDetail } from "./app/useSelectedSessionDetail";
import { useWorkspaceActions } from "./app/useWorkspaceActions";
import { translations, type AccessibleTenant, type EntityKind, type EntityNavValue, type Language, type Modal, type View, type WizardStep } from "./appConfig";
import { AppFrame } from "./AppFrame";
import { toYamlPreview } from "./components/shared/code";
import { errorMessage } from "./components/shared/misc";
import { EntityDetailBody } from "./pages/agents/AgentViews";
import type { Agent, AgentConfig, AgentDeployment, AgentLoopType, AuthProvider, Environment, MemoryStore, ModelConfig, Session, SessionDetail, SessionEvent, User, Vault, Workspace, WorkspaceApiKey } from "./types";
import { useConfirm, useDrawerStack, useToast } from "./ui";

export function App() {
  const [view, setView] = useState<View>("dashboard");
  const [authChecked, setAuthChecked] = useState(false);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [authProviders, setAuthProviders] = useState<AuthProvider[]>([]);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [onboardingRequired, setOnboardingRequired] = useState(false);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState("");
  const [sessionAgentLock, setSessionAgentLock] = useState(""); // when set, the session modal is opened from an agent detail and locks to that agent
  const [accessibleTenants, setAccessibleTenants] = useState<AccessibleTenant[]>([]);
  const [switchingTenant, setSwitchingTenant] = useState<AccessibleTenant | null>(null);
  const [isTenantAdmin, setIsTenantAdmin] = useState(false);
  const [canAdminWorkspace, setCanAdminWorkspace] = useState(false);
  const [issuedWorkspaceKey, setIssuedWorkspaceKey] = useState("");
  const [users, setUsers] = useState<User[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [environments, setEnvironments] = useState<Environment[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [deployments, setDeployments] = useState<AgentDeployment[]>([]);
  const [vaults, setVaults] = useState<Vault[]>([]);
  const [memoryStores, setMemoryStores] = useState<MemoryStore[]>([]);
  const [modelConfigs, setModelConfigs] = useState<ModelConfig[]>([]);
  const [onboardingModelConfigs, setOnboardingModelConfigs] = useState<ModelConfig[]>([]);
  const [workspaceKeys, setWorkspaceKeys] = useState<WorkspaceApiKey[]>([]);
  const [issuedWorkspaceApiKey, setIssuedWorkspaceApiKey] = useState("");
  const [draftPrompt, setDraftPrompt] = useState("");
  const [selectedDraftModelId, setSelectedDraftModelId] = useState("");
  const [selectedAgentLoop, setSelectedAgentLoop] = useState<AgentLoopType>("anthropic_claude_code");
  const [draft, setDraft] = useState<AgentConfig | null>(null);
  const [quickSubmittedPrompt, setQuickSubmittedPrompt] = useState("");
  const [quickBuilderSessionId, setQuickBuilderSessionId] = useState("");
  const [quickBuilderDetail, setQuickBuilderDetail] = useState<SessionDetail | null>(null);
  const [wizardStep, setWizardStep] = useState<WizardStep>("describe");
  const [quickAgent, setQuickAgent] = useState<Agent | null>(null);
  const [quickEnvironment, setQuickEnvironment] = useState<Environment | null>(null);
  const [quickVault, setQuickVault] = useState<Vault | null>(null);
  const [quickSessionId, setQuickSessionId] = useState("");
  const [selectedSession, setSelectedSession] = useState("");
  const [sessionDetail, setSessionDetail] = useState<SessionDetail | null>(null);
  const [selectedEventId, setSelectedEventId] = useState("");
  const [eventMode, setEventMode] = useState<"transcript" | "debug">("transcript");
  const [message, setMessage] = useState("");
  const [askMapleOpen, setAskMapleOpen] = useState(false);
  const [workspacePickerOpen, setWorkspacePickerOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [metric, setMetric] = useState<string | null>(null);
  const [routeId, setRouteId] = useState("");
  const [routeEdit, setRouteEdit] = useState(false);
  const toast = useToast();
  const confirm = useConfirm();
  function resetQuickstartState() {
    setDraftPrompt("");
    setQuickSubmittedPrompt("");
    setQuickBuilderSessionId("");
    setQuickBuilderDetail(null);
    setWizardStep("describe");
    setDraft(null);
    setQuickAgent(null);
    setQuickEnvironment(null);
    setQuickVault(null);
    setQuickSessionId("");
    setSessionDetail(null);
    setSelectedSession("");
    setSelectedEventId("");
    setMessage("");
    setBusyAction("");
  }

  const navigateToView = (nextView: View) => {
    if (nextView === "quickstart") resetQuickstartState();
    setView(nextView);
  };

  const goView = (nextView: View, id = "", edit = false) => {
    if (nextView === "quickstart") resetQuickstartState();
    setView(nextView);
    setRouteId(id);
    setRouteEdit(edit);
  };
  const [workspaceSearch, setWorkspaceSearch] = useState("");
  const [modal, setModal] = useState<Modal>(null);
  const [modalVaultId, setModalVaultId] = useState("");
  const [modalVaultName, setModalVaultName] = useState("");
  const [modalMcpServer, setModalMcpServer] = useState("");
  const loadedWorkspaceIdRef = useRef("");
  const [busy, setBusy] = useState(false);
  const [busyAction, setBusyAction] = useState("");
  const [busyLabel, setBusyLabel] = useState("");
  const [error, setError] = useState("");
  const [language, setLanguageState] = useState<Language>(() => {
    const stored = window.localStorage.getItem("maple.language");
    return stored === "en" ? "en" : "zh";
  });
  const setLanguage = (value: Language) => {
    setLanguageState(value);
    window.localStorage.setItem("maple.language", value);
  };
  const i18n = useMemo(
    () => ({
      language,
      setLanguage,
      t: (key: string) => translations[language][key] ?? translations.zh[key] ?? key
    }),
    [language]
  );
  const L = (zh: string, en: string) => (language === "zh" ? zh : en);

  const { refresh, routeAfterAuth, enterTenant, switchWorkspace, switchingWorkspace, resourceLoading } = useBootstrapController({
    toast,
    view,
    currentUser,
    selectedWorkspaceId,
    selectedSession,
    onboardingRequired,
    loadedWorkspaceIdRef,
    setAuthChecked,
    setCurrentUser,
    setAuthProviders,
    setIsTenantAdmin,
    setCanAdminWorkspace,
    setAccessibleTenants,
    setWorkspaces,
    setOnboardingRequired,
    setView,
    setRouteId,
    setRouteEdit,
    setSelectedWorkspaceId,
    setUsers,
    setAgents,
    setEnvironments,
    setSessions,
    setDeployments,
    setVaults,
    setMemoryStores,
    setModelConfigs,
    setOnboardingModelConfigs,
    setWorkspaceKeys,
    setSelectedSession,
    setSelectedEventId,
    setSessionDetail,
    setUserMenuOpen,
    setSwitchingTenant,
    setError
  });

  useConsoleShortcuts({
    enabled: Boolean(currentUser),
    settingsOpen,
    metric,
    askMapleOpen,
    modal,
    userMenuOpen,
    workspacePickerOpen,
    setSettingsOpen,
    setMetric,
    setAskMapleOpen,
    setModal,
    setUserMenuOpen,
    setWorkspacePickerOpen
  });

  function optimisticUserEvent(sessionId: string, text: string): SessionEvent {
    const now = new Date().toISOString();
    return {
      id: `optimistic_user_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      session_id: sessionId,
      thread_id: null,
      type: "user.message",
      payload: { content: [{ type: "text", text }] },
      provider_event_type: null,
      created_at: now
    };
  }

  function appendOptimisticSessionUserMessage(sessionId: string, text: string, focusLatest = false) {
    const event = optimisticUserEvent(sessionId, text);
    setSessions((current) => current.map((session) => (
      session.id === sessionId ? { ...session, status: "running", updated_at: event.created_at } : session
    )));
    setSessionDetail((current) => {
      if (!current || current.session.id !== sessionId) return current;
      return { ...current, events: [...current.events, event], session: { ...current.session, status: "running", updated_at: event.created_at } };
    });
    if (focusLatest) setSelectedEventId(event.id);
  }

  const { refreshSessionDetail, detailLoadStatus } = useSelectedSessionDetail({
    currentUser,
    selectedSession,
    sessionDetail,
    setError,
    setSessions,
    setSessionDetail,
    setSelectedEventId
  });

  const selectedEvent = sessionDetail?.events.find((event) => event.id === selectedEventId) ?? sessionDetail?.events.at(-1) ?? null;
  const currentYaml = draft ? toYamlPreview(draft) : quickAgent ? toYamlPreview(quickAgent.config) : "";
  const defaultModelConfig = useMemo(() => modelConfigs.find((config) => config.is_default) ?? modelConfigs[0] ?? null, [modelConfigs]);
  // Lightweight refresh for the model pool: re-fetch only model_configs instead of the full
  // bootstrap snapshot, so toggling a default doesn't re-query the entire workspace serially.
  const refreshModelConfigs = useCallback(async () => {
    const query = selectedWorkspaceId ? `?workspace_id=${encodeURIComponent(selectedWorkspaceId)}` : "";
    const result = await apiGet<ApiList<ModelConfig>>(`/v1/model_configs${query}`);
    setModelConfigs(result.data);
  }, [selectedWorkspaceId]);
  const selectedWorkspace = workspaces.find((workspace) => workspace.id === selectedWorkspaceId) ?? workspaces[0] ?? null;
  const selectedTenantId = selectedWorkspace?.tenant_id ?? "";
  const tenantWorkspaces = selectedTenantId ? workspaces.filter((workspace) => workspace.tenant_id === selectedTenantId) : workspaces;

  const {
    selectDraftModel,
    selectAgentLoop,
    buildDraft,
    createDraftAgent,
    createEnvironmentFromWizard,
    reuseEnvironment,
    createQuickVault,
    sendQuickPreview,
    createQuickSession
  } = useQuickstartController({
    L,
    toast,
    busy,
    draftPrompt,
    draft,
    selectedAgentLoop,
    selectedDraftModelId,
    defaultModelConfig,
    modelConfigs,
    selectedWorkspaceId,
    quickBuilderSessionId,
    quickBuilderDetail,
    quickAgent,
    quickEnvironment,
    quickVault,
    quickSessionId,
    memoryStores,
    wizardStep,
    optimisticUserEvent,
    appendOptimisticSessionUserMessage,
    refresh,
    refreshSessionDetail,
    setSessionDetail,
    setBusy,
    setBusyAction,
    setBusyLabel,
    setError,
    setView,
    setDraftPrompt,
    setQuickSubmittedPrompt,
    setQuickBuilderSessionId,
    setQuickBuilderDetail,
    setSelectedDraftModelId,
    setSelectedAgentLoop,
    setDraft,
    setQuickAgent,
    setQuickEnvironment,
    setQuickVault,
    setQuickSessionId,
    setSelectedSession,
    setWizardStep,
    setModalVaultId,
    setModalVaultName,
    setModal
  });

  const drawerStack = useDrawerStack();
  const openEntity = useCallback((kind: EntityKind, id: string) => {
    if (drawerStack.depth >= 3) {
      drawerStack.closeAll();
      if (kind === "agent") goView("agent", id);
      else if (kind === "environment") goView("environment", id);
      else if (kind === "session") goView("sessions", id);
      else if (kind === "workspace") goView("tenant");
      else if (kind === "vault") goView("vault", id);
      else goView("vaults");
      return;
    }
    let title = id;
    let sub: string | undefined;
    if (kind === "agent") { const a = agents.find((x) => x.id === id); title = a?.name ?? id; sub = a?.description ?? undefined; }
    else if (kind === "environment") { const e = environments.find((x) => x.id === id); title = e?.name ?? id; sub = e?.id; }
    else if (kind === "session") { const s = sessions.find((x) => x.id === id); title = s?.title ?? id; sub = s?.id; }
    else if (kind === "workspace") { const w = tenantWorkspaces.find((x) => x.id === id); title = w?.name ?? id; sub = w?.id; }
    else { const v = vaults.find((x) => x.id === id); title = v?.display_name ?? id; sub = v?.id; }
    drawerStack.open({
      key: `${kind}:${id}:${drawerStack.depth}`, routeKind: kind, routeId: id,
      title,
      sub,
      body: <EntityDetailBody kind={kind} id={id} />,
      frameless: kind === "session",
      bodyFill: kind === "session"
    });
  }, [drawerStack, agents, environments, goView, sessions, tenantWorkspaces, vaults]);
  const entityNav = useMemo<EntityNavValue>(() => ({
    data: { agents, sessions, environments, vaults, modelConfigs, workspaces: tenantWorkspaces, workspace: selectedWorkspace },
    openEntity,
    goView,
    openSessionForAgent: (agentId: string) => { setSessionAgentLock(agentId); setModal("session"); },
    openCredentialForVault: (vaultId: string) => { setModalVaultId(vaultId); setModalVaultName(vaults.find((v) => v.id === vaultId)?.display_name ?? ""); setModalMcpServer(""); setModal("credential"); },
    refresh: () => refresh(selectedWorkspaceId)
  }), [agents, sessions, environments, vaults, modelConfigs, tenantWorkspaces, selectedWorkspace, openEntity, selectedWorkspaceId]);

  const navCount = (id: View) => {
    if (id === "agents") return agents.length;
    if (id === "deployments") return deployments.length;
    if (id === "sessions") return sessions.length;
    if (id === "environments") return environments.length;
    if (id === "vaults") return vaults.length;
    if (id === "models") return modelConfigs.length;
    return null;
  };

  const {
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
  } = useWorkspaceActions({
    L,
    toast,
    confirm,
    currentUser,
    selectedWorkspaceId,
    selectedWorkspace,
    tenantWorkspaces,
    workspaceKeys,
    sessions,
    selectedSession,
    memoryStores,
    refresh,
    resetQuickstartState,
    setCurrentUser,
    setIsTenantAdmin,
    setAccessibleTenants,
    setSelectedSession,
    setSelectedEventId,
    setSessionDetail,
    setSessions,
    setWorkspaces,
    setSelectedWorkspaceId,
    setOnboardingRequired,
    setIssuedWorkspaceKey,
    setIssuedWorkspaceApiKey,
    setView,
    setRouteId,
    setRouteEdit,
    setModal,
    setWorkspacePickerOpen,
    setError
  });

  async function sendMessage() {
    const text = message.trim();
    if (busy || !selectedSession || !text) return;
    setBusy(true);
    setBusyLabel(L("正在发送消息…", "Sending message..."));
    setError("");
    setMessage("");
    appendOptimisticSessionUserMessage(selectedSession, text, true);
    try {
      await apiPost(`/v1/sessions/${selectedSession}/events`, {
        events: [{ type: "user.message", content: [{ type: "text", text }] }]
      });
      await refreshSessionDetail(selectedSession, true);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
      setBusyLabel("");
    }
  }

  return <AppFrame {...{ authChecked, i18n, entityNav, language, currentUser, authProviders, error, routeAfterAuth, collapsed, setCollapsed, L, tenantWorkspaces, selectedWorkspaceId, workspaceSearch, setWorkspaceSearch, workspacePickerOpen, setWorkspacePickerOpen, setSelectedWorkspaceId, switchWorkspace, setModal, onboardingRequired, view, canAdminWorkspace, isTenantAdmin, openEntity, navigateToView, navCount, userMenuOpen, setUserMenuOpen, setSettingsOpen, logout, accessibleTenants, enterTenant, switchingTenant, switchingWorkspace, resourceLoading, selectedWorkspace, agents, deployments, sessions, environments, modelConfigs, setMetric, wizardStep, draftPrompt, quickSubmittedPrompt, setQuickSubmittedPrompt, setDraftPrompt, draft, setDraft, currentYaml, quickBuilderSessionId, setQuickBuilderSessionId, quickBuilderDetail, setQuickBuilderDetail, busy, busyAction, busyLabel, quickAgent, setQuickAgent, quickEnvironment, setQuickEnvironment, quickVault, setQuickVault, quickSessionId, setQuickSessionId, selectedDraftModelId, setSelectedDraftModelId, selectDraftModel, selectedAgentLoop, setSelectedAgentLoop, selectAgentLoop, buildDraft, createDraftAgent, createEnvironmentFromWizard, reuseEnvironment, createQuickVault, createQuickSession, sessionDetail, sendQuickPreview, setWizardStep, setSessionAgentLock, routeId, routeEdit, setRouteId, setRouteEdit, vaults, setModalVaultId, setModalVaultName, modalMcpServer, setModalMcpServer, refresh, refreshModelConfigs, selectedSession, setSelectedSession, selectedEvent, selectedEventId, setSelectedEventId, eventMode, setEventMode, message, setMessage, sendMessage, setAskMapleOpen, deleteSessionRecord, deleteWorkspaceRecord, onboardingModelConfigs, issuedWorkspaceKey, completeOnboarding, workspaceKeys, issuedWorkspaceApiKey, createWorkspaceApiKey, renameWorkspaceApiKey, toggleWorkspaceApiKey, deleteWorkspaceApiKeyRecord, memoryStores, seedMemory, users, removeWorkspaceUser, modal, modalVaultId, modalVaultName, refreshSessionDetail, detailLoadStatus, sessionAgentLock, setIssuedWorkspaceApiKey, settingsOpen, askMapleOpen, metric, goView, setOnboardingRequired, setView }} />;
}

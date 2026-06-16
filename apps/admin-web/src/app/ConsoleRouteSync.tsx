import { useEffect, useRef } from "react";
import { apiGet } from "../api";
import { consolePathForState, consoleRouteFromLocation, hasOAuthStatusParams, type ConsoleDrawerRoute } from "../appConfig";
import { applyBuilderDetail } from "./applyBuilderDetail";
import { clearQuickstartOAuthPending, readQuickstartOAuthState, writeQuickstartOAuthState } from "./quickstartOAuthState";
import { EntityDetailBody } from "../pages/agents/AgentViews";
import type { Agent, Environment, Session, SessionDetail, Vault, Workspace } from "../types";
import { useDrawerStack, type DrawerEntry } from "../ui";

function drawerTitle(route: ConsoleDrawerRoute, props: Record<string, any>) {
  const agents = (props.agents ?? []) as Agent[];
  const environments = (props.environments ?? []) as Environment[];
  const sessions = (props.sessions ?? []) as Session[];
  const workspaces = (props.tenantWorkspaces ?? []) as Workspace[];
  const vaults = (props.vaults ?? []) as Vault[];
  if (route.kind === "agent") {
    const agent = agents.find((item) => item.id === route.id);
    return { title: agent?.name ?? route.id, sub: agent?.description || undefined };
  }
  if (route.kind === "environment") {
    const environment = environments.find((item) => item.id === route.id);
    return { title: environment?.name ?? route.id, sub: environment?.id };
  }
  if (route.kind === "session") {
    const session = sessions.find((item) => item.id === route.id);
    return { title: session?.title ?? route.id, sub: session?.id };
  }
  if (route.kind === "workspace") {
    const workspace = workspaces.find((item) => item.id === route.id);
    return { title: workspace?.name ?? route.id, sub: workspace?.id };
  }
  const vault = vaults.find((item) => item.id === route.id);
  return { title: vault?.display_name ?? route.id, sub: vault?.id };
}

function drawerEntry(route: ConsoleDrawerRoute, index: number, props: Record<string, any>): DrawerEntry {
  const { title, sub } = drawerTitle(route, props);
  return {
    key: `${route.kind}:${route.id}:${index}`,
    title,
    sub,
    body: <EntityDetailBody kind={route.kind} id={route.id} />,
    frameless: route.kind === "session",
    bodyFill: route.kind === "session",
    routeKind: route.kind,
    routeId: route.id
  };
}

function drawerRoutes(stack: DrawerEntry[]): ConsoleDrawerRoute[] {
  return stack.map((entry) => {
    const [kind, id] = String(entry.key || "").split(":");
    return { kind: (entry.routeKind || kind) as ConsoleDrawerRoute["kind"], id: String(entry.routeId || id || "") };
  }).filter((item) => item.id);
}

export function ConsoleRouteSync(props: Record<string, any>) {
  const drawerStack = useDrawerStack();
  const restored = useRef(false);
  const syncing = useRef(false);
  const enabled = Boolean(props.currentUser && props.selectedWorkspace);
  const workspaceId = String(props.selectedWorkspace?.id || "");

  useEffect(() => {
    if (!enabled || restored.current) return;
    restored.current = true;
    const route = consoleRouteFromLocation();
    if (!route.hasConsoleAnchor) return;
    syncing.current = true;
    props.setView(route.view);
    props.setRouteId(route.routeId);
    props.setRouteEdit(route.routeEdit);
    if (route.selectedSession) props.setSelectedSession(route.selectedSession);
    props.setSelectedEventId(route.selectedEventId);
    props.setEventMode(route.eventMode);
    props.setModalVaultId(route.modalVaultId);
    props.setSessionAgentLock(route.sessionAgentLock);
    props.setModal(route.modal);
    props.setAskMapleOpen(route.askMapleOpen);
    props.setSettingsOpen(route.settingsOpen);
    props.setMetric(route.metric);
    drawerStack.replace(route.drawers.map((item, index) => drawerEntry(item, index, props)));
    queueMicrotask(() => { syncing.current = false; });
  }, [enabled]);

  useEffect(() => {
    if (!enabled || syncing.current || hasOAuthStatusParams()) return;
    const nextPath = consolePathForState({
      workspace: props.selectedWorkspace,
      view: props.view,
      routeId: props.routeId,
      routeEdit: props.routeEdit,
      selectedSession: props.selectedSession,
      selectedEventId: props.selectedEventId,
      eventMode: props.eventMode,
      modal: props.modal,
      modalVaultId: props.modalVaultId,
      sessionAgentLock: props.sessionAgentLock,
      askMapleOpen: props.askMapleOpen,
      settingsOpen: props.settingsOpen,
      metric: props.metric,
      drawers: drawerRoutes(drawerStack.stack)
    });
    if (nextPath && nextPath !== `${window.location.pathname}${window.location.search}`) {
      window.history.replaceState({}, "", nextPath);
    }
  }, [
    enabled, props.selectedWorkspace, props.view, props.routeId, props.routeEdit, props.selectedSession,
    props.selectedEventId, props.eventMode, props.modal, props.modalVaultId, props.sessionAgentLock,
    props.askMapleOpen, props.settingsOpen, props.metric, drawerStack.stack
  ]);

  useEffect(() => {
    if (!enabled || props.view !== "quickstart" || !workspaceId) return;
    const meaningful = props.quickBuilderSessionId || props.quickSubmittedPrompt || props.quickAgent?.id || props.quickEnvironment?.id || props.quickVault?.id || props.quickSessionId;
    if (!meaningful) return;
    const current = readQuickstartOAuthState(workspaceId);
    writeQuickstartOAuthState({
      workspaceId,
      builderSessionId: String(props.quickBuilderSessionId || ""),
      submittedPrompt: String(props.quickSubmittedPrompt || ""),
      agentId: String(props.quickAgent?.id || ""),
      environmentId: String(props.quickEnvironment?.id || ""),
      vaultId: String(props.quickVault?.id || ""),
      sessionId: String(props.quickSessionId || ""),
      step: props.wizardStep || "describe",
      selectedModelId: String(props.selectedDraftModelId || ""),
      selectedAgentLoop: props.selectedAgentLoop || "anthropic_claude_code",
      pending: current?.pending === true
    });
  }, [
    enabled, workspaceId, props.view, props.quickBuilderSessionId, props.quickSubmittedPrompt, props.quickAgent,
    props.quickEnvironment, props.quickVault, props.quickSessionId, props.wizardStep, props.selectedDraftModelId,
    props.selectedAgentLoop
  ]);

  useEffect(() => {
    if (!enabled || !workspaceId) return;
    const route = consoleRouteFromLocation();
    const state = readQuickstartOAuthState(workspaceId);
    const shouldRestore = route.view === "quickstart" && (route.hasConsoleAnchor || state?.pending);
    if (!state || !shouldRestore) return;
    if (state.submittedPrompt) props.setQuickSubmittedPrompt?.(state.submittedPrompt);
    if (state.selectedModelId) props.setSelectedDraftModelId?.(state.selectedModelId);
    if (state.selectedAgentLoop) props.setSelectedAgentLoop?.(state.selectedAgentLoop);
    if (state.sessionId) props.setQuickSessionId?.(state.sessionId);
    const agent = (props.agents as Agent[] | undefined)?.find((item) => item.id === state.agentId);
    const environment = (props.environments as Environment[] | undefined)?.find((item) => item.id === state.environmentId);
    const vault = (props.vaults as Vault[] | undefined)?.find((item) => item.id === state.vaultId);
    if (agent) props.setQuickAgent?.(agent);
    if (environment) props.setQuickEnvironment?.(environment);
    if (vault) props.setQuickVault?.(vault);
    props.setWizardStep?.(state.step === "vault" ? "session" : state.step);
    if (state.builderSessionId && props.quickBuilderSessionId !== state.builderSessionId) {
      props.setQuickBuilderSessionId?.(state.builderSessionId);
      apiGet<SessionDetail>(`/v1/sessions/${state.builderSessionId}/detail`, { timeoutMs: 12_000 })
        .then((detail) => applyBuilderDetail(detail, {
          draft: props.draft ?? null,
          selectedAgentLoop: state.selectedAgentLoop,
          setQuickBuilderDetail: props.setQuickBuilderDetail,
          setDraft: props.setDraft,
          setQuickSubmittedPrompt: props.setQuickSubmittedPrompt,
          setQuickAgent: props.setQuickAgent,
          setQuickEnvironment: props.setQuickEnvironment,
          setQuickVault: props.setQuickVault,
          setWizardStep: props.setWizardStep
        }))
        .catch(() => undefined);
    }
    if (state.pending) clearQuickstartOAuthPending(workspaceId);
  }, [
    enabled, workspaceId, props.view, props.agents, props.environments, props.vaults, props.quickBuilderSessionId,
    props.setQuickBuilderSessionId, props.setQuickBuilderDetail, props.setDraft, props.setQuickSubmittedPrompt,
    props.setQuickAgent, props.setQuickEnvironment, props.setQuickVault, props.setWizardStep
  ]);

  return null;
}

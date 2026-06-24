import { currentCredentialDetailReturnPath, currentQuickstartReturnPath, EntityNavContext, I18nContext, NAV_GROUPS, NAV_META, TENANT_ADMIN_ONLY_VIEWS, WORKSPACE_ADMIN_ONLY_VIEWS } from "./appConfig";
import { ConsoleRouteSync } from "./app/ConsoleRouteSync";
import { markQuickstartOAuthPending } from "./app/quickstartOAuthState";
import {
  ArtifactsView,
  BatchesView,
  CachingView,
  ClaudeCodeView,
  FilesView,
  LogsView,
  MemoryView,
  ModelGatewayView,
  SkillsView,
  UsageView,
  UsersView,
  WorkbenchView
} from "./pages/admin/AdminViews";
import { AgentDetailView, AgentsView, CredentialDetailView, EnvDetailView, EnvironmentsView, MetricDrawer, VaultDetailView } from "./pages/agents/AgentViews";
import { DocumentationView } from "./pages/docs/DocumentationView";
import { DeploymentsView } from "./pages/deployments/DeploymentsView";
import {
  AgentCreateModal,
  CredentialModal,
  EnvironmentModal,
  McpConnectModal,
  ModelConfigModal,
  SessionModal,
  VaultModal,
  WorkspaceCreateModal
} from "./pages/modals/Modals";
import { QuickstartView } from "./pages/quickstart/QuickstartView";
import { AskMapleDrawer, SessionsView, VaultsView } from "./pages/sessions/SessionViews";
import {
  DashboardView,
  TenantView,
  WorkspaceApiKeysView,
  WorkspaceOnboardingView,
  WorkspaceSettingsDrawer
} from "./pages/workspaces/WorkspaceViews";
import {
  LoginView,
  NoAccessView,
  SettingsModal,
  TenantChoiceView,
  TenantSelectView,
  UserArea,
  WorkspacePicker
} from "./shell/AppShell";
import { DrawerStackViewport, Icon } from "./ui";

export function AppFrame(props: Record<string, any>) {
  const { authChecked, i18n, entityNav, language, currentUser, authProviders, error, routeAfterAuth, collapsed, setCollapsed, L, tenantWorkspaces, selectedWorkspaceId, workspaceSearch, setWorkspaceSearch, workspacePickerOpen, setWorkspacePickerOpen, setSelectedWorkspaceId, switchWorkspace, setModal, onboardingRequired, view, canAdminWorkspace, isTenantAdmin, openEntity, navigateToView, navCount, userMenuOpen, setUserMenuOpen, setSettingsOpen, logout, accessibleTenants, enterTenant, switchingTenant, switchingWorkspace, resourceLoading, selectedWorkspace, agents, deployments, sessions, environments, modelConfigs, setMetric, wizardStep, draftPrompt, quickSubmittedPrompt, setDraftPrompt, draft, currentYaml, quickBuilderDetail, busy, busyAction, busyLabel, quickAgent, quickEnvironment, quickVault, quickSessionId, selectedDraftModelId, selectDraftModel, selectedAgentLoop, selectAgentLoop, buildDraft, createDraftAgent, createEnvironmentFromWizard, reuseEnvironment, setQuickEnvironment, createQuickVault, createQuickSession, sessionDetail, sendQuickPreview, setWizardStep, setSessionAgentLock, routeId, routeEdit, vaults, setModalVaultId, setModalVaultName, modalMcpServer, setModalMcpServer, refresh, refreshModelConfigs, selectedSession, setSelectedSession, selectedEvent, selectedEventId, setSelectedEventId, eventMode, setEventMode, message, setMessage, sendMessage, setAskMapleOpen, deleteSessionRecord, deleteWorkspaceRecord, onboardingModelConfigs, issuedWorkspaceKey, completeOnboarding, workspaceKeys, issuedWorkspaceApiKey, createWorkspaceApiKey, renameWorkspaceApiKey, toggleWorkspaceApiKey, deleteWorkspaceApiKeyRecord, memoryStores, seedMemory, users, removeWorkspaceUser, modal, modalVaultId, modalVaultName, refreshSessionDetail, detailLoadStatus, sessionAgentLock, setIssuedWorkspaceApiKey, settingsOpen, askMapleOpen, metric, goView, setOnboardingRequired, setView } = props;
  const credentialModalVaultId = modalVaultId || quickVault?.id || vaults[0]?.id || "";
  const credentialFromQuickstart = view === "quickstart" && Boolean(quickVault?.id) && credentialModalVaultId === quickVault.id;
  const switchingTarget = switchingTenant
    ? { name: switchingTenant.name, zh: "正在切换到", en: "Switching to" }
    : switchingWorkspace ? { name: switchingWorkspace.name, zh: "正在切换工作区", en: "Switching workspace" } : null;
  if (!authChecked) {
    return (
      <I18nContext.Provider value={i18n}>
        <div className="app-loading">
          <div className="app-loading-mark"><Icon name="i-maple" size={44} /></div>
          <div className="app-loading-word">OpenMaple</div>
          <div className="app-loading-slogan">
            <div className="app-loading-kicker">Managed Agent Platform for Launch-ready Execution</div>
            <div className="app-loading-title">OpenMaple · 开放的托管 Agent 平台</div>
            <div className="app-loading-copy">开箱即部署、上线即运行——用统一的托管 Agent 平台构建、运行并观测你的 Agent</div>
          </div>
          <span className="typing"><i /><i /><i /></span>
          <div className="app-loading-sub">{language === "zh" ? "正在加载控制台…" : "Loading your console…"}</div>
        </div>
      </I18nContext.Provider>
    );
  }

  if (!currentUser) {
    return (
      <I18nContext.Provider value={i18n}>
        <LoginView
          providers={authProviders}
          error={error}
          onLogin={async () => {
            await routeAfterAuth(true, true);
          }}
        />
      </I18nContext.Provider>
    );
  }

  return (
    <I18nContext.Provider value={i18n}>
    <EntityNavContext.Provider value={entityNav}>
    <ConsoleRouteSync {...props} />
    <div className={collapsed ? "console-shell collapsed" : "console-shell"}>
      <aside className="console-sidebar">
        <div className="console-brand">
          <strong className="brand-word"><Icon name="i-maple" size={18} /><span>OpenMaple</span></strong>
          <button className="icon-btn" title={L("收起侧栏", "Collapse")} onClick={() => setCollapsed((value: boolean) => !value)}><Icon name="i-workflow" size={17} /></button>
        </div>
        <WorkspacePicker
          workspaces={tenantWorkspaces}
          selectedWorkspaceId={selectedWorkspaceId}
          search={workspaceSearch}
          setSearch={setWorkspaceSearch}
          open={workspacePickerOpen}
          setOpen={setWorkspacePickerOpen}
          onSelect={(workspaceId) => {
            const workspace = tenantWorkspaces.find((item: any) => item.id === workspaceId) ?? null;
            switchWorkspace(workspaceId, workspace);
            setWorkspacePickerOpen(false);
          }}
          onOpenWorkspace={(workspaceId) => openEntity("workspace", workspaceId)}
          onCreate={() => {
            setWorkspacePickerOpen(false);
            setModal("workspace_create");
          }}
          onSettings={() => setModal("workspace_settings")}
          locked={onboardingRequired || view === "tenant_select" || view === "tenant_choice"}
          canManageWorkspace={canAdminWorkspace}
          canCreateWorkspace={isTenantAdmin}
        />
        <div className="nav-scroll">
          <div id="nav-groups">
            {NAV_GROUPS.map((group, groupIndex) => {
              const items = group.items.filter((id) => {
                if (TENANT_ADMIN_ONLY_VIEWS.has(id)) return isTenantAdmin;
                if (WORKSPACE_ADMIN_ONLY_VIEWS.has(id)) return canAdminWorkspace;
                return true;
              });
              if (!items.length) return null;
              return (
              <div className={group.title ? "nav-group" : "nav-group untitled"} key={groupIndex}>
                {group.title ? (
                  <div className="nav-group-title">
                    <span>{L(group.title[0], group.title[1])}</span>
                    {group.badge ? <span className="badge">{L(group.badge[0], group.badge[1])}</span> : null}
                  </div>
                ) : null}
                <nav className="nav-list">
                  {items.map((id) => {
                    const meta = NAV_META[id];
                    const count = navCount(id);
                    return (
                      <button className={view === id || (id === "vaults" && (view === "vault" || view === "credential")) ? "nav-item active" : "nav-item"} key={id} title={L(meta.zh, meta.en)} disabled={onboardingRequired || view === "tenant_select" || view === "tenant_choice"} onClick={() => { if (!onboardingRequired && view !== "tenant_select" && view !== "tenant_choice") navigateToView(id); }}>
                        <Icon name={meta.icon} size={16} />
                        <span>{L(meta.zh, meta.en)}</span>
                        {count ? <span className="nav-count">{count}</span> : null}
                      </button>
                    );
                  })}
                </nav>
              </div>
            );})}
          </div>
        </div>
        <div className="sidebar-foot">
          <UserArea
            currentUser={currentUser}
            open={userMenuOpen}
            setOpen={setUserMenuOpen}
            onSettings={() => { setUserMenuOpen(false); setSettingsOpen(true); }}
            onHelp={() => { setUserMenuOpen(false); navigateToView("docs"); }}
            onKeys={() => { setUserMenuOpen(false); navigateToView("api_keys"); }}
            onLogout={() => { setUserMenuOpen(false); logout(); }}
            tenants={accessibleTenants}
            currentTenantId={selectedWorkspace?.tenant_id}
            onSwitchTenant={enterTenant}
            canManageWorkspace={canAdminWorkspace}
          />
        </div>
      </aside>

      <main className="console-main">
        {error ? <div className="error-banner">{error}</div> : null}
        {view === "dashboard" && (
          <DashboardView
            currentUser={currentUser}
            workspace={selectedWorkspace}
            agents={agents}
            sessions={sessions}
            environments={environments}
            modelConfigs={modelConfigs}
            setView={navigateToView}
            openMetric={setMetric}
            canManageWorkspace={canAdminWorkspace}
          />
        )}
        {view === "quickstart" && (
          <QuickstartView
            step={wizardStep}
            prompt={draftPrompt}
            submittedPrompt={quickSubmittedPrompt}
            setPrompt={setDraftPrompt}
            draft={draft}
            yaml={currentYaml}
            builderDetail={quickBuilderDetail}
            busy={busy}
            busyAction={busyAction}
            busyLabel={busyLabel}
            agent={quickAgent}
            environment={quickEnvironment}
            vault={quickVault}
            quickSessionId={quickSessionId}
            environments={environments}
            sandboxProvider={selectedWorkspace?.sandbox_provider === "local_docker" ? "local_docker" : selectedWorkspace?.sandbox_provider === "vefaas" ? "vefaas" : selectedWorkspace?.sandbox_provider === "daytona" ? "daytona" : "e2b"}
            modelConfigs={modelConfigs}
            selectedModelId={selectedDraftModelId}
            setSelectedModelId={selectDraftModel}
            selectedAgentLoop={selectedAgentLoop}
            setSelectedAgentLoop={selectAgentLoop}
            buildDraft={buildDraft}
            createAgent={createDraftAgent}
            createEnvironment={createEnvironmentFromWizard}
            reuseEnvironment={reuseEnvironment}
            onSelectEnvironment={(id) => { const env = environments.find((environment: any) => environment.id === id); if (env) setQuickEnvironment(env); }}
            createVault={createQuickVault}
            startSession={createQuickSession}
            sessionDetail={sessionDetail}
            onPreviewSend={sendQuickPreview}
            openIntegrationStep={() => setWizardStep("integration")}
          />
        )}

        {view === "agents" && <AgentsView agents={agents} loading={resourceLoading} openSession={() => { setSessionAgentLock(""); setModal("session"); }} openCreate={() => setModal("agent_create")} />}
        {view === "deployments" && <DeploymentsView deployments={deployments} agents={agents} environments={environments} memoryStores={memoryStores} selectedWorkspaceId={selectedWorkspaceId} refresh={refresh} goView={goView} loading={resourceLoading} />}
        {view === "environments" && <EnvironmentsView environments={environments} loading={resourceLoading} openCreate={() => setModal("environment")} />}
        {view === "vaults" && (
          <VaultsView
            vaults={vaults}
            loading={resourceLoading}
            openMcp={() => setModal("mcp_connect")}
            openCreate={() => setModal("vault")}
          />
        )}
        {view === "sessions" && (
          <SessionsView
	            sessions={sessions}
	            agents={agents}
	            environments={environments}
	            workspaces={tenantWorkspaces}
            detail={sessionDetail}
            selectedSession={selectedSession}
            setSelectedSession={setSelectedSession}
            selectedEvent={selectedEvent}
            selectedEventId={selectedEventId}
            setSelectedEventId={setSelectedEventId}
            eventMode={eventMode}
            setEventMode={setEventMode}
            message={message}
            setMessage={setMessage}
            sendMessage={sendMessage}
            openCreate={() => { setSessionAgentLock(""); setModal("session"); }}
            openAskMaple={() => setAskMapleOpen(true)}
            onDeleteSession={deleteSessionRecord}
	            busy={busy}
	            loadingEvents={Boolean(selectedSession) && sessionDetail?.session?.id !== selectedSession}
	            loadingSessions={resourceLoading}
	            detailLoadStatus={detailLoadStatus}
	            onRetryDetail={() => refreshSessionDetail(selectedSession, true, { showLoading: true })}
	          />
        )}
        {view === "tenant" && isTenantAdmin && <TenantView workspace={selectedWorkspace} workspaces={tenantWorkspaces} currentUser={currentUser} setView={navigateToView} onDeleteWorkspace={deleteWorkspaceRecord} />}
        {view === "models" && canAdminWorkspace && (
          <ModelGatewayView
            modelConfigs={modelConfigs}
            workspace={selectedWorkspace}
            loading={resourceLoading}
            openModelConfig={() => setModal("model_config")}
            onChanged={() => refresh(selectedWorkspaceId)}
          />
        )}
        {view === "api_keys" && canAdminWorkspace && (
          <WorkspaceApiKeysView
            workspace={selectedWorkspace}
            keys={workspaceKeys}
            issuedKey={issuedWorkspaceApiKey}
            onCreate={createWorkspaceApiKey}
            onRename={renameWorkspaceApiKey}
            onToggle={toggleWorkspaceApiKey}
            onDelete={deleteWorkspaceApiKeyRecord}
            loading={resourceLoading}
          />
        )}
        {view === "docs" && <DocumentationView />}
        {view === "memory" && <MemoryView memoryStores={memoryStores} workspaceId={selectedWorkspaceId} onChanged={() => refresh(selectedWorkspaceId)} loading={resourceLoading} />}
        {view === "users" && canAdminWorkspace && <UsersView currentUser={currentUser} users={users} providers={authProviders} onRemoveUser={removeWorkspaceUser} scope="workspace" loading={resourceLoading} />}
        {view === "skills" && <SkillsView />}
        {view === "usage" && <UsageView />}
        {view === "logs" && <LogsView />}
        {view === "caching" && <CachingView />}
        {view === "artifacts" && <ArtifactsView />}
        {view === "workbench" && <WorkbenchView />}
        {view === "files" && <FilesView />}
        {view === "batches" && <BatchesView />}
        {view === "claudecode" && <ClaudeCodeView />}
        {view === "agent" && <AgentDetailView agentId={routeId} edit={routeEdit} />}
        {view === "environment" && <EnvDetailView envId={routeId} edit={routeEdit} />}
        {view === "vault" && <VaultDetailView vaultId={routeId} />}
        {view === "credential" && <CredentialDetailView routeId={routeId} />}
        {view === "provision" && <WorkspaceOnboardingView currentUser={currentUser} modelConfigs={onboardingModelConfigs} issuedWorkspaceKey={issuedWorkspaceKey} onSubmit={completeOnboarding} />}
        {view === "tenant_select" && <TenantSelectView tenants={accessibleTenants} currentUser={currentUser} onSelect={enterTenant} onLogout={logout} />}
        {view === "tenant_choice" && <TenantChoiceView tenants={accessibleTenants} currentUser={currentUser} onCreate={() => { setOnboardingRequired(true); setView("provision"); void refresh().finally(() => setOnboardingRequired(true)); }} onEnter={enterTenant} onLogout={logout} />}
        {view === "no_access" && <NoAccessView currentUser={currentUser} onLogout={logout} />}
      </main>

      {modal === "environment" ? <EnvironmentModal workspaceId={selectedWorkspaceId} sandboxProvider={selectedWorkspace?.sandbox_provider} onClose={() => setModal(null)} onCreated={() => refresh(selectedWorkspaceId)} /> : null}
      {modal === "vault" ? <VaultModal workspaceId={selectedWorkspaceId} onClose={() => setModal(null)} onCreated={async (vault) => { await refresh(selectedWorkspaceId); setModalVaultId(vault.id); setModalVaultName(vault.display_name); setModalMcpServer(""); setModal("credential"); }} /> : null}
      {modal === "mcp_connect" ? <McpConnectModal workspaceId={selectedWorkspaceId} onClose={() => setModal(null)} onConnected={() => refresh(selectedWorkspaceId)} /> : null}
      {modal === "agent_create" ? <AgentCreateModal workspaceId={selectedWorkspaceId} modelConfigs={modelConfigs} onClose={() => setModal(null)} onCreated={async (agentId) => { await refresh(selectedWorkspaceId); goView("agent", agentId); }} /> : null}
      {modal === "credential" ? (
        <CredentialModal
          vaultId={credentialModalVaultId}
          vaultName={modalVaultName || vaults.find((vault: any) => vault.id === modalVaultId)?.display_name || ""}
          initialMcpServer={modalMcpServer}
          onClose={() => { setModal(null); setModalMcpServer(""); }}
          oauthReturnTo={(credential: any) => credentialFromQuickstart ? currentQuickstartReturnPath() : currentCredentialDetailReturnPath(String(credential.vault_id || credentialModalVaultId), credential.id)}
          onOAuthRedirect={() => { if (credentialFromQuickstart) markQuickstartOAuthPending(selectedWorkspaceId); }}
        />
      ) : null}
      {modal === "session" ? (
        <SessionModal
          agents={agents}
          environments={environments}
          vaults={vaults}
          memoryStores={memoryStores}
          workspaceId={selectedWorkspaceId}
          sandboxProvider={selectedWorkspace?.sandbox_provider}
          lockedAgentId={sessionAgentLock || undefined}
          onClose={() => { setModal(null); setSessionAgentLock(""); }}
          onCreated={async (session) => {
            setSelectedSession(session.id);
            setView("sessions");
            // detail first so the new session renders right away; the slower full list refresh follows
            await refreshSessionDetail(session.id);
            await refresh(selectedWorkspaceId);
          }}
        />
      ) : null}
      {modal === "model_config" && canAdminWorkspace ? (
        <ModelConfigModal
          workspace={selectedWorkspace}
          modelConfigs={modelConfigs}
          onClose={() => setModal(null)}
          onSaved={async () => {
            await refresh(selectedWorkspaceId);
            setModal(null);
          }}
        />
      ) : null}
      {modal === "workspace_settings" && canAdminWorkspace ? (
        <WorkspaceSettingsDrawer
          workspace={selectedWorkspace}
          keys={workspaceKeys}
          modelConfigs={modelConfigs}
          issuedKey={issuedWorkspaceApiKey}
          onClose={() => setModal(null)}
          onCreateKey={createWorkspaceApiKey}
          onRenameKey={renameWorkspaceApiKey}
          onToggleKey={toggleWorkspaceApiKey}
          onDeleteKey={deleteWorkspaceApiKeyRecord}
          onMembersChanged={() => refresh(selectedWorkspaceId)}
          onModelsChanged={refreshModelConfigs}
        />
      ) : null}
      {modal === "workspace_create" && isTenantAdmin ? (
        <WorkspaceCreateModal onClose={() => setModal(null)} onOpenTenantCloudAccess={() => { setModal(null); navigateToView("tenant"); }} onCreated={(id, apiKey) => { setModal(null); setSelectedWorkspaceId(id); setIssuedWorkspaceApiKey(apiKey); setView("api_keys"); refresh(id); }} modelConfigs={onboardingModelConfigs.length ? onboardingModelConfigs : modelConfigs} tenantId={selectedWorkspace?.tenant_id} />
      ) : null}
      {askMapleOpen ? <AskMapleDrawer detail={sessionDetail} sessionId={selectedSession} onClose={() => setAskMapleOpen(false)} /> : null}
      {settingsOpen ? <SettingsModal currentUser={currentUser} onClose={() => setSettingsOpen(false)} /> : null}
      {metric ? (
        <MetricDrawer
          metric={metric}
          agents={agents}
          sessions={sessions}
          environments={environments}
          modelConfigs={modelConfigs}
          onClose={() => setMetric(null)}
          onDrill={(target) => { setMetric(null); navigateToView(target); }}
        />
      ) : null}
      {switchingTarget ? (
        <div className="tenant-switching" role="alert" aria-busy="true">
          <span className="boot-orbit"><i /><i /><i /></span>
          <div className="tenant-switching-text">{L(switchingTarget.zh, switchingTarget.en)} <b>{switchingTarget.name}</b>…</div>
        </div>
      ) : null}
    </div>
    <DrawerStackViewport />
    </EntityNavContext.Provider>
    </I18nContext.Provider>
  );
}

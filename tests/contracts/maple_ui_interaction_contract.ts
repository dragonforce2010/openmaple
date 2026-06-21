import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const stableBase = "http://127.0.0.1:27951";

const sources = {
  templates: readFileSync("apps/admin-web/src/config/templates.ts", "utf8"),
  agentCreate: readFileSync("apps/admin-web/src/pages/modals/AgentCreateModal.tsx", "utf8"),
  agentDetail: readFileSync("apps/admin-web/src/pages/agents/AgentDetailView.tsx", "utf8"),
  agentPanels: readFileSync("apps/admin-web/src/pages/agents/AgentPanels.tsx", "utf8"),
  environmentDetail: readFileSync("apps/admin-web/src/pages/agents/EnvironmentDetailView.tsx", "utf8"),
  environmentDelete: [
    readFileSync("apps/admin-web/src/pages/agents/EnvironmentDetailView.tsx", "utf8"),
    readFileSync("apps/admin-web/src/components/shared/useDeleteEnvironment.tsx", "utf8"),
    readFileSync("apps/admin-web/src/components/shared/DeleteEnvironmentBody.tsx", "utf8")
  ].join("\n"),
  environmentModal: [
    readFileSync("apps/admin-web/src/pages/modals/EnvironmentModal.tsx", "utf8"),
    readFileSync("apps/admin-web/src/pages/modals/EnvironmentForm.tsx", "utf8")
  ].join("\n"),
  sessionsView: [
    readFileSync("apps/admin-web/src/pages/sessions/SessionsView.tsx", "utf8"),
    // loading overlay/skeleton live in the extracted SessionLoadState component
    readFileSync("apps/admin-web/src/pages/sessions/SessionLoadState.tsx", "utf8")
  ].join("\n"),
  sessionSandbox: readFileSync("apps/admin-web/src/pages/sessions/SessionSandboxSummary.tsx", "utf8"),
  sessionSandboxDetail: readFileSync("apps/admin-web/src/pages/sessions/SessionSandboxDetail.tsx", "utf8"),
  sessionToolEventDetail: readFileSync("apps/admin-web/src/pages/sessions/SessionToolEventDetail.tsx", "utf8"),
  selectedSessionDetail: readFileSync("apps/admin-web/src/app/useSelectedSessionDetail.ts", "utf8"),
  codeSamples: readFileSync("apps/admin-web/src/components/shared/code.tsx", "utf8"),
  docsIntro: readFileSync("apps/admin-web/src/pages/docs/documentationIntroContent.tsx", "utf8"),
  docsSdk: readFileSync("apps/admin-web/src/pages/docs/documentationSdkContent.tsx", "utf8"),
  appFrame: readFileSync("apps/admin-web/src/AppFrame.tsx", "utf8"),
  bootstrapController: readFileSync("apps/admin-web/src/app/useBootstrapController.ts", "utf8"),
  layout: readFileSync("apps/admin-web/src/components/shared/layout.tsx", "utf8"),
  vaultDetail: readFileSync("apps/admin-web/src/pages/agents/VaultDetailView.tsx", "utf8"),
  modelGateway: readFileSync("apps/admin-web/src/pages/admin/ModelGatewayView.tsx", "utf8"),
  askMaple: readFileSync("apps/admin-web/src/pages/sessions/AskMapleDrawer.tsx", "utf8"),
  workspaceTabs: readFileSync("apps/admin-web/src/pages/workspaces/WorkspaceSettingsTabs.tsx", "utf8"),
  workspaceDetail: readFileSync("apps/admin-web/src/pages/agents/EntityDetailBody.tsx", "utf8"),
  runtimeDetails: readFileSync("apps/admin-web/src/pages/workspaces/RuntimePoolDetails.tsx", "utf8"),
  workspaceSettings: readFileSync("apps/admin-web/src/pages/workspaces/WorkspaceSettingsDrawer.tsx", "utf8")
};

const userFacingSamples = [
  sources.codeSamples,
  sources.docsIntro,
  sources.docsSdk,
  readFileSync("packages/sdk/README.md", "utf8"),
  readFileSync("packages/cli/README.md", "utf8")
].join("\n");

assert.equal(
  userFacingSamples.includes("http://127.0.0.1:27951"),
  true,
  "user-facing generated samples and docs should default to the local open-source API base"
);
assert.match(userFacingSamples, new RegExp(escapeRegExp(stableBase)), "samples should expose the local MAPLE_API_BASE_URL");
assert.match(sources.codeSamples, /process\.env\.MAPLE_API_BASE_URL(?!\s*\|\|)/, "SDK snippets should require MAPLE_API_BASE_URL instead of hiding a localhost fallback");

for (const forbidden of ["Blank agent config", "Deep researcher", "Structured extractor", "Field monitor"]) {
  assert.equal(sources.templates.includes(forbidden), false, `template copy should be product-ready: ${forbidden}`);
}
for (const required of ["Data insights", "Customer knowledge", "Market monitoring", "Incident response", "Compliance audit", "Developer productivity", "Growth experiment", "Finance reconciliation"]) {
  assert.match(sources.templates, new RegExp(escapeRegExp(required)), `missing product-ready English template: ${required}`);
}
for (const packageAnchor of ["packages", "pandas", "playwright", "openpyxl"]) {
  assert.match(sources.templates, new RegExp(escapeRegExp(packageAnchor)), `templates should include package-heavy scenarios: ${packageAnchor}`);
}

assert.match(sources.agentCreate, /busy === "create"[\s\S]*spin-dot|btn-spin/, "Agent create must show an explicit spinner while creating");
assert.match(sources.agentDetail, /draftName|setDraftName/, "Agent edit must support editing the Agent name");
assert.match(sources.agentDetail, /templateCards\.map|配置模板|Config template/, "Agent edit must support replacing config from a template");
assert.match(sources.agentDetail, /parseEditableAgentConfig/, "Agent edit must support full config editing, not just system prompt");

assert.match(sources.sessionsView, /session-loading-overlay|session-detail-skeleton/, "Session detail must show a visible loading overlay/skeleton when switching sessions");
assert.match(sources.sessionsView, /aria-busy/, "Session loading state must be accessible");
assert.match(sources.layout, /loading\?: boolean/, "DataTable must expose a loading prop for list pages");
assert.match(sources.layout, /table-loading/, "DataTable must render an inline loading state");
assert.match(sources.layout, /aria-busy/, "DataTable loading state must be accessible");
assert.match(sources.bootstrapController, /resourceLoading/, "bootstrap refresh must expose resourceLoading");
assert.match(sources.bootstrapController, /setResourceLoading\(true\)[\s\S]*finally[\s\S]*setResourceLoading\(false\)/, "resourceLoading must reset in a finally block");
assert.match(sources.bootstrapController, /bootstrapStartedRef/, "initial bootstrap must be guarded against React strict-mode duplicate requests");
assert.match(sources.appFrame, /loading=\{resourceLoading\}/, "workspace list pages must receive resourceLoading");
assert.match(sources.appFrame, /loadingSessions=\{resourceLoading\}/, "SessionsView list loading must receive resourceLoading");
assert.match(sources.sessionsView, /session-header-actions/, "Session header actions must keep Ask Maple and New Session side by side");
assert.match(sources.askMaple, /ask-chat-body/, "AskMaple drawer must make the chat stream the primary surface");
assert.match(sources.askMaple, /ask-info-toggle/, "AskMaple drawer must expose current session details through a separate button");
assert.match(sources.askMaple, /ask-session-panel/, "AskMaple must keep current session information out of the chat stream");
assert.match(sources.askMaple, /ask-signals-panel/, "AskMaple must keep event/tool/reference signals in the session information panel");
assert.ok(
  sources.askMaple.indexOf("ask-chat-body") < sources.askMaple.indexOf("ask-session-panel"),
  "AskMaple chat stream should be read before the optional session information panel"
);
assert.match(sources.askMaple, /ask-composer-wrap/, "AskMaple must use a bottom composer wrap like the session chat");
assert.ok(
  sources.askMaple.indexOf("ask-chat-body") < sources.askMaple.indexOf("ask-composer-wrap"),
  "AskMaple composer must sit below the chat stream, matching the session chat layout"
);
assert.match(sources.sessionSandbox, /sandbox_id/, "Session sandbox summary must expose sandbox_id");
assert.match(sources.sessionSandbox, /function_id|cloud_function_id/, "Session sandbox summary must expose function id");
assert.match(sources.sessionSandbox, /gateway_url|invoke_url/, "Session sandbox summary must expose runtime URLs");
assert.match(sources.sessionSandboxDetail, /vefaasSandboxInstanceConsoleHref|sandbox\/detail/, "Session sandbox detail must link to the VeFaaS sandbox instance console");
assert.match(sources.sessionSandboxDetail, /copy-inline|navigator\.clipboard/, "Session sandbox detail must support copying runtime fields");
assert.match(sources.sessionToolEventDetail, /sandbox_id/, "Tool event detail must show the execution sandbox_id");
assert.match(sources.sessionToolEventDetail, /SessionSandboxDetail/, "Tool event detail must jump into sandbox detail");
assert.match(sources.sessionToolEventDetail, /vefaasSandboxInstanceConsoleHref|sandbox\/detail/, "Tool event detail must link to the VeFaaS sandbox instance console");
assert.match(sources.askMaple, /tool-detail-code|prettyToolValue/, "AskMaple tool table must expose input/output details");
assert.match(sources.selectedSessionDetail, /mergeEventDerivedToolCalls/, "Incremental session detail must derive tool_calls from appended events");
assert.match(sources.vaultDetail, /CredentialDetailView/, "Vault credential rows must open credential detail content");
assert.match(sources.vaultDetail, /useDrawerStack/, "Vault credential detail must use the shared secondary drawer stack");
assert.match(sources.vaultDetail, /clickable-row/, "Vault credential rows must be visibly clickable");
assert.match(sources.modelGateway, /model-detail-card/, "Model gateway row click must reveal model endpoint detail");
assert.match(sources.modelGateway, /selectedModel/, "Model gateway must track the selected endpoint");
assert.match(sources.modelGateway, /addEventListener\("click"/, "Model gateway action menu must close on outside click");

for (const source of [sources.agentPanels, sources.workspaceTabs, sources.workspaceDetail]) {
  assert.match(source, /RuntimePoolDetails|SandboxPoolDetails/, "runtime pool pages must use the shared deep runtime details component");
}
assert.match(sources.runtimeDetails, /cloud_function_id/, "runtime pool UI must show cloud_function_id");
assert.match(sources.runtimeDetails, /invoke_url/, "runtime pool UI must show invoke_url");
assert.match(sources.runtimeDetails, /sandbox_id/, "sandbox pool UI must show sandbox_id");
assert.match(sources.runtimeDetails, /href=|target="_blank"/, "runtime pool UI must provide jump/copy links for cloud functions or invoke URLs");
assert.match(sources.workspaceSettings, /cloud_provider_identities/, "Workspace settings must surface cloud provider identities");
assert.match(sources.workspaceSettings, /Cloud providers/, "Workspace overview must label cloud provider identities");

assert.match(sources.environmentDetail, /relatedAgents|关联 Agent|Related agents/, "Environment detail must list related Agents");
assert.match(sources.environmentDetail, /relatedSessions|关联 Session|Related sessions/, "Environment detail must list related Sessions");
assert.match(sources.environmentDelete, /delete_preview/, "Environment delete must preview linked resources before deleting");
assert.match(sources.environmentDelete, /apiDelete\(`\/v1\/environments/, "Environment detail must support delete");
assert.match(sources.environmentDetail, /draftName|setName/, "Environment edit must support renaming");
assert.match(sources.environmentModal, /packages|packageTemplates|环境模板/, "Environment create must support package-aware templates");

console.log("maple UI interaction contract passed");

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

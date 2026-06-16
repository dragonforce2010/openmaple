import type { Dispatch, SetStateAction } from "react";
import { ApiError, apiPost } from "../api";
import type { Modal, QuickstartBuilderActionResponse, QuickstartBuilderResponse, View, WizardStep } from "../appConfig";
import { agentModelFromModelConfig } from "../components/shared/code";
import { recordFromUnknown } from "../components/shared/events";
import { errorMessage, slugify } from "../components/shared/misc";
import { applyBuilderDetail } from "./applyBuilderDetail";
import { useBuilderTurnStream } from "./useBuilderTurnStream";
import { optimisticSessionDetail } from "./quickstartBuilderPolling";
import type {
  Agent,
  AgentConfig,
  AgentLoopType,
  Environment,
  MemoryStore,
  ModelConfig,
  Session,
  SessionDetail,
  SessionEvent,
  Vault
} from "../types";
import type { ToastType } from "../ui";

type L = (zh: string, en: string) => string;
type Toast = (message: string, kind?: ToastType) => void;

export function useQuickstartController(input: {
  L: L;
  toast: Toast;
  busy: boolean;
  draftPrompt: string;
  draft: AgentConfig | null;
  selectedAgentLoop: AgentLoopType;
  selectedDraftModelId: string;
  defaultModelConfig: ModelConfig | null;
  modelConfigs: ModelConfig[];
  selectedWorkspaceId: string;
  quickBuilderSessionId: string;
  quickBuilderDetail: SessionDetail | null;
  quickAgent: Agent | null;
  quickEnvironment: Environment | null;
  quickVault: Vault | null;
  quickSessionId: string;
  memoryStores: MemoryStore[];
  wizardStep: WizardStep;
  optimisticUserEvent: (sessionId: string, text: string) => SessionEvent;
  appendOptimisticSessionUserMessage: (sessionId: string, text: string, focusLatest?: boolean) => void;
  refresh: (workspaceIdOverride?: string) => Promise<void>;
  refreshSessionDetail: (sessionId?: string, focusLatest?: boolean) => Promise<void>;
  setSessionDetail: Dispatch<SetStateAction<SessionDetail | null>>;
  setBusy: Dispatch<SetStateAction<boolean>>;
  setBusyAction: Dispatch<SetStateAction<string>>;
  setBusyLabel: Dispatch<SetStateAction<string>>;
  setError: Dispatch<SetStateAction<string>>;
  setView: Dispatch<SetStateAction<View>>;
  setDraftPrompt: Dispatch<SetStateAction<string>>;
  setQuickSubmittedPrompt: Dispatch<SetStateAction<string>>;
  setQuickBuilderSessionId: Dispatch<SetStateAction<string>>;
  setQuickBuilderDetail: Dispatch<SetStateAction<SessionDetail | null>>;
  setSelectedDraftModelId: Dispatch<SetStateAction<string>>;
  setSelectedAgentLoop: Dispatch<SetStateAction<AgentLoopType>>;
  setDraft: Dispatch<SetStateAction<AgentConfig | null>>;
  setQuickAgent: Dispatch<SetStateAction<Agent | null>>;
  setQuickEnvironment: Dispatch<SetStateAction<Environment | null>>;
  setQuickVault: Dispatch<SetStateAction<Vault | null>>;
  setQuickSessionId: Dispatch<SetStateAction<string>>;
  setSelectedSession: Dispatch<SetStateAction<string>>;
  setWizardStep: Dispatch<SetStateAction<WizardStep>>;
  setModalVaultId: Dispatch<SetStateAction<string>>;
  setModalVaultName: Dispatch<SetStateAction<string>>;
  setModal: Dispatch<SetStateAction<Modal>>;
}) {
  const {
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
    wizardStep
  } = input;

  function selectDraftModel(modelConfigId: string) {
    input.setSelectedDraftModelId(modelConfigId);
    const selected = modelConfigs.find((config) => config.id === modelConfigId) ?? (modelConfigId ? null : defaultModelConfig);
    if (selected) input.setDraft((current) => (current ? { ...current, model: agentModelFromModelConfig(selected) } : current));
  }

  function selectAgentLoop(type: AgentLoopType) {
    input.setSelectedAgentLoop(type);
    input.setDraft((current) => (current ? { ...current, agent_loop: { ...(current.agent_loop ?? {}), type, config: current.agent_loop?.config ?? {}, hooks: current.agent_loop?.hooks ?? [] } } : current));
  }

  function appendOptimisticBuilderUserMessage(text: string) {
    if (!quickBuilderSessionId) return;
    const event = input.optimisticUserEvent(quickBuilderSessionId, text);
    input.setQuickBuilderDetail((current) => {
      if (!current || current.session.id !== quickBuilderSessionId) return current;
      return { ...current, events: [...current.events, event], session: { ...current.session, status: "running", updated_at: event.created_at } };
    });
  }

  function applyQuickBuilderDetail(detail: SessionDetail | null) {
    applyBuilderDetail(detail, {
      draft,
      selectedAgentLoop,
      setQuickBuilderDetail: input.setQuickBuilderDetail,
      setDraft: input.setDraft,
      setQuickSubmittedPrompt: input.setQuickSubmittedPrompt,
      setQuickAgent: input.setQuickAgent,
      setQuickEnvironment: input.setQuickEnvironment,
      setQuickVault: input.setQuickVault,
      setWizardStep: input.setWizardStep
    });
  }

  async function ensureQuickBuilderSession() {
    if (!modelConfigs.length) throw new Error(L("当前工作区没有可用模型池。请先配置模型池。", "No model pool is available in this workspace. Configure the model pool first."));
    if (quickBuilderSessionId && quickBuilderDetail?.session.workspace_id === selectedWorkspaceId) return quickBuilderSessionId;
    const result = await apiPost<QuickstartBuilderResponse>("/v1/quickstart/builder_session", {
      workspace_id: selectedWorkspaceId || undefined,
      model_config_id: selectedDraftModelId || undefined,
      agent_loop_type: selectedAgentLoop
    });
    input.setQuickBuilderSessionId(result.session.id);
    applyQuickBuilderDetail(result.detail);
    return result.session.id;
  }

  async function buildDraft(promptOverride?: string) {
    const prompt = typeof promptOverride === "string" ? promptOverride : draftPrompt;
    if (busy || !prompt.trim()) return;
    if (!modelConfigs.length) {
      const message = L("当前工作区没有可用模型池。请先在模型页配置至少一个模型。", "No model pool is available. Configure at least one model first.");
      input.setError(message);
      toast(message, "err");
      return;
    }
    input.setQuickSubmittedPrompt(prompt.trim());
    input.setDraftPrompt("");
    input.setBusy(true);
    input.setBusyAction("builder_message");
    input.setBusyLabel(L("Builder Agent 正在回复...", "Builder Agent is replying..."));
    input.setError("");
    appendOptimisticBuilderUserMessage(prompt.trim());
    input.setView("quickstart");
    try {
      const sessionId = await ensureQuickBuilderSession();
      // The turn runs async on the server (202). SSE drives applyQuickBuilderDetail and the
      // status-settle effect below clears busy — no client-side polling.
      const result = await apiPost<QuickstartBuilderActionResponse>(`/v1/quickstart/builder_session/${sessionId}/message`, {
        text: prompt.trim(),
        model_config_id: selectedDraftModelId || undefined,
        agent_loop_type: selectedAgentLoop
      });
      applyQuickBuilderDetail(result.detail);
    } catch (reason) {
      const body = reason instanceof ApiError ? recordFromUnknown(reason.body) : {};
      if (body.detail) applyQuickBuilderDetail(body.detail as SessionDetail);
      input.setError(errorMessage(reason));
      input.setBusy(false);
      input.setBusyAction("");
      input.setBusyLabel("");
    }
  }

  async function createDraftAgent() {
    if (busy || !draft) return;
    if (!modelConfigs.length) {
      const message = L("当前工作区没有可用模型池。请先在模型页配置至少一个模型。", "No model pool is available. Configure at least one model first.");
      input.setError(message);
      toast(message, "err");
      return;
    }
    input.setBusy(true);
    input.setBusyAction("create_agent");
    input.setBusyLabel(L("正在创建 Agent…", "Creating agent..."));
    input.setError("");
    try {
      const sessionId = await ensureQuickBuilderSession();
      const result = await apiPost<QuickstartBuilderActionResponse>(`/v1/quickstart/builder_session/${sessionId}/action`, {
        action_id: "create_agent",
        payload: { draft }
      });
      applyQuickBuilderDetail(result.detail);
      input.setView("quickstart");
      void input.refresh(selectedWorkspaceId).catch(() => undefined);
    } catch (reason) {
      input.setError(errorMessage(reason));
    } finally {
      input.setBusy(false);
      input.setBusyAction("");
      input.setBusyLabel("");
    }
  }

  async function createEnvironmentFromWizard(mode: "unrestricted" | "none") {
    const baseName = quickAgent?.name || draft?.name || "managed-agent";
    input.setBusy(true);
    input.setBusyAction("create_environment");
    input.setBusyLabel(L("正在创建环境…", "Creating environment..."));
    input.setError("");
    try {
      const sessionId = await ensureQuickBuilderSession();
      const result = await apiPost<QuickstartBuilderActionResponse>(`/v1/quickstart/builder_session/${sessionId}/action`, {
        action_id: "create_environment",
        payload: { name: baseName, slug: slugify(baseName), networking: mode }
      });
      applyQuickBuilderDetail(result.detail);
      input.setView("quickstart");
      void input.refresh(selectedWorkspaceId).catch(() => undefined);
      toast(L("Environment 已创建", "Environment created"), "ok");
    } catch (reason) {
      input.setError(errorMessage(reason));
    } finally {
      input.setBusy(false);
      input.setBusyAction("");
      input.setBusyLabel("");
    }
  }

  async function reuseEnvironment(environment: Environment) {
    if (busy) return;
    input.setBusy(true);
    input.setBusyAction("reuse_environment");
    input.setBusyLabel(L("正在选择环境…", "Selecting environment..."));
    input.setError("");
    try {
      const sessionId = await ensureQuickBuilderSession();
      const result = await apiPost<QuickstartBuilderActionResponse>(`/v1/quickstart/builder_session/${sessionId}/action`, {
        action_id: "reuse_environment",
        payload: { environment_id: environment.id }
      });
      applyQuickBuilderDetail(result.detail);
      input.setView("quickstart");
    } catch (reason) {
      input.setError(errorMessage(reason));
    } finally {
      input.setBusy(false);
      input.setBusyAction("");
      input.setBusyLabel("");
    }
  }

  async function createQuickVault() {
    input.setBusy(true);
    input.setBusyAction("create_vault");
    input.setBusyLabel(L("正在创建凭证库…", "Creating credential vault..."));
    try {
      const vault = await apiPost<Vault>("/v1/vaults", {
        workspace_id: selectedWorkspaceId || undefined,
        display_name: `${quickAgent?.name || draft?.name || "Agent"} Credentials`,
        metadata: { source: "quickstart", shared_scope: "workspace" }
      });
      input.setQuickVault(vault);
      input.setModalVaultId(vault.id);
      input.setModalVaultName(vault.display_name);
      input.setModal("credential");
      input.setWizardStep("session");
      await input.refresh(selectedWorkspaceId);
    } catch (reason) {
      input.setError(errorMessage(reason));
    } finally {
      input.setBusy(false);
      input.setBusyAction("");
      input.setBusyLabel("");
    }
  }

  async function sendQuickPreview(text: string) {
    if (!quickSessionId) {
      const message = L("请先为当前 Agent 和环境启动 Session。", "Start a session for the current agent and environment first.");
      input.setError(message); toast(message, "err"); return;
    }
    input.setError("");
    input.setSelectedSession(quickSessionId);
    input.appendOptimisticSessionUserMessage(quickSessionId, text);
    try {
      await apiPost(`/v1/sessions/${quickSessionId}/events`, { events: [{ type: "user.message", content: [{ type: "text", text }] }] });
      await input.refreshSessionDetail(quickSessionId, true);
    } catch (reason) {
      input.setError(errorMessage(reason));
    }
  }

  async function createQuickSession() {
    const agent = quickAgent;
    const environment = quickEnvironment;
    if (!agent || !environment) {
      const message = L("当前 Agent 或环境还未就绪，不能启动 Preview。", "Current agent or environment is not ready for preview.");
      input.setError(message); toast(message, "err"); return;
    }
    const vaultIds = wizardStep === "vault" ? [] : quickVault ? [quickVault.id] : [];
    input.setBusy(true);
    input.setBusyAction("start_session");
    input.setBusyLabel(L("正在启动 Session…", "Starting session..."));
    try {
      const session = await apiPost<Session>("/v1/sessions", {
        workspace_id: agent.workspace_id || environment.workspace_id || selectedWorkspaceId || undefined,
        agent: agent.id,
        environment_id: environment.id,
        title: `${agent.name} run`,
        vault_ids: vaultIds,
        resources: memoryStores.slice(0, 1).map((store) => ({ type: "memory_store", memory_store_id: store.id, access: "read_write" })),
        metadata: {
          source: "quickstart_preview",
          quickstart_builder_session_id: quickBuilderSessionId || undefined,
          quickstart_agent_id: agent.id,
          quickstart_environment_id: environment.id
        }
      });
      input.setQuickSessionId(session.id);
      // refresh() FIRST: in the quickstart view it force-clears selectedSession/sessionDetail,
      // so selecting before it would get wiped. Then select + seed an optimistic detail so the
      // session view advances immediately; the selectedSession effect streams in events.
      await input.refresh(selectedWorkspaceId);
      input.setSelectedSession(session.id);
      input.setSessionDetail(optimisticSessionDetail(session, agent, environment));
      input.setWizardStep("session");
    } catch (reason) {
      input.setError(errorMessage(reason));
    } finally {
      input.setBusy(false);
      input.setBusyAction("");
      input.setBusyLabel("");
    }
  }

  useBuilderTurnStream({
    sessionId: quickBuilderSessionId,
    applyDetail: applyQuickBuilderDetail,
    onSettled: (failure) => {
      input.setBusy(false);
      input.setBusyAction("");
      input.setBusyLabel("");
      if (failure) {
        toast(L("Builder Agent 这一轮失败了，请重试或换个描述。", "The Builder Agent turn failed — please retry or rephrase."), "err");
        input.setError(failure);
      }
    }
  });

  return {
    selectDraftModel,
    selectAgentLoop,
    applyQuickBuilderDetail,
    buildDraft,
    createDraftAgent,
    createEnvironmentFromWizard,
    reuseEnvironment,
    createQuickVault,
    sendQuickPreview,
    createQuickSession
  };
}

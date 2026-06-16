import type { WizardStep } from "../appConfig";
import type { AgentLoopType } from "../types";

const KEY_PREFIX = "maple.quickstart.oauth.";

export type QuickstartOAuthState = {
  workspaceId: string;
  builderSessionId: string;
  submittedPrompt: string;
  agentId: string;
  environmentId: string;
  vaultId: string;
  sessionId: string;
  step: WizardStep;
  selectedModelId: string;
  selectedAgentLoop: AgentLoopType;
  pending: boolean;
};

function key(workspaceId: string) {
  return `${KEY_PREFIX}${workspaceId}`;
}

function isWizardStep(value: unknown): value is WizardStep {
  return ["describe", "agent_review", "environment", "vault", "session", "integration"].includes(String(value));
}

function isAgentLoop(value: unknown): value is AgentLoopType {
  return value === "anthropic_claude_code" || value === "codex_open_source";
}

export function readQuickstartOAuthState(workspaceId: string): QuickstartOAuthState | null {
  if (!workspaceId) return null;
  try {
    const parsed = JSON.parse(window.sessionStorage.getItem(key(workspaceId)) || "null") as Partial<QuickstartOAuthState> | null;
    if (!parsed || parsed.workspaceId !== workspaceId) return null;
    return {
      workspaceId,
      builderSessionId: String(parsed.builderSessionId || ""),
      submittedPrompt: String(parsed.submittedPrompt || ""),
      agentId: String(parsed.agentId || ""),
      environmentId: String(parsed.environmentId || ""),
      vaultId: String(parsed.vaultId || ""),
      sessionId: String(parsed.sessionId || ""),
      step: isWizardStep(parsed.step) ? parsed.step : "describe",
      selectedModelId: String(parsed.selectedModelId || ""),
      selectedAgentLoop: isAgentLoop(parsed.selectedAgentLoop) ? parsed.selectedAgentLoop : "anthropic_claude_code",
      pending: parsed.pending === true
    };
  } catch {
    return null;
  }
}

export function writeQuickstartOAuthState(state: QuickstartOAuthState) {
  if (!state.workspaceId) return;
  window.sessionStorage.setItem(key(state.workspaceId), JSON.stringify(state));
}

export function markQuickstartOAuthPending(workspaceId: string) {
  const current = readQuickstartOAuthState(workspaceId);
  if (current) writeQuickstartOAuthState({ ...current, pending: true });
}

export function clearQuickstartOAuthPending(workspaceId: string) {
  const current = readQuickstartOAuthState(workspaceId);
  if (current) writeQuickstartOAuthState({ ...current, pending: false });
}

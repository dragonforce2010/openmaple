import type { Dispatch, SetStateAction } from "react";
import type { WizardStep } from "../appConfig";
import { recordFromUnknown } from "../components/shared/events";
import type { Agent, AgentConfig, AgentLoopType, Environment, SessionDetail, Vault } from "../types";

type BuilderDetailDeps = {
  draft: AgentConfig | null;
  selectedAgentLoop: AgentLoopType;
  setQuickBuilderDetail: Dispatch<SetStateAction<SessionDetail | null>>;
  setDraft: Dispatch<SetStateAction<AgentConfig | null>>;
  setQuickSubmittedPrompt: Dispatch<SetStateAction<string>>;
  setQuickAgent: Dispatch<SetStateAction<Agent | null>>;
  setQuickEnvironment: Dispatch<SetStateAction<Environment | null>>;
  setQuickVault: Dispatch<SetStateAction<Vault | null>>;
  setWizardStep: Dispatch<SetStateAction<WizardStep>>;
};

// Latest ui.card / ui.resource of a given kind, with its event index (used to decide which of
// draft / agent / environment is the most recent step and drive the wizard accordingly).
function latestPayload(events: SessionDetail["events"], match: (payload: ReturnType<typeof recordFromUnknown>, type: string) => boolean) {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    const payload = recordFromUnknown(event.payload);
    if (match(payload, event.type)) return { payload, index };
  }
  return null;
}

// Project a builder session's event stream onto the quickstart wizard: pull the latest draft /
// created agent / created environment, push them into state, and advance the wizard step to the
// most recent one. Pure apart from the injected setters — keeps useQuickstartController small.
export function applyBuilderDetail(detail: SessionDetail | null, deps: BuilderDetailDeps) {
  if (!detail) return;
  deps.setQuickBuilderDetail(detail);
  const events = detail.events ?? [];
  const draftEvent = latestPayload(events, (payload, type) => type === "ui.card" && payload.card_type === "agent_draft");
  const agentEvent = latestPayload(events, (payload, type) => type === "ui.resource" && payload.resource_type === "agent");
  const environmentEvent = latestPayload(events, (payload, type) => type === "ui.resource" && payload.resource_type === "environment");
  const draftIndex = draftEvent?.index ?? -1;
  const agentIndex = agentEvent?.index ?? -1;
  const environmentIndex = environmentEvent?.index ?? -1;
  const draftPayload = draftEvent?.payload ?? null;
  const nextDraft = draftPayload ? (recordFromUnknown(draftPayload.draft) as AgentConfig) : null;
  const nextAgent = agentIndex > draftIndex && agentEvent ? (recordFromUnknown(agentEvent.payload.resource) as Agent) : null;
  const nextEnvironment = environmentIndex > draftIndex && environmentEvent ? (recordFromUnknown(environmentEvent.payload.resource) as Environment) : null;
  const flowDraft = nextDraft ?? nextAgent?.config ?? deps.draft;
  const needsVault = Array.isArray(flowDraft?.mcp_servers) && flowDraft.mcp_servers.length > 0;
  if (nextDraft?.name && nextDraft.model && nextDraft.system) {
    deps.setDraft({
      ...nextDraft,
      agent_loop: {
        ...(nextDraft.agent_loop ?? {}),
        type: nextDraft.agent_loop?.type ?? deps.selectedAgentLoop,
        config: nextDraft.agent_loop?.config ?? {},
        hooks: nextDraft.agent_loop?.hooks ?? []
      }
    });
    if (typeof draftPayload?.prompt === "string") deps.setQuickSubmittedPrompt(draftPayload.prompt);
  }
  if (nextAgent?.id) deps.setQuickAgent(nextAgent);
  if (nextEnvironment?.id) deps.setQuickEnvironment(nextEnvironment);
  if (nextDraft?.name && draftIndex > Math.max(agentIndex, environmentIndex)) {
    deps.setQuickAgent(null);
    deps.setQuickEnvironment(null);
    deps.setQuickVault(null);
    deps.setWizardStep("agent_review");
    return;
  }
  if (nextEnvironment?.id) deps.setWizardStep(needsVault ? "vault" : "session");
  else if (nextAgent?.id) deps.setWizardStep("environment");
  else if (nextDraft?.name) deps.setWizardStep("agent_review");
}

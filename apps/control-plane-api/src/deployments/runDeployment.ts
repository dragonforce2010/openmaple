import { emitSessionEvent } from "../eventHub";
import { maybeBootstrapSession, maybeRunUserMessage } from "../routes/routeHelpers";
import {
  createDeploymentRun,
  createSession,
  createSessionEvents,
  updateDeploymentRun
} from "../store";
import type { JsonRecord } from "../types";
import { userMessageText } from "./schedule";

export type DeploymentRunInput = {
  deployment: JsonRecord;
  triggered_by: "manual" | "scheduled" | "invoke";
  triggered_by_user_id?: string | null;
  title?: string;
  message?: string;
  initial_events?: JsonRecord[];
  vault_ids?: string[];
  memory_store_ids?: string[];
  resources?: JsonRecord[];
  trigger_context?: JsonRecord;
  await_turn?: boolean;
};

export async function runDeployment(input: DeploymentRunInput) {
  const events = deploymentInitialEvents(input);
  const run = createDeploymentRun({
    deployment_id: String(input.deployment.id),
    workspace_id: String(input.deployment.workspace_id || ""),
    tenant_id: String(input.deployment.tenant_id || ""),
    triggered_by: input.triggered_by,
    triggered_by_user_id: input.triggered_by_user_id ?? null,
    initial_events: events,
    trigger_context: input.trigger_context ?? {}
  }) as JsonRecord;

  try {
    if (!events.length) throw new Error("deployment_initial_event_required");
    const session = createSession({
      agent_id: String(input.deployment.agent_id),
      environment_id: String(input.deployment.environment_id),
      title: input.title || `${input.deployment.name} run`,
      workspace_id: String(input.deployment.workspace_id || ""),
      metadata: sessionMetadata(input, run.id)
    });
    if (!session) throw new Error("deployment_agent_or_environment_not_found");
    const storedEvents = createSessionEvents(String(session.id), null, events.map(toEventItem));
    storedEvents.forEach(emitSessionEvent);
    maybeBootstrapSession(String(session.id));
    await maybeRunFirstUserMessage(String(session.id), events, Boolean(input.await_turn));
    const updated = updateDeploymentRun(String(run.id), { status: "succeeded", session_id: String(session.id) }) as JsonRecord;
    return { ...updated, event_ids: storedEvents.map((event) => event.id), event_id: storedEvents[0]?.id ?? null };
  } catch (error) {
    updateDeploymentRun(String(run.id), {
      status: "failed",
      error: { message: error instanceof Error ? error.message : String(error) }
    });
    throw error;
  }
}

function deploymentInitialEvents(input: DeploymentRunInput) {
  if (input.message) {
    return [
      {
        type: "user.message",
        payload: { content: [{ type: "text", text: input.message }], source: `deployment.${input.triggered_by}` }
      }
    ];
  }
  return input.initial_events ?? ((input.deployment.initial_events as JsonRecord[] | undefined) || []);
}

function toEventItem(event: JsonRecord): { type: string; payload: JsonRecord; provider_event_type?: string | null } {
  const payload = asRecord(event.payload);
  const content = Array.isArray(event.content) ? { content: event.content } : {};
  return {
    type: String(event.type || "user.message"),
    payload: {
      ...content,
      ...payload,
      source: String(payload.source || "deployment.run")
    }
  };
}

function sessionMetadata(input: DeploymentRunInput, runId: unknown) {
  return {
    owner_user_id: input.triggered_by_user_id ?? null,
    deployment_id: input.deployment.id,
    deployment_run_id: runId,
    deployment_version: input.deployment.version,
    triggered_by: input.triggered_by,
    vault_ids: input.vault_ids ?? input.deployment.vault_ids ?? [],
    memory_store_ids: input.memory_store_ids ?? input.deployment.memory_store_ids ?? [],
    resources: input.resources ?? input.deployment.resources ?? []
  };
}

async function maybeRunFirstUserMessage(sessionId: string, events: JsonRecord[], awaitTurn: boolean) {
  const firstUserMessage = events.find((event) => String(event.type || "") === "user.message");
  const text = firstUserMessage ? userMessageText(firstUserMessage) : "";
  if (!text) return;
  const work = maybeRunUserMessage(sessionId, text);
  if (awaitTurn) await work;
}

function asRecord(value: unknown): JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as JsonRecord) : {};
}

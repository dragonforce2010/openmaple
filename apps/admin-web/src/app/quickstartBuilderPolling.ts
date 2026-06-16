import type { Agent, Environment, Session, SessionDetail } from "../types";

// Show the freshly created session immediately. createQuickSession runs setSelectedSession
// and refreshSessionDetail in the same tick, but refreshSessionDetail bails when its
// selectedSessionRef hasn't caught up yet (race) — so the global sessionDetail never points
// at the new session and the Quickstart UI stays stuck on the "start session" form. Seed an
// optimistic detail from the values we already hold so the view advances; SSE then fills events.
export function optimisticSessionDetail(session: Session, agent: Agent | null, environment: Environment | null): SessionDetail {
  return { session, agent, environment, vaults: [], events: [], tool_calls: [] };
}

// Pull the failure reason out of the builder session's event stream so the user gets a
// concrete message instead of a silently blank conversation when a turn fails.
export function builderFailureMessage(detail: SessionDetail | null): string {
  if (!detail || String(detail.session.status ?? "") !== "failed") return "";
  for (let i = (detail.events ?? []).length - 1; i >= 0; i -= 1) {
    const event = detail.events[i];
    if (event.type !== "session.status_failed") continue;
    const payload = (event.payload ?? {}) as { error?: unknown };
    return typeof payload.error === "string" && payload.error ? payload.error : "builder_turn_failed";
  }
  return "builder_turn_failed";
}

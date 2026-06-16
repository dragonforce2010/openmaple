import { useEffect, useRef } from "react";

// SSE is the ONLY live channel — no polling fallback. The veFaaS/Envoy gateway was verified to
// stream session events in real time (no buffering), so a transient drop is handled by
// reconnecting the EventSource, not by falling back to a poll that masks SSE problems.
export const LIVE_SESSION_EVENT_TYPES = [
  "user.message",
  "user.custom_tool_result",
  "user.tool_result",
  "user.define_outcome",
  "tool_result",
  "session.status_bootstrapping",
  "session.status_installing_packages",
  "session.status_preparing_runtime",
  "session.packages_ready",
  "package.install_started",
  "package.install_log",
  "package.install_finished",
  "session.status_idle",
  "session.status_running",
  "session.status_failed",
  "agent.loop_selected",
  "agent.external_loop_started",
  "agent.external_loop_event",
  "agent.external_loop_completed",
  "agent.message_delta",
  "agent.message",
  "agent.reasoning_delta",
  "agent.reasoning",
  "agent.custom_tool_use",
  "agent.tool_use",
  "tool.result",
  "ui.card",
  "ui.resource"
] as const;

const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 15_000;

// Subscribe to a session's server-sent event stream. Any whitelisted event (or the initial
// `ready`) fires `onPing` — the caller then re-fetches detail incrementally (the stream is a
// "something changed" trigger, not the payload carrier). On error the EventSource is rebuilt
// with capped exponential backoff so a dropped connection self-heals without a poll.
export function useSessionEventStream(sessionId: string, onPing: () => void) {
  const onPingRef = useRef(onPing);
  onPingRef.current = onPing;

  useEffect(() => {
    if (!sessionId) return;
    let closed = false;
    let source: EventSource | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;

    const ping = () => {
      if (!closed) onPingRef.current();
    };

    const connect = () => {
      if (closed) return;
      source = new EventSource(`/v1/sessions/${sessionId}/events/stream`);
      source.addEventListener("ready", ping);
      for (const type of LIVE_SESSION_EVENT_TYPES) source.addEventListener(type, ping);
      source.onopen = () => {
        attempt = 0;
      };
      source.onerror = () => {
        if (closed) return;
        source?.close();
        source = null;
        const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** attempt);
        attempt += 1;
        retryTimer = setTimeout(connect, delay);
        // surface progress that may have landed during the drop, then reconnect for live events
        ping();
      };
    };

    connect();
    return () => {
      closed = true;
      if (retryTimer) clearTimeout(retryTimer);
      source?.close();
    };
  }, [sessionId]);
}

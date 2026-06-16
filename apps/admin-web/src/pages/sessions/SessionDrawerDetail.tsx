import { useEffect, useMemo, useState } from "react";
import { apiGet, apiPost } from "../../api";
import { useEntityNav, useI18n } from "../../appConfig";
import { dedupeTranscriptEvents, eventRole } from "../../components/shared/events";
import { errorMessage } from "../../components/shared/misc";
import type { SessionDetail } from "../../types";
import { Icon } from "../../ui";
import { SessionsView } from "./SessionsView";

export function SessionDrawerDetail({ sessionId }: { sessionId: string }) {
  const { language } = useI18n();
  const L = (zh: string, en: string) => (language === "zh" ? zh : en);
  const { data } = useEntityNav();
  const shellDetail = useMemo<SessionDetail | null>(() => {
    const session = data.sessions.find((item) => item.id === sessionId);
    if (!session) return null;
    return {
      session,
      agent: data.agents.find((item) => item.id === session.agent_id) ?? null,
      environment: data.environments.find((item) => item.id === session.environment_id) ?? null,
      vaults: [],
      events: [],
      tool_calls: []
    };
  }, [data.agents, data.environments, data.sessions, sessionId]);
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [error, setError] = useState("");
  const [selectedEventId, setSelectedEventId] = useState("");
  const [eventMode, setEventMode] = useState<"transcript" | "debug">("transcript");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const activeDetail = detail ?? shellDetail;
  const selectedEvent = activeDetail?.events.find((event) => event.id === selectedEventId) ?? activeDetail?.events.at(-1) ?? null;

  function applyDetail(next: SessionDetail) {
    setDetail(next);
    setSelectedEventId((current) => {
      if (current && next.events.some((event) => event.id === current)) return current;
      const preferred = dedupeTranscriptEvents(next.events).find((event) => {
        const role = eventRole(event.type, event);
        return role === "User" || role === "Agent";
      });
      return preferred?.id ?? next.events[0]?.id ?? "";
    });
  }

  useEffect(() => {
    let cancelled = false;
    setDetail(shellDetail);
    setError("");
    setSelectedEventId("");
    setLoadingEvents(true);
    const detailRequest = shellDetail
      ? apiGet<SessionDetail>(`/v1/sessions/${sessionId}/detail`, { timeoutMs: 12_000 })
      : apiGet<SessionDetail>(`/v1/sessions/${sessionId}/detail?summary=1`, { timeoutMs: 12_000 }).then(async (summary) => {
          if (cancelled) return null;
          applyDetail(summary);
          return apiGet<SessionDetail>(`/v1/sessions/${sessionId}/detail`, { timeoutMs: 12_000 });
        });
    detailRequest
      .then((next) => {
        if (!next || cancelled) return;
        applyDetail(next);
      })
      .catch((reason) => {
        if (!cancelled) setError(errorMessage(reason));
      })
      .finally(() => {
        if (!cancelled) setLoadingEvents(false);
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  async function sendDrawerMessage() {
    const text = message.trim();
    if (!text || sending) return;
    setSending(true);
    setError("");
    setMessage("");
    try {
      await apiPost(`/v1/sessions/${sessionId}/events`, {
        events: [{ type: "user.message", content: [{ type: "text", text }] }]
      });
      applyDetail(await apiGet<SessionDetail>(`/v1/sessions/${sessionId}/detail`, { timeoutMs: 12_000 }));
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setSending(false);
    }
  }

  if (error) return <div className="modal-note"><Icon name="i-alert" size={16} /> {error}</div>;
  if (!activeDetail) return <div className="empty-state">{L("正在加载 Session…", "Loading session...")}</div>;

  return (
    <SessionsView
      sessions={[activeDetail.session]}
      agents={data.agents}
      environments={data.environments}
      workspaces={data.workspaces}
      detail={activeDetail}
      selectedSession={sessionId}
      setSelectedSession={() => undefined}
      selectedEvent={selectedEvent}
      selectedEventId={selectedEventId}
      setSelectedEventId={setSelectedEventId}
      eventMode={eventMode}
      setEventMode={setEventMode}
      message={message}
      setMessage={setMessage}
      sendMessage={sendDrawerMessage}
      openCreate={() => undefined}
      openAskMaple={() => undefined}
      onDeleteSession={() => undefined}
      busy={sending}
      loadingEvents={loadingEvents}
      hideSessionIndex
      hideHeaderActions
    />
  );
}

import type { Dispatch, SetStateAction } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { apiGet } from "../api";
import { errorMessage } from "../components/shared/misc";
import type { Session, SessionDetail, User } from "../types";
import { mergeEventDerivedToolCalls } from "./sessionToolCalls";
import { useSessionEventStream } from "./useSessionEventStream";

const DETAIL_SLOW_MS = 2_000;
const DETAIL_TIMEOUT_MS = 12_000;

const isOptimisticEvent = (id: string) => id.startsWith("optimistic_");
export type DetailLoadStatus = { sessionId: string; loading: boolean; slow: boolean; error: string };

function mergeDetail(current: SessionDetail | null, incoming: SessionDetail): SessionDetail {
  if (incoming.events_mode !== "append" || !current || current.session.id !== incoming.session.id) return hydrateToolCalls(incoming);
  // Append responses carry only session + new events; the server skips agent/environment/
  // vaults/tool_calls (they don't change within a session). Keep the ones we already loaded.
  const stable = { agent: current.agent, environment: current.environment, vaults: current.vaults, tool_calls: current.tool_calls };
  if (!incoming.events.length) return hydrateToolCalls({ ...incoming, ...stable, events: current.events });
  const known = new Set(current.events.map((event) => event.id));
  const fresh = incoming.events.filter((event) => !known.has(event.id));
  // the server echo of user.message replaces the locally appended optimistic copy
  const serverUserMessageArrived = fresh.some((event) => event.type === "user.message");
  const base = serverUserMessageArrived ? current.events.filter((event) => !isOptimisticEvent(event.id)) : current.events;
  return hydrateToolCalls({ ...incoming, ...stable, events: [...base, ...fresh] });
}

function hydrateToolCalls(detail: SessionDetail): SessionDetail {
  return { ...detail, tool_calls: mergeEventDerivedToolCalls(detail.session.id, detail.tool_calls, detail.events) };
}

export function useSelectedSessionDetail(input: {
  currentUser: User | null;
  selectedSession: string;
  sessionDetail: SessionDetail | null;
  setError: Dispatch<SetStateAction<string>>;
  setSessions: Dispatch<SetStateAction<Session[]>>;
  setSessionDetail: Dispatch<SetStateAction<SessionDetail | null>>;
  setSelectedEventId: Dispatch<SetStateAction<string>>;
}) {
  const { currentUser, selectedSession, sessionDetail, setError, setSessions, setSessionDetail, setSelectedEventId } = input;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const slowTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const focusLatestRef = useRef(false);
  const detailRef = useRef<SessionDetail | null>(null);
  const selectedSessionRef = useRef(selectedSession);
  detailRef.current = sessionDetail;
  selectedSessionRef.current = selectedSession;
  const [detailLoadStatus, setDetailLoadStatus] = useState<DetailLoadStatus>({ sessionId: "", loading: false, slow: false, error: "" });

  const applyDetail = useCallback((incoming: SessionDetail, focusLatest = false) => {
    const detail = mergeDetail(detailRef.current, incoming);
    detailRef.current = detail;
    setSessionDetail(detail);
    setSessions((current) => current.map((session) => (session.id === detail.session.id ? detail.session : session)));
    setSelectedEventId((current) => {
      const latest = detail.events.at(-1)?.id ?? "";
      if (focusLatest) return latest || current;
      if (current && detail.events.some((event) => event.id === current)) return current;
      return latest || detail.events[0]?.id || "";
    });
  }, [setSelectedEventId, setSessionDetail, setSessions]);

  const clearSlowTimer = useCallback(() => {
    if (!slowTimerRef.current) return;
    clearTimeout(slowTimerRef.current);
    slowTimerRef.current = null;
  }, []);

  const startVisibleLoad = useCallback((sessionId: string) => {
    clearSlowTimer();
    setDetailLoadStatus({ sessionId, loading: true, slow: false, error: "" });
    slowTimerRef.current = setTimeout(() => {
      setDetailLoadStatus((current) => (
        current.sessionId === sessionId && current.loading ? { ...current, slow: true } : current
      ));
    }, DETAIL_SLOW_MS);
  }, [clearSlowTimer]);

  const finishLoad = useCallback((sessionId: string, error = "") => {
    clearSlowTimer();
    setDetailLoadStatus((current) => (
      current.sessionId === sessionId ? { sessionId, loading: false, slow: false, error } : current
    ));
  }, [clearSlowTimer]);

  const refreshSessionDetail = useCallback(async (sessionId = selectedSession, focusLatest = false, options: { showLoading?: boolean } = {}) => {
    if (!sessionId) return;
    const current = detailRef.current;
    const showLoading = options.showLoading ?? current?.session.id !== sessionId;
    if (showLoading) startVisibleLoad(sessionId);
    const syncedEvents = current?.session.id === sessionId ? current.events.filter((event) => !isOptimisticEvent(event.id)) : [];
    const lastSyncedEvent = syncedEvents.at(-1);
    const query = lastSyncedEvent ? `?after=${encodeURIComponent(lastSyncedEvent.id)}` : "";
    try {
      const detail = await apiGet<SessionDetail>(`/v1/sessions/${sessionId}/detail${query}`, { timeoutMs: DETAIL_TIMEOUT_MS });
      if (selectedSessionRef.current !== sessionId) return;
      applyDetail(detail, focusLatest);
      finishLoad(sessionId);
    } catch (reason) {
      if (selectedSessionRef.current === sessionId) finishLoad(sessionId, errorMessage(reason));
      throw reason;
    }
  }, [applyDetail, finishLoad, selectedSession, startVisibleLoad]);

  const scheduleDetailRefresh = useCallback((sessionId: string, focusLatest = false) => {
    focusLatestRef.current = focusLatestRef.current || focusLatest;
    if (timerRef.current) return;
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      const shouldFocusLatest = focusLatestRef.current;
      focusLatestRef.current = false;
      refreshSessionDetail(sessionId, shouldFocusLatest).catch((reason: unknown) => setError(errorMessage(reason)));
    }, 200);
  }, [refreshSessionDetail, setError]);

  useEffect(() => {
    if (!currentUser || !selectedSession) return;
    // Keep a detail that already points at this session (e.g. an optimistic one seeded by
    // createQuickSession) so switching INTO it doesn't blank the view; only reset when
    // moving to a different session.
    const alreadyOnSession = detailRef.current?.session.id === selectedSession;
    if (!alreadyOnSession) {
      detailRef.current = null;
      setSessionDetail(null);
      setDetailLoadStatus({ sessionId: selectedSession, loading: true, slow: false, error: "" });
      setSelectedEventId("");
    }
    refreshSessionDetail(selectedSession, false, { showLoading: !alreadyOnSession }).catch((reason: unknown) => setError(errorMessage(reason)));
    return () => {
      clearSlowTimer();
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [clearSlowTimer, currentUser, selectedSession, refreshSessionDetail, setError, setSelectedEventId, setSessionDetail]);

  // SSE is the only live channel — any event re-fetches detail incrementally; no polling.
  useSessionEventStream(currentUser ? selectedSession : "", () => scheduleDetailRefresh(selectedSession, true));

  return { refreshSessionDetail, detailLoadStatus };
}

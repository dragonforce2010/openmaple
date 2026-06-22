import { useEffect, useRef, useState } from "react";
import { useEntityNav, useI18n } from "../../appConfig";
import {
  dedupeTranscriptEvents,
  eventRole,
  eventTitle,
  eventUsageLabel,
  externalLoopView,
  isExternalLoopAgentEcho,
  MarkdownText,
  renderEventContent
} from "../../components/shared/events";
import { statusPill, workspaceLabel } from "../../components/shared/labels";
import { SessionComposer } from "./SessionComposer";
import { SessionPackageInstall } from "./SessionPackageInstall";
import { Crumb, PaginationControls, usePagination } from "../../components/shared/layout";
import { formatRelativeTime, formatTime } from "../../components/shared/misc";
import type { Agent, Environment, Session, SessionDetail, SessionEvent, Workspace } from "../../types";
import { Icon } from "../../ui";
import { SessionLoadState } from "./SessionLoadState";
import { SessionSandboxSummary } from "./SessionSandboxSummary";
import { isToolTraceEvent, SessionToolEventDetail } from "./SessionToolEventDetail";
import { composerPlaceholder, eventBarClass, runningSessionLabel, useTranscriptActions } from "./SessionTranscriptActions";

export function SessionsView(props: {
  sessions: Session[];
  agents: Agent[];
  environments: Environment[];
  workspaces: Workspace[];
  detail: SessionDetail | null;
  selectedSession: string;
  setSelectedSession: (id: string) => void;
  selectedEvent: SessionEvent | null;
  selectedEventId: string;
  setSelectedEventId: (id: string) => void;
  eventMode: "transcript" | "debug";
  setEventMode: (mode: "transcript" | "debug") => void;
  message: string;
  setMessage: (value: string) => void;
  sendMessage: () => void;
  openCreate: () => void;
  openAskMaple: () => void;
  onDeleteSession: (session: Session) => void;
  busy: boolean;
  hideSessionIndex?: boolean;
  hideHeaderActions?: boolean;
  loadingEvents?: boolean;
  loadingSessions?: boolean;
  detailLoadStatus?: { sessionId: string; loading: boolean; slow: boolean; error: string };
  onRetryDetail?: () => void;
}) {
  const { language } = useI18n();
  const L = (zh: string, en: string) => (language === "zh" ? zh : en);

  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "User" | "Agent" | "Tool" | "Error" | "System">("all");
  const [filterOpen, setFilterOpen] = useState(false);
  const eventTableRef = useRef<HTMLDivElement>(null);
  const { openEntity } = useEntityNav();

  const detailMatchesSelection = props.detail?.session.id === props.selectedSession;
  const shellSession = props.sessions.find((item) => item.id === props.selectedSession) ?? null;
  const shellDetail: SessionDetail | null = shellSession
    ? {
        session: shellSession,
        agent: props.agents.find((item) => item.id === shellSession.agent_id) ?? null,
        environment: props.environments.find((item) => item.id === shellSession.environment_id) ?? null,
        vaults: [],
        events: [],
        tool_calls: []
      }
    : null;
  const activeDetail = detailMatchesSelection ? props.detail : shellDetail;
  const session = activeDetail?.session ?? null;
  const events = activeDetail?.events ?? [];
  const timelineEvents = dedupeTranscriptEvents(events);
  // Block re-sending while a turn is in flight. props.busy only covers the POST itself (which
  // returns immediately — the turn runs async), so we also gate on the live session status that
  // the optimistic user message flips to "running" and SSE resets to idle when the turn ends.
  const sessionBusy =
    session?.status === "running" || session?.status === "bootstrapping" || session?.status === "installing_packages";
  const sending = props.busy || sessionBusy;
  const loadStatus = props.detailLoadStatus?.sessionId === props.selectedSession ? props.detailLoadStatus : null;
  const detailLoadError = loadStatus?.error ?? "";
  const loadingDetail = Boolean(props.selectedSession && !detailLoadError && (props.loadingEvents || !detailMatchesSelection));

  const matchedSessions = props.sessions.filter(
    (s) => !query || s.title.toLowerCase().includes(query.toLowerCase()) || s.id.toLowerCase().includes(query.toLowerCase())
  );

  const visibleEvents = timelineEvents.filter((event) => {
    const role = eventRole(event.type, event);
    if (props.eventMode === "transcript") {
      const isFailure = event.type.includes("failed") || event.type.includes("error");
      if (!(role === "User" || role === "Agent" || role === "Tool" || isFailure)) return false;
      if (externalLoopView(event)?.debugOnly) return false;
      // drop the loop's assistant echo; the terminal agent.message (with usage) already shows it
      if (isExternalLoopAgentEcho(event, timelineEvents)) return false;
    }
    if (filter === "all") return true;
    if (filter === "Error") return event.type.includes("failed") || event.type.includes("error");
    if (filter === "System") return role === "Session";
    return role === filter;
  });

  useEffect(() => {
    const node = eventTableRef.current;
    if (!node) return;
    node.scrollTo({ top: node.scrollHeight, behavior: "smooth" });
  }, [visibleEvents.length, session?.status]);

  const EVENT_FILTERS: Array<{ id: typeof filter; label: string; dot?: string }> = [
    { id: "all", label: L("全部事件", "All events") },
    { id: "User", label: L("用户", "User"), dot: "#a8527a" },
    { id: "Agent", label: "Agent", dot: "#3678bd" },
    { id: "Tool", label: L("工具", "Tool"), dot: "#7c828d" },
    { id: "Error", label: L("错误", "Error"), dot: "#b84b5c" },
    { id: "System", label: L("系统", "System"), dot: "#566a52" }
  ];
  const filterLabel = (EVENT_FILTERS.find((f) => f.id === filter) ?? EVENT_FILTERS[0]).label;
  const roleLabel = (role: string) => {
    if (role === "User") return L("用户", "User");
    if (role === "Tool") return L("工具", "Tool");
    if (role === "Session") return L("系统", "System");
    return role;
  };

  const sessionPagination = usePagination(matchedSessions, {
    resetKey: `${query}:${matchedSessions.map((s) => s.id).join("|")}`
  });

  // ↑/↓ keyboard navigation across events (prototype: stepEvent)
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      const tag = (event.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (!visibleEvents.length) return;
      event.preventDefault();
      const index = visibleEvents.findIndex((item) => item.id === props.selectedEventId);
      const base = index < 0 ? 0 : index;
      const nextIndex = event.key === "ArrowDown" ? Math.min(visibleEvents.length - 1, base + 1) : Math.max(0, base - 1);
      const target = visibleEvents[nextIndex];
      if (target) props.setSelectedEventId(target.id);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleEvents, props.selectedEventId]);

  const { copyTranscript, downloadTranscript } = useTranscriptActions(activeDetail, timelineEvents, L);

  return (
    <div className={props.hideSessionIndex ? "session-screen session-screen-embedded" : "session-screen"}>
      <div className="session-header">
        <div>
          <Crumb parts={[{ label: L("会话", "Sessions"), icon: "i-terminal" }, { label: session?.id ?? L("选择会话", "select a session") }]} />
          <h1>
            {session?.title ?? L("会话", "Sessions")} {session ? statusPill(session.status, L) : null}
          </h1>
          <div className="session-meta">
            {(() => {
              const ws = workspaceLabel(props.workspaces, session?.workspace_id);
              return ws ? <button type="button" className="meta-link" onClick={() => openEntity("workspace", ws.id)}><Icon name="i-grid" size={13} /> {ws.name ? <>{ws.name} · </> : null}<span className="mono">{ws.id}</span></button> : null;
            })()}
            {activeDetail?.agent ? (
              <button type="button" className="meta-link" onClick={() => openEntity("agent", activeDetail.agent!.id)}><Icon name="i-brain" size={13} /> {activeDetail.agent.name}</button>
            ) : <span><Icon name="i-brain" size={13} /> {L("无 Agent", "No agent")}</span>}
            {activeDetail?.environment ? (
              <button type="button" className="meta-link" onClick={() => openEntity("environment", activeDetail.environment!.id)}><Icon name="i-cloud" size={13} /> {activeDetail.environment.name}</button>
            ) : <span><Icon name="i-cloud" size={13} /> {L("无环境", "No environment")}</span>}
            {(activeDetail?.vaults ?? []).length ? (
              <button type="button" className="meta-link" onClick={() => { const v = activeDetail?.vaults?.[0]; if (v) openEntity("vault", v.id); }}><Icon name="i-key" size={13} /> {(activeDetail?.vaults ?? []).map((vault) => vault.display_name).join(", ")}</button>
            ) : <span><Icon name="i-key" size={13} /> {L("无密钥库", "No vault")}</span>}
            {session ? <SessionSandboxSummary detail={activeDetail} L={L} /> : null}
            {session ? <span><Icon name="i-clock" size={13} /> {formatRelativeTime(session.updated_at, language)}</span> : null}
          </div>
          {session?.status === "running" || session?.status === "bootstrapping" || session?.status === "created" ? (
            <div className="run-hint">
              <Icon name="i-bolt" size={12} />{" "}
              {session.status === "running"
                ? L("运行中 · 实时事件流", "Running · live event stream")
                : L("环境启动中 · 正在准备沙箱", "Bootstrapping · preparing the sandbox")}
              <span className="track"><i /></span>
            </div>
          ) : null}
          <SessionPackageInstall detail={activeDetail} L={L} />
        </div>
        {props.hideHeaderActions ? null : (
        <div className="action-row session-header-actions">
          <button className="btn secondary" onClick={props.openAskMaple} disabled={!props.selectedSession}>
            <Icon name="i-sparkles" size={15} /> Ask Maple
          </button>
          <button className="btn primary" onClick={props.openCreate}>
            <Icon name="i-plus" size={15} /> {L("新建 Session", "New session")}
          </button>
        </div>
        )}
      </div>

      <div className={props.hideSessionIndex ? "session-body no-session-index" : "session-body"}>
        {props.hideSessionIndex ? null : (
        <aside className="session-index">
          <div className="search-box">
            <Icon name="i-search" size={15} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={L("跳转 Session ID", "Go to session ID")}
            />
          </div>
          {props.loadingSessions && !sessionPagination.pageItems.length ? (
            <div className="panel-empty session-index-loading" role="status" aria-live="polite" aria-busy="true">
              <span className="spin-dot" /> {L("加载会话中…", "Loading sessions...")}
            </div>
          ) : sessionPagination.pageItems.length ? (
            sessionPagination.pageItems.map((s) => (
              <div key={s.id} className={s.id === props.selectedSession ? "session-pill active" : "session-pill"}>
                <button type="button" className="session-pill-main" onClick={() => props.setSelectedSession(s.id)}>
                  <div className="row1">
                    <b>{s.title}</b>
                    {statusPill(s.status, L)}
                  </div>
                  <small>{s.id} · {formatRelativeTime(s.updated_at, language)}</small>
                </button>
                <button
                  type="button"
                  className="session-delete"
                  title={L("删除 Session", "Delete session")}
                  aria-label={L("删除 Session", "Delete session")}
                  onClick={(event) => {
                    event.stopPropagation();
                    props.onDeleteSession(s);
                  }}
                >
                  <Icon name="i-trash" size={13} />
                </button>
              </div>
            ))
          ) : (
            <div className="panel-empty">{L("无匹配会话", "No matching session")}</div>
          )}
          <PaginationControls {...sessionPagination} className="session-pagination" />
        </aside>
        )}

        <section className={loadingDetail ? "transcript-panel loading" : "transcript-panel"} aria-busy={loadingDetail}>
          <div className="transcript-toolbar">
            <div className="seg">
              <button className={props.eventMode === "transcript" ? "on" : ""} onClick={() => props.setEventMode("transcript")}>{L("对话", "Transcript")}</button>
              <button className={props.eventMode === "debug" ? "on" : ""} onClick={() => props.setEventMode("debug")}>{L("调试", "Debug")}</button>
            </div>
            <div className="filter-wrap">
              <button className="filter-btn" onClick={() => setFilterOpen((open) => !open)}>
                <Icon name="i-filter" size={14} /> <span className="cur">{filterLabel}</span> <Icon name="i-chevron-down" size={13} />
              </button>
              <div className={filterOpen ? "dropdown open" : "dropdown"}>
                {EVENT_FILTERS.map((f) => (
                  <button
                    key={f.id}
                    className={filter === f.id ? "on" : ""}
                    onClick={() => {
                      setFilter(f.id);
                      setFilterOpen(false);
                    }}
                  >
                    <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      {f.dot ? <span className="dot" style={{ background: f.dot }} /> : null}
                      {f.label}
                    </span>
                    <Icon name="i-check" size={15} />
                  </button>
                ))}
              </div>
            </div>
            <div className="tt-actions">
              <button className="icon-btn" title={L("复制对话", "Copy transcript")} onClick={copyTranscript} disabled={!activeDetail}>
                <Icon name="i-copy" size={16} />
              </button>
              <button className="icon-btn" title={L("下载对话", "Download transcript")} onClick={downloadTranscript} disabled={!activeDetail}>
                <Icon name="i-download" size={16} />
              </button>
            </div>
          </div>

          <div className="event-bars">
            {visibleEvents.slice(0, 64).map((event) => (
              <i
                key={event.id}
                className={`${eventBarClass(event)}${event.id === props.selectedEventId ? " active" : ""}`}
                title={eventTitle(event)}
                onClick={() => props.setSelectedEventId(event.id)}
              />
            ))}
          </div>

          <SessionLoadState error={detailLoadError} loading={loadingDetail} slow={Boolean(loadStatus?.slow)} sessionId={props.selectedSession} onRetry={props.onRetryDetail} L={L} />

          <div className="event-table" ref={eventTableRef}>
            {visibleEvents.length ? (
              visibleEvents.map((event) => {
                const role = eventRole(event.type, event);
                return (
                  <button
                    key={event.id}
                    className={event.id === props.selectedEventId ? "event-row selected" : "event-row"}
                    onClick={() => props.setSelectedEventId(event.id)}
                  >
                    <span className={`role ${role}`}>{roleLabel(role)}</span>
                    <b title={eventTitle(event)}>{eventTitle(event)}</b>
                    <span className="usage-chip">{eventUsageLabel(event)}</span>
                    <small>{formatTime(event.created_at)}</small>
                  </button>
                );
              })
            ) : (
              <div className="panel-empty" style={{ margin: "18px 24px" }}>
                {props.loadingEvents
                  ? L("正在加载事件…", "Loading events...")
                  : activeDetail
                    ? L("该筛选下没有事件。", "No events under this filter.")
                    : L("选择一个会话以查看事件。", "Select a session to view events.")}
              </div>
            )}
            {session?.status === "running" ? (
              <div className="event-row" style={{ cursor: "default" }}>
                <span className="role Agent">Agent</span>
                <b><span className="typing"><i /><i /><i /></span></b>
                <span className="usage-chip" />
                <small>{runningSessionLabel(events, L)}</small>
              </div>
            ) : null}
          </div>

          <SessionComposer
            sessionId={props.selectedSession}
            message={props.message}
            setMessage={props.setMessage}
            sendMessage={props.sendMessage}
            sending={sending}
            placeholder={composerPlaceholder(session?.status, L)}
          />
        </section>

        <aside className="event-detail" id="event-detail">
          <div className="detail-title">
            <b title={props.selectedEvent ? eventTitle(props.selectedEvent) : L("事件详情", "Event details")}>{props.selectedEvent ? eventTitle(props.selectedEvent) : L("事件详情", "Event details")}</b>
          </div>
          {props.selectedEvent ? (
            <>
              <div className="detail-meta">
                {[props.selectedEvent.type, props.selectedEvent.provider_event_type].filter(Boolean).join(" · ")}
              </div>
              {isToolTraceEvent(props.selectedEvent) ? (
                <SessionToolEventDetail event={props.selectedEvent} detail={activeDetail} debug={props.eventMode === "debug"} L={L} />
              ) : props.eventMode === "debug" ? (
                <pre>{JSON.stringify(props.selectedEvent.payload, null, 2)}</pre>
              ) : (
                <div className="detail-content"><MarkdownText text={renderEventContent(props.selectedEvent)} /></div>
              )}
            </>
          ) : (
            <>
              <div className="detail-meta" />
              <div className="panel-empty" style={{ margin: "18px" }}>{L("未选择事件。", "No event selected.")}</div>
            </>
          )}
        </aside>
      </div>
      {null}
    </div>
  );
}

import { useEffect, useMemo, useState } from "react";
import { apiGet, apiPost } from "../../api";
import { useI18n } from "../../appConfig";
import { useSessionEventStream } from "../../app/useSessionEventStream";
import { errorMessage } from "../../components/shared/misc";
import type { SessionDetail } from "../../types";
import { DrawerLayer, Icon } from "../../ui";
import { AskMapleTranscript } from "./AskMapleTranscript";
import { buildSessionAnalysis } from "./SessionAnalysis";

const SUGGESTIONS = [
  { id: "summarize", zhLabel: "总结上下文", enLabel: "Summarize context", zhQuestion: "总结这个 session 的上下文和当前状态", enQuestion: "Summarize this session's context and current status" },
  { id: "tools", zhLabel: "解释工具调用", enLabel: "Explain tool calls", zhQuestion: "解释这个 session 里工具调用做了什么", enQuestion: "Explain what the tool calls did in this session" },
  { id: "failure", zhLabel: "排查失败", enLabel: "Troubleshoot failure", zhQuestion: "如果这个 session 失败了，原因是什么", enQuestion: "If this session failed, what caused it?" }
];

const ACTIVE_ASK_STATUSES = new Set(["created", "running"]);

export function AskMapleDrawer({ detail, sessionId, onClose }: { detail: SessionDetail | null; sessionId?: string; onClose: () => void }) {
  const { language, t } = useI18n();
  const L = (zh: string, en: string) => (language === "zh" ? zh : en);
  const [question, setQuestion] = useState("");
  const [askSessionId, setAskSessionId] = useState("");
  const [askDetail, setAskDetail] = useState<SessionDetail | null>(null);
  const [asking, setAsking] = useState(false);
  const [askError, setAskError] = useState("");
  const [contextOpen, setContextOpen] = useState(false);
  const [optimisticQuestion, setOptimisticQuestion] = useState("");
  const targetSessionId = detail?.session.id || sessionId || "";
  const analysis = useMemo(() => buildSessionAnalysis(detail, ""), [detail]);
  const contextItems = [
    { label: "Session ID", value: targetSessionId || "-" },
    { label: L("状态", "Status"), value: detail?.session.status ?? "-" },
    { label: "Agent", value: detail?.agent?.name ?? "-" },
    { label: L("环境", "Environment"), value: detail?.environment?.name ?? "-" },
    { label: L("事件", "Events"), value: String(detail?.events.length ?? 0) },
    { label: L("工具", "Tools"), value: String(detail?.tool_calls.length ?? 0) }
  ];

  useEffect(() => {
    setAskSessionId("");
    setAskDetail(null);
    setAskError("");
    setContextOpen(false);
    setOptimisticQuestion("");
  }, [targetSessionId]);

  // The ask turn streams reasoning + answer over the ask session's SSE; pull its detail on every
  // event. The turn is settled once the ask session leaves created/running.
  useSessionEventStream(askSessionId, () => {
    if (!askSessionId) return;
    apiGet<SessionDetail>(`/v1/sessions/${askSessionId}/detail`, { timeoutMs: 12_000 })
      .then((next) => {
        setAskDetail(next);
        if (!ACTIVE_ASK_STATUSES.has(String(next.session.status ?? ""))) setAsking(false);
      })
      .catch((reason: unknown) => console.warn("[ask-maple stream]", errorMessage(reason)));
  });

  async function ask(nextQuestion = question.trim() || L(SUGGESTIONS[0].zhQuestion, SUGGESTIONS[0].enQuestion)) {
    if (!targetSessionId || asking) return;
    setQuestion(nextQuestion);
    setAsking(true);
    setAskError("");
    setAskDetail(null);
    setOptimisticQuestion(nextQuestion);
    try {
      const response = await apiPost<{ ask_session_id?: string }>(`/v1/ask_maple/sessions/${targetSessionId}/message`, { question: nextQuestion });
      if (!response.ask_session_id) throw new Error("ask_maple_session_missing");
      setAskSessionId(response.ask_session_id);
      const detail = await apiGet<SessionDetail>(`/v1/sessions/${response.ask_session_id}/detail`, { timeoutMs: 12_000 });
      setAskDetail(detail);
    } catch (reason) {
      setAskError(errorMessage(reason));
      setAsking(false);
    }
  }

  return (
    <DrawerLayer onClose={onClose}>
      <aside className="ask-drawer ask-chat-drawer">
        <div className="drawer-head">
          <div>
            <b>{t("ask.title")}</b>
            <span>{t("ask.subtitle")}</span>
          </div>
          <div className="drawer-head-actions">
            <button
              type="button"
              className={contextOpen ? "btn secondary compact ask-info-toggle on" : "btn secondary compact ask-info-toggle"}
              onClick={() => setContextOpen((open) => !open)}
              disabled={!targetSessionId}
            >
              <Icon name="i-info" size={14} /> {t("ask.sessionInfo")}
            </button>
            <button className="x" onClick={onClose} aria-label={L("关闭", "Close")}><Icon name="i-x" size={18} /></button>
          </div>
        </div>
        {!targetSessionId ? (
          <div className="empty-state">{t("ask.noSession")}</div>
        ) : (
          <>
          <div className="ask-body ask-chat-body" aria-label={t("ask.conversation")}>
              <div className="ask-chat-stream">
                {askSessionId || optimisticQuestion ? (
                  <AskMapleTranscript events={askDetail?.events ?? []} working={asking} optimisticQuestion={optimisticQuestion} />
                ) : <div className="ask-empty-conversation">{t("ask.conversationEmpty")}</div>}
              </div>
          </div>

          <div className="ask-composer-wrap">
            {askError ? <div className="error">{askError}</div> : null}
            <div className="ask-actions">
              {SUGGESTIONS.map((item) => (
                <button className="btn secondary compact" key={item.id} onClick={() => void ask(L(item.zhQuestion, item.enQuestion))} disabled={asking}>
                  {L(item.zhLabel, item.enLabel)}
                </button>
              ))}
            </div>
            <div className="ask-input">
              <input
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void ask();
                  }
                }}
                placeholder={t("ask.placeholder")}
              />
              <button className="go" onClick={() => void ask()} disabled={!targetSessionId || asking} aria-label={t("ask.title")}>
                {asking ? <span className="typing"><i /><i /><i /></span> : <Icon name="i-send" size={16} />}
              </button>
            </div>
          </div>

          {contextOpen ? (
            <>
            <button type="button" className="ask-info-backdrop" aria-label={L("关闭", "Close")} onClick={() => setContextOpen(false)} />
            <aside className="ask-session-panel" aria-label={t("ask.sessionInfo")}>
              <div className="ask-session-panel-head">
                <div>
                  <b>{t("ask.sessionInfo")}</b>
                  <span>{detail?.session.title || targetSessionId}</span>
                </div>
                <span className="ask-status-pill">{detail?.session.status ?? "-"}</span>
                <button className="x" onClick={() => setContextOpen(false)} aria-label={L("关闭", "Close")}><Icon name="i-x" size={18} /></button>
              </div>
              <div className="ask-session-panel-body">
              <div className="ask-context-list">
                {contextItems.map((item) => (
                  <div className="ask-context-item" key={item.label}>
                    <span>{item.label}</span>
                    <b>{item.value}</b>
                  </div>
                ))}
              </div>

              <section className="ask-section ask-signals-panel" aria-label={t("ask.activitySignals")}>
              <div className="ask-section-head">
                <div>
                  <b>{t("ask.activitySignals")}</b>
                  <span>{t("ask.context")}</span>
                </div>
              </div>
              <section className="acard">
                <h3>{t("ask.eventMix")}</h3>
                <div className="mini-chart">
                  {analysis.eventCounts.map((item) => (
                    <div className="mc-row" key={item.type}>
                      <span>{item.type}</span>
                      <div className="track"><i style={{ width: `${item.percent}%` }} /></div>
                      <b>{item.count}</b>
                    </div>
                  ))}
                </div>
              </section>
              <section className="acard">
                <h3>{t("ask.toolCalls")}</h3>
                {analysis.toolRows.length ? (
                  <table className="ctable">
                    <thead><tr><th>{L("工具", "Tool")}</th><th>{L("状态", "Status")}</th><th>{L("耗时", "Latency")}</th><th>{L("详情", "Details")}</th></tr></thead>
                    <tbody>
                      {analysis.toolRows.map((row) => (
                        <tr key={row.id}>
                          <td><b>{row.name}</b><small>{row.eventId || row.id}</small></td>
                          <td>{row.status}</td>
                          <td>{row.latency}</td>
                          <td>
                            <details className="tool-detail-pop">
                              <summary>{L("查看", "Open")}</summary>
                              <div className="tool-detail-code">
                                <b>input</b>
                                <pre>{prettyToolValue(row.input)}</pre>
                                <b>output</b>
                                <pre>{prettyToolValue(row.output)}</pre>
                              </div>
                            </details>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : <div className="empty-state">{L("没有工具调用。", "No tool calls.")}</div>}
              </section>
              <section className="acard">
                <h3>{t("ask.references")}</h3>
                {analysis.references.length ? (
                  <div className="reference-grid">
                    {analysis.references.map((ref) => (
                      ref.kind === "image" ? (
                        <a href={ref.url} target="_blank" rel="noreferrer" key={ref.url}><img src={ref.url} alt={ref.url} /></a>
                      ) : (
                        <a className="rich-link" href={ref.url} target="_blank" rel="noreferrer" key={ref.url}>{ref.url}</a>
                      )
                    ))}
                  </div>
                ) : <div className="empty-state">{t("ask.noReferences")}</div>}
              </section>
              </section>
              </div>
            </aside>
            </>
          ) : null}
          </>
        )}
      </aside>
    </DrawerLayer>
  );
}

function prettyToolValue(value: unknown) {
  if (value === undefined || value === null) return "null";
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
}

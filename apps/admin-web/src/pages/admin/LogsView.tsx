import { useEffect, useState } from "react";
import { apiGet } from "../../api";
import { useI18n } from "../../appConfig";
import { PageFrame } from "../../components/shared/layout";

export function LogsView() {
  const { language } = useI18n();
  const L = (zh: string, en: string) => (language === "zh" ? zh : en);
  const [events, setEvents] = useState<Array<{ id: string; type: string; created_at: string; session_id: string }>>([]);
  useEffect(() => {
    apiGet<{ recent: Array<{ id: string; type: string; created_at: string; session_id: string }> }>("/v1/analytics/overview")
      .then((data) => setEvents(data.recent || []))
      .catch(() => {});
  }, []);
  const level = (type: string) => (/fail|error|5xx/.test(type) ? "err" : /warn/.test(type) ? "warn" : "info");
  return (
    <PageFrame
      title={L("日志", "Logs")}
      sub={L("平台事件流，跨会话聚合（实时）。", "Live platform event stream across sessions.")}
    >
      {events.length ? (
        <div className="log-list">
          {events.map((event) => (
            <div className="log-line" key={event.id}>
              <span className="ts">{event.created_at ? new Date(event.created_at).toLocaleTimeString(language === "zh" ? "zh-CN" : "en-US") : "—"}</span>
              <span className={`lv ${level(event.type)}`}>{level(event.type).toUpperCase()}</span>
              <span className="msg">{event.type} · <span className="mono">{event.session_id}</span></span>
            </div>
          ))}
        </div>
      ) : (
        <div className="panel-empty">{L("暂无事件。运行一个会话后这里会出现实时事件流。", "No events yet — run a session and the live event stream appears here.")}</div>
      )}
    </PageFrame>
  );
}

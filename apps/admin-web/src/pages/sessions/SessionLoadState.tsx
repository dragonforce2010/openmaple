import { Icon } from "../../ui";

export function SessionLoadState(props: {
  error: string;
  loading: boolean;
  slow: boolean;
  sessionId: string;
  onRetry?: () => void;
  L: (zh: string, en: string) => string;
}) {
  if (props.error) {
    return (
      <div className="session-load-note error" role="alert">
        <Icon name="i-alert" size={15} />
        <span>
          <b>{props.L("Session 详情加载失败", "Session detail failed")}</b>
          <small>{props.error}</small>
        </span>
        {props.onRetry ? <button type="button" className="btn secondary" onClick={props.onRetry}>{props.L("重试", "Retry")}</button> : null}
      </div>
    );
  }
  if (!props.loading) return null;
  return (
    <div className="session-loading-overlay" role="status" aria-live="polite">
      <span className="spin-dot" />
      <b>{props.slow ? props.L("Session 详情接口仍在等待远程数据…", "Session detail is still waiting on remote data...") : props.L("正在加载 Session 详情…", "Loading session detail...")}</b>
      <span className="mono">{props.sessionId}</span>
      {props.slow ? <small>{props.L("已显示概要信息；events/tool_calls 返回后会自动补齐。", "Showing shell data; events/tool_calls will fill in when the API returns.")}</small> : null}
      <div className="session-detail-skeleton">
        <i /><i /><i />
      </div>
    </div>
  );
}

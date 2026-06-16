import { Icon } from "../../ui";

type LFn = (zh: string, en: string) => string;

export type ProvisioningLog = {
  at: string;
  level: "info" | "warn" | "err";
  message: string;
};

export function ProvisioningLogPanel(props: { logs: ProvisioningLog[]; active: boolean; L: LFn }) {
  if (!props.logs.length) return null;
  return (
    <div className="provision-log-panel" aria-live="polite">
      <div className="provision-log-head">
        <span>{props.active ? <span className="spin-dot" /> : <Icon name="i-check" size={14} />}</span>
        <b>{props.L("初始化日志", "Provisioning logs")}</b>
      </div>
      <div className="log-list provision-log-list">
        {props.logs.map((log, index) => (
          <div className="log-line" key={`${log.at}-${index}`}>
            <span className="ts">{log.at}</span>
            <span className={`lv ${log.level}`}>{log.level}</span>
            <span className="msg">{log.message}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function provisioningLog(level: ProvisioningLog["level"], message: string): ProvisioningLog {
  return { at: new Date().toLocaleTimeString([], { hour12: false }), level, message };
}

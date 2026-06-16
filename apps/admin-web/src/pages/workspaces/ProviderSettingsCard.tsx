import { useL } from "../../appConfig";
import { maskSecret } from "../../components/shared/code";
import { recordFromUnknown } from "../../components/shared/events";
import { Icon, useToast } from "../../ui";

export function ProviderSettingsCard(props: {
  icon: string;
  title: string;
  subtitle: string;
  active: boolean;
  fields: string[];
  snapshot?: unknown;
  onDetails?: () => void;
}) {
  const L = useL();
  const toast = useToast();
  const configured = Array.isArray(props.snapshot) ? props.snapshot.length > 0 : Boolean(props.snapshot);
  const snapshot = recordFromUnknown(props.snapshot);
  const rawValue = (field: string) => {
    const raw = snapshot[field];
    return typeof raw === "string" || typeof raw === "number" ? String(raw) : "";
  };
  const displayValue = (field: string) => {
    const text = rawValue(field);
    if (!configured) return L("为空", "Empty");
    if (!text) return L("已配置", "Configured");
    const secret = /SECRET|API_KEY|TOKEN|PASSWORD|_SK$/i.test(field) && !/ACCESS_KEY$/i.test(field);
    return secret ? maskSecret(text) : text;
  };
  function copyField(field: string) {
    const text = rawValue(field);
    if (!text) return;
    try {
      navigator.clipboard?.writeText(text);
    } catch {
      /* clipboard unavailable */
    }
    toast(L("已复制", "Copied"), "ok");
  }
  return (
    <section className={props.active ? "prov-card on provider-settings-card" : "prov-card disabled provider-settings-card"}>
      <div className="pc-ic"><Icon name={props.icon} size={18} /></div>
      <b>{props.title}</b>
      <span>{props.subtitle}</span>
      <span className="pc-state">{props.active ? "Active" : "Unavailable"}</span>
      {props.onDetails ? (
        <button type="button" className="provider-detail-btn" onClick={props.onDetails}>
          <Icon name="i-chevron-right" size={14} />
          {L("详情", "Details")}
        </button>
      ) : null}
      {props.fields.length ? (
        <div className="provider-secret-list">
          {props.fields.map((field) => (
            <div className="provider-secret-row" key={field}>
              <code className="mono">{field}</code>
              <span className={configured ? undefined : "secret-empty"} title={displayValue(field)}>{displayValue(field)}</span>
              <button className="icon-btn tiny" title={L("复制", "Copy")} disabled={!rawValue(field)} onClick={() => copyField(field)}><Icon name="i-copy" size={13} /></button>
            </div>
          ))}
        </div>
      ) : (
        <div className="empty-state">{L("该 Provider 在原型可见，但本版本未启用。", "Provider is visible in the prototype but not enabled in this build.")}</div>
      )}
    </section>
  );
}

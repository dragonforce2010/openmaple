import type { JsonRecord, SessionDetail } from "../../types";
import { Icon, useToast } from "../../ui";
import {
  providerLabel,
  record,
  runtimeFunctionId,
  runtimeGatewayUrl,
  runtimeInvokeUrl,
  runtimeRegion,
  runtimeStatus,
  sandboxRuntime,
  shortValue,
  statusClass,
  stringValue,
  vefaasSandboxInstanceConsoleHref
} from "./sessionRuntimeInfo";

type LFn = (zh: string, en: string) => string;

export function SessionSandboxDetail({ detail, L, onOpenPool }: { detail: SessionDetail | null; L: LFn; onOpenPool: (() => void) | null }) {
  const toast = useToast();
  const runtime = sandboxRuntime(detail);
  const provider = providerLabel(runtime, detail);
  const status = runtimeStatus(detail, runtime);
  const sandboxId = stringValue(runtime.sandbox_id || runtime.container_id);
  const functionId = runtimeFunctionId(detail, runtime);
  const gatewayUrl = runtimeGatewayUrl(detail, runtime);
  const invokeUrl = runtimeInvokeUrl(detail, runtime);
  const consoleHref = vefaasSandboxInstanceConsoleHref(functionId, runtimeRegion(detail, runtime));
  const rows = detailRows({ sandboxId, functionId, gatewayUrl, invokeUrl, runtime });
  const copy = (value: string) => {
    if (!value || value === "-") return;
    try {
      navigator.clipboard?.writeText(value);
    } catch {
      /* clipboard unavailable */
    }
    toast(L("已复制", "Copied"), "ok");
  };

  return (
    <div className="sandbox-detail">
      <section className="runtime-pool-card sandbox-detail-card">
        <div className="runtime-pool-head">
          <span className="runtime-pool-provider">
            <Icon name="i-cloud" size={15} />
            <b>{provider}</b>
            {sandboxId ? <code className="mono">{shortValue(sandboxId, 26)}</code> : null}
          </span>
          {status ? <b className={`status ${statusClass(status)}`}>{status}</b> : null}
        </div>
        <div className="runtime-stat-grid sandbox-stat-grid">
          <Metric label="sandbox_id" value={sandboxId || "-"} rawValue={sandboxId} onCopy={copy} L={L} />
          <Metric label="function_id" value={functionId || "-"} rawValue={functionId} href={consoleHref} onCopy={copy} L={L} />
          <Metric label="gateway_url" value={gatewayUrl ? shortValue(gatewayUrl, 34) : "-"} rawValue={gatewayUrl} href={gatewayUrl} onCopy={copy} L={L} />
        </div>
      </section>

      <section className="runtime-member-card sandbox-detail-card">
        <div className="runtime-member-head">
          <span><Icon name="i-server" size={14} /> {L("执行沙箱", "Execution sandbox")}</span>
        </div>
        {rows.length ? rows.map((row) => <DetailRow key={row.label} {...row} onCopy={copy} L={L} />) : <div className="panel-empty">{L("该会话尚未绑定运行中的沙箱。", "No running sandbox is bound to this session yet.")}</div>}
      </section>

      <div className="sandbox-detail-actions">
        <button type="button" className="btn secondary" onClick={() => onOpenPool?.()} disabled={!onOpenPool}>
          <Icon name="i-server" size={15} /> {L("查看所属沙箱池", "View sandbox pool")}
        </button>
      </div>
      {!onOpenPool ? <em className="fhint">{L("缺少工作区信息,无法定位沙箱池。", "Missing workspace context — cannot locate the sandbox pool.")}</em> : null}
    </div>
  );
}

function detailRows(input: { sandboxId: string; functionId: string; gatewayUrl: string; invokeUrl: string; runtime: JsonRecord }) {
  const consoleHref = vefaasSandboxInstanceConsoleHref(input.functionId, stringValue(input.runtime.region) || "cn-beijing");
  const rows: Array<{ label: string; value: string; href?: string }> = [
    { label: "sandbox_id", value: input.sandboxId },
    { label: "function_id", value: input.functionId, href: consoleHref },
    { label: "gateway_url", value: input.gatewayUrl, href: input.gatewayUrl },
    { label: "invoke_url", value: input.invokeUrl, href: input.invokeUrl },
    { label: "workspace_path", value: stringValue(input.runtime.sandbox_workspace_path || input.runtime.workspace_path) }
  ];
  const config = record(input.runtime.config);
  for (const key of ["claimed_session_id", "claimed_agent_id"]) {
    const value = stringValue(input.runtime[key] || config[key]);
    if (value) rows.push({ label: key, value });
  }
  return rows.filter((row) => row.value.trim());
}

function DetailRow({ label, value, href, onCopy, L }: { label: string; value: string; href?: string; onCopy: (value: string) => void; L: LFn }) {
  return (
    <div className="runtime-detail-row">
      <span>{label}</span>
      <b>
        {href ? <a href={href} target="_blank" rel="noreferrer" title={href}>{shortValue(value, 72)}</a> : value}
        <button type="button" className="icon-btn mini copy-inline" onClick={() => onCopy(value)} title={L("复制", "Copy")}><Icon name="i-copy" size={12} /></button>
        {href ? <a className="icon-btn mini copy-inline" href={href} target="_blank" rel="noreferrer" title={L("打开", "Open")}><Icon name="i-arrow-up" size={12} /></a> : null}
      </b>
    </div>
  );
}

function Metric({ label, value, rawValue, href, onCopy, L }: { label: string; value: string; rawValue?: string; href?: string; onCopy: (value: string) => void; L: LFn }) {
  const content = href && rawValue ? <a href={href} target="_blank" rel="noreferrer" title={href}>{value}</a> : value;
  return (
    <div className="runtime-stat">
      <span>{label}</span>
      <b>{content}</b>
      <em><button type="button" className="icon-btn mini copy-inline" onClick={() => onCopy(rawValue || value)} title={L("复制", "Copy")}><Icon name="i-copy" size={12} /></button></em>
    </div>
  );
}

import { useState } from "react";
import type { JsonRecord, SessionDetail, SessionEvent, ToolCall } from "../../types";
import { DrawerLayer, Icon, useToast } from "../../ui";
import { PoolMembersDrawer } from "../workspaces/PoolMembersDrawer";
import { SessionSandboxDetail } from "./SessionSandboxDetail";
import {
  providerLabel,
  record,
  runtimeFunctionId,
  runtimeGatewayUrl,
  runtimeRegion,
  runtimeStatus,
  sandboxRuntime,
  shortValue,
  statusClass,
  stringValue,
  vefaasSandboxInstanceConsoleHref
} from "./sessionRuntimeInfo";

type LFn = (zh: string, en: string) => string;

export function SessionToolEventDetail({ event, detail, debug, L }: { event: SessionEvent; detail: SessionDetail | null; debug: boolean; L: LFn }) {
  const toast = useToast();
  const [sandboxOpen, setSandboxOpen] = useState(false);
  const [poolOpen, setPoolOpen] = useState(false);
  const call = toolCallForEvent(event, detail);
  const payload = record(event.payload);
  const input = record(call?.input || payload.input || payload.arguments);
  const output = call?.output ?? payload.output ?? null;
  const runtime = sandboxRuntime(detail);
  const sandboxId = stringValue(runtime.sandbox_id || runtime.container_id);
  const functionId = runtimeFunctionId(detail, runtime);
  const gatewayUrl = runtimeGatewayUrl(detail, runtime);
  const consoleHref = vefaasSandboxInstanceConsoleHref(functionId, runtimeRegion(detail, runtime));
  const workspaceId = detail?.session.workspace_id ?? "";
  const status = toolStatus(event, call, output);
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
    <div className="tool-event-detail">
      <section className="tool-event-hero">
        <div>
          <span><Icon name="i-terminal" size={15} /> {call?.tool_name || stringValue(payload.name) || "tool"}</span>
          <code>{call?.id || toolEventId(payload) || event.id}</code>
        </div>
        <b className={`status ${statusClass(status)}`}>{status}</b>
      </section>

      <section className="tool-event-grid">
        <Stat label="event_id" value={event.id} onCopy={copy} L={L} />
        <Stat label="permission" value={call?.permission_policy || stringValue(payload.permission_policy) || "allow"} onCopy={copy} L={L} />
        <Stat label="sandbox_id" value={sandboxId || "-"} onCopy={copy} L={L} />
        <Stat label="function_id" value={functionId || "-"} href={consoleHref} onCopy={copy} L={L} />
      </section>

      <section className="tool-runtime-card">
        <div className="runtime-member-head">
          <span><Icon name="i-cloud" size={14} /> {providerLabel(runtime, detail)}</span>
          {runtimeStatus(detail, runtime) ? <b className={`status ${statusClass(runtimeStatus(detail, runtime))}`}>{runtimeStatus(detail, runtime)}</b> : null}
        </div>
        <RuntimeRow label="sandbox_id" value={sandboxId || "-"} onCopy={copy} L={L} />
        <RuntimeRow label="function_id" value={functionId || "-"} href={consoleHref} onCopy={copy} L={L} />
        <RuntimeRow label="gateway_url" value={gatewayUrl ? shortValue(gatewayUrl, 72) : "-"} rawValue={gatewayUrl} href={gatewayUrl} onCopy={copy} L={L} />
        <div className="tool-runtime-actions">
          <button type="button" className="btn secondary" onClick={() => setSandboxOpen(true)} disabled={!detail}>
            <Icon name="i-server" size={15} /> {L("查看沙箱详情", "Sandbox detail")}
          </button>
        </div>
      </section>

      <CodeBlock title={input.command ? "bash command" : "tool input"} value={input.command ? stringValue(input.command) : input} />
      {output != null ? <CodeBlock title="tool output" value={output} /> : null}
      {debug ? <CodeBlock title="event payload" value={event.payload} /> : null}

      {sandboxOpen ? (
        <DrawerLayer onClose={() => setSandboxOpen(false)} className="nested-drawer-layer">
          <aside className="ask-drawer pool-detail-drawer" role="dialog" aria-modal="true" aria-label={L("沙箱详情", "Sandbox detail")}>
            <div className="drawer-head">
              <div><b>{L("沙箱详情", "Sandbox detail")}</b><span>{sandboxId || functionId || providerLabel(runtime, detail)}</span></div>
              <button className="x" onClick={() => setSandboxOpen(false)} aria-label={L("关闭", "Close")}><Icon name="i-x" size={18} /></button>
            </div>
            <div className="pool-drawer-body">
              <SessionSandboxDetail detail={detail} L={L} onOpenPool={workspaceId ? () => setPoolOpen(true) : null} />
            </div>
          </aside>
        </DrawerLayer>
      ) : null}
      {poolOpen && workspaceId ? <PoolMembersDrawer target={{ kind: "sandbox", status: "claimed" }} workspaceId={workspaceId} L={L} onClose={() => setPoolOpen(false)} highlightSessionId={detail?.session.id} /> : null}
    </div>
  );
}

export function isToolTraceEvent(event: SessionEvent | null) {
  if (!event) return false;
  return event.type === "agent.tool_use" || event.type === "agent.custom_tool_use" || event.type === "tool.result" || event.provider_event_type === "tool_use" || event.provider_event_type === "tool_result";
}

function toolCallForEvent(event: SessionEvent, detail: SessionDetail | null): ToolCall | null {
  const id = toolEventId(record(event.payload));
  return detail?.tool_calls.find((call) => call.id === id) ?? null;
}

function toolStatus(event: SessionEvent, call: ToolCall | null, output: unknown) {
  if (call?.status) return call.status;
  const payload = record(event.payload);
  return stringValue(payload.status) || (event.type.includes("result") ? (record(output).error ? "failed" : "completed") : "running");
}

function toolEventId(payload: JsonRecord) {
  return stringValue(payload.id || payload.tool_use_id || payload.custom_tool_use_id);
}

function RuntimeRow({ label, value, rawValue, href, onCopy, L }: { label: string; value: string; rawValue?: string; href?: string; onCopy: (value: string) => void; L: LFn }) {
  return (
    <div className="runtime-detail-row">
      <span>{label}</span>
      <b>
        {href ? <a href={href} target="_blank" rel="noreferrer" title={href}>{value}</a> : value}
        <button type="button" className="icon-btn mini copy-inline" onClick={() => onCopy(rawValue || value)} title={L("复制", "Copy")}><Icon name="i-copy" size={12} /></button>
        {href ? <a className="icon-btn mini copy-inline" href={href} target="_blank" rel="noreferrer" title={L("打开", "Open")}><Icon name="i-arrow-up" size={12} /></a> : null}
      </b>
    </div>
  );
}

function Stat({ label, value, href, onCopy, L }: { label: string; value: string; href?: string; onCopy: (value: string) => void; L: LFn }) {
  return (
    <div className="tool-event-stat">
      <span>{label}</span>
      <b>
        {href ? <a href={href} target="_blank" rel="noreferrer" title={href}>{shortValue(value, 34)}</a> : shortValue(value, 34)}
        <button type="button" className="icon-btn mini copy-inline" onClick={() => onCopy(value)} title={L("复制", "Copy")}><Icon name="i-copy" size={12} /></button>
        {href ? <a className="icon-btn mini copy-inline" href={href} target="_blank" rel="noreferrer" title={L("打开", "Open")}><Icon name="i-arrow-up" size={12} /></a> : null}
      </b>
    </div>
  );
}

function CodeBlock({ title, value }: { title: string; value: unknown }) {
  return (
    <section className="tool-event-code">
      <b>{title}</b>
      <pre>{pretty(value)}</pre>
    </section>
  );
}

function pretty(value: unknown) {
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
}

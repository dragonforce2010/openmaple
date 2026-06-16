import { useState } from "react";
import type { JsonRecord, SessionDetail } from "../../types";
import { DrawerLayer, Icon } from "../../ui";
import { PoolMembersDrawer } from "../workspaces/PoolMembersDrawer";
import { SessionSandboxDetail } from "./SessionSandboxDetail";

type LFn = (zh: string, en: string) => string;

type SandboxSummary = {
  provider: string;
  status: string;
  statusClass: string;
  icon: string;
  handle: string;
  title: string;
  details: Array<{ label: string; value: string }>;
};

// The header chip is clickable: it opens a read-only sandbox detail drawer, which
// in turn can drill into the workspace's sandbox pool (claimed members) so the user
// can see the pool entry backing this session.
export function SessionSandboxSummary({ detail, L }: { detail: SessionDetail | null; L: LFn }) {
  const summary = sandboxSummary(detail, L);
  const [detailOpen, setDetailOpen] = useState(false);
  const [poolOpen, setPoolOpen] = useState(false);
  const workspaceId = detail?.session.workspace_id ?? "";

  return (
    <>
      <button type="button" className="session-runtime-chip meta-link" title={summary.title} onClick={() => setDetailOpen(true)}>
        <Icon name={summary.icon} size={13} />
        <span>{L("沙箱", "Sandbox")}</span>
        <b>{summary.provider}</b>
        <span className={`status ${summary.statusClass}`}>{summary.status}</span>
        {summary.handle ? <code className="mono">{summary.handle}</code> : null}
        {summary.details.map((item) => (
          <code className="mono session-runtime-detail" key={item.label} title={`${item.label}: ${item.value}`}>
            {item.label}:{shortId(item.value)}
          </code>
        ))}
      </button>
      {detailOpen ? (
        <DrawerLayer onClose={() => setDetailOpen(false)} className="nested-drawer-layer">
          <aside className="ask-drawer pool-detail-drawer" role="dialog" aria-modal="true" aria-label={L("沙箱详情", "Sandbox detail")}>
            <div className="drawer-head">
              <div><b>{L("沙箱详情", "Sandbox detail")}</b><span>{summary.provider}{summary.handle ? ` · ${summary.handle}` : ""}</span></div>
              <button className="x" onClick={() => setDetailOpen(false)} aria-label={L("关闭", "Close")}><Icon name="i-x" size={18} /></button>
            </div>
            <div className="pool-drawer-body">
              <SessionSandboxDetail detail={detail} L={L} onOpenPool={workspaceId ? () => setPoolOpen(true) : null} />
            </div>
          </aside>
        </DrawerLayer>
      ) : null}
      {poolOpen && workspaceId ? (
        <PoolMembersDrawer target={{ kind: "sandbox", status: "claimed" }} workspaceId={workspaceId} L={L} onClose={() => setPoolOpen(false)} highlightSessionId={detail?.session.id} />
      ) : null}
    </>
  );
}

function sandboxSummary(detail: SessionDetail | null, L: (zh: string, en: string) => string): SandboxSummary {
  const runtime = sandboxRuntime(detail);
  const provider = runtimeProvider(runtime) || configuredProvider(detail);
  const handle = sandboxHandle(runtime);
  const status = sandboxStatus(detail, runtime);
  const details = sandboxDetails(detail, runtime);
  return {
    provider: provider.label,
    status: status.label,
    statusClass: status.className,
    icon: provider.icon,
    handle,
    details,
    title: [L("沙箱 Provider", "Sandbox provider"), provider.label, status.label, handle, ...details.map((item) => `${item.label}: ${item.value}`)].filter(Boolean).join(" · ")
  };
}

function sandboxRuntime(detail: SessionDetail | null) {
  const metadata = record(detail?.session.metadata);
  return record(metadata.sandbox_runtime ?? metadata.runtime);
}

function runtimeProvider(runtime: JsonRecord) {
  const type = String(runtime.type || runtime.provider || "");
  if (type === "e2b") return { label: "E2B", icon: "i-server" };
  if (type === "vefaas_sandbox" || (type === "vefaas" && runtime.sandbox_id)) return { label: "VeFaaS Sandbox", icon: "i-cloud" };
  if (type === "docker") return { label: "Docker", icon: "i-server" };
  return null;
}

function configuredProvider(detail: SessionDetail | null) {
  const config = record(detail?.environment?.config);
  const sandbox = record(config.sandbox);
  const provider = String(sandbox.provider || config.type || "");
  if (provider === "vefaas" || provider === "vefaas_sandbox") return { label: "VeFaaS Sandbox", icon: "i-cloud" };
  if (provider === "e2b") return { label: "E2B", icon: "i-server" };
  return { label: provider || "unbound", icon: "i-server" };
}

function sandboxStatus(detail: SessionDetail | null, runtime: JsonRecord) {
  const explicit = String(runtime.status || "").trim();
  if (explicit) return { label: explicit, className: explicit === "failed" ? "failed" : explicit === "running" ? "running" : "active" };
  if (runtime.type || runtime.provider) return { label: "ready", className: "active" };
  const sessionStatus = String(detail?.session.status || "");
  if (sessionStatus === "failed") return { label: "failed", className: "failed" };
  if (sessionStatus === "created" || sessionStatus === "bootstrapping" || sessionStatus === "running") return { label: "pending", className: "running" };
  return { label: "not started", className: "idle" };
}

function sandboxHandle(runtime: JsonRecord) {
  const value = String(runtime.sandbox_id || runtime.function_id || runtime.container_id || "");
  return value ? shortId(value) : "";
}

function sandboxDetails(detail: SessionDetail | null, runtime: JsonRecord) {
  const config = record(detail?.environment?.config);
  const sandbox = record(config.sandbox);
  const vefaas = record(sandbox.vefaas ?? config.vefaas ?? config.vefaas_sandbox);
  const values = {
    sandbox_id: String(runtime.sandbox_id || ""),
    function_id: String(runtime.function_id || runtime.cloud_function_id || vefaas.function_id || vefaas.functionId || ""),
    gateway_url: String(runtime.gateway_url || vefaas.gateway_url || vefaas.gatewayUrl || ""),
    invoke_url: String(runtime.invoke_url || vefaas.invoke_url || "")
  };
  return Object.entries(values)
    .filter(([, value]) => value.trim())
    .slice(0, 3)
    .map(([label, value]) => ({ label, value }));
}

function shortId(value: string) {
  return value.length > 14 ? `${value.slice(0, 6)}...${value.slice(-4)}` : value;
}

function record(value: unknown): JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as JsonRecord) : {};
}

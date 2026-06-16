import type * as React from "react";
import { shortText } from "../../components/shared/misc";
import type { JsonRecord, RuntimePool, RuntimePoolMember, SandboxPool } from "../../types";
import { Icon } from "../../ui";

type LFn = (zh: string, en: string) => string;

export function RuntimePoolDetails({ pool, L, summaryOnly, onOpenMembers }: { pool: RuntimePool; L: LFn; summaryOnly?: boolean; onOpenMembers?: (status?: string) => void }) {
  const minInstances = pool.min_instances_per_function ?? 0;
  const warmQps = pool.desired_size * minInstances * pool.max_concurrency_per_instance;
  const peakQps = pool.desired_size * pool.max_instances_per_function * pool.max_concurrency_per_instance;
  const memberTotal = pool.member_total ?? pool.members.length;
  const activeMembers = pool.member_status_counts?.active ?? pool.members.filter((member) => member.status === "active").length;
  return (
    <div className="runtime-pool-detail">
      <div className="runtime-pool-card">
        <div className="runtime-pool-head">
          <span className="runtime-pool-provider">
            <Icon name="i-cloud" size={15} />
            <b>{providerLabel(pool.provider)}</b>
            <code className="mono">{shortText(pool.id, 18)}</code>
          </span>
          <b className={`status ${statusClass(pool.status)}`}>{pool.status}</b>
        </div>
        <div className="runtime-stat-grid">
          <CompactMetric label={L("函数容量", "Functions")} value={`${pool.desired_size}`} hint={`${minInstances}-${pool.max_instances_per_function} ${L("实例/函数", "inst/function")}`} />
          <CompactMetric label={L("并发", "Concurrency")} value={`${pool.max_concurrency_per_instance}`} hint={L("每实例", "per instance")} />
          <CompactMetric label={L("资源", "Resources")} value={`${pool.cpu_milli}m`} hint={`${pool.memory_mb} MB`} />
          <CompactMetric label="QPS" value={`${warmQps.toLocaleString()} / ${peakQps.toLocaleString()}`} hint={L("预热 / 峰值", "warm / peak")} />
          <CompactMetric label={L("函数成员", "Members")} value={memberTotal} hint={`${activeMembers} active`} onClick={onOpenMembers ? () => onOpenMembers() : undefined} />
        </div>
        {pool.members.length ? (
          <div className="runtime-member-chips compact">
            {pool.members.slice(0, 6).map((member) => (
              <MemberChip key={member.id} member={member} L={L} />
            ))}
            {memberTotal > pool.members.length ? (
              <button type="button" className="chip runtime" onClick={() => onOpenMembers?.()} disabled={!onOpenMembers}>
                <b>+{memberTotal - pool.members.length}</b>
                <em>{L("更多", "more")}</em>
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
      {!summaryOnly ? (
        <>
          <div className="runtime-detail-list">
            {pool.members.map((member) => (
              <RuntimeMemberCard key={member.id} member={member} L={L} />
            ))}
          </div>
          {!pool.members.length ? <div className="panel-empty">{L("运行时池暂无函数成员。", "Runtime pool has no function members yet.")}</div> : null}
        </>
      ) : null}
    </div>
  );
}

export function SandboxPoolDetails({ pool, L, summaryOnly, onOpenMembers }: { pool: SandboxPool | null; L: LFn; summaryOnly?: boolean; onOpenMembers?: (status?: string) => void }) {
  if (!pool) return <div className="panel-empty">{L("暂无沙箱池信息。", "No sandbox pool information yet.")}</div>;
  return (
    <div className="sandbox-pool-detail">
      <div className="tile-grid c3 runtime-tiles">
        <Metric label="Provider" value={pool.provider} hint="sandbox pool" />
        <Metric label={L("目标 standby", "Desired standby")} value={pool.desired_size} hint={L("个沙箱", "sandboxes")} onClick={() => onOpenMembers?.("standby")} />
        <Metric label="TTL" value={`${Math.round(pool.standby_ttl_ms / 60000)}m`} hint={L("待命过期", "standby expiry")} />
      </div>
      {!summaryOnly ? (
        <>
          <div className="runtime-detail-list">
            {pool.members.map((member) => <SandboxMemberCard key={member.id} member={member} L={L} />)}
          </div>
          {!pool.members.length ? <div className="panel-empty">{L("沙箱池暂无成员。", "Sandbox pool has no members yet.")}</div> : null}
        </>
      ) : null}
    </div>
  );
}

export function RuntimeMemberCard({ member, L }: { member: RuntimePoolMember; L: LFn }) {
  const config = record(member.config);
  const consoleHref = vefaasFunctionConsoleHref(member);
  return (
    <article className="runtime-member-card">
      <div className="runtime-member-head">
        <span><Icon name="i-cloud" size={14} /> {member.cloud_function_id || member.id}</span>
        <b className={`status ${member.status}`}>{member.status}</b>
      </div>
      <DetailRow label="cloud_function_id" value={member.cloud_function_id || "-"} />
      <DetailRow label="cloud_app_id" value={member.cloud_app_id || "-"} />
      <DetailRow label="invoke_url" value={member.invoke_url ? <ExternalLink href={member.invoke_url}>{shortText(member.invoke_url, 72)}</ExternalLink> : "-"} />
      <DetailRow label={L("区域", "Region")} value={member.region || "-"} />
      <DetailRow label={L("活跃会话", "Active sessions")} value={member.active_session_count} />
      <DetailRow label={L("权重", "Weight")} value={member.weight} />
      <DetailRow label={L("工作目录", "Workspace path")} value={stringValue(config.workspace_path) || "/workspace"} />
      <DetailRow label={L("控制台", "Console")} value={consoleHref ? <ExternalLink href={consoleHref}>VeFaaS function</ExternalLink> : "-"} />
      <pre className="runtime-config-json">{JSON.stringify(config, null, 2)}</pre>
    </article>
  );
}

export function SandboxMemberCard({ member, L, highlightSessionId }: { member: SandboxPool["members"][number]; L: LFn; highlightSessionId?: string }) {
  const config = record(member.config);
  const functionId = stringValue(config.function_id ?? config.cloud_function_id);
  const gatewayUrl = stringValue(config.gateway_url ?? config.invoke_url);
  const mine = Boolean(highlightSessionId) && member.claimed_session_id === highlightSessionId;
  return (
    <article className={mine ? "runtime-member-card claimed-by-session" : "runtime-member-card"}>
      <div className="runtime-member-head">
        <span><Icon name="i-server" size={14} /> {member.sandbox_id || member.id}{mine ? <em className="member-mine">{L("本会话", "This session")}</em> : null}</span>
        <b className={`status ${member.status}`}>{member.status}</b>
      </div>
      <DetailRow label="sandbox_id" value={member.sandbox_id || "-"} />
      <DetailRow label="function_id" value={functionId || "-"} />
      <DetailRow label="gateway_url" value={gatewayUrl ? <ExternalLink href={gatewayUrl}>{shortText(gatewayUrl, 72)}</ExternalLink> : "-"} />
      <DetailRow label="claimed_session_id" value={member.claimed_session_id || "-"} />
      <DetailRow label="claimed_agent_id" value={member.claimed_agent_id || "-"} />
      <DetailRow label={L("过期时间", "Expires")} value={member.expires_at || "-"} />
      {member.error ? <DetailRow label="error" value={member.error} /> : null}
      <pre className="runtime-config-json">{JSON.stringify(config, null, 2)}</pre>
    </article>
  );
}

function Metric({ label, value, hint, onClick }: { label: string; value: string | number; hint: string | number; onClick?: () => void }) {
  const body = (
    <>
      <div className="lbl">{label}</div>
      <div className="num">{value}</div>
      <span>{hint}</span>
    </>
  );
  return onClick ? <button type="button" className="tile metric-button" onClick={onClick}>{body}</button> : <div className="tile">{body}</div>;
}

function CompactMetric({ label, value, hint, onClick }: { label: string; value: string | number; hint: string | number; onClick?: () => void }) {
  const body = (
    <>
      <span>{label}</span>
      <b>{value}</b>
      <em>{hint}</em>
    </>
  );
  return onClick ? <button type="button" className="runtime-stat" onClick={onClick}>{body}</button> : <div className="runtime-stat">{body}</div>;
}

function MemberChip({ member, L }: { member: RuntimePoolMember; L: LFn }) {
  return (
    <span className={`chip runtime ${statusClass(member.status)}`}>
      <Icon name="i-cloud" size={12} />
      <b>{shortText(member.cloud_function_id || member.id, 18)}</b>
      <em>{member.active_session_count} {L("会话", "sessions")}</em>
    </span>
  );
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="runtime-detail-row">
      <span>{label}</span>
      <b>{value}</b>
    </div>
  );
}

function ExternalLink({ href, children }: { href: string; children: React.ReactNode }) {
  return <a href={href} target="_blank" rel="noreferrer">{children}</a>;
}

function vefaasFunctionConsoleHref(member: RuntimePoolMember) {
  if (!member.cloud_function_id) return "";
  const region = member.region || "cn-beijing";
  return `https://console.volcengine.com/vefaas/region:${encodeURIComponent(region)}/function/${encodeURIComponent(member.cloud_function_id)}`;
}

function providerLabel(provider: string) {
  return provider === "vefaas" ? "VeFaaS" : provider;
}

function statusClass(status: string) {
  if (status === "failed") return "failed";
  if (status === "running" || status === "provisioning") return "running";
  return status || "active";
}

function record(value: unknown): JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function stringValue(value: unknown) {
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

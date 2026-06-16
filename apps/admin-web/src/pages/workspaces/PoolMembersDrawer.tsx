import { useEffect, useMemo, useState } from "react";
import { apiGet } from "../../api";
import { PaginationControls } from "../../components/shared/layout";
import { errorMessage } from "../../components/shared/misc";
import type { PoolMemberStatusCounts, RuntimePool, SandboxPool } from "../../types";
import { DrawerLayer, Icon } from "../../ui";
import { RuntimeMemberCard, SandboxMemberCard } from "./RuntimePoolDetails";

type LFn = (zh: string, en: string) => string;
type PoolKind = "runtime" | "sandbox";
type Member = RuntimePool["members"][number] | SandboxPool["members"][number];

const PAGE_SIZE = 20;

export type PoolDrawerTarget =
  | { kind: "runtime"; status?: string }
  | { kind: "sandbox"; status?: string };

export function PoolMembersDrawer(props: {
  target: PoolDrawerTarget;
  workspaceId: string;
  L: LFn;
  onClose: () => void;
  highlightSessionId?: string;
}) {
  const [status, setStatus] = useState(props.target.status ?? "all");
  const [page, setPage] = useState(1);
  const [members, setMembers] = useState<Member[]>([]);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState<PoolMemberStatusCounts>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), page_size: String(PAGE_SIZE) });
    if (status !== "all") params.set("status", status);
    const endpoint = props.target.kind === "runtime" ? "runtime_pool" : "sandbox_pool";
    apiGet<RuntimePool | SandboxPool>(`/v1/workspaces/${props.workspaceId}/${endpoint}?${params}`)
      .then((pool) => {
        if (cancelled) return;
        setMembers(pool.members ?? []);
        setTotal(pool.member_total ?? pool.members?.length ?? 0);
        setCounts(pool.member_status_counts ?? {});
        setError("");
      })
      .catch((reason) => {
        if (!cancelled) setError(errorMessage(reason));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [props.workspaceId, props.target.kind, status, page]);

  const statuses = useMemo(() => statusOptions(props.target.kind, Object.keys(counts)), [props.target.kind, counts]);
  const allTotal = useMemo(() => Object.values(counts).reduce((sum, value) => sum + value, 0), [counts]);
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const start = (page - 1) * PAGE_SIZE;
  const title = props.target.kind === "runtime" ? props.L("运行时池函数", "Runtime pool functions") : props.L("沙箱池成员", "Sandbox pool members");
  const subtitle = props.target.kind === "runtime"
    ? props.L("VeFaaS runtime pool member 状态", "VeFaaS runtime pool member status")
    : props.L("standby / claimed / failed 沙箱状态", "standby / claimed / failed sandbox status");

  function changeStatus(next: string) {
    setStatus(next);
    setPage(1);
  }

  return (
    <DrawerLayer onClose={props.onClose} className="nested-drawer-layer">
      <aside className="ask-drawer pool-detail-drawer" role="dialog" aria-modal="true" aria-label={title}>
        <div className="drawer-head">
          <div><b>{title}</b><span>{subtitle}</span></div>
          <button className="x" onClick={props.onClose} aria-label={props.L("关闭", "Close")}><Icon name="i-x" size={18} /></button>
        </div>
        <div className="pool-drawer-body">
          <div className="pool-filter-row" role="tablist" aria-label={props.L("状态筛选", "Status filter")}>
            {statuses.map((item) => (
              <button key={item} className={status === item ? "on" : ""} onClick={() => changeStatus(item)} title={statusHint(item, props.L)}>
                {item === "all" ? props.L("全部", "All") : item}
                <span>{item === "all" ? allTotal : counts[item] ?? 0}</span>
              </button>
            ))}
          </div>
          {error ? <div className="modal-note"><Icon name="i-alert" size={16} /> {error}</div> : null}
          {loading ? <div className="panel-empty"><span className="spin-dot" /> {props.L("加载中…", "Loading…")}</div> : null}
          {!loading && !error ? (
            <>
              <div className="runtime-detail-list pool-drawer-list">
                {props.target.kind === "runtime"
                  ? (members as RuntimePool["members"]).map((member) => <RuntimeMemberCard key={member.id} member={member} L={props.L} />)
                  : (members as SandboxPool["members"]).map((member) => <SandboxMemberCard key={member.id} member={member} L={props.L} highlightSessionId={props.highlightSessionId} />)}
              </div>
              {!members.length ? <div className="panel-empty">{props.L("当前筛选下没有成员。", "No members match this filter.")}</div> : null}
              <PaginationControls
                page={page}
                pageCount={pageCount}
                pageSize={PAGE_SIZE}
                total={total}
                start={start}
                end={Math.min(start + members.length, total)}
                setPage={setPage}
                pageItems={members}
              />
            </>
          ) : null}
        </div>
      </aside>
    </DrawerLayer>
  );
}

function statusOptions(kind: PoolKind, present: string[]) {
  const common = kind === "runtime"
    ? ["active", "provisioning", "failed"]
    : ["standby", "claimed", "expired", "failed", "provisioning"];
  return ["all", ...Array.from(new Set([...common, ...present.filter(Boolean)]))];
}

function statusHint(status: string, L: LFn) {
  if (status === "claimed") return L("已被某个会话占用的沙箱", "Sandbox claimed by a session");
  if (status === "standby") return L("待命中、可被会话占用", "Standby, available to claim");
  if (status === "expired") return L("已过期的待命沙箱", "Expired standby sandbox");
  return undefined;
}

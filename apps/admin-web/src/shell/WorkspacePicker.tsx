import { useEffect, useRef } from "react";
import type { Workspace } from "../types";
import { Icon } from "../ui";
import { useL } from "../appConfig";
import { workspaceColor } from "../components/shared/labels";

export function WorkspacePicker(props: {
  workspaces: Workspace[];
  selectedWorkspaceId: string;
  search: string;
  setSearch: (value: string) => void;
  open: boolean;
  setOpen: (value: boolean) => void;
  onSelect: (workspaceId: string) => void;
  onOpenWorkspace?: (workspaceId: string) => void;
  onCreate: () => void;
  onSettings: () => void;
  locked?: boolean;
  canManageWorkspace?: boolean;
  canCreateWorkspace?: boolean;
}) {
  const L = useL();
  const rootRef = useRef<HTMLDivElement>(null);
  const selected = props.workspaces.find((workspace) => workspace.id === props.selectedWorkspaceId) ?? props.workspaces[0] ?? null;
  const all = props.selectedWorkspaceId === "";
  const filtered = props.workspaces.filter((workspace) => `${workspace.name} ${workspace.id} ${String(workspace.config?.slug ?? "")}`.toLowerCase().includes(props.search.toLowerCase()));
  function openSelectedWorkspace() {
    if (props.locked) return;
    if (!all && selected && props.onOpenWorkspace) {
      props.setOpen(false);
      props.onOpenWorkspace(selected.id);
      return;
    }
    props.setOpen(!props.open);
  }
  useEffect(() => {
    if (!props.open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target instanceof Node ? event.target : null;
      if (target && rootRef.current?.contains(target)) return;
      props.setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") props.setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [props.open, props.setOpen]);
  return (
    <div className="ws-wrap" ref={rootRef}>
      <div className="ws-row">
        <button className="workspace-picker" aria-haspopup="dialog" aria-expanded={props.open} disabled={props.locked} onClick={openSelectedWorkspace}>
          <span className="ws-dot" style={{ background: all ? "var(--muted)" : workspaceColor(selected?.id ?? "") }} />
          <span className="ws-ico"><Icon name="i-grid" size={16} /></span>
          <span className="ws-label">{all ? L("全部工作区", "All workspaces") : selected?.name ?? L("默认工作区", "Default")}</span>
        </button>
        <button className="icon-btn ws-switch" title={L("切换工作区", "Switch workspace")} aria-label={L("切换工作区", "Switch workspace")} onClick={() => { if (!props.locked) props.setOpen(!props.open); }} disabled={props.locked}>
          <Icon name="i-chevron-down" size={14} />
        </button>
        {props.canManageWorkspace ? (
          <button className="icon-btn ws-settings" title={L("工作区设置", "Workspace settings")} aria-label={L("工作区设置", "Workspace settings")} onClick={() => { if (!props.locked) props.onSettings(); }} disabled={!selected || props.locked}>
            <Icon name="i-settings" size={16} />
          </button>
        ) : null}
      </div>
      {props.open ? (
        <div className="ws-pop open" role="menu">
          <div className="ws-search"><Icon name="i-search" size={14} /><input autoFocus value={props.search} onChange={(event) => props.setSearch(event.target.value)} placeholder={L("搜索工作区…", "Search workspaces…")} /></div>
          <button className={all ? "ws-all on" : "ws-all"} role="menuitem" onClick={() => props.onSelect("")}>
            <div><b>{L("全部工作区", "All workspaces")}</b><span>{L("用于跨工作区日志与统计", "For cross-workspace logs and analytics")}</span></div>
            {all ? <Icon name="i-check" size={15} /> : null}
          </button>
          <div className="ws-list">
            {filtered.length ? (
              filtered.map((workspace) => {
                const on = workspace.id === selected?.id && !all;
                return (
                  <button className={on ? "ws-item on" : "ws-item"} role="menuitem" key={workspace.id} onClick={() => { props.onSelect(workspace.id); props.onOpenWorkspace?.(workspace.id); }}>
                    <span className="ws-dot" style={{ background: workspaceColor(workspace.id) }} />
                    <span className="nm">{workspace.name}</span>
                    {on ? <Icon name="i-check" size={15} /> : null}
                  </button>
                );
              })
            ) : (
              <div className="ws-empty">{L("无匹配工作区", "No matching workspace")}</div>
            )}
          </div>
          {props.canCreateWorkspace ? <button className="ws-create" onClick={props.onCreate}><Icon name="i-plus" size={15} /> {L("新建工作区", "Create workspace")}</button> : null}
        </div>
      ) : null}
    </div>
  );
}

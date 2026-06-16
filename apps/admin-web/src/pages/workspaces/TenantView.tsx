import { useEffect, useState, type FormEvent } from "react";
import { apiDelete, apiGet, apiPost, type ApiList } from "../../api";
import { useEntityNav, useI18n, type View } from "../../appConfig";
import { DataTable, PageFrame } from "../../components/shared/layout";
import { errorMessage, formatTime } from "../../components/shared/misc";
import type { JsonRecord, User, Workspace } from "../../types";
import { Icon, ModalLayer, useConfirm, useToast } from "../../ui";
import { TenantKeysPanel } from "./TenantKeysPanel";

export function TenantView(props: { workspace: Workspace | null; workspaces: Workspace[]; currentUser: User; setView: (view: View) => void; onDeleteWorkspace: (workspace: Workspace) => void | Promise<void> }) {
  const { language } = useI18n();
  const toast = useToast();
  const confirm = useConfirm();
  const { openEntity } = useEntityNav();
  const L = (zh: string, en: string) => (language === "zh" ? zh : en);

  const base = props.workspace ?? props.workspaces[0] ?? null;
  const cfg = (base?.config ?? {}) as JsonRecord;
  const slug = typeof cfg.slug === "string" && cfg.slug ? cfg.slug : "—";
  const consoleUrl = typeof cfg.console_url === "string" && cfg.console_url ? cfg.console_url : "";
  const tenantId = base?.tenant_id ?? "—";
  const tenantName =
    (typeof cfg.tenant_name === "string" && cfg.tenant_name) ? cfg.tenant_name : (base?.tenant_id ?? "—");
  const tenantWorkspaces = base?.tenant_id
    ? props.workspaces.filter((workspace) => workspace.tenant_id === base.tenant_id)
    : props.workspaces;
  const createdAt = base?.created_at ? formatTime(base.created_at) : "—";
  const ownerInitial = (props.currentUser.name?.[0] ?? props.currentUser.email?.[0] ?? "?").toUpperCase();

  const fallbackOwner: User = { ...props.currentUser, tenant_role: "admin", effective_role: "admin" };
  const [tenantUsers, setTenantUsers] = useState<User[]>([fallbackOwner]);
  const [adding, setAdding] = useState(false);
  const [memberEmail, setMemberEmail] = useState("");
  const [memberRole, setMemberRole] = useState<"member" | "admin">("admin");
  const [memberSaving, setMemberSaving] = useState(false);
  const [removingUserId, setRemovingUserId] = useState("");
  const [deletingWorkspaceId, setDeletingWorkspaceId] = useState("");
  const [tenantError, setTenantError] = useState("");

  async function deleteWorkspace(workspace: Workspace) {
    if (deletingWorkspaceId) return;
    setDeletingWorkspaceId(workspace.id);
    try {
      await props.onDeleteWorkspace(workspace);
    } finally {
      setDeletingWorkspaceId("");
    }
  }

  useEffect(() => {
    let cancelled = false;
    if (!base?.tenant_id) {
      setTenantUsers([fallbackOwner]);
      return;
    }
    apiGet<ApiList<User>>(`/v1/tenants/${encodeURIComponent(base.tenant_id)}/members`)
      .then((members) => {
        if (cancelled) return;
        setTenantUsers(members.data.length ? members.data : [fallbackOwner]);
      })
      .catch((reason) => {
        if (!cancelled) setTenantError(errorMessage(reason));
      });
    return () => {
      cancelled = true;
    };
  }, [base?.tenant_id, props.currentUser.id, props.currentUser.email, props.currentUser.name, props.currentUser.auth_provider, props.currentUser.role, props.currentUser.created_at]); // eslint-disable-line react-hooks/exhaustive-deps

  function memberName(member: User) {
    return member.name?.trim() || member.email.split("@")[0] || member.email;
  }

  function memberInitial(member: User) {
    return (memberName(member)[0] ?? "?").toUpperCase();
  }

  function tenantRole(member: User) {
    return member.tenant_role === "admin" || member.effective_role === "admin" ? "admin" : "member";
  }

  async function addTenantUserByEmail(event?: FormEvent) {
    event?.preventDefault();
    if (!base?.tenant_id || !memberEmail.trim()) return;
    setMemberSaving(true);
    setTenantError("");
    try {
      const path = memberRole === "admin" ? "admins" : "members";
      const member = await apiPost<User>(`/v1/tenants/${encodeURIComponent(base.tenant_id)}/${path}`, { email: memberEmail.trim() });
      setTenantUsers((current) => {
        const next = current.filter((item) => item.id !== member.id);
        return [...next, member].sort((a, b) => tenantRole(a).localeCompare(tenantRole(b)) || a.email.localeCompare(b.email));
      });
      setAdding(false);
      setMemberEmail("");
      toast((memberRole === "admin" ? L("已添加租户管理员 · ", "Tenant admin added · ") : L("已添加租户成员 · ", "Tenant member added · ")) + member.email, "ok");
    } catch (reason) {
      setTenantError(errorMessage(reason));
    } finally {
      setMemberSaving(false);
    }
  }

  async function removeTenantUser(member: User) {
    if (member.id === props.currentUser.id || !base?.tenant_id) return;
    const name = memberName(member);
    const role = tenantRole(member);
    const ok = await confirm({
      title: role === "admin" ? L("移除租户管理员", "Remove tenant admin") : L("移除租户成员", "Remove tenant member"),
      body: role === "admin" ? L(`确定移除 ${name} 的租户管理员权限？`, `Remove ${name} as a tenant administrator?`) : L(`确定移除 ${name} 的租户成员身份？`, `Remove ${name} from this tenant?`),
      confirmLabel: L("移除", "Remove"),
      cancelLabel: L("取消", "Cancel"),
      danger: true
    });
    if (!ok || removingUserId) return;
    setRemovingUserId(member.id);
    try {
      const path = role === "admin" ? "admins" : "members";
      await apiDelete<{ ok: true }>(`/v1/tenants/${encodeURIComponent(base.tenant_id)}/${path}/${encodeURIComponent(member.id)}`);
      setTenantUsers((current) => current.filter((item) => item.id !== member.id));
      toast(L("已移除", "Removed"), "ok");
    } catch (reason) {
      setTenantError(errorMessage(reason));
    } finally {
      setRemovingUserId("");
    }
  }

  function closeAddAdmin() {
    if (memberSaving) return;
    setAdding(false);
    setMemberEmail("");
    setTenantError("");
  }

  function copyConsoleUrl() {
    if (!consoleUrl) return;
    try {
      navigator.clipboard?.writeText(consoleUrl);
    } catch {
      /* clipboard unavailable */
    }
    toast(L("已复制", "Copied"), "ok");
  }

  const crumb = (
    <div className="breadcrumb">
      <span>
        <button>
          <Icon name="i-boxes" size={14} />
          {L("管理", "Manage")}
        </button>
      </span>
      <span>
        <span className="sep">/</span>
        <span className="cur">{L("租户", "Tenant")}</span>
      </span>
    </div>
  );

  return (
    <PageFrame
      title={L("租户", "Tenant")}
      sub={L("租户级别的信息、成员、AKSK 与后台登录链接。", "Tenant-level info, members, AKSK and the console URL.")}
      crumb={crumb}
    >
      <div className="section-title">{L("基本信息", "Basic info")}</div>
      <div className="card t-card">
        <div className="t-row">
          <span>{L("租户名称", "Name")}</span>
          <b>{tenantName}</b>
        </div>
        <div className="t-row">
          <span>{L("唯一 ID", "Unique ID")}</span>
          <b className="mono">{tenantId}</b>
        </div>
        <div className="t-row">
          <span>{L("管理员", "Administrator")}</span>
          <b className="t-creator">
            <span className="adm-av sm">{ownerInitial}</span>
            {props.currentUser.name} · {props.currentUser.email}
          </b>
        </div>
        <div className="t-row">
          <span>{L("工作区数", "Workspaces")}</span>
          <b>{tenantWorkspaces.length}</b>
        </div>
        <div className="t-row">
          <span>{L("当前标识", "Current slug")}</span>
          <b className="mono">{slug}</b>
        </div>
        <div className="t-row">
          <span>{L("后台地址", "Console URL")}</span>
          <b className="mono">{consoleUrl || "—"}</b>
        </div>
        <div className="t-row">
          <span>{L("创建时间", "Created")}</span>
          <b>{createdAt}</b>
        </div>
      </div>

      <div className="section-title">{L("工作区", "Workspaces")}</div>
      {tenantWorkspaces.length ? (
        <DataTable
          headers={[
            L("名称", "Workspace"),
            L("标识", "Slug"),
            L("运行时", "Runtime"),
            L("沙箱", "Sandbox"),
            L("创建", "Created"),
            ""
          ]}
        >
          {tenantWorkspaces.map((workspace) => (
            <tr key={workspace.id} className="clickable-row" onClick={() => openEntity("workspace", workspace.id)}>
              <td>
                <span className="t-name">{workspace.name}</span>
                <small className="mono">{workspace.id}</small>
              </td>
              <td className="mono">{String((workspace.config as JsonRecord)?.slug ?? "—")}</td>
              <td>{workspace.runtime_provider}</td>
              <td>{workspace.sandbox_provider}</td>
              <td>{formatTime(workspace.created_at)}</td>
              <td className="actions-cell">
                <button className="btn secondary compact danger-text" onClick={(event) => { event.stopPropagation(); void deleteWorkspace(workspace); }} disabled={deletingWorkspaceId === workspace.id}>
                  {deletingWorkspaceId === workspace.id ? <span className="spin-dot" /> : <Icon name="i-trash" size={13} />} {L("删除", "Delete")}
                </button>
              </td>
            </tr>
          ))}
        </DataTable>
      ) : (
        <div className="panel-empty">{L("暂无工作区。", "No workspaces yet.")}</div>
      )}

      <div className="section-title">
        {L("成员与管理员", "Members & administrators")}
        <button className="more" onClick={() => setAdding(true)}><Icon name="i-plus" size={14} /> {L("添加成员", "Add member")}</button>
      </div>
      <div className="card">
        {tenantUsers.map((member) => {
          const role = tenantRole(member);
          const locked = member.id === props.currentUser.id;
          return (
          <div className="adm-row" key={member.id}>
            <div className="adm-av">{memberInitial(member)}</div>
            <div className="adm-main">
              <b>{memberName(member)}</b>
              <span>{member.email}</span>
            </div>
            <span className={`adm-role ${role}`}>{role === "admin" ? L("管理员", "Admin") : L("成员", "Member")}</span>
            <button className="btn secondary compact" onClick={() => removeTenantUser(member)} disabled={locked || removingUserId === member.id}>
              {removingUserId === member.id ? <span className="spin-dot" /> : <Icon name="i-x" size={14} />} {locked ? L("当前用户", "Current") : L("移除", "Remove")}
            </button>
          </div>
        );})}
      </div>
      {tenantError ? <div className="modal-note"><Icon name="i-alert" size={16} /> {tenantError}</div> : null}

      <TenantKeysPanel tenantId={base?.tenant_id ?? ""} L={L} />

      <div className="section-title">{L("登录链接", "Sign-in link")}</div>
      {consoleUrl ? (
        <div className="card t-link">
          <div className="t-link-main">
            <span className="t-link-label">{L("租户后台登录链接", "Console sign-in URL")}</span>
            <code className="t-link-url">{consoleUrl}</code>
          </div>
          <div className="t-link-actions">
            <button className="btn secondary compact" onClick={copyConsoleUrl}>
              <Icon name="i-copy" size={14} /> {L("复制", "Copy")}
            </button>
          </div>
        </div>
      ) : (
        <div className="panel-empty">{L("当前工作区未配置后台登录链接。", "No console URL configured for this workspace.")}</div>
      )}

      {adding ? (
        <ModalLayer onClose={closeAddAdmin}>
          <div className="modal" role="dialog" aria-modal="true" aria-label={L("添加租户成员", "Add tenant member")} onClick={(event) => event.stopPropagation()}>
            <div className="modal-head">
              <b>{L("添加租户成员", "Add tenant member")}</b>
              <button className="x" onClick={closeAddAdmin} aria-label={L("关闭", "Close")}><Icon name="i-x" size={18} /></button>
            </div>
            <form onSubmit={addTenantUserByEmail}>
              <div className="modal-body">
                <div className="modal-note"><Icon name="i-alert" size={16} /> {L("输入邮箱后会预创建用户，并加入当前租户。管理员可管理租户下工作区与资产。", "Entering an email pre-creates the user and adds them to this tenant. Admins can manage workspaces and assets under the tenant.")}</div>
                <label className="form">
                  {L("邮箱", "Email")}
                  <input
                    className="fld"
                    type="email"
                    value={memberEmail}
                    onChange={(event) => setMemberEmail(event.target.value)}
                    placeholder={L("例如 user@example.com", "user@example.com")}
                    autoComplete="email"
                    autoFocus
                  />
                </label>
                <label className="form">
                  {L("角色", "Role")}
                  <select className="fld" value={memberRole} onChange={(event) => setMemberRole(event.target.value as "member" | "admin")}>
                    <option value="admin">{L("管理员", "Admin")}</option>
                    <option value="member">{L("成员", "Member")}</option>
                  </select>
                </label>
                {tenantError ? <div className="modal-note"><Icon name="i-alert" size={16} /> {tenantError}</div> : null}
              </div>
              <div className="modal-foot">
                <button className="btn secondary" type="button" onClick={closeAddAdmin} disabled={memberSaving}>{L("取消", "Cancel")}</button>
                <button className="btn primary" type="submit" disabled={memberSaving || !memberEmail.trim()}>
                  {memberSaving ? L("添加中…", "Adding…") : L("添加", "Add")}
                </button>
              </div>
            </form>
          </div>
        </ModalLayer>
      ) : null}
    </PageFrame>
  );
}

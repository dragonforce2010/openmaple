import type { AuthProvider, User } from "../../types";
import { Icon } from "../../ui";
import { useEntityNav, useI18n } from "../../appConfig";
import { DataTable, PageFrame } from "../../components/shared/layout";
import { authProviderLabel, formatTime } from "../../components/shared/misc";

export function UsersView(props: { currentUser: User; users: User[]; providers: AuthProvider[]; onRemoveUser: (user: User) => void; scope: "tenant" | "workspace"; loading?: boolean }) {
  const { language } = useI18n();
  const L = (zh: string, en: string) => (language === "zh" ? zh : en);
  const { openEntity } = useEntityNav();
  const configured = props.providers.filter((item) => item.configured).length;
  const isAdminRole = (role?: string | null) => role === "owner" || role === "admin";
  const adminCount = props.users.filter((user) => isAdminRole(user.effective_role)).length;
  const workspacesFor = (user: User) => {
    if (props.scope === "tenant" && isAdminRole(user.effective_role)) return <span>{L("全部", "All")}</span>;
    const ids = user.workspace_ids ?? [];
    const names = user.workspace_names ?? [];
    const count = Math.max(ids.length, names.length);
    if (!count) return <span>—</span>;
    return (
      <div className="chip-row compact">
        {Array.from({ length: count }).map((_, index) => {
          const id = ids[index];
          const name = names[index] ?? id ?? "—";
          return id ? (
            <button type="button" className="chip chip-button" key={`${id}:${index}`} onClick={() => openEntity("workspace", id)}>
              <Icon name="i-grid" size={14} /> {name}
            </button>
          ) : (
            <span className="chip" key={`${name}:${index}`}><Icon name="i-grid" size={14} /> {name}</span>
          );
        })}
      </div>
    );
  };
  const scopeSub = props.scope === "tenant"
    ? L("当前租户下可访问工作区的用户、角色与成员关系。", "Users, roles, and workspace memberships in the current tenant.")
    : L("当前工作区的用户、角色与成员关系。", "Users, roles, and memberships in the current workspace.");
  return (
    <PageFrame
      title={<>{L("用户", "Users")} <span className="title-count">{props.users.length}</span></>}
      sub={scopeSub}
    >
      <div className="tile-grid">
        <div className="tile">
          <div className="lbl"><Icon name="i-user" size={16} /> {L("当前用户", "Current user")}</div>
          <div className="num" style={{ fontSize: 18 }}>{props.currentUser.email}</div>
          <div className="delta">{authProviderLabel(props.currentUser.auth_provider)}</div>
        </div>
        <div className="tile">
          <div className="lbl"><Icon name="i-users" size={16} /> {L("用户总数", "Total users")}</div>
          <div className="num">{props.users.length}</div>
          <div className="delta">{L("登录受保护", "login protected")}</div>
        </div>
        <div className="tile">
          <div className="lbl"><Icon name="i-lock" size={16} /> {L("管理员", "Admins")}</div>
          <div className="num">{adminCount}</div>
          <div className="delta">{configured} IdP</div>
        </div>
      </div>
      <div className="section-title">{L("成员", "Members")}</div>
      <DataTable headers={[L("用户", "User"), L("角色", "Role"), L("所属工作区", "Workspaces"), "Provider", L("更新", "Updated"), ""]} loading={props.loading}>
        {props.users.map((user) => (
          <tr key={user.id}>
            <td><strong>{user.email}</strong><small>{user.name || user.id}</small></td>
            <td>{isAdminRole(user.effective_role) ? <span className="status active">{user.effective_role}</span> : "member"}</td>
            <td>{workspacesFor(user)}</td>
            <td>{authProviderLabel(user.auth_provider)}</td>
            <td>{formatTime(user.updated_at)}</td>
            <td className="actions-cell">
              <button
                className="btn secondary compact danger-text"
                disabled={isAdminRole(user.effective_role)}
                onClick={() => props.onRemoveUser(user)}
              >
                <Icon name="i-x" size={13} /> {isAdminRole(user.effective_role) ? L("锁定", "Locked") : L("移除", "Remove")}
              </button>
            </td>
          </tr>
        ))}
      </DataTable>
    </PageFrame>
  );
}

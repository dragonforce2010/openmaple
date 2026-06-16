import type { User } from "../types";
import { Icon } from "../ui";
import { useL, type AccessibleTenant } from "../appConfig";


export function tenantAccessBadge(tenant: AccessibleTenant, L: (zh: string, en: string) => string) {
  if (Number(tenant.is_creator) === 1) return { label: L("Admin · 我创建的租户", "Admin · Created tenant"), tone: "admin" };
  if (Number(tenant.is_owner) === 1) return { label: L("Admin · 管理员租户", "Admin · Admin tenant"), tone: "admin" };
  return { label: L("Member · 成员租户", "Member · Member tenant"), tone: "member" };
}

export function TenantSelectView(props: { tenants: AccessibleTenant[]; currentUser: User | null; onSelect: (tenant: AccessibleTenant) => void; onLogout: () => void }) {
  const L = useL();
  return (
    <div className="page-frame">
      <div className="provision wizard">
        <div className="prov-title">
          <Icon name="i-boxes" size={24} />
          <div>
            <h1>{L("选择租户", "Select a tenant")}</h1>
            <p>{L("你可以访问多个租户，选择一个进入。", "You can access multiple tenants — pick one to continue.")} · {props.currentUser?.email}</p>
          </div>
        </div>
        <div className="pv-card">
          <div className="mcp-list">
            {props.tenants.map((tenant) => {
              const badge = tenantAccessBadge(tenant, L);
              return (
                <button key={tenant.id} type="button" className="mcp-row" onClick={() => props.onSelect(tenant)}>
                  <span className="mcp-ico"><Icon name="i-boxes" size={18} /></span>
                  <span className="mcp-main"><b>{tenant.name}</b><span>{tenant.workspace_count} {L("个工作区", "workspaces")} · {tenant.id}</span></span>
                  <span className={`mcp-badge ${badge.tone}`}>{badge.label}</span>
                </button>
              );
            })}
          </div>
          <div className="modal-foot" style={{ marginTop: 16 }}>
            <button className="btn secondary" onClick={props.onLogout}>{L("退出登录", "Log out")}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

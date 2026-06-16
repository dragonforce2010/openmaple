import type { User } from "../types";
import { Icon } from "../ui";
import { useL, type AccessibleTenant } from "../appConfig";
import { tenantAccessBadge } from "./TenantSelectView";

export function TenantChoiceView(props: { tenants: AccessibleTenant[]; currentUser: User | null; onCreate: () => void; onEnter: (tenant: AccessibleTenant) => void; onLogout: () => void }) {
  const L = useL();
  const memberTenants = props.tenants.filter((tenant) => Number(tenant.is_creator) !== 1);
  return (
    <div className="page-frame">
      <div className="provision wizard">
        <div className="prov-title">
          <Icon name="i-boxes" size={24} />
          <div>
            <h1>{L("选择进入方式", "Choose how to continue")}</h1>
            <p>{L(`你还没有创建自己的租户，同时已被授权访问 ${memberTenants.length} 个已有租户。`, `You have not created your own tenant yet, and you can access ${memberTenants.length} existing tenant(s).`)} · {props.currentUser?.email}</p>
          </div>
        </div>
        <div className="pv-card">
          <button type="button" className="tc-action primary" onClick={props.onCreate}>
            <span className="tc-ico"><Icon name="i-plus" size={20} /></span>
            <span className="tc-copy">
              <b>{L("创建我的租户", "Create my tenant")}</b>
              <span>{L("开通独立租户和默认工作区，后续可邀请成员并管理空间。", "Provision an owned tenant and default workspace, then invite members and manage spaces.")}</span>
            </span>
            <Icon name="i-chevron-right" size={16} />
          </button>
          <div className="tc-existing">
            <div className="tc-existing-title">{L("进入已授权工作区", "Enter an authorized workspace")}</div>
            <div className="mcp-list">
              {memberTenants.map((tenant) => {
                const badge = tenantAccessBadge(tenant, L);
                return (
                  <button key={tenant.id} type="button" className="mcp-row" onClick={() => props.onEnter(tenant)}>
                    <span className="mcp-ico"><Icon name="i-boxes" size={18} /></span>
                    <span className="mcp-main"><b>{tenant.name}</b><span>{tenant.workspace_count} {L("个工作区", "workspaces")} · {tenant.id}</span></span>
                    <span className={`mcp-badge ${badge.tone}`}>{badge.label}</span>
                    <Icon name="i-chevron-right" size={16} />
                  </button>
                );
              })}
            </div>
          </div>
          <div className="modal-foot" style={{ marginTop: 16 }}>
            <button className="btn secondary" onClick={props.onLogout}>{L("退出登录", "Log out")}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

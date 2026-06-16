import type { User } from "../types";
import { Icon } from "../ui";
import { useL } from "../appConfig";


export function NoAccessView(props: { currentUser: User | null; onLogout: () => void }) {
  const L = useL();
  return (
    <div className="page-frame">
      <div className="provision wizard">
        <div className="prov-title">
          <Icon name="i-lock" size={24} />
          <div>
            <h1>{L("暂无可访问工作区", "No workspace access")}</h1>
            <p>{L("当前账号尚未被添加到任何工作区。请联系租户管理员添加你的邮箱。", "This account has not been added to any workspace. Ask a tenant admin to add your email.")} · {props.currentUser?.email}</p>
          </div>
        </div>
        <div className="pv-card">
          <div className="panel-empty">{L("获得授权后重新登录即可进入对应工作区。", "After access is granted, sign in again to enter your workspace.")}</div>
          <div className="modal-foot" style={{ marginTop: 16 }}>
            <button className="btn secondary" onClick={props.onLogout}>{L("退出登录", "Log out")}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

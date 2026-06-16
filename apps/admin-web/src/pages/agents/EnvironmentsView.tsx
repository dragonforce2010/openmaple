import type { Environment, JsonRecord } from "../../types";
import { Icon } from "../../ui";
import { useEntityNav, useI18n } from "../../appConfig";
import { environmentRuntimeLabel, statusPill } from "../../components/shared/labels";
import { DataTable, PageFrame } from "../../components/shared/layout";
import { useDeleteEnvironment } from "../../components/shared/useDeleteEnvironment";

export function EnvironmentsView({ environments, openCreate, loading = false }: { environments: Environment[]; openCreate: () => void; loading?: boolean }) {
  const { openEntity, refresh } = useEntityNav();
  const { run: removeEnvironment, busy } = useDeleteEnvironment();
  const { language } = useI18n();
  const L = (zh: string, en: string) => (language === "zh" ? zh : en);
  return (
    <PageFrame
      title={L("环境", "Environments")}
      sub={L("沙箱与运行时配置模板，供会话执行时使用。", "Sandbox and runtime templates used by sessions at run time.")}
      action={
        <button className="btn primary" onClick={openCreate}>
          <Icon name="i-plus" size={15} /> {L("新建环境", "New environment")}
        </button>
      }
    >
      {environments.length || loading ? (
        <DataTable headers={["ID", L("名称", "Name"), L("状态", "Status"), L("运行时", "Runtime"), L("网络", "Networking"), ""]} loading={loading}>
          {environments.map((environment) => (
            <tr key={environment.id} className="clickable-row" onClick={() => openEntity("environment", environment.id)}>
              <td><button className="id-link" onClick={(event) => { event.stopPropagation(); openEntity("environment", environment.id); }}>{environment.id}</button></td>
              <td className="t-name">{environment.name}</td>
              <td>{statusPill("active", L)}</td>
              <td><span className="mono">{environmentRuntimeLabel(environment)}</span></td>
              <td><span className="mono">{String((environment.config.networking as JsonRecord | undefined)?.mode ?? "limited")}</span></td>
              <td className="row-actions">
                <button className="btn secondary compact danger-text" disabled={busy} title={L("删除", "Delete")} onClick={(event) => { event.stopPropagation(); void removeEnvironment(environment.id, refresh); }}>
                  <Icon name="i-trash" size={13} />
                </button>
              </td>
            </tr>
          ))}
        </DataTable>
      ) : (
        <div className="panel-empty">{L("还没有环境，点击右上角新建一个。", "No environments yet. Create one from the top right.")}</div>
      )}
    </PageFrame>
  );
}

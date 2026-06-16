import { Icon, useToast } from "../../ui";
import { useI18n } from "../../appConfig";
import { PageFrame } from "../../components/shared/layout";

export function BatchesView() {
  const { language } = useI18n();
  const L = (zh: string, en: string) => (language === "zh" ? zh : en);
  const toast = useToast();
  return (
    <PageFrame
      title={L("批处理", "Batches")}
      sub={L("对大量输入并行运行 Agent。", "Run an agent over many inputs in parallel.")}
    >
      <div className="overview-empty">
        <div className="ic-wrap"><Icon name="i-boxes" size={22} /></div>
        <h2>{L("暂无批处理任务", "No batches yet")}</h2>
        <p>{L(
          "上传一份输入清单，平台会并行调度会话并汇总产物。",
          "Upload an input list and the platform schedules sessions in parallel, then collects the artifacts."
        )}</p>
        <button className="btn primary" onClick={() => toast(L("新建批处理（演示）", "New batch (demo)"), "info")}>
          <Icon name="i-plus" size={14} /> {L("新建批处理", "New batch")}
        </button>
      </div>
    </PageFrame>
  );
}

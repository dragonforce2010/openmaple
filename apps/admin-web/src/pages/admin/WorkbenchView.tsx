import { Icon, useToast } from "../../ui";
import { useI18n } from "../../appConfig";
import { PageFrame } from "../../components/shared/layout";

export function WorkbenchView() {
  const { language } = useI18n();
  const L = (zh: string, en: string) => (language === "zh" ? zh : en);
  const toast = useToast();
  return (
    <PageFrame
      title={L("工作台", "Workbench")}
      sub={L("交互式运行与调试一次性 Agent 任务。", "Interactively run and debug one-off agent tasks.")}
    >
      <div className="overview-empty">
        <div className="ic-wrap"><Icon name="i-workflow" size={22} /></div>
        <h2>{L("工作台", "Workbench")}</h2>
        <p>{L(
          "直接起一个临时会话试跑 prompt、查看事件流并迭代，无需先建 Agent。",
          "Spin up an ephemeral session to try a prompt, watch the event stream and iterate — no agent required first."
        )}</p>
        <button className="btn primary" onClick={() => toast(L("新建临时会话（演示）", "New scratch session (demo)"), "info")}>
          <Icon name="i-play" size={14} /> {L("新建临时会话", "New scratch session")}
        </button>
      </div>
    </PageFrame>
  );
}

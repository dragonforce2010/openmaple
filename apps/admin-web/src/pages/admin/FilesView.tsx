import { Icon, useToast } from "../../ui";
import { useI18n } from "../../appConfig";
import { PageFrame } from "../../components/shared/layout";

export function FilesView() {
  const { language } = useI18n();
  const L = (zh: string, en: string) => (language === "zh" ? zh : en);
  const toast = useToast();
  return (
    <PageFrame
      title={L("文件", "Files")}
      sub={L("上传给 Agent 使用的工作区文件。", "Workspace files available to your agents.")}
    >
      <div className="overview-empty">
        <div className="ic-wrap"><Icon name="i-folder" size={22} /></div>
        <h2>{L("暂无文件", "No files yet")}</h2>
        <p>{L(
          "把数据集、文档或脚本拖到这里，会话即可在 /workspace 下读取。",
          "Drop datasets, docs or scripts here and sessions can read them under /workspace."
        )}</p>
        <button className="btn primary" onClick={() => toast(L("上传（演示）", "Upload (demo)"), "info")}>
          <Icon name="i-plus" size={14} /> {L("上传文件", "Upload file")}
        </button>
      </div>
    </PageFrame>
  );
}

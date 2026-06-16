import { Icon, useToast } from "../../ui";
import { useI18n } from "../../appConfig";
import { PageFrame } from "../../components/shared/layout";

export function ClaudeCodeView() {
  const { language } = useI18n();
  const L = (zh: string, en: string) => (language === "zh" ? zh : en);
  const toast = useToast();
  return (
    <PageFrame
      title="Claude Code"
      sub={L("把本地 Claude Code 接入托管平台。", "Connect your local Claude Code to the managed platform.")}
    >
      <div className="overview-empty">
        <div className="ic-wrap"><Icon name="i-code" size={22} /></div>
        <h2>Claude Code</h2>
        <p>{L(
          "用平台签发的工作区 Key 设置 MAPLE_API_BASE_URL 与 MAPLE_API_KEY，即可让本地 Claude Code 通过 Maple 运行。",
          "Set MAPLE_API_BASE_URL and MAPLE_API_KEY with a workspace key to run local Claude Code through Maple."
        )}</p>
        <button className="btn primary" onClick={() => toast(L("去签发 Key（演示）", "Issue a key (demo)"), "info")}>
          <Icon name="i-key" size={14} /> {L("去签发 Key", "Issue a key")}
        </button>
      </div>
    </PageFrame>
  );
}

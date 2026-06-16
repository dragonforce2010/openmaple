import { useEffect, useState } from "react";
import { apiGet } from "../../api";
import { Icon } from "../../ui";
import { useI18n } from "../../appConfig";
import { PageFrame } from "../../components/shared/layout";

export function UsageView() {
  const { language } = useI18n();
  const L = (zh: string, en: string) => (language === "zh" ? zh : en);
  const [ov, setOv] = useState<{ sessions: number; agents: number; environments: number; vaults: number; events: number } | null>(null);
  useEffect(() => {
    apiGet<{ sessions: number; agents: number; environments: number; vaults: number; events: number }>("/v1/analytics/overview").then(setOv).catch(() => {});
  }, []);
  const fmt = (value: number | undefined) => (value === undefined ? "—" : value.toLocaleString(language === "zh" ? "zh-CN" : "en-US"));
  return (
    <PageFrame title={L("用量", "Usage")} sub={L("工作区资源与事件实时统计。", "Live resource and event counts across your workspaces.")}>
      <div className="tile-grid">
        <div className="tile"><div className="lbl"><Icon name="i-terminal" size={16} /> {L("会话", "Sessions")}</div><div className="num">{fmt(ov?.sessions)}</div></div>
        <div className="tile"><div className="lbl"><Icon name="i-brain" size={16} /> {L("智能体", "Agents")}</div><div className="num">{fmt(ov?.agents)}</div></div>
        <div className="tile"><div className="lbl"><Icon name="i-activity" size={16} /> {L("事件总数", "Events")}</div><div className="num">{fmt(ov?.events)}</div></div>
        <div className="tile"><div className="lbl"><Icon name="i-cloud" size={16} /> {L("环境", "Environments")}</div><div className="num">{fmt(ov?.environments)}</div></div>
      </div>
    </PageFrame>
  );
}

import { Icon } from "../../ui";
import { useI18n } from "../../appConfig";
import { PageFrame } from "../../components/shared/layout";

export function CachingView() {
  const { language } = useI18n();
  const L = (zh: string, en: string) => (language === "zh" ? zh : en);
  return (
    <PageFrame
      title={L("缓存", "Caching")}
      sub={L("提示缓存命中率与节省。", "Prompt-cache hit rate and savings.")}
    >
      <div className="overview-empty">
        <div className="ic-wrap"><Icon name="i-database" size={22} /></div>
        <h2>{L("提示缓存已开启", "Prompt caching is on")}</h2>
        <p>{L(
          "对超过 1024 token 的稳定前缀自动缓存，5 分钟内复用。无需额外配置。",
          "Stable prefixes over 1024 tokens are cached automatically and reused within 5 minutes. No extra config required."
        )}</p>
      </div>
    </PageFrame>
  );
}

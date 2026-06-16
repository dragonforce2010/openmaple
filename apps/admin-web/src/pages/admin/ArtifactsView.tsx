import { useToast } from "../../ui";
import { useI18n } from "../../appConfig";
import { DataTable, PageFrame } from "../../components/shared/layout";

export function ArtifactsView() {
  const { language } = useI18n();
  const L = (zh: string, en: string) => (language === "zh" ? zh : en);
  const toast = useToast();

  type Art = { id: string; sess: string; sid: string; path: string; size: string; up: string };
  const ARTS: Art[] = [
    { id: "art_1", sess: "weekly sales report", sid: "sess_8feec1d", path: "/workspace/out/report.pdf", size: "182 KB", up: "12:05" },
    { id: "art_2", sess: "shopper segmentation", sid: "sess_4a1c22b", path: "/workspace/out/segments.csv", size: "44 KB", up: "09:18" },
    { id: "art_3", sess: "etl backfill", sid: "sess_22be901", path: "/workspace/logs/run.log", size: "9 KB", up: "Yesterday" },
  ];

  return (
    <PageFrame title="Artifacts" sub={L("会话运行产出的文件。", "Files produced by session runs.")}>
      <DataTable headers={[L("会话", "Session"), L("路径", "Path"), L("大小", "Size"), L("更新", "Updated"), ""]}>
        {ARTS.map((a) => (
          <tr key={a.id}>
            <td><span className="t-name">{a.sess}</span><small className="mono">{a.sid}</small></td>
            <td className="mono">{a.path}</td>
            <td>{a.size}</td>
            <td>{a.up}</td>
            <td>
              <button
                className="btn secondary compact"
                onClick={(e) => { e.stopPropagation(); toast(L("开始下载（演示）", "Download started (demo)")); }}
              >
                {L("下载", "Download")}
              </button>
            </td>
          </tr>
        ))}
      </DataTable>
    </PageFrame>
  );
}

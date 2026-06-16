import { useState } from "react";
import { Icon, useToast } from "../../ui";
import { useI18n } from "../../appConfig";
import { DataTable, PageFrame } from "../../components/shared/layout";

export function SkillsView() {
  const { language } = useI18n();
  const L = (zh: string, en: string) => (language === "zh" ? zh : en);
  const toast = useToast();

  type Skill = { id: string; name: string; desc: string; ver: number; src: string };
  const SKILLS: Skill[] = [
    { id: "sk_market", name: "market-research", desc: L("抓取并汇总市场数据", "Scrape and summarize market data"), ver: 2, src: "~/.agents/skills/market-research" },
    { id: "sk_pdf", name: "pdf-extract", desc: L("从 PDF 提取结构化字段", "Extract structured fields from PDFs"), ver: 1, src: "~/.agents/skills/pdf-extract" },
    { id: "sk_chart", name: "chart-render", desc: L("把数据渲染成图表", "Render datasets into charts"), ver: 3, src: "~/.agents/skills/chart-render" },
  ];

  const SKILL_TREE = ["market-research/", "SKILL.md", "scripts/", "scripts/run.py"];
  const SKILL_FILES: Record<string, string> = {
    "SKILL.md": "---\nname: market-research\ndescription: Scrape and summarize market data.\n---\n\n# market-research\n\nUsage: invoke with a topic keyword.",
    "scripts/run.py": "import sys\n\ndef main():\n    print('running market-research', sys.argv[1:])\n\nif __name__ == '__main__':\n    main()",
  };

  const [sel, setSel] = useState<string>(SKILLS[0].id);
  const [file, setFile] = useState<string>("SKILL.md");

  return (
    <PageFrame
      title={<>{L("技能", "Skills")} <span className="title-count">{SKILLS.length}</span></>}
      sub={L("Agent 可调用的技能，来自 ~/.agents/skills。", "Reusable skills available to agents, from ~/.agents/skills.")}
      action={
        <>
          <button
            className="btn secondary"
            onClick={() => toast(L("已扫描 ~/.agents/skills（演示）", "Scanned ~/.agents/skills (demo)"), "info")}
          >
            <Icon name="i-refresh" size={15} /> {L("扫描技能", "Scan skills")}
          </button>
          <button
            className="btn primary"
            onClick={() => toast(L("上传 Skill（演示）", "Upload skill (demo)"), "info")}
          >
            <Icon name="i-upload" size={15} /> {L("上传 Skill", "Upload skill")}
          </button>
        </>
      }
    >
      <DataTable headers={["ID", L("名称", "Name"), L("版本", "Version"), L("来源", "Source")]}>
        {SKILLS.map((s) => (
          <tr key={s.id} className={s.id === sel ? "sel" : ""} onClick={() => { setSel(s.id); setFile("SKILL.md"); }}>
            <td><span className="id-link">{s.id}</span></td>
            <td><span className="t-name">{s.name}</span><small>{s.desc}</small></td>
            <td>v{s.ver}</td>
            <td className="mono">{s.src}</td>
          </tr>
        ))}
      </DataTable>

      <div className="section-title">{L("技能文件", "Skill files")}</div>
      <div className="skill-browser" id="skill-editor">
        <div className="skill-tree">
          {SKILL_TREE.map((p) => {
            const dir = p.endsWith("/");
            const depth = (p.match(/\//g) || []).length - (dir ? 1 : 0);
            const name = p.replace(/\/$/, "").split("/").pop();
            return (
              <div key={p} className={depth > 0 ? "tree-children" : undefined}>
                <button
                  className={`tree-entry${p === file ? " sel" : ""}`}
                  onClick={dir ? undefined : () => setFile(p)}
                >
                  <Icon name={dir ? "i-folder" : "i-file"} size={14} />
                  <span>{name}</span>
                </button>
              </div>
            );
          })}
        </div>
        <div className="skill-edit">
          <div className="skill-edit-bar">
            <Icon name="i-file" size={14} />
            <b>{file}</b>
            <button className="btn secondary compact" onClick={() => toast(L("已保存（演示）", "Saved (demo)"))}>
              <Icon name="i-save" size={13} /> {L("保存", "Save")}
            </button>
          </div>
          <textarea
            className="file-editor"
            spellCheck={false}
            readOnly
            value={SKILL_FILES[file] || L("二进制或目录，无法预览。", "Binary or directory — no preview.")}
          />
        </div>
      </div>
    </PageFrame>
  );
}

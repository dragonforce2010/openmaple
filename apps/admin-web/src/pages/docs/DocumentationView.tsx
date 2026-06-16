import { Fragment, useEffect, useRef, useState } from "react";
import { Icon } from "../../ui";
import { useI18n } from "../../appConfig";
import { HighlightedCode } from "../../components/shared/code";
import { docPage } from "./documentationContent";
import type { DocId, FieldRow } from "./DocumentationTypes";

export function DocumentationView() {
  const { language } = useI18n();
  const L = (zh: string, en: string) => (language === "zh" ? zh : en);

  const [page, setPage] = useState<DocId>("overview");
  const mainRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (mainRef.current) mainRef.current.scrollTop = 0;
  }, [page]);

  const nav: { title: string; items: [DocId, string, string][] }[] = [
    {
      title: L("开始", "Get started"),
      items: [
        ["overview", L("概览", "Overview"), "i-book"],
        ["quickstart", L("快速上手", "Quickstart"), "i-play"],
        ["authentication", L("认证", "Authentication"), "i-key"]
      ]
    },
    {
	      title: L("API 参考", "API reference"),
	      items: [
	        ["workspaces-api", L("Workspaces & keys", "Workspaces & keys"), "i-grid"],
	        ["agents-api", "Agents API", "i-brain"],
        ["sessions-api", "Sessions API", "i-terminal"],
        ["environments-api", "Environments API", "i-boxes"],
        ["vaults-api", "Vaults API", "i-key"],
        ["mcp-api", "MCP API", "i-plug"],
        ["errors", L("错误与状态码", "Errors"), "i-alert"]
      ]
    },
    {
      title: "SDK & CLI",
      items: [
        ["sdks", L("Node/TypeScript SDK", "Node/TypeScript SDK"), "i-package"],
        ["cli", "Maple CLI", "i-terminal"],
        ["skills", L("Skills 模块", "Skills modules"), "i-sparkles"]
      ]
    }
  ];

  const Code = ({ children }: { children: string }) => (
    <div className="doc-code-wrap">
      <button
        className="doc-code-copy"
        onClick={(event) => {
          void navigator.clipboard?.writeText(children);
          const button = event.currentTarget;
          const original = button.textContent;
          button.textContent = L("已复制", "Copied");
          window.setTimeout(() => { button.textContent = original; }, 1500);
        }}
      >
        {L("复制", "Copy")}
      </button>
      <pre className="doc-code"><HighlightedCode code={children} /></pre>
    </div>
  );

  const DocCard = ({ id, icon, title, desc }: { id: DocId; icon: string; title: string; desc: string }) => (
    <button className="doc-card" type="button" onClick={() => setPage(id)}>
      <span className="dc-ic"><Icon name={icon} size={16} /></span>
      <b>{title}</b>
      <span className="dc-d">{desc}</span>
    </button>
  );

  const FieldTable = ({ rows }: { rows: FieldRow[] }) => (
    <table className="doc-table">
      <thead>
        <tr>
          <th>{L("字段", "Field")}</th>
          <th>{L("类型", "Type")}</th>
          <th>{L("必填", "Required")}</th>
          <th>{L("说明", "Description")}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.field}>
            <td><code>{row.field}</code></td>
            <td>{row.type}</td>
            <td>{row.required}</td>
            <td>{row.description}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  const EndpointList = ({ rows }: { rows: Array<[string, string]> }) => (
    <table className="doc-table">
      <thead>
        <tr>
          <th>{L("接口", "Endpoint")}</th>
          <th>{L("行为", "Behavior")}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(([endpoint, behavior]) => (
          <tr key={endpoint}>
            <td><code>{endpoint}</code></td>
            <td>{behavior}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  const current = docPage(page, { L, Code, DocCard, FieldTable, EndpointList });

  return (
    <section className="docs-shell">
      <aside className="doc-nav">
        {nav.map((group) => (
          <div className="dn-group" key={group.title}>
            <div className="dn-title">{group.title}</div>
            {group.items.map(([id, label, icon]) => (
              <button
                className={page === id ? "dn-item on" : "dn-item"}
                type="button"
                key={id}
                onClick={() => setPage(id)}
              >
                <Icon name={icon} size={15} />
                <span>{label}</span>
              </button>
            ))}
          </div>
        ))}
      </aside>
      <main className="doc-main" ref={mainRef}>
        <article className="doc-wrap">
          <div className="breadcrumb">
            <button type="button" onClick={() => setPage("overview")}>
              <Icon name="i-book" size={14} />{L("文档", "Docs")}
            </button>
            <span className="sep">/</span>
            <button type="button" onClick={() => setPage(page === "cli" || page === "skills" || page === "sdks" ? "sdks" : "overview")}>
              {page === "cli" || page === "skills" || page === "sdks" ? "SDK & CLI" : "API"}
            </button>
            <span className="sep">/</span>
            <span className="cur">{current.title}</span>
          </div>
          <h1 className="doc-h1">{current.title}</h1>
          <p className="doc-lead">{current.lead}</p>
          {current.sections.map((section) => (
            <Fragment key={section.id}>
              <h2 className="doc-h2" id={`doc-${section.id}`}>{section.h2}</h2>
              {section.body}
            </Fragment>
          ))}
        </article>
      </main>
      <aside className="doc-toc">
        <div className="tt">{L("本页目录", "On this page")}</div>
        {current.sections.map((section) => (
          <a key={section.id} href={`#doc-${section.id}`}>{section.h2}</a>
        ))}
      </aside>
    </section>
  );
}

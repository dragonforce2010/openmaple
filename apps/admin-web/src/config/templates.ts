import type { AgentLoopType } from "../types";

export const MODEL_PRESET_OPTIONS = [
  { value: "volcoengine-glm-4-7-251222", label: "VolcoEngine · glm-4-7-251222", name: "VolcoEngine" },
  { value: "volcoengine-doubao-seed-1-6-flash-250615", label: "VolcoEngine · doubao-seed-1-6-flash-250615", name: "VolcoEngine Doubao Seed Flash" },
  { value: "volcoengine-doubao-seed-2-0-lite-260428", label: "VolcoEngine · doubao-seed-2-0-lite-260428", name: "VolcoEngine Doubao Seed 2.0 Lite Multimodal" },
  { value: "volcoengine-deepseek-v4-flash-260425", label: "VolcoEngine · deepseek-v4-flash-260425", name: "VolcoEngine DeepSeek V4 Flash" },
  { value: "gpt-5.5", label: "GPT5.5", name: "GPT5.5" },
  { value: "maple-code", label: "Maple Code", name: "Maple Code" }
];

export type TemplateCard = readonly [string, string, string, string];

export const templateCards: TemplateCard[] = [
  ["Data insights analyst", "Clean CSV/XLSX files with pandas and openpyxl, explain metrics, and isolate anomalies", "数据洞察分析师", "使用 pandas 和 openpyxl 清洗 CSV/XLSX 文件，解释指标并定位异常"],
  ["Customer knowledge assistant", "Search product docs, return cited answers, and flag cases that need human escalation", "客户知识助手", "检索产品文档，返回带引用的回答，并标记需要人工升级的案例"],
  ["Market monitoring brief", "Track brands, competitors, and high-signal sources, then summarize shifts by theme", "市场监测简报", "跟踪品牌、竞品和高信号来源，并按主题总结变化"],
  ["Incident response commander", "Organize alerts, timelines, impact, owners, and the next response actions", "应急响应指挥官", "整理告警、时间线、影响面、负责人和下一步响应动作"],
  ["Compliance audit investigator", "Review logs, permissions, evidence chains, and audit findings with risk levels", "合规审计调查员", "审查日志、权限和证据链，并按风险等级输出审计发现"],
  ["Developer productivity assistant", "Read repositories, run tests, locate failures, and propose the smallest useful change", "研发效率助手", "读取代码仓库、运行测试、定位失败，并提出最小有效改动"],
  ["Growth experiment designer", "Break down hypotheses, metrics, sample size, tracking needs, and review templates", "增长实验设计师", "拆解假设、指标、样本量、埋点需求和复盘模板"],
  ["Finance reconciliation bot", "Use openpyxl and pandas to compare ledgers, invoices, deltas, and explanations", "财务对账机器人", "使用 openpyxl 和 pandas 比对台账、发票、差异和解释"],
  ["Browser QA specialist", "Use playwright for end-to-end checks, screenshots, performance notes, and interaction issues", "浏览器 QA 专家", "使用 Playwright 做端到端检查、截图、性能记录和交互问题定位"],
  ["Node automation builder", "Use npm and pnpm scripts to batch content, call APIs, and generate deliverables", "Node 自动化构建器", "使用 npm 和 pnpm 脚本批处理内容、调用 API 并生成交付物"]
];

export const TEMPLATE_SYSTEMS = [
  "You are a data insights analyst. Prefer environments with packages: pandas and openpyxl for CSV/XLSX work. Profile fields, missing values, duplicates, and outliers first, then provide metric definitions, key findings, reproducible code, and next analysis steps. Do not invent data; every conclusion must trace back to source fields or calculations.",
  "You are a customer knowledge assistant. Search documentation, FAQs, ticket history, and policy material before answering. Lead with the answer, then cite evidence. Escalate account permission, refund, compliance, or unsupported-documentation cases to a human.",
  "You are a market monitoring brief agent. For a given brand, competitor, or topic, collect high-signal sources over a time window and cluster changes into themes, risk signals, opportunities, and recommended actions. Include dates, sources, impact judgment, and confidence.",
  "You are an incident response commander. When an alert arrives, confirm impact, severity, current status, and owner first. Maintain a timeline, hypotheses, validation results, and next actions. Mark uncertain information as pending confirmation and avoid overpromising.",
  "You are a compliance audit investigator. Review accounts, permissions, logs, and configuration evidence chains. Report findings, evidence, impact, remediation, and follow-up checks by risk level. Keep the audit tone neutral and separate facts, inference, and missing evidence.",
  "You are a developer productivity assistant. Read repositories and error logs, locate the smallest failing path, and prefer existing tests and static checks. Return the minimal useful change, risks, and verification commands. Ask before destructive operations.",
  "You are a growth experiment designer. Turn a business goal into hypotheses, user segments, metric definitions, experiment design, rough sample-size guidance, tracking needs, and review templates. Avoid generic advice; every experiment should state the decision it enables.",
  "You are a finance reconciliation bot. Prefer packages: pandas and openpyxl to read ledgers, invoices, and statements. Match amount, date, entity, tax rate, and currency; return delta tables, cause categories, human-review items, and reproducible scripts.",
  "You are a browser QA specialist. Prefer packages: playwright for end-to-end flow validation. Record visible state, loading behavior, error messages, perceived performance, and screenshots for each step. When you find an issue, provide reproduction steps, expected behavior, and actual behavior.",
  "You are a Node automation builder. Prefer packages: npm, pnpm, zx, and lodash for batch scripts, API calls, and generated files. Deliverables must include run commands, input/output paths, retry behavior, and a minimal smoke test."
];

export const agentLoopOptions: Array<{ type: AgentLoopType; label: string; description: string }> = [
  {
    type: "anthropic_claude_code",
    label: "Maple Code loop",
    description: "Maple managed coding loop with concise planning and tool-backed file work."
  },
  {
    type: "codex_open_source",
    label: "Codex open-source loop",
    description: "Codex-style repo automation loop for local harness and CLI-driven workflows."
  }
];

export const defaultPrompt =
  "Create an agent that reads video ideas from a Notion database, studies competitor title patterns, and generates a short script plus five title options for each idea.";

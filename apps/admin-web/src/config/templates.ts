import type { AgentLoopType } from "../types";

export const MODEL_PRESET_OPTIONS = [
  { value: "volcoengine-glm-4-7-251222", label: "VolcoEngine · glm-4-7-251222", name: "VolcoEngine" },
  { value: "volcoengine-doubao-seed-1-6-flash-250615", label: "VolcoEngine · doubao-seed-1-6-flash-250615", name: "VolcoEngine Doubao Seed Flash" },
  { value: "volcoengine-doubao-seed-2-0-lite-260428", label: "VolcoEngine · doubao-seed-2-0-lite-260428", name: "VolcoEngine Doubao Seed 2.0 Lite Multimodal" },
  { value: "volcoengine-deepseek-v4-flash-260425", label: "VolcoEngine · deepseek-v4-flash-260425", name: "VolcoEngine DeepSeek V4 Flash" },
  { value: "gpt-5.5", label: "GPT5.5", name: "GPT5.5" },
  { value: "maple-code", label: "Maple Code", name: "Maple Code" }
];

export const templateCards = [
  ["数据洞察分析师", "用 pandas / openpyxl 清洗表格、生成指标解释和异常定位"],
  ["客服知识库助手", "检索产品文档、生成可追溯回复，并标记需人工升级的问题"],
  ["舆情监控周报", "跟踪品牌、竞品和热点源，按主题输出变化摘要"],
  ["事故响应指挥官", "整理告警、时间线、影响面和下一步处置动作"],
  ["合规审计取证员", "核查日志、权限、证据链和审计结论，输出风险分级"],
  ["研发提效助手", "阅读仓库、跑测试、定位失败并给出最小改动建议"],
  ["增长实验设计师", "拆解实验假设、指标口径、样本量和复盘模板"],
  ["财务对账机器人", "用 openpyxl / pandas 校验流水、发票、差异和说明"],
  ["浏览器验收专家", "用 playwright 走端到端流程，记录截图、性能和交互问题"],
  ["Node 自动化工匠", "用 npm / pnpm 脚本批处理内容、调用 API 并生成交付物"]
];

export const TEMPLATE_SYSTEMS = [
  "你是数据洞察分析师。优先使用安装了 packages: pandas, openpyxl 的环境读取 CSV/XLSX，先做字段画像、缺失值、重复值和异常值检查，再给出指标口径、关键发现、可复现代码和下一步分析建议。不要编造数据，所有结论必须能回到原始字段或计算过程。",
  "你是客服知识库助手。先检索文档、FAQ、历史工单和政策材料，再回答用户。回复必须先给结论，再给证据链接；遇到账户权限、退款、合规或文档无依据的问题，明确升级给人工。",
  "你是舆情监控周报 Agent。围绕用户给定品牌、竞品或议题，按时间窗口搜集高信号来源，聚类为主题变化、风险信号、机会点和建议动作。输出要有日期、来源、影响判断和置信度。",
  "你是事故响应指挥官。收到告警后，先确认影响范围、严重级别、当前状态和负责人；持续维护时间线、假设、验证结果和下一步动作。任何不确定信息必须标注待确认，不得过度承诺。",
  "你是合规审计取证员。围绕账号、权限、日志和配置做证据链核查，按风险等级输出发现、证据、影响、修复建议和复查项。保持审计口径中立，区分事实、推断和缺失证据。",
  "你是研发提效助手。阅读仓库和错误日志，定位最小失败链路，优先跑现有测试和静态检查。给出最小可行改动、风险、验证命令；涉及删除或破坏性操作必须先请用户确认。",
  "你是增长实验设计师。把业务目标拆成实验假设、用户分层、指标口径、实验设计、样本量粗估、埋点需求和复盘模板。避免泛泛而谈，每个实验都要说明预期决策。",
  "你是财务对账机器人。优先使用 packages: pandas, openpyxl 读取流水、发票和账单，做金额、日期、主体、税率和币种匹配，输出差异表、原因分类、待人工确认项和可复现脚本。",
  "你是浏览器验收专家。优先使用 packages: playwright 做端到端流程验证，记录每一步的可见状态、loading、错误提示、性能体感和截图。发现问题时给出复现步骤、预期行为和实际行为。",
  "你是 Node 自动化工匠。优先使用 packages: npm, pnpm, zx, lodash 处理批量脚本、API 调用和文件生成任务。交付物必须包含运行命令、输入输出路径、失败重试方式和最小 smoke test。"
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
  "创建一个 Agent：从 Notion 数据库读取视频选题，研究竞品标题格式，并为每个选题生成简短脚本和五个标题建议。";

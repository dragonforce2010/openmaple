import type { View } from "./appTypes";

export const NAV_META: Record<View, { icon: string; zh: string; en: string }> = {
  dashboard: { icon: "i-home", zh: "仪表盘", en: "Dashboard" },
  quickstart: { icon: "i-sparkles", zh: "快速开始", en: "Quickstart" },
  agents: { icon: "i-brain", zh: "智能体", en: "Agents" },
  deployments: { icon: "i-workflow", zh: "部署", en: "Deployments" },
  sessions: { icon: "i-terminal", zh: "会话", en: "Sessions" },
  environments: { icon: "i-server", zh: "环境", en: "Environments" },
  vaults: { icon: "i-key", zh: "凭证库", en: "Credential vaults" },
  tenant: { icon: "i-boxes", zh: "租户", en: "Tenant" },
  tenant_select: { icon: "i-boxes", zh: "选择租户", en: "Select tenant" },
  tenant_choice: { icon: "i-boxes", zh: "选择租户", en: "Choose tenant" },
  no_access: { icon: "i-lock", zh: "无权限", en: "No access" },
  models: { icon: "i-gauge", zh: "模型", en: "Models" },
  api_keys: { icon: "i-key", zh: "秘钥", en: "API keys" },
  docs: { icon: "i-book", zh: "文档", en: "Documentation" },
  memory: { icon: "i-memory", zh: "记忆库", en: "Memory stores" },
  users: { icon: "i-users", zh: "用户", en: "Users" },
  skills: { icon: "i-filecode", zh: "技能", en: "Skills" },
  usage: { icon: "i-activity", zh: "用量", en: "Usage" },
  logs: { icon: "i-list", zh: "日志", en: "Logs" },
  caching: { icon: "i-database", zh: "缓存", en: "Caching" },
  artifacts: { icon: "i-archive", zh: "制品", en: "Artifacts" },
  workbench: { icon: "i-workflow", zh: "工作台", en: "Workbench" },
  files: { icon: "i-folder", zh: "文件", en: "Files" },
  batches: { icon: "i-boxes", zh: "批处理", en: "Batches" },
  claudecode: { icon: "i-code", zh: "Claude Code", en: "Claude Code" },
  agent: { icon: "i-brain", zh: "Agent 详情", en: "Agent detail" },
  environment: { icon: "i-server", zh: "环境详情", en: "Environment detail" },
  vault: { icon: "i-key", zh: "凭证库详情", en: "Vault detail" },
  credential: { icon: "i-key", zh: "凭据详情", en: "Credential detail" },
  provision: { icon: "i-boxes", zh: "开通", en: "Provision" }
};

export const NAV_GROUPS: Array<{ title?: [string, string]; badge?: [string, string]; items: View[] }> = [
  { items: ["dashboard"] },
  { title: ["托管 Agent", "Managed Agents"], badge: ["新", "New"], items: ["quickstart", "agents", "deployments", "sessions", "environments", "vaults"] },
  { title: ["管理", "Manage"], items: ["tenant", "users", "models", "api_keys"] },
  { items: ["docs"] }
];
export const TENANT_ADMIN_ONLY_VIEWS = new Set<View>(["tenant"]);
export const WORKSPACE_ADMIN_ONLY_VIEWS = new Set<View>(["models", "api_keys", "users"]);

import type { Language } from "../../appConfig";
import { agentLoopOptions } from "../../appConfig";
import type { Environment, JsonRecord, VaultCredential, Workspace } from "../../types";
import { formatRelativeTime } from "./misc";

export const WS_COLORS = ["#c36b55", "#2e79c8", "#2e9d6b", "#7c6bd6", "#9d7417", "#3370ff", "#d15b6b", "#577c4a"];
export function workspaceColor(id: string) {
  let hash = 0;
  for (let index = 0; index < id.length; index += 1) hash = (hash * 31 + id.charCodeAt(index)) >>> 0;
  return WS_COLORS[hash % WS_COLORS.length];
}

export function environmentRuntimeLabel(environment: Environment) {
  const sandbox = environment.config.sandbox as JsonRecord | undefined;
  const agentRuntime = environment.config.agent_runtime as JsonRecord | undefined;
  const legacyProvider = String(sandbox?.provider ?? environment.config.type ?? "");
  const agentProvider = String(agentRuntime?.provider ?? (legacyProvider === "vefaas" ? "vefaas" : "managed"));
  const sandboxProvider = String(legacyProvider === "vefaas" ? "managed" : sandbox?.provider ?? environment.config.type ?? environment.config.image ?? "e2b");
  return agentProvider === "managed" ? sandboxProvider : `${agentProvider} / ${sandboxProvider}`;
}

export function isProductionEnvironment(environment: Environment) {
  const text = `${environment.name} ${JSON.stringify(environment.config)}`.toLowerCase();
  return !text.includes("local") && !text.includes("local_docker") && !text.includes("docker sandbox");
}

export function agentLoopLabel(type?: string) {
  return agentLoopOptions.find((loop) => loop.type === type)?.label ?? "Maple Code loop";
}

export function agentStatusForIndex(index: number) {
  if (index === 0) return "active";
  if (index === 1) return "running";
  return "idle";
}

export function credentialAuthLabel(authType: string, language: Language) {
  if (authType === "oauth") return "MCP OAuth";
  if (authType === "bearer_token") return "Bearer token";
  if (authType === "api_key") return "API key";
  return language === "zh" ? "未配置" : "Not configured";
}

export function credentialProviderName(credential: VaultCredential) {
  const name = credential.metadata?.mcp_server_name;
  const provider = credential.metadata?.provider;
  return typeof name === "string" && name ? name : typeof provider === "string" && provider ? provider : "Custom Server";
}

export function credentialLastUsed(credential: VaultCredential, language: Language) {
  const lastUsed = credential.metadata?.last_used_at;
  if (typeof lastUsed === "string" && lastUsed) return formatRelativeTime(lastUsed, language);
  return language === "zh" ? "从未" : "Never";
}

export function workspaceLabel(workspaces: Workspace[], id?: string | null): { name: string | null; id: string } | null {
  if (!id) return null;
  const ws = workspaces.find((item) => item.id === id);
  // name is null when the workspace isn't in the user's set — render only the id chip, not a duplicate
  return { name: ws?.name ?? null, id };
}

type Localizer = Language | ((zh: string, en: string) => string);

function localize(localizer: Localizer | undefined, zh: string, en: string) {
  if (typeof localizer === "function") return localizer(zh, en);
  if (localizer === "zh") return zh;
  return en;
}

export function statusPill(status: string, languageOrL?: Localizer) {
  const known = ["idle", "running", "failed", "active", "paused", "archived", "succeeded", "bootstrapping", "tool_waiting", "installing_packages"];
  const cls = known.includes(status) ? status : "idle";
  const labels: Record<string, string> = {
    idle: localize(languageOrL, "空闲", "Idle"),
    running: localize(languageOrL, "运行中", "Running"),
    failed: localize(languageOrL, "失败", "Failed"),
    active: localize(languageOrL, "启用", "Active"),
    paused: localize(languageOrL, "已暂停", "Paused"),
    archived: localize(languageOrL, "已归档", "Archived"),
    succeeded: localize(languageOrL, "成功", "Succeeded"),
    bootstrapping: localize(languageOrL, "启动中", "Bootstrapping"),
    tool_waiting: localize(languageOrL, "等待工具", "Tool waiting"),
    installing_packages: localize(languageOrL, "安装依赖", "Installing packages")
  };
  const label = labels[status] ?? status;
  return <span className={`status ${cls}`}>{label}</span>;
}

export function defaultToggle(on: boolean, opts?: { onClick?: () => void; disabled?: boolean; busy?: boolean }) {
  const className = on ? "tgl on" : "tgl";
  if (!opts?.onClick) return <span className={className} role="img" aria-hidden="true" />;
  return (
    <button
      type="button"
      className={className}
      disabled={opts.disabled || opts.busy}
      aria-pressed={on}
      onClick={opts.onClick}
    />
  );
}

export function apiKeyStatusPill(enabled: boolean, languageOrL: Language | ((zh: string, en: string) => string)) {
  const label = typeof languageOrL === "function"
    ? languageOrL(enabled ? "已启用" : "已停用", enabled ? "Active" : "Disabled")
    : languageOrL === "zh"
      ? enabled ? "已启用" : "已停用"
      : enabled ? "Active" : "Disabled";
  return <span className={`status ${enabled ? "active" : "disabled"}`}>{label}</span>;
}

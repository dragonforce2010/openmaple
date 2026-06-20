import type { Language } from "../../appConfig";
import type { WorkspaceSlugStatus } from "../../types";

export function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "managed-agent";
}

export function slugReasonLabel(reason: WorkspaceSlugStatus["reason"]) {
  if (reason === "reserved") return "Slug 为系统保留词";
  if (reason === "taken") return "Slug 已被占用";
  if (reason === "invalid") return "Slug 格式无效";
  return "Slug 可用";
}

export function formatTime(value?: string) {
  if (!value) return "";
  return new Date(value).toLocaleString();
}

export function authProviderLabel(provider: string) {
  const normalized = provider.trim().toLowerCase();
  if (normalized === "lark_sso" || normalized === "bytesso") return "Enterprise SSO";
  if (normalized === "local") return "Developer";
  if (normalized === "oauth") return "OAuth";
  if (normalized === "oidc") return "OIDC";
  return provider || "-";
}

export function formatRelativeTime(value?: string, language: Language = "zh") {
  if (!value) return "";
  const deltaMs = Date.now() - new Date(value).getTime();
  const minutes = Math.max(0, Math.round(deltaMs / 60_000));
  if (minutes < 1) return language === "zh" ? "刚刚" : "just now";
  if (minutes < 60) return language === "zh" ? `${minutes} 分钟前` : `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return language === "zh" ? `${hours} 小时前` : `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return language === "zh" ? "昨天" : "yesterday";
  return language === "zh" ? `${days} 天前` : `${days}d ago`;
}

export function shortText(value: string, max = 36) {
  if (!value) return "-";
  return value.length <= max ? value : `${value.slice(0, Math.max(4, max - 3))}...`;
}

export function errorMessage(reason: unknown) {
  return reason instanceof Error ? reason.message : String(reason);
}

export async function writeClipboard(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

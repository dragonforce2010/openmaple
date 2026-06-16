export type ChatEventRole = "user" | "agent" | "tool" | "system" | "error";

export type ChatEvent = {
  id: string;
  type: string;
  role: ChatEventRole;
  text?: string;
  payload?: Record<string, unknown>;
  created_at?: string;
};

export function chatEventRole(type: string): ChatEventRole {
  if (type === "user.message") return "user";
  if (type.startsWith("agent.")) return "agent";
  if (type.includes("tool")) return "tool";
  if (type.includes("error") || type.includes("failed")) return "error";
  return "system";
}

import type { AuthUser } from "../auth";
import {
  canAccessWorkspace,
  db,
  listAgents,
  listEnvironments,
  listModelConfigs,
  listSessionEvents,
  listSessions,
  listVaults,
  listWorkspaceApiKeys,
  listWorkspacesForUser
} from "../store";
import type { JsonRecord } from "../types";

const workspaceColors = ["#a78bfa", "#f0a3c8", "#f4b483", "#e9d27a", "#9bd6c0", "#8b5cf6", "#e0568f", "#e8843f", "#d9a521", "#34a36f"];

export function buildConsoleSnapshot(user: AuthUser) {
  const workspaces = listWorkspacesForUser(user.id) as JsonRecord[];
  const workspaceIds = new Set(workspaces.map((workspace) => String(workspace.id)));
  const selectedWorkspace = workspaces[0] ?? null;
  const selectedWorkspaceId = selectedWorkspace ? String(selectedWorkspace.id) : null;
  const tenant = selectedWorkspace?.tenant_id ? tenantForWorkspace(String(selectedWorkspace.tenant_id), user, selectedWorkspace) : emptyTenant(user);
  const agents = selectedWorkspaceId ? (listAgents(selectedWorkspaceId) as JsonRecord[]) : [];
  const environments = selectedWorkspaceId ? (listEnvironments(selectedWorkspaceId) as JsonRecord[]) : [];
  const vaults = selectedWorkspaceId ? (listVaults(selectedWorkspaceId) as JsonRecord[]) : [];
  const models = listModelConfigs(selectedWorkspaceId ?? "-1") as JsonRecord[];
  const apiKeys = selectedWorkspaceId ? (listWorkspaceApiKeys(selectedWorkspaceId) as JsonRecord[]) : [];
  const sessions = (listSessions() as JsonRecord[]).filter((session) => {
    const workspaceId = typeof session.workspace_id === "string" ? session.workspace_id : null;
    return workspaceId ? workspaceIds.has(workspaceId) : selectedWorkspaceId ? canAccessWorkspace(user.id, selectedWorkspaceId) : false;
  });
  const eventsBy = Object.fromEntries(sessions.map((session) => [session.id, mapEvents(String(session.id))]));

  return {
    me: {
      email: user.email,
      name: user.name,
      method: user.auth_provider,
      initial: (user.name?.[0] || user.email?.[0] || "M").toUpperCase()
    },
    tenant,
    workspaces: workspaces.map((workspace, index) => mapWorkspace(workspace, index)),
    agents: agents.map(mapAgent),
    sessions: sessions.map((session) => mapSession(session, agents, environments, vaults)),
    events_by: eventsBy,
    event_detail: {},
    environments: environments.map(mapEnvironment),
    vaults: vaults.map(mapVault),
    models: models.map(mapModel),
    api_keys: apiKeys.map((key) => mapApiKey(key, user)),
    counts: {
      agents: agents.length,
      sessions: sessions.length,
      environments: environments.length,
      vaults: vaults.length,
      models: models.length
    }
  };
}

function tenantForWorkspace(tenantId: string, user: AuthUser, workspace: JsonRecord) {
  const row = db.prepare("SELECT * FROM tenants WHERE id = ?").get(tenantId) as JsonRecord | undefined;
  if (!row) return emptyTenant(user);
  const metadata = parseJson(row.metadata_json, {});
  const admin = (metadata.admin as JsonRecord | undefined) ?? {};
  const workspaceConfig = (workspace.config as JsonRecord | undefined) ?? {};
  return {
    name: String(row.name || workspace.name || "Maple"),
    slug: String(metadata.slug || workspaceConfig.slug || ""),
    id: String(row.id),
    desc: String(row.description || ""),
    creator: `${user.name} · ${user.email}`,
    created: formatDate(String(row.created_at || "")),
    admins: [{ name: String(admin.name || user.name), email: String(admin.email || user.email), role: "owner" }]
  };
}

function emptyTenant(user: AuthUser) {
  return {
    name: "",
    slug: "",
    id: "",
    desc: "",
    creator: `${user.name} · ${user.email}`,
    created: "",
    admins: [{ name: user.name, email: user.email, role: "owner" }]
  };
}

function mapWorkspace(workspace: JsonRecord, index: number) {
  const config = (workspace.config as JsonRecord | undefined) ?? {};
  return {
    id: String(workspace.id),
    name: String(workspace.name),
    color: workspaceColors[index % workspaceColors.length],
    geo: String(config.geo || config.region || "CN"),
    note: String(workspace.description || "")
  };
}

function mapAgent(agent: JsonRecord) {
  const config = (agent.config as JsonRecord | undefined) ?? {};
  const model = (config.model as JsonRecord | undefined) ?? {};
  const loop = (config.agent_loop as JsonRecord | undefined) ?? {};
  return {
    id: String(agent.id),
    name: String(agent.name),
    status: "active",
    desc: String(agent.description || config.description || ""),
    model: String(model.id || model.name || model.provider || ""),
    loop: String(loop.type || ""),
    created: formatDate(String(agent.created_at || "")),
    updated: formatRelative(String(agent.updated_at || agent.created_at || "")),
    system: String(config.system || ""),
    mcps: Array.isArray(config.mcp_servers) ? config.mcp_servers.map((item) => String((item as JsonRecord).name || (item as JsonRecord).url || "mcp")) : [],
    builtins: Array.isArray(config.tools) ? config.tools.map(String) : [],
    skills: Array.isArray(config.skills) ? config.skills.map(String) : [],
    sessions: Number(agent.sessions || 0)
  };
}

function mapSession(session: JsonRecord, agents: JsonRecord[], environments: JsonRecord[], vaults: JsonRecord[]) {
  const agent = agents.find((item) => item.id === session.agent_id);
  const environment = environments.find((item) => item.id === session.environment_id);
  const metadata = (session.metadata as JsonRecord | undefined) ?? {};
  const vault = vaults.find((item) => item.id === metadata.vault_id);
  const agentSnapshot = (session.agent_snapshot as JsonRecord | undefined) ?? {};
  return {
    id: String(session.id),
    title: String(session.title),
    status: normalizeSessionStatus(String(session.status || "")),
    agentId: String(session.agent_id || ""),
    agent: String(agent?.name || agentSnapshot.name || session.agent_id || ""),
    env: String(environment?.name || session.environment_id || ""),
    vault: String(vault?.display_name || ""),
    files: 0,
    dur: "",
    ago: formatRelative(String(session.updated_at || session.created_at || ""))
  };
}

function mapEvents(sessionId: string) {
  return (listSessionEvents(sessionId) as JsonRecord[]).map((event) => {
    const type = String(event.type || "");
    return {
      id: String(event.id),
      role: type === "user.message" ? "User" : type === "agent.message" ? "Agent" : type.includes("tool") ? "Tool" : "Session",
      title: eventPreview(event),
      t: formatClock(String(event.created_at || "")),
      kind: type.includes("error") ? "error" : type.includes("tool") ? "tool" : undefined
    };
  });
}

function mapEnvironment(environment: JsonRecord) {
  const config = (environment.config as JsonRecord | undefined) ?? {};
  const sandbox = (config.sandbox as JsonRecord | undefined) ?? {};
  const networking = (config.networking as JsonRecord | undefined) ?? {};
  const metadata = (config.metadata as JsonRecord | undefined) ?? {};
  return {
    id: String(environment.id),
    name: String(environment.name),
    rt: String(sandbox.provider || config.type || "e2b"),
    net: String(networking.mode || "cloud_limited"),
    desc: String(metadata.description || ""),
    pkgs: Array.isArray(config.packages) ? config.packages : [],
    meta: Object.entries(metadata).map(([key, value]) => [key, String(value)])
  };
}

function mapVault(vault: JsonRecord) {
  return {
    id: String(vault.id),
    name: String(vault.display_name),
    cred: Number(vault.credential_count || 0)
  };
}

function mapModel(model: JsonRecord) {
  return {
    id: String(model.id),
    name: String(model.name),
    preset: String(model.preset_key || ""),
    type: String(model.provider_type || "custom"),
    proto: String(model.provider_type || "custom") === "anthropic" ? "anthropic" : "openai",
    model: String(model.model_name || ""),
    models: [String(model.model_name || "")].filter(Boolean),
    url: String(model.base_url || ""),
    def: Boolean(model.is_default),
    builtin: String(model.provider_type || "") === "preset",
    key: model.has_api_key ? "Stored" : ""
  };
}

function mapApiKey(key: JsonRecord, user: AuthUser) {
  return {
    id: String(key.id),
    name: String(key.display_name),
    key: String(key.key || ""),
    by: user.name,
    byEmail: user.email,
    created: formatDate(String(key.created_at || "")),
    used: key.last_used_at ? formatDate(String(key.last_used_at)) : "",
    cost: "",
    ws: String(key.workspace_id || "")
  };
}

function eventPreview(event: JsonRecord) {
  const payload = (event.payload as JsonRecord | undefined) ?? {};
  return String(payload.text || payload.message || event.type || event.id);
}

function normalizeSessionStatus(status: string) {
  if (status === "running") return "running";
  if (status === "failed") return "failed";
  return "idle";
}

function formatRelative(value: string) {
  const date = Date.parse(value);
  if (!Number.isFinite(date)) return "";
  const delta = Date.now() - date;
  if (delta < 60_000) return "刚刚";
  if (delta < 3_600_000) return `${Math.max(1, Math.floor(delta / 60_000))} 分钟前`;
  if (delta < 86_400_000) return `${Math.max(1, Math.floor(delta / 3_600_000))} 小时前`;
  return formatDate(value);
}

function formatDate(value: string) {
  const date = Date.parse(value);
  if (!Number.isFinite(date)) return "";
  return new Date(date).toISOString().slice(0, 16).replace("T", " ");
}

function formatClock(value: string) {
  const date = Date.parse(value);
  if (!Number.isFinite(date)) return "";
  return new Date(date).toTimeString().slice(0, 8);
}

function parseJson(value: unknown, fallback: JsonRecord) {
  if (typeof value !== "string") return fallback;
  try {
    return JSON.parse(value) as JsonRecord;
  } catch {
    return fallback;
  }
}

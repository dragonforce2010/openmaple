import type { EntityKind, Modal, View } from "./appTypes";
import type { Workspace } from "../types";

export type ConsoleDrawerRoute = { kind: EntityKind; id: string };
export type ConsoleRouteState = {
  hasWorkspaceRoute: boolean;
  hasConsoleAnchor: boolean;
  view: View;
  routeId: string;
  routeEdit: boolean;
  selectedSession: string;
  selectedEventId: string;
  eventMode: "transcript" | "debug";
  modal: Modal;
  modalVaultId: string;
  sessionAgentLock: string;
  askMapleOpen: boolean;
  settingsOpen: boolean;
  metric: string | null;
  drawers: ConsoleDrawerRoute[];
};

const DETAIL_SEGMENTS: Record<string, View> = {
  agent: "agent",
  environment: "environment",
  vault: "vault",
  sessions: "sessions"
};

const PAGE_VIEWS = new Set<View>([
  "dashboard", "quickstart", "agents", "deployments", "sessions", "environments", "vaults", "tenant",
  "models", "api_keys", "docs", "memory", "users", "skills", "usage", "logs", "caching", "artifacts",
  "workbench", "files", "batches", "claudecode", "provision", "tenant_select", "tenant_choice", "no_access"
]);

const MODALS = new Set<Modal>(["environment", "vault", "credential", "session", "model_config", "workspace_settings", "workspace_create", "mcp_connect", "agent_create"]);
const DRAWER_KINDS = new Set<EntityKind>(["agent", "environment", "vault", "session", "workspace"]);
const STATUS_PARAMS = ["credential_connected", "mcp_connected", "mcp_error", "vault"];

function decodePart(value: string | undefined) {
  try {
    return decodeURIComponent(value ?? "").trim();
  } catch {
    return "";
  }
}

function cleanId(value: string | null | undefined) {
  const decoded = decodePart(value ?? "");
  return decoded && !/[/?#\s]/.test(decoded) && decoded.length <= 160 ? decoded : "";
}

function cleanMetric(value: string | null) {
  const decoded = cleanId(value);
  return decoded || null;
}

function cleanModal(value: string | null): Modal {
  return MODALS.has(value as Modal) ? (value as Modal) : null;
}

function pathAfterWorkspace(pathname: string) {
  const match = pathname.match(/^\/t\/[^/]+(?:\/w\/[^/]+)?(?:\/(.*))?$/);
  return { hasWorkspaceRoute: Boolean(match), rest: match?.[1] ?? "" };
}

function parseDrawers(value: string | null): ConsoleDrawerRoute[] {
  if (!value) return [];
  return value.split(",").slice(0, 3).map((item) => {
    const [kind, id] = item.split(":");
    return DRAWER_KINDS.has(kind as EntityKind) ? { kind: kind as EntityKind, id: cleanId(id) } : null;
  }).filter((item): item is ConsoleDrawerRoute => Boolean(item?.id));
}

function paramsHaveAnchor(params: URLSearchParams) {
  for (const key of ["edit", "modal", "modal_vault", "session_agent", "drawer", "ask", "settings", "metric", "event", "mode"]) {
    if (params.has(key)) return true;
  }
  return false;
}

export function consoleRouteFromLocation(location: Pick<Location, "pathname" | "search"> = window.location): ConsoleRouteState {
  const params = new URLSearchParams(location.search);
  const { hasWorkspaceRoute, rest } = pathAfterWorkspace(location.pathname);
  const parts = rest.split("/").filter(Boolean);
  const first = decodePart(parts[0]);
  let view: View = "dashboard";
  let routeId = "";
  if (first === "vault" && decodePart(parts[2]) === "credentials") {
    const vaultId = cleanId(parts[1]);
    const credentialId = cleanId(parts[3]);
    if (vaultId && credentialId) {
      view = "credential";
      routeId = credentialRouteId(vaultId, credentialId);
    }
  } else if (DETAIL_SEGMENTS[first]) {
    view = DETAIL_SEGMENTS[first];
    routeId = cleanId(parts[1]);
  } else if (PAGE_VIEWS.has(first as View)) {
    view = first as View;
  }
  const selectedSession = view === "sessions" ? routeId || cleanId(params.get("session")) : cleanId(params.get("session"));
  return {
    hasWorkspaceRoute,
    hasConsoleAnchor: hasWorkspaceRoute && (Boolean(rest) || paramsHaveAnchor(params)),
    view,
    routeId,
    routeEdit: params.get("edit") === "1",
    selectedSession,
    selectedEventId: cleanId(params.get("event")),
    eventMode: params.get("mode") === "debug" ? "debug" : "transcript",
    modal: cleanModal(params.get("modal")),
    modalVaultId: cleanId(params.get("modal_vault")),
    sessionAgentLock: cleanId(params.get("session_agent")),
    askMapleOpen: params.get("ask") === "1",
    settingsOpen: params.get("settings") === "1",
    metric: cleanMetric(params.get("metric")),
    drawers: parseDrawers(params.get("drawer"))
  };
}

export function hasOAuthStatusParams(search = window.location.search) {
  const params = new URLSearchParams(search);
  return STATUS_PARAMS.some((key) => params.has(key));
}

function workspaceRouteBase(workspace: Workspace | null | undefined) {
  const config = workspace?.config ?? {};
  const tenantSlug = cleanId(String(config.tenant_slug || ""));
  const workspaceSlug = cleanId(String(config.slug || ""));
  if (!tenantSlug || !workspaceSlug) return "";
  return `/t/${encodeURIComponent(tenantSlug)}/w/${encodeURIComponent(workspaceSlug)}`;
}

function currentWorkspaceBase() {
  const match = window.location.pathname.match(/^(\/t\/[^/]+(?:\/w\/[^/]+)?)(?:\/.*)?$/);
  return match?.[1] ?? "";
}

function pagePath(input: { view: View; routeId: string; selectedSession: string }) {
  const id = input.routeId ? `/${encodeURIComponent(input.routeId)}` : "";
  if (input.view === "agent") return `/agent${id}`;
  if (input.view === "environment") return `/environment${id}`;
  if (input.view === "vault") return `/vault${id}`;
  if (input.view === "credential") {
    const route = parseCredentialRouteId(input.routeId);
    return route ? `/vault/${encodeURIComponent(route.vaultId)}/credentials/${encodeURIComponent(route.credentialId)}` : "/vaults";
  }
  if (input.view === "sessions") return input.selectedSession ? `/sessions/${encodeURIComponent(input.selectedSession)}` : "/sessions";
  return PAGE_VIEWS.has(input.view) ? `/${input.view}` : "/dashboard";
}

export function credentialRouteId(vaultId: string, credentialId: string) {
  return `${vaultId}/${credentialId}`;
}

export function parseCredentialRouteId(routeId: string) {
  const [vaultId, credentialId] = routeId.split("/");
  const cleanVaultId = cleanId(vaultId);
  const cleanCredentialId = cleanId(credentialId);
  return cleanVaultId && cleanCredentialId ? { vaultId: cleanVaultId, credentialId: cleanCredentialId } : null;
}

export function currentCredentialDetailReturnPath(vaultId: string, credentialId: string) {
  const base = currentWorkspaceBase();
  if (!base) return currentConsoleReturnPath();
  return `${base}/vault/${encodeURIComponent(vaultId)}/credentials/${encodeURIComponent(credentialId)}`;
}

export function currentQuickstartReturnPath() {
  const base = currentWorkspaceBase();
  if (!base) return currentConsoleReturnPath();
  return `${base}/quickstart?quickstart_restore=1`;
}

export function consolePathForState(input: {
  workspace: Workspace | null;
  view: View;
  routeId: string;
  routeEdit: boolean;
  selectedSession: string;
  selectedEventId: string;
  eventMode: "transcript" | "debug";
  modal: Modal;
  modalVaultId: string;
  sessionAgentLock: string;
  askMapleOpen: boolean;
  settingsOpen: boolean;
  metric: string | null;
  drawers: ConsoleDrawerRoute[];
}) {
  const base = workspaceRouteBase(input.workspace) || currentWorkspaceBase();
  if (!base) return "";
  const params = new URLSearchParams();
  if (input.routeEdit) params.set("edit", "1");
  if (input.view === "sessions" && input.selectedEventId) params.set("event", input.selectedEventId);
  if (input.view === "sessions" && input.eventMode === "debug") params.set("mode", "debug");
  if (input.modal) params.set("modal", input.modal);
  if (input.modal === "credential" && input.modalVaultId) params.set("modal_vault", input.modalVaultId);
  if (input.modal === "session" && input.sessionAgentLock) params.set("session_agent", input.sessionAgentLock);
  if (input.askMapleOpen) params.set("ask", "1");
  if (input.settingsOpen) params.set("settings", "1");
  if (input.metric) params.set("metric", input.metric);
  if (input.drawers.length) params.set("drawer", input.drawers.map((item) => `${item.kind}:${item.id}`).join(","));
  const query = params.toString();
  return `${base}${pagePath(input)}${query ? `?${query}` : ""}`;
}

export function currentConsoleReturnPath() {
  const url = new URL(window.location.href);
  for (const key of STATUS_PARAMS) url.searchParams.delete(key);
  return `${url.pathname}${url.search}${url.hash}`;
}

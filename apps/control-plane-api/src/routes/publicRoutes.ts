import type { Express, NextFunction, Request, Response } from "express";
import type { AuthenticatedRequest, JsonRecord } from "./routeDeps";
import {
  agentLoopTypes,
  authCookieName,
  buildAuthorizationStart,
  clearAuth,
  clearOAuthStateCookie,
  completeAuthorizationCode,
  createSessionEventsAsync,
  emitSessionEvent,
  getPrimaryThread,
  getSession,
  issueLogin,
  listAuthProviders,
  listLoginTenantsForUser,
  listTenantAdminTenants,
  listWorkspacesForUser,
  loginSchema,
  oauthStateWorkspaceRoute,
  optionalAuth,
  providerCallbackUrl,
  runRuntimeToolCall,
  safeWebReturnPath,
  scopeForParent,
  setAuthCookie,
  setOAuthStateCookie,
  verifyOAuthState,
  z,
  type EventScope
} from "./routeDeps";
import {
  accessibleTenantBySlug,
  asRecord,
  requestedWorkspaceRoute,
  routeParam,
  webRedirectUrl,
  workspaceForTenantRoute
} from "./routeHelpers";
export function registerPublicRoutes(app: Express, packageInfo: { version?: string; name?: string }, ensureDatabaseReady: (request: Request, response: Response, next: NextFunction) => void) {
app.get("/health", (_request, response) => {
  response.json({ ok: true, service: "maple" });
});

app.get("/v1/platform/version", (_request, response) => {
  response.json({
    service: "maple",
    package: packageInfo.name ?? "maple-managed-agent-platform",
    version: packageInfo.version ?? "0.0.0",
    agent_loop_types: agentLoopTypes,
    maple: { supported_commands: ["init", "invoke", "version", "status", "config", "build", "deploy"] }
  });
});

app.get("/v1/auth/providers", (_request, response) => {
  response.json({ data: listAuthProviders() });
});

function startOAuth(request: Request, response: Response) {
  const provider = listAuthProviders().find((item) => item.id === request.params.provider);
  if (!provider) return response.status(404).json({ error: "auth_provider_not_found" });
  if (!provider.configured) return response.status(501).json({ error: "auth_provider_not_configured", provider: provider.id });
  const fallbackRedirectUri = `${request.protocol}://${request.get("host")}/v1/auth/oauth/${provider.id}/callback`;
  const requestedRedirectUri = typeof request.query.redirect_uri === "string" ? request.query.redirect_uri : fallbackRedirectUri;
  const redirectUri = providerCallbackUrl(provider.id, requestedRedirectUri);
  const start = buildAuthorizationStart(provider.id, redirectUri);
  if (!start) return response.status(501).json({ error: "auth_provider_not_configured", provider: provider.id });
  setOAuthStateCookie(response, provider.id, start.state, { ...requestedWorkspaceRoute(request), returnTo: safeWebReturnPath(request.query.return_to) });
  if (request.query.redirect === "1") return response.redirect(start.redirect_url);
  response.json({ provider: provider.id, redirect_url: start.redirect_url, state: start.state, redirect_uri: redirectUri });
}

app.get("/v1/auth/oauth/:provider/start/t/:tenantSlug/w/:workspaceSlug", startOAuth);
app.get("/v1/auth/oauth/:provider/start/t/:tenantSlug", startOAuth);
app.get("/v1/auth/oauth/:provider/start", startOAuth);

app.get("/v1/auth/bootstrap/t/:tenantSlug/w/:workspaceSlug", authBootstrapWithoutDatabase);
app.get("/v1/auth/bootstrap/t/:tenantSlug", authBootstrapWithoutDatabase);
app.get("/v1/auth/bootstrap", authBootstrapWithoutDatabase);
app.post("/v1/auth/session-cookie/clear", (_request, response) => {
  clearSessionCookie(response);
  response.json({ ok: true });
});

app.use("/v1", ensureDatabaseReady);

app.get("/v1/auth/oauth/:provider/callback", async (request, response) => {
  const provider = routeParam(request.params.provider);
  const code = typeof request.query.code === "string" ? request.query.code : "";
  const state = typeof request.query.state === "string" ? request.query.state : "";
  if (!code || !state) return response.status(400).json({ error: "missing_oauth_code_or_state" });
  if (!verifyOAuthState(request, provider, state)) return response.status(400).json({ error: "invalid_oauth_state" });
  const fallbackRedirectUri = `${request.protocol}://${request.get("host")}/v1/auth/oauth/${provider}/callback`;
  const requestedRedirectUri = typeof request.query.redirect_uri === "string" ? request.query.redirect_uri : fallbackRedirectUri;
  const redirectUri = providerCallbackUrl(provider, requestedRedirectUri);
  const workspaceRoute = oauthStateWorkspaceRoute(request, provider, state);
  try {
    const login = await completeAuthorizationCode({ provider, code, redirectUri });
    setAuthCookie(response, login.token, login.expires_at);
    clearOAuthStateCookie(response);
    if (String(request.headers.accept || "").includes("application/json")) {
      return response.status(201).json({ user: login.user, expires_at: login.expires_at });
    }
    return response.redirect(webRedirectUrl(workspaceRoute));
  } catch (error) {
    return response.status(502).json({ error: "oauth_callback_failed", message: error instanceof Error ? error.message : String(error) });
  }
});

app.get("/callback", async (request, response) => {
  const provider = typeof request.query.provider === "string" ? request.query.provider : "lark_sso";
  const code = typeof request.query.code === "string" ? request.query.code : "";
  const state = typeof request.query.state === "string" ? request.query.state : "";
  if (!code || !state) return response.status(400).json({ error: "missing_oauth_code_or_state" });
  if (!verifyOAuthState(request, provider, state)) return response.status(400).json({ error: "invalid_oauth_state" });
  const redirectUri = providerCallbackUrl(provider, `${request.protocol}://${request.get("host")}/callback`);
  const workspaceRoute = oauthStateWorkspaceRoute(request, provider, state);
  try {
    const login = await completeAuthorizationCode({ provider, code, redirectUri });
    setAuthCookie(response, login.token, login.expires_at);
    clearOAuthStateCookie(response);
    if (String(request.headers.accept || "").includes("application/json")) {
      return response.status(201).json({ user: login.user, expires_at: login.expires_at });
    }
    return response.redirect(webRedirectUrl(workspaceRoute));
  } catch (error) {
    return response.status(502).json({ error: "oauth_callback_failed", message: error instanceof Error ? error.message : String(error) });
  }
});

app.post("/v1/auth/login", (request, response) => {
  const parsed = loginSchema.safeParse(request.body);
  if (!parsed.success) return response.status(400).json(parsed.error.flatten());
  // This endpoint issues a session from a bare email with no credential check, so it is
  // only the local dev-login shortcut. Real IdPs (oauth/oidc/lark_sso/bytesso) MUST complete
  // their OAuth callback flow — accepting them here would let anyone impersonate any account.
  // Local login itself stays disabled unless explicitly opted into for development.
  if (parsed.data.provider !== "local") {
    return response.status(403).json({ error: "login_provider_requires_oauth", provider: parsed.data.provider });
  }
  if (process.env.MAPLE_DEV_LOGIN !== "true") {
    return response.status(403).json({ error: "dev_login_disabled" });
  }
  const login = issueLogin({
    provider: parsed.data.provider,
    email: parsed.data.email,
    name: parsed.data.name,
    metadata: { source: "web" }
  });
  setAuthCookie(response, login.token, login.expires_at);
  response.status(201).json({ user: login.user, expires_at: login.expires_at });
});

app.post("/v1/auth/logout", (request, response) => {
  clearAuth(request, response);
  response.json({ ok: true });
});

app.get("/v1/auth/me", optionalAuth, (request: AuthenticatedRequest, response) => {
  const user = request.user ?? null;
  response.json({ user, tenants: user ? listTenantAdminTenants(user.id) : [] });
});

function requestHasAuthMaterial(request: Request) {
  return Boolean(
    request.header("authorization") ||
    request.header("x-maple-api-key") ||
    request.header("x-api-key") ||
    hasIssuedSessionTokenShape(sessionCookieToken(request))
  );
}

function sendAnonymousAuthBootstrap(response: Response) {
  response.json({ user: null, tenants: [], created_count: 0, owned_count: 0, member_only_count: 0, recommended_view: "login" });
}

function bearerAuthToken(request: Request) {
  const header = request.header("authorization") || "";
  return header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
}

function sessionCookieToken(request: Request) {
  return readNamedCookie(request.header("cookie") || "", authCookieName);
}

function readNamedCookie(header: string, name: string) {
  for (const chunk of header.split(";")) {
    const [rawKey, ...rawValue] = chunk.trim().split("=");
    if (rawKey === name) {
      const value = rawValue.join("=") || "";
      try {
        return decodeURIComponent(value);
      } catch {
        return value;
      }
    }
  }
  return "";
}

function clearSessionCookie(response: Response) {
  response.clearCookie(authCookieName, { path: "/" });
}

function hasIssuedSessionTokenShape(token: string) {
  return /^maple_sess_[A-Za-z0-9_-]{43}$/.test(token);
}

function authBootstrapWithoutDatabase(request: Request, response: Response, next: NextFunction) {
  const token = sessionCookieToken(request);
  const hasApiKey = Boolean(request.header("x-maple-api-key") || request.header("x-api-key"));
  if (token && !bearerAuthToken(request) && !hasApiKey && !hasIssuedSessionTokenShape(token)) {
    clearSessionCookie(response);
    sendAnonymousAuthBootstrap(response);
    return;
  }
  if (requestHasAuthMaterial(request)) {
    next();
    return;
  }
  sendAnonymousAuthBootstrap(response);
}

// single first-paint decision source: classify accessible tenants into the four login branches
function authBootstrap(request: AuthenticatedRequest, response: Response) {
  const user = request.user ?? null;
  if (!user) {
    sendAnonymousAuthBootstrap(response);
    return;
  }
  const { tenantSlug, workspaceSlug } = requestedWorkspaceRoute(request);
  const tenants = listLoginTenantsForUser(user.id) as Array<{ id?: unknown; slug?: unknown; is_creator?: unknown; is_owner?: unknown; primary_workspace_id?: unknown; metadata?: unknown }>;
  const requestedTenant = accessibleTenantBySlug(tenants, tenantSlug);
  const requestedWorkspace = requestedTenant
    ? workspaceForTenantRoute(listWorkspacesForUser(user.id), String(requestedTenant.id || ""), workspaceSlug)
    : null;
  const createdCount = tenants.filter((tenant) => Number(tenant.is_creator) === 1).length;
  const memberOnlyCount = tenants.length - createdCount;
  const recommendedView =
    requestedTenant
      ? "dashboard"
      : createdCount === 0 && memberOnlyCount === 0
      ? "onboarding"
      : createdCount === 0
        ? "tenant_choice"
        : tenants.length === 1
          ? "dashboard"
          : "tenant_select";
  response.json({
    user,
    tenants,
    created_count: createdCount,
    owned_count: createdCount,
    member_only_count: memberOnlyCount,
    selected_tenant_id: requestedTenant ? String(requestedTenant.id || "") : "",
    selected_workspace_id: requestedWorkspace ? String(asRecord(requestedWorkspace).id || "") : requestedTenant ? String(requestedTenant.primary_workspace_id || "") : "",
    recommended_view: recommendedView
  });
}

app.get("/v1/auth/bootstrap/t/:tenantSlug/w/:workspaceSlug", optionalAuth, authBootstrap);
app.get("/v1/auth/bootstrap/t/:tenantSlug", optionalAuth, authBootstrap);
app.get("/v1/auth/bootstrap", optionalAuth, authBootstrap);

function runtimeBridgeSession(request: Request, response: Response) {
  const sessionId = routeParam(request.params.sessionId);
  const session = getSession(sessionId);
  if (!session) {
    response.status(404).json({ error: "session_not_found" });
    return null;
  }
  const expected = String((session.metadata as JsonRecord).runtime_tool_bridge_token || "");
  const provided =
    String(request.header("x-maple-runtime-bridge-token") || "") ||
    String(request.header("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!expected || provided !== expected) {
    response.status(401).json({ error: "runtime_tool_bridge_unauthorized" });
    return null;
  }
  return { sessionId, session };
}

type BridgeContext = { token: string; threadId: string | null; scope: EventScope };
const bridgeContextCache = new Map<string, BridgeContext>();

function bridgeProvidedToken(request: Request) {
  return (
    String(request.header("x-maple-runtime-bridge-token") || "") ||
    String(request.header("authorization") || "").replace(/^Bearer\s+/i, "")
  );
}

// Per-session bridge context: token, primary thread id, and scope never change for a session,
// so cache them once instead of paying getSession + getPrimaryThread + scope SELECT on every
// streamed callback — that was the relay's dominant control-plane cost (3 of 4 MySQL ops/event).
function resolveBridgeContext(sessionId: string, providedToken: string): BridgeContext | null {
  const cached = bridgeContextCache.get(sessionId);
  if (cached && cached.token && providedToken === cached.token) return cached;
  const session = getSession(sessionId);
  if (!session) return null;
  const expected = String((session.metadata as JsonRecord).runtime_tool_bridge_token || "");
  if (!expected || providedToken !== expected) return null;
  const thread = getPrimaryThread(sessionId);
  const context: BridgeContext = { token: expected, threadId: thread ? String(thread.id) : null, scope: scopeForParent("sessions", sessionId) };
  bridgeContextCache.set(sessionId, context);
  return context;
}

// Live loop-event relay: the veFaaS runtime streams agent-loop events here while the turn is
// still running, so the console sees tool calls and text as they happen. The runtime batches
// non-delta events into one POST (events[]); deltas arrive singly carrying the accumulated text
// (same contract the provider loop emits), so the console renders a growing message.
const loopDeltaAccumulators = new Map<string, { text: string; at: number }>();

app.post("/v1/runtime/sessions/:sessionId/loop_events", (request, response) => {
  const sessionId = routeParam(request.params.sessionId);
  const context = resolveBridgeContext(sessionId, bridgeProvidedToken(request));
  if (!context) return response.status(401).json({ error: "runtime_tool_bridge_unauthorized" });
  const item = z.object({ kind: z.enum(["event", "delta"]), event: z.record(z.string(), z.unknown()) });
  const parsed = z.union([item, z.object({ events: z.array(item).min(1) })]).safeParse(request.body);
  if (!parsed.success) return response.status(400).json(parsed.error.flatten());
  const items = "events" in parsed.data ? parsed.data.events : [parsed.data];

  // build one ordered item list (deltas + loop events interleaved as received) so a single
  // async insert preserves arrival order; the DB write is fire-and-forget off the hot path
  const eventItems = items.map((it) => {
    if (it.kind === "delta") {
      const previous = loopDeltaAccumulators.get(sessionId);
      const fresh = !previous || (it.event as JsonRecord).first === true || Date.now() - previous.at > 600_000;
      const text = (fresh ? "" : previous.text) + String((it.event as JsonRecord).text || "");
      loopDeltaAccumulators.set(sessionId, { text, at: Date.now() });
      return { type: "agent.message_delta", payload: { text, usage: {} } as JsonRecord, provider_event_type: "message_delta" };
    }
    if (String((it.event as JsonRecord).type || "") === "result") loopDeltaAccumulators.delete(sessionId);
    return {
      type: "agent.external_loop_event",
      payload: { driver: "vefaas_agent_loop", event: it.event } as JsonRecord,
      provider_event_type: String((it.event as JsonRecord).type || "")
    };
  });
  const stored = createSessionEventsAsync(sessionId, context.threadId, context.scope, eventItems);
  for (const event of stored) emitSessionEvent(event);
  response.status(202).json({ ok: true, count: stored.length });
});

app.post("/v1/runtime/sessions/:sessionId/tools", async (request, response) => {
  const bridged = runtimeBridgeSession(request, response);
  if (!bridged) return;
  const { sessionId } = bridged;
  const parsed = z.object({ tool: z.string().min(1), input: z.record(z.string(), z.unknown()).default({}) }).safeParse(request.body);
  if (!parsed.success) return response.status(400).json(parsed.error.flatten());
  try {
    const result = await runRuntimeToolCall(sessionId, parsed.data.tool, parsed.data.input);
    response.status(result.ok ? 200 : 500).json(result);
  } catch (error) {
    response.status(403).json({ error: "runtime_tool_bridge_failed", message: error instanceof Error ? error.message : String(error) });
  }
});
}

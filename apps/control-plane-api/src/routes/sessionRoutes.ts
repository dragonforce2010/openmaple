import type { Express } from "express";
import { killSessionSandboxRuntime } from "../runtime/runtimeManager";
import type { AuthenticatedRequest, JsonRecord, SessionEvent } from "./routeDeps";
import {
  WorkspaceRuntimePoolUnavailableError,
  addStreamClient,
  askMapleSessionStats,
  canAccessWorkspace,
  createSession,
  createSessionEvent,
  currentUser,
  emitSessionEvent,
  enqueueSessionTurn,
  ensureAskMapleSession,
  getSession,
  isHiddenSession,
  isQuickstartBuilderSession,
  listSessionEvents,
  listSessions,
  nanoid,
  runAskMapleTurn,
  runQuickstartBuilderTurn,
  shouldHideCompatEvent,
  shutdownExternalAgentLoop,
  toWireSessionEvent,
  updateSessionMetadata,
  updateSessionStatus,
  z
} from "./routeDeps";
import {
  accessibleWorkspaceIds,
  agentReferenceId,
  asRecord,
  canReadSessionRecord,
  fallbackWorkspaceId,
  includeSystemRecords,
  maybeBootstrapSession,
  maybeRunUserMessage,
  routeParam,
  sessionDetailPayload,
  sessionResponse
} from "./routeHelpers";
export function registerSessionRoutes(app: Express) {
app.get("/v1/sessions", (request: AuthenticatedRequest, response) => {
  // resolve the user once and pre-fetch their workspace set, instead of an access-check query per session (N+1)
  const userId = currentUser(request).id;
  const allowedWorkspaces = accessibleWorkspaceIds(userId);
  const data = listSessions()
    .filter((session) => {
      const owner = asRecord((session as unknown as Record<string, unknown>).metadata).owner_user_id;
      if (!owner || owner === userId) return true;
      const workspaceId = typeof (session as unknown as Record<string, unknown>).workspace_id === "string" ? String((session as unknown as Record<string, unknown>).workspace_id) : "";
      return workspaceId ? allowedWorkspaces.has(workspaceId) : false;
    })
    .filter((session) => includeSystemRecords(request) || !isHiddenSession(session))
    .map(sessionResponse);
  response.json({ data });
});

app.post("/v1/sessions", (request: AuthenticatedRequest, response) => {
  const user = currentUser(request);
  const schema = z.object({
    workspace_id: z.string().optional(),
    agent: z.union([z.string().min(1), z.record(z.string(), z.unknown())]),
    environment_id: z.string().min(1),
    title: z.string().optional(),
    vault_ids: z.array(z.string()).default([]),
    resources: z.array(z.record(z.string(), z.unknown())).default([]),
    metadata: z.record(z.string(), z.unknown()).default({})
  });
  const parsed = schema.safeParse(request.body);
  if (!parsed.success) return response.status(400).json(parsed.error.flatten());
  if (parsed.data.workspace_id && !canAccessWorkspace(user.id, parsed.data.workspace_id)) {
    return response.status(403).json({ error: "workspace_forbidden" });
  }
  let session;
  try {
    session = createSession({
      workspace_id: fallbackWorkspaceId(user, parsed.data.workspace_id ?? null),
      agent_id: agentReferenceId(parsed.data.agent),
      environment_id: parsed.data.environment_id,
      title: parsed.data.title,
      metadata: {
        ...parsed.data.metadata,
        owner_user_id: user.id,
        vault_ids: parsed.data.vault_ids,
        resources: parsed.data.resources
      }
    });
  } catch (error) {
    if (error instanceof WorkspaceRuntimePoolUnavailableError) {
      return response.status(409).json({ error: "workspace_runtime_pool_unavailable", message: error.message });
    }
    throw error;
  }
  if (!session) return response.status(404).json({ error: "agent_or_environment_not_found" });
  maybeBootstrapSession(String(session.id));
  response.status(201).json(sessionResponse(session));
});

app.delete("/v1/sessions/:sessionId", (request: AuthenticatedRequest, response) => {
  const session = getSession(routeParam(request.params.sessionId));
  if (!session) return response.status(404).json({ error: "session_not_found" });
  if (!canReadSessionRecord(currentUser(request).id, session)) return response.status(403).json({ error: "session_forbidden" });
  updateSessionStatus(String(session.id), "terminated");
  updateSessionMetadata(String(session.id), { hidden: true, deleted_at: new Date().toISOString(), deleted_by_user_id: currentUser(request).id });
  void shutdownExternalAgentLoop(String(session.id));
  void killSessionSandboxRuntime(String(session.id)).catch((error) => console.warn("failed to kill session sandbox runtime", error));
  response.status(204).send();
});

app.get("/v1/sessions/:sessionId", (request: AuthenticatedRequest, response) => {
  const session = getSession(routeParam(request.params.sessionId));
  if (!session) return response.status(404).json({ error: "session_not_found" });
  if (!canReadSessionRecord(currentUser(request).id, session)) return response.status(403).json({ error: "session_forbidden" });
  response.json(sessionResponse(session));
});

app.get("/v1/sessions/:sessionId/detail", (request: AuthenticatedRequest, response) => {
  const sessionId = routeParam(request.params.sessionId);
  const session = getSession(sessionId);
  if (!session) return response.status(404).json({ error: "session_not_found" });
  if (!canReadSessionRecord(currentUser(request).id, session)) return response.status(403).json({ error: "session_forbidden" });
  response.json(
    sessionDetailPayload(sessionId, {
      session,
      summary: String(request.query.summary || "") === "1",
      afterEventId: typeof request.query.after === "string" ? request.query.after : undefined
    })
  );
});

app.post("/v1/ask_maple/sessions/:sessionId/message", (request: AuthenticatedRequest, response) => {
  const sessionId = routeParam(request.params.sessionId);
  const session = getSession(sessionId);
  if (!session) return response.status(404).json({ error: "session_not_found" });
  const user = currentUser(request);
  if (!canReadSessionRecord(user.id, session)) return response.status(403).json({ error: "session_forbidden" });
  const parsed = z.object({ question: z.string().min(1).optional(), text: z.string().min(1).optional() }).safeParse(request.body);
  if (!parsed.success) return response.status(400).json(parsed.error.flatten());
  const metadata = asRecord(session.metadata);
  const workspaceId = String(session.workspace_id || metadata.workspace_id || "");
  if (!workspaceId) return response.status(400).json({ error: "session_workspace_missing" });
  const question = parsed.data.question || parsed.data.text || "总结这个 session 的上下文";
  // The real LLM turn is async (doubao/glm can take tens of seconds) and streams reasoning +
  // answer over SSE. Create the hidden ask session synchronously so the client gets an id to
  // subscribe to, then run the turn on the background queue and return 202 immediately.
  const context = { userId: user.id, workspaceId, targetSessionId: sessionId };
  const askSession = ensureAskMapleSession(context) as (JsonRecord & { id?: unknown }) | null;
  if (!askSession?.id) return response.status(500).json({ error: "ask_maple_session_create_failed" });
  const askSessionId = String(askSession.id);
  const detail = sessionDetailPayload(sessionId) as JsonRecord & { session: JsonRecord };
  enqueueSessionTurn(askSessionId, async () => {
    await runAskMapleTurn(context, detail, question);
  });
  response.status(202).json({ ask_session: askSession, ask_session_id: askSessionId, stats: askMapleSessionStats(detail), events: listSessionEvents(askSessionId) });
});

app.get("/v1/sessions/:sessionId/events", (request: AuthenticatedRequest, response) => {
  const sessionId = routeParam(request.params.sessionId);
  const session = getSession(sessionId);
  if (!session) return response.status(404).json({ error: "session_not_found" });
  if (!canReadSessionRecord(currentUser(request).id, session)) return response.status(403).json({ error: "session_forbidden" });
  const compat = Boolean(request.header("x-api-key") || request.header("anthropic-version") || request.header("anthropic-beta"));
  const events = (listSessionEvents(sessionId) as SessionEvent[]).filter((event) => !compat || !shouldHideCompatEvent(event));
  response.json({ data: events.map(toWireSessionEvent) });
});

app.post("/v1/sessions/:sessionId/events", async (request: AuthenticatedRequest, response) => {
  const sessionId = routeParam(request.params.sessionId);
  const session = getSession(sessionId);
  if (!session) return response.status(404).json({ error: "session_not_found" });
  if (!canReadSessionRecord(currentUser(request).id, session)) return response.status(403).json({ error: "session_forbidden" });
  const schema = z.object({
    events: z.array(
      z.object({
        type: z.string(),
        content: z.unknown().optional(),
        payload: z.record(z.string(), z.unknown()).optional()
      }).passthrough()
    )
  });
  const parsed = schema.safeParse(request.body);
  if (!parsed.success) return response.status(400).json(parsed.error.flatten());
  const writableTypes = new Set(["user.message", "user.custom_tool_result", "tool_result", "user.tool_result", "user.define_outcome"]);
  const rejected = parsed.data.events.find((event) => !writableTypes.has(event.type));
  if (rejected) return response.status(400).json({ error: "event_type_not_client_writable", type: rejected.type });

  const stored = parsed.data.events.map((event) =>
    createSessionEvent({
      session_id: sessionId,
      type: event.type,
      payload: {
        content: event.content,
        ...event.payload,
        ...Object.fromEntries(Object.entries(event).filter(([key]) => !["type", "content", "payload"].includes(key)))
      }
    })
  );
  stored.forEach(emitSessionEvent);
  const message = parsed.data.events.find((event) => event.type === "user.message");
  const text =
    Array.isArray(message?.content) && typeof message.content[0] === "object" && message.content[0] !== null
      ? String((message.content[0] as { text?: unknown }).text ?? "")
      : "Continue";
  if (message) {
    const user = currentUser(request);
    if (isQuickstartBuilderSession(session)) {
      const metadata = asRecord(session.metadata);
      const workspaceId = String(session.workspace_id || metadata.workspace_id || "");
      enqueueSessionTurn(sessionId, () => runQuickstartBuilderTurn(sessionId, text, { userId: user.id, workspaceId }));
    } else {
      enqueueSessionTurn(sessionId, () => maybeRunUserMessage(sessionId, text));
    }
  }
  response.status(202).json({ data: stored.map(toWireSessionEvent) });
});

app.get("/v1/sessions/:sessionId/events/stream", (request: AuthenticatedRequest, response) => {
  const sessionId = routeParam(request.params.sessionId);
  const session = getSession(sessionId);
  if (!session) return response.status(404).json({ error: "session_not_found" });
  if (!canReadSessionRecord(currentUser(request).id, session)) return response.status(403).json({ error: "session_forbidden" });
  response.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive"
  });
  addStreamClient(sessionId, {
    id: nanoid(8),
    response,
    compat: Boolean(request.header("x-api-key") || request.header("anthropic-version") || request.header("anthropic-beta"))
  });
});
}

import type { Express } from "express";
import type { AuthenticatedRequest, JsonRecord } from "./routeDeps";
import {
  agentLoopTypes,
  buildAgentDraft,
  canAccessWorkspace,
  createSessionEvent,
  currentUser,
  emitSessionEvent,
  enqueueSessionTurn,
  ensureGlobalModelConfigs,
  ensureQuickstartBuilderSession,
  getModelConfig,
  getSession,
  isQuickstartBuilderSession,
  listModelConfigs,
  runQuickstartBuilderAction,
  runQuickstartBuilderTurn,
  WorkspaceRuntimePoolUnavailableError,
  workspaceIncludesModelConfig,
  z
} from "./routeDeps";
import {
  asRecord,
  canReadSessionRecord,
  fallbackWorkspaceId,
  routeParam,
  sessionDetailPayload,
  sessionResponse
} from "./routeHelpers";
export function registerQuickstartRoutes(app: Express) {
app.post("/v1/agent_drafts", async (request: AuthenticatedRequest, response) => {
  const schema = z.object({
    prompt: z.string().min(1),
    model_config_id: z.string().optional(),
    agent_loop_type: z.enum(agentLoopTypes).optional(),
    workspace_id: z.string().optional()
  });
  const parsed = schema.safeParse(request.body);
  if (!parsed.success) return response.status(400).json(parsed.error.flatten());
  try {
    const user = currentUser(request);
    ensureGlobalModelConfigs();
    const workspaceId = resolveDraftWorkspaceId(user, parsed.data.workspace_id ?? null, parsed.data.model_config_id);
    if (workspaceId && !canAccessWorkspace(user.id, workspaceId)) return response.status(403).json({ error: "workspace_forbidden" });
    const draft = await buildAgentDraft(parsed.data.prompt, user.id, parsed.data.model_config_id || null, parsed.data.agent_loop_type, workspaceId);
    response.json({
      draft,
      risk_notes: [
        "bash/edit/write should default to confirmation outside the session workspace.",
        "YAML is supported as authoring format; canonical storage remains JSON."
      ]
    });
  } catch (error) {
    response.status(502).json({ error: "agent_draft_generation_failed", message: error instanceof Error ? error.message : String(error) });
  }
});

function resolveDraftWorkspaceId(user: { id: string }, requestedWorkspaceId?: string | null, modelConfigId?: string) {
  const workspaceId = fallbackWorkspaceId(user, requestedWorkspaceId ?? null);
  if (!modelConfigId || !workspaceId || workspaceIncludesModelConfig(workspaceId, modelConfigId)) return workspaceId;
  const modelConfig = getModelConfig(modelConfigId) as JsonRecord | null;
  const ownerWorkspaceId = String(modelConfig?.workspace_id || "");
  return ownerWorkspaceId && ownerWorkspaceId !== "-1" && canAccessWorkspace(user.id, ownerWorkspaceId) ? ownerWorkspaceId : workspaceId;
}

app.post("/v1/quickstart/builder_session", (request: AuthenticatedRequest, response) => {
  const schema = z.object({
    workspace_id: z.string().optional(),
    model_config_id: z.string().optional(),
    agent_loop_type: z.enum(agentLoopTypes).optional()
  });
  const parsed = schema.safeParse(request.body);
  if (!parsed.success) return response.status(400).json(parsed.error.flatten());
  const user = currentUser(request);
  const workspaceId = fallbackWorkspaceId(user, parsed.data.workspace_id ?? null);
  if (!workspaceId) return response.status(400).json({ error: "workspace_required" });
  if (!canAccessWorkspace(user.id, workspaceId)) return response.status(403).json({ error: "workspace_forbidden" });
  if ((listModelConfigs(workspaceId) as JsonRecord[]).length === 0) {
    return response.status(400).json({ error: "model_pool_required", message: "Configure at least one model in the model pool before using Quickstart." });
  }
  if (parsed.data.model_config_id && !workspaceIncludesModelConfig(workspaceId, parsed.data.model_config_id)) {
    return response.status(404).json({ error: "model_config_not_found", model_config_id: parsed.data.model_config_id });
  }
  let session;
  try {
    session = ensureQuickstartBuilderSession({
      userId: user.id,
      workspaceId,
      modelConfigId: parsed.data.model_config_id ?? null,
      agentLoopType: parsed.data.agent_loop_type
    });
  } catch (error) {
    if (error instanceof WorkspaceRuntimePoolUnavailableError) {
      return response.status(409).json({ error: "workspace_runtime_pool_unavailable", message: error.message });
    }
    throw error;
  }
  if (!session) return response.status(500).json({ error: "quickstart_builder_session_failed" });
  response.status(201).json({ session: sessionResponse(session), detail: sessionDetailPayload(String(session.id)) });
});

app.post("/v1/quickstart/builder_session/:sessionId/message", async (request: AuthenticatedRequest, response) => {
  const schema = z.object({
    text: z.string().min(1),
    model_config_id: z.string().optional(),
    agent_loop_type: z.enum(agentLoopTypes).optional()
  });
  const parsed = schema.safeParse(request.body);
  if (!parsed.success) return response.status(400).json(parsed.error.flatten());
  const user = currentUser(request);
  const sessionId = routeParam(request.params.sessionId);
  const session = getSession(sessionId);
  if (!session) return response.status(404).json({ error: "session_not_found" });
  if (!isQuickstartBuilderSession(session)) return response.status(400).json({ error: "not_quickstart_builder_session" });
  if (!canReadSessionRecord(user.id, session)) return response.status(403).json({ error: "session_forbidden" });
  const metadata = asRecord(session.metadata);
  if (metadata.owner_user_id !== user.id) return response.status(403).json({ error: "quickstart_builder_owner_required" });
  const workspaceId = String(session.workspace_id || metadata.workspace_id || "");
  if (!workspaceId || !canAccessWorkspace(user.id, workspaceId)) return response.status(403).json({ error: "workspace_forbidden" });
  if ((listModelConfigs(workspaceId) as JsonRecord[]).length === 0) {
    return response.status(400).json({ error: "model_pool_required", message: "Configure at least one model in the model pool before using Quickstart." });
  }
  if (parsed.data.model_config_id && !workspaceIncludesModelConfig(workspaceId, parsed.data.model_config_id)) {
    return response.status(404).json({ error: "model_config_not_found", model_config_id: parsed.data.model_config_id });
  }
  const event = createSessionEvent({
    session_id: sessionId,
    type: "user.message",
    payload: { content: [{ type: "text", text: parsed.data.text }] }
  });
  emitSessionEvent(event);
  // Run the turn on the shared background queue (same path as POST /v1/sessions/:id/events)
  // and return immediately. A synchronous await here is what made the gateway abort the
  // request before the multi-step builder loop finished; the client now follows real
  // progress over the session detail / SSE stream.
  enqueueSessionTurn(sessionId, () =>
    runQuickstartBuilderTurn(sessionId, parsed.data.text, {
      userId: user.id,
      workspaceId,
      modelConfigId: parsed.data.model_config_id ?? null,
      agentLoopType: parsed.data.agent_loop_type
    })
  );
  response.status(202).json({ detail: sessionDetailPayload(sessionId) });
});

app.post("/v1/quickstart/builder_session/:sessionId/action", (request: AuthenticatedRequest, response) => {
  const schema = z.object({
    action_id: z.string().min(1),
    payload: z.record(z.string(), z.unknown()).default({})
  });
  const parsed = schema.safeParse(request.body);
  if (!parsed.success) return response.status(400).json(parsed.error.flatten());
  const user = currentUser(request);
  const sessionId = routeParam(request.params.sessionId);
  const session = getSession(sessionId);
  if (!session) return response.status(404).json({ error: "session_not_found" });
  if (!isQuickstartBuilderSession(session)) return response.status(400).json({ error: "not_quickstart_builder_session" });
  if (!canReadSessionRecord(user.id, session)) return response.status(403).json({ error: "session_forbidden" });
  const metadata = asRecord(session.metadata);
  if (metadata.owner_user_id !== user.id) return response.status(403).json({ error: "quickstart_builder_owner_required" });
  const workspaceId = String(session.workspace_id || metadata.workspace_id || "");
  if (!workspaceId || !canAccessWorkspace(user.id, workspaceId)) return response.status(403).json({ error: "workspace_forbidden" });
  if ((listModelConfigs(workspaceId) as JsonRecord[]).length === 0) {
    return response.status(400).json({ error: "model_pool_required", message: "Configure at least one model in the model pool before using Quickstart." });
  }
  try {
    runQuickstartBuilderAction(sessionId, parsed.data.action_id, parsed.data.payload, { userId: user.id, workspaceId });
    response.status(202).json({ detail: sessionDetailPayload(sessionId) });
  } catch (error) {
    response.status(400).json({ error: "quickstart_builder_action_failed", message: error instanceof Error ? error.message : String(error) });
  }
});
}

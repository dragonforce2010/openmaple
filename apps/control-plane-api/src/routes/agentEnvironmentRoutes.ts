import type { Express } from "express";
import type { AgentConfig, AuthenticatedRequest, JsonRecord } from "./routeDeps";
import {
  agentConfigSchema,
  archiveEnvironment,
  canAccessSession,
  canAccessWorkspace,
  createAgent,
  createEnvironment,
  currentUser,
  getAgent,
  getDefaultModelConfig,
  getEnvironment,
  getEnvironmentDeletePreview,
  getWorkspace,
  getWorkspaceRuntimePool,
  listAgentVersions,
  listAgents,
  listEnvironments,
  listModelConfigs,
  listSessions,
  modelSelectionFromConfig,
  normalizeAgentLoop,
  updateAgent,
  updateEnvironment,
  workspaceIncludesModelConfig,
  z
} from "./routeDeps";
import {
  accessibleWorkspaceIds,
  agentResponse,
  blankAgentConfigFieldErrors,
  canAccessScopedRecord,
  fallbackWorkspaceId,
  hasAgentRuntimeEnvironmentConfig,
  includeSystemRecords,
  normalizeAgentConfigBody,
  optionalWorkspaceId,
  routeParam,
  asRecord,
  scopeByWorkspace,
  visibleAgents,
  visibleEnvironments
} from "./routeHelpers";
export function registerAgentEnvironmentRoutes(app: Express) {
app.get("/v1/agents", (request: AuthenticatedRequest, response) => {
  const userId = currentUser(request).id;
  const workspaceId = typeof request.query.workspace_id === "string" ? request.query.workspace_id : null;
  if (workspaceId && !canAccessWorkspace(userId, workspaceId)) return response.status(403).json({ error: "workspace_forbidden" });
  const agents = workspaceId ? listAgents(workspaceId) : scopeByWorkspace(listAgents(), accessibleWorkspaceIds(userId));
  response.json({ data: visibleAgents(agents, includeSystemRecords(request)).map(agentResponse) });
});

app.post("/v1/agents", (request: AuthenticatedRequest, response) => {
  const user = currentUser(request);
  const workspaceId = fallbackWorkspaceId(user, optionalWorkspaceId(request.body));
  const blankFields = blankAgentConfigFieldErrors(request.body);
  if (blankFields) return response.status(400).json(blankFields);
  const parsed = agentConfigSchema.safeParse(normalizeAgentConfigBody(request.body));
  if (!parsed.success) return response.status(400).json(parsed.error.flatten());
  let agentConfig: AgentConfig = parsed.data as AgentConfig;
  if (workspaceId) {
    if (!canAccessWorkspace(user.id, workspaceId)) return response.status(403).json({ error: "workspace_forbidden" });
    const resolved = resolveAgentModelConfig(agentConfig, workspaceId, request.body);
    if (!resolved) {
      return response.status(400).json({ error: "model_config_not_in_workspace_pool" });
    }
    agentConfig = resolved;
  }
  response
    .status(201)
    .json(agentResponse(createAgent({ workspace_id: workspaceId, config: { ...agentConfig, agent_loop: normalizeAgentLoop(agentConfig.agent_loop) } })));
});

app.get("/v1/agents/:agentId", (request: AuthenticatedRequest, response) => {
  const agent = getAgent(routeParam(request.params.agentId));
  if (!agent) return response.status(404).json({ error: "agent_not_found" });
  if (!canAccessScopedRecord(currentUser(request).id, agent)) return response.status(403).json({ error: "workspace_forbidden" });
  response.json(agentResponse(agent));
});

function resolveAgentModelConfig(config: AgentConfig, workspaceId: string, rawBody: unknown) {
  const modelConfigId = config.model.config_id || "";
  if (modelConfigId) return workspaceIncludesModelConfig(workspaceId, modelConfigId) ? config : null;
  const terms = requestedModelTerms(rawBody);
  const configs = listModelConfigs(workspaceId) as JsonRecord[];
  const matched = terms.length ? configs.find((modelConfig) => modelConfigMatchesTerms(modelConfig, terms)) : null;
  const fallback = !terms.length || wantsDefaultModel(terms) ? (getDefaultModelConfig(workspaceId) as JsonRecord | null) || configs[0] : null;
  const modelConfig = matched || fallback;
  if (!modelConfig) return null;
  const selection = modelSelectionFromConfig(modelConfig);
  return {
    ...config,
    model: {
      ...config.model,
      provider: selection.provider,
      id: selection.model,
      config_id: selection.configId,
      name: selection.name
    }
  };
}

function requestedModelTerms(rawBody: unknown) {
  const rawModel = asRecord(rawBody).model;
  if (typeof rawModel === "string" && rawModel.trim()) return [normalizeModelTerm(rawModel)];
  const model = asRecord(rawModel);
  return [model.id, model.model, model.name]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .map(normalizeModelTerm);
}

function modelConfigMatchesTerms(modelConfig: JsonRecord, terms: string[]) {
  const labels = [modelConfig.id, modelConfig.name, modelConfig.model_name, modelConfig.preset_key].map(normalizeModelTerm);
  return terms.some((term) => labels.includes(term));
}

function wantsDefaultModel(terms: string[]) {
  return terms.some((term) => ["default", "default model", "默认", "默认模型"].includes(term));
}

function normalizeModelTerm(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

app.get("/v1/agents/:agentId/runtime", (request: AuthenticatedRequest, response) => {
  const agent = getAgent(routeParam(request.params.agentId)) as JsonRecord | null;
  if (!agent) return response.status(404).json({ error: "agent_not_found" });
  const workspaceId = typeof agent.workspace_id === "string" && agent.workspace_id ? agent.workspace_id : "";
  if (workspaceId && !canAccessWorkspace(currentUser(request).id, workspaceId)) return response.status(403).json({ error: "workspace_forbidden" });
  const recentSessions = (listSessions() as JsonRecord[])
    .filter((session) => String(session.agent_id) === String(agent.id))
    .filter((session) => canAccessSession(currentUser(request).id, session))
    .slice(0, 5)
    .map((session) => {
      const metadata = session.metadata as JsonRecord;
      return {
        id: session.id,
        status: session.status,
        runtime_pool_id: metadata.runtime_pool_id ?? null,
        runtime_pool_member_id: metadata.runtime_pool_member_id ?? null,
        agent_runtime: metadata.agent_runtime ?? null,
        sandbox_runtime: metadata.sandbox_runtime ?? metadata.runtime ?? null,
        created_at: session.created_at,
        updated_at: session.updated_at
      };
    });
  response.json({
    agent_id: agent.id,
    workspace: workspaceId ? getWorkspace(workspaceId) : null,
    runtime_pool: workspaceId ? getWorkspaceRuntimePool(workspaceId) : null,
    recent_sessions: recentSessions
  });
});

app.patch("/v1/agents/:agentId", (request: AuthenticatedRequest, response) => {
  const current = getAgent(routeParam(request.params.agentId));
  if (!current) return response.status(404).json({ error: "agent_not_found" });
  if (!canAccessScopedRecord(currentUser(request).id, current)) return response.status(403).json({ error: "workspace_forbidden" });
  const merged = normalizeAgentConfigBody({ ...current.config, ...request.body });
  const parsed = agentConfigSchema.safeParse(merged);
  if (!parsed.success) return response.status(400).json(parsed.error.flatten());
  response.json(agentResponse(updateAgent(routeParam(request.params.agentId), { ...parsed.data, agent_loop: normalizeAgentLoop(parsed.data.agent_loop) })));
});

app.post("/v1/agents/:agentId", (request: AuthenticatedRequest, response) => {
  const current = getAgent(routeParam(request.params.agentId));
  if (!current) return response.status(404).json({ error: "agent_not_found" });
  if (!canAccessScopedRecord(currentUser(request).id, current)) return response.status(403).json({ error: "workspace_forbidden" });
  const merged = normalizeAgentConfigBody({ ...current.config, ...request.body });
  const parsed = agentConfigSchema.safeParse(merged);
  if (!parsed.success) return response.status(400).json(parsed.error.flatten());
  response.json(agentResponse(updateAgent(routeParam(request.params.agentId), { ...parsed.data, agent_loop: normalizeAgentLoop(parsed.data.agent_loop) })));
});

app.get("/v1/agents/:agentId/versions", (request: AuthenticatedRequest, response) => {
  const agent = getAgent(routeParam(request.params.agentId));
  if (!agent) return response.status(404).json({ error: "agent_not_found" });
  if (!canAccessScopedRecord(currentUser(request).id, agent)) return response.status(403).json({ error: "workspace_forbidden" });
  response.json({ data: listAgentVersions(routeParam(request.params.agentId)) });
});

app.get("/v1/environments", (request: AuthenticatedRequest, response) => {
  const userId = currentUser(request).id;
  const workspaceId = typeof request.query.workspace_id === "string" ? request.query.workspace_id : null;
  if (workspaceId && !canAccessWorkspace(userId, workspaceId)) return response.status(403).json({ error: "workspace_forbidden" });
  const environments = workspaceId ? listEnvironments(workspaceId) : scopeByWorkspace(listEnvironments(), accessibleWorkspaceIds(userId));
  response.json({ data: visibleEnvironments(environments, includeSystemRecords(request)) });
});

app.post("/v1/environments", (request: AuthenticatedRequest, response) => {
  const schema = z.object({
    workspace_id: z.string().optional(),
    name: z.string().min(1),
    description: z.string().optional(),
    config: z.record(z.string(), z.unknown()).default({}),
    metadata: z.record(z.string(), z.unknown()).default({})
  });
  const parsed = schema.safeParse(request.body);
  if (!parsed.success) return response.status(400).json(parsed.error.flatten());
  if (hasAgentRuntimeEnvironmentConfig(request.body)) return response.status(400).json({ error: "environment_agent_runtime_forbidden" });
  if (parsed.data.workspace_id && !canAccessWorkspace(currentUser(request).id, parsed.data.workspace_id)) {
    return response.status(403).json({ error: "workspace_forbidden" });
  }
  response
    .status(201)
    .json(
      createEnvironment({
        workspace_id: fallbackWorkspaceId(currentUser(request), parsed.data.workspace_id ?? null),
        name: parsed.data.name,
        config: { ...parsed.data.config, ...(parsed.data.description !== undefined ? { description: parsed.data.description } : {}), metadata: parsed.data.metadata }
      })
    );
});

app.get("/v1/environments/:environmentId", (request: AuthenticatedRequest, response) => {
  const environment = getEnvironment(routeParam(request.params.environmentId));
  if (!environment) return response.status(404).json({ error: "environment_not_found" });
  if (!canAccessScopedRecord(currentUser(request).id, environment)) return response.status(403).json({ error: "workspace_forbidden" });
  response.json(environment);
});

app.get("/v1/environments/:environmentId/delete_preview", (request: AuthenticatedRequest, response) => {
  const preview = getEnvironmentDeletePreview(routeParam(request.params.environmentId));
  if (!preview) return response.status(404).json({ error: "environment_not_found" });
  if (!canAccessScopedRecord(currentUser(request).id, preview.environment)) return response.status(403).json({ error: "workspace_forbidden" });
  response.json(preview);
});

app.patch("/v1/environments/:environmentId", (request: AuthenticatedRequest, response) => {
  const current = getEnvironment(routeParam(request.params.environmentId)) as JsonRecord | null;
  if (!current) return response.status(404).json({ error: "environment_not_found" });
  const schema = z.object({
    workspace_id: z.string().optional(),
    name: z.string().min(1).optional(),
    description: z.string().optional(),
    config: z.record(z.string(), z.unknown()).default({}),
    metadata: z.record(z.string(), z.unknown()).default({})
  });
  const parsed = schema.safeParse(request.body);
  if (!parsed.success) return response.status(400).json(parsed.error.flatten());
  const workspaceId = parsed.data.workspace_id ?? (typeof current.workspace_id === "string" ? current.workspace_id : undefined);
  if (workspaceId && !canAccessWorkspace(currentUser(request).id, workspaceId)) return response.status(403).json({ error: "workspace_forbidden" });
  if (hasAgentRuntimeEnvironmentConfig(request.body)) return response.status(400).json({ error: "environment_agent_runtime_forbidden" });
  const currentConfig = ((current.config as JsonRecord | undefined) || {}) as JsonRecord;
  const nextConfig = { ...currentConfig, ...parsed.data.config };
  if (parsed.data.description !== undefined) nextConfig.description = parsed.data.description;
  if (typeof request.body === "object" && request.body && "metadata" in request.body) nextConfig.metadata = parsed.data.metadata;
  response.json(
    updateEnvironment(routeParam(request.params.environmentId), {
      workspace_id: workspaceId ?? null,
      name: parsed.data.name,
      config: nextConfig
    })
  );
});

app.delete("/v1/environments/:environmentId", (request: AuthenticatedRequest, response) => {
  const preview = getEnvironmentDeletePreview(routeParam(request.params.environmentId));
  if (!preview) return response.status(404).json({ error: "environment_not_found" });
  if (!canAccessScopedRecord(currentUser(request).id, preview.environment)) return response.status(403).json({ error: "workspace_forbidden" });
  const force = request.query.force === "1" || request.query.force === "true";
  if (!preview.can_delete_without_force && !force) {
    return response.status(409).json({ error: "environment_has_links", ...preview });
  }
  response.json({ ok: true, environment: archiveEnvironment(routeParam(request.params.environmentId), currentUser(request).id), preview });
});
}

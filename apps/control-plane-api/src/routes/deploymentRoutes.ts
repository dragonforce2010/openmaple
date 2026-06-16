import type { Express, Response } from "express";
import { runDeployment } from "../deployments/runDeployment";
import {
  deploymentHasUserMessage,
  deploymentUpcomingRuns,
  nextDeploymentRunAt
} from "../deployments/schedule";
import type { AuthenticatedRequest, JsonRecord } from "./routeDeps";
import {
  archiveAgentDeployment,
  canAccessWorkspace,
  createAgent,
  createAgentDeployment,
  createEnvironment,
  currentUser,
  deploymentBundleSchema,
  deploymentCreateSchema,
  deploymentInitialEventSchema,
  deploymentManifestSchema,
  deploymentPatchSchema,
  deploymentRunCreateSchema,
  getAgent,
  getAgentDeployment,
  getEnvironment,
  GLOBAL_SCOPE_ID,
  listAgentDeploymentsForWorkspace,
  listAgentDeploymentsForWorkspaces,
  listDeploymentRuns,
  normalizeAgentLoop,
  pauseAgentDeployment,
  unpauseAgentDeployment,
  updateAgentDeployment,
  z
} from "./routeDeps";
import { accessibleWorkspaceIds, fallbackWorkspaceId, routeParam } from "./routeHelpers";

const legacyDeploymentSchema = z
  .object({
    manifest: deploymentManifestSchema,
    bundle: deploymentBundleSchema,
    workspace_id: z.string().min(1).optional(),
    message: z.string().min(1).optional(),
    initial_events: z.array(deploymentInitialEventSchema).optional(),
    schedule: z.record(z.string(), z.unknown()).nullable().optional(),
    vault_ids: z.array(z.string()).optional(),
    memory_store_ids: z.array(z.string()).optional(),
    resources: z.array(z.record(z.string(), z.unknown())).optional(),
    metadata: z.record(z.string(), z.unknown()).optional()
  })
  .passthrough();

export function registerDeploymentRoutes(app: Express) {
  app.get("/v1/deployments", (request: AuthenticatedRequest, response) => {
    const user = currentUser(request);
    const workspaceId = typeof request.query.workspace_id === "string" ? request.query.workspace_id : "";
    if (workspaceId) {
      if (!canAccessWorkspace(user.id, workspaceId)) return response.status(403).json({ error: "workspace_forbidden" });
      return response.json({ data: listAgentDeploymentsForWorkspace(workspaceId).map(deploymentResponse) });
    }
    const deployments = listAgentDeploymentsForWorkspaces(Array.from(accessibleWorkspaceIds(user.id)), user.id);
    response.json({ data: deployments.map(deploymentResponse) });
  });

  app.post("/v1/deployments", (request: AuthenticatedRequest, response) => {
    const legacy = legacyDeploymentSchema.safeParse(request.body);
    if (legacy.success) return createLegacyDeployment(request, response, legacy.data);
    const parsed = deploymentCreateSchema.safeParse(request.body);
    if (!parsed.success) return response.status(400).json(parsed.error.flatten());
    return createDeploymentFromExistingResources(request, response, parsed.data);
  });

  app.get("/v1/deployments/:deploymentId", (request: AuthenticatedRequest, response) => {
    const deployment = readDeployment(request, response);
    if (!deployment) return;
    response.json(deploymentResponse(deployment));
  });

  app.patch("/v1/deployments/:deploymentId", (request: AuthenticatedRequest, response) => {
    const deployment = readDeployment(request, response);
    if (!deployment) return;
    if (deployment.archived_at) return response.status(409).json({ error: "deployment_archived" });
    const parsed = deploymentPatchSchema.safeParse(request.body);
    if (!parsed.success) return response.status(400).json(parsed.error.flatten());
    const next = patchNextRun(deployment, parsed.data);
    if ("error" in next) return response.status(400).json({ error: next.error });
    const updated = updateAgentDeployment(String(deployment.id), { ...parsed.data, next_run_at: next.next_run_at });
    response.json(deploymentResponse(updated));
  });

  app.get("/v1/deployments/:deploymentId/runs", (request: AuthenticatedRequest, response) => {
    const deployment = readDeployment(request, response);
    if (!deployment) return;
    response.json({ data: listDeploymentRuns(String(deployment.id), Number(request.query.limit || 50)) });
  });

  app.post("/v1/deployments/:deploymentId/run", async (request: AuthenticatedRequest, response) => {
    await invokeDeployment(request, response, "manual", false);
  });

  app.post("/v1/deployments/:deploymentId/invoke", async (request: AuthenticatedRequest, response) => {
    await invokeDeployment(request, response, "invoke", true);
  });

  app.post("/v1/deployments/:deploymentId/pause", (request: AuthenticatedRequest, response) => {
    const deployment = readDeployment(request, response);
    if (!deployment) return;
    const body = asRecord(request.body);
    const updated = pauseAgentDeployment(String(deployment.id), typeof body.reason === "string" ? body.reason : null);
    response.json(deploymentResponse(updated));
  });

  app.post("/v1/deployments/:deploymentId/unpause", (request: AuthenticatedRequest, response) => {
    const deployment = readDeployment(request, response);
    if (!deployment) return;
    const schedule = deployment.schedule as JsonRecord | null;
    const nextRunAt = schedule ? nextDeploymentRunAt(schedule) : null;
    const updated = unpauseAgentDeployment(String(deployment.id), nextRunAt);
    response.json(deploymentResponse(updated));
  });

  app.post("/v1/deployments/:deploymentId/archive", (request: AuthenticatedRequest, response) => {
    const deployment = readDeployment(request, response);
    if (!deployment) return;
    const updated = archiveAgentDeployment(String(deployment.id));
    response.json(deploymentResponse(updated));
  });
}

function createLegacyDeployment(request: AuthenticatedRequest, response: Response, body: z.infer<typeof legacyDeploymentSchema>) {
  const user = currentUser(request);
  const workspaceId = fallbackWorkspaceId(user, body.workspace_id);
  if (workspaceId && !canAccessWorkspace(user.id, workspaceId)) return response.status(403).json({ error: "workspace_forbidden" });
  try {
    const initialEvents = initialEventsForBody(body, body.manifest);
    const nextRunAt = scheduleNextRun(body.schedule, initialEvents);
    if ("error" in nextRunAt) return response.status(400).json({ error: nextRunAt.error });
    const agent = createAgent({ config: { ...body.manifest.agent, agent_loop: normalizeAgentLoop(body.manifest.agent.agent_loop) }, workspace_id: workspaceId });
    const environment = createEnvironment({ ...body.manifest.environment, workspace_id: workspaceId });
    if (!agent || !environment) return response.status(500).json({ error: "deployment_resource_create_failed" });
    const deployment = createAgentDeployment({
      user_id: user.id,
      agent_id: String((agent as JsonRecord).id),
      environment_id: String((environment as JsonRecord).id),
      name: body.manifest.name,
      version: String(body.manifest.version),
      manifest: body.manifest,
      bundle: body.bundle,
      initial_events: initialEvents,
      schedule: body.schedule ?? null,
      vault_ids: body.vault_ids ?? body.manifest.vault_ids,
      memory_store_ids: body.memory_store_ids ?? body.manifest.memory_store_ids,
      resources: body.resources ?? body.manifest.resources,
      metadata: body.metadata ?? body.manifest.metadata,
      workspace_id: workspaceId,
      next_run_at: nextRunAt.next_run_at
    });
    response.status(201).json({ ...deploymentResponse(deployment), agent, environment });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    response.status(message.includes("UNIQUE constraint failed") ? 409 : 400).json({ error: "deployment_create_failed", message });
  }
}

function createDeploymentFromExistingResources(request: AuthenticatedRequest, response: Response, body: z.infer<typeof deploymentCreateSchema>) {
  const user = currentUser(request);
  const workspaceId = fallbackWorkspaceId(user, body.workspace_id);
  if (!workspaceId) return response.status(400).json({ error: "workspace_required" });
  if (!canAccessWorkspace(user.id, workspaceId)) return response.status(403).json({ error: "workspace_forbidden" });
  const resourceError = resourceAccessError(body.agent_id, body.environment_id, workspaceId);
  if (resourceError) return response.status(resourceError.status).json({ error: resourceError.error });
  const nextRunAt = scheduleNextRun(body.schedule ?? null, body.initial_events);
  if ("error" in nextRunAt) return response.status(400).json({ error: nextRunAt.error });
  const deployment = createAgentDeployment({
    user_id: user.id,
    agent_id: body.agent_id,
    environment_id: body.environment_id,
    name: body.name,
    version: body.version,
    manifest: { schema_version: 1, name: body.name, version: body.version },
    bundle: { sha256: "managed", files: [] },
    initial_events: body.initial_events,
    schedule: body.schedule ?? null,
    vault_ids: body.vault_ids,
    memory_store_ids: body.memory_store_ids,
    resources: body.resources,
    metadata: body.metadata,
    workspace_id: workspaceId,
    next_run_at: nextRunAt.next_run_at
  });
  response.status(201).json(deploymentResponse(deployment));
}

async function invokeDeployment(request: AuthenticatedRequest, response: Response, triggeredBy: "manual" | "invoke", awaitTurn: boolean) {
  const deployment = readDeployment(request, response);
  if (!deployment) return;
  if (deployment.archived_at) return response.status(409).json({ error: "deployment_archived" });
  const parsed = deploymentRunCreateSchema.safeParse(request.body);
  if (!parsed.success) return response.status(400).json(parsed.error.flatten());
  try {
    const run = await runDeployment({
      deployment,
      triggered_by: triggeredBy,
      triggered_by_user_id: currentUser(request).id,
      title: parsed.data.title,
      message: parsed.data.message,
      initial_events: parsed.data.initial_events,
      vault_ids: parsed.data.vault_ids,
      memory_store_ids: parsed.data.memory_store_ids,
      resources: parsed.data.resources,
      trigger_context: parsed.data.trigger_context,
      await_turn: awaitTurn
    });
    const result = run as JsonRecord;
    response.status(202).json({ deployment_id: deployment.id, deployment_run_id: result.id, session_id: result.session_id, event_id: result.event_id, run: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    response.status(deploymentRunErrorStatus(message)).json({ error: "deployment_run_failed", message });
  }
}

function readDeployment(request: AuthenticatedRequest, response: Response) {
  const deployment = getAgentDeployment(routeParam(request.params.deploymentId)) as JsonRecord | null;
  if (!deployment) {
    response.status(404).json({ error: "deployment_not_found" });
    return null;
  }
  if (canReadDeployment(currentUser(request).id, deployment)) return deployment;
  response.status(403).json({ error: "deployment_forbidden" });
  return null;
}

function canReadDeployment(userId: string, deployment: JsonRecord) {
  const workspaceId = String(deployment.workspace_id || "");
  if (workspaceId && workspaceId !== GLOBAL_SCOPE_ID) return canAccessWorkspace(userId, workspaceId);
  return String(deployment.user_id || "") === userId;
}

function deploymentResponse(deployment: unknown) {
  const record = asRecord(deployment);
  const schedule = record.schedule as JsonRecord | null | undefined;
  return {
    ...record,
    upcoming_runs_at: schedule ? safeUpcomingRuns(schedule) : []
  };
}

function initialEventsForBody(body: { message?: string; initial_events?: JsonRecord[] }, manifest: JsonRecord) {
  if (body.message) return [{ type: "user.message", payload: { content: [{ type: "text", text: body.message }], source: "deployment.create" } }];
  if (body.initial_events) return body.initial_events;
  const manifestEvents = manifest.initial_events;
  return Array.isArray(manifestEvents) ? (manifestEvents as JsonRecord[]) : [];
}

function patchNextRun(deployment: JsonRecord, patch: z.infer<typeof deploymentPatchSchema>) {
  const hasSchedule = Object.prototype.hasOwnProperty.call(patch, "schedule");
  const schedule = hasSchedule ? patch.schedule ?? null : (deployment.schedule as JsonRecord | null);
  const initialEvents = patch.initial_events ?? ((deployment.initial_events as JsonRecord[] | undefined) || []);
  if (deployment.status === "paused" || deployment.status === "archived") return { next_run_at: null };
  return scheduleNextRun(schedule, initialEvents);
}

function scheduleNextRun(schedule: JsonRecord | null | undefined, initialEvents: JsonRecord[]) {
  if (!schedule) return { next_run_at: null };
  if (!deploymentHasUserMessage(initialEvents)) return { error: "deployment_initial_user_message_required" };
  try {
    return { next_run_at: nextDeploymentRunAt(schedule) };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

function resourceAccessError(agentId: string, environmentId: string, workspaceId: string) {
  const agent = getAgent(agentId) as JsonRecord | null;
  const environment = getEnvironment(environmentId) as JsonRecord | null;
  if (!agent) return { status: 404, error: "agent_not_found" };
  if (!environment) return { status: 404, error: "environment_not_found" };
  if (String(agent.workspace_id || GLOBAL_SCOPE_ID) !== workspaceId) return { status: 400, error: "agent_workspace_mismatch" };
  if (String(environment.workspace_id || GLOBAL_SCOPE_ID) !== workspaceId) return { status: 400, error: "environment_workspace_mismatch" };
  return null;
}

function safeUpcomingRuns(schedule: JsonRecord) {
  try {
    return deploymentUpcomingRuns(schedule, 3);
  } catch {
    return [];
  }
}

function deploymentRunErrorStatus(message: string) {
  if (message.includes("not_found")) return 404;
  if (message.includes("runtime pool")) return 503;
  return 400;
}

function asRecord(value: unknown): JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as JsonRecord) : {};
}

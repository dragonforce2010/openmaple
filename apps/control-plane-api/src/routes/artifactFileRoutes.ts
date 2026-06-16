import type { Express } from "express";
import type { AuthenticatedRequest, JsonRecord } from "./routeDeps";
import {
  createManagedFileFromRequest,
  currentUser,
  downloadArtifact,
  getManagedFile,
  getSession,
  listArtifactsForUser,
  listSessionArtifacts,
  managedFileResponse,
  updateSessionMetadata
} from "./routeDeps";
import { asRecord, canReadSessionRecord, fallbackWorkspaceId, routeParam } from "./routeHelpers";
export function registerArtifactFileRoutes(app: Express) {
app.get("/v1/artifacts", async (request: AuthenticatedRequest, response) => {
  response.json({ data: await listArtifactsForUser(currentUser(request).id) });
});

app.get("/v1/sessions/:sessionId/artifacts", async (request: AuthenticatedRequest, response) => {
  const sessionId = routeParam(request.params.sessionId);
  const session = getSession(sessionId);
  if (!session) return response.status(404).json({ error: "session_not_found" });
  if (!canReadSessionRecord(currentUser(request).id, session)) return response.status(403).json({ error: "session_forbidden" });
  response.json({ data: await listSessionArtifacts(sessionId) });
});

app.get("/v1/sessions/:sessionId/artifacts/*path/download", async (request: AuthenticatedRequest, response) => {
  const session = getSession(routeParam(request.params.sessionId));
  if (!session) return response.status(404).json({ error: "session_not_found" });
  if (!canReadSessionRecord(currentUser(request).id, session)) return response.status(403).json({ error: "session_forbidden" });
  try {
    await downloadArtifact(request, response);
  } catch (error) {
    response.status(404).json({ error: "artifact_not_found", message: error instanceof Error ? error.message : String(error) });
  }
});

app.post("/v1/files", async (request: AuthenticatedRequest, response) => {
  const user = currentUser(request);
  const workspaceId = fallbackWorkspaceId(user, typeof request.query.workspace_id === "string" ? request.query.workspace_id : null);
  if (!workspaceId) return response.status(400).json({ error: "workspace_required", message: "a workspace is required to resolve a TOS bucket" });
  try {
    const file = await createManagedFileFromRequest(request, {
      workspaceId,
      scope: { workspace_id: workspaceId, created_by_user_id: user.id }
    });
    response.status(201).json(managedFileResponse(file));
  } catch (error) {
    response.status(400).json({ error: "file_upload_failed", message: error instanceof Error ? error.message : String(error) });
  }
});

app.post("/v1/sessions/:sessionId/files", async (request: AuthenticatedRequest, response) => {
  const session = getSession(routeParam(request.params.sessionId));
  if (!session) return response.status(404).json({ error: "session_not_found" });
  const user = currentUser(request);
  if (!canReadSessionRecord(user.id, session)) return response.status(403).json({ error: "session_forbidden" });
  try {
    const file = await createManagedFileFromRequest(request, sessionUploadOptions(session, user.id));
    const resource = attachSessionResource(session, file, request);
    response.status(201).json({ ...managedFileResponse(file), resource });
  } catch (error) {
    response.status(400).json({ error: "file_upload_failed", message: error instanceof Error ? error.message : String(error) });
  }
});

app.get("/v1/files/:fileId", (request: AuthenticatedRequest, response) => {
  const file = getManagedFile(routeParam(request.params.fileId));
  if (!file) return response.status(404).json({ error: "file_not_found" });
  response.json(managedFileResponse(file));
});
}

function sessionUploadOptions(session: JsonRecord, userId: string) {
  const workspaceId = String(session.workspace_id || asRecord(session.metadata).workspace_id || "");
  if (!workspaceId) throw new Error("session has no workspace; cannot resolve a TOS bucket");
  return {
    workspaceId,
    keyParts: ["session-uploads", workspaceId, String(session.agent_id || "agent"), String(session.id)],
    scope: { workspace_id: workspaceId, tenant_id: String(session.tenant_id || "") || null, created_by_user_id: userId }
  };
}

function attachSessionResource(session: JsonRecord, file: { id: string; filename: string; media_type: string; bytes: number }, request: AuthenticatedRequest) {
  const requested = typeof request.query.mount_path === "string" ? request.query.mount_path : "";
  const mountPath = requested.replace(/^\/+/, "").replace(/\.\.+/g, "").trim() || file.filename;
  const resource = { type: "file", file_id: file.id, mount_path: mountPath, media_type: file.media_type, bytes: file.bytes };
  const existing = Array.isArray(asRecord(session.metadata).resources) ? (asRecord(session.metadata).resources as JsonRecord[]) : [];
  const resources = [...existing.filter((item) => item.file_id !== file.id), resource];
  updateSessionMetadata(String(session.id), { resources });
  return resource;
}

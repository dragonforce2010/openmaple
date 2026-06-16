import type { Request, Response } from "express";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, relative, resolve, sep } from "node:path";
import {
  canAccessWorkspace,
  getSession,
  getSessionArtifactRecord,
  listSessionArtifactRecords,
  listSessions,
  upsertSessionArtifactRecord
} from "../store";
import type { JsonRecord } from "../types";
import { objectKey, presignedObjectUrl, putObject } from "./objectStorage";
import { objectStorageEnabled, workspaceObjectStorage, workspaceTosCreds } from "./workspaceStorage";

const ignoredDirectories = new Set(["node_modules", ".git", ".session"]);
const maxArtifacts = 500;

export function canAccessSession(userId: string, session: JsonRecord) {
  const owner = (session.metadata as JsonRecord | undefined)?.owner_user_id;
  if (!owner || owner === userId) return true;
  const workspaceId = typeof session.workspace_id === "string" ? session.workspace_id : "";
  return workspaceId ? canAccessWorkspace(userId, workspaceId) : false;
}

export async function listArtifactsForUser(userId: string) {
  const artifacts = await Promise.all(
    listSessions()
    .filter((session) => canAccessSession(userId, session as JsonRecord))
    .map(async (session) => {
      const row = session as JsonRecord;
      return (await listSessionArtifacts(String(row.id))).map((artifact) => ({ ...artifact, session_id: row.id, session_title: row.title }));
    })
  );
  return artifacts.flat();
}

export async function listSessionArtifacts(sessionId: string) {
  const session = getSession(sessionId);
  if (!session) return [];
  await syncSessionArtifacts(session);
  return listSessionArtifactRecords(sessionId);
}

export async function downloadArtifact(request: Request, response: Response) {
  const sessionId = Array.isArray(request.params.sessionId) ? request.params.sessionId.join("/") : String(request.params.sessionId ?? "");
  const session = getSession(sessionId);
  if (!session) return response.status(404).json({ error: "session_not_found" });
  const path = Array.isArray(request.params.path) ? request.params.path.join("/") : request.params.path;
  await syncSessionArtifacts(session);
  const artifact = getSessionArtifactRecord(sessionId, String(path ?? ""));
  if (!artifact) return response.status(404).json({ error: "artifact_not_found" });
  if (artifact.storage_provider !== "tos") {
    return response.sendFile(resolveArtifactPath(String(session.workspace_path), String(artifact.object_key || artifact.path)));
  }
  const workspaceId = String(session.workspace_id || asRecord(session.metadata).workspace_id || "");
  const creds = workspaceId ? workspaceTosCreds(workspaceId) : null;
  if (!creds) return response.status(409).json({ error: "workspace_storage_unavailable" });
  response.redirect(presignedObjectUrl({ ...creds, bucket: String(artifact.bucket) }, String(artifact.object_key)));
}

export async function syncSessionArtifacts(session: JsonRecord) {
  const root = resolve(String(session.workspace_path));
  if (!existsSync(root)) return;
  const workspaceId = String(session.workspace_id || asRecord(session.metadata).workspace_id || "");
  let storage = await optionalWorkspaceStorage(workspaceId);
  const files: Array<{ path: string; absolute: string; size: number; updated_at: string }> = [];
  walk(root, root, files);
  for (const file of files) {
    const content = readFileSync(file.absolute);
    const sha256 = createHash("sha256").update(content).digest("hex");
    const existing = getSessionArtifactRecord(String(session.id), file.path);
    if (existing && existing.sha256 === sha256 && Number(existing.size_bytes) === file.size) continue;
    const stored = storage ? await tryPutArtifact(storage, session, file, content, sha256) : null;
    if (!stored) storage = null;
    upsertSessionArtifactRecord({
      session_id: String(session.id),
      path: file.path,
      filename: basename(file.path),
      media_type: mediaTypeForPath(file.path),
      size_bytes: file.size,
      sha256,
      storage_provider: stored?.provider ?? "local",
      bucket: stored?.bucket ?? "",
      object_key: stored?.key ?? file.path,
      public_url: stored?.public_url ?? null,
      metadata: { source_updated_at: file.updated_at },
      updated_at: file.updated_at
    });
  }
}

async function optionalWorkspaceStorage(workspaceId: string) {
  if (!workspaceId || !objectStorageEnabled(workspaceId)) return null;
  try {
    return await workspaceObjectStorage(workspaceId);
  } catch (error) {
    console.warn("[artifacts] workspace object storage unavailable", workspaceId, error);
    return null;
  }
}

async function tryPutArtifact(
  storage: Awaited<ReturnType<typeof workspaceObjectStorage>>,
  session: JsonRecord,
  file: { path: string },
  content: Buffer,
  sha256: string
) {
  try {
    return await putObject(storage, {
      key: objectKey("session-artifacts", String(session.id), sha256.slice(0, 16), file.path),
      body: content,
      contentType: mediaTypeForPath(file.path),
      metadata: { session_id: String(session.id), sha256 }
    });
  } catch (error) {
    console.warn("[artifacts] TOS artifact upload failed, using local artifact record", error);
    return null;
  }
}

export function resolveArtifactPath(workspacePath: string, artifactPath: string) {
  const root = resolve(workspacePath);
  const target = resolve(root, artifactPath);
  if (target !== root && !target.startsWith(`${root}${sep}`)) throw new Error("artifact_path_outside_workspace");
  return target;
}

function walk(root: string, current: string, files: Array<{ path: string; absolute: string; size: number; updated_at: string }>) {
  if (files.length >= maxArtifacts) return;
  for (const entry of readdirSync(current, { withFileTypes: true })) {
    if (files.length >= maxArtifacts) return;
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    const absolute = resolve(current, entry.name);
    if (entry.isDirectory()) {
      walk(root, absolute, files);
      continue;
    }
    if (!entry.isFile()) continue;
    const stats = statSync(absolute);
    files.push({
      path: relative(root, absolute),
      absolute,
      size: stats.size,
      updated_at: stats.mtime.toISOString()
    });
  }
}

function asRecord(value: unknown): JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function mediaTypeForPath(path: string) {
  const lower = path.toLowerCase();
  if (lower.endsWith(".json")) return "application/json";
  if (lower.endsWith(".html")) return "text/html";
  if (lower.endsWith(".md")) return "text/markdown";
  if (lower.endsWith(".txt") || lower.endsWith(".log")) return "text/plain";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  return "application/octet-stream";
}

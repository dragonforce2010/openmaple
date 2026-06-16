import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { getManagedFile, readManagedFile } from "../files";
import { presignedObjectUrl, type TosCreds } from "../files/objectStorage";
import { objectStorageEnabled, workspaceObjectStorage } from "../files/workspaceStorage";
import type { JsonRecord } from "../types";
import { assertSafeWorkspacePath, listHostFiles, safeWorkspaceRelativePath } from "./runtimeCommon";

const PRESIGN_TTL_SECONDS = Number(process.env.MAPLE_SESSION_UPLOAD_PRESIGN_TTL_SECONDS || 1800);

export async function prepareSessionResources(session: JsonRecord & { id: string; workspace_path: string }) {
  const metadata = session.metadata as JsonRecord;
  const resources = Array.isArray(metadata.resources) ? (metadata.resources as JsonRecord[]) : [];
  const uploadRoot = join(String(session.workspace_path), ".session", "uploads");
  await mkdir(uploadRoot, { recursive: true });

  for (const resource of resources) {
    if (resource.type !== "file" || !resource.file_id) continue;
    const uploaded = await readManagedFile(String(resource.file_id));
    if (!uploaded) throw new Error(`Session resource file not found: ${resource.file_id}`);
    const mountPath = safeWorkspaceRelativePath(String(resource.mount_path || uploaded.metadata.filename));
    const target = join(uploadRoot, mountPath);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, uploaded.content);
    const workspaceTarget = assertSafeWorkspacePath(String(session.workspace_path), mountPath);
    await mkdir(dirname(workspaceTarget), { recursive: true });
    await writeFile(workspaceTarget, uploaded.content);
  }
}

export async function sessionResourceManifest(session: JsonRecord & { workspace_path: string }): Promise<JsonRecord[]> {
  const resources = Array.isArray((session.metadata as JsonRecord)?.resources) ? ((session.metadata as JsonRecord).resources as JsonRecord[]) : [];
  const workspaceId = String(session.workspace_id || (session.metadata as JsonRecord)?.workspace_id || "");
  if (resources.length && workspaceId && objectStorageEnabled(workspaceId)) {
    return presignedResourceManifest(resources, await workspaceObjectStorage(workspaceId));
  }
  return base64ResourceManifest(String(session.workspace_path));
}

function presignedResourceManifest(resources: JsonRecord[], creds: TosCreds): JsonRecord[] {
  const manifest: JsonRecord[] = [];
  for (const resource of resources) {
    if (resource.type !== "file" || !resource.file_id) continue;
    const file = getManagedFile(String(resource.file_id));
    if (!file) continue;
    const mountPath = safeWorkspaceRelativePath(String(resource.mount_path || file.filename));
    manifest.push({
      type: "file",
      mount_path: `/mnt/session/uploads/${mountPath}`,
      presigned_url: presignedObjectUrl({ ...creds, bucket: file.bucket }, file.object_key, PRESIGN_TTL_SECONDS),
      media_type: file.media_type,
      sha256: file.sha256
    });
  }
  return manifest;
}

// Fallback for local/dev without TOS credentials: ship the bytes inline as before.
async function base64ResourceManifest(workspacePath: string): Promise<JsonRecord[]> {
  const uploadRoot = join(workspacePath, ".session", "uploads");
  if (!existsSync(uploadRoot)) return [];
  return Promise.all(
    listHostFiles(uploadRoot).map(async (path) => ({
      type: "file",
      mount_path: `/mnt/session/uploads/${path}`,
      content_base64: (await readFile(join(uploadRoot, path))).toString("base64")
    }))
  );
}

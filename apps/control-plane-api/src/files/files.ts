import type { Request } from "express";
import { nanoid } from "nanoid";
import { createHash } from "node:crypto";
import { basename } from "node:path";
import { createManagedFileRecord, getManagedFileRecord } from "../store";
import type { JsonRecord } from "../types";
import { objectKey, putObject, readObject, type ObjectStorageCreds } from "./objectStorage";
import { workspaceObjectStorage, workspaceObjectStorageCreds } from "./workspaceStorage";

export type ManagedFile = {
  id: string;
  filename: string;
  media_type: string;
  bytes: number;
  sha256: string;
  storage_provider: string;
  bucket: string;
  object_key: string;
  public_url?: string | null;
  workspace_id?: string | null;
  created_at: string;
};

export type ManagedFileWriteOptions = {
  workspaceId: string;
  keyParts?: string[];
  scope?: { workspace_id?: string | null; tenant_id?: string | null; created_by_user_id?: string | null };
};

export async function createManagedFileFromRequest(request: Request, options: ManagedFileWriteOptions) {
  const contentType = request.header("content-type") || "";
  const buffer = await readRequestBody(request);
  const uploaded = contentType.includes("multipart/form-data")
    ? parseMultipartUpload(buffer, contentType)
    : {
        filename: String(request.query.filename || "upload.bin"),
        media_type: contentType || "application/octet-stream",
        content: buffer
      };
  return writeManagedFile(uploaded.filename, uploaded.media_type, uploaded.content, options);
}

export function getManagedFile(fileId: string) {
  return getManagedFileRecord(fileId) as ManagedFile | null;
}

export async function readManagedFile(fileId: string) {
  const metadata = getManagedFile(fileId);
  if (!metadata) return null;
  return { metadata, content: await readObject(managedFileCreds(metadata), metadata.object_key) };
}

// Rebuild the bucket-scoped creds for a stored file from its own workspace + bucket columns.
function managedFileCreds(file: ManagedFile): ObjectStorageCreds {
  const workspaceId = String(file.workspace_id || "");
  const creds = workspaceId ? workspaceObjectStorageCreds(workspaceId, file.storage_provider) : null;
  if (!creds) throw new Error(`managed file ${file.id} has no resolvable workspace credentials`);
  return { ...creds, bucket: file.bucket };
}

export function managedFileResponse(file: ManagedFile) {
  return {
    id: file.id,
    type: "file",
    filename: file.filename,
    media_type: file.media_type,
    bytes: file.bytes,
    size_bytes: file.bytes,
    sha256: file.sha256,
    storage_provider: file.storage_provider,
    bucket: file.bucket,
    object_key: file.object_key,
    public_url: file.public_url ?? null,
    created_at: file.created_at
  };
}

async function writeManagedFile(filename: string, mediaType: string, content: Buffer, options: ManagedFileWriteOptions): Promise<ManagedFile> {
  const id = `file_${nanoid(10)}`;
  const safeName = basename(filename || "upload.bin").replace(/[^a-zA-Z0-9._-]/g, "_") || "upload.bin";
  const sha256 = createHash("sha256").update(content).digest("hex");
  const keyParts = options.keyParts?.length ? [...options.keyParts, id, safeName] : ["managed-files", id, safeName];
  const storage = await workspaceObjectStorage(options.workspaceId);
  const stored = await putObject(storage, {
    key: objectKey(...keyParts),
    body: content,
    contentType: mediaType || "application/octet-stream",
    metadata: { sha256, filename: safeName }
  });
  const metadata = createManagedFileRecord({
    id,
    filename: safeName,
    media_type: mediaType || "application/octet-stream",
    bytes: content.length,
    sha256,
    storage_provider: stored.provider,
    bucket: stored.bucket,
    object_key: stored.key,
    public_url: stored.public_url,
    metadata: {},
    workspace_id: options.scope?.workspace_id ?? null,
    tenant_id: options.scope?.tenant_id ?? null,
    created_by_user_id: options.scope?.created_by_user_id ?? null
  });
  if (!metadata) throw new Error("managed file metadata write failed");
  return metadata as ManagedFile;
}

function readRequestBody(request: Request) {
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}

function parseMultipartUpload(buffer: Buffer, contentType: string) {
  const boundaryMatch = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  const boundary = boundaryMatch?.[1] || boundaryMatch?.[2];
  if (!boundary) throw new Error("multipart boundary missing");
  const raw = buffer.toString("binary");
  const parts = raw.split(`--${boundary}`);
  for (const part of parts) {
    const separator = part.indexOf("\r\n\r\n");
    if (separator < 0) continue;
    const rawHeaders = part.slice(0, separator);
    if (!/name="file"/i.test(rawHeaders)) continue;
    const filename = /filename="([^"]*)"/i.exec(rawHeaders)?.[1] || "upload.bin";
    const mediaType = /content-type:\s*([^\r\n]+)/i.exec(rawHeaders)?.[1]?.trim() || "application/octet-stream";
    let body = part.slice(separator + 4);
    if (body.endsWith("\r\n")) body = body.slice(0, -2);
    return { filename, media_type: mediaType, content: Buffer.from(body, "binary") };
  }
  const fields = parseMultipartFields(parts);
  const value = fields.file;
  if (typeof value === "string") return { filename: "upload.txt", media_type: "text/plain", content: Buffer.from(value, "utf8") };
  throw new Error("multipart file field missing");
}

function parseMultipartFields(parts: string[]) {
  const fields: JsonRecord = {};
  for (const part of parts) {
    const separator = part.indexOf("\r\n\r\n");
    if (separator < 0) continue;
    const rawHeaders = part.slice(0, separator);
    const name = /name="([^"]+)"/i.exec(rawHeaders)?.[1];
    if (!name) continue;
    let body = part.slice(separator + 4);
    if (body.endsWith("\r\n")) body = body.slice(0, -2);
    fields[name] = body;
  }
  return fields;
}

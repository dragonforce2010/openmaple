import { customAlphabet } from "nanoid";
import { db } from "../storage/storeCore";
import { getWorkspace } from "../storage/storeWorkspace";
import { tenantSlugFromRecord } from "../storage/storeTenant";
import type { JsonRecord } from "../types";
import { bucketExists, createBucket, type TosCreds } from "./objectStorage";

const bucketRandom = customAlphabet("abcdefghijklmnopqrstuvwxyz0123456789", 6);

// A storage handle bound to one workspace's tenant credentials + its own TOS bucket.
export type WorkspaceStorage = TosCreds & { workspaceId: string };

export function workspaceTosCreds(workspaceId: string): { accessKeyId: string; accessKeySecret: string; region: string } | null {
  const workspace = getWorkspace(workspaceId) as JsonRecord | null;
  if (!workspace) return null;
  const vefaas = asRecord(asRecord(asRecord(workspace.config).provider_credentials).vefaas);
  const accessKeyId = String(vefaas.VOLCENGINE_ACCESS_KEY || "");
  const accessKeySecret = String(vefaas.VOLCENGINE_SECRET_KEY || "");
  if (!accessKeyId || !accessKeySecret) return null;
  return { accessKeyId, accessKeySecret, region: String(vefaas.VEFAAS_REGION || "cn-beijing") };
}

export function objectStorageEnabled(workspaceId: string) {
  return Boolean(workspaceTosCreds(workspaceId));
}

// Resolve (and lazily create) the workspace's bucket, returning a credentialed storage handle.
export async function workspaceObjectStorage(workspaceId: string): Promise<WorkspaceStorage> {
  const creds = workspaceTosCreds(workspaceId);
  if (!creds) throw new Error(`workspace ${workspaceId} has no Volcengine credentials for TOS`);
  const bucket = await ensureWorkspaceBucket(workspaceId);
  return { ...creds, bucket, workspaceId };
}

// Idempotent: returns the stored bucket name, or generates + creates one and persists it.
// Called both at onboarding (new tenants) and before upload (back-fill for existing tenants).
export async function ensureWorkspaceBucket(workspaceId: string): Promise<string> {
  const workspace = getWorkspace(workspaceId) as JsonRecord | null;
  if (!workspace) throw new Error(`workspace not found: ${workspaceId}`);
  const config = asRecord(workspace.config);
  const existing = String(config.tos_bucket || "");
  if (existing) return existing;

  const creds = workspaceTosCreds(workspaceId);
  if (!creds) throw new Error(`workspace ${workspaceId} has no Volcengine credentials for TOS`);

  const bucket = await createUniqueBucket(workspaceId, { ...creds, bucket: "" });
  persistBucketName(workspaceId, config, bucket);
  return bucket;
}

async function createUniqueBucket(workspaceId: string, baseCreds: TosCreds): Promise<string> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const bucket = workspaceBucketName(workspaceId);
    const creds = { ...baseCreds, bucket };
    if (await bucketExists(creds)) return bucket;
    try {
      await createBucket(creds);
      return bucket;
    } catch (error) {
      // BucketAlreadyExists (global namespace collision) -> retry with a fresh random suffix.
      if (attempt === 2) throw error;
    }
  }
  throw new Error(`could not create a TOS bucket for workspace ${workspaceId}`);
}

function workspaceBucketName(workspaceId: string) {
  const workspace = getWorkspace(workspaceId) as JsonRecord | null;
  const tenant = workspace ? (db.prepare("SELECT * FROM tenants WHERE id = ?").get(String(workspace.tenant_id)) as JsonRecord | undefined) : undefined;
  return composeBucketName(tenant ? tenantSlugFromRecord(tenant) : "t", workspaceId, bucketRandom());
}

// maple-<tenantSlug>-<workspaceIdShort>-<random6>, clamped to TOS rules (3-63 chars,
// lowercase alphanumerics + hyphens, no leading/trailing hyphen). Pure for testability.
export function composeBucketName(tenantSlug: string, workspaceId: string, random: string) {
  const slug = sanitizeSegment(tenantSlug, 20) || "t";
  const wsShort = sanitizeSegment(String(workspaceId).replace(/^ws[_-]?/i, ""), 16) || "ws";
  const rand = sanitizeSegment(random, 6) || "000000";
  return `maple-${slug}-${wsShort}-${rand}`.slice(0, 63).replace(/-+$/g, "");
}

function persistBucketName(workspaceId: string, config: JsonRecord, bucket: string) {
  const nextConfig = { ...config, tos_bucket: bucket };
  db.prepare("UPDATE workspaces SET config_json = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(nextConfig), new Date().toISOString(), workspaceId);
}

function sanitizeSegment(value: string, max: number) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, max).replace(/-+$/g, "");
}

function asRecord(value: unknown): JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as JsonRecord) : {};
}

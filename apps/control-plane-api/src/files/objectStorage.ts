import { TosClient } from "@volcengine/tos-sdk";

// Low-level, stateless TOS ops. Credentials are passed in per call (sourced per-workspace from the
// tenant's veFaaS AK/SK — see workspaceStorage.ts), never read from global env. TOS and veFaaS are
// both Volcengine and share one AK/SK.
export type TosCreds = {
  accessKeyId: string;
  accessKeySecret: string;
  region: string;
  bucket: string;
};

export type StoredObject = {
  provider: "tos";
  bucket: string;
  key: string;
  public_url: string;
};

const clients = new Map<string, TosClient>();

export function tosEndpoint(region: string) {
  return `tos-${region}.volces.com`;
}

export function objectUrl(creds: TosCreds, key: string) {
  const path = key.split("/").map(encodeURIComponent).join("/");
  return `https://${creds.bucket}.${tosEndpoint(creds.region)}/${path}`;
}

export async function putObject(creds: TosCreds, input: { key: string; body: Buffer; contentType?: string; metadata?: Record<string, string> }): Promise<StoredObject> {
  await client(creds).putObject({
    bucket: creds.bucket,
    key: input.key,
    body: input.body,
    contentLength: input.body.length,
    contentType: input.contentType || "application/octet-stream",
    meta: input.metadata
  });
  return { provider: "tos", bucket: creds.bucket, key: input.key, public_url: objectUrl(creds, input.key) };
}

export async function readObject(creds: TosCreds, key: string) {
  const result = await client(creds).getObjectV2({ bucket: creds.bucket, key, dataType: "buffer" });
  return result.data.content;
}

export async function deleteObject(creds: TosCreds, key: string) {
  await client(creds).deleteObject({ bucket: creds.bucket, key });
}

export function presignedObjectUrl(creds: TosCreds, key: string, expires = 1800) {
  return client(creds).getPreSignedUrl({ bucket: creds.bucket, key, method: "GET", expires });
}

export async function bucketExists(creds: TosCreds) {
  return client(creds).doesBucketExist({ bucket: creds.bucket });
}

export async function createBucket(creds: TosCreds) {
  await client(creds).createBucket({ bucket: creds.bucket });
}

export function objectKey(...parts: string[]) {
  return parts
    .flatMap((part) => String(part).split("/"))
    .map((part) => part.trim().replace(/[^a-zA-Z0-9._=-]+/g, "-").replace(/^-+|-+$/g, ""))
    .filter(Boolean)
    .join("/");
}

function client(creds: TosCreds) {
  if (!creds.accessKeyId || !creds.accessKeySecret) {
    throw new Error("TOS object storage requires the workspace's Volcengine AK/SK.");
  }
  const cacheKey = `${creds.accessKeyId}@${creds.region}`;
  let instance = clients.get(cacheKey);
  if (!instance) {
    instance = new TosClient({
      accessKeyId: creds.accessKeyId,
      accessKeySecret: creds.accessKeySecret,
      region: creds.region,
      endpoint: tosEndpoint(creds.region)
    });
    clients.set(cacheKey, instance);
  }
  return instance;
}

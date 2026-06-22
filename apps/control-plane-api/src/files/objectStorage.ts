import { TosClient } from "@volcengine/tos-sdk";
import OSS from "ali-oss";

// Low-level, stateless TOS ops. Credentials are passed in per call (sourced per-workspace from the
// tenant's veFaaS AK/SK — see workspaceStorage.ts), never read from global env. TOS and veFaaS are
// both Volcengine and share one AK/SK.
export type TosCreds = {
  provider?: "tos";
  accessKeyId: string;
  accessKeySecret: string;
  region: string;
  bucket: string;
};

export type OssCreds = {
  provider: "oss";
  accessKeyId: string;
  accessKeySecret: string;
  region: string;
  bucket: string;
  endpoint?: string;
};

export type ObjectStorageCreds = TosCreds | OssCreds;

export type StoredObject = {
  provider: "tos" | "oss";
  bucket: string;
  key: string;
  public_url: string;
};

const clients = new Map<string, TosClient>();
const ossClients = new Map<string, OSS>();

export function tosEndpoint(region: string) {
  return `tos-${region}.volces.com`;
}

export function objectUrl(creds: ObjectStorageCreds, key: string) {
  const path = key.split("/").map(encodeURIComponent).join("/");
  if (creds.provider === "oss") return `https://${creds.bucket}.${ossEndpoint(creds)}/${path}`;
  return `https://${creds.bucket}.${tosEndpoint(creds.region)}/${path}`;
}

export function ossEndpoint(creds: Pick<OssCreds, "region" | "endpoint">) {
  return (creds.endpoint || `oss-${creds.region}.aliyuncs.com`).replace(/^https?:\/\//, "");
}

export async function putObject(creds: ObjectStorageCreds, input: { key: string; body: Buffer; contentType?: string; metadata?: Record<string, string> }): Promise<StoredObject> {
  if (creds.provider === "oss") {
    await ossClient(creds).put(input.key, input.body, {
      headers: {
        "Content-Type": input.contentType || "application/octet-stream",
        ...Object.fromEntries(Object.entries(input.metadata ?? {}).map(([key, value]) => [`x-oss-meta-${key}`, value]))
      }
    });
    return { provider: "oss", bucket: creds.bucket, key: input.key, public_url: objectUrl(creds, input.key) };
  }
  await tosClient(creds).putObject({
    bucket: creds.bucket,
    key: input.key,
    body: input.body,
    contentLength: input.body.length,
    contentType: input.contentType || "application/octet-stream",
    meta: input.metadata
  });
  return { provider: "tos", bucket: creds.bucket, key: input.key, public_url: objectUrl(creds, input.key) };
}

export async function readObject(creds: ObjectStorageCreds, key: string) {
  if (creds.provider === "oss") {
    const result = await ossClient(creds).get(key);
    return Buffer.isBuffer(result.content) ? result.content : Buffer.from(result.content);
  }
  const result = await tosClient(creds).getObjectV2({ bucket: creds.bucket, key, dataType: "buffer" });
  return result.data.content;
}

export async function deleteObject(creds: ObjectStorageCreds, key: string) {
  if (creds.provider === "oss") {
    await ossClient(creds).delete(key);
    return;
  }
  await tosClient(creds).deleteObject({ bucket: creds.bucket, key });
}

export async function presignedObjectUrl(creds: ObjectStorageCreds, key: string, expires = 1800) {
  if (creds.provider === "oss") return ossClient(creds).signatureUrl(key, { expires, method: "GET" });
  return tosClient(creds).getPreSignedUrl({ bucket: creds.bucket, key, method: "GET", expires });
}

export async function bucketExists(creds: ObjectStorageCreds) {
  if (creds.provider === "oss") {
    try {
      await ossClient(creds).getBucketInfo(creds.bucket);
      return true;
    } catch (error) {
      if (String((error as { code?: unknown }).code || "").includes("NoSuchBucket")) return false;
      return false;
    }
  }
  return tosClient(creds).doesBucketExist({ bucket: creds.bucket });
}

export async function createBucket(creds: ObjectStorageCreds) {
  if (creds.provider === "oss") {
    await ossClient(creds).putBucket(creds.bucket);
    return;
  }
  await tosClient(creds).createBucket({ bucket: creds.bucket });
}

export function objectKey(...parts: string[]) {
  return parts
    .flatMap((part) => String(part).split("/"))
    .map((part) => part.trim().replace(/[^a-zA-Z0-9._=-]+/g, "-").replace(/^-+|-+$/g, ""))
    .filter(Boolean)
    .join("/");
}

function tosClient(creds: TosCreds) {
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

function ossClient(creds: OssCreds) {
  if (!creds.accessKeyId || !creds.accessKeySecret) {
    throw new Error("OSS object storage requires the workspace's Aliyun AK/SK.");
  }
  const cacheKey = `${creds.accessKeyId}@${creds.region}@${creds.bucket}@${creds.endpoint || ""}`;
  let instance = ossClients.get(cacheKey);
  if (!instance) {
    instance = new OSS({
      region: creds.region.startsWith("oss-") ? creds.region : `oss-${creds.region}`,
      accessKeyId: creds.accessKeyId,
      accessKeySecret: creds.accessKeySecret,
      bucket: creds.bucket,
      endpoint: creds.endpoint || undefined
    });
    ossClients.set(cacheKey, instance);
  }
  return instance;
}

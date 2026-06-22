import type { JsonRecord } from "../types";

type IdentityInput = {
  providerCredentials?: JsonRecord;
  runtimeProvider?: string;
  sandboxProvider?: string;
  runtimePools?: Array<{ provider?: string }>;
  sandboxPools?: Array<{ provider?: string }>;
  artifactProvider?: string;
};

export function cloudProviderIdentities(input: IdentityInput) {
  const credentials = recordValue(input.providerCredentials);
  const identities: Record<string, JsonRecord> = {};
  const runtimeProviders = providerSet(input.runtimeProvider, input.runtimePools);
  const sandboxProviders = providerSet(input.sandboxProvider, input.sandboxPools);
  if (runtimeProviders.has("local_docker") || sandboxProviders.has("local_docker")) {
    identities.local_docker = {
      provider: "local_docker",
      label: "Local Docker",
      identity_type: "host_docker_socket",
      credential_source: "docker.sock",
      region: "local",
      services: compact([
        runtimeProviders.has("local_docker") ? "runtime:local_docker" : "",
        sandboxProviders.has("local_docker") ? "sandbox:local_docker" : ""
      ]),
      configured: true
    };
  }
  const volcengineCreds = recordValue(credentials.vefaas);
  if (Object.keys(volcengineCreds).length || runtimeProviders.has("vefaas") || sandboxProviders.has("vefaas") || input.artifactProvider === "tos") {
    identities.volcengine = {
      provider: "volcengine",
      label: "Volcengine",
      identity_type: "aksk",
      credential_source: "provider_credentials.vefaas",
      region: stringValue(volcengineCreds.VEFAAS_REGION) || "cn-beijing",
      services: compact([
        runtimeProviders.has("vefaas") ? "runtime:vefaas" : "",
        sandboxProviders.has("vefaas") ? "sandbox:vefaas" : "",
        input.artifactProvider === "tos" || Object.keys(volcengineCreds).length ? "storage:tos" : ""
      ]),
      configured: Boolean(stringValue(volcengineCreds.VOLCENGINE_ACCESS_KEY) && stringValue(volcengineCreds.VOLCENGINE_SECRET_KEY))
    };
  }
  const daytonaCreds = recordValue(credentials.daytona);
  if (Object.keys(daytonaCreds).length || sandboxProviders.has("daytona")) {
    identities.daytona = {
      provider: "daytona",
      label: "Daytona",
      identity_type: "api_key",
      credential_source: "provider_credentials.daytona",
      region: "global",
      services: ["sandbox:daytona"],
      configured: Boolean(stringValue(daytonaCreds.DAYTONA_SERVER_URL) && stringValue(daytonaCreds.DAYTONA_API_KEY))
    };
  }
  const aliyunCreds = recordValue(credentials.aliyun ?? credentials.alibaba_cloud);
  if (Object.keys(aliyunCreds).length || runtimeProviders.has("aliyun_fc") || sandboxProviders.has("aliyun_fc") || input.artifactProvider === "oss") {
    identities.aliyun = {
      provider: "aliyun",
      label: "Aliyun",
      identity_type: "aksk",
      credential_source: Object.keys(recordValue(credentials.aliyun)).length ? "provider_credentials.aliyun" : "provider_credentials.alibaba_cloud",
      region: stringValue(aliyunCreds.ALIYUN_REGION ?? aliyunCreds.region) || "cn-hangzhou",
      services: compact([
        runtimeProviders.has("aliyun_fc") ? "runtime:aliyun_fc" : "",
        sandboxProviders.has("aliyun_fc") ? "sandbox:aliyun_fc" : "",
        input.artifactProvider === "oss" || Object.keys(aliyunCreds).length ? "storage:oss" : ""
      ]),
      configured: Boolean(
        stringValue(aliyunCreds.ALIYUN_ACCESS_KEY_ID ?? aliyunCreds.access_key_id ?? aliyunCreds.ak) &&
        stringValue(aliyunCreds.ALIYUN_ACCESS_KEY_SECRET ?? aliyunCreds.access_key_secret ?? aliyunCreds.sk)
      )
    };
  }
  addFutureProvider(identities, "aws", credentials, ["aws"], "AWS", "storage:s3", "runtime:lambda");
  addFutureProvider(identities, "gcp", credentials, ["gcp"], "Google Cloud", "storage:gcs", "runtime:cloud_functions");
  return identities;
}

function providerSet(provider: string | undefined, pools: Array<{ provider?: string }> | undefined) {
  const values = new Set<string>();
  if (provider) values.add(provider);
  for (const pool of pools ?? []) {
    if (pool.provider) values.add(String(pool.provider));
  }
  return values;
}

function addFutureProvider(
  identities: Record<string, JsonRecord>,
  key: string,
  credentials: JsonRecord,
  aliases: string[],
  label: string,
  storageService: string,
  runtimeService: string
) {
  const sourceKey = aliases.find((alias) => Object.keys(recordValue(credentials[alias])).length);
  if (!sourceKey) return;
  const source = recordValue(credentials[sourceKey]);
  identities[key] = {
    provider: key,
    label,
    identity_type: key === "gcp" ? "service_account" : "aksk",
    credential_source: `provider_credentials.${sourceKey}`,
    region: stringValue(source.region ?? source.REGION ?? source.AWS_REGION ?? source.GCP_REGION),
    services: [runtimeService, storageService],
    configured: true
  };
}

function compact(values: string[]) {
  return values.filter(Boolean);
}

function recordValue(value: unknown): JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function stringValue(value: unknown) {
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

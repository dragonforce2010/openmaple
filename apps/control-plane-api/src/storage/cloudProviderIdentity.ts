import type { JsonRecord } from "../types";

type IdentityInput = {
  providerCredentials?: JsonRecord;
  runtimeProvider?: string;
  sandboxProvider?: string;
};

export function cloudProviderIdentities(input: IdentityInput) {
  const credentials = recordValue(input.providerCredentials);
  const identities: Record<string, JsonRecord> = {};
  const volcengineCreds = recordValue(credentials.vefaas);
  if (Object.keys(volcengineCreds).length || input.runtimeProvider === "vefaas" || input.sandboxProvider === "vefaas") {
    identities.volcengine = {
      provider: "volcengine",
      label: "Volcengine",
      identity_type: "aksk",
      credential_source: "provider_credentials.vefaas",
      region: stringValue(volcengineCreds.VEFAAS_REGION) || "cn-beijing",
      services: compact([
        input.runtimeProvider === "vefaas" ? "runtime:vefaas" : "",
        input.sandboxProvider === "vefaas" ? "sandbox:vefaas" : "",
        "storage:tos"
      ]),
      configured: Boolean(stringValue(volcengineCreds.VOLCENGINE_ACCESS_KEY) && stringValue(volcengineCreds.VOLCENGINE_SECRET_KEY))
    };
  }
  addFutureProvider(identities, "alibaba_cloud", credentials, ["alibaba_cloud", "aliyun"], "Alibaba Cloud", "storage:oss", "runtime:fc");
  addFutureProvider(identities, "aws", credentials, ["aws"], "AWS", "storage:s3", "runtime:lambda");
  addFutureProvider(identities, "gcp", credentials, ["gcp"], "Google Cloud", "storage:gcs", "runtime:cloud_functions");
  return identities;
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

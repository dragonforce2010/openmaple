import type { JsonRecord } from "../types";

export function safeTenantMetadata(metadata: JsonRecord) {
  return {
    ...metadata,
    cloud_providers: safeTenantCloudProviders(metadata.cloud_providers)
  };
}

export function safeTenantCloudProviders(value: unknown) {
  const providers = recordValue(value);
  return Object.fromEntries(
    Object.entries(providers).map(([key, provider]) => [key, safeTenantCloudProvider(provider)])
  );
}

export function safeTenantCloudProvider(value: unknown) {
  const {
    credentials: _credentials,
    secret_cipher: _secretCipher,
    credential_ciphertext: _credentialCiphertext,
    credentials_ciphertext: _credentialsCiphertext,
    ...safe
  } = recordValue(value);
  return safe;
}

function recordValue(value: unknown): JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as JsonRecord) : {};
}

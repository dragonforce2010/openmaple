import type { JsonRecord } from "../../types";

export function cloudProviderIdentityNames(value: unknown) {
  const identities = typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, JsonRecord>) : {};
  return Object.values(identities).map((identity) => String(identity.label || identity.provider || "").trim()).filter(Boolean).join(", ");
}

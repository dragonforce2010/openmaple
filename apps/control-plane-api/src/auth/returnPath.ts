export function safeWebReturnPath(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!raw || raw.length > 2000 || raw.startsWith("//") || raw.includes("\\") || /[\x00-\x1f\x7f]/.test(raw)) return "";
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) return "";
  try {
    const url = new URL(raw, "https://maple.local");
    return url.origin === "https://maple.local" ? `${url.pathname}${url.search}${url.hash}` : "";
  } catch {
    return "";
  }
}

export function encodeStatePart(value: string) {
  return Buffer.from(value, "utf8").toString("base64url");
}

export function decodeStatePart(value: string) {
  try {
    return Buffer.from(value, "base64url").toString("utf8");
  } catch {
    return "";
  }
}

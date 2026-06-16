import type { JsonRecord } from "../types";

// Uploads land under the sandbox working directory (always writable + the agent's cwd). Older
// runtimes also expose them at /mnt/session/uploads, so we point the agent at the relative path
// first and name the /mnt path as a fallback — whichever the runtime provides.
const WORKSPACE_UPLOAD_DIR = ".session/uploads";
const LEGACY_UPLOAD_ROOT = "/mnt/session/uploads";

// Front-end sends only the user's text; the platform owns where uploads live. Prepend a
// machine-readable manifest of this session's files (sandbox paths, not TOS URLs) so the agent
// knows they exist and can Read/Bash them. Whether an image is *understood* depends on the
// agent's model — we only make the file available and named.
export function withSessionResourcesPrompt(session: JsonRecord, text: string) {
  const resources = Array.isArray((session.metadata as JsonRecord)?.resources) ? ((session.metadata as JsonRecord).resources as JsonRecord[]) : [];
  const files = resources.filter((resource) => resource.type === "file" && resource.file_id);
  if (!files.length) return text;
  const lines = files.map((file) => {
    const rel = String(file.mount_path || "").replace(/^\/+/, "");
    const mediaType = file.media_type ? ` (${file.media_type})` : "";
    const size = typeof file.bytes === "number" ? `, ${file.bytes} bytes` : "";
    return `- ${WORKSPACE_UPLOAD_DIR}/${rel} (or ${LEGACY_UPLOAD_ROOT}/${rel})${mediaType}${size}`;
  });
  return [
    "The user attached the following file(s) to this session. They are in your working directory; read them with the relative path (fall back to the /mnt path if the relative one is missing):",
    ...lines,
    "Read or process them with your tools as needed.",
    "",
    text
  ].join("\n");
}

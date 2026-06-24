import type { JsonRecord } from "../types";
import { getMemoryStore } from "../store";

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
  const memoryStores = resources.filter((resource) => resource.type === "memory_store" && resource.memory_store_id);
  if (!files.length && !memoryStores.length) return text;
  const sections: string[] = [];
  if (files.length) {
    const lines = files.map((file) => {
    const rel = String(file.mount_path || "").replace(/^\/+/, "");
    const mediaType = file.media_type ? ` (${file.media_type})` : "";
    const size = typeof file.bytes === "number" ? `, ${file.bytes} bytes` : "";
    return `- ${WORKSPACE_UPLOAD_DIR}/${rel} (or ${LEGACY_UPLOAD_ROOT}/${rel})${mediaType}${size}`;
    });
    sections.push([
      "The user attached the following file(s) to this session. They are in your working directory; read them with the relative path (fall back to the /mnt path if the relative one is missing):",
      ...lines,
      "Read or process them with your tools as needed."
    ].join("\n"));
  }
  if (memoryStores.length) {
    const lines = memoryStores.map((resource) => {
      const store = getMemoryStore(String(resource.memory_store_id)) as JsonRecord | null;
      const name = store ? String(store.name || store.id) : String(resource.memory_store_id);
      const access = String(resource.access || "read_write") === "read_only" ? "read_only" : "read_write";
      const instructions = resource.instructions ? ` Instructions: ${String(resource.instructions)}` : "";
      return `- ${name} (${resource.memory_store_id}, access=${access}).${instructions}`;
    });
    sections.push([
      "The user attached the following persistent memory store(s). Search them with memory_search. Write only to stores with access=read_write using memory_write.",
      ...lines
    ].join("\n"));
  }
  return [
    ...sections,
    "",
    text
  ].join("\n");
}

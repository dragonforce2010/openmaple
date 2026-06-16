import { homedir } from "node:os";
import { join, resolve } from "node:path";

export const dataDir = process.env.MAPLE_DATA_DIR ? resolve(process.env.MAPLE_DATA_DIR) : join(process.cwd(), ".managed-agents");

export const sessionsDir = join(dataDir, "sessions");

export const secretsDir = join(dataDir, "secrets");

export const filesDir = join(dataDir, "files");

export function skillRoot() {
  return process.env.MAPLE_SKILLS_ROOT ? resolve(process.env.MAPLE_SKILLS_ROOT) : join(homedir(), ".agents", "skills");
}

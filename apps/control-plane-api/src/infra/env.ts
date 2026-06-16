import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export type ProjectEnvLoadResult = {
  path: string;
  loaded: string[];
  skipped: string[];
};

export function loadProjectEnv(options: { cwd?: string } = {}): ProjectEnvLoadResult {
  const envPath = resolve(options.cwd || process.cwd(), ".env");
  const result: ProjectEnvLoadResult = { path: envPath, loaded: [], skipped: [] };
  if (!existsSync(envPath)) return result;

  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const parsed = parseEnvLine(line);
    if (!parsed) continue;
    if (process.env[parsed.key] !== undefined) {
      result.skipped.push(parsed.key);
      continue;
    }
    process.env[parsed.key] = parsed.value;
    result.loaded.push(parsed.key);
  }
  return result;
}

function parseEnvLine(line: string) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;
  const normalized = trimmed.startsWith("export ") ? trimmed.slice("export ".length).trim() : trimmed;
  const separator = normalized.indexOf("=");
  if (separator <= 0) return null;
  const key = normalized.slice(0, separator).trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) return null;
  return { key, value: unquote(normalized.slice(separator + 1).trim()) };
}

function unquote(value: string) {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

loadProjectEnv();

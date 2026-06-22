import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse as parseYaml } from "yaml";

export type ProjectEnvLoadResult = {
  path: string;
  config_path?: string;
  loaded: string[];
  skipped: string[];
};

export function loadProjectEnv(options: { cwd?: string } = {}): ProjectEnvLoadResult {
  const cwd = options.cwd || process.cwd();
  const envPath = resolve(cwd, ".env");
  const configPath = resolve(cwd, process.env.MAPLE_CONFIG || "maple.config.yaml");
  const result: ProjectEnvLoadResult = { path: envPath, config_path: configPath, loaded: [], skipped: [] };
  const yamlKeys = loadYamlEnv(configPath, result);
  if (!existsSync(envPath)) return result;

  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const parsed = parseEnvLine(line);
    if (!parsed) continue;
    setEnv(parsed.key, parsed.value, result, yamlKeys);
  }
  return result;
}

function loadYamlEnv(configPath: string, result: ProjectEnvLoadResult) {
  const loaded = new Set<string>();
  if (!existsSync(configPath)) return loaded;
  const parsed = parseYaml(readFileSync(configPath, "utf8")) as unknown;
  const record = typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  const env = yamlEnvRecord(record.env ?? record.environment);
  for (const [key, value] of Object.entries(env)) {
    if (setEnv(key, value, result)) loaded.add(key);
  }
  return loaded;
}

function yamlEnvRecord(value: unknown) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(key))
      .map(([key, item]) => [key, item == null ? "" : String(item)])
  );
}

function setEnv(key: string, value: string, result: ProjectEnvLoadResult, overrideKeys?: Set<string>) {
  if (process.env[key] !== undefined && !overrideKeys?.has(key)) {
    if (!result.skipped.includes(key)) result.skipped.push(key);
    return false;
  }
  process.env[key] = value;
  if (overrideKeys?.has(key)) {
    overrideKeys.delete(key);
    const existing = result.loaded.indexOf(key);
    if (existing >= 0) result.loaded.splice(existing, 1);
  }
  result.loaded.push(key);
  return true;
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

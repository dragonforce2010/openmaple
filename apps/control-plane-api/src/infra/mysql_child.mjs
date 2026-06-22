import { existsSync, readFileSync } from "node:fs";
import mysql from "mysql2/promise";

const tableInfoCache = new Map();

export function mysqlConnectionConfig() {
  return {
    host: env("MAPLE_MYSQL_HOST", "MYSQL_HOST", "127.0.0.1"),
    port: Number(env("MAPLE_MYSQL_PORT", "MYSQL_PORT", "3306")),
    database: env("MAPLE_MYSQL_DATABASE", "MYSQL_DATABASE", "maple"),
    user: env("MAPLE_MYSQL_USER", "MYSQL_USER", "root"),
    password: env("MAPLE_MYSQL_PASSWORD", "MYSQL_PASSWORD", ""),
    timezone: "Z",
    charset: "utf8mb4",
    connectTimeout: Number(env("MAPLE_MYSQL_CONNECT_TIMEOUT_MS", "MYSQL_CONNECT_TIMEOUT_MS", "8000"))
  };
}

// executor is a mysql2 connection OR pool — both expose .execute(); transactions must pass a dedicated connection
export async function runOp(executor, input) {
  if (input.op === "query") return execute(executor, input.mode, input.sql, input.params || []);
  if (input.op === "script") {
    const results = [];
    for (const query of input.queries || []) {
      results.push(await execute(executor, query.mode || "run", query.sql, query.params || []));
    }
    return results.at(-1) ?? { changes: 0 };
  }
  if (input.op === "transaction") {
    await executor.beginTransaction();
    try {
      const results = [];
      for (const query of input.queries || []) {
        results.push(await execute(executor, query.mode || "run", query.sql, query.params || []));
      }
      await executor.commit();
      return results.at(-1) ?? { changes: 0 };
    } catch (error) {
      await executor.rollback();
      throw error;
    }
  }
  throw new Error(`Unsupported MySQL op: ${input.op}`);
}

// legacy one-shot path: only runs when this file is executed directly as an execFileSync helper
if (process.argv[1] && process.argv[1].endsWith("mysql_child.mjs")) {
  loadProjectEnv();
  const payload = JSON.parse(readFileSync(0, "utf8") || "{}");
  const connection = await mysql.createConnection(mysqlConnectionConfig());
  try {
    const value = await runOp(connection, payload);
    process.stdout.write(JSON.stringify({ ok: true, value }));
  } catch (error) {
    process.stdout.write(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }));
  } finally {
    await connection.end();
  }
}

async function execute(connection, mode, sql, params) {
  const translated = translateSql(sql);
  if (translated.kind === "table_info") {
    let rows = tableInfoCache.get(translated.table);
    if (!rows) {
      [rows] = await connection.execute(
        "SELECT COLUMN_NAME AS name FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION",
        [translated.table]
      );
      tableInfoCache.set(translated.table, rows);
    }
    return mode === "get" ? rows[0] ?? null : rows;
  }

  try {
    const [rows] = await connection.execute(translated.sql, normalizeParams(params));
    invalidateTableInfoCache(translated.sql);
    if (mode === "get") return Array.isArray(rows) ? rows[0] ?? null : null;
    if (mode === "all") return Array.isArray(rows) ? rows : [];
    return {
      changes: Number(rows?.affectedRows ?? 0),
      insertId: rows?.insertId ?? undefined
    };
  } catch (error) {
    if (isIgnorableDdlError(translated.sql, error)) {
      invalidateTableInfoCache(translated.sql);
      return { changes: 0 };
    }
    throw error;
  }
}

function invalidateTableInfoCache(sql) {
  const table =
    /^CREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?\s+`?([A-Za-z_][A-Za-z0-9_]*)`?/i.exec(sql)?.[1] ||
    /^ALTER\s+TABLE\s+`?([A-Za-z_][A-Za-z0-9_]*)`?/i.exec(sql)?.[1];
  if (table) tableInfoCache.delete(table);
}

function translateSql(sql) {
  const trimmed = sql.trim();
  const pragma = /^PRAGMA\s+table_info\(([^)]+)\)$/i.exec(trimmed);
  if (pragma) return { kind: "table_info", table: stripIdentifier(pragma[1]) };

  let next = trimmed
    .replace(/\bINSERT\s+OR\s+IGNORE\b/gi, "INSERT IGNORE")
    .replace(/\bCREATE\s+UNIQUE\s+INDEX\s+IF\s+NOT\s+EXISTS\b/gi, "CREATE UNIQUE INDEX")
    .replace(/\bCREATE\s+INDEX\s+IF\s+NOT\s+EXISTS\b/gi, "CREATE INDEX");

  if (/^CREATE\s+TABLE\b/i.test(next)) next = translateCreateTable(next);
  next = translateAlterAddColumn(next);
  return { kind: "sql", sql: next };
}

function translateCreateTable(sql) {
  return sql
    .replace(/\b([A-Za-z_][A-Za-z0-9_]*)\s+TEXT\b/gi, (_all, column) => `${column} ${columnType(column)}`)
    .split("\n")
    .map((line) => {
      const match = /^(\s*)([A-Za-z_][A-Za-z0-9_]*)\s+TEXT(\s+[^,]*)?(,?)\s*$/.exec(line);
      if (!match) return line;
      const [, indent, column, rest, comma] = match;
      return `${indent}${column} ${columnType(column)}${rest || ""}${comma}`;
    })
    .join("\n");
}

function translateAlterAddColumn(sql) {
  return sql.replace(/\bADD\s+COLUMN\s+([A-Za-z_][A-Za-z0-9_]*)\s+TEXT\b/gi, (_all, column) => `ADD COLUMN ${column} ${columnType(column)}`);
}

function columnType(column) {
  if (
    /(^|_)json$/.test(column) ||
    [
      "description",
      "content",
      "input_json",
      "output_json",
      "config_json",
      "agent_snapshot_json",
      "metadata_json",
      "template_json",
      "manifest_json",
      "bundle_json",
      "secret_cipher",
      "key_ciphertext",
      "api_key_ciphertext"
    ].includes(column)
  ) {
    return "LONGTEXT";
  }
  if (["workspace_path", "source_path", "mcp_server_url", "base_url", "invoke_url", "object_key", "public_url"].includes(column)) return "VARCHAR(1024)";
  if (/(^|_)at$/.test(column) || ["expires_at", "used_at", "processed_at", "completed_at", "last_seen_at", "last_used_at"].includes(column)) {
    return "VARCHAR(40)";
  }
  return "VARCHAR(191)";
}

function normalizeParams(params) {
  return params.map((value) => {
    if (value === undefined) return null;
    if (typeof value === "boolean") return value ? 1 : 0;
    return value;
  });
}

function isIgnorableDdlError(sql, error) {
  const code = error?.code || "";
  if (/^CREATE\s+(UNIQUE\s+)?INDEX\b/i.test(sql) && code === "ER_DUP_KEYNAME") return true;
  if (/\bADD\s+COLUMN\b/i.test(sql) && code === "ER_DUP_FIELDNAME") return true;
  return false;
}

function stripIdentifier(value) {
  return String(value).trim().replace(/^`|`$/g, "");
}

export function env(...keysAndDefault) {
  const fallback = keysAndDefault.at(-1);
  for (const key of keysAndDefault.slice(0, -1)) {
    if (process.env[key]) return process.env[key];
  }
  return fallback;
}

export function loadProjectEnv() {
  const envPath = new URL("../.env", import.meta.url);
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const parsed = parseEnvLine(line);
    if (parsed && process.env[parsed.key] === undefined) process.env[parsed.key] = parsed.value;
  }
}

function parseEnvLine(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;
  const normalized = trimmed.startsWith("export ") ? trimmed.slice("export ".length).trim() : trimmed;
  const separator = normalized.indexOf("=");
  if (separator <= 0) return null;
  const key = normalized.slice(0, separator).trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) return null;
  return { key, value: unquote(normalized.slice(separator + 1).trim()) };
}

function unquote(value) {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) return value.slice(1, -1);
  return value;
}

import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import { perfTraceDbEnabled, traceSync } from "../perfTrace";

type QueryMode = "run" | "get" | "all";

type Query = {
  mode: QueryMode;
  sql: string;
  params: unknown[];
};

type MysqlStatement = {
  get: (...params: unknown[]) => unknown;
  all: (...params: unknown[]) => unknown[];
  run: (...params: unknown[]) => unknown;
};

type MysqlDatabase = {
  exec: (sql: string) => unknown;
  prepare: (sql: string) => MysqlStatement;
  transaction: <T extends (...args: never[]) => unknown>(fn: T) => T;
  pragma: (_sql: string) => unknown;
  runAsync: (sql: string, params: unknown[]) => Promise<void>;
};

const helperPath = join(dirname(fileURLToPath(import.meta.url)), "mysql_child.mjs");

export function createMysqlDatabase(): MysqlDatabase {
  let transactionQueries: Query[] | null = null;

  const database: MysqlDatabase = {
    exec(sql: string) {
      const queries = splitStatements(sql).map((statement) => ({ mode: "run" as const, sql: statement, params: [] }));
      if (transactionQueries) {
        transactionQueries.push(...queries);
        return { changes: 0 };
      }
      return traceSync(perfTraceDbEnabled(), "db.transaction", { statements: queries.length }, () => callMysql({ op: "transaction", queries }));
    },
    prepare(sql: string) {
      const statementSql = sql.trim();
      return {
        get: (...params: unknown[]) => execute("get", statementSql, params),
        all: (...params: unknown[]) => execute("all", statementSql, params) as unknown[],
        run: (...params: unknown[]) => execute("run", statementSql, params)
      };
    },
    transaction<T extends (...args: never[]) => unknown>(fn: T): T {
      return ((...args: never[]) => {
        if (transactionQueries) throw new Error("Nested MySQL transactions are not supported.");
        transactionQueries = [];
        try {
          const result = fn(...args);
          const queries = transactionQueries;
          transactionQueries = null;
          traceSync(perfTraceDbEnabled(), "db.transaction", { statements: queries.length }, () => callMysql({ op: "transaction", queries }));
          return result;
        } catch (error) {
          transactionQueries = null;
          throw error;
        }
      }) as T;
    },
    pragma() {
      return null;
    },
    async runAsync(sql: string, params: unknown[]) {
      if (transactionQueries) throw new Error("runAsync is not allowed inside a transaction.");
      await callMysqlAsync({ op: "query", mode: "run", sql: sql.trim(), params });
    }
  };

  function execute(mode: QueryMode, sql: string, params: unknown[]) {
    if (transactionQueries) {
      if (mode !== "run") throw new Error("MySQL transaction reads are not supported in the sync adapter.");
      transactionQueries.push({ mode, sql, params });
      return { changes: 0 };
    }
    return traceSync(perfTraceDbEnabled(), "db.query", queryTraceMetadata(mode, sql), () => callMysql({ op: "query", mode, sql, params }));
  }

  return database;
}

function queryTraceMetadata(mode: QueryMode, sql: string) {
  const compact = sql.replace(/\s+/g, " ").trim();
  const op = compact.split(" ")[0]?.toUpperCase() || "UNKNOWN";
  const tableMatch = compact.match(/\b(?:FROM|INTO|UPDATE|JOIN)\s+`?([a-zA-Z0-9_]+)`?/i);
  return {
    mode,
    op,
    table: tableMatch?.[1] || "",
    sql_length: compact.length
  };
}

const workerPath = join(dirname(fileURLToPath(import.meta.url)), "mysql_worker.mjs");
const SAB_CAPACITY = Number(process.env.MAPLE_MYSQL_SAB_BYTES || String(128 * 1024 * 1024));
const decoder = new TextDecoder();

let sharedWorker: Worker | null = null;
let sharedSab: SharedArrayBuffer | null = null;
let sharedControl: Int32Array | null = null;

type PendingAsync = { resolve: (value: unknown) => void; reject: (error: Error) => void };
const pendingAsync = new Map<number, PendingAsync>();
let asyncSeq = 0;

function rejectAllPendingAsync(error: Error) {
  for (const pending of pendingAsync.values()) pending.reject(error);
  pendingAsync.clear();
}

function ensureWorker() {
  if (sharedWorker && sharedSab && sharedControl) return;
  const worker = new Worker(workerPath);
  worker.unref(); // a pending DB worker must not keep the process alive on shutdown
  worker.on("error", (error) => {
    console.error("[mysql worker] fatal error, respawning on next query:", error);
    sharedWorker = null;
    sharedSab = null;
    sharedControl = null;
    rejectAllPendingAsync(error instanceof Error ? error : new Error(String(error)));
  });
  worker.on("exit", () => {
    rejectAllPendingAsync(new Error("MySQL worker exited"));
  });
  worker.on("message", (message: { asyncId?: number; ok?: boolean; value?: unknown; error?: string }) => {
    // readiness ping (no asyncId) is ignored; sync results come via Atomics on the SAB
    if (message?.asyncId === undefined) return;
    const pending = pendingAsync.get(message.asyncId);
    if (!pending) return;
    pendingAsync.delete(message.asyncId);
    if (message.ok) pending.resolve(message.value);
    else pending.reject(new Error(message.error || "MySQL async query failed."));
  });
  sharedWorker = worker;
  sharedSab = new SharedArrayBuffer(SAB_CAPACITY);
  sharedControl = new Int32Array(sharedSab, 0, 2);
}

// Async write channel: posts to the worker WITHOUT blocking the event loop on Atomics.wait.
// For fire-and-forget appends (session_events) so a streamed callback can return 202 immediately
// instead of stalling the Node main thread on a ~0.5s remote INSERT. Reads/transactions/status
// writes stay on the synchronous path for strong consistency.
export function callMysqlAsync(payload: unknown): Promise<unknown> {
  if (process.env.MAPLE_MYSQL_FORCE_HELPER === "true") {
    try {
      return Promise.resolve(callMysqlHelper(payload));
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
  }
  ensureWorker();
  const asyncId = ++asyncSeq;
  return new Promise((resolve, reject) => {
    pendingAsync.set(asyncId, { resolve, reject });
    sharedWorker!.postMessage({ asyncId, payload });
  });
}

// A persistent worker holds a mysql2 connection pool; the main thread blocks on Atomics.wait
// for each query. This keeps the synchronous db API but removes per-query process spawn (~200ms)
// and remote-connection setup (~200ms), turning ~0.4s/query into a single pooled round-trip.
function callMysql(payload: unknown) {
  if (process.env.MAPLE_MYSQL_FORCE_HELPER === "true") return callMysqlHelper(payload);
  ensureWorker();
  const control = sharedControl!;
  const sab = sharedSab!;
  Atomics.store(control, 0, 0);
  Atomics.store(control, 1, 0);
  sharedWorker!.postMessage({ sab, payload });
  const timeoutMs = Number(process.env.MAPLE_MYSQL_HELPER_TIMEOUT_MS || "15000");
  const waited = Atomics.wait(control, 0, 0, timeoutMs);
  if (waited === "timed-out") throw new Error(`MySQL worker timed out after ${timeoutMs}ms`);
  const length = Atomics.load(control, 1);
  const bytes = new Uint8Array(sab, 8, length);
  const result = JSON.parse(decoder.decode(bytes) || "{}") as { ok?: boolean; value?: unknown; error?: string };
  if (!result.ok) throw new Error(result.error || "MySQL query failed.");
  return result.value;
}

// legacy spawn-per-query helper, kept as a debugging fallback (MAPLE_MYSQL_FORCE_HELPER=true)
function callMysqlHelper(payload: unknown) {
  const configuredHelper = process.env.MAPLE_MYSQL_HELPER_COMMAND?.trim();
  const helperScript = process.env.MAPLE_MYSQL_HELPER_SCRIPT?.trim() || helperPath;
  const command = configuredHelper || process.execPath || "node";
  const args = [helperScript];
  const timeoutMs = Number(process.env.MAPLE_MYSQL_HELPER_TIMEOUT_MS || "15000");
  let stdout = "";
  try {
    stdout = execFileSync(command, args, {
      cwd: process.cwd(),
      encoding: "utf8",
      input: JSON.stringify(payload),
      maxBuffer: 50 * 1024 * 1024,
      timeout: timeoutMs,
      env: process.env
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`MySQL helper failed or timed out after ${timeoutMs}ms: ${message}`);
  }
  const result = JSON.parse(stdout || "{}") as { ok?: boolean; value?: unknown; error?: string };
  if (!result.ok) throw new Error(result.error || "MySQL query failed.");
  return result.value;
}

function splitStatements(sql: string) {
  return sql
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean);
}

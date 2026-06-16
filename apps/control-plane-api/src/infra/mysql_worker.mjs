import { parentPort } from "node:worker_threads";
import mysql from "mysql2/promise";
import { env, loadProjectEnv, mysqlConnectionConfig, runOp } from "./mysql_child.mjs";

loadProjectEnv();

let pool = null;
function getPool() {
  if (!pool) {
    pool = mysql.createPool({
      ...mysqlConnectionConfig(),
      waitForConnections: true,
      connectionLimit: Number(env("MAPLE_MYSQL_POOL_SIZE", "MYSQL_POOL_SIZE", "6")),
      maxIdle: Number(env("MAPLE_MYSQL_POOL_SIZE", "MYSQL_POOL_SIZE", "6")),
      idleTimeout: 60_000,
      enableKeepAlive: true,
      keepAliveInitialDelay: 10_000
    });
  }
  return pool;
}

const encoder = new TextEncoder();

// warm the pool on startup so the first real queries don't each pay a remote TLS handshake
Promise.all(
  Array.from({ length: Number(env("MAPLE_MYSQL_POOL_SIZE", "MYSQL_POOL_SIZE", "6")) }, () => getPool().query("SELECT 1").catch(() => {}))
).catch(() => {});

async function runPayload(payload) {
  const activePool = getPool();
  if (payload.op === "transaction") {
    // transactions need a dedicated connection (pool itself has no begin/commit)
    const conn = await activePool.getConnection();
    try {
      return await runOp(conn, payload);
    } finally {
      conn.release();
    }
  }
  return runOp(activePool, payload);
}

parentPort.on("message", async (message) => {
  // Async channel: no SharedArrayBuffer, result returned via postMessage. Used for
  // fire-and-forget event inserts so the main thread never blocks on Atomics.wait for them.
  if (message.asyncId !== undefined) {
    try {
      const value = await runPayload(message.payload);
      parentPort.postMessage({ asyncId: message.asyncId, ok: true, value: value ?? null });
    } catch (error) {
      parentPort.postMessage({ asyncId: message.asyncId, ok: false, error: error instanceof Error ? error.message : String(error) });
    }
    return;
  }

  // Sync channel: result written into the SharedArrayBuffer, main thread blocked on Atomics.wait.
  const { sab, payload } = message;
  const control = new Int32Array(sab, 0, 2);
  const dataOffset = 8;
  const capacity = sab.byteLength - dataOffset;
  let out;
  try {
    out = JSON.stringify({ ok: true, value: (await runPayload(payload)) ?? null });
  } catch (error) {
    out = JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }

  let bytes = encoder.encode(out);
  if (bytes.length > capacity) {
    bytes = encoder.encode(JSON.stringify({ ok: false, error: `MySQL result of ${bytes.length} bytes exceeds shared buffer capacity ${capacity}` }));
  }
  new Uint8Array(sab, dataOffset).set(bytes);
  Atomics.store(control, 1, bytes.length);
  Atomics.store(control, 0, 1);
  Atomics.notify(control, 0);
});

parentPort.postMessage({ ready: true });

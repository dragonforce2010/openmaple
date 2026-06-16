import type { JsonRecord } from "./types";

type TraceStatus = "ok" | "error";

const secretPattern = /(key|secret|token|authorization|password|ciphertext)/i;

export function perfTraceEnabled() {
  return process.env.MAPLE_PERF_TRACE === "1" || process.env.MAPLE_PERF_TRACE === "true";
}

export function perfTraceDbEnabled() {
  return perfTraceEnabled() && (process.env.MAPLE_PERF_TRACE_DB === "1" || process.env.MAPLE_PERF_TRACE_DB === "true");
}

export function traceEvent(name: string, metadata: JsonRecord = {}) {
  if (!perfTraceEnabled()) return;
  emitTrace(name, 0, "ok", metadata);
}

export function startSpan(name: string, metadata: JsonRecord = {}) {
  if (!perfTraceEnabled()) return () => undefined;
  const startedAt = performance.now();
  return (extra: JsonRecord = {}, status: TraceStatus = "ok") => {
    emitTrace(name, performance.now() - startedAt, status, { ...metadata, ...extra });
  };
}

export async function traceAsync<T>(name: string, metadata: JsonRecord, task: () => Promise<T>) {
  if (!perfTraceEnabled()) return task();
  const end = startSpan(name, metadata);
  try {
    const result = await task();
    end({}, "ok");
    return result;
  } catch (error) {
    end({ error: errorMessage(error) }, "error");
    throw error;
  }
}

export function traceSync<T>(enabled: boolean, name: string, metadata: JsonRecord, task: () => T) {
  if (!enabled) return task();
  const startedAt = performance.now();
  try {
    const result = task();
    emitTrace(name, performance.now() - startedAt, "ok", metadata);
    return result;
  } catch (error) {
    emitTrace(name, performance.now() - startedAt, "error", { ...metadata, error: errorMessage(error) });
    throw error;
  }
}

function emitTrace(name: string, durationMs: number, status: TraceStatus, metadata: JsonRecord) {
  const redacted = redact(metadata) as JsonRecord;
  console.log(JSON.stringify({
    type: "maple.perf",
    name,
    status,
    duration_ms: Number(durationMs.toFixed(2)),
    at: new Date().toISOString(),
    ...redacted
  }));
}

function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== "object") return value;
  const output: JsonRecord = {};
  for (const [key, item] of Object.entries(value as JsonRecord)) {
    output[key] = secretPattern.test(key) ? "[redacted]" : redact(item);
  }
  return output;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

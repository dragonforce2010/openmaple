import { nanoid } from "nanoid";
import type { JsonRecord, SessionEvent } from "../types";
import { scopeForParent } from "./storeAgentsEnvironments";
import { db, fromJson, now, toJson } from "./storeCore";

export function getPrimaryThread(sessionId: string) {
  return db.prepare("SELECT * FROM session_threads WHERE session_id = ? ORDER BY created_at ASC LIMIT 1").get(sessionId) as
    | JsonRecord
    | undefined;
}

export type EventScope = { workspace_id: string; tenant_id: string };

export function createSessionEvent(input: {
  session_id: string;
  thread_id?: string | null;
  type: string;
  payload: JsonRecord;
  provider_event_type?: string | null;
  scope?: EventScope;
}): SessionEvent {
  const stamp = now();
  const id = `evt_${nanoid(10)}`;
  const scope = input.scope ?? scopeForParent("sessions", input.session_id);
  db.prepare(`
    INSERT INTO session_events (id, session_id, thread_id, type, payload_json, provider_event_type, workspace_id, tenant_id, processed_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, input.session_id, input.thread_id ?? null, input.type, toJson(input.payload), input.provider_event_type ?? null, scope.workspace_id, scope.tenant_id, stamp, stamp);
  return {
    id,
    session_id: input.session_id,
    thread_id: input.thread_id ?? null,
    type: input.type,
    payload: input.payload,
    provider_event_type: input.provider_event_type ?? null,
    created_at: stamp
  };
}

const EVENT_INSERT_COLUMNS = "(id, session_id, thread_id, type, payload_json, provider_event_type, workspace_id, tenant_id, processed_at, created_at)";

type EventItem = { type: string; payload: JsonRecord; provider_event_type?: string | null };
type EventRow = { id: string; stamp: string; item: EventItem };

function buildEventRows(items: EventItem[], base: number): EventRow[] {
  // stamps increment 1ms per row so `ORDER BY created_at` keeps loop order stable
  return items.map((item, index) => ({ id: `evt_${nanoid(10)}`, stamp: new Date(base + index).toISOString(), item }));
}

function eventInsertParams(rows: EventRow[], sessionId: string, threadId: string | null, scope: EventScope): unknown[] {
  return rows.flatMap(({ id, stamp, item }) => [
    id,
    sessionId,
    threadId,
    item.type,
    toJson(item.payload),
    item.provider_event_type ?? null,
    scope.workspace_id,
    scope.tenant_id,
    stamp,
    stamp
  ]);
}

function rowsToEvents(rows: EventRow[], sessionId: string, threadId: string | null): SessionEvent[] {
  return rows.map(({ id, stamp, item }) => ({
    id,
    session_id: sessionId,
    thread_id: threadId,
    type: item.type,
    payload: item.payload,
    provider_event_type: item.provider_event_type ?? null,
    created_at: stamp
  }));
}

export function createSessionEvents(
  sessionId: string,
  threadId: string | null,
  items: EventItem[],
  scopeOverride?: EventScope
): SessionEvent[] {
  if (!items.length) return [];
  const scope = scopeOverride ?? scopeForParent("sessions", sessionId);
  // one INSERT for the whole batch — per-row inserts cost one remote MySQL RTT each
  const rows = buildEventRows(items, Date.now());
  const placeholders = rows.map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").join(", ");
  db.prepare(`INSERT INTO session_events ${EVENT_INSERT_COLUMNS} VALUES ${placeholders}`).run(...eventInsertParams(rows, sessionId, threadId, scope));
  return rowsToEvents(rows, sessionId, threadId);
}

// Per-session FIFO chain so async inserts land in the same order they were emitted, and a
// slow/failed insert can't reorder later events of the same session.
const asyncInsertChains = new Map<string, Promise<void>>();

async function insertEventRows(rows: EventRow[], sessionId: string, threadId: string | null, scope: EventScope) {
  const placeholders = rows.map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").join(", ");
  const sql = `INSERT INTO session_events ${EVENT_INSERT_COLUMNS} VALUES ${placeholders}`;
  const params = eventInsertParams(rows, sessionId, threadId, scope);
  if (!db.runAsync) {
    db.prepare(sql).run(...params);
    return;
  }
  try {
    await db.runAsync(sql, params);
  } catch {
    // one retry, then fall back to the synchronous path so rows are never lost
    // (runner.ts streamed_count reconciliation depends on every streamed event persisting)
    try {
      await db.runAsync(sql, params);
    } catch {
      db.prepare(sql).run(...params);
    }
  }
}

// Build events synchronously (id + created_at assigned now, for immediate SSE emit) but persist
// them through the async DB channel, so a streamed loop_events callback returns 202 without the
// Node main thread blocking on a ~0.5s remote INSERT.
export function createSessionEventsAsync(
  sessionId: string,
  threadId: string | null,
  scope: EventScope,
  items: EventItem[]
): SessionEvent[] {
  if (!items.length) return [];
  const rows = buildEventRows(items, Date.now());
  const previous = asyncInsertChains.get(sessionId) ?? Promise.resolve();
  const tracked: Promise<void> = previous
    .catch(() => undefined)
    .then(() => insertEventRows(rows, sessionId, threadId, scope))
    .catch((error) => console.error("[session-events async]", sessionId, error instanceof Error ? error.message : String(error)))
    .finally(() => {
      if (asyncInsertChains.get(sessionId) === tracked) asyncInsertChains.delete(sessionId);
    });
  asyncInsertChains.set(sessionId, tracked);
  return rowsToEvents(rows, sessionId, threadId);
}

// Awaits any in-flight async inserts for a session — call before end-of-turn reconciliation
// so streamed_count reflects rows that actually persisted.
export async function flushSessionEventInserts(sessionId: string) {
  const pending = asyncInsertChains.get(sessionId);
  if (pending) await pending;
}

export function listSessionEvents(sessionId: string, afterEventId?: string) {
  // unknown afterEventId → COALESCE '' keeps the predicate always-true → full list
  const rows = afterEventId
    ? db
        .prepare(
          `SELECT * FROM session_events
           WHERE session_id = ?
             AND created_at > COALESCE((SELECT created_at FROM session_events WHERE id = ? AND session_id = ?), '')
           ORDER BY created_at ASC`
        )
        .all(sessionId, afterEventId, sessionId)
    : db.prepare("SELECT * FROM session_events WHERE session_id = ? ORDER BY created_at ASC").all(sessionId);
  return rows.map((row) => {
    const item = row as JsonRecord;
    return {
      id: item.id,
      session_id: item.session_id,
      thread_id: item.thread_id,
      type: item.type,
      payload: fromJson(String(item.payload_json), {}),
      provider_event_type: item.provider_event_type,
      created_at: item.created_at
    };
  });
}

// targeted lookup for the tool-result wait loop — polling the full event list every
// 500ms cost one whole-table read per tick against the remote MySQL
export function findToolResultEvent(sessionId: string, toolUseId: string): SessionEvent | null {
  const idJson = JSON.stringify(String(toolUseId));
  const row = db
    .prepare(
      `SELECT * FROM session_events
       WHERE session_id = ?
         AND type IN ('user.custom_tool_result', 'tool_result', 'user.tool_result')
         AND (payload_json LIKE ? OR payload_json LIKE ?)
       ORDER BY created_at ASC LIMIT 1`
    )
    .get(sessionId, `%"custom_tool_use_id":${idJson}%`, `%"tool_use_id":${idJson}%`) as JsonRecord | undefined;
  if (!row) return null;
  return {
    id: String(row.id),
    session_id: String(row.session_id),
    thread_id: row.thread_id == null ? null : String(row.thread_id),
    type: String(row.type),
    payload: fromJson(String(row.payload_json), {}),
    provider_event_type: row.provider_event_type == null ? null : String(row.provider_event_type),
    created_at: String(row.created_at)
  };
}

export function createToolCall(input: {
  id?: string;
  session_id: string;
  thread_id?: string | null;
  event_id?: string | null;
  tool_name: string;
  input: JsonRecord;
  permission_policy?: string;
}) {
  const stamp = now();
  const id = input.id ?? `toolu_${nanoid(10)}`;
  const scope = scopeForParent("sessions", input.session_id);
  db.prepare(`
    INSERT INTO tool_calls
    (id, session_id, thread_id, event_id, tool_name, input_json, status, permission_policy, workspace_id, tenant_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.session_id,
    input.thread_id ?? null,
    input.event_id ?? null,
    input.tool_name,
    toJson(input.input),
    "running",
    input.permission_policy ?? "allow",
    scope.workspace_id,
    scope.tenant_id,
    stamp
  );
  return { id, status: "running", created_at: stamp };
}

export function completeToolCall(id: string, status: "completed" | "failed", output: JsonRecord) {
  const stamp = now();
  db.prepare("UPDATE tool_calls SET status = ?, output_json = ?, completed_at = ? WHERE id = ?").run(status, toJson(output), stamp, id);
}

export function listToolCalls(sessionId: string) {
  return (db.prepare("SELECT * FROM tool_calls WHERE session_id = ? ORDER BY created_at ASC").all(sessionId) as JsonRecord[]).map((row) => ({
    id: row.id,
    session_id: row.session_id,
    thread_id: row.thread_id,
    event_id: row.event_id,
    tool_name: row.tool_name,
    input: fromJson(String(row.input_json), {}),
    output: fromJson(String(row.output_json), null),
    status: row.status,
    permission_policy: row.permission_policy,
    created_at: row.created_at,
    completed_at: row.completed_at
  }));
}

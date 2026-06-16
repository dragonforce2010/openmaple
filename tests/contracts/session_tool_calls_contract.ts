import assert from "node:assert/strict";
import { mergeToolCallsFromEvents } from "../../apps/control-plane-api/src/sessions/toolCallEvents";
import type { JsonRecord, SessionEvent } from "../../apps/control-plane-api/src/types";

const toolUse = event("evt_call", "agent.tool_use", {
  id: "call_1",
  name: "bash",
  input: { command: "date +%Y年%m月%d日" },
  permission_policy: "allow"
});
const toolResult = event("evt_result", "tool.result", {
  id: "call_1",
  name: "bash",
  status: "completed",
  output: { stdout: "2026年06月15日\n", stderr: "", exit_code: 0 }
});

const derived = mergeToolCallsFromEvents("sess_contract", [], [toolUse, toolResult]);
assert.equal(derived.length, 1, "session detail must derive missing tool_calls from tool events");
assert.equal(derived[0].id, "call_1");
assert.equal(derived[0].tool_name, "bash");
assert.deepEqual(derived[0].input, { command: "date +%Y年%m月%d日" });
assert.deepEqual(derived[0].output, { stdout: "2026年06月15日\n", stderr: "", exit_code: 0 });
assert.equal(derived[0].status, "completed");
assert.equal(derived[0].event_id, "evt_call");
assert.equal(derived[0].completed_at, "2026-06-15T02:00:01.000Z");

const storedRunning = [{
  id: "call_1",
  session_id: "sess_contract",
  thread_id: "thread_1",
  event_id: "evt_call",
  tool_name: "bash",
  input: { command: "date +%Y年%m月%d日" },
  output: null,
  status: "running",
  permission_policy: "allow",
  created_at: "2026-06-15T02:00:00.000Z",
  completed_at: null
}] as JsonRecord[];
const merged = mergeToolCallsFromEvents("sess_contract", storedRunning, [toolUse, toolResult]);
assert.equal(merged[0].status, "completed", "event result must patch stale running tool_call rows");
assert.deepEqual(merged[0].output, { stdout: "2026年06月15日\n", stderr: "", exit_code: 0 });

console.log("session tool calls contract passed");

function event(id: string, type: string, payload: JsonRecord): SessionEvent {
  return {
    id,
    session_id: "sess_contract",
    thread_id: "thread_1",
    type,
    payload,
    provider_event_type: type.includes("result") ? "tool_result" : "tool_use",
    created_at: id === "evt_call" ? "2026-06-15T02:00:00.000Z" : "2026-06-15T02:00:01.000Z"
  };
}

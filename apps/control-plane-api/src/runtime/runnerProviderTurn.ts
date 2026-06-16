import { completeToolCall, createToolCall, findToolResultEvent, getSession, updateSessionStatus } from "../store";
import type { AgentConfig, JsonRecord, SessionEvent } from "../types";
import { builtInToolNames, callProvider, isBuiltInToolAllowed } from "./provider";
import { buildMessages, eventText, parseScriptedToolRequests } from "./runnerMessages";
import { executeTool } from "./runtime";
import { providerUserContentWithImages } from "./sessionResourceMessages";
import { createTextDeltaBuffer } from "./textDeltaBuffer";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const maxProviderTurns = 8;

type RecordFn = (sessionId: string, threadId: string | null, type: string, payload: JsonRecord, providerEventType?: string) => SessionEvent;
type RuntimeToolCallFn = (sessionId: string, name: string, input: JsonRecord) => Promise<{ status: string }>;

// The default execution path: drives the turn directly against the configured model and
// provisions the sandbox lazily (only when a tool runs), so an agent can be tested without a
// deployed external/veFaaS agent runtime. Extracted from runner.ts to keep that file under cap.
export async function runProviderTurn(
  deps: { record: RecordFn; runRuntimeToolCall: RuntimeToolCallFn },
  sessionId: string,
  threadId: string,
  session: NonNullable<ReturnType<typeof getSession>>,
  agent: AgentConfig,
  text: string
) {
  const { record, runRuntimeToolCall } = deps;
  const scriptedToolCalls = parseScriptedToolRequests(text);
  if (scriptedToolCalls.length) {
    const completed = [];
    for (const call of scriptedToolCalls) {
      const result = await runRuntimeToolCall(sessionId, call.name, call.input);
      completed.push(`${call.name}:${result.status}`);
    }
    const message = `Completed via Maple tool bridge: ${completed.join(", ")}`;
    record(sessionId, threadId, "agent.message_delta", { text: message, usage: {} }, "message_stop");
    record(sessionId, threadId, "agent.message", { content: [{ type: "text", text: message }], usage: {} }, "message_stop");
    updateSessionStatus(sessionId, "idle");
    record(sessionId, threadId, "session.status_idle", { reason: "end_turn", stop_reason: { type: "end_turn" } });
    return;
  }

  const messages = buildMessages(agent, await providerUserContentWithImages(session, agent, text));
  const agentTools = Array.isArray(agent.tools) ? agent.tools : [];
  for (let turn = 0; turn < maxProviderTurns; turn += 1) {
    const ownerUserId = typeof (session.metadata as JsonRecord).owner_user_id === "string" ? String((session.metadata as JsonRecord).owner_user_id) : undefined;
    const agentModelConfigId =
      typeof (session.agent_snapshot as AgentConfig).model?.config_id === "string" ? (session.agent_snapshot as AgentConfig).model.config_id : undefined;
    const workspaceId = typeof (session as JsonRecord).workspace_id === "string" ? String((session as JsonRecord).workspace_id) : undefined;
    const deltas = createTextDeltaBuffer((chunk) => {
      record(sessionId, threadId, "agent.message_delta", { text: chunk, usage: {} }, "message_delta");
    });
    const providerResult = await callProvider(messages, ownerUserId, agentModelConfigId, agentTools, { workspaceId, onTextDelta: deltas.push });
    deltas.flush();
    if (providerResult.type === "message") {
      if (!deltas.emitted) record(sessionId, threadId, "agent.message_delta", { text: providerResult.content, usage: providerResult.usage }, "message_stop");
      record(sessionId, threadId, "agent.message", { content: [{ type: "text", text: providerResult.content }], usage: providerResult.usage }, "message_stop");
      updateSessionStatus(sessionId, "idle");
      record(sessionId, threadId, "session.status_idle", { reason: "end_turn", stop_reason: { type: "end_turn" } });
      return;
    }

    messages.push({
      role: "assistant",
      content: null,
      tool_calls: providerResult.calls.map((call) => ({
        id: call.id,
        type: "function",
        function: { name: call.name, arguments: JSON.stringify(call.arguments) }
      }))
    });

    for (const call of providerResult.calls) {
      if (!builtInToolNames.has(call.name)) {
        const toolEvent = record(sessionId, threadId, "agent.custom_tool_use", { id: call.id, name: call.name, input: call.arguments, permission_policy: "allow" }, "tool_use");
        createToolCall({ id: call.id, session_id: sessionId, thread_id: threadId, event_id: toolEvent.id, tool_name: call.name, input: call.arguments, permission_policy: "allow" });
        updateSessionStatus(sessionId, "tool_waiting");
        const result = await waitForClientToolResult(sessionId, call.id);
        updateSessionStatus(sessionId, "running");
        completeToolCall(call.id, "completed", { content: result });
        messages.push({ role: "tool", tool_call_id: call.id, content: result });
        continue;
      }

      const toolEvent = record(sessionId, threadId, "agent.tool_use", { id: call.id, name: call.name, input: call.arguments, permission_policy: "allow" }, "tool_use");
      createToolCall({ id: call.id, session_id: sessionId, thread_id: threadId, event_id: toolEvent.id, tool_name: call.name, input: call.arguments, permission_policy: "allow" });

      try {
        if (!isBuiltInToolAllowed(agentTools, call.name)) throw new Error(`Tool ${call.name} is disabled by agent configuration.`);
        const output = (await executeTool(sessionId, call.name, call.arguments)) as JsonRecord;
        completeToolCall(call.id, "completed", output);
        record(sessionId, threadId, "tool.result", { id: call.id, name: call.name, status: "completed", output }, "tool_result");
        messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(output) });
      } catch (error) {
        const output = { error: error instanceof Error ? error.message : String(error) };
        completeToolCall(call.id, "failed", output);
        record(sessionId, threadId, "tool.result", { id: call.id, name: call.name, status: "failed", output }, "tool_result");
        messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(output) });
      }
    }
  }
  throw new Error(`Provider loop exceeded ${maxProviderTurns} turns`);
}

async function waitForClientToolResult(sessionId: string, toolUseId: string) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 180_000) {
    const found = findToolResultEvent(sessionId, toolUseId);
    if (found) {
      const payload = found.payload as JsonRecord;
      const matches =
        (found.type === "user.custom_tool_result" && payload.custom_tool_use_id === toolUseId) ||
        ((found.type === "tool_result" || found.type === "user.tool_result") && payload.tool_use_id === toolUseId);
      if (matches) return eventText(payload);
    }
    await wait(500);
  }
  throw new Error(`Timed out waiting for custom tool result ${toolUseId}`);
}

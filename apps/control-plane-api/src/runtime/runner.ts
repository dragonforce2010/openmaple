import { emitSessionEvent } from "../eventHub";
import {
  completeToolCall,
  createSessionEvent,
  createSessionEvents,
  createToolCall,
  flushSessionEventInserts,
  getPrimaryThread,
  getSession,
  updateSessionStatus
} from "../store";
import type { AgentConfig, JsonRecord } from "../types";
import { runExternalAgentLoop, shouldUseExternalAgentLoop } from "./agentLoopDrivers";
import { agentLoopRuntimeLabel, normalizeAgentLoop } from "./agentLoops";
import { withInjectedMcpCredentials } from "./mcpCredentialInjection";
import { builtInToolNames, isBuiltInToolAllowed } from "./provider";
import { runtimeMessageContent } from "./runnerMessages";
import { runProviderTurn } from "./runnerProviderTurn";
import { withSessionResourcesPrompt } from "./sessionResourcePrompt";
import {
  ensureSessionSandboxRuntime,
  executeTool,
  markRuntimeReady,
  runAgentLoopOnAliyunFc,
  runAgentLoopOnVefaas,
  sessionUsesAliyunFcAgentRuntime,
  sessionUsesVefaasAgentRuntime
} from "./runtime";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function record(sessionId: string, threadId: string | null, type: string, payload: JsonRecord, providerEventType?: string) {
  const event = createSessionEvent({
    session_id: sessionId,
    thread_id: threadId,
    type,
    payload,
    provider_event_type: providerEventType
  });
  emitSessionEvent(event);
  return event;
}

export async function bootstrapSession(sessionId: string) {
  const session = getSession(sessionId);
  const thread = getPrimaryThread(sessionId);
  if (!session || !thread) return;
  const threadId = String(thread.id);

  updateSessionStatus(sessionId, "bootstrapping");
  record(sessionId, threadId, "session.status_bootstrapping", {
    workspace_path: session.workspace_path,
    environment_id: session.environment_id
  });
  const loop = normalizeAgentLoop((session.agent_snapshot as AgentConfig).agent_loop);
  record(sessionId, threadId, "agent.loop_selected", {
    type: loop.type,
    label: agentLoopRuntimeLabel(loop),
    hooks: loop.hooks ?? []
  });
  const agent = session.agent_snapshot as AgentConfig;
  if (!shouldUseExternalAgentLoop(agent)) {
    updateSessionStatus(sessionId, "idle");
    record(sessionId, threadId, "session.status_idle", {
      reason: "runtime_deferred",
      runtime: { type: "deferred", provider: "provider_loop" }
    });
    // pre-warm the tool sandbox in the background so the first tool call hits a ready
    // sandbox instead of provisioning on the critical path (pool claim or cold create)
    void prefetchSessionSandbox(sessionId);
    return;
  }
  try {
    const runtime = await markRuntimeReady(sessionId);
    record(sessionId, threadId, "session.status_idle", {
      reason: "runtime_ready",
      runtime
    });
  } catch (error) {
    updateSessionStatus(sessionId, "failed");
    record(sessionId, threadId, "session.status_failed", {
      reason: "runtime_bootstrap_failed",
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

async function prefetchSessionSandbox(sessionId: string) {
  try {
    await ensureSessionSandboxRuntime(sessionId);
  } catch {
    // best-effort warm-up; the first real tool call will surface any provisioning error
  }
}

async function waitForPackageInstall(sessionId: string) {
  const deadline = Date.now() + Number(process.env.MAPLE_SANDBOX_PACKAGE_GATE_TIMEOUT_MS || 240_000);
  while (Date.now() < deadline) {
    const current = getSession(sessionId);
    if (!current || String(current.status) !== "installing_packages") return;
    await wait(200);
  }
}

export async function runUserMessage(sessionId: string, text: string) {
  // Only external/veFaaS loops actually provision a runtime during bootstrap, so only they
  // need to wait it out. Provider-loop sessions provision lazily and bootstrap just flips
  // status created->idle, so waiting is pure dispatch latency for them.
  const pending = getSession(sessionId);
  const waitsForBootstrap = pending ? shouldUseExternalAgentLoop(pending.agent_snapshot as AgentConfig) : false;
  if (waitsForBootstrap) {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const current = getSession(sessionId);
      if (!current || !["created", "bootstrapping"].includes(String(current.status))) break;
      await wait(50);
    }
  }
  // Gate the turn while the environment's packages are still installing into the sandbox, so the
  // first message doesn't run before its dependencies are importable. Probing is idempotent, so a
  // warm sandbox never enters this state; the longer window covers a real cold install.
  await waitForPackageInstall(sessionId);

  const session = getSession(sessionId);
  const thread = getPrimaryThread(sessionId);
  if (!session || !thread) return;
  const threadId = String(thread.id);
  // Front-end sends only the user's text; prepend this session's uploaded-file manifest so the
  // agent knows the files exist at /mnt/session/uploads/. No-op when the session has no uploads.
  const effectiveText = withSessionResourcesPrompt(session, text);

  updateSessionStatus(sessionId, "running");
  record(sessionId, threadId, "session.status_running", { reason: "user.message" });

  try {
    const agent = session.agent_snapshot as AgentConfig;
    // Provider loop is the default execution: it drives the turn directly against the
    // configured model and provisions the sandbox lazily (only when a tool runs), so an
    // agent can be tested without a deployed external/veFaaS agent runtime.
    if (!shouldUseExternalAgentLoop(agent)) {
      await runProviderTurn({ record, runRuntimeToolCall }, sessionId, threadId, session, agent, effectiveText);
      return;
    }

    if (sessionUsesVefaasAgentRuntime(sessionId)) {
      // runAgentLoopOnVefaas ensures the runtime itself; a second markRuntimeReady here
      // would repeat the whole ensure chain and flash the session back to idle mid-turn.
      record(sessionId, threadId, "session.status_preparing_runtime", { reason: "vefaas_agent_runtime.ensure" });
      const runtimeResult = await runAgentLoopOnVefaas(sessionId, effectiveText);
      if (runtimeResult.timings && typeof runtimeResult.timings === "object") {
        // runtime-side latency breakdown (acquire / first-event / callback posts) for profiling;
        // Session role keeps it out of the transcript while staying visible in Debug + /detail
        record(sessionId, threadId, "session.runtime_timings", runtimeResult.timings as JsonRecord);
      }
      const runtimeEvents = Array.isArray(runtimeResult.events) ? (runtimeResult.events as JsonRecord[]) : [];
      // streamed events persist via the async channel; drain it so the streamed_count prefix is
      // durable before we reconcile (otherwise a slow insert could double-write the tail)
      await flushSessionEventInserts(sessionId);
      // events up to streamed_count already arrived through the live loop_events callback
      const streamedCount = Math.min(Math.max(Number(runtimeResult.streamed_count) || 0, 0), runtimeEvents.length);
      const remaining = runtimeEvents.slice(streamedCount);
      createSessionEvents(
        sessionId,
        threadId,
        remaining.map((event) => ({
          type: "agent.external_loop_event",
          payload: { driver: "vefaas_agent_loop", event },
          provider_event_type: String(event.type || "")
        }))
      ).forEach(emitSessionEvent);
      const content = runtimeMessageContent(runtimeResult);
      record(sessionId, threadId, "agent.message_delta", { text: content, usage: runtimeResult.usage }, "message_stop");
      record(
        sessionId,
        threadId,
        "agent.message",
        { content: [{ type: "text", text: content }], usage: runtimeResult.usage },
        "message_stop"
      );
      updateSessionStatus(sessionId, "idle");
      record(sessionId, threadId, "session.status_idle", { reason: "end_turn", stop_reason: { type: "end_turn" }, runtime: "vefaas_agent_loop" });
      return;
    }
    if (sessionUsesAliyunFcAgentRuntime(sessionId)) {
      record(sessionId, threadId, "session.status_preparing_runtime", { reason: "aliyun_fc_agent_runtime.ensure" });
      const runtimeResult = await runAgentLoopOnAliyunFc(sessionId, effectiveText);
      if (runtimeResult.timings && typeof runtimeResult.timings === "object") {
        record(sessionId, threadId, "session.runtime_timings", runtimeResult.timings as JsonRecord);
      }
      const runtimeEvents = Array.isArray(runtimeResult.events) ? (runtimeResult.events as JsonRecord[]) : [];
      await flushSessionEventInserts(sessionId);
      const streamedCount = Math.min(Math.max(Number(runtimeResult.streamed_count) || 0, 0), runtimeEvents.length);
      const remaining = runtimeEvents.slice(streamedCount);
      createSessionEvents(
        sessionId,
        threadId,
        remaining.map((event) => ({
          type: "agent.external_loop_event",
          payload: { driver: "aliyun_fc_agent_loop", event },
          provider_event_type: String(event.type || "")
        }))
      ).forEach(emitSessionEvent);
      const content = runtimeMessageContent(runtimeResult);
      record(sessionId, threadId, "agent.message_delta", { text: content, usage: runtimeResult.usage }, "message_stop");
      record(
        sessionId,
        threadId,
        "agent.message",
        { content: [{ type: "text", text: content }], usage: runtimeResult.usage },
        "message_stop"
      );
      updateSessionStatus(sessionId, "idle");
      record(sessionId, threadId, "session.status_idle", { reason: "end_turn", stop_reason: { type: "end_turn" }, runtime: "aliyun_fc_agent_loop" });
      return;
    }
    await markRuntimeReady(sessionId);
    if (shouldUseExternalAgentLoop(agent)) {
      record(sessionId, threadId, "agent.external_loop_started", {
        type: normalizeAgentLoop(agent.agent_loop).type,
        workspace_path: session.workspace_path
      });
      const externalResult = await runExternalAgentLoop({
        sessionId,
        agent: withInjectedMcpCredentials(agent, String(session.workspace_id ?? "")),
        userText: effectiveText,
        workspacePath: session.workspace_path,
        onEvent: (event) => {
          record(sessionId, threadId, "agent.external_loop_event", { driver: "claude_code", event }, String(event.type || ""));
        }
      });
      record(sessionId, threadId, "agent.external_loop_completed", {
        driver: externalResult.driver,
        command: externalResult.command,
        args: externalResult.args,
        cwd: externalResult.cwd,
        duration_ms: externalResult.duration_ms,
        stderr: externalResult.stderr
      });
      record(sessionId, threadId, "agent.message_delta", { text: externalResult.message, usage: externalResult.usage }, "message_stop");
      record(
        sessionId,
        threadId,
        "agent.message",
        { content: [{ type: "text", text: externalResult.message }], usage: externalResult.usage },
        "message_stop"
      );
      updateSessionStatus(sessionId, "idle");
      record(sessionId, threadId, "session.status_idle", { reason: "end_turn", stop_reason: { type: "end_turn" }, runtime: externalResult.driver });
      return;
    }
    throw new Error("No matching agent execution path for session.");
  } catch (error) {
    updateSessionStatus(sessionId, "failed");
    record(sessionId, threadId, "session.status_failed", {
      reason: "agent_loop_failed",
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

export async function runRuntimeToolCall(sessionId: string, name: string, input: JsonRecord) {
  const session = getSession(sessionId);
  const thread = getPrimaryThread(sessionId);
  if (!session || !thread) throw new Error(`Session not found: ${sessionId}`);
  const threadId = String(thread.id);
  if (!builtInToolNames.has(name)) throw new Error(`Unknown runtime bridge tool: ${name}`);
  const agentTools = Array.isArray((session.agent_snapshot as AgentConfig).tools) ? (session.agent_snapshot as AgentConfig).tools : [];
  if (!isBuiltInToolAllowed(agentTools, name)) throw new Error(`Tool ${name} is disabled by agent configuration.`);
  const toolEvent = record(
    sessionId,
    threadId,
    "agent.tool_use",
    {
      id: `bridge_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      name,
      input,
      permission_policy: "allow"
    },
    "tool_use"
  );
  const toolCallId = String((toolEvent.payload as JsonRecord).id);
  createToolCall({
    id: toolCallId,
    session_id: sessionId,
    thread_id: threadId,
    event_id: toolEvent.id,
    tool_name: name,
    input,
    permission_policy: "allow"
  });
  try {
    const output = (await executeTool(sessionId, name, input)) as JsonRecord;
    completeToolCall(toolCallId, "completed", output);
    record(sessionId, threadId, "tool.result", { id: toolCallId, name, status: "completed", output }, "tool_result");
    return { ok: true, status: "completed", tool_call_id: toolCallId, output };
  } catch (error) {
    const output = { error: error instanceof Error ? error.message : String(error) };
    completeToolCall(toolCallId, "failed", output);
    record(sessionId, threadId, "tool.result", { id: toolCallId, name, status: "failed", output }, "tool_result");
    return { ok: false, status: "failed", tool_call_id: toolCallId, output };
  }
}

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname } from "node:path";
import { traceAsync } from "../perfTrace";
import {
  getSession,
  listMemories,
  listMemoryStores,
  updateSessionMetadata,
  updateSessionStatus,
  upsertMemory
} from "../store";
import type { JsonRecord } from "../types";
import { runDockerCommand } from "./dockerRuntime";
import { readE2BFile, runE2BCommand, syncE2BWorkspaceToHost, writeE2BFile } from "./e2bRuntime";
import { assertSafeWorkspacePath, isSandboxAbsolutePath, safeSandboxReadPath } from "./runtimeCommon";
import { ensureSessionRuntime, ensureSessionSandboxRuntime } from "./runtimeManager";
import type { RuntimeInfo } from "./runtimeTypes";
import { invokeAliyunFc } from "./aliyunFcRuntime";
import { invokeVefaas } from "./vefaasAgentRuntime";
import {
  listVefaasSandboxFiles,
  readVefaasSandboxFile,
  runVefaasSandboxCommand,
  syncVefaasSandboxWorkspaceToHost,
  writeVefaasSandboxFile
} from "./vefaasSandboxRuntime";
import { toVefaasSandboxMountedPath } from "./vefaasSandboxHelpers";

const readOnlyBashCommands = new Set(["date", "pwd", "whoami", "id", "uname", "hostname", "ls", "which", "type"]);

export async function markRuntimeReady(sessionId: string) {
  return traceAsync("runtime.mark_ready", { session_id: sessionId }, async () => {
    const runtime = await ensureSessionRuntime(sessionId);
    updateSessionStatus(sessionId, "idle");
    return runtime;
  });
}

export async function executeTool(sessionId: string, name: string, input: JsonRecord) {
  return traceAsync("runtime.tool", { session_id: sessionId, tool: name }, async () => {
    const session = getSession(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);
    const runtime = await ensureSessionSandboxRuntime(sessionId);
    try {
      return await runToolWithRuntime(session, runtime, name, input);
    } catch (error) {
      if (!shouldRetryVefaasSandboxTool(runtime, error)) throw error;
      return traceAsync("runtime.tool_retry", { session_id: sessionId, tool: name, reason: "stale_vefaas_sandbox" }, async () => {
        updateSessionMetadata(sessionId, { runtime: null, sandbox_runtime: null });
        const refreshedRuntime = await ensureSessionSandboxRuntime(sessionId);
        return runToolWithRuntime(session, refreshedRuntime, name, input);
      });
    }
  });
}

async function runToolWithRuntime(session: JsonRecord, runtime: RuntimeInfo, name: string, input: JsonRecord) {
  switch (name) {
    case "bash":
      return runBash(runtime, String(input.command || ""));
    case "read_file":
      return readWorkspaceFile(String(session.workspace_path), String(input.path || ""), runtime);
    case "write_file":
      return writeWorkspaceFile(String(session.workspace_path), String(input.path || ""), String(input.content || ""), runtime);
    case "list_files":
      return listFiles(String(session.workspace_path), runtime, String(input.path || "."));
    case "grep":
      return grep(String(session.workspace_path), runtime, String(input.pattern || ""), String(input.path || "."));
    case "memory_search":
      return memorySearch(input);
    case "memory_write":
      return memoryWrite(input);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

function shouldRetryVefaasSandboxTool(runtime: RuntimeInfo, error: unknown) {
  if (runtime.type !== "vefaas_sandbox") return false;
  const message = error instanceof Error ? error.message : String(error);
  return /veFaaS sandbox gateway error|fetch failed|Failed to prepare veFaaS sandbox workspace/i.test(message);
}

async function runBash(runtime: RuntimeInfo, command: string) {
  if (!command.trim()) throw new Error("Missing bash command");
  if (runtime.type === "vefaas") return invokeVefaas(runtime, "tool", { tool: "bash", input: { command } });
  if (runtime.type === "aliyun_fc" || runtime.type === "aliyun_fc_sandbox") return invokeAliyunFc(runtime, "tool", { tool: "bash", input: { command } });
  if (runtime.type === "vefaas_sandbox") {
    const result = await runVefaasSandboxCommand(runtime, command, 120_000);
    await syncVefaasSandboxWorkspaceToHost(runtime);
    return result;
  }
  if (runtime.type === "e2b") {
    const result = await runE2BCommand(runtime, command, 120_000);
    if (shouldSyncWorkspaceAfterBash(command)) await syncE2BWorkspaceToHost(runtime);
    return result;
  }
  return runDockerCommand(runtime.container_id, command, 120_000);
}

function shouldSyncWorkspaceAfterBash(command: string) {
  return !isReadOnlyBashCommand(command);
}

function isReadOnlyBashCommand(command: string) {
  const trimmed = command.trim();
  if (!trimmed || /[<>|;&`]|[$][(]/.test(trimmed)) return false;
  const tokens = trimmed.split(/\s+/);
  const commandName = tokens[0] ?? "";
  if (commandName === "command") return tokens[1] === "-v" && Boolean(tokens[2]);
  return readOnlyBashCommands.has(commandName);
}

async function readWorkspaceFile(workspacePath: string, path: string, runtime?: RuntimeInfo) {
  if (runtime?.type === "vefaas") return invokeVefaas(runtime, "tool", { tool: "read_file", input: { path } });
  if (runtime?.type === "aliyun_fc" || runtime?.type === "aliyun_fc_sandbox") return invokeAliyunFc(runtime, "tool", { tool: "read_file", input: { path } });
  if (runtime?.type === "vefaas_sandbox") {
    try {
      const content = await readVefaasSandboxFile(runtime, path);
      if (!isSandboxAbsolutePath(path)) {
        const target = assertSafeWorkspacePath(workspacePath, path);
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, content, "utf8");
      }
      return { path, content };
    } catch {
      if (isSandboxAbsolutePath(path)) throw new Error(`Sandbox file not readable: ${path}`);
    }
  }
  if (runtime?.type === "e2b") {
    try {
      const content = await readE2BFile(runtime, path);
      if (!isSandboxAbsolutePath(path)) {
        const target = assertSafeWorkspacePath(workspacePath, path);
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, content, "utf8");
      }
      return { path, content };
    } catch {
      // Fall through to the durable host workspace copy.
      if (isSandboxAbsolutePath(path)) throw new Error(`Sandbox file not readable: ${path}`);
    }
  }
  const target = assertSafeWorkspacePath(workspacePath, path);
  const content = await readFile(target, "utf8");
  return { path, content };
}

async function writeWorkspaceFile(workspacePath: string, path: string, content: string, runtime?: RuntimeInfo) {
  const target = assertSafeWorkspacePath(workspacePath, path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, content, "utf8");
  if (runtime?.type === "vefaas") return invokeVefaas(runtime, "tool", { tool: "write_file", input: { path, content } });
  if (runtime?.type === "aliyun_fc" || runtime?.type === "aliyun_fc_sandbox") return invokeAliyunFc(runtime, "tool", { tool: "write_file", input: { path, content } });
  if (runtime?.type === "vefaas_sandbox") {
    await writeVefaasSandboxFile(runtime, path, content);
    return { path, bytes: Buffer.byteLength(content), basename: basename(path) };
  }
  if (runtime?.type === "e2b") await writeE2BFile(runtime, path, content);
  return { path, bytes: Buffer.byteLength(content), basename: basename(path) };
}

async function listFiles(_workspacePath: string, runtime: RuntimeInfo, path: string) {
  if (runtime.type === "vefaas") return invokeVefaas(runtime, "tool", { tool: "list_files", input: { path } });
  if (runtime.type === "aliyun_fc" || runtime.type === "aliyun_fc_sandbox") return invokeAliyunFc(runtime, "tool", { tool: "list_files", input: { path } });
  if (runtime.type === "vefaas_sandbox") {
    const safePath = toVefaasSandboxMountedPath(runtime, safeSandboxReadPath(runtime, path));
    const sandboxPath = isSandboxAbsolutePath(safePath) ? safePath : `${runtime.sandbox_workspace_path}/${safePath === "." ? "" : safePath}`.replace(/\/$/, "");
    return { path, files: await listVefaasSandboxFiles(runtime, sandboxPath) };
  }
  const safePath = safeSandboxReadPath(runtime, path).replace(/'/g, "'\\''");
  if (runtime.type === "e2b") {
    const result = await runE2BCommand(runtime, `find '${safePath}' -maxdepth 2 -type f | sort | sed -n '1,200p'`, 30_000);
    return { path, files: result.stdout.split("\n").filter(Boolean) };
  }
  const result = await runDockerCommand(runtime.container_id, `find '${safePath}' -maxdepth 2 -type f | sort | sed -n '1,200p'`, 30_000);
  return { path, files: result.stdout.split("\n").filter(Boolean) };
}

async function grep(_workspacePath: string, runtime: RuntimeInfo, pattern: string, path: string) {
  if (!pattern.trim()) throw new Error("Missing grep pattern");
  if (runtime.type === "vefaas") return invokeVefaas(runtime, "tool", { tool: "grep", input: { pattern, path } });
  if (runtime.type === "aliyun_fc" || runtime.type === "aliyun_fc_sandbox") return invokeAliyunFc(runtime, "tool", { tool: "grep", input: { pattern, path } });
  const quotedPattern = pattern.replace(/'/g, "'\\''");
  if (runtime.type === "vefaas_sandbox") {
    const quotedPath = toVefaasSandboxMountedPath(runtime, safeSandboxReadPath(runtime, path)).replace(/'/g, "'\\''");
    const result = await runVefaasSandboxCommand(runtime, `grep -RIn -- '${quotedPattern}' '${quotedPath}' 2>/dev/null | sed -n '1,200p' || true`, 30_000);
    return { pattern, path, matches: result.stdout.split("\n").filter(Boolean) };
  }
  const quotedPath = safeSandboxReadPath(runtime, path).replace(/'/g, "'\\''");
  if (runtime.type === "e2b") {
    const result = await runE2BCommand(runtime, `grep -RIn -- '${quotedPattern}' '${quotedPath}' 2>/dev/null | sed -n '1,200p' || true`, 30_000);
    return { pattern, path, matches: result.stdout.split("\n").filter(Boolean) };
  }
  const result = await runDockerCommand(runtime.container_id, `grep -RIn -- '${quotedPattern}' '${quotedPath}' 2>/dev/null | sed -n '1,200p' || true`, 30_000);
  return { pattern, path, matches: result.stdout.split("\n").filter(Boolean) };
}

async function memorySearch(input: JsonRecord) {
  const query = String(input.query || "").toLowerCase();
  const storeId = input.memory_store_id ? String(input.memory_store_id) : undefined;
  const stores = (storeId ? listMemoryStores().filter((store) => String((store as JsonRecord).id) === storeId) : listMemoryStores()) as JsonRecord[];
  const results = stores.flatMap((store) =>
    listMemories(String(store.id), query).map((memory) => ({
      memory_store_id: store.id,
      memory_store_name: store.name,
      path: memory.path,
      preview: String(memory.content).slice(0, 1000)
    }))
  );
  return { query, results: results.slice(0, 20) };
}

async function memoryWrite(input: JsonRecord) {
  const memoryStoreId = String(input.memory_store_id || "");
  const path = String(input.path || "");
  const content = String(input.content || "");
  if (!memoryStoreId) throw new Error("Missing memory_store_id");
  if (!path) throw new Error("Missing path");
  const memory = upsertMemory({ memory_store_id: memoryStoreId, path, content, actor: "agent" });
  return { memory_store_id: memoryStoreId, path, memory_id: memory?.id };
}

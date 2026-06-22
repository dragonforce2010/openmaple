import { execFile } from "node:child_process";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { basename, dirname, relative } from "node:path";
import { promisify } from "node:util";
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
import { asRecord, assertSafeWorkspacePath, isSandboxAbsolutePath, safeSandboxReadPath } from "./runtimeCommon";
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
const execFileAsync = promisify(execFile);

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
    let runtime: RuntimeInfo;
    try {
      runtime = await ensureSessionSandboxRuntime(sessionId);
    } catch (error) {
      const fallback = agentRuntimeToolFallback(session);
      if (fallback) {
        console.warn("[runtime] sandbox unavailable; using agent runtime tool fallback", {
          session_id: sessionId,
          provider: fallback.type,
          error: error instanceof Error ? error.message : String(error)
        });
        runtime = fallback;
      } else if (process.env.MAPLE_RUNTIME_TOOL_BRIDGE_HOST_FALLBACK === "true") {
        console.warn("[runtime] sandbox unavailable; using host workspace tool fallback", {
          session_id: sessionId,
          error: error instanceof Error ? error.message : String(error)
        });
        return runToolWithHostWorkspace(session, name, input);
      } else {
        throw error;
      }
    }
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

function agentRuntimeToolFallback(session: JsonRecord): RuntimeInfo | null {
  if (process.env.MAPLE_RUNTIME_TOOL_BRIDGE_AGENT_RUNTIME_FALLBACK !== "true") return null;
  const runtime = asRecord(asRecord(session.metadata).agent_runtime);
  const type = String(runtime.type || runtime.provider || "");
  if (type !== "vefaas" && type !== "aliyun_fc") return null;
  return { ...runtime, type } as unknown as RuntimeInfo;
}

async function runToolWithHostWorkspace(session: JsonRecord, name: string, input: JsonRecord) {
  markHostFallbackRuntime(session);
  const workspacePath = String(session.workspace_path);
  switch (name) {
    case "bash":
      return runHostBash(workspacePath, String(input.command || ""));
    case "read_file":
      return readWorkspaceFile(workspacePath, String(input.path || ""));
    case "write_file":
      return writeWorkspaceFile(workspacePath, String(input.path || ""), String(input.content || ""));
    case "list_files":
      return listHostFiles(workspacePath, String(input.path || "."));
    case "grep":
      return grepHostFiles(workspacePath, String(input.pattern || ""), String(input.path || "."));
    case "memory_search":
      return memorySearch(input);
    case "memory_write":
      return memoryWrite(input);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

function markHostFallbackRuntime(session: JsonRecord) {
  const sessionId = String(session.id || "");
  if (!sessionId) return;
  const existing = asRecord(asRecord(session.metadata).runtime);
  if (existing.provider === "host_fallback") return;
  const runtimeType = process.env.MAPLE_SANDBOX_PROVIDER === "e2b" ? "e2b" : "host_fallback";
  const runtime = {
    type: runtimeType,
    provider: "host_fallback",
    sandbox_id: `host_${sessionId}`,
    container_id: `host_${sessionId}`,
    workspace_path: String(session.workspace_path || ""),
    sandbox_workspace_path: String(session.workspace_path || ""),
    lifecycle: { fallback: "host_workspace" }
  };
  updateSessionMetadata(sessionId, { runtime, sandbox_runtime: runtime });
}

async function runHostBash(workspacePath: string, command: string) {
  if (!command.trim()) throw new Error("Missing bash command");
  try {
    const result = await execFileAsync("bash", ["-lc", command], { cwd: workspacePath, timeout: 120_000, maxBuffer: 8 * 1024 * 1024 });
    return { stdout: result.stdout, stderr: result.stderr, exit_code: 0 };
  } catch (error) {
    const failed = error as { stdout?: unknown; stderr?: unknown; code?: unknown };
    return { stdout: String(failed.stdout || ""), stderr: String(failed.stderr || error), exit_code: Number(failed.code || 1) };
  }
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

async function listHostFiles(workspacePath: string, path: string) {
  const base = assertSafeWorkspacePath(workspacePath, path);
  const info = await stat(base);
  const files = info.isFile() ? [relative(workspacePath, base) || basename(base)] : await collectHostFiles(base, workspacePath, 5);
  return { path, files: files.sort().slice(0, 200) };
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

async function grepHostFiles(workspacePath: string, pattern: string, path: string) {
  if (!pattern.trim()) throw new Error("Missing grep pattern");
  const base = assertSafeWorkspacePath(workspacePath, path);
  const info = await stat(base);
  const files = info.isFile() ? [base] : (await collectHostFiles(base, workspacePath, 5)).map((item) => assertSafeWorkspacePath(workspacePath, item));
  const matches: string[] = [];
  for (const file of files) {
    try {
      const content = await readFile(file, "utf8");
      const rel = relative(workspacePath, file) || basename(file);
      content.split(/\r?\n/).forEach((line, index) => {
        if (line.includes(pattern)) matches.push(`${rel}:${index + 1}:${line}`);
      });
    } catch {
      // Skip unreadable or binary-ish files in the host fallback.
    }
    if (matches.length >= 200) break;
  }
  return { pattern, path, matches: matches.slice(0, 200) };
}

async function collectHostFiles(root: string, workspacePath: string, maxDepth: number, depth = 0): Promise<string[]> {
  if (depth > maxDepth) return [];
  const entries = await readdir(root, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = `${root.replace(/\/$/, "")}/${entry.name}`;
    if (entry.isDirectory()) {
      files.push(...await collectHostFiles(fullPath, workspacePath, maxDepth, depth + 1));
    } else if (entry.isFile()) {
      files.push(relative(workspacePath, fullPath) || entry.name);
    }
  }
  return files;
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

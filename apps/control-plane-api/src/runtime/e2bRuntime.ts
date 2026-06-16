import { Sandbox as E2BSandboxClass } from "e2b";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, posix, resolve } from "node:path";
import { startSpan, traceAsync } from "../perfTrace";
import { updateSessionMetadata } from "../store";
import type { JsonRecord } from "../types";
import {
  assertSafeWorkspacePath,
  isSandboxAbsolutePath,
  listHostFiles,
  normalizeSandboxPath,
  safeSandboxReadPath,
  shellQuote
} from "./runtimeCommon";
import type { E2BRuntimeInfo, E2BSandbox, E2BSandboxConstructor, RuntimeInfo } from "./runtimeTypes";
import type { NormalizedSandboxRuntimeConfig } from "./sandboxConfig";

const e2bSandboxCache = new Map<string, E2BSandbox>();
const e2bWorkspaceReadyAt = new Map<string, number>();

export async function ensureE2BRuntime(session: JsonRecord & { id: string; workspace_path: string }, config: Extract<NormalizedSandboxRuntimeConfig, { provider: "e2b" }>) {
  const endEnsure = startSpan("e2b.ensure", { session_id: session.id, template: config.template });
  const metadata = session.metadata as JsonRecord;
  const existing = metadata.runtime as RuntimeInfo | undefined;
  if (existing?.type === "e2b" && existing.sandbox_id) {
    try {
      const recentlyReady = e2bWorkspaceRecentlyReady(existing.sandbox_id);
      await connectE2BSandbox(existing, config);
      if (!recentlyReady) await ensureE2BWorkspace(existing, config);
      await syncSessionMountsToE2B(existing);
      markE2BWorkspaceReady(existing.sandbox_id);
      endEnsure({ path: "existing", sandbox_id: existing.sandbox_id, recently_ready: recentlyReady }, "ok");
      return existing;
    } catch {
      e2bSandboxCache.delete(existing.sandbox_id);
      e2bWorkspaceReadyAt.delete(existing.sandbox_id);
    }
  }

  if (!config.api_key) {
    endEnsure({ error: "missing_api_key" }, "error");
    throw new Error("E2B sandbox requires E2B_API_KEY or sandbox.config.json e2b.api_key.");
  }

  try {
    const workspacePath = String(session.workspace_path);
    await mkdir(workspacePath, { recursive: true });
    const Sandbox = await loadE2BSandboxConstructor();
    const sandbox = await traceAsync("e2b.create", { session_id: session.id, template: config.template }, () => Sandbox.create({
      apiKey: config.api_key,
      template: config.template,
      timeoutMs: config.timeout_ms,
      lifecycle: {
        onTimeout: "pause",
        autoResume: true
      },
      envs: {
        ...config.envs,
        MAPLE_SESSION_ID: String(session.id)
      },
      metadata: {
        app: "managed-agents-platform",
        session_id: String(session.id)
      }
    }));
    e2bSandboxCache.set(sandbox.sandboxId, sandbox);
    const runtime: E2BRuntimeInfo = {
      type: "e2b",
      sandbox_id: sandbox.sandboxId,
      template: config.template,
      workspace_path: workspacePath,
      sandbox_workspace_path: config.workspace_path,
      timeout_ms: config.timeout_ms,
      lifecycle: {
        on_timeout: "pause",
        auto_resume: true,
        resume_strategy: "connect"
      }
    };
    await ensureE2BWorkspace(runtime, config);
    await syncHostWorkspaceToE2B(runtime, config);
    await syncSessionMountsToE2B(runtime);
    markE2BWorkspaceReady(runtime.sandbox_id);
    updateSessionMetadata(String(session.id), { runtime, sandbox_runtime: runtime });
    endEnsure({ path: "created", sandbox_id: runtime.sandbox_id }, "ok");
    return runtime;
  } catch (error) {
    endEnsure({ error: errorMessage(error) }, "error");
    throw error;
  }
}

export async function syncSessionMountsToE2B(runtime: E2BRuntimeInfo) {
  await traceAsync("e2b.sync_session_mounts", { sandbox_id: runtime.sandbox_id }, async () => {
    const uploadRoot = join(runtime.workspace_path, ".session", "uploads");
    if (!existsSync(uploadRoot)) return;
    await runE2BCommand(runtime, "mkdir -p /mnt/session/uploads", 30_000, "/");
    const files = listHostFiles(uploadRoot, uploadRoot, [], { maxFileSize: 50 * 1024 * 1024 }).slice(0, 200);
    const sandbox = await connectE2BSandbox(runtime);
    await sandbox.files.write(
      await Promise.all(
        files.map(async (path) => ({
          path: `/mnt/session/uploads/${path}`,
          data: await readFile(join(uploadRoot, path), "utf8")
        }))
      )
    );
  });
}

export async function runE2BCommand(runtime: E2BRuntimeInfo, command: string, timeoutMs: number, cwd = runtime.sandbox_workspace_path, user?: string) {
  return traceAsync("e2b.command", { sandbox_id: runtime.sandbox_id, cwd, command_length: command.length }, async () => {
    const sandbox = await connectE2BSandbox(runtime);
    try {
      const result = await sandbox.commands.run(command, {
        cwd,
        ...(user ? { user } : {}),
        timeoutMs,
        requestTimeoutMs: timeoutMs + 5_000
      });
      return normalizeE2BCommandResult(result);
    } catch (error) {
      return normalizeE2BCommandError(error);
    }
  });
}

export async function readE2BFile(runtime: E2BRuntimeInfo, path: string) {
  const sandbox = await connectE2BSandbox(runtime);
  const value = await sandbox.files.read(toE2BReadablePath(runtime, path), { format: "text" });
  if (typeof value === "string") return value;
  if (value instanceof Uint8Array) return Buffer.from(value).toString("utf8");
  return String(value ?? "");
}

export async function writeE2BFile(runtime: E2BRuntimeInfo, path: string, content: string) {
  const sandbox = await connectE2BSandbox(runtime);
  const target = toE2BWorkspacePath(runtime, path);
  const parent = posix.dirname(target);
  if (parent && parent !== "." && parent !== "/") {
    await runE2BCommand(runtime, `mkdir -p '${parent.replace(/'/g, "'\\''")}'`, 30_000, "/");
  }
  await sandbox.files.write(target, content);
}

export async function syncE2BWorkspaceToHost(runtime: E2BRuntimeInfo) {
  await traceAsync("e2b.sync_workspace_to_host", { sandbox_id: runtime.sandbox_id }, async () => {
    const result = await runE2BCommand(runtime, "find . -maxdepth 5 -type f | sort | sed -n '1,500p'", 30_000);
    for (const entry of result.stdout.split("\n").map((line) => line.replace(/^\.\//, "").trim()).filter(Boolean)) {
      try {
        const content = await readE2BFile(runtime, entry);
        const target = assertSafeWorkspacePath(runtime.workspace_path, entry);
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, content, "utf8");
      } catch {
        // Binary or inaccessible files are skipped; artifacts are best-effort snapshots.
      }
    }
  });
}

async function loadE2BSandboxConstructor() {
  try {
    if (!E2BSandboxClass) throw new Error("missing Sandbox export");
    return E2BSandboxClass as unknown as E2BSandboxConstructor;
  } catch (error) {
    throw new Error(
      [
        "E2B sandbox support requires the optional `e2b` JavaScript SDK.",
        "Install it in this project with `bun add e2b`, or select a `local_docker` environment.",
        `Original error: ${error instanceof Error ? error.message : String(error)}`
      ].join(" ")
    );
  }
}

async function connectE2BSandbox(runtime: E2BRuntimeInfo, config?: Extract<NormalizedSandboxRuntimeConfig, { provider: "e2b" }>) {
  const cached = e2bSandboxCache.get(runtime.sandbox_id);
  if (cached) return cached;
  const Sandbox = await loadE2BSandboxConstructor();
  const sandbox = await traceAsync("e2b.connect", { sandbox_id: runtime.sandbox_id }, () =>
    Sandbox.connect(runtime.sandbox_id, config?.api_key ? { apiKey: config.api_key, timeoutMs: config.timeout_ms } : { timeoutMs: runtime.timeout_ms ?? 3_600_000 })
  );
  e2bSandboxCache.set(runtime.sandbox_id, sandbox);
  return sandbox;
}

async function ensureE2BWorkspace(runtime: E2BRuntimeInfo, _config?: Extract<NormalizedSandboxRuntimeConfig, { provider: "e2b" }>) {
  await traceAsync("e2b.prepare_workspace", { sandbox_id: runtime.sandbox_id }, async () => {
    const userResult = await runE2BCommand(runtime, "id -un", 30_000, "/");
    const sandboxUser = userResult.exit_code === 0 && userResult.stdout.trim() ? userResult.stdout.trim() : "user";
    const result = await runE2BCommand(
      runtime,
      [
        `mkdir -p ${shellQuote(runtime.sandbox_workspace_path)} /mnt/session/uploads`,
        `chown -R ${shellQuote(sandboxUser)}:${shellQuote(sandboxUser)} ${shellQuote(runtime.sandbox_workspace_path)} /mnt/session`
      ].join(" && "),
      30_000,
      "/",
      "root"
    );
    if (result.exit_code !== 0) {
      throw new Error(`Failed to prepare E2B workspace: ${result.stderr || result.stdout || "unknown error"}`);
    }
  });
}

function normalizeE2BCommandResult(result: JsonRecord) {
  return {
    stdout: String(result.stdout ?? ""),
    stderr: String(result.stderr ?? result.error ?? ""),
    exit_code: Number(result.exitCode ?? result.exit_code ?? 0)
  };
}

function normalizeE2BCommandError(error: unknown) {
  const record = typeof error === "object" && error !== null ? (error as JsonRecord) : {};
  return {
    stdout: String(record.stdout ?? ""),
    stderr: String(record.stderr ?? (error instanceof Error ? error.message : String(error))),
    exit_code: Number(record.exitCode ?? record.exit_code ?? 1)
  };
}

async function syncHostWorkspaceToE2B(runtime: E2BRuntimeInfo, _config: Extract<NormalizedSandboxRuntimeConfig, { provider: "e2b" }>) {
  await traceAsync("e2b.sync_host_to_workspace", { sandbox_id: runtime.sandbox_id }, async () => {
    const root = resolve(runtime.workspace_path);
    if (!existsSync(root)) return;
    const files = listHostFiles(root).slice(0, 200);
    if (!files.length) return;
    const sandbox = await connectE2BSandbox(runtime);
    await sandbox.files.write(
      await Promise.all(
        files.map(async (path) => ({
          path: toE2BWorkspacePath(runtime, path),
          data: await readFile(join(root, path), "utf8")
        }))
      )
    );
  });
}

function toE2BWorkspacePath(runtime: E2BRuntimeInfo, path: string) {
  const normalized = normalizeSandboxPath(path);
  if (normalized.startsWith("..") || normalized.startsWith("/") || normalized.includes("/../")) {
    throw new Error(`Path escapes workspace: ${path}`);
  }
  return `${runtime.sandbox_workspace_path.replace(/\/$/, "")}/${normalized === "." ? "" : normalized}`.replace(/\/$/, "");
}

function toE2BReadablePath(runtime: E2BRuntimeInfo, path: string) {
  if (isSandboxAbsolutePath(path)) return safeSandboxReadPath(runtime, path);
  return toE2BWorkspacePath(runtime, path);
}

function markE2BWorkspaceReady(sandboxId: string) {
  e2bWorkspaceReadyAt.set(sandboxId, Date.now());
}

function e2bWorkspaceRecentlyReady(sandboxId: string) {
  const readyAt = e2bWorkspaceReadyAt.get(sandboxId) ?? 0;
  return readyAt > 0 && Date.now() - readyAt < e2bReadyReuseTtlMs();
}

function e2bReadyReuseTtlMs() {
  const raw = Number(process.env.MAPLE_E2B_SANDBOX_REUSE_READY_TTL_MS || 300_000);
  return Number.isFinite(raw) && raw > 0 ? raw : 300_000;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

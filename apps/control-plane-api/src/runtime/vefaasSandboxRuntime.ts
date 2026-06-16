import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, posix, resolve } from "node:path";
import { startSpan, traceAsync } from "../perfTrace";
import { updateSessionMetadata } from "../store";
import type { JsonRecord } from "../types";
import { sessionResourceManifest } from "./runtimeResources";
import {
  assertSafeWorkspacePath,
  isSandboxAbsolutePath,
  listHostFiles,
  parseJsonRecord,
  safeSandboxReadPath,
  shellQuote
} from "./runtimeCommon";
import type { RuntimeInfo, VefaasSandboxRuntimeInfo } from "./runtimeTypes";
import type { NormalizedSandboxRuntimeConfig } from "./sandboxConfig";
import { callVefaasSandboxOpenApi } from "./vefaasSandboxOpenApi";
import {
  extractVefaasSandboxId,
  isSameVefaasSandbox,
  markRuntimeReady,
  normalizeCommandLikeResult,
  normalizeListedFile,
  nonEmptyString,
  openApiTimeoutMinutes,
  runtimeNotExpired,
  runtimeRecentlyReady,
  shouldRetryGatewayStatus,
  sleep,
  toVefaasSandboxReadablePath,
  toVefaasSandboxWorkspacePath
} from "./vefaasSandboxHelpers";

type VefaasSandboxAcquireOptions = {
  acquireRuntime?: () => Promise<VefaasSandboxRuntimeInfo | null>;
};

export async function ensureVefaasSandboxRuntime(
  session: JsonRecord & { id: string; workspace_path: string },
  config: Extract<NormalizedSandboxRuntimeConfig, { provider: "vefaas" }>,
  options: VefaasSandboxAcquireOptions = {}
) {
  const endEnsure = startSpan("vefaas_sandbox.ensure", {
    session_id: session.id,
    function_id: config.function_id,
    has_pool_acquire: Boolean(options.acquireRuntime)
  });
  if (!config.access_key || !config.secret_key) {
    endEnsure({ error: "missing_credentials" }, "error");
    throw new Error("veFaaS sandbox requires VOLCENGINE_ACCESS_KEY/VOLCENGINE_SECRET_KEY or sandbox.vefaas access_key/secret_key.");
  }
  if (!config.function_id) {
    endEnsure({ error: "missing_function_id" }, "error");
    throw new Error("veFaaS sandbox requires VEFAAS_SANDBOX_FUNCTION_ID or sandbox.vefaas.function_id.");
  }
  if (!config.gateway_url) {
    endEnsure({ error: "missing_gateway_url" }, "error");
    throw new Error("veFaaS sandbox requires VEFAAS_SANDBOX_GATEWAY_URL or sandbox.vefaas.gateway_url for tool execution.");
  }

  const metadata = session.metadata as JsonRecord;
  const existing = metadata.runtime as RuntimeInfo | undefined;
  if (isVefaasSandboxRuntime(existing) && isSameVefaasSandbox(existing, config) && runtimeNotExpired(existing)) {
    try {
      const recentlyReady = runtimeRecentlyReady(existing);
      if (!recentlyReady) {
        await traceAsync("vefaas_sandbox.resume_existing", { session_id: session.id, sandbox_id: existing.sandbox_id }, () => resumeVefaasSandbox(existing, config));
        await traceAsync("vefaas_sandbox.timeout_existing", { session_id: session.id, sandbox_id: existing.sandbox_id }, () => setVefaasSandboxTimeout(existing, { ...config, timeout_ms: Number(existing.timeout_ms || config.timeout_ms) }));
      }
      await traceAsync("vefaas_sandbox.prepare_existing", { session_id: session.id, sandbox_id: existing.sandbox_id, sync_host: false, recently_ready: recentlyReady }, () =>
        prepareVefaasSandboxRuntime(existing, session, { syncHost: false, ensureWorkspace: !recentlyReady })
      );
      const readyRuntime = markRuntimeReady(existing);
      updateSessionMetadata(session.id, { runtime: readyRuntime, sandbox_runtime: readyRuntime });
      endEnsure({ path: "existing", sandbox_id: readyRuntime.sandbox_id, recently_ready: recentlyReady }, "ok");
      return readyRuntime;
    } catch {
      // Create a fresh sandbox when the old one was killed or expired.
    }
  }

  const workspacePath = String(session.workspace_path);
  await mkdir(workspacePath, { recursive: true });
  const sessionId = String(session.id);
  const acquired = options.acquireRuntime
    ? await traceAsync("vefaas_sandbox.pool_acquire", { session_id: sessionId }, () => options.acquireRuntime!())
    : null;
  if (acquired) {
    await traceAsync("vefaas_sandbox.prepare_acquired", { session_id: sessionId, sandbox_id: acquired.sandbox_id, sync_host: true }, () => prepareVefaasSandboxRuntime(acquired, session));
    const readyRuntime = markRuntimeReady(acquired);
    updateSessionMetadata(sessionId, { runtime: readyRuntime, sandbox_runtime: readyRuntime });
    endEnsure({ path: "pooled", sandbox_id: readyRuntime.sandbox_id }, "ok");
    return readyRuntime;
  }
  const sandboxId = await traceAsync("vefaas_sandbox.create", { session_id: sessionId, function_id: config.function_id }, () => createVefaasSandbox(config, {
    timeout_ms: config.timeout_ms,
    metadata: { ...config.metadata, app: "managed-agents-platform", session_id: sessionId },
    envs: { ...config.envs, MAPLE_SESSION_ID: sessionId, MAPLE_WORKSPACE_PATH: config.workspace_path }
  }));

  const runtime: VefaasSandboxRuntimeInfo = {
    type: "vefaas_sandbox",
    provider: "vefaas",
    sandbox_id: sandboxId,
    function_id: config.function_id,
    region: config.region,
    endpoint: config.endpoint,
    gateway_url: config.gateway_url.replace(/\/$/, ""),
    api_token: config.api_token || undefined,
    workspace_path: workspacePath,
    sandbox_workspace_path: config.workspace_path,
    timeout_ms: config.timeout_ms,
    envs: config.envs,
    metadata: {
      ...config.metadata,
      app: "managed-agents-platform",
      session_id: sessionId
    },
    lifecycle: {
      on_timeout: "pause_or_expire",
      resume_strategy: "ResumeSandbox",
      timeout_strategy: "SetSandboxTimeout"
    }
  };
  await traceAsync("vefaas_sandbox.timeout_created", { session_id: sessionId, sandbox_id: sandboxId }, () => setVefaasSandboxTimeout(runtime, config));
  await traceAsync("vefaas_sandbox.prepare_created", { session_id: sessionId, sandbox_id: sandboxId, sync_host: true }, () => prepareVefaasSandboxRuntime(runtime, session));
  const readyRuntime = markRuntimeReady(runtime);
  updateSessionMetadata(sessionId, { runtime: readyRuntime, sandbox_runtime: readyRuntime });
  endEnsure({ path: "created", sandbox_id: sandboxId }, "ok");
  return readyRuntime;
}

export function isVefaasSandboxRuntime(runtime: RuntimeInfo | undefined): runtime is VefaasSandboxRuntimeInfo {
  return runtime?.type === "vefaas_sandbox";
}

export async function createVefaasSandbox(
  config: Extract<NormalizedSandboxRuntimeConfig, { provider: "vefaas" }>,
  input: { timeout_ms: number; metadata: Record<string, string>; envs: Record<string, string> }
) {
  const openApiResult = await callVefaasSandboxOpenApi(config, "CreateSandbox", {
    FunctionId: config.function_id,
    Timeout: openApiTimeoutMinutes(input.timeout_ms),
    Metadata: input.metadata,
    Envs: Object.entries(input.envs).map(([Key, Value]) => ({ Key, Value }))
  });
  const sandboxId = extractVefaasSandboxId(openApiResult);
  if (!sandboxId) throw new Error(`veFaaS CreateSandbox response missing SandboxId: ${JSON.stringify(openApiResult)}`);
  return sandboxId;
}

export async function runVefaasSandboxCommand(runtime: VefaasSandboxRuntimeInfo, command: string, timeoutMs: number, cwd = runtime.sandbox_workspace_path) {
  return traceAsync("vefaas_sandbox.command", { sandbox_id: runtime.sandbox_id, cwd, command_length: command.length }, async () => {
    const effectiveCommand = cwd ? `cd ${shellQuote(cwd)} && ${command}` : command;
    const body = await requestVefaasSandboxGateway(
      runtime,
      ["/v1/shell/exec", "/v1/commands/run", "/shell/exec"],
      {
        command: effectiveCommand,
        cmd: effectiveCommand,
        cwd,
        timeout: Math.max(1, Math.ceil(timeoutMs / 1000)),
        timeout_ms: timeoutMs
      },
      timeoutMs
    );
    return normalizeCommandLikeResult(body);
  });
}

export async function readVefaasSandboxFile(runtime: VefaasSandboxRuntimeInfo, path: string) {
  return traceAsync("vefaas_sandbox.file_read", { sandbox_id: runtime.sandbox_id, path }, async () => {
    const target = toVefaasSandboxReadablePath(runtime, path);
    try {
      const body = await requestVefaasSandboxGateway(runtime, ["/v1/file/read"], { file: target, path: target }, 30_000);
      return String(body.content ?? body.Content ?? "");
    } catch {
      // Fall back to shell for sandbox images that do not expose the file API.
    }
    const result = await runVefaasSandboxCommand(runtime, `cat ${shellQuote(target)}`, 30_000, "/");
    if (result.exit_code !== 0) throw new Error(result.stderr || `Failed to read veFaaS sandbox file: ${path}`);
    return result.stdout;
  });
}

export async function writeVefaasSandboxFile(runtime: VefaasSandboxRuntimeInfo, path: string, content: string) {
  await traceAsync("vefaas_sandbox.file_write", { sandbox_id: runtime.sandbox_id, path, bytes: Buffer.byteLength(content) }, async () => {
    const target = isSandboxAbsolutePath(path) ? safeSandboxReadPath(runtime, path) : toVefaasSandboxWorkspacePath(runtime, path);
    try {
      await requestVefaasSandboxGateway(runtime, ["/v1/file/write"], { file: target, path: target, content }, 30_000);
      return;
    } catch {
      // Fall back to shell for sandbox images that do not expose the file API.
    }
    const encoded = Buffer.from(content, "utf8").toString("base64");
    const command = [
      `mkdir -p ${shellQuote(posix.dirname(target))}`,
      `printf %s ${shellQuote(encoded)} | base64 -d > ${shellQuote(target)}`
    ].join(" && ");
    const result = await runVefaasSandboxCommand(runtime, command, 30_000, "/");
    if (result.exit_code !== 0) throw new Error(result.stderr || `Failed to write veFaaS sandbox file: ${path}`);
  });
}

export async function syncSessionMountsToVefaasSandbox(runtime: VefaasSandboxRuntimeInfo, session?: JsonRecord & { workspace_path: string }) {
  await traceAsync("vefaas_sandbox.sync_session_mounts", { sandbox_id: runtime.sandbox_id }, async () => {
    const manifest = session ? await sessionResourceManifest(session) : [];
    const presigned = manifest.filter((entry) => typeof entry.presigned_url === "string");
    if (presigned.length) {
      // Best-effort per file: a failed download must not break the whole tool turn (the agent can
      // still run other tools); we log the real curl error instead of masking every tool call.
      for (const entry of presigned) {
        try {
          await curlSessionMountIntoSandbox(runtime, String(entry.mount_path), String(entry.presigned_url));
        } catch (error) {
          console.warn("[vefaas_sandbox] session mount failed", runtime.sandbox_id, entry.mount_path, error instanceof Error ? error.message : String(error));
        }
      }
      return;
    }
    // Local/dev fallback: no TOS presign available, push the host bytes as before.
    const uploadRoot = join(runtime.workspace_path, ".session", "uploads");
    if (!existsSync(uploadRoot)) return;
    const files = listHostFiles(uploadRoot, uploadRoot, [], { maxFileSize: 50 * 1024 * 1024 }).slice(0, 200);
    for (const path of files) {
      await writeVefaasSandboxFile(runtime, sandboxUploadTarget(runtime, `/mnt/session/uploads/${path}`), await readFile(join(uploadRoot, path), "utf8"));
    }
  });
}

// veFaaS sandbox /mnt is read-only for the unprivileged user, so map the manifest's
// /mnt/session/uploads/<rel> onto the writable workspace dir: <sandbox_workspace_path>/.session/uploads/<rel>.
export function sandboxUploadTarget(runtime: VefaasSandboxRuntimeInfo, mountPath: string) {
  const rel = mountPath.replace(/^\/mnt\/session\/uploads\//, "").replace(/^\/+/, "");
  return `${runtime.sandbox_workspace_path.replace(/\/$/, "")}/.session/uploads/${rel}`;
}

// Download a session upload from TOS *inside* the sandbox (presigned URL, used-then-discarded).
// Idempotent: skip if already present. Retries once to ride out shared public-NAT bandwidth dips.
async function curlSessionMountIntoSandbox(runtime: VefaasSandboxRuntimeInfo, mountPath: string, presignedUrl: string) {
  const target = sandboxUploadTarget(runtime, mountPath);
  // -sS keeps curl quiet but still prints errors; --fail-with-body surfaces HTTP error bodies so a
  // 403/expired-signature shows up in stderr instead of an empty failure.
  const command = [
    `test -f ${shellQuote(target)}`,
    `(mkdir -p ${shellQuote(posix.dirname(target))} && curl -sS -L --fail-with-body --max-time 120 --retry 1 -o ${shellQuote(target)} ${shellQuote(presignedUrl)})`
  ].join(" || ");
  const result = await runVefaasSandboxCommand(runtime, command, 130_000, "/");
  if (result.exit_code !== 0) {
    const detail = [result.stderr, result.stdout].map((part) => String(part || "").trim()).filter(Boolean).join(" | ");
    throw new Error(`Failed to mount session upload into sandbox: ${mountPath} (exit ${result.exit_code})${detail ? `: ${detail}` : ""}`);
  }
}

export async function syncVefaasSandboxWorkspaceToHost(runtime: VefaasSandboxRuntimeInfo) {
  await traceAsync("vefaas_sandbox.sync_workspace_to_host", { sandbox_id: runtime.sandbox_id }, async () => {
    const entries = await listVefaasSandboxFiles(runtime);
    for (const entry of entries) {
      try {
        const content = await readVefaasSandboxFile(runtime, entry);
        const target = assertSafeWorkspacePath(runtime.workspace_path, entry);
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, content, "utf8");
      } catch {
        // Binary or inaccessible files are skipped; artifacts are best-effort snapshots.
      }
    }
  });
}

export async function listVefaasSandboxFiles(runtime: VefaasSandboxRuntimeInfo, path = runtime.sandbox_workspace_path) {
  return traceAsync("vefaas_sandbox.file_list", { sandbox_id: runtime.sandbox_id, path }, async () => {
    try {
      const body = await requestVefaasSandboxGateway(runtime, ["/v1/file/list"], { path, recursive: true, max_depth: 5 }, 30_000);
      const files = Array.isArray(body.files) ? body.files : [];
      return files.map((item) => normalizeListedFile(item, runtime.sandbox_workspace_path)).filter(nonEmptyString).slice(0, 500);
    } catch {
      const result = await runVefaasSandboxCommand(runtime, `find ${shellQuote(path)} -maxdepth 5 -type f | sort | sed -n '1,500p'`, 30_000, "/");
      return result.stdout.split("\n").map((line) => normalizeListedFile(line, runtime.sandbox_workspace_path)).filter(nonEmptyString);
    }
  });
}

export async function killVefaasSandbox(runtime: VefaasSandboxRuntimeInfo, config: Extract<NormalizedSandboxRuntimeConfig, { provider: "vefaas" }>) {
  await callVefaasSandboxOpenApi(config, "KillSandbox", {
    FunctionId: runtime.function_id,
    SandboxId: runtime.sandbox_id
  });
}

export async function describeVefaasSandbox(runtime: VefaasSandboxRuntimeInfo, config: Extract<NormalizedSandboxRuntimeConfig, { provider: "vefaas" }>) {
  await callVefaasSandboxOpenApi(config, "DescribeSandbox", { FunctionId: runtime.function_id, SandboxId: runtime.sandbox_id });
}

export async function prepareVefaasSandboxRuntime(runtime: VefaasSandboxRuntimeInfo, session?: JsonRecord & { id: string; workspace_path: string }, options: { syncHost?: boolean; ensureWorkspace?: boolean } = {}) {
  await traceAsync("vefaas_sandbox.prepare", { sandbox_id: runtime.sandbox_id, session_id: session?.id ?? "", sync_host: options.syncHost !== false, ensure_workspace: options.ensureWorkspace !== false }, async () => {
    if (options.ensureWorkspace !== false) await ensureVefaasSandboxWorkspace(runtime);
    if (options.syncHost !== false) await syncHostWorkspaceToVefaasSandbox(runtime);
    if (session) await syncSessionMountsToVefaasSandbox(runtime, session);
  });
}

async function resumeVefaasSandbox(runtime: VefaasSandboxRuntimeInfo, config: Extract<NormalizedSandboxRuntimeConfig, { provider: "vefaas" }>) {
  await describeVefaasSandbox(runtime, config);
  await callVefaasSandboxOpenApi(config, "ResumeSandbox", {
    FunctionId: runtime.function_id,
    SandboxId: runtime.sandbox_id,
    Timeout: openApiTimeoutMinutes(config.timeout_ms)
  }).catch(() => undefined);
}

export async function setVefaasSandboxTimeout(runtime: VefaasSandboxRuntimeInfo, config: Extract<NormalizedSandboxRuntimeConfig, { provider: "vefaas" }>) {
  await callVefaasSandboxOpenApi(config, "SetSandboxTimeout", {
    FunctionId: runtime.function_id,
    SandboxId: runtime.sandbox_id,
    Timeout: openApiTimeoutMinutes(config.timeout_ms)
  }).catch(() => undefined);
}

async function ensureVefaasSandboxWorkspace(runtime: VefaasSandboxRuntimeInfo) {
  const result = await runVefaasSandboxCommand(runtime, `mkdir -p ${shellQuote(runtime.sandbox_workspace_path)}`, 30_000, "/");
  if (result.exit_code !== 0) throw new Error(`Failed to prepare veFaaS sandbox workspace: ${result.stderr || result.stdout || "unknown error"}`);
}

async function syncHostWorkspaceToVefaasSandbox(runtime: VefaasSandboxRuntimeInfo) {
  await traceAsync("vefaas_sandbox.sync_host_to_workspace", { sandbox_id: runtime.sandbox_id }, async () => {
    const root = resolve(runtime.workspace_path);
    if (!existsSync(root)) return;
    const files = listHostFiles(root).slice(0, 200);
    for (const path of files) {
      await writeVefaasSandboxFile(runtime, path, await readFile(join(root, path), "utf8"));
    }
  });
}

async function requestVefaasSandboxGateway(runtime: VefaasSandboxRuntimeInfo, paths: string[], payload: JsonRecord, timeoutMs: number) {
  return traceAsync("vefaas_sandbox.gateway", { sandbox_id: runtime.sandbox_id, paths: paths.join(","), payload_bytes: JSON.stringify(payload).length }, async () => {
    let lastError = "";
    const deadline = Date.now() + Math.min(Math.max(timeoutMs, 5_000), 30_000);
    for (let attempt = 0; Date.now() <= deadline; attempt += 1) {
      for (const path of paths) {
        try {
          const response = await fetch(`${runtime.gateway_url.replace(/\/$/, "")}${path}`, {
            method: "POST",
            signal: AbortSignal.timeout(timeoutMs + 5_000),
            headers: {
              "Content-Type": "application/json",
              "x-faas-instance-name": runtime.sandbox_id,
              ...(runtime.api_token ? { Authorization: `Bearer ${runtime.api_token}` } : {})
            },
            body: JSON.stringify(payload)
          });
          const text = await response.text();
          const body = parseJsonRecord(text);
          if ((response.status === 404 || response.status === 405) && path !== paths[paths.length - 1]) {
            lastError = `HTTP ${response.status}: ${text}`;
            continue;
          }
          if (shouldRetryGatewayStatus(response.status) && Date.now() < deadline) {
            lastError = `HTTP ${response.status}: ${text}`;
            break;
          }
          if (!response.ok) throw new Error(`veFaaS sandbox gateway error ${response.status}: ${text}`);
          if (body.ok === false || body.success === false) throw new Error(String(body.error || body.message || "veFaaS sandbox gateway returned failure"));
          if (body.result && typeof body.result === "object") return body.result as JsonRecord;
          if (body.data && typeof body.data === "object") return body.data as JsonRecord;
          return body as JsonRecord;
        } catch (error) {
          if (Date.now() >= deadline) throw error;
          lastError = error instanceof Error ? error.message : String(error);
          break;
        }
      }
      await sleep(Math.min(1_000, 150 * (attempt + 1)));
    }
    throw new Error(`veFaaS sandbox gateway endpoint not found: ${lastError}`);
  });
}



import { emitSessionEvent } from "../eventHub";
import { createSessionEvent, getPrimaryThread, getSession, updateSessionStatus } from "../store";
import type { JsonRecord, SessionStatus } from "../types";
import type { EnvironmentPackage } from "./sandboxConfigTypes";
import type { VefaasSandboxRuntimeInfo } from "./runtimeTypes";
import { ensureSandboxPackages, type PackageProgress } from "./vefaasSandboxPackages";

// Install the environment's declared packages into a freshly-ready vefaas sandbox, gating the
// session in `installing_packages` while it runs and streaming per-package progress as session
// events. Probing is idempotent (see ensureSandboxPackages), so a warm/sticky sandbox skips
// straight through without flipping status or emitting noise.
export async function installSessionPackages(
  session: JsonRecord & { id: string },
  runtime: VefaasSandboxRuntimeInfo,
  packages: EnvironmentPackage[]
) {
  if (!packages.length) return;
  const sessionId = String(session.id);
  const thread = getPrimaryThread(sessionId);
  const threadId = thread ? String(thread.id) : null;
  const priorStatus = String(getSession(sessionId)?.status ?? "idle") as SessionStatus;
  let gated = false;

  const onProgress = (event: PackageProgress) => {
    if (!gated) {
      gated = true;
      updateSessionStatus(sessionId, "installing_packages");
      record(sessionId, threadId, "session.status_installing_packages", { total: packages.length });
    }
    emitPackageEvent(sessionId, threadId, event);
  };

  const result = await ensureSandboxPackages(runtime, packages, onProgress);
  if (!gated) return result; // all packages already present — no status churn

  const restored: SessionStatus = priorStatus === "installing_packages" ? "idle" : priorStatus;
  updateSessionStatus(sessionId, restored);
  record(sessionId, threadId, "session.packages_ready", {
    installed: result.installed.length,
    failed: result.failed.length,
    skipped: result.skipped
  });
  return result;
}

function emitPackageEvent(sessionId: string, threadId: string | null, event: PackageProgress) {
  const type =
    event.phase === "started" ? "package.install_started" : event.phase === "log" ? "package.install_log" : "package.install_finished";
  record(sessionId, threadId, type, event as unknown as JsonRecord);
}

function record(sessionId: string, threadId: string | null, type: string, payload: JsonRecord) {
  const event = createSessionEvent({ session_id: sessionId, thread_id: threadId, type, payload });
  emitSessionEvent(event);
  return event;
}

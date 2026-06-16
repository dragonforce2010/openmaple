import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { basename, join } from "node:path";
import { promisify } from "node:util";
import { updateSessionMetadata } from "../store";
import type { JsonRecord } from "../types";
import type { DockerRuntimeInfo, RuntimeInfo } from "./runtimeTypes";
import type { NormalizedSandboxRuntimeConfig } from "./sandboxConfig";

const execFileAsync = promisify(execFile);

const dockerBinCandidates = [
  process.env.MAPLE_DOCKER_BIN,
  process.env.DOCKER_BIN,
  "/usr/local/bin/docker",
  "/opt/homebrew/bin/docker",
  "/Applications/Docker.app/Contents/Resources/bin/docker"
].filter((value): value is string => Boolean(value));

function dockerBin() {
  return dockerBinCandidates.find((candidate) => existsSync(candidate)) ?? "docker";
}

export async function ensureDockerRuntime(session: JsonRecord & { id: string; workspace_path: string; environment_id: string }, config: Extract<NormalizedSandboxRuntimeConfig, { provider: "local_docker" }>) {
  const metadata = session.metadata as JsonRecord;
  const existing = metadata.runtime as RuntimeInfo | undefined;
  if (existing?.type === "docker" && existing.container_id) {
    const running = await isContainerRunning(existing.container_id);
    if (running) {
      await syncSessionMountsToDocker(existing);
      return existing;
    }
    const started = await startContainer(existing.container_id);
    if (started) {
      await syncSessionMountsToDocker(existing);
      return existing;
    }
  }

  const image = config.image;
  const workspacePath = String(session.workspace_path);
  await mkdir(workspacePath, { recursive: true });

  const name = `maple_${String(session.id).replace(/[^a-zA-Z0-9_.-]/g, "_")}`;
  const namedContainerId = await getContainerIdByName(name);
  if (namedContainerId) {
    await startContainer(namedContainerId);
    const runtime: DockerRuntimeInfo = {
      type: "docker",
      container_id: namedContainerId,
      container_name: name,
      image,
      workspace_path: workspacePath
    };
    updateSessionMetadata(String(session.id), { runtime, sandbox_runtime: runtime });
    await syncSessionMountsToDocker(runtime);
    return runtime;
  }

  const networkPolicy = (config.networking as JsonRecord | undefined)?.mode;
  const network = networkPolicy === "none" ? "none" : "bridge";
  const { stdout } = await execFileAsync(dockerBin(), [
    "run",
    "-d",
    "--name",
    name,
    "--network",
    network,
    "-v",
    `${dockerWorkspaceMountSource(workspacePath)}:/workspace`,
    "-w",
    "/workspace",
    image,
    "sleep",
    "infinity"
  ]);
  const runtime: DockerRuntimeInfo = {
    type: "docker",
    container_id: stdout.trim(),
    container_name: name,
    image,
    workspace_path: workspacePath
  };
  updateSessionMetadata(String(session.id), { runtime, sandbox_runtime: runtime });
  await syncSessionMountsToDocker(runtime);
  return runtime;
}

export async function runDockerCommand(containerId: string, command: string, timeout: number) {
  return new Promise<{ stdout: string; stderr: string; exit_code: number }>((resolve) => {
    execFile(
      dockerBin(),
      ["exec", containerId, "bash", "-lc", command],
      { timeout, maxBuffer: 1024 * 1024 },
      (error, stdout, stderr) => {
        const exitCode = typeof (error as NodeJS.ErrnoException | null)?.code === "number" ? Number((error as NodeJS.ErrnoException).code) : 0;
        resolve({ stdout, stderr, exit_code: exitCode });
      }
    );
  });
}

async function isContainerRunning(containerId: string) {
  try {
    const { stdout } = await execFileAsync(dockerBin(), ["inspect", "-f", "{{.State.Running}}", containerId]);
    return stdout.trim() === "true";
  } catch {
    return false;
  }
}

async function startContainer(containerId: string) {
  try {
    await execFileAsync(dockerBin(), ["start", containerId], { timeout: 30_000 });
    return true;
  } catch {
    return false;
  }
}

async function getContainerIdByName(name: string) {
  try {
    const { stdout } = await execFileAsync(dockerBin(), ["ps", "-aq", "--filter", `name=^/${name}$`, "--format", "{{.ID}}"], {
      timeout: 10_000
    });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

async function syncSessionMountsToDocker(runtime: DockerRuntimeInfo) {
  const uploadRoot = join(runtime.workspace_path, ".session", "uploads");
  if (!existsSync(uploadRoot)) return;
  await execFileAsync(dockerBin(), ["exec", runtime.container_id, "bash", "-lc", "mkdir -p /mnt/session/uploads && cp -R /workspace/.session/uploads/. /mnt/session/uploads/"], {
    timeout: 30_000,
    maxBuffer: 512 * 1024
  }).catch(() => undefined);
}

function dockerWorkspaceMountSource(workspacePath: string) {
  const hostRoot = process.env.MAPLE_DOCKER_WORKSPACE_HOST_ROOT;
  if (!hostRoot) return workspacePath;
  return join(hostRoot, basename(workspacePath));
}

export async function assertDockerAvailable() {
  await execFileAsync(dockerBin(), ["info"], { timeout: 10_000 });
}

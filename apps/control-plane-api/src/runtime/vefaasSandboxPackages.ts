import { traceAsync } from "../perfTrace";
import type { EnvironmentPackage } from "./sandboxConfigTypes";
import { shellQuote } from "./runtimeCommon";
import type { VefaasSandboxRuntimeInfo } from "./runtimeTypes";
import { runVefaasSandboxCommand } from "./vefaasSandboxRuntime";

const MARKER_PATH = "/tmp/.maple_packages.json";
const INSTALL_TIMEOUT_MS = Number(process.env.MAPLE_SANDBOX_PACKAGE_INSTALL_TIMEOUT_MS || 180_000);

export type PackageProgress =
  | { phase: "started"; manager: string; name: string; index: number; total: number }
  | { phase: "log"; manager: string; name: string; chunk: string }
  | { phase: "finished"; manager: string; name: string; ok: boolean; duration_ms: number };

type ProgressFn = (event: PackageProgress) => void;

const packageKey = (pkg: EnvironmentPackage) => `${pkg.manager}:${pkg.name}`;

// Probe the sandbox marker, install only packages not already recorded, then refresh the marker.
// Installs are idempotent (pip/npm skip satisfied specs fast), so a lost marker just means a re-run,
// which is exactly the fallback when the serverless instance was recycled or the pool member changed.
export async function ensureSandboxPackages(
  runtime: VefaasSandboxRuntimeInfo,
  packages: EnvironmentPackage[],
  onProgress: ProgressFn = () => {}
) {
  if (!packages.length) return { installed: [], failed: [], skipped: 0 };
  return traceAsync("vefaas_sandbox.packages", { sandbox_id: runtime.sandbox_id, count: packages.length }, async () => {
    const present = await readMarker(runtime);
    const pending = packages.filter((pkg) => !present.has(packageKey(pkg)));
    if (!pending.length) return { installed: [], failed: [], skipped: packages.length };

    const installed: string[] = [];
    const failed: string[] = [];
    for (let index = 0; index < pending.length; index += 1) {
      const pkg = pending[index];
      onProgress({ phase: "started", manager: pkg.manager, name: pkg.name, index, total: pending.length });
      const ok = await installOnePackage(runtime, pkg, onProgress);
      onProgress({ phase: "finished", manager: pkg.manager, name: pkg.name, ok: ok.ok, duration_ms: ok.duration_ms });
      if (ok.ok) {
        installed.push(packageKey(pkg));
        present.add(packageKey(pkg));
      } else {
        failed.push(packageKey(pkg));
      }
    }
    await writeMarker(runtime, present);
    return { installed, failed, skipped: packages.length - pending.length };
  });
}

async function installOnePackage(runtime: VefaasSandboxRuntimeInfo, pkg: EnvironmentPackage, onProgress: ProgressFn) {
  const command = installCommand(pkg);
  const startedAt = Date.now();
  if (!command) {
    onProgress({ phase: "log", manager: pkg.manager, name: pkg.name, chunk: `unsupported package manager: ${pkg.manager}` });
    return { ok: false, duration_ms: 0 };
  }
  try {
    const result = await runVefaasSandboxCommand(runtime, command, INSTALL_TIMEOUT_MS, "/");
    const log = `${result.stdout || ""}${result.stderr || ""}`.trim();
    if (log) onProgress({ phase: "log", manager: pkg.manager, name: pkg.name, chunk: log.slice(-4_000) });
    return { ok: result.exit_code === 0, duration_ms: Date.now() - startedAt };
  } catch (error) {
    onProgress({ phase: "log", manager: pkg.manager, name: pkg.name, chunk: error instanceof Error ? error.message : String(error) });
    return { ok: false, duration_ms: Date.now() - startedAt };
  }
}

function installCommand(pkg: EnvironmentPackage): string | null {
  const spec = shellQuote(pkg.name);
  switch (pkg.manager) {
    case "pip":
      return `pip install ${spec} || pip3 install ${spec}`;
    case "npm":
      return `npm install -g ${spec}`;
    case "pnpm":
      return `pnpm add -g ${spec}`;
    case "apt":
      return `apt-get update && apt-get install -y ${spec}`;
    case "cargo":
      return `cargo install ${spec}`;
    case "go":
      return `go install ${spec}`;
    default:
      return null;
  }
}

async function readMarker(runtime: VefaasSandboxRuntimeInfo): Promise<Set<string>> {
  try {
    const result = await runVefaasSandboxCommand(runtime, `cat ${shellQuote(MARKER_PATH)} 2>/dev/null || true`, 15_000, "/");
    const parsed = JSON.parse(result.stdout.trim() || "[]");
    return new Set(Array.isArray(parsed) ? parsed.map(String) : []);
  } catch {
    return new Set();
  }
}

async function writeMarker(runtime: VefaasSandboxRuntimeInfo, keys: Set<string>) {
  const payload = JSON.stringify([...keys]);
  const encoded = Buffer.from(payload, "utf8").toString("base64");
  await runVefaasSandboxCommand(runtime, `printf %s ${shellQuote(encoded)} | base64 -d > ${shellQuote(MARKER_PATH)}`, 15_000, "/").catch(() => undefined);
}

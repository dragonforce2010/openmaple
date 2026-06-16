#!/usr/bin/env node
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const cliDir = dirname(fileURLToPath(import.meta.url));
const packageJson = JSON.parse(readFileSync(join(cliDir, "package.json"), "utf8"));
const version = packageJson.version || "0.0.0";
const sourceHash = hashSources(cliDir);
const binPath = join(tmpdir(), "maple-cli-go", `${process.platform}-${process.arch}-${version}-${sourceHash}`, "maple");
const goBin = process.env.GO_BINARY || (process.env.GOROOT && existsSync(join(process.env.GOROOT, "bin", "go")) ? join(process.env.GOROOT, "bin", "go") : "go");

if (!existsSync(binPath) || process.env.MAPLE_CLI_GO_REBUILD === "1") {
  mkdirSync(dirname(binPath), { recursive: true });
  const build = spawnSync(goBin, ["build", "-ldflags", `-X github.com/maple/cli/internal/build.Version=${version}`, "-o", binPath, "."], {
    cwd: cliDir,
    stdio: ["inherit", "pipe", "pipe"]
  });
  process.stdout.write(build.stdout || "");
  process.stderr.write(build.stderr || "");
  if (build.error) {
    console.error(build.error.message);
    process.exit(1);
  }
  if (build.status !== 0) process.exit(build.status ?? 1);
}

const run = spawnSync(binPath, process.argv.slice(2), { stdio: ["inherit", "pipe", "pipe"] });
process.stdout.write(run.stdout || "");
process.stderr.write(run.stderr || "");
if (run.error) {
  console.error(run.error.message);
  process.exit(1);
}
process.exit(run.status ?? 0);

function hashSources(baseDir) {
  const hash = createHash("sha256");
  for (const file of listFiles(baseDir)) {
    const rel = relative(baseDir, file);
    if (!shouldHash(rel)) continue;
    hash.update(rel);
    hash.update(readFileSync(file));
  }
  return hash.digest("hex").slice(0, 16);
}

function shouldHash(rel) {
  return rel === "go.mod" || rel.endsWith(".go") || rel.startsWith("skills/");
}

function listFiles(dir) {
  const entries = readdirSync(dir).sort();
  const files = [];
  for (const entry of entries) {
    if (entry === "node_modules" || entry === ".maple") continue;
    const path = join(dir, entry);
    const stats = statSync(path);
    if (stats.isDirectory()) files.push(...listFiles(path));
    else files.push(path);
  }
  return files;
}

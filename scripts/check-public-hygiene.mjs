import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const forbidden = [
  pattern(["bnpm", "byted", "org"].join("\\.")),
  pattern(["code", "byted", "org"].join("\\.")),
  pattern(["bytedance", "net"].join("\\.")),
  pattern(["byte", "cloud"].join("")),
  pattern(`${["ved", "bm"].join("")}-[a-z0-9.-]+`),
  pattern([["ivo", "lces"].join(""), "com"].join("\\."))
];

const tracked = spawnSync("git", ["ls-files"], { encoding: "utf8" });
if (tracked.status !== 0) {
  process.stderr.write(tracked.stderr || "git ls-files failed\n");
  process.exit(tracked.status || 1);
}

const failures = [];
for (const path of tracked.stdout.split("\n").filter(Boolean)) {
  if (!existsSync(path)) continue;
  if (isBinaryPath(path)) continue;
  const source = readFileSync(path, "utf8");
  for (const rule of forbidden) {
    const match = rule.exec(source);
    if (match) failures.push(`${path}: ${match[0]}`);
  }
}

if (failures.length) {
  console.error("Public hygiene check failed. Remove private/internal host references:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("public hygiene check passed");

function pattern(value) {
  return new RegExp(value, "i");
}

function isBinaryPath(path) {
  return /\.(png|jpg|jpeg|gif|webp|ico)$/i.test(path);
}

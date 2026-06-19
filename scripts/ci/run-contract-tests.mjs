import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const scripts = process.argv.slice(2);
const resultsDir = process.env.CI_TEST_RESULTS_DIR || "test-results/contracts";

if (!scripts.length) {
  console.error("Usage: bun scripts/ci/run-contract-tests.mjs <package-script>...");
  process.exit(2);
}

await mkdir(resultsDir, { recursive: true });

const cases = [];
let failures = 0;

for (const script of scripts) {
  const started = Date.now();
  const logPath = join(resultsDir, `${safeName(script)}.log`);
  console.log(`\n>>> bun run ${script}`);
  const result = await runScript(script, logPath);
  const seconds = (Date.now() - started) / 1000;
  const failed = result.code !== 0;
  if (failed) failures += 1;
  cases.push({ script, seconds, failed, code: result.code, signal: result.signal, logPath });
}

await writeFile(join(resultsDir, "junit.xml"), junit(cases, failures));
process.exit(failures ? 1 : 0);

function runScript(script, logPath) {
  return new Promise((resolve) => {
    const child = spawn("bun", ["run", script], { env: process.env });
    const log = createWriteStream(logPath);
    const pipe = (chunk) => {
      process.stdout.write(chunk);
      log.write(chunk);
    };

    child.stdout.on("data", pipe);
    child.stderr.on("data", pipe);
    child.on("error", (error) => {
      const message = `${error.message}\n`;
      process.stderr.write(message);
      log.write(message);
      log.end();
      resolve({ code: 1, signal: null });
    });
    child.on("close", (code, signal) => {
      log.end();
      resolve({ code: code ?? 1, signal });
    });
  });
}

function junit(cases, failures) {
  const body = cases.map((testCase) => {
    const attrs = [
      `classname="package.scripts"`,
      `name="${xml(testCase.script)}"`,
      `file="package.json"`,
      `time="${testCase.seconds.toFixed(3)}"`
    ].join(" ");
    if (!testCase.failed) return `    <testcase ${attrs}/>`;
    const status = testCase.signal ? `signal ${testCase.signal}` : `exit code ${testCase.code}`;
    return [
      `    <testcase ${attrs}>`,
      `      <failure message="${xml(status)}">${xml(`See ${testCase.logPath}`)}</failure>`,
      "    </testcase>"
    ].join("\n");
  }).join("\n");

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<testsuite name="openmaple-contracts" tests="${cases.length}" failures="${failures}">`,
    body,
    "</testsuite>",
    ""
  ].join("\n");
}

function safeName(value) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-");
}

function xml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

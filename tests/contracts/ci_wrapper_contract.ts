import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const successDir = mkdtempSync(join(tmpdir(), "maple-ci-wrapper-success-"));
const success = runWrapper(successDir, "test:bun-runtime");
assert.equal(success.status, 0, success.stderr || success.stdout);

const successXml = readFileSync(join(successDir, "junit.xml"), "utf8");
assert.match(successXml, /tests="1"/);
assert.match(successXml, /failures="0"/);
assert.match(successXml, /name="test:bun-runtime"/);
assert.match(successXml, /file="package.json"/);
assert.equal(existsSync(join(successDir, "test-bun-runtime.log")), true);

const failureDir = mkdtempSync(join(tmpdir(), "maple-ci-wrapper-failure-"));
const failure = runWrapper(failureDir, "missing:ci-wrapper-contract");
assert.notEqual(failure.status, 0, "missing script should fail through the wrapper");

const failureXml = readFileSync(join(failureDir, "junit.xml"), "utf8");
assert.match(failureXml, /tests="1"/);
assert.match(failureXml, /failures="1"/);
assert.match(failureXml, /name="missing:ci-wrapper-contract"/);
assert.match(failureXml, /<failure message=/);
assert.equal(existsSync(join(failureDir, "missing-ci-wrapper-contract.log")), true);

console.log("ci wrapper contract passed");

function runWrapper(resultsDir: string, script: string) {
  return spawnSync("bun", ["scripts/ci/run-contract-tests.mjs", script], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: { ...process.env, CI_TEST_RESULTS_DIR: resultsDir }
  });
}

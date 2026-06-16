import { writeFileSync } from "node:fs";
import { join } from "node:path";

export function writeFakeVefaasRuntimeDeployScript(dir: string, invokeUrl: string) {
  const script = join(dir, "fake_vefaas_runtime_deploy.py");
  writeFileSync(
    script,
    [
      "import json",
      "import os",
      "if not os.environ.get('VOLCENGINE_ACCESS_KEY') or not os.environ.get('VOLCENGINE_SECRET_KEY'):",
      "    raise SystemExit('missing Volcengine credentials')",
      "app_name = os.environ.get('MAPLE_VEFAAS_APP_NAME', 'maple-test-runtime')",
      "print(json.dumps({",
      `    'invoke_url': ${JSON.stringify(invokeUrl)},`,
      "    'function_id': app_name + '-fn',",
      "    'app_id': app_name + '-app',",
      "    'region': os.environ.get('MAPLE_VEFAAS_REGION', 'cn-beijing'),",
      "    'app_name': app_name,",
      "    'function_name': app_name + '-function'",
      "}))"
    ].join("\n")
  );
  return script;
}

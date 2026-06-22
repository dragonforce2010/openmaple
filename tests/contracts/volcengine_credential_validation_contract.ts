import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validateVolcengineCredentials } from "../../apps/control-plane-api/src/cloud/volcengineOpenApi";

const originalFetch = globalThis.fetch;
const originalValidation = process.env.MAPLE_VOLCENGINE_CREDENTIAL_VALIDATION;

try {
  process.env.MAPLE_VOLCENGINE_CREDENTIAL_VALIDATION = "on";
  let observedUrl = "";
  let observedBody = "";
  let observedAuthorization = "";
  globalThis.fetch = async (input, init) => {
    observedUrl = String(input);
    observedBody = String(init?.body ?? "");
    observedAuthorization = String((init?.headers as Record<string, string>).Authorization ?? "");
    return new Response(JSON.stringify({ ResponseMetadata: { RequestId: "req-ok" }, Result: { AccountId: "acct-1" } }), { status: 200 });
  };
  const valid = await validateVolcengineCredentials({ accessKey: "test-ak", secretKey: "test-sk", region: "cn-beijing" });
  assert.equal(valid.ok, true);
  assert.match(observedUrl, /Action=GetCallerIdentity/);
  assert.match(observedUrl, /Version=2018-01-01/);
  assert.equal(observedBody, "{}");
  assert.match(observedAuthorization, /Credential=test-ak\/\d{8}\/cn-beijing\/sts\/request/);

  globalThis.fetch = async () => new Response(JSON.stringify({
    ResponseMetadata: { RequestId: "req-bad", Error: { Code: "InvalidAccessKey" } }
  }), { status: 403 });
  const invalid = await validateVolcengineCredentials({ accessKey: "bad-ak", secretKey: "bad-sk", region: "cn-beijing" });
  assert.equal(invalid.ok, false);
  if (!invalid.ok) {
    assert.equal(invalid.error, "cloud_provider_credentials_invalid");
    assert.equal(invalid.provider_code, "InvalidAccessKey");
    assert.equal(invalid.request_id, "req-bad");
    assert.equal(invalid.message.includes("bad-ak"), false);
    assert.equal(invalid.message.includes("bad-sk"), false);
  }

  const tenantRoutes = readFileSync("apps/control-plane-api/src/routes/tenantRoutes.ts", "utf8");
  const workspaceRoutes = readFileSync("apps/control-plane-api/src/routes/workspaceRoutes.ts", "utf8");
  assert.match(tenantRoutes, /validateVolcengineCredentials[\s\S]*if \(!validation\.ok\)[\s\S]*upsertTenantCloudProvider/, "tenant cloud provider route must validate before saving credentials");
  assert.match(workspaceRoutes, /const onboardingCloudValidation = await validateWorkspaceVolcengineCredentials[\s\S]*if \(!onboardingCloudValidation\.ok\)[\s\S]*createWorkspaceOnboarding/, "onboarding must validate Volcengine credentials before creating resources");
  console.log("volcengine credential validation contract passed");
} finally {
  globalThis.fetch = originalFetch;
  if (originalValidation === undefined) delete process.env.MAPLE_VOLCENGINE_CREDENTIAL_VALIDATION;
  else process.env.MAPLE_VOLCENGINE_CREDENTIAL_VALIDATION = originalValidation;
}

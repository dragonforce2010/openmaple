# Agent test fix + veFaaS claude-agent-sdk runtime (2026-06-09)

## Problem
New agent → session test always failed (screenshot: "E2B Cloud Sandbox • failed", no reply).

Root cause: sessions ran the **veFaaS `anthropic_claude_code` loop**, but the deployed
veFaaS function had no `claude-agent-sdk` → every message returned
`HTTP 500: anthropic_claude_code requires claude-agent-sdk`. Bootstrap (E2B + veFaaS)
succeeded; the failure was the **run** call.

## Hard constraint discovered
**AWS Bedrock Anthropic is geo-blocked from China egress** (verified: claude CLI us-east-1
+ raw Converse us-west-2 → `400 unsupported region`). A cn-beijing veFaaS function hits the
same wall. The user's Bedrock token (`~/.claude/settings.aws.json`) is valid but unusable
from CN infra.

**Solution — ARK Anthropic-compatible endpoint:** Volcengine ARK exposes
`https://ark.cn-beijing.volces.com/api/coding` (Anthropic Messages format, NOT `/api/v3`).
claude-agent-sdk / claude CLI run **glm in-region** with no Bedrock, no geo-block:
```
ANTHROPIC_BASE_URL=https://ark.cn-beijing.volces.com/api/coding
ANTHROPIC_AUTH_TOKEN=$ARK_API_KEY
ANTHROPIC_MODEL=glm-4-7-251222
# do NOT set ANTHROPIC_API_KEY or CLAUDE_CODE_USE_BEDROCK
```
Reference: `~/workspace/workspace-demos/demo0608/demo4_third_party_model.py`.

## Fix 1 — local provider loop is the default (commit a2844c6)
So an agent can be tested without any external/veFaaS runtime.
- `server/agentLoopDrivers.ts`: default execution `external → provider`.
- `server/runner.ts`: run the provider loop first (`runProviderTurn`), provision the
  sandbox lazily (tools only). veFaaS/external loops only run when explicitly selected.
- `src/App.tsx` `quickEnvConfig`: `agent_runtime: { provider: "local" }` (uncommitted — file
  has unrelated in-progress edits; one-line, optional).
- **Verified:** session `sess_w3WYsV6wHF` → glm replied `PROVIDER_OK` in 2.47s, status idle.

Revert knob: `MAPLE_AGENT_LOOP_EXECUTION=external` + `MAPLE_AGENT_RUNTIME_PROVIDER=vefaas`.

## Fix 2 — veFaaS claude-agent-sdk container image (commits a2844c6, 8014f5a)
- `scripts/vefaas_runtime_app/Dockerfile`: python3.12 + node22 + `claude-agent-sdk` +
  `@anthropic-ai/claude-code` + `@openai/codex` (future). Domestic mirrors (aliyun apt /
  npmmirror node+npm / tsinghua pip) — a direct build hangs on CN network. `IS_SANDBOX=1`.
- `scripts/deploy_vefaas_runtime.py`: **image mode** (`MAPLE_VEFAAS_IMAGE=<url>` →
  `source_type=image`, `runtime=native/v1`, `port=8000`, `create_function` + direct
  `release_function`). The `inner-adk` application template rejects custom images, so image
  mode skips it. `build_runtime_envs` injects `IS_SANDBOX` + ARK envs + `ANTHROPIC_AUTH_TOKEN`
  as **function envs** (veFaaS does NOT inherit the image's ENV directives).

### Deployed artifacts (live, verified)
- Image: `agentkit-platform-2100050190-cn-beijing.cr.volces.com/agentkit/maple-runtime:ark`
- Function: `5w8r0fct` (released)
- APIG: upstream `ud8k12jv316pc5mfb6at0`, route `rd8k12jv316pc5mfb6atg`
- **invoke_url: `https://sd8ihq8v316pc5mf9c1j0.apigateway-cn-beijing.volceapi.com/maple-ark`**
  (written to `.env` `VEFAAS_INVOKE_URL`)
- **Verified live:** POST run → `message.content = "LIVE_VEFAAS_OK"`, no errors, 8.1s.
  Chain: invoke_url → APIG → veFaaS image fn → claude-agent-sdk → claude CLI → ARK
  `/api/coding` → glm-4-7.

## Reproduce the build + deploy
```bash
# build (amd64; domestic mirrors handle CN network)
docker build --platform linux/amd64 -t maple-vefaas-runtime:ark \
  -f scripts/vefaas_runtime_app/Dockerfile scripts/vefaas_runtime_app
# push: see /tmp/cr_push.py (CR get_authorization_token → docker login → tag → push)
# deploy image function:
MAPLE_VEFAAS_IMAGE="agentkit-platform-2100050190-cn-beijing.cr.volces.com/agentkit/maple-runtime:ark" \
MAPLE_VEFAAS_ENABLE_LOGS=false python3 scripts/deploy_vefaas_runtime.py
# APIG exposure (no LB for veFaaS upstream): see /tmp/apig_expose2.py
```

## Known / remaining
- APIG route lives on the existing web-app service `sd8ihq8v316pc5mf9c1j0` (reused gateway).
  A dedicated runtime gateway/service would be cleaner; the deploy script does not yet
  automate APIG for image mode (done manually here).
- Leftover `deploy_fail` applications (`maple-claude-rt-*`) from the template attempts are
  harmless debris (not deleted to avoid cascade-deleting function `5w8r0fct`).
- Codex CLI is baked into the image but the `codex_open_source` loop path is untested.

# veFaaS Sandbox Performance Optimization

## Goal

Use a real workspace configured with `sandbox_provider=vefaas` to measure the full Maple session path, identify bottlenecks by evidence, then optimize the slowest links without guessing.

## Constraints

- Do not print or commit secrets. Trace output records provider names, ids, counts, durations, and boolean credential presence only.
- Do not use `.managed-agents/platform.sqlite`; Maple data is remote MySQL through the worker-backed sync API.
- Do not delete test artifacts in bulk. Cleanup must target explicit ids/paths only.
- Preserve `agent_runtime` and `sandbox_runtime` as separate concepts.

## Files

- `apps/control-plane-api/src/perfTrace.ts`
- `apps/control-plane-api/src/infra/mysql.ts`
- `apps/control-plane-api/src/runtime/runtimeManager.ts`
- `apps/control-plane-api/src/runtime/runtimeTools.ts`
- `apps/control-plane-api/src/runtime/runtimeTypes.ts`
- `apps/control-plane-api/src/runtime/vefaasSandboxRuntime.ts`
- `apps/control-plane-api/src/runtime/vefaasSandboxOpenApi.ts`
- `tests/e2e/vefaas_sandbox_perf_e2e.ts`
- `package.json`

## Metrics

- `bootstrap_ms`: first control-plane data load, `/v1/bootstrap` equivalent when routed through API.
- `session_create_ms`: create session and assign runtime pool metadata.
- `sandbox_pool_replenish_ms`: create/refresh standby veFaaS sandbox members.
- `sandbox_ready_ms`: `markRuntimeReady()` end-to-end.
- `sandbox_claim_ms`: standby claim and health checks.
- `sandbox_prepare_ms`: workspace mkdir, host upload, session mount upload.
- `tool_bash_ms`, `tool_write_file_ms`, `tool_read_file_ms`, `tool_list_files_ms`, `tool_grep_ms`.
- `sync_workspace_to_host_ms`: post-command artifact sync.
- `detail_summary_ms`, `detail_full_ms`: session detail read paths.
- `db_query_ms`: optional MySQL worker query timings with `MAPLE_PERF_TRACE_DB=1`.

## Plan

- [x] Add gated JSON-line performance tracing (`MAPLE_PERF_TRACE=1`).
- [x] Add runtime and veFaaS sandbox spans around the known hot path.
- [x] Add real `vefaas sandbox` perf E2E using project `.env` and skip cleanly when required bindings are absent.
- [x] Run baseline on a real `sandbox_provider=vefaas` workspace.
- [x] Optimize the worst measured bottleneck first.
- [x] Re-run baseline and compare before/after p50/p95/max where repeat count permits.

## Expected First Bottlenecks

- `vefaas_sandbox.ensure`: repeated `CreateSandbox` when stored `gateway_url` and config `gateway_url` differed only by a trailing slash.
- `vefaas_sandbox.ensure`: hot reuse still paid `DescribeSandbox`, best-effort `ResumeSandbox`, `SetSandboxTimeout`, and `mkdir -p` gateway command.
- `runtime.tool.bash`: shell tools are dominated by gateway shell command latency plus post-command artifact sync.
- Session live UI: SSE event fan-out currently triggers full detail fetches.
- `agent_runtime=vefaas`: remote `run` currently emits visible delta only after the full remote response.

## Verification

- `rtk env PATH=/Users/bytedance/.bun/bin:/usr/bin:/bin:/usr/sbin:/sbin /Users/bytedance/.bun/bin/bun run typecheck`
- `rtk env PATH=/Users/bytedance/.bun/bin:/usr/bin:/bin:/usr/sbin:/sbin /Users/bytedance/.bun/bin/bun run lint`
- `rtk env PATH=/Users/bytedance/.bun/bin:/usr/bin:/bin:/usr/sbin:/sbin /Users/bytedance/.bun/bin/bun run test:vefaas-sandbox`
- `rtk env PATH=/Users/bytedance/.bun/bin:/usr/bin:/bin:/usr/sbin:/sbin /Users/bytedance/.bun/bin/bun run test:vefaas-sandbox-perf`

## Baseline Results

Real workspace: `ws_g0VdNVB6th` (`Space STG`), `function_id=itjiomeq`, `region=cn-beijing`. Pool claim and auto-replenish disabled for isolation.

| Metric | Baseline ms | After URL reuse fix ms | Final ms |
| --- | ---: | ---: | ---: |
| `runtime_mark_ready` | 2841.29 | 2871.40 | 2909.23 |
| `tool_write_file` | 2719.76 | 394.60 | 121.33 |
| `tool_read_file` | 3285.46 | 511.95 | 109.43 |
| `tool_list_files` | 2748.23 | 344.28 | 154.50 |
| `tool_bash` | 3247.40 | 778.67 | 376.36 |
| `tool_grep` | 2992.93 | 638.36 | 319.77 |
| `scripted_turn` | 3431.74 | 760.35 | 457.37 |
| `detail_summary` | 58.38 | 93.54 | 48.09 |
| `detail_full` | 111.60 | 102.83 | 95.80 |

Initial bottleneck: every tool call recreated a sandbox. Trace showed `vefaas_sandbox.openapi CreateSandbox` around 2300-2500ms before each tool.

## Optimization Results

Changes:

- Normalize trailing slash in `isSameVefaasSandbox()` so compatible stored/configured gateway URLs reuse the same sandbox.
- Store `last_ready_at` on the session runtime and skip `ResumeSandbox`/`SetSandboxTimeout` during `MAPLE_VEFAAS_SANDBOX_REUSE_READY_TTL_MS` (default 30000ms).
- Skip hot reuse workspace `mkdir -p` while the runtime is recently ready; keep session mount sync and stale sandbox retry in `executeTool()`.
- Add gated perf spans for MySQL, runtime ensure, veFaaS OpenAPI, gateway calls, tool calls, and session detail reads.
- Split Volcengine OpenAPI signing into `vefaasSandboxOpenApi.ts` to keep `vefaasSandboxRuntime.ts` under the 400-line hard cap.

Final trace:

- Cold start remains dominated by `CreateSandbox`: 2428.18ms, `runtime_mark_ready`: 2909.23ms.
- Hot `vefaas_sandbox.ensure`: 35-80ms after skipping OpenAPI and `mkdir -p`.
- File gateway APIs: 16-25ms.
- Shell gateway commands: 232-233ms for `bash`/`grep`; now the main residual tool-path cost.
- Test cleanup verified: final perf session deleted, `VeFaaS Sandbox Perf Agent` count is 0.

# OpenMaple Provider Readiness

This matrix is for platform teams evaluating whether OpenMaple can represent their runtime, sandbox, storage, model, and identity boundaries.

OpenMaple is early public software. Treat this file as an evidence map, not as a production support promise.

## Status Legend

| Status | Meaning |
|---|---|
| Runnable locally | Works in the self-contained local trial path without external cloud credentials. |
| Implemented with credentials | Code path exists, contracts cover the boundary, and real use requires provider credentials or deployed provider resources. |
| Configuration stub | Config shape exists, but the adapter currently throws a not-implemented error. |
| Not claimed | No current repo-visible implementation claim. |

## Agent Runtime Layer

| Provider path | Status | What exists today | Required evidence before production use |
|---|---|---|---|
| Local provider loop | Runnable locally | `MAPLE_AGENT_RUNTIME_PROVIDER=local` runs the control-plane/provider loop with OpenAI-compatible model configs. | Your model endpoint, workspace auth policy, and session event retention settings. |
| veFaaS agent runtime | Implemented with credentials | `ensureVefaasRuntime` and `invokeVefaas` send bootstrap/run actions to a deployed runtime function. Contract tests cover bootstrap, bridge tools, events, and session resources. | A deployed runtime function, invoke URL, API key policy, region limits, and operational runbook. |
| AWS Lambda agent runtime | Configuration stub | Config normalization accepts `aws_lambda`, but `ensureAwsLambdaRuntime` currently throws `AWS Lambda agent runtime provider is configured but the invoke adapter is not implemented yet.` | Invoke adapter, IAM model, packaging story, timeout behavior, and contract tests. |

## Sandbox Runtime Layer

| Provider path | Status | What exists today | Required evidence before production use |
|---|---|---|---|
| local_docker | Runnable locally | `ensureDockerRuntime` starts a per-session Docker container, mounts the session workspace, and executes shell/file tools. | Host isolation policy, image hardening, network policy, and cleanup strategy. |
| E2B | Implemented with credentials | `ensureE2BRuntime` creates/connects E2B sandboxes, syncs session files, and runs shell/file tools. | `E2B_API_KEY`, template policy, file-size limits, timeout policy, and cost controls. |
| veFaaS sandbox | Implemented with credentials | `ensureVefaasSandboxRuntime` creates/resumes sandboxes through OpenAPI, supports gateway shell/file tools, and integrates workspace sandbox pools. | Volcengine credentials, sandbox function ID, gateway URL, network policy, pool sizing, and kill/resume runbooks. |
| Vercel sandbox | Configuration stub | Config normalization accepts `vercel`, but `ensureVercelSandboxRuntime` currently throws `Vercel sandbox provider is configured but the sandbox adapter is not implemented yet.` | Sandbox API adapter, file/tool contract, auth model, timeout semantics, and contract tests. |

## Storage, Model, And Identity Boundaries

| Boundary | Status | What exists today | Required evidence before production use |
|---|---|---|---|
| Control-plane database | Runnable locally / implemented with MySQL | Docker Compose starts MySQL 8; the API uses a MySQL worker bridge behind the synchronous store API. | Managed MySQL/RDS configuration, backup/restore, migration process, and latency budget. |
| Session files and artifacts | Implemented control-plane boundary | File/artifact endpoints and session resource manifests are represented in the API and runtime bridges. | Object storage backend, retention policy, presigned URL expiry, and artifact access controls. |
| Model access | Implemented through OpenAI-compatible endpoints | `resolveModelTarget` routes model configs into `/chat/completions`; workspace model configs scope API keys and defaults. | Provider-specific rate limits, data policy, fallback policy, and model approval process. |
| Local dev login | Runnable locally | Compose enables `MAPLE_DEV_LOGIN=true` for the local trial path. | Production identity provider, OAuth callback configuration, tenant/workspace membership policy. |
| MCP and vault credentials | Implemented control-plane boundary | Vault credentials use references, and MCP OAuth/token injection is represented before runtime serialization. | Provider-specific OAuth apps, secret rotation policy, audit export, and workspace approval process. |

## Adapter Priority Questions

Before building a new adapter, answer these questions in a GitHub Discussion:

1. Which boundary causes the lock-in risk: agent runtime, sandbox runtime, model access, storage, identity, or artifact delivery?
2. Does the provider need to host the agent loop, only tool execution, or both?
3. What is the minimum contract: bootstrap, run, shell exec, file read/write, file list, grep, event callback, artifact upload, or pool health?
4. Which credentials belong at tenant, workspace, environment, or session scope?
5. Which failure should be visible in the session event log versus hidden behind provider retries?

## Evidence Handles

- Runtime config types: `apps/control-plane-api/src/runtime/sandboxConfigTypes.ts`
- Runtime normalization: `apps/control-plane-api/src/runtime/sandboxConfig.ts`
- Runtime selection: `apps/control-plane-api/src/runtime/runtimeManager.ts`
- Docker sandbox: `apps/control-plane-api/src/runtime/dockerRuntime.ts`
- E2B sandbox: `apps/control-plane-api/src/runtime/e2bRuntime.ts`
- veFaaS agent runtime: `apps/control-plane-api/src/runtime/vefaasAgentRuntime.ts`
- veFaaS sandbox runtime: `apps/control-plane-api/src/runtime/vefaasSandboxRuntime.ts`
- Model gateway: `apps/control-plane-api/src/catalog/modelGateway.ts`
- MySQL adapter: `apps/control-plane-api/src/infra/mysql.ts`
- Contracts: `tests/contracts/vefaas_runtime_contract.ts`, `tests/contracts/vefaas_sandbox_contract.ts`, `tests/contracts/workspace_runtime_pool_contract.ts`

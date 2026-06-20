# OpenMaple Roadmap

OpenMaple is an open-source managed-agent control plane. The roadmap is organized around proof that platform teams can inspect, run, and extend.

## Now

- Keep the public repo runnable with a self-contained Docker Compose stack.
- Make the console, REST API, SDK, and CLI follow the same resource model.
- Keep real product screenshots and examples current with the running system.
- Maintain public hygiene checks so internal hosts, credentials, and private launch material do not enter the repo.

## Next

- Add more runnable examples for session streaming, vault credentials, deployment runs, and provider adapters.
- Improve first-run onboarding for local Docker, E2B, and veFaaS-backed sandboxes.
- Publish provider-readiness notes that separate demo paths, beta paths, and production-ready paths.
- Expand SDK examples for TypeScript projects that want to embed managed-agent sessions.

## Later

- Harden multi-tenant operations around audit export, workspace policy, and long-running session recovery.
- Add reference adapters for more runtime, sandbox, model, and artifact storage providers.
- Document upgrade and migration paths for teams running OpenMaple as an internal platform.
- Add public benchmark methodology after reproducible harnesses exist in the repo.

## Non-Goals

- OpenMaple is not an official Anthropic product.
- OpenMaple will not claim production adoption, benchmarks, or provider readiness without repo-visible evidence.
- OpenMaple will not optimize for one cloud provider at the expense of runtime, sandbox, model, or storage portability.

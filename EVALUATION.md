# OpenMaple Evaluation Guide

This guide is for platform, infra, and enterprise IT teams deciding whether OpenMaple is worth a local trial.

OpenMaple is early public software. Evaluate it as an open managed-agent control plane, not as a hosted cloud product or an official Anthropic release.

## When OpenMaple Fits

Use OpenMaple as a starting point when you need:

- A self-hostable control plane for agents, sessions, sandboxes, runtime pools, vaults, SDK, CLI, and audit logs.
- Provider boundaries around runtime, sandbox, storage, model access, and cloud identity.
- A product-shaped codebase that can be forked, audited, and extended by an internal platform team.
- A path from UI workflow to REST automation to SDK or CLI integration.

OpenMaple is the wrong fit when you only need:

- A single local agent demo.
- A hosted managed-agent SaaS with external support guarantees.
- A fully mature provider matrix where every adapter is production-proven today.
- A pure model gateway with no session, sandbox, vault, or event-log surface.

## 30-Minute Evaluation Path

| Timebox | Check | Evidence to collect |
|---|---|---|
| 0-5 min | Read the repo boundary | README, license, public screenshots, release, CI status, and this guide. |
| 5-15 min | Run the local control plane | Open [GitHub Codespaces](https://codespaces.new/dragonforce2010/openmaple?quickstart=1) or run locally with `docker compose up --build`, then `npm run smoke:local`, `GET /health`, and browser access to `http://127.0.0.1:27951/`. |
| 15-20 min | Inspect managed-agent resources | Create or review agent, environment, session, vault, runtime pool, and event-log resources in the console. |
| 20-25 min | Check automation paths | Confirm the REST API, `maple-agent-sdk`, and `maple-agent-cli` map to the same resource model. |
| 25-30 min | Decide the next adapter | Read [provider readiness](PROVIDER_READINESS.md), then pick the runtime, sandbox, storage, or model provider your team would need before a deeper trial. |

The goal is not to prove production readiness in 30 minutes. The goal is to decide whether the architecture is credible enough for a real internal spike.

## Acceptance Criteria

A successful first evaluation should prove:

- The control plane, web console, local dev login, and MySQL-backed storage start locally without external cloud credentials.
- Console, API, SDK, and CLI describe the same managed-agent lifecycle.
- AgentRuntime and SandboxRuntime are separated in the model, not just in copy.
- Session events preserve durable state for messages, tool calls, status changes, artifacts, failures, and runtime metadata.
- Vault-backed credentials are referenced by sessions instead of passed as raw secrets.
- Provider choices are visible enough that your team can identify where a cloud-specific adapter would live.
- Provider readiness is explicit enough that your team can distinguish runnable paths, credentialed paths, and configuration stubs.

Stop the trial if you cannot prove those points from the current repo, running app, or source code. Treat real model calls and external sandbox execution as a second-stage check that requires the matching provider keys and environment settings.

## Questions To Ask Before Forking

1. Does the `Agent -> Environment -> Session -> Event Log` model match your internal platform vocabulary?
2. Which provider layer creates the most lock-in risk for your team: runtime, sandbox, storage, model access, or identity?
3. Which adapter would you need first: AWS Lambda, Alibaba FC, Vercel Sandbox, S3/GCS, an internal Kubernetes runner, or another path?
4. What audit trail does your security team need for agent messages, tool calls, credentials, files, and artifacts?
5. Which workflows must stay UI-driven, and which must become API, SDK, or CLI automation?

## Provider Portability Checklist

Before calling OpenMaple provider-portable enough for your environment, verify that the provider you care about can be represented through these boundaries:

- **Runtime**: where the agent loop runs, how pool members are provisioned, and how health is reported.
- **Sandbox**: where tools execute, how files and artifacts move, and what network boundary applies.
- **Storage**: where session artifacts and files persist.
- **Model access**: which model provider or local endpoint handles reasoning.
- **Identity and credentials**: how tenant or workspace identity maps to provider credentials.

If a provider cannot fit one of these boundaries cleanly, open a discussion before writing a large adapter.

## Current Public Proof

- Real product screenshots are in [assets/screenshots](assets/screenshots/).
- The website renders those screenshots directly: [dragonforce2010.github.io/openmaple](https://dragonforce2010.github.io/openmaple/).
- The public release is [v0.2.1](https://github.com/dragonforce2010/openmaple/releases/latest).
- Provider status is tracked in [provider readiness](PROVIDER_READINESS.md).
- Feedback and provider-priority discussion lives in [Discussion #30](https://github.com/dragonforce2010/openmaple/discussions/30).

# OpenMaple Media Kit

Use this kit when presenting OpenMaple in a GitHub launch post, video, newsletter, community thread, or engineering-team demo. Keep every claim tied to current repo evidence.

## One-Line Positioning

OpenMaple is an open-source managed-agent control plane for teams that want Anthropic-style long-horizon agents without cloud lock-in.

## Short Pitch

OpenMaple turns agent prototypes into managed cloud software. It separates the brain from the hands: agent loops run through runtime providers, tool execution runs in sandboxes, secrets stay in vaults, and every session becomes a durable event log. Teams get a web console, REST API, SDK, CLI, runtime pools, sandbox pools, provider identity, and real product modules they can self-host and extend.

OpenMaple is not an Anthropic official product. It is an open implementation of the managed-agent platform pattern.

## Proof Assets

| Asset | Path | Use |
|---|---|---|
| Deployments console | `docs/site/screenshots/current-console-deployments.png` | GitHub README hero, launch post hero, website first viewport. |
| Quickstart builder | `docs/site/screenshots/current-console-quickstart.png` | Demo opener: intent to runnable agent path. |
| Agents registry | `docs/site/screenshots/current-console-agents.png` | Show managed resource model. |
| Sessions event log | `docs/site/screenshots/current-console-sessions.png` | Show event-as-truth and observability. |
| Environments | `docs/site/screenshots/current-console-environments.png` | Show runtime/sandbox provider split. |
| Credential vaults | `docs/site/screenshots/current-console-vaults.png` | Show secrets by reference and MCP credential flow. |
| Social card source | `marketing/launch/social-card.html` | 1200x630 launch card source built from real product screenshots. |
| Social card PNG | `marketing/launch/openmaple-social-card.png` | Ready-to-share image for posts after regeneration. |
| Website | `https://dragonforce2010.github.io/openmaple/` | Shareable product landing page. |
| Docs | `https://dragonforce2010.github.io/openmaple/docs/` | Developer follow-up path. |
| Repo | `https://github.com/dragonforce2010/openmaple` | Primary star/clone target. |

## Demo Spine

1. Open the website and state the thesis: managed agents need a control plane, not a pile of scripts.
2. Show the quickstart builder creating a runnable agent path.
3. Show the agents registry, environments, and credential vaults as managed resources.
4. Show a session event log and explain why session state lives outside the model context window.
5. Show CLI and SDK snippets from `README.md`.
6. Close with the portability point: runtime, sandbox, storage, model, and cloud identity are provider choices.

## Launch Titles

- OpenMaple: open-source managed agents without cloud lock-in
- I built an open-source control plane for long-running agents
- Stop shipping agent demos. Ship managed agents.
- Anthropic's managed-agent idea, implemented as an open stack
- A self-hostable platform for sessions, sandboxes, runtimes, vaults, SDKs, and CLI agents

## Platform Copy

### GitHub / X / Hacker News Style

OpenMaple is an open-source managed-agent control plane: sessions, sandboxes, runtimes, vault-backed tools, event logs, SDK, CLI, and provider adapters.

The goal is simple: give teams an Anthropic-style managed-agent platform without locking the runtime, sandbox, storage, or model layer to one cloud.

Repo: https://github.com/dragonforce2010/openmaple
Docs: https://dragonforce2010.github.io/openmaple/docs/

### Bilibili / YouTube Description

OpenMaple 是一个开源 managed agent 平台。它把 Agent 从本地 demo 升级成可运营的云软件：控制台、REST API、SDK、CLI、Session Event Log、Runtime Pool、Sandbox Pool、Credential Vault、Cloud Provider Identity 都在同一套工程栈里。

核心理念来自 Anthropic Managed Agents: brain 和 hands 解耦。AgentRuntime 负责模型和 agent loop，SandboxRuntime 负责工具执行和文件副作用，Session Event Log 负责持久状态和审计。

GitHub: https://github.com/dragonforce2010/openmaple
Docs: https://dragonforce2010.github.io/openmaple/docs/

### 小红书 / 快手 Caption

我把 managed agent 平台做成了一个开源 repo: OpenMaple。

它不是单个 agent demo，而是一整套控制面：Agent、Session、Runtime、Sandbox、Vault、API、SDK、CLI、Provider Adapter。

适合想自己搭企业级 Agent 平台、又不想被单一云厂商绑定的工程团队。

## Claims To Avoid

- Do not say OpenMaple is an official Anthropic product.
- Do not imply every listed provider is production-ready unless the current docs and code path prove it.
- Do not use generated UI shots as product proof. Public screenshots must come from the current real running system.
- Do not promise a star count, adoption number, benchmark result, or customer count without current evidence.

## Visual Standard

Use real console screenshots first. Generated images or HyperFrames videos can support the launch, but they cannot replace product proof. The first visual should show the current product surface, not an abstract AI illustration.

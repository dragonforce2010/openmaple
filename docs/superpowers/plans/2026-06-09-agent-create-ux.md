# Agent creation UX optimization

## Scope

- Tighten Quickstart natural-language agent creation flow against `ui-design/quickstart.mp4`.
- Fix code-card height, auto-scroll, environment choice, MCP OAuth entry feedback, Agent detail tabs, and Create Agent modal layout.

## Files

- `src/App.tsx`
- `src/styles.css`
- `server/index.ts` only if OAuth metadata/response needs adjustment

## Tasks

- [x] Add stable auto-scroll for Quickstart conversation and preview chat.
- [x] Give Quickstart API/code cards fixed internal scroll height and better button spacing.
- [x] Hide sandbox-provider choice from Environment creation and Quickstart; expose only E2B networking options.
- [x] Split Agent detail into tabs: Agent, Sessions, Runtime, Integration, Config.
- [x] Make AgentCreate modal template path show config immediately and keep Create button visible.
- [x] Improve MCP OAuth connect feedback for configured vs unconfigured providers.
- [x] Run typecheck/build or equivalent local verification.

# Maple API/SDK documentation reference plan

## Goal

Replace the current placeholder Documentation page with a truth-grounded Maple API/SDK reference. The page must describe the current REST API and SDK surface for authentication, agents, sessions, environments, vaults, MCP credentials, and common errors without inventing unsupported fields or packages.

## Evidence Sources

- `server/index.ts`: route list, request schemas, status codes, and error payloads.
- `server/store.ts`: persisted response fields for agents, environments, sessions, vaults, and credentials.
- `src/types.ts`: frontend wire types shown by the console.
- `sdk/index.mjs` and `sdk/index.d.ts`: official SDK methods and auth behavior.
- `scripts/platform_sdk_cli_contract.ts`: verified SDK/CLI integration example.
- `package.json`: verification commands and real script names.

## Files

- `src/App.tsx`: update `DocumentationView` navigation and page contents.
- `scripts/maple_docs_contract.ts`: add a focused contract that blocks fake docs/package names and checks key documented endpoints/methods.
- `package.json`: add `test:maple-docs` script if needed.

## Implementation Tasks

- [ ] Expand docs navigation to include Agents, Sessions, Environments, Vaults, MCP, Errors, and SDK.
- [ ] Replace placeholder host, package, token, event, rate-limit, and SDK examples with current Maple examples.
- [ ] Document real request and response fields for `POST /v1/agents`, `POST /v1/environments`, `POST /v1/sessions`, `POST /v1/vaults`, and `POST /v1/vaults/:vaultId/credentials`.
- [ ] Document real auth headers: `X-Maple-API-Key`, `Authorization: Bearer maple_ws_...`, and `maple_session` cookie behavior from SDK.
- [ ] Document MCP OAuth start/callback behavior for vault credentials and user-managed MCP servers.
- [ ] Add docs contract test covering removed placeholders and required API/SDK anchors.
- [ ] Run focused contract, typecheck, build, and browser smoke for the docs page.

## Verification

- `bun run test:maple-docs`
- `bun run test:maple-branding`
- `bun run typecheck`
- `bun run build`
- Browser smoke: open local web app, navigate to Documentation, check docs render without console/page errors.

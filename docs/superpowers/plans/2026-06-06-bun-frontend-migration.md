# Bun Frontend Migration

## Objective
Replace the Vite frontend dev/build path with Bun's native HTML import and bundler while keeping the existing React UI, API server, ports, E2E harness, and package-manager choice.

## Assumptions
- Bun remains the package manager and runtime for project scripts.
- The API server stays on `server/index.ts` and defaults to `127.0.0.1:8787`.
- The web dev server should keep the existing default web port `5173`.
- Frontend `/v1/*` and `/health` requests still proxy to the API server during dev and E2E.

## Commands
- Dev all: `bun run dev`
- Dev web only: `bun run dev:web`
- Build: `bun run build`
- Preview built app: `bun run preview`
- Typecheck: `bun run typecheck`
- E2E: `bun run test:e2e`

## Files
- Add `server/web.ts` as the Bun frontend server.
- Update `package.json` scripts and remove Vite dependencies.
- Update `scripts/e2e.mjs` web auto-start command.
- Update `tsconfig.json` include list.
- Remove `vite.config.ts` after equivalent Bun server behavior exists.
- Update `scripts/bun_runtime_contract.ts` so the contract guards against Vite reintroduction.

## Tasks
- [x] Add Bun web server with HTML import, SPA fallback, API proxy, HMR in dev, and static production serving.
- [x] Replace `dev:web`, `build`, and `preview` scripts with Bun-native commands.
- [x] Remove Vite packages and config from tracked sources.
- [x] Update E2E auto-start to launch the Bun web server.
- [x] Run targeted verification: Bun runtime contract, typecheck, build, and web smoke.

## Success Criteria
- `package.json` no longer references `vite` or `@vitejs/plugin-react`.
- `vite.config.ts` is deleted.
- `bun run build` produces a frontend bundle without Vite.
- `bun run dev:web` serves `index.html` on port `5173` and proxies API routes.
- `scripts/e2e.mjs` no longer starts Vite.

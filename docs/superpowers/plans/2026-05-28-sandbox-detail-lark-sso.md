**Goal:** Add configurable sandbox infrastructure with E2B as the default, preserve local Docker support, expand resource detail/editing surfaces, and move Lark SSO to a Lark OpenAPI authorization-code flow.

**Architecture:** Keep the current Express + SQLite + React structure. Introduce a runtime abstraction in `server/runtime.ts` so environments choose `sandbox.provider`/`type` from persisted config. E2B runtime metadata is stored on session metadata and workspace file tools continue to use the host workspace as the durable source of truth. Docker remains the local container executor. Detail APIs stay REST-first and hydrate existing SQLite rows plus filesystem-backed skill tree/content.

**Files:**
- `server/runtime.ts`: runtime provider config normalization, Docker runtime adapter, E2B runtime adapter, command/list/grep dispatch.
- `server/store.ts`: seed default E2B environment and keep Docker environment as explicit local option.
- `server/auth.ts`, `server/index.ts`: Lark OpenAPI OAuth defaults and redirect callback behavior.
- `server/skillFiles.ts`: safe tree/read/write operations under indexed skill directories.
- `src/types.ts`, `src/App.tsx`, `src/styles.css`: detail views, environment provider form, skill file browser/editor, Lark login button.
- `.env.example`, `README.md`, `SPEC.md`: configuration and behavior docs.

**Commands:**
- `npm run typecheck`
- `npm run build`
- Optional/manual when Docker/provider credentials are available: `npm run test:e2e`

**Expected Results:**
- New environments default to E2B and persist `config.sandbox.provider = "e2b"`.
- Existing Docker environments keep working with `config.type = "local_docker"` or `config.sandbox.provider = "local_docker"`.
- The project exposes the requested E2B API key through environment defaults and `.env.example`.
- Resource pages expose detail/settings panels for agents, environments, vaults, memory, skills, templates, users, model pool, and artifacts.
- Skills page can open a skill, browse its directory tree, read file contents, edit allowed text files, and save them.
- Lark SSO start uses Lark OpenAPI defaults when `LMAP_LARK_APP_ID`/`LMAP_LARK_APP_SECRET` are configured, redirecting unauthenticated users to login and completing login after callback.

**Tasks:**
- [x] Add runtime configuration normalization and E2B adapter.
- [x] Seed and create E2B environments by default.
- [x] Add skill filesystem detail APIs.
- [x] Add detail endpoints for current resource types where needed.
- [x] Implement Lark OpenAPI SSO defaults and UI redirect path.
- [x] Update React resource pages to show detail/settings and skill file editor.
- [x] Update docs and run build verification.
- [x] Summarize the E2B-as-agent-runtime design tradeoff.

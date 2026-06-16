# Ai Pair Architecture Evolution Plan

**Goal:** Convert the current managed-agents platform from feature-complete MVP slices into stable contracts for runtime providers, skill management, templates, auth identity, and verification.

**Agent Team Inputs:**

- Spec/E2E reviewer found missing hard assertions for Computer Use evidence, required button audit coverage, template JSON/category edits, skill symlinks, UI skill persistence reread, and exact provider/tool event types.
- Architecture reviewer found coupling in `server/runtime.ts`, missing session-level runtime locks, weak runtime policy enforcement, best-effort E2B sync semantics, Skill Creation Protocol gaps, static Quickstart templates, and provider/email identity collision risk.

## Architecture Direction

Keep the current Express + SQLite + React structure, but promote several modules into explicit contracts:

- `RuntimeProvider`: `ensure`, `exec`, `read`, `write`, `list`, `grep`, `sync`, `dispose`, and `capabilities`.
- `RuntimeLease`: per-session lock preventing duplicate Docker containers or E2B sandboxes during concurrent bootstrap/message sends.
- `SkillService`: official `~/.agents/skills` creation path, seven-client symlink verification, and validator-backed writes.
- `TemplateService`: schema/versioned reusable templates consumed by Quickstart, not only managed on a resource page.
- `AuthIdentityService`: `(provider, subject)` identity records, with email as display/merge metadata rather than the unique login key.
- `VerificationEvidence`: automated Playwright evidence plus separate GUI Computer Use evidence when desktop validation is requested.

## Tasks

- [ ] Runtime provider contract
  - Files: `server/runtime.ts`, `server/runner.ts`, `server/types.ts`.
  - Expected result: runtime dispatch no longer relies on a growing switch; Docker and E2B implement the same capability interface.
  - Verification: concurrent bootstrap/message test creates one runtime per session and records one runtime-ready transition.

- [ ] Runtime policy and workspace sync
  - Files: `server/runtime.ts`, `server/artifacts.ts`, `SPEC.md`.
  - Expected result: workspace path checks and network capability decisions are enforced before provider execution; E2B sync records synced/skipped files with reasons.
  - Verification: path escape attempts fail before Docker/E2B calls; E2B text artifact exact-content test still passes.

- [ ] Skill service hardening
  - Files: `server/skillWriter.ts`, `server/skillFiles.ts`, `scripts/e2e.mjs`.
  - Expected result: skill creation follows the source-of-truth path, verifies seven symlinks, preserves existing skill body where possible, and rejects invalid `SKILL.md`.
  - Verification: `quick_validate.py ~/.agents/skills/<name>` exits 0 for platform-created skills.

- [ ] Template closure into Quickstart
  - Files: `server/index.ts`, `server/store.ts`, `src/App.tsx`, `scripts/e2e.mjs`.
  - Expected result: Quickstart reads user-created templates and uses the selected template payload when generating drafts.
  - Verification: UI-created template appears in Quickstart without reload and changes generated draft inputs.

- [ ] Lark SSO identity model
  - Files: `server/auth.ts`, `server/store.ts`, `server/index.ts`, `scripts/e2e.mjs`.
  - Expected result: Lark callback stores provider subject separately from local email login.
  - Verification: same email via local and Lark does not overwrite provider metadata; bad state callback is rejected.

- [ ] Evidence gates
  - Files: `docs/acceptance/e2e-test-suite.md`, `scripts/e2e.mjs`, `docs/acceptance/computer-use-validation-*.md`.
  - Expected result: `npm run test:all` proves automated gates; Computer Use produces a separate dated evidence note.
  - Verification: final report includes command outputs and Computer Use observations.

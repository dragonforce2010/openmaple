# OpenMaple launch readiness

## Goal

Tighten the public repo surface so a new developer can understand the thesis, inspect real product evidence, run the project, and reuse launch materials without asking for context.

## Files

- `README.md`
- `index.html`
- `docs/launch/media-kit.md`
- `docs/launch/social-card.html`
- `docs/launch/openmaple-social-card.png`
- `docs/superpowers/plans/2026-06-20-openmaple-launch-readiness.md`

## Tasks

- [x] Verify public GitHub state, current star count, and remote tracking state.
- [x] Preserve existing GitHub CI / Pages workflow files by branching from `github/main`.
- [x] Sharpen README first viewport around open-source managed agents without cloud lock-in.
- [x] Add proof-oriented README section that maps claims to repo evidence.
- [x] Add reusable launch media kit with positioning, assets, scripts, copy, and claims to avoid.
- [x] Add a reusable 1200x630 social card source based on current product screenshots.
- [x] Run docs/build verification.
- [x] Capture screenshot proof for the updated public site.
- [ ] Commit, push, and open PR.

## Verification

- `bun run test:maple-docs`
- `bun run build`
- Local static screenshot of `/` after the README/site copy update.
- Confirm `git diff --name-status` does not delete `.github/workflows/*`.

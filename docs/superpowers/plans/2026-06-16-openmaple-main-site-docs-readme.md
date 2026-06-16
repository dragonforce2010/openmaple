# OpenMaple main site, docs, and README refresh

## Requirements

- Replace the root redirect with a real OpenMaple main site inspired by the OpenHuman landing page: focused hero, concise value proof, direct CTAs, and product screenshots.
- Rebuild `docs/index.html` as a professional GitBook-style documentation surface: left navigation, readable content, right page outline, search-like affordance, and clear developer paths.
- Simplify GitHub `README.md`: what it is, architecture, 5-6 screenshots, quick deploy, and links to deeper reference content.
- Move long-form details into `reference/README.md`.
- Verify static pages locally and capture screenshot proof.
- Publish updated repository and GitHub Pages.

## Design Plan

- Palette: maple ink `#171914`, leaf green `#17684f`, ember red `#cf3f2d`, paper `#f8f4eb`, panel `#fffdf8`, rule `#ded7ca`.
- Typography: system sans for speed and GitHub rendering parity; mono only for CLI/API snippets.
- Main site layout: no marketing split-card hero; first viewport uses full-width product thesis, mascot, and a live control-plane diagram.
- Docs layout: GitBook-like, dense but calm: persistent left sidebar, center article column, right on-page outline.
- Signature: "Control Plane / Runtime Plane / Sandbox Plane" rail used across landing, docs, and README so the public materials teach the platform model consistently.

## Files

- `index.html`
- `docs/index.html`
- `README.md`
- `reference/README.md`
- existing screenshot assets under `docs/product-manual/screenshots/`

## Verification

- Static preview root and docs with a local HTTP server.
- Screenshot root and docs at desktop width.
- Confirm README references 5-6 committed screenshots.
- Confirm GitHub Pages serves `/` and `/docs/`.

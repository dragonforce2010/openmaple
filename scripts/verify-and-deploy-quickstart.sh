#!/usr/bin/env bash
# Quickstart builder perf fix — full verification + stable deploy.
# Run OUTSIDE the agent sandbox (needs remote MySQL + veFaaS network).
# See docs/superpowers/plans/2026-06-14-quickstart-builder-perf.md
set -euo pipefail
cd "$(dirname "$0")/.."

echo "==> [1/3] typecheck + lint (fast fail)"
bun run typecheck
bun run lint

echo "==> [2/3] full test suite (needs MySQL / local server / e2b / playwright)"
bun run test:all

echo "==> [3/3] deploy to stable veFaaS (frontend + backend)"
bun run deploy:vefaas:stable

echo "==> done. Stable URL:"
bun run status:vefaas:stable 2>/dev/null | tail -20 || true

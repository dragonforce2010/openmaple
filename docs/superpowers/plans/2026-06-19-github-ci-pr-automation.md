# GitHub CI and PR automation

## Requirements

- Use GitHub Actions as the single CI entrypoint for this GitHub repository.
- Remove CircleCI configuration so there is one source of CI truth.
- Run fast quality gates on pull requests, `main` pushes, and merge queue groups: install, typecheck, lint, build.
- Keep contract tests available through manual dispatch because they can require external credentials and remote services.
- Keep Pages deployment on `main` pushes so a successfully merged PR deploys automatically.
- Deploy the stable veFaaS cloud app after `CI` succeeds on `main`.
- Skip cloud deploy when GitHub Deployments already has a successful deployment for the same commit SHA.
- Document the future PR automation path: required checks, optional merge queue, bot review, and guarded auto-merge.

## Files

- `.github/workflows/ci.yml`
- `.github/workflows/deploy-cloud.yml`
- `.github/workflows/pages.yml`
- `scripts/ci/run-contract-tests.mjs`
- `package.json`
- `.gitignore`

## Commands

- `bun run typecheck`
- `bun run lint`
- `bun run build`
- `bun run ci:contracts` for manual contract verification
- `bun run deploy:vefaas:stable` in the cloud deploy workflow

## Expected Results

- PR pipelines fail on TypeScript, lint, or build regressions.
- `main` push pipelines run the same quality gate and the existing Pages workflow deploys after merge.
- `main` cloud deployment runs only after the `CI` workflow succeeds, and repeated runs for the same SHA are skipped.
- Manual `run_contracts=true` pipelines run contract tests and upload `test-results`.

## Verification

- Parse GitHub workflow YAML files.
- Run `bun run typecheck`.
- Run `bun run lint`.
- Run `bun run build`.
- Run the CI wrapper with a small script subset to verify JUnit output.

## Tasks

- [x] Remove CircleCI config.
- [x] Add GitHub CI workflow.
- [x] Add cloud deploy workflow.
- [x] Keep package-script JUnit wrapper for manual contract tests.
- [x] Validate locally.

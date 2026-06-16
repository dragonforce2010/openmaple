# Spec: Remove VeADK From veFaaS Provisioning

## Objective
Move veFaaS runtime provisioning to the target shape: project `.env` provides Volcengine AK/SK and region, and `scripts/deploy_vefaas_runtime.py` directly calls Volcengine OpenAPI/SDK to create the fixed runtime template function, upload code, bind the application gateway, release it, and print the runtime binding payload. The managed-agent runtime protocol remains unchanged and stays Anthropic-compatible.

## Tech Stack
- Bun for TypeScript app/test commands.
- Python 3 for the veFaaS deployment helper.
- Volcengine Python SDK modules `volcenginesdkcore` and `volcenginesdkvefaas`.
- Direct signed OpenAPI calls to `open.volcengineapi.com` for application-level actions not exposed by the veFaaS SDK.

## Commands
- RED/GREEN contract: `bun run test:vefaas-provisioner`
- Existing env contract: `bun run test:project-env`
- Existing runtime contract: `bun run test:vefaas-contract`
- Type/build: `bun run typecheck && bun run build`
- Real cloud check when `.env` has credentials and invoke URL: `bun run test:vefaas-real`

## Project Structure
- `scripts/deploy_vefaas_runtime.py`: direct provisioning implementation.
- `scripts/vefaas_provisioner_contract.py`: fake-client contract test for provisioning behavior.
- `scripts/vefaas_runtime_app/`: fixed runtime template uploaded as a zip package.
- `README.md`: operator-facing environment and deploy instructions.

## Testing Strategy
- Unit/contract test with fake veFaaS SDK adapter, fake OpenAPI client, and fake uploader.
- Static assertion that provisioning source does not import or mention `veadk`.
- Existing veFaaS runtime contract proves runtime invocation remains compatible.
- Real veFaaS E2E remains gated by project `.env` and validates the deployed runtime URL.

## Boundaries
- Always: load project env from repository `.env`; default region to `cn-beijing`; avoid injecting all project secrets into the function environment; keep runtime API contract unchanged.
- Ask first: deleting existing cloud functions/applications, changing persisted DB schema, introducing a new package manager.
- Never: import `veadk`, read `~/.agents/.env` for project runtime config, commit secrets.

## Tasks
- [x] Add RED contract test for direct OpenAPI provisioning and no-veadk source.
- [x] Replace `scripts/deploy_vefaas_runtime.py` with direct Volcengine SDK/OpenAPI implementation.
- [x] Update package scripts, README, and ignore Python cache artifacts.
- [x] Run contract, type/build, runtime, and real veFaaS checks; commit the key task.

## Success Criteria
- `rg -n "veadk" scripts/deploy_vefaas_runtime.py` returns no matches.
- `bun run test:vefaas-provisioner` passes.
- `python3 scripts/deploy_vefaas_runtime.py` can create/reuse a veFaaS runtime from project `.env` without veadk.
- Existing veFaaS runtime tests continue to pass.

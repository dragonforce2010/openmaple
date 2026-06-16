# Container Deployment And README Plan

**Goal:** Make the project deployable as a containerized application and provide a detailed onboarding README for local development, Docker Compose, runtime configuration, persistence, and verification.

**Architecture:** The Express server will serve both `/v1/*` APIs and the built Vite `dist/` assets in production. Container deployment will persist `.managed-agents`, optionally mount `~/.agents`, and use the host Docker socket for session runtime containers. A host workspace mapping variable will let Docker-outside-of-Docker bind session workspaces correctly.

**Tech Stack:** Node.js 22, TypeScript, React/Vite, Express, SQLite, Docker, Docker Compose.

---

### Task 1: Production Server Readiness

- [x] Configure API host binding through `HOST`.
- [x] Serve built frontend assets from `dist/` when present.
- [x] Keep `/health` and `/v1/*` routes unchanged.

### Task 2: Container Runtime Support

- [x] Add configurable platform data directory through `LMAP_DATA_DIR`.
- [x] Add Docker workspace host path mapping through `LMAP_DOCKER_WORKSPACE_HOST_ROOT`.
- [x] Keep local development defaults unchanged.

### Task 3: Container Artifacts

- [x] Add `Dockerfile`.
- [x] Add `compose.yaml`.
- [x] Add `.dockerignore`.
- [x] Add `.env.example`.
- [x] Add production `npm start` script.

### Task 4: README

- [x] Write detailed getting-started documentation.
- [x] Cover local dev, Docker Compose, Docker socket caveats, environment variables, persistence, skills, tests, and troubleshooting.

### Task 5: Verification

- [x] Run `npm run typecheck`.
- [x] Run `npm run build`.
- [x] Build the Docker image.
- [x] Smoke test the container health endpoint and static UI.

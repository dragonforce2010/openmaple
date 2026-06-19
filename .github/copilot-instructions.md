# OpenMaple review instructions

When reviewing pull requests in this repository, focus on correctness, security, data safety, deployment safety, and missing verification. Do not spend review budget on style-only preferences.

Project rules:

- The Control Plane database is remote MySQL over a synchronous worker adapter, not sqlite. Do not recommend sqlite-only behavior.
- List and auth endpoints must use workspace scoping. A list endpoint without `workspace_id` must still filter to accessible workspaces.
- Do not allow secrets, `.env`, access keys, API keys, database passwords, or real credentials into committed files, logs, artifacts, or screenshots.
- Frontend changes must preserve mobile and desktop layout, avoid overlapping text, and follow the existing prototype design system.
- GitHub Actions changes are high risk. Check token permissions, secret exposure, `pull_request_target`, deployment triggers, and whether untrusted PR code can run with secrets.
- veFaaS deployment changes must preserve stable deployment state and avoid creating duplicate cloud resources unless explicitly requested.

Blocking review findings should be limited to deterministic bugs, security issues, data loss risks, broken deployment paths, missing workspace scoping, or missing tests for risky changes.

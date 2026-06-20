# Security Policy

OpenMaple handles sessions, runtime configuration, sandbox execution, API keys, OAuth credentials, and vault-backed tool access. Please report security issues privately.

## Supported Versions

The `main` branch and the latest tagged release are supported for security fixes.

## Reporting a Vulnerability

If GitHub private vulnerability reporting is available for this repository, use it first. Otherwise, open a GitHub issue titled `Security contact request` without exploit details, secrets, or reproduction payloads; a maintainer will move the report to a private channel.

Please include:

- affected commit, release, or package version
- impacted component: console, API, SDK, CLI, runtime provider, sandbox provider, vault, OAuth, or storage
- severity and expected impact
- minimal reproduction steps, shared privately

Do not publish working exploits or leaked credentials in public issues, pull requests, or discussions.

## Scope

In scope:

- authentication or authorization bypass
- workspace or tenant isolation failures
- secret exposure through vault, logs, events, files, or artifacts
- sandbox escape or unintended host access
- unsafe provider adapter behavior that exposes credentials or customer data

Out of scope:

- reports that require already-compromised maintainer credentials
- denial-of-service reports without a practical security impact
- issues in third-party providers unless OpenMaple integration code increases the impact

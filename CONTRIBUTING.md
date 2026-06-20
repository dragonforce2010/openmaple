# Contributing to OpenMaple

OpenMaple is a managed-agent control plane. Contributions should keep the public repo runnable, provider-portable, and honest about what is production-ready.

## Development

```bash
bun install
cp .env.example .env
bun run dev
```

Before opening a pull request:

```bash
bun run test:public-hygiene
bun run typecheck
bun run lint
bun run build
```

## Pull Requests

- Keep changes focused and small enough to review.
- Use real product screenshots for public-facing UI proof. Do not use generated UI mockups as product evidence.
- Do not commit local plans, private launch material, credentials, internal hostnames, or generated test artifacts.
- Update README, examples, or API docs when changing public behavior.
- State which commands you ran and whether any runtime verification was blocked.

## Public Claims

OpenMaple is not an official Anthropic product. It implements a similar managed-agent platform idea in an open stack. Avoid claims about production adoption, benchmarks, provider readiness, or customer usage unless the current repo evidence proves them.

## License

By contributing, you agree that your contribution is licensed under the Apache License 2.0.

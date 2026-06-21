FROM oven/bun:1.3.14-slim

WORKDIR /app

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=27951 \
    SERVE_STATIC=true \
    MAPLE_DATA_DIR=/app/.managed-agents

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates docker.io tini python3 make g++ \
    && apt-get clean

COPY package.json bun.lock ./
COPY apps/admin-web/package.json apps/admin-web/package.json
COPY apps/control-plane-api/package.json apps/control-plane-api/package.json
COPY agents/super-agent/package.json agents/super-agent/package.json
COPY packages/chat-kit/package.json packages/chat-kit/package.json
COPY packages/cli/package.json packages/cli/package.json
COPY packages/components/package.json packages/components/package.json
COPY packages/runtime-core/package.json packages/runtime-core/package.json
COPY packages/runtime-vefaas/package.json packages/runtime-vefaas/package.json
COPY packages/sandbox-core/package.json packages/sandbox-core/package.json
COPY packages/sandbox-e2b/package.json packages/sandbox-e2b/package.json
COPY packages/sandbox-vefaas/package.json packages/sandbox-vefaas/package.json
COPY packages/sdk/package.json packages/sdk/package.json
RUN bun install --frozen-lockfile

COPY . .
RUN bun run build \
    && bun install --production --frozen-lockfile

VOLUME ["/app/.managed-agents", "/root/.agents"]
EXPOSE 27951

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD bun -e "const port=process.env.PORT||27951; fetch('http://127.0.0.1:'+port+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["tini", "--"]
CMD ["bun", "run", "start"]

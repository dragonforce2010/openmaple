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

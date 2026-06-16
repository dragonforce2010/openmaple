# veFaaS runtime image for the managed-agent loop.
# Bakes the Python claude-agent-sdk together with the `claude` Node CLI it drives,
# so the anthropic_claude_code loop runs without relying on the native-python
# runtime's dependency install (which never ships the Node CLI).
# Codex CLI is baked in for the future codex_open_source loop.
# China-network build: uses domestic mirrors (aliyun apt / npmmirror node+npm / tsinghua pip).
FROM python:3.12-slim-bookworm

ENV PYTHONUNBUFFERED=1 \
    NPM_CONFIG_PREFIX=/usr/local/share/npm-global \
    PATH=/usr/local/share/npm-global/bin:/usr/local/node/bin:$PATH

# System deps via aliyun debian mirror.
RUN set -eux; \
    if [ -f /etc/apt/sources.list.d/debian.sources ]; then \
      sed -i 's|deb.debian.org|mirrors.aliyun.com|g; s|security.debian.org|mirrors.aliyun.com|g' /etc/apt/sources.list.d/debian.sources; \
    fi; \
    apt-get update; \
    apt-get install -y --no-install-recommends curl ca-certificates bash git xz-utils; \
    apt-get clean; rm -rf /var/lib/apt/lists/*

# Node.js 22 from npmmirror (fast in CN); claude-agent-sdk spawns the `claude` Node CLI.
RUN set -eux; \
    curl -fsSL https://registry.npmmirror.com/-/binary/node/v22.11.0/node-v22.11.0-linux-x64.tar.xz -o /tmp/node.tar.xz; \
    mkdir -p /usr/local/node; \
    tar -xJf /tmp/node.tar.xz -C /usr/local/node --strip-components=1; \
    rm /tmp/node.tar.xz; \
    node --version; npm --version

# Agent-loop CLIs: Claude now, Codex reserved for the codex_open_source loop.
RUN set -eux; \
    npm config set registry https://registry.npmmirror.com; \
    npm install -g @anthropic-ai/claude-code @openai/codex; \
    npm cache clean --force

WORKDIR /opt/maple-runtime
COPY requirements.txt ./
RUN pip install --no-cache-dir -i https://pypi.tuna.tsinghua.edu.cn/simple -r requirements.txt

COPY app.py claude_agent_sdk_runner.py runner_pool.py sandbox_tools.py run.sh ./
RUN chmod +x run.sh

# Third-party model wiring: ARK exposes an Anthropic-compatible endpoint at
# /api/coding, so claude-agent-sdk drives glm in-region — no Bedrock, no geo-block.
# ANTHROPIC_AUTH_TOKEN (= ARK_API_KEY) is injected as a function env at deploy
# time — never baked into the image.
ENV ANTHROPIC_BASE_URL=https://ark.cn-beijing.volces.com/api/coding \
    ANTHROPIC_MODEL=glm-4-7-251222 \
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1 \
    CLAUDE_CODE_MAX_OUTPUT_TOKENS=32000 \
    MAPLE_AGENT_LOOP_INSTALL_POLICY=never \
    MAPLE_VEFAAS_DATA_DIR=/tmp/maple-vefaas-runtime \
    IS_SANDBOX=1

EXPOSE 8000
CMD ["./run.sh"]

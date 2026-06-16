# veFaaS agent loop 走 ARK Anthropic-compat 端点,不走 Bedrock

veFaaS runtime(`cn-beijing`)上的 claude-agent-sdk 不连 AWS Bedrock,而是把 `ANTHROPIC_BASE_URL` 指向 ARK 的 Anthropic-compatible 端点 `https://ark.cn-beijing.volces.com/api/coding`(注意:是 `/api/coding`,不是 OpenAI 格式的 `/api/v3`),`ANTHROPIC_AUTH_TOKEN=$ARK_API_KEY`,模型 `glm-4-7-*`。该配置 bake 进 runtime 镜像(`infra/vefaas/runtime-app/Dockerfile`),token 在 deploy 时作为 function env 注入。

原因:AWS Bedrock Anthropic 模型对中国 egress IP 地理封锁——cn-beijing 函数有中国源 IP,直连 Bedrock 必被 `400 Access ... not allowed from unsupported countries/regions`。可选项是把 runtime 部署到 ap-southeast-1,但 ARK 端点在区内、无地理封锁、且已有 ByteDance 内部 key,故选 ARK。看代码会困惑"为何不直接用 Bedrock",此即原因。

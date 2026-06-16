# 0006 — secret 密文进 DB 列(应对 veFaaS /tmp 非持久)

日期:2026-06-15

## 决策

vault credential 的加密 secret bundle 除了写本地文件(`secret_ref` → `<secretsDir>/<id>.json`),**同时写进 `vault_credentials.secret_cipher` 列**(`encryptSecret` 产的 AES-256-GCM 密文 JSON)。读取走 `readCredentialSecret(row)`:**优先 `secret_cipher`,回退 `secret_ref` 文件**。secret 主密钥支持 `MAPLE_SECRET_MASTER_KEY`(base64)env,优先于本地 `master.key` 文件。

## 为什么

- 云端 `backend_envs()` 设 `MAPLE_DATA_DIR=/tmp/maple-managed-agents`,而 veFaaS `/tmp` **实例重启/扩缩容即清空、多实例不共享**。
- 只存文件 → DB 里 `secret_ref` 悬空、`readSecret` 抛错,OAuth 存的 token 活不过冷启动 → 端到端闭环在云端站不住。
- 密文进 DB(远程 MySQL,持久 + 跨实例共享)解决持久性;master key 走 env 解决"密钥本身也在 /tmp"的问题。

## 后果

- DB 持有密文(非明文);解密仍需 master key。master key 走 env 是**对称密钥裸暴露在环境变量**的临时方案。
- 旧数据:`secret_cipher` 为 NULL 的历史行仍回退读本地文件(向后兼容)。

## 未来 TODO:KMS

master key 不再走 env,改 KMS 托管 / envelope encryption(DEK 由 KMS 加密,KMS 仅在解密时短暂提供)。本次不实现。

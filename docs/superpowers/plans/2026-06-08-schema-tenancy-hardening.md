# Part A — Schema 多租户硬化 + 表清理（PR1）

> 计划日期 2026-06-08。目标库：live MySQL `maple` @ `vedbm-qkydajdkqldu-0`（IP 白名单已放行本机）。
> 决策已定：业务表加 `tenant_id+workspace_id`（排除身份/全局表）；gateway 整套删除；model_configs 回填+清理孤儿；审计列仅核心资源表；分 2 阶段 2 PR，本文 = PR1（schema），auth 重构见 `2026-06-08-auth-login-tenant-flow.md`（PR2）。

## 0. 背景事实（live 实查 2026-06-08）

| 表 | 行数 | workspace_id NULL | 备注 |
|---|---|---|---|
| agents | 76 | 0 | 已可收 NOT NULL |
| environments | 37 | 0 | 同上 |
| sessions | 20 | 0 | 同上 |
| vaults | 20 | 0 | 同上 |
| memory_stores | 17 | 0 | 同上 |
| mcp_servers | 3 | 0 | 已 NOT NULL，仅缺 FK |
| **model_configs** | 195 | **195（全NULL）** | user 级默认配置；38 个在多对多里，157 孤儿 |
| **agent_deployments** | 15 | **15（全NULL）** | 靠 user_id 可回填 |
| 子表 agent_versions/session_*/memories/vault_credentials | 各见下 | 无此列 | 本轮新增 tenant_id+workspace_id |
| gateway_keys | 21（全enabled） | — | **删除** |
| gateway_usage | 0 | — | **删除** |
| managed_files | 0 | — | 加归属列 |
| workspace_model_configs | 38 | — | **删除**（model_configs 收口后） |

- workspace : tenant = **严格 1:1**（29 租户各 1 空间）。
- workspace_members：29 admin + 2 member；users 共 95（多数无租户归属 → PR2 处理）。
- **无 migration 框架**：schema 靠 `store.ts:ensureSchema()` 的 `CREATE TABLE IF NOT EXISTS` + `ensureColumn()`（`store.ts:439`，PRAGMA 被 `mysql_child.mjs:78` 翻译成 information_schema 查询；`ADD COLUMN ... TEXT` 被 `mysql_child.mjs:103` 翻译类型）。→ 本轮 migration = 独立幂等 SQL 脚本 + 扩充 `ensureSchema` 保证新库自带。

## 1. 加列范围（决策：业务表加，排除身份/全局表）

**加 `tenant_id` + `workspace_id` 的表：**
- 已有 workspace_id、补 tenant_id + 收 FK：`agents` `environments` `sessions` `vaults` `memory_stores` `mcp_servers` `agent_deployments` `model_configs`
- 新增两列（子表，从父级继承）：`agent_versions`(95) `session_threads`(20) `session_events`(306) `tool_calls`(53) `session_artifacts`(22) `memories`(17) `memory_versions`(17) `vault_credentials`(18)
- `managed_files`(0)：加 `tenant_id+workspace_id+created_by_user_id`

**不加（身份/全局表）：** `users` `tenants` `auth_sessions` `templates`(→改名见 §4) `skills`（全局注册）`skill_versions`（父级 skills 全局，保持全局）。`workspace_*` 系列本身已是 workspace 维度。

> tenant_id 选型：虽然 workspace→tenant 已有 FK 可 JOIN，但你的诉求是「按租户整表导出」，故业务表冗余存 tenant_id（`WHERE tenant_id=X` 一把梭）。tenant_id 由所属 workspace 推导回填，并加 FK→tenants。

## 2. 回填策略（migration 数据阶段）

按依赖顺序，全部包在 `SET FOREIGN_KEY_CHECKS=0` 事务里（CLAUDE.md 要求）：

1. **直接业务表**（已有 workspace_id，仅补 tenant_id）：
   `UPDATE <t> JOIN workspaces w ON <t>.workspace_id=w.id SET <t>.tenant_id=w.tenant_id`
2. **子表**（从父级继承 workspace_id+tenant_id）：
   - agent_versions ← agents（via agent_id）
   - session_threads/session_events/tool_calls/session_artifacts ← sessions（via session_id）
   - memories ← memory_stores（via memory_store_id）；memory_versions ← memories（via memory_id）
   - vault_credentials ← vaults（via vault_id）
3. **agent_deployments**（15 全 NULL）：via agent_id → agents.workspace_id 回填；agents 已全有 workspace_id。
4. **model_configs**（195 全 NULL，决策＝回填+清理孤儿）：
   - a. 38 个有 `workspace_model_configs` 绑定的 → `workspace_id` = 绑定的 workspace（多绑定取 created_at 最早一条），tenant_id 随之。
   - b. 其余里，owner 拥有 workspace 的（owner_user_id 是某 workspace_members admin）→ 回填 owner 的 primary workspace。
   - c. 剩余孤儿（owner 无任何 workspace，=死的默认配置）→ **删除**。
   - 删前先 dump 一份到 `$CLAUDE_JOB_DIR/tmp/model_configs_orphan_backup.json`。
   - `ensureDefaultVolcoEngineConfig(userId)` 改为 `(userId, workspaceId)`：per-workspace 建默认配置，不再 user 级（调用点：`index.ts:506` login、`index.ts:669` listModelConfigs、`store.ts createWorkspaceOnboarding`）。
5. 回填后校验：每张表 `SELECT COUNT(*) WHERE workspace_id IS NULL OR tenant_id IS NULL` 必须为 0（model_configs 删孤儿后）。

## 3. 约束收口

回填校验通过后：
```sql
-- 每张加列表
ALTER TABLE <t> MODIFY workspace_id VARCHAR(191) NOT NULL;
ALTER TABLE <t> MODIFY tenant_id   VARCHAR(191) NOT NULL;
ALTER TABLE <t> ADD CONSTRAINT fk_<t>_ws FOREIGN KEY (workspace_id) REFERENCES workspaces(id);
ALTER TABLE <t> ADD CONSTRAINT fk_<t>_tn FOREIGN KEY (tenant_id) REFERENCES tenants(id);
CREATE INDEX idx_<t>_ws ON <t>(workspace_id);
CREATE INDEX idx_<t>_tn ON <t>(tenant_id);
```
- **FK `ON DELETE CASCADE`（决策已定）**：删 workspace 自动连锁清空其下全部资源（agents/sessions/vaults/... 及各子表）；删 tenant 连锁清 workspace。
  - ⚠️ 风险：误删一个 workspace = 该空间所有数据连锁消失。删除入口必须保留二次确认 + 软删优先（先 deleted_at，硬删走单独运维路径）。
  - 子表 FK 指向父级（session_events→sessions 等）也用 CASCADE。
  - tenant_id→tenants 与 workspace_id→workspaces 均 CASCADE。
- 子表补声明指向父级的 FK（session_events/threads/tool_calls→sessions，memories→memory_stores，memory_versions→memories，vault_credentials→vaults）统一完整性（承接 ER 分析 P2）。

## 4. 表/字段重命名 & 删除

1. **templates → agent_templates**（Q8）：`RENAME TABLE templates TO agent_templates`。改 `store.ts` 所有 `templates` 引用 + `index.ts` 路由（grep `templates` 全量替换，注意别误伤 `template_json`/`config_json`）。
2. **删 gateway**（Q6，决策＝整套删除）：
   - 先 dump `gateway_keys`(21) 到备份 JSON（外部可能在用，留痕）。
   - `DROP TABLE gateway_usage; DROP TABLE gateway_keys;`（先 usage 后 keys，FK 顺序）。
   - 删路由：`index.ts:522` `/v1/gateway/chat/completions`、`index.ts:728+` `/v1/gateway_keys` CRUD。
   - 删 `modelGateway.ts`：`handleGatewayChatCompletion`/`recordGatewayUsage`/`generateGatewayKeyMaterial`/`hashGatewayKey` + gateway_keys store 函数。
   - 删 `auth.ts:109` `resolveApiKeyUser` 里 gatewayKey 分支 + `getGatewayKeyByHash` import。
   - 删 `App.tsx` gateway_keys UI + `types.ts` 类型。
   - typecheck 驱动：删到 `bunx tsc --noEmit` 干净为止。
3. **删 workspace_model_configs**（Q5，model_configs 收口后）：`DROP TABLE workspace_model_configs;` 删 `store.ts:755/861/977` 的多对多读写，改为按 `model_configs.workspace_id` 直查。

## 5. 审计列（Q7，决策＝仅核心资源表）

7 张核心资源表加列：`agents` `environments` `workspaces` `model_configs` `vaults` `memory_stores` `mcp_servers`
```sql
-- workspaces 已有 created_by_user_id，跳过该列
ALTER TABLE <t> ADD COLUMN updated_by_user_id VARCHAR(191) NULL;
ALTER TABLE <t> ADD COLUMN deleted_by_user_id VARCHAR(191) NULL;
ALTER TABLE <t> ADD COLUMN deleted_at VARCHAR(40) NULL;
-- 缺 created_by 的表补：created_by_user_id VARCHAR(191) NULL
```
- 软删：现有 `archived_at` 保留；新增 `deleted_at/deleted_by` 表「真删意图」。改 `archive*` store 函数写 `deleted_by_user_id=actor`。**本轮只加列 + 写入操作人，不改查询过滤逻辑**（避免动 scope 链，降风险）。
- created_by 回填：能推的（workspaces.created_by_user_id 已有；agents/model_configs 从 owner 推）回填，推不出留 NULL。

## 6. managed_files 归属（Q12）

加 `tenant_id+workspace_id+created_by_user_id`（0 行，直接 NOT NULL 安全）。改 `files.ts:62 writeManagedFile` 签名带 workspace/user；`index.ts:791 POST /v1/files` 注入 `currentUser` + workspace；`GET /v1/files/:fileId`(index.ts:800) 加 `canAccessWorkspace` 鉴权（补 P0 越权漏洞）。

## 7. 已确认决策

- **FK ON DELETE = CASCADE**（已定，见 §3）。
- **model_configs.name 保持不动**（不改 provider_name，避免误导；它是用户显示名非供应商名）。
- **不用 worktree，主 checkout 直接改**（含用户未提交改动，一并提交）。

## 8. 文件清单（PR1 改动）

| 文件 | 改动 |
|---|---|
| `scripts/migrate_tenancy_hardening.mjs`（新） | 幂等 migration：加列→回填→校验→收 NOT NULL+FK→删表→rename。可重复跑，含 --dry-run/--rollback。 |
| `server/store.ts` | ensureSchema 加新列/FK；删 gateway/workspace_model_configs store 函数；templates→agent_templates；ensureDefaultVolcoEngineConfig per-workspace；archive 写 deleted_by |
| `server/modelGateway.ts` | 删 gateway 代理 + key 逻辑 |
| `server/auth.ts` | 删 resolveApiKeyUser gateway 分支 + import |
| `server/index.ts` | 删 /v1/gateway* 路由；files 路由加鉴权+归属；templates 路由改名 |
| `server/files.ts` | writeManagedFile 带归属 |
| `src/App.tsx` `src/types.ts` | 删 gateway_keys UI/类型 |
| `scripts/api_storage_contract.ts` 等 | 受影响契约测试同步 |

## 9. 验证步骤（apply 顺序）

1. 起新分支（worktree 隔离），`bun run typecheck` 基线干净。
2. dry-run migration：`--dry-run` 只打印 SQL + 回填后预期 NULL 计数，不写库。
3. 备份：dump model_configs 孤儿 + gateway_keys 到 `$CLAUDE_JOB_DIR/tmp/`。
4. apply migration（事务 + FOREIGN_KEY_CHECKS=0）。
5. 校验 SQL：所有加列表 NULL 计数=0；FK 存在（information_schema.KEY_COLUMN_USAGE）；gateway/workspace_model_configs 表不存在。
6. 改代码 → `bun run typecheck` 干净。
7. `bun run test:api-storage` + `test:prototype-console` + `test:workspace-runtime-pool` 通过。
8. 启动 `bun run dev`，冒烟：登录→列 agents/models→建 session，确认 scope 不漏不错。
9. 回滚点：migration 脚本配套 `--rollback`（删新列/FK、从备份 restore gateway/孤儿、agent_templates→templates）。DROP 不可逆部分靠备份 JSON 重灌。

## 10. 任务清单（checkbox）

- [ ] T1 写 `scripts/migrate_tenancy_hardening.mjs`（含 --dry-run/--rollback）
- [ ] T2 dry-run 跑通，核对回填后 NULL=0 预期
- [ ] T3 备份 model_configs 孤儿 + gateway_keys
- [ ] T4 apply migration，校验 SQL 全绿
- [ ] T5 store.ts 扩 ensureSchema + 删 gateway/多对多 + templates 改名 + ensureDefaultVolcoEngineConfig per-ws + archive 写 deleted_by
- [ ] T6 删 modelGateway/auth/index gateway 链路，typecheck 干净
- [ ] T7 files 归属 + 鉴权
- [ ] T8 前端删 gateway UI + 类型
- [ ] T9 契约测试同步 + test:api-storage/prototype-console/runtime-pool 通过
- [ ] T10 dev 冒烟 + 出 PR（push 拿 MR 链接）

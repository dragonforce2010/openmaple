// Migration: 多租户硬化 + 表清理 (PR1)
// Plan: docs/superpowers/plans/2026-06-08-schema-tenancy-hardening.md
// 用法:
//   node migrations/migrate_tenancy_hardening.mjs --dry-run   # 只打印,校验回填后 NULL 预期,不写库
//   node migrations/migrate_tenancy_hardening.mjs --backup    # 备份 model_configs 孤儿 + gateway_keys 到 tmp
//   node migrations/migrate_tenancy_hardening.mjs --apply     # 真正执行(自动先 --backup)
//   node migrations/migrate_tenancy_hardening.mjs --verify    # 仅跑收口后校验 SQL
//   node migrations/migrate_tenancy_hardening.mjs --rollback  # 回滚(删新列/FK、restore、改名还原)
import mysql from "mysql2/promise";
import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { mysqlConnectionConfig, loadProjectEnv } from "../apps/control-plane-api/src/infra/mysql_child.mjs";

loadProjectEnv();
const MODE = process.argv.find((a) => a.startsWith("--"))?.slice(2) || "dry-run";
const BACKUP_DIR = process.env.CLAUDE_JOB_DIR ? `${process.env.CLAUDE_JOB_DIR}/tmp` : "./.migration-backup";

// 加 tenant_id+workspace_id 的表(子表从父级回填)
const PARENT_BACKFILL = ["agents", "environments", "sessions", "vaults", "memory_stores", "mcp_servers"]; // 已有 workspace_id,仅补 tenant_id
const CHILD_BACKFILL = [
  { table: "agent_versions", parent: "agents", fk: "agent_id" },
  { table: "session_threads", parent: "sessions", fk: "session_id" },
  { table: "session_events", parent: "sessions", fk: "session_id" },
  { table: "tool_calls", parent: "sessions", fk: "session_id" },
  { table: "session_artifacts", parent: "sessions", fk: "session_id" },
  { table: "memories", parent: "memory_stores", fk: "memory_store_id" },
  { table: "memory_versions", parent: "memories", fk: "memory_id" },
  { table: "vault_credentials", parent: "vaults", fk: "vault_id" }
];
// 所有最终要带 tenant_id+workspace_id 且收 NOT NULL+FK 的表
const TENANT_WS_TABLES = [
  "agents", "environments", "sessions", "vaults", "memory_stores", "mcp_servers",
  "agent_deployments", "model_configs", "managed_files",
  ...CHILD_BACKFILL.map((c) => c.table)
];
// 子表指向父级的 FK(本轮补声明,CASCADE)
const CHILD_PARENT_FK = [
  { table: "session_threads", col: "session_id", ref: "sessions" },
  { table: "session_events", col: "session_id", ref: "sessions" },
  { table: "tool_calls", col: "session_id", ref: "sessions" },
  { table: "memories", col: "memory_store_id", ref: "memory_stores" },
  { table: "memory_versions", col: "memory_id", ref: "memories" },
  { table: "vault_credentials", col: "vault_id", ref: "vaults" }
];
// 审计列(仅核心资源表)
const AUDIT_TABLES = ["agents", "environments", "workspaces", "model_configs", "vaults", "memory_stores", "mcp_servers"];

const log = (...a) => console.log(...a);
let conn;

async function q(sql, params = []) {
  const [rows] = await conn.execute(sql, params);
  return rows;
}
async function colExists(table, col) {
  const r = await q(
    "SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=?",
    [table, col]
  );
  return r.length > 0;
}
async function fkExists(table, name) {
  const r = await q(
    "SELECT 1 FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND CONSTRAINT_NAME=? AND CONSTRAINT_TYPE='FOREIGN KEY'",
    [table, name]
  );
  return r.length > 0;
}
async function tableExists(table) {
  const r = await q("SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?", [table]);
  return r.length > 0;
}
async function exec(sql, params = []) {
  if (MODE === "dry-run") { log("  [dry] " + sql.replace(/\s+/g, " ").trim().slice(0, 160)); return; }
  await conn.execute(sql, params);
}

async function addCol(table, col, type = "VARCHAR(191) NULL") {
  if (await colExists(table, col)) { log(`  skip ${table}.${col} (exists)`); return; }
  await exec(`ALTER TABLE \`${table}\` ADD COLUMN \`${col}\` ${type}`);
  log(`  + ${table}.${col}`);
}

async function step1_addColumns() {
  log("\n[1] 加列(nullable 先,后续回填再收 NOT NULL)");
  for (const t of TENANT_WS_TABLES) {
    await addCol(t, "tenant_id");
    if (!(await colExists(t, "workspace_id"))) await addCol(t, "workspace_id");
  }
  await addCol("managed_files", "created_by_user_id");
  // 审计列
  log("[1b] 审计列(核心资源表)");
  for (const t of AUDIT_TABLES) {
    if (t !== "workspaces") await addCol(t, "created_by_user_id");
    await addCol(t, "updated_by_user_id");
    await addCol(t, "deleted_by_user_id");
    await addCol(t, "deleted_at", "VARCHAR(40) NULL");
  }
}

async function step2_backfill() {
  log("\n[2] 回填 tenant_id / workspace_id");
  // 2.1 父表:补 tenant_id
  for (const t of PARENT_BACKFILL) {
    await exec(`UPDATE \`${t}\` x JOIN workspaces w ON x.workspace_id=w.id SET x.tenant_id=w.tenant_id WHERE x.tenant_id IS NULL OR x.tenant_id=''`);
    log(`  backfill ${t}.tenant_id`);
  }
  // 2.2 子表:从父级继承 workspace_id+tenant_id
  for (const { table, parent, fk } of CHILD_BACKFILL) {
    await exec(
      `UPDATE \`${table}\` c JOIN \`${parent}\` p ON c.\`${fk}\`=p.id SET c.workspace_id=p.workspace_id, c.tenant_id=p.tenant_id WHERE c.workspace_id IS NULL OR c.tenant_id IS NULL OR c.workspace_id='' OR c.tenant_id=''`
    );
    log(`  backfill ${table} <- ${parent}`);
  }
  // 2.3 agent_deployments <- agents
  await exec(
    `UPDATE agent_deployments d JOIN agents a ON d.agent_id=a.id SET d.workspace_id=a.workspace_id, d.tenant_id=a.tenant_id WHERE d.workspace_id IS NULL OR d.tenant_id IS NULL OR d.workspace_id='' OR d.tenant_id=''`
  );
  log("  backfill agent_deployments <- agents");
  // 2.4 model_configs:a) 多对多绑定 b) owner primary workspace c) 删孤儿
  await exec(
    `UPDATE model_configs mc JOIN (
       SELECT model_config_id, MIN(workspace_id) ws FROM workspace_model_configs GROUP BY model_config_id
     ) wmc ON mc.id=wmc.model_config_id
     JOIN workspaces w ON wmc.ws=w.id
     SET mc.workspace_id=w.id, mc.tenant_id=w.tenant_id
     WHERE mc.workspace_id IS NULL OR mc.workspace_id=''`
  );
  log("  backfill model_configs (a) 多对多绑定");
  await exec(
    `UPDATE model_configs mc JOIN (
       SELECT wm.user_id, MIN(wm.workspace_id) ws FROM workspace_members wm WHERE wm.role='admin' GROUP BY wm.user_id
     ) own ON mc.owner_user_id=own.user_id
     JOIN workspaces w ON own.ws=w.id
     SET mc.workspace_id=w.id, mc.tenant_id=w.tenant_id
     WHERE mc.workspace_id IS NULL OR mc.workspace_id=''`
  );
  log("  backfill model_configs (b) owner primary workspace");
}

async function step3_dropOrphanModelConfigs() {
  log("\n[3] 删 model_configs 孤儿(回填后仍 NULL)");
  const orphans = await q(`SELECT id, owner_user_id, name, preset_key FROM model_configs WHERE workspace_id IS NULL OR workspace_id=''`);
  log(`  孤儿数: ${orphans.length}`);
  if (orphans.length && MODE !== "dry-run") {
    mkdirSync(BACKUP_DIR, { recursive: true });
    writeFileSync(`${BACKUP_DIR}/model_configs_orphan_backup.json`, JSON.stringify(orphans, null, 2));
    log(`  备份 -> ${BACKUP_DIR}/model_configs_orphan_backup.json`);
    // 先删多对多里指向孤儿的引用(若有),再删孤儿
    const ids = orphans.map((o) => o.id);
    const placeholders = ids.map(() => "?").join(",");
    if (await tableExists("workspace_model_configs")) {
      await conn.execute(`DELETE FROM workspace_model_configs WHERE model_config_id IN (${placeholders})`, ids);
    }
    await conn.execute(`DELETE FROM gateway_keys WHERE model_config_id IN (${placeholders})`, ids).catch(() => {});
    await conn.execute(`DELETE FROM model_configs WHERE id IN (${placeholders})`, ids);
    log(`  已删 ${ids.length} 孤儿`);
  } else if (MODE === "dry-run") {
    log("  [dry] 跳过删除");
  }
}

async function step3b_dropOrphanChildren() {
  log("\n[3b] 删父级缺失的子行(历史未级联删的残留)");
  const checks = [
    ["agent_versions","agent_id","agents"],
    ["session_threads","session_id","sessions"],
    ["session_events","session_id","sessions"],
    ["tool_calls","session_id","sessions"],
    ["session_artifacts","session_id","sessions"],
    ["memories","memory_store_id","memory_stores"],
    ["memory_versions","memory_id","memories"],
    ["vault_credentials","vault_id","vaults"],
    ["agent_deployments","agent_id","agents"]
  ];
  for (const [t, fk, parent] of checks) {
    const rows = await q(`SELECT c.id FROM \`${t}\` c LEFT JOIN \`${parent}\` x ON c.\`${fk}\`=x.id WHERE x.id IS NULL`);
    if (!rows.length) continue;
    log(`  ${t}: ${rows.length} 孤儿子行(父 ${parent} 缺失)`);
    if (MODE !== "dry-run") {
      mkdirSync(BACKUP_DIR, { recursive: true });
      const full = await q(`SELECT c.* FROM \`${t}\` c LEFT JOIN \`${parent}\` x ON c.\`${fk}\`=x.id WHERE x.id IS NULL`);
      writeFileSync(`${BACKUP_DIR}/orphan_${t}_backup.json`, JSON.stringify(full, null, 2));
      const ids = rows.map((r) => r.id);
      const ph = ids.map(() => "?").join(",");
      await conn.execute(`DELETE FROM \`${t}\` WHERE id IN (${ph})`, ids);
      log(`    已删 ${ids.length}(备份 orphan_${t}_backup.json)`);
    }
  }
}

async function step4_verifyNulls() {
  log("\n[校验] 各表 NULL 计数(应全 0)");
  if (MODE === "dry-run") { log("  [dry] 列未真加,跳过 NULL 校验(apply 时执行)"); return true; }
  let bad = 0;
  for (const t of TENANT_WS_TABLES) {
    const [r] = await q(`SELECT SUM(CASE WHEN workspace_id IS NULL OR workspace_id='' THEN 1 ELSE 0 END) ws, SUM(CASE WHEN tenant_id IS NULL OR tenant_id='' THEN 1 ELSE 0 END) tn, COUNT(*) total FROM \`${t}\``);
    const wsNull = Number(r.ws || 0), tnNull = Number(r.tn || 0);
    if (wsNull || tnNull) { bad++; log(`  ❌ ${t}: ws_null=${wsNull} tn_null=${tnNull} total=${r.total}`); }
    else log(`  ✅ ${t} (total=${r.total})`);
  }
  return bad === 0;
}

async function step5_constraints() {
  log("\n[5] 收 NOT NULL + FK(CASCADE) + 索引");
  for (const t of TENANT_WS_TABLES) {
    await exec(`ALTER TABLE \`${t}\` MODIFY \`workspace_id\` VARCHAR(191) NOT NULL`);
    await exec(`ALTER TABLE \`${t}\` MODIFY \`tenant_id\` VARCHAR(191) NOT NULL`);
    const fkWs = `fk_${t}_ws`, fkTn = `fk_${t}_tn`;
    if (!(await fkExists(t, fkWs))) await exec(`ALTER TABLE \`${t}\` ADD CONSTRAINT \`${fkWs}\` FOREIGN KEY (\`workspace_id\`) REFERENCES workspaces(id) ON DELETE CASCADE`);
    if (!(await fkExists(t, fkTn))) await exec(`ALTER TABLE \`${t}\` ADD CONSTRAINT \`${fkTn}\` FOREIGN KEY (\`tenant_id\`) REFERENCES tenants(id) ON DELETE CASCADE`);
    await exec(`CREATE INDEX \`idx_${t}_ws\` ON \`${t}\`(\`workspace_id\`)`).catch(() => {});
    await exec(`CREATE INDEX \`idx_${t}_tn\` ON \`${t}\`(\`tenant_id\`)`).catch(() => {});
    log(`  收口 ${t}`);
  }
  // managed_files created_by
  log("[5b] 子表->父级 FK(CASCADE)");
  for (const { table, col, ref } of CHILD_PARENT_FK) {
    const name = `fk_${table}_${col}`;
    if (!(await fkExists(table, name))) await exec(`ALTER TABLE \`${table}\` ADD CONSTRAINT \`${name}\` FOREIGN KEY (\`${col}\`) REFERENCES \`${ref}\`(id) ON DELETE CASCADE`);
    log(`  FK ${table}.${col} -> ${ref}`);
  }
}

async function step6_dropAndRename() {
  log("\n[6] 删 gateway / workspace_model_configs + rename templates");
  // 备份 gateway_keys
  if (await tableExists("gateway_keys")) {
    const keys = await q("SELECT * FROM gateway_keys");
    if (MODE !== "dry-run") {
      mkdirSync(BACKUP_DIR, { recursive: true });
      writeFileSync(`${BACKUP_DIR}/gateway_keys_backup.json`, JSON.stringify(keys, null, 2));
      log(`  备份 gateway_keys(${keys.length}) -> ${BACKUP_DIR}`);
    }
  }
  await exec("DROP TABLE IF EXISTS gateway_usage");
  await exec("DROP TABLE IF EXISTS gateway_keys");
  await exec("DROP TABLE IF EXISTS workspace_model_configs");
  // rename templates -> agent_templates
  if ((await tableExists("templates")) && !(await tableExists("agent_templates"))) {
    await exec("RENAME TABLE templates TO agent_templates");
    log("  templates -> agent_templates");
  } else log("  rename templates 跳过(已改名或不存在)");
}

async function rollback() {
  log("\n[ROLLBACK] 删新增列/FK、restore、改名还原");
  for (const t of TENANT_WS_TABLES) {
    for (const fk of [`fk_${t}_ws`, `fk_${t}_tn`]) {
      if (await fkExists(t, fk)) await exec(`ALTER TABLE \`${t}\` DROP FOREIGN KEY \`${fk}\``);
    }
    await exec(`ALTER TABLE \`${t}\` DROP INDEX \`idx_${t}_ws\``).catch(() => {});
    await exec(`ALTER TABLE \`${t}\` DROP INDEX \`idx_${t}_tn\``).catch(() => {});
    await exec(`ALTER TABLE \`${t}\` DROP COLUMN \`tenant_id\``).catch(() => {});
  }
  for (const { table, col } of CHILD_PARENT_FK) {
    const name = `fk_${table}_${col}`;
    if (await fkExists(table, name)) await exec(`ALTER TABLE \`${table}\` DROP FOREIGN KEY \`${name}\``);
  }
  if ((await tableExists("agent_templates")) && !(await tableExists("templates"))) await exec("RENAME TABLE agent_templates TO templates");
  // restore model_configs 孤儿 / gateway_keys 需手动从备份 JSON 重灌(此处仅提示)
  log("  ⚠️ model_configs 孤儿 / gateway_keys 删除不可逆,需手动从 backup JSON 重灌:");
  log(`     ${BACKUP_DIR}/model_configs_orphan_backup.json, gateway_keys_backup.json`);
  log("  ⚠️ 子表新增的 workspace_id/tenant_id 列保留(子表本无此列,回滚删 tenant_id 即可;workspace_id 父表本有)");
}

async function main() {
  conn = await mysql.createConnection({ ...mysqlConnectionConfig(), multipleStatements: false });
  log(`MODE=${MODE}  DB=${mysqlConnectionConfig().database}@${mysqlConnectionConfig().host}`);
  try {
    if (MODE === "rollback") {
      await conn.query("SET FOREIGN_KEY_CHECKS=0");
      await rollback();
      await conn.query("SET FOREIGN_KEY_CHECKS=1");
      return;
    }
    if (MODE === "verify") { await step4_verifyNulls(); return; }
    if (MODE === "backup") {
      mkdirSync(BACKUP_DIR, { recursive: true });
      const orphans = await q(`SELECT * FROM model_configs WHERE workspace_id IS NULL OR workspace_id=''`);
      writeFileSync(`${BACKUP_DIR}/model_configs_all_null_backup.json`, JSON.stringify(orphans, null, 2));
      const keys = (await tableExists("gateway_keys")) ? await q("SELECT * FROM gateway_keys") : [];
      writeFileSync(`${BACKUP_DIR}/gateway_keys_backup.json`, JSON.stringify(keys, null, 2));
      log(`备份完成 -> ${BACKUP_DIR} (model_configs null=${orphans.length}, gateway_keys=${keys.length})`);
      return;
    }
    // dry-run / apply
    if (MODE === "apply") await conn.query("SET FOREIGN_KEY_CHECKS=0");
    await step1_addColumns();
    await step2_backfill();
    await step3_dropOrphanModelConfigs();
    await step3b_dropOrphanChildren();
    const ok = await step4_verifyNulls();
    if (MODE === "apply" && !ok) {
      log("\n❌ 校验未过,中止收口(列已加+回填已做,可修数据后重跑)");
      await conn.query("SET FOREIGN_KEY_CHECKS=1");
      return;
    }
    await step5_constraints();
    await step6_dropAndRename();
    if (MODE === "apply") await conn.query("SET FOREIGN_KEY_CHECKS=1");
    log("\n✅ 完成");
  } finally {
    await conn.end();
  }
}
main().catch((e) => { console.error("MIGRATION ERROR:", e.message); process.exit(1); });

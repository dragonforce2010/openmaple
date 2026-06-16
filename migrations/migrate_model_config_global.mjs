// T4b: model_configs 全局化 (workspace_id='-1' 哨兵)
// 删 ws/tn FK(全局行不指向真 workspace), owner_user_id 改 nullable
import mysql from "mysql2/promise";
import { mysqlConnectionConfig, loadProjectEnv } from "../apps/control-plane-api/src/infra/mysql_child.mjs";
loadProjectEnv();
const MODE = process.argv.find(a=>a.startsWith("--"))?.slice(2) || "dry-run";
const conn = await mysql.createConnection(mysqlConnectionConfig());
const q = async (s,p=[]) => (await conn.execute(s,p))[0];
const fkExists = async (name) => (await q("SELECT 1 FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='model_configs' AND CONSTRAINT_NAME=? AND CONSTRAINT_TYPE='FOREIGN KEY'",[name])).length>0;
const exec = async (sql) => { if(MODE==="dry-run"){console.log("  [dry]",sql);return;} await conn.execute(sql); console.log("  ✓",sql.slice(0,80)); };
console.log(`MODE=${MODE}`);
// 引用检查: model_config_id 被哪些表 FK 引用(应只剩自身/无,gateway/wmc已删)
const refs = await q(`SELECT TABLE_NAME, COLUMN_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA=DATABASE() AND REFERENCED_TABLE_NAME='model_configs'`);
console.log("model_configs 被引用:", JSON.stringify(refs));
try {
  if(MODE!=="dry-run") await conn.query("SET FOREIGN_KEY_CHECKS=0");
  if(await fkExists("fk_model_configs_ws")) await exec("ALTER TABLE model_configs DROP FOREIGN KEY fk_model_configs_ws");
  if(await fkExists("fk_model_configs_tn")) await exec("ALTER TABLE model_configs DROP FOREIGN KEY fk_model_configs_tn");
  await exec("ALTER TABLE model_configs MODIFY owner_user_id VARCHAR(191) NULL");
  if(MODE!=="dry-run") await conn.query("SET FOREIGN_KEY_CHECKS=1");
  console.log("✅ T4b done");
} finally { await conn.end(); }

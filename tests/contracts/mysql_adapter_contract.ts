import assert from "node:assert/strict";
import { runOp } from "../../apps/control-plane-api/src/infra/mysql_child.mjs";

class FakeExecutor {
  readonly sql: string[] = [];
  readonly failures = new Map<string, Error & { code?: string }>();

  async execute(sql: string) {
    this.sql.push(sql);
    const failure = this.failures.get(sql);
    if (failure) throw failure;
    return [{ affectedRows: 0 }];
  }
}

const executor = new FakeExecutor();

await runOp(executor, {
  op: "query",
  mode: "run",
  sql: "CREATE INDEX IF NOT EXISTS idx_events_session_created ON session_events(session_id, created_at)",
  params: []
});
assert.equal(executor.sql.at(-1), "CREATE INDEX idx_events_session_created ON session_events(session_id, created_at)");

await runOp(executor, {
  op: "query",
  mode: "run",
  sql: "CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_unique ON users(email)",
  params: []
});
assert.equal(executor.sql.at(-1), "CREATE UNIQUE INDEX idx_users_email_unique ON users(email)");

const duplicate = Object.assign(new Error("Duplicate key name 'idx_users_email_unique'"), { code: "ER_DUP_KEYNAME" });
executor.failures.set("CREATE UNIQUE INDEX idx_users_email_unique ON users(email)", duplicate);
await runOp(executor, {
  op: "query",
  mode: "run",
  sql: "CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_unique ON users(email)",
  params: []
});

console.log("mysql adapter contract passed");

import { GLOBAL_SCOPE_ID, db, now, toJson } from "./storeCore";
import { storeSchemaSql } from "./storeSchema";

export function initDatabase() {
  traceInit("schema", () => db.exec(storeSchemaSql));

  traceInit("workspace columns", ensureWorkspaceColumns);
  traceInit("global scope sentinel", ensureGlobalScopeSentinel);
  traceInit("tenant admin backfill", ensureTenantAdminBackfill);
}

function traceInit<T>(label: string, fn: () => T) {
  if (process.env.MAPLE_INIT_TRACE !== "true") return fn();
  const started = Date.now();
  try {
    return fn();
  } finally {
    console.error(`[initDatabase] ${label} ${Date.now() - started}ms`);
  }
}

// The "-1" GLOBAL_SCOPE_ID sentinel is used to scope global resources (e.g. shared model
// configs, CLI deployments that belong to no workspace). PR1 added NOT NULL FKs on
// agents/environments/... -> workspaces/tenants, so the sentinel rows must physically exist
// or any insert with workspace_id="-1" fails the FK. Seed them once, idempotently.
function ensureGlobalScopeSentinel() {
  const stamp = now();
  const existingUser = db.prepare("SELECT id FROM users WHERE id = ?").get(GLOBAL_SCOPE_ID);
  if (!existingUser) {
    db.prepare(
      "INSERT INTO users (id, email, name, auth_provider, role, metadata_json, created_at, updated_at) VALUES (?, ?, ?, 'system', 'system', ?, ?, ?)"
    ).run(GLOBAL_SCOPE_ID, "system@maple.internal", "System", toJson({ sentinel: true }), stamp, stamp);
  }
  const existingTenant = db.prepare("SELECT id FROM tenants WHERE id = ?").get(GLOBAL_SCOPE_ID);
  if (!existingTenant) {
    db.prepare(
      "INSERT INTO tenants (id, name, description, status, metadata_json, created_by_user_id, created_at, updated_at) VALUES (?, ?, ?, 'system', ?, ?, ?, ?)"
    ).run(GLOBAL_SCOPE_ID, "Global Scope", "Sentinel tenant for global-scoped resources", toJson({ sentinel: true }), GLOBAL_SCOPE_ID, stamp, stamp);
  }
  const existingWorkspace = db.prepare("SELECT id FROM workspaces WHERE id = ?").get(GLOBAL_SCOPE_ID);
  if (!existingWorkspace) {
    db.prepare(
      `INSERT INTO workspaces (id, tenant_id, name, description, status, runtime_provider, sandbox_provider, config_json, config_hash, created_by_user_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'system', 'vefaas', 'e2b', ?, ?, ?, ?, ?)`
    ).run(GLOBAL_SCOPE_ID, GLOBAL_SCOPE_ID, "Global Scope", "Sentinel workspace for global-scoped resources", toJson({ sentinel: true }), "sentinel", GLOBAL_SCOPE_ID, stamp, stamp);
  }
}

function ensureWorkspaceColumns() {
  ensureColumn("tenants", "created_by_user_id", "TEXT");
  ensureColumn("tenants", "updated_by_user_id", "TEXT");
  ensureColumn("tenants", "deleted_by_user_id", "TEXT");
  ensureColumn("tenants", "deleted_at", "TEXT");

  // resource tables: workspace_id + tenant_id (NOT NULL in MySQL; kept TEXT here, the adapter translates)
  const scopedTables = [
    "agents",
    "environments",
    "sessions",
    "vaults",
    "memory_stores",
    "mcp_servers",
    "agent_deployments",
    "model_configs"
  ];
  for (const table of scopedTables) {
    ensureColumn(table, "workspace_id", "TEXT");
    ensureColumn(table, "tenant_id", "TEXT");
  }

  // child tables carry the same scope columns for join-free filtering
  const childTables = [
    "agent_versions",
    "session_threads",
    "session_events",
    "tool_calls",
    "session_artifacts",
    "memories",
    "memory_versions",
    "vault_credentials"
  ];
  for (const table of childTables) {
    ensureColumn(table, "workspace_id", "TEXT");
    ensureColumn(table, "tenant_id", "TEXT");
  }

  // managed_files: scope + creator
  ensureColumn("managed_files", "workspace_id", "TEXT");
  ensureColumn("managed_files", "tenant_id", "TEXT");
  ensureColumn("managed_files", "created_by_user_id", "TEXT");

  // audit columns on core resource tables
  const auditTables = ["agents", "environments", "workspaces", "model_configs", "vaults", "memory_stores", "mcp_servers"];
  for (const table of auditTables) {
    ensureColumn(table, "created_by_user_id", "TEXT");
    ensureColumn(table, "updated_by_user_id", "TEXT");
    ensureColumn(table, "deleted_by_user_id", "TEXT");
    ensureColumn(table, "deleted_at", "TEXT");
  }

  // model_configs secret columns (pre-existing migration)
  ensureColumn("model_configs", "api_key_ciphertext", "TEXT");
  ensureColumn("model_configs", "api_key_hint", "TEXT");
  ensureColumn("workspace_api_keys", "key_ciphertext", "TEXT");
  ensureTenantApiKeysTable();
  // vault_credentials ciphertext column: persist the encrypted OAuth bundle in the DB so it
  // survives a non-persistent secretsDir (veFaaS /tmp). secret_ref stays as a local-file fallback.
  ensureColumn("vault_credentials", "secret_cipher", "TEXT");
  ensureMysqlColumnType("vault_credentials", "secret_cipher", "LONGTEXT");
  ensureColumn("workspace_runtime_pools", "min_instances_per_function", "INTEGER NOT NULL DEFAULT 0");
  ensureDeploymentColumns();
  db.exec(`
    CREATE TABLE IF NOT EXISTS workspace_sandbox_pool_members (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      sandbox_id TEXT NOT NULL,
      status TEXT NOT NULL,
      claimed_session_id TEXT,
      claimed_agent_id TEXT,
      expires_at TEXT,
      last_checked_at TEXT,
      error TEXT,
      config_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sandbox_pool_members_workspace ON workspace_sandbox_pool_members(workspace_id, provider, status);
  `);
  // index created after the column is ensured above, so pre-existing tenants tables migrate cleanly
  db.exec("CREATE INDEX IF NOT EXISTS idx_tenants_created_by ON tenants(created_by_user_id)");
  // session timelines are polled every 500ms while a turn runs — without these the remote
  // MySQL walks the whole events table per tick
  db.exec("CREATE INDEX IF NOT EXISTS idx_session_events_session_created ON session_events(session_id, created_at)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_tool_calls_session_created ON tool_calls(session_id, created_at)");
}

function ensureTenantApiKeysTable() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS tenant_api_keys (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      display_name TEXT NOT NULL,
      key_hash TEXT NOT NULL UNIQUE,
      key_prefix TEXT NOT NULL,
      key_ciphertext TEXT,
      scopes_json TEXT NOT NULL,
      enabled INTEGER NOT NULL,
      created_by_user_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_used_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_tenant_api_keys_hash ON tenant_api_keys(key_hash);
    CREATE INDEX IF NOT EXISTS idx_tenant_api_keys_tenant ON tenant_api_keys(tenant_id);
  `);
  ensureColumn("tenant_api_keys", "key_ciphertext", "TEXT");
  ensureColumn("tenant_api_keys", "created_by_user_id", "TEXT");
  ensureColumn("tenant_api_keys", "last_used_at", "TEXT");
}

function ensureDeploymentColumns() {
  ensureColumn("agent_deployments", "agent_version", "INTEGER");
  ensureColumn("agent_deployments", "initial_events_json", "TEXT");
  ensureColumn("agent_deployments", "schedule_json", "TEXT");
  ensureColumn("agent_deployments", "vault_ids_json", "TEXT");
  ensureColumn("agent_deployments", "memory_store_ids_json", "TEXT");
  ensureColumn("agent_deployments", "resources_json", "TEXT");
  ensureColumn("agent_deployments", "metadata_json", "TEXT");
  ensureColumn("agent_deployments", "next_run_at", "TEXT");
  ensureColumn("agent_deployments", "last_run_at", "TEXT");
  ensureColumn("agent_deployments", "paused_at", "TEXT");
  ensureColumn("agent_deployments", "paused_reason", "TEXT");
  ensureColumn("agent_deployments", "archived_at", "TEXT");
  ensureColumn("agent_deployments", "scheduler_locked_until", "TEXT");
  ensureColumn("agent_deployments", "scheduler_locked_by", "TEXT");
  db.exec(`
    CREATE TABLE IF NOT EXISTS deployment_runs (
      id TEXT PRIMARY KEY,
      deployment_id TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      tenant_id TEXT NOT NULL,
      session_id TEXT,
      triggered_by TEXT NOT NULL,
      triggered_by_user_id TEXT,
      status TEXT NOT NULL,
      error_json TEXT,
      initial_events_json TEXT NOT NULL,
      trigger_context_json TEXT NOT NULL,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_agent_deployments_workspace ON agent_deployments(workspace_id, updated_at);
    CREATE INDEX IF NOT EXISTS idx_agent_deployments_due ON agent_deployments(status, next_run_at);
    CREATE INDEX IF NOT EXISTS idx_deployment_runs_deployment ON deployment_runs(deployment_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_deployment_runs_session ON deployment_runs(session_id);
  `);
}

function ensureTenantAdminBackfill() {
  db.exec(`
    UPDATE tenants t
    JOIN (
      SELECT tenant_id, SUBSTRING_INDEX(GROUP_CONCAT(created_by_user_id ORDER BY created_at ASC SEPARATOR ','), ',', 1) AS owner_user_id
      FROM workspaces
      WHERE tenant_id IS NOT NULL AND tenant_id <> '' AND created_by_user_id IS NOT NULL AND created_by_user_id <> ''
      GROUP BY tenant_id
    ) seed ON seed.tenant_id = t.id
    SET t.created_by_user_id = seed.owner_user_id
    WHERE t.created_by_user_id IS NULL OR t.created_by_user_id = ''
  `);
  db.prepare(`
    INSERT IGNORE INTO tenant_members (id, tenant_id, user_id, role, created_at)
    SELECT CONCAT('tnmem_', LEFT(MD5(CONCAT(w.tenant_id, ':', w.created_by_user_id, ':admin')), 10)), w.tenant_id, w.created_by_user_id, 'admin', ?
    FROM (
      SELECT DISTINCT tenant_id, created_by_user_id
      FROM workspaces
      WHERE tenant_id IS NOT NULL AND tenant_id <> '' AND created_by_user_id IS NOT NULL AND created_by_user_id <> ''
    ) w
    JOIN tenants t ON t.id = w.tenant_id
    JOIN users u ON u.id = w.created_by_user_id
    LEFT JOIN tenant_members tm ON tm.tenant_id = w.tenant_id AND tm.user_id = w.created_by_user_id
    WHERE tm.user_id IS NULL
  `).run(now());
}

function ensureColumn(table: string, column: string, definition: string) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (columns.some((item) => item.name === column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

function ensureMysqlColumnType(table: string, column: string, definition: string) {
  try {
    db.exec(`ALTER TABLE ${table} MODIFY COLUMN ${column} ${definition}`);
  } catch {
    // Non-MySQL adapters do not support MODIFY COLUMN; their TEXT type is already wide enough.
  }
}

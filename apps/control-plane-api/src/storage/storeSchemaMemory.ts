export const memorySchemaSql = `
    CREATE TABLE IF NOT EXISTS memory_stores (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      provider TEXT NOT NULL DEFAULT 'local',
      status TEXT NOT NULL DEFAULT 'active',
      external_ref TEXT,
      config_json TEXT,
      api_key_ciphertext TEXT,
      api_key_hint TEXT,
      metadata_json TEXT NOT NULL,
      archived_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      memory_store_id TEXT NOT NULL,
      path TEXT NOT NULL,
      content TEXT NOT NULL,
      metadata_json TEXT,
      content_sha256 TEXT,
      created_at TEXT,
      updated_at TEXT NOT NULL,
      UNIQUE(memory_store_id, path)
    );
    CREATE TABLE IF NOT EXISTS memory_versions (
      id TEXT PRIMARY KEY,
      memory_id TEXT NOT NULL,
      memory_store_id TEXT,
      path TEXT,
      operation TEXT,
      content TEXT NOT NULL,
      content_sha256 TEXT,
      metadata_json TEXT,
      session_id TEXT,
      actor TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_memories_store_path ON memories(memory_store_id, path);
`;

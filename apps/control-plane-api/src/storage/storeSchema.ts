export const storeSchemaSql = `
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      current_version INTEGER NOT NULL,
      archived_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS agent_versions (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      config_json TEXT NOT NULL,
      config_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(agent_id, version),
      FOREIGN KEY(agent_id) REFERENCES agents(id)
    );
    CREATE TABLE IF NOT EXISTS environments (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      config_json TEXT NOT NULL,
      archived_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      agent_version INTEGER NOT NULL,
      agent_snapshot_json TEXT NOT NULL,
      environment_id TEXT NOT NULL,
      status TEXT NOT NULL,
      workspace_path TEXT NOT NULL,
      metadata_json TEXT NOT NULL,
      archived_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS session_threads (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      agent_name TEXT NOT NULL,
      parent_thread_id TEXT,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS session_events (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      thread_id TEXT,
      type TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      provider_event_type TEXT,
      processed_at TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS tool_calls (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      thread_id TEXT,
      event_id TEXT,
      tool_name TEXT NOT NULL,
      input_json TEXT NOT NULL,
      output_json TEXT,
      status TEXT NOT NULL,
      permission_policy TEXT NOT NULL,
      created_at TEXT NOT NULL,
      completed_at TEXT
    );
    CREATE TABLE IF NOT EXISTS vaults (
      id TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      metadata_json TEXT NOT NULL,
      archived_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS vault_credentials (
      id TEXT PRIMARY KEY,
      vault_id TEXT NOT NULL,
      name TEXT NOT NULL,
      mcp_server_url TEXT,
      auth_type TEXT NOT NULL,
      secret_ref TEXT NOT NULL,
      secret_cipher TEXT,
      metadata_json TEXT NOT NULL,
      archived_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS mcp_servers (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      name TEXT NOT NULL,
      provider TEXT,
      mcp_url TEXT NOT NULL,
      auth_type TEXT NOT NULL,
      config_json TEXT NOT NULL,
      created_by_user_id TEXT,
      archived_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX idx_mcp_servers_workspace ON mcp_servers(workspace_id);
    CREATE TABLE IF NOT EXISTS memory_stores (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
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
      updated_at TEXT NOT NULL,
      UNIQUE(memory_store_id, path)
    );
    CREATE TABLE IF NOT EXISTS memory_versions (
      id TEXT PRIMARY KEY,
      memory_id TEXT NOT NULL,
      content TEXT NOT NULL,
      actor TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS skills (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      source_type TEXT NOT NULL,
      source_path TEXT NOT NULL,
      current_version INTEGER NOT NULL,
      metadata_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS skill_versions (
      id TEXT PRIMARY KEY,
      skill_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      manifest_json TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(skill_id, version)
    );
    CREATE TABLE IF NOT EXISTS agent_templates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      category TEXT NOT NULL,
      template_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      auth_provider TEXT NOT NULL,
      role TEXT NOT NULL,
      metadata_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS auth_sessions (
      id TEXT PRIMARY KEY,
      token_hash TEXT NOT NULL UNIQUE,
      user_id TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(id)
    );
    CREATE TABLE IF NOT EXISTS model_configs (
      id TEXT PRIMARY KEY,
      owner_user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      provider_type TEXT NOT NULL,
      base_url TEXT NOT NULL,
      model_name TEXT NOT NULL,
      api_key_ref TEXT,
      api_key_ciphertext TEXT,
      api_key_hint TEXT,
      preset_key TEXT,
      is_default INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(owner_user_id) REFERENCES users(id)
    );
    CREATE TABLE IF NOT EXISTS agent_deployments (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, workspace_id TEXT NOT NULL, tenant_id TEXT NOT NULL,
      agent_id TEXT NOT NULL, agent_version INTEGER, environment_id TEXT NOT NULL,
      name TEXT NOT NULL, version TEXT NOT NULL, manifest_json TEXT NOT NULL, bundle_json TEXT NOT NULL,
      initial_events_json TEXT NOT NULL, schedule_json TEXT, vault_ids_json TEXT NOT NULL,
      memory_store_ids_json TEXT NOT NULL, resources_json TEXT NOT NULL, metadata_json TEXT NOT NULL,
      status TEXT NOT NULL, next_run_at TEXT, last_run_at TEXT, paused_at TEXT, paused_reason TEXT,
      archived_at TEXT, scheduler_locked_until TEXT, scheduler_locked_by TEXT, created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(user_id, name, version),
      FOREIGN KEY(user_id) REFERENCES users(id),
      FOREIGN KEY(agent_id) REFERENCES agents(id),
      FOREIGN KEY(environment_id) REFERENCES environments(id)
    );
    CREATE TABLE IF NOT EXISTS deployment_runs (
      id TEXT PRIMARY KEY, deployment_id TEXT NOT NULL, workspace_id TEXT NOT NULL, tenant_id TEXT NOT NULL,
      session_id TEXT, triggered_by TEXT NOT NULL, triggered_by_user_id TEXT, status TEXT NOT NULL,
      error_json TEXT, initial_events_json TEXT NOT NULL, trigger_context_json TEXT NOT NULL,
      started_at TEXT NOT NULL, finished_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      FOREIGN KEY(deployment_id) REFERENCES agent_deployments(id),
      FOREIGN KEY(session_id) REFERENCES sessions(id)
    );
    CREATE TABLE IF NOT EXISTS managed_files (
      id TEXT PRIMARY KEY,
      filename TEXT NOT NULL,
      media_type TEXT NOT NULL,
      bytes INTEGER NOT NULL,
      sha256 TEXT NOT NULL,
      storage_provider TEXT NOT NULL,
      bucket TEXT NOT NULL,
      object_key TEXT NOT NULL,
      public_url TEXT,
      metadata_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS session_artifacts (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      path TEXT NOT NULL,
      filename TEXT NOT NULL,
      media_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      sha256 TEXT NOT NULL,
      storage_provider TEXT NOT NULL,
      bucket TEXT NOT NULL,
      object_key TEXT NOT NULL,
      public_url TEXT,
      metadata_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(session_id, path),
      FOREIGN KEY(session_id) REFERENCES sessions(id)
    );
    CREATE INDEX idx_sessions_status ON sessions(status);
    CREATE INDEX idx_events_session_created ON session_events(session_id, created_at);
    CREATE INDEX idx_tool_calls_session_created ON tool_calls(session_id, created_at);
    CREATE INDEX idx_memories_store_path ON memories(memory_store_id, path);
    CREATE INDEX idx_auth_sessions_hash ON auth_sessions(token_hash);
    CREATE UNIQUE INDEX idx_users_email_unique ON users(email);
    CREATE INDEX idx_model_configs_owner ON model_configs(owner_user_id);
    CREATE INDEX idx_agent_deployments_user ON agent_deployments(user_id, created_at);
    CREATE INDEX idx_deployment_runs_deployment ON deployment_runs(deployment_id, created_at);
    CREATE INDEX idx_deployment_runs_session ON deployment_runs(session_id);
    CREATE INDEX idx_managed_files_created ON managed_files(created_at);
    CREATE INDEX idx_session_artifacts_session ON session_artifacts(session_id, updated_at);
    CREATE TABLE IF NOT EXISTS tenants (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      status TEXT NOT NULL,
      metadata_json TEXT NOT NULL,
      created_by_user_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS tenant_members (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(tenant_id, user_id),
      FOREIGN KEY(tenant_id) REFERENCES tenants(id),
      FOREIGN KEY(user_id) REFERENCES users(id)
    );
    CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      status TEXT NOT NULL,
      runtime_provider TEXT NOT NULL,
      sandbox_provider TEXT NOT NULL,
      config_json TEXT NOT NULL,
      config_hash TEXT NOT NULL,
      created_by_user_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(tenant_id) REFERENCES tenants(id),
      FOREIGN KEY(created_by_user_id) REFERENCES users(id)
    );
    CREATE TABLE IF NOT EXISTS workspace_members (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(workspace_id, user_id),
      FOREIGN KEY(workspace_id) REFERENCES workspaces(id),
      FOREIGN KEY(user_id) REFERENCES users(id)
    );
    CREATE TABLE IF NOT EXISTS workspace_runtime_pools (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      desired_size INTEGER NOT NULL,
      min_instances_per_function INTEGER NOT NULL DEFAULT 0,
      max_instances_per_function INTEGER NOT NULL,
      max_concurrency_per_instance INTEGER NOT NULL,
      cpu_milli INTEGER NOT NULL,
      memory_mb INTEGER NOT NULL,
      status TEXT NOT NULL,
      config_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(workspace_id) REFERENCES workspaces(id)
    );
    CREATE TABLE IF NOT EXISTS workspace_runtime_pool_members (
      id TEXT PRIMARY KEY,
      runtime_pool_id TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      cloud_function_id TEXT NOT NULL,
      cloud_app_id TEXT NOT NULL,
      invoke_url TEXT NOT NULL,
      region TEXT NOT NULL,
      status TEXT NOT NULL,
      weight INTEGER NOT NULL,
      active_session_count INTEGER NOT NULL,
      config_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(runtime_pool_id) REFERENCES workspace_runtime_pools(id),
      FOREIGN KEY(workspace_id) REFERENCES workspaces(id)
    );
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
      updated_at TEXT NOT NULL,
      FOREIGN KEY(workspace_id) REFERENCES workspaces(id)
    );
    CREATE TABLE IF NOT EXISTS workspace_api_keys (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      display_name TEXT NOT NULL,
      key_hash TEXT NOT NULL UNIQUE,
      key_prefix TEXT NOT NULL,
      key_ciphertext TEXT,
      scopes_json TEXT NOT NULL,
      enabled INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_used_at TEXT,
      FOREIGN KEY(workspace_id) REFERENCES workspaces(id)
    );
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
      last_used_at TEXT,
      FOREIGN KEY(tenant_id) REFERENCES tenants(id)
    );
    CREATE INDEX idx_tenant_members_user ON tenant_members(user_id);
    CREATE INDEX idx_workspace_members_user ON workspace_members(user_id);
    CREATE INDEX idx_runtime_pool_members_workspace ON workspace_runtime_pool_members(workspace_id, status);
    CREATE INDEX idx_sandbox_pool_members_workspace ON workspace_sandbox_pool_members(workspace_id, provider, status);
    CREATE INDEX idx_workspace_api_keys_hash ON workspace_api_keys(key_hash);
    CREATE INDEX idx_tenant_api_keys_hash ON tenant_api_keys(key_hash);
    CREATE INDEX idx_tenant_api_keys_tenant ON tenant_api_keys(tenant_id);
  `;

SET @stamp = '2026-01-01T00:00:00.000Z';

INSERT INTO users (id, email, name, auth_provider, role, metadata_json, created_at, updated_at)
VALUES
  ('user_demo_admin', 'demo-admin@openmaple.local', 'Demo Admin', 'local', 'member', '{"source":"local_demo_seed"}', @stamp, @stamp),
  ('user_demo_member', 'demo-member@openmaple.local', 'Demo Member', 'local', 'member', '{"source":"local_demo_seed"}', @stamp, @stamp)
ON DUPLICATE KEY UPDATE updated_at = VALUES(updated_at);

INSERT INTO tenants (id, name, description, status, metadata_json, created_by_user_id, created_at, updated_at)
VALUES
  ('tenant_demo_alpha', 'Demo Alpha Tenant', 'Local Docker demo tenant with active sessions.', 'active', '{"slug":"demo-alpha","source":"local_demo_seed"}', 'user_demo_admin', @stamp, @stamp),
  ('tenant_demo_beta', 'Demo Beta Tenant', 'Second tenant for tenant switching checks.', 'active', '{"slug":"demo-beta","source":"local_demo_seed"}', 'user_demo_admin', @stamp, @stamp)
ON DUPLICATE KEY UPDATE updated_at = VALUES(updated_at);

INSERT INTO tenant_members (id, tenant_id, user_id, role, created_at)
VALUES
  ('tm_demo_alpha_admin', 'tenant_demo_alpha', 'user_demo_admin', 'admin', @stamp),
  ('tm_demo_alpha_member', 'tenant_demo_alpha', 'user_demo_member', 'member', @stamp),
  ('tm_demo_beta_admin', 'tenant_demo_beta', 'user_demo_admin', 'admin', @stamp)
ON DUPLICATE KEY UPDATE role = VALUES(role);

INSERT INTO workspaces (id, tenant_id, name, description, status, runtime_provider, sandbox_provider, config_json, config_hash, created_by_user_id, created_at, updated_at)
VALUES
  (
    'ws_demo_alpha',
    'tenant_demo_alpha',
    'Demo Alpha Workspace',
    'Seeded workspace for local Docker exploration.',
    'active',
    'local_docker',
    'local_docker',
    '{"slug":"demo-alpha","tenant_slug":"demo-alpha","runtime_provider":"local_docker","sandbox_provider":"local_docker","runtime_pool":{"desired_size":2},"sandbox_pool":{"desired_size":1,"standby_ttl_ms":1800000},"model_config_ids":["modelcfg_demo_local"],"provider_credentials":{"vefaas":{},"e2b":{}},"cloud_provider_identities":{"local_docker":{"provider":"local_docker","label":"Local Docker","identity_type":"host_docker_socket","credential_source":"docker.sock","region":"local","services":["runtime:local_docker","sandbox:local_docker"],"configured":true}}}',
    'demo-alpha-hash',
    'user_demo_admin',
    @stamp,
    @stamp
  ),
  (
    'ws_demo_beta',
    'tenant_demo_beta',
    'Demo Beta Workspace',
    'Second seeded workspace for tenant switching.',
    'active',
    'local_docker',
    'local_docker',
    '{"slug":"demo-beta","tenant_slug":"demo-beta","runtime_provider":"local_docker","sandbox_provider":"local_docker","runtime_pool":{"desired_size":1},"sandbox_pool":{"desired_size":1,"standby_ttl_ms":1800000},"model_config_ids":[],"provider_credentials":{"vefaas":{},"e2b":{}}}',
    'demo-beta-hash',
    'user_demo_admin',
    @stamp,
    @stamp
  )
ON DUPLICATE KEY UPDATE updated_at = VALUES(updated_at);

INSERT INTO workspace_members (id, workspace_id, user_id, role, created_at)
VALUES
  ('wm_demo_alpha_admin', 'ws_demo_alpha', 'user_demo_admin', 'admin', @stamp),
  ('wm_demo_alpha_member', 'ws_demo_alpha', 'user_demo_member', 'member', @stamp),
  ('wm_demo_beta_admin', 'ws_demo_beta', 'user_demo_admin', 'admin', @stamp)
ON DUPLICATE KEY UPDATE role = VALUES(role);

INSERT INTO model_configs (id, owner_user_id, workspace_id, tenant_id, created_by_user_id, name, provider_type, base_url, model_name, api_key_ref, api_key_ciphertext, api_key_hint, preset_key, is_default, created_at, updated_at)
VALUES
  ('modelcfg_demo_local', 'user_demo_admin', 'ws_demo_alpha', 'tenant_demo_alpha', 'user_demo_admin', 'Demo local model', 'openai', 'https://api.openai.com/v1', 'gpt-4.1-mini', NULL, NULL, NULL, NULL, 1, @stamp, @stamp)
ON DUPLICATE KEY UPDATE updated_at = VALUES(updated_at);

INSERT INTO workspace_runtime_pools (id, workspace_id, provider, desired_size, min_instances_per_function, max_instances_per_function, max_concurrency_per_instance, cpu_milli, memory_mb, status, config_json, created_at, updated_at)
VALUES
  ('rpool_demo_alpha', 'ws_demo_alpha', 'local_docker', 2, 0, 1, 1, 1000, 2048, 'active', '{"image":"node:22-bookworm"}', @stamp, @stamp),
  ('rpool_demo_beta', 'ws_demo_beta', 'local_docker', 1, 0, 1, 1, 1000, 2048, 'active', '{"image":"node:22-bookworm"}', @stamp, @stamp)
ON DUPLICATE KEY UPDATE updated_at = VALUES(updated_at);

INSERT INTO workspace_runtime_pool_members (id, runtime_pool_id, workspace_id, provider, cloud_function_id, cloud_app_id, invoke_url, region, status, weight, active_session_count, config_json, created_at, updated_at)
VALUES
  ('rpmem_demo_alpha_1', 'rpool_demo_alpha', 'ws_demo_alpha', 'local_docker', 'local-runtime-demo-alpha-1', 'local-docker', 'local://runtime/demo-alpha-1', 'local', 'active', 1, 1, '{"image":"node:22-bookworm","role":"agent_loop"}', @stamp, @stamp),
  ('rpmem_demo_alpha_2', 'rpool_demo_alpha', 'ws_demo_alpha', 'local_docker', 'local-runtime-demo-alpha-2', 'local-docker', 'local://runtime/demo-alpha-2', 'local', 'active', 1, 0, '{"image":"node:22-bookworm","role":"agent_loop"}', @stamp, @stamp),
  ('rpmem_demo_beta_1', 'rpool_demo_beta', 'ws_demo_beta', 'local_docker', 'local-runtime-demo-beta-1', 'local-docker', 'local://runtime/demo-beta-1', 'local', 'active', 1, 0, '{"image":"node:22-bookworm","role":"agent_loop"}', @stamp, @stamp)
ON DUPLICATE KEY UPDATE updated_at = VALUES(updated_at);

INSERT INTO workspace_sandbox_pool_members (id, workspace_id, provider, sandbox_id, status, claimed_session_id, claimed_agent_id, expires_at, last_checked_at, error, config_json, created_at, updated_at)
VALUES
  ('spmem_demo_alpha_1', 'ws_demo_alpha', 'local_docker', 'local-sandbox-demo-alpha-1', 'standby', NULL, NULL, '2026-01-01T00:30:00.000Z', @stamp, NULL, '{"image":"node:22-bookworm"}', @stamp, @stamp),
  ('spmem_demo_beta_1', 'ws_demo_beta', 'local_docker', 'local-sandbox-demo-beta-1', 'standby', NULL, NULL, '2026-01-01T00:30:00.000Z', @stamp, NULL, '{"image":"node:22-bookworm"}', @stamp, @stamp)
ON DUPLICATE KEY UPDATE updated_at = VALUES(updated_at);

INSERT INTO environments (id, name, config_json, workspace_id, tenant_id, created_at, updated_at)
VALUES
  ('env_demo_alpha', 'Demo local Docker environment', '{"type":"local_docker","sandbox":{"provider":"local_docker"},"image":"node:22-bookworm","networking":{"mode":"limited","allow_package_managers":true}}', 'ws_demo_alpha', 'tenant_demo_alpha', @stamp, @stamp),
  ('env_demo_beta', 'Demo beta environment', '{"type":"local_docker","sandbox":{"provider":"local_docker"},"image":"node:22-bookworm"}', 'ws_demo_beta', 'tenant_demo_beta', @stamp, @stamp)
ON DUPLICATE KEY UPDATE updated_at = VALUES(updated_at);

INSERT INTO agents (id, name, description, current_version, workspace_id, tenant_id, created_at, updated_at)
VALUES
  ('agent_demo_support', 'Demo Support Agent', 'Answers support questions and writes session notes.', 1, 'ws_demo_alpha', 'tenant_demo_alpha', @stamp, @stamp),
  ('agent_demo_research', 'Demo Research Agent', 'Summarizes research tasks in the second tenant.', 1, 'ws_demo_beta', 'tenant_demo_beta', @stamp, @stamp)
ON DUPLICATE KEY UPDATE updated_at = VALUES(updated_at);

INSERT INTO agent_versions (id, agent_id, version, config_json, config_hash, workspace_id, tenant_id, created_at)
VALUES
  ('agentver_demo_support_1', 'agent_demo_support', 1, '{"name":"Demo Support Agent","description":"Answers support questions and writes session notes.","model":{"provider":"openai","id":"gpt-4.1-mini","config_id":"modelcfg_demo_local","name":"Demo local model"},"system":"You are a local Docker demo support agent.","tools":[{"type":"agent_toolset_20260401","default_config":{"read":true,"write":true,"bash":true}}],"mcp_servers":[],"skills":[],"agent_loop":{"type":"anthropic_claude_code","config":{},"hooks":[]}}', 'demo-support-config-hash', 'ws_demo_alpha', 'tenant_demo_alpha', @stamp),
  ('agentver_demo_research_1', 'agent_demo_research', 1, '{"name":"Demo Research Agent","description":"Summarizes research tasks in the second tenant.","model":{"provider":"openai","id":"gpt-4.1-mini","name":"Demo local model"},"system":"You are a local Docker demo research agent.","tools":[{"type":"agent_toolset_20260401","default_config":{"read":true,"write":true}}],"mcp_servers":[],"skills":[],"agent_loop":{"type":"anthropic_claude_code","config":{},"hooks":[]}}', 'demo-research-config-hash', 'ws_demo_beta', 'tenant_demo_beta', @stamp)
ON DUPLICATE KEY UPDATE created_at = VALUES(created_at);

INSERT INTO sessions (id, title, agent_id, agent_version, agent_snapshot_json, environment_id, status, workspace_path, metadata_json, workspace_id, tenant_id, created_at, updated_at)
VALUES
  ('sess_demo_alpha_1', 'Demo Alpha session with completed tool call', 'agent_demo_support', 1, '{"name":"Demo Support Agent","description":"Answers support questions and writes session notes.","model":{"provider":"openai","id":"gpt-4.1-mini","config_id":"modelcfg_demo_local","name":"Demo local model"},"system":"You are a local Docker demo support agent.","tools":[{"type":"agent_toolset_20260401","default_config":{"read":true,"write":true,"bash":true}}],"mcp_servers":[],"skills":[],"agent_loop":{"type":"anthropic_claude_code","config":{},"hooks":[]}}', 'env_demo_alpha', 'idle', '/app/.managed-agents/sessions/sess_demo_alpha_1', '{"owner_user_id":"user_demo_admin","runtime_pool_id":"rpool_demo_alpha","runtime_pool_member_id":"rpmem_demo_alpha_1","agent_runtime":{"type":"local_docker","provider":"local_docker","image":"node:22-bookworm"}}', 'ws_demo_alpha', 'tenant_demo_alpha', @stamp, @stamp),
  ('sess_demo_beta_1', 'Demo Beta planning session', 'agent_demo_research', 1, '{"name":"Demo Research Agent","description":"Summarizes research tasks in the second tenant.","model":{"provider":"openai","id":"gpt-4.1-mini","name":"Demo local model"},"system":"You are a local Docker demo research agent.","tools":[{"type":"agent_toolset_20260401","default_config":{"read":true,"write":true}}],"mcp_servers":[],"skills":[],"agent_loop":{"type":"anthropic_claude_code","config":{},"hooks":[]}}', 'env_demo_beta', 'idle', '/app/.managed-agents/sessions/sess_demo_beta_1', '{"owner_user_id":"user_demo_admin","runtime_pool_id":"rpool_demo_beta","runtime_pool_member_id":"rpmem_demo_beta_1","agent_runtime":{"type":"local_docker","provider":"local_docker","image":"node:22-bookworm"}}', 'ws_demo_beta', 'tenant_demo_beta', @stamp, @stamp)
ON DUPLICATE KEY UPDATE updated_at = VALUES(updated_at);

INSERT INTO session_events (id, session_id, type, payload_json, workspace_id, tenant_id, created_at)
VALUES
  ('sevt_demo_alpha_user', 'sess_demo_alpha_1', 'user.message', '{"content":[{"type":"text","text":"Create a short onboarding note for the local Docker setup."}]}', 'ws_demo_alpha', 'tenant_demo_alpha', @stamp),
  ('sevt_demo_alpha_tool', 'sess_demo_alpha_1', 'tool.result', '{"tool_name":"write_file","status":"completed","output":{"path":"notes/onboarding.md","bytes":128}}', 'ws_demo_alpha', 'tenant_demo_alpha', @stamp),
  ('sevt_demo_alpha_agent', 'sess_demo_alpha_1', 'agent.message', '{"content":[{"type":"text","text":"Created notes/onboarding.md in the session workspace."}]}', 'ws_demo_alpha', 'tenant_demo_alpha', @stamp),
  ('sevt_demo_beta_user', 'sess_demo_beta_1', 'user.message', '{"content":[{"type":"text","text":"Summarize the second tenant demo workspace."}]}', 'ws_demo_beta', 'tenant_demo_beta', @stamp)
ON DUPLICATE KEY UPDATE created_at = VALUES(created_at);

INSERT INTO tool_calls (id, session_id, event_id, tool_name, input_json, output_json, status, permission_policy, workspace_id, tenant_id, created_at, completed_at)
VALUES
  ('tool_demo_alpha_write', 'sess_demo_alpha_1', 'sevt_demo_alpha_tool', 'write_file', '{"path":"notes/onboarding.md"}', '{"path":"notes/onboarding.md","bytes":128}', 'completed', 'workspace_write', 'ws_demo_alpha', 'tenant_demo_alpha', @stamp, @stamp)
ON DUPLICATE KEY UPDATE completed_at = VALUES(completed_at);

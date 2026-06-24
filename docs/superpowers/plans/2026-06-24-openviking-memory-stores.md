# OpenViking Memory Stores Plan

## Scope

Build managed-agent-style memory stores for OpenMaple, backed by the existing local DB path and an OpenViking provider adapter.

Primary parity targets:

- Workspace-scoped memory stores.
- Session/deployment resources with `type: "memory_store"`, `memory_store_id`, `access`, and optional `instructions`.
- Read/write access enforcement per attached store.
- Agent tools search/write only attached stores.
- Memory records addressed by path, versioned on every write.
- Memory store UI: list, create modal, detail split view, add/update memory.
- Create Session and Create Deployment UI can attach up to 8 memory stores.

References:

- Claude Managed Agents memory: https://platform.claude.com/docs/zh-CN/managed-agents/memory
- OpenViking: https://github.com/volcengine/OpenViking
- OpenViking filesystem API: `/api/v1/content/read`, `/api/v1/content/write`
- OpenViking retrieval API: `/api/v1/search/find`

## UI Design

### Memory Stores Page

Layout:

- Header: `Memory stores`, count, primary `Create memory store`.
- Search input filters by name, ID, description, provider.
- Table columns: ID, Name, Status, Provider, Memories, Created.
- Selecting a row opens detail layout below/alongside list.

Create modal:

- Name, required.
- Description, optional.
- Provider:
  - `Local` for current MySQL-compatible local store.
  - `OpenViking` for remote `viking://` backed store.
- OpenViking fields:
  - Base URL, optional when `OPENVIKING_BASE_URL` is configured.
  - Target URI, optional; default `viking://user/memories/<store-id>`.
  - API key, optional; encrypted server-side, never returned to client.
- Helper copy: name and description are rendered into the agent memory prompt when attached.

Detail:

- Header: name, status, ID, created time, provider, external URI.
- Left pane: memory path tree derived from slash-separated paths.
- Right pane:
  - Empty state: `Select a memory`.
  - Selected path preview.
  - Content textarea for edit.
  - Version count and last updated metadata.
- Primary action: `Add memory`.
- Add memory modal:
  - Path.
  - Content.
  - `Create memory` button.
  - Note: folders are derived from slashes in path.

### Create Session

Add `Resources` section under credential vaults:

- `Add memory store` button.
- Each memory resource row:
  - Memory store select.
  - Access select: `Read & write` or `Read only`.
  - Instructions textarea.
  - Remove icon.
- Max 8 rows, matching managed-agent limit.
- If read/write selected, show injection-risk warning in modal note.

Payload:

```json
{
  "resources": [
    {
      "type": "memory_store",
      "memory_store_id": "mem_xxx",
      "access": "read_write",
      "instructions": "Use this for project conventions."
    }
  ]
}
```

### Create Deployment

Add `Memory stores (optional)` section in `DeploymentCreatePanel`:

- Same row UI as Create Session.
- Saved deployment stores both `resources` and derived `memory_store_ids` for compatibility.
- Detail panel shows memory store pills with access labels.
- Runs inherit deployment resources unless run request overrides them.

## Technical Design

### Data Model

Extend existing tables without breaking older rows:

- `memory_stores`
  - `provider TEXT DEFAULT 'local'`
  - `status TEXT DEFAULT 'active'`
  - `external_ref TEXT`
  - `config_json TEXT`
  - `api_key_ciphertext TEXT`
  - `api_key_hint TEXT`
- `memories`
  - `metadata_json TEXT`
  - `content_sha256 TEXT`
  - `created_at TEXT`
- `memory_versions`
  - `memory_store_id TEXT`
  - `path TEXT`
  - `operation TEXT`
  - `content_sha256 TEXT`
  - `metadata_json TEXT`
  - `session_id TEXT`

Keep current columns and hydrate defaults so existing stores still work.

### Memory Resource Contract

Normalize every memory resource through one helper:

```ts
type MemoryStoreResource = {
  type: "memory_store";
  memory_store_id: string;
  access: "read_write" | "read_only";
  instructions?: string;
};
```

Rules:

- Max 8 memory stores per session/deployment.
- Store must exist in the requested workspace.
- Duplicate store IDs collapse to first occurrence.
- `instructions` max 4096 characters.
- Legacy `metadata.memory_store_ids` become read/write resources only when no explicit resource exists.

### Runtime Access

Replace global memory tool access with session-scoped access:

- `memory_search(session, input)`
  - Searches only attached memory stores.
  - If `memory_store_id` supplied and not attached, throws `memory_store_not_attached`.
  - Includes `access`, provider, and path in results.
- `memory_write(session, input)`
  - Requires attached store.
  - Requires `access === "read_write"`.
  - Rejects read-only with `memory_store_read_only`.
  - Enforces path and content limits.
  - Writes local DB or OpenViking adapter.

Session prompt gets a memory resource manifest:

- Store name, ID, access, instructions.
- Tell agent to use `memory_search` and `memory_write`.
- Keep file upload prompt behavior unchanged.

### OpenViking Adapter

Provider config:

- Store metadata/config:
  - `provider: "openviking"`
  - `external_ref: "viking://user/memories/<store-id>"`
  - `base_url`
- API key source:
  - `api_key_ciphertext` on store, encrypted with current secret helper.
  - Fallback `OPENVIKING_API_KEY`.

Methods:

- `findMemories(store, query, limit)`
  - `POST /api/v1/search/find`
  - Body includes `query`, `target_uri`, `context_type: ["memory"]`, `node_limit`.
- `writeMemory(store, path, content, mode)`
  - `POST /api/v1/content/write`
  - URI: `${external_ref}/${path}`
  - Mode: `create` for first write, `replace` for update.
- `readMemory(store, path)`
  - `GET /api/v1/content/read?uri=...`

Local DB remains default and deterministic for tests. OpenViking requests are unit-tested with a stub `fetch`.

### API

Extend:

- `POST /v1/memory_stores`
  - Accept provider/config/api key.
  - Return safe fields only.
- `GET /v1/memory_stores/:id/memories`
  - Local: DB list/filter.
  - OpenViking: search/list fallback when query exists; DB cache remains source for UI-written paths.
- `PUT /v1/memory_stores/:id/memories/*path`
  - Validate path/content.
  - Version every update.
  - Forward to OpenViking when provider is `openviking`.
- `GET /v1/memory_stores/:id/memories/*path`
  - Read one memory for detail preview.

Add helpers instead of duplicating validation in session/deployment routes:

- `normalizeMemoryStoreResources(resources, workspaceId)`
- `memoryStoreResourceError(resources, workspaceId)`
- `memoryStoreIdsFromResources(resources)`

### Security

- No global memory lookup from runtime tools.
- No foreign workspace memory attach.
- No API key in API responses.
- `read_only` blocks writes before provider call.
- Path normalization rejects absolute paths, `..`, empty segments, and paths over 512 chars.
- Content max 100 KiB.

## TDD Plan

Write failing tests first:

- `tests/contracts/memory_store_contract.ts`
  - Create local memory store; list scoped to workspace.
  - Create OpenViking store; API key is encrypted and not returned.
  - Write memory path; update creates second version with sha.
  - Invalid path/content rejected.
  - Create session with attached read/write memory resource.
  - Create session rejects missing/foreign memory store.
  - `memory_search` with no session attachments returns no global leaks.
  - `memory_write` to read-only store fails with `memory_store_read_only`.
  - `memory_write` to read/write store persists content/version/session actor.
  - Deployment create/run carries memory resources into run session.
- `tests/contracts/openviking_memory_contract.ts`
  - Stub fetch validates `/api/v1/search/find`, `/api/v1/content/write`, `X-API-Key`, and `viking://` URI mapping.
- Extend `tests/contracts/maple_ui_interaction_contract.ts`
  - Assert UI contains create memory store modal fields, memory detail split, Add memory modal, Session resources, Deployment memory resources.

Implementation starts only after new memory tests fail on current code.

## Verification Plan

Local:

- `bun tests/contracts/memory_store_contract.ts`
- `bun tests/contracts/openviking_memory_contract.ts`
- `bun tests/contracts/maple_ui_interaction_contract.ts`
- `bunx tsc --noEmit`
- `bunx vite build --config apps/admin-web/vite.config.ts`
- Run local API + web with temp `MAPLE_DATA_DIR`.
- Browser e2e screenshots:
  - Memory store list/create/detail/add memory.
  - Create Session with memory resource.
  - Create Deployment with memory resource and run detail.

Online e2e:

- Discover configured online console/API URL from env/repo deployment config.
- Use a dedicated test workspace/store with unique timestamp.
- Scenarios:
  - Create OpenViking-backed memory store.
  - Add memory path and verify detail preview.
  - Start session with read-only store and verify write blocked.
  - Start session/deployment with read/write store and verify write persists.
- Capture 1-2 screenshots per scenario.
- If online credentials or endpoint are unavailable, report exact blocker, exact URL/env checked, and local proof completed.

## Tasks

- [ ] Create design plan.
- [ ] Add failing memory contracts.
- [ ] Add failing OpenViking adapter contract.
- [ ] Add failing UI static contract.
- [ ] Implement DB migrations and hydrators.
- [ ] Implement memory validation/resource helpers.
- [ ] Implement OpenViking adapter.
- [ ] Make runtime memory tools session-scoped.
- [ ] Extend memory store routes.
- [ ] Extend session/deployment resource validation.
- [ ] Build MemoryView create/detail/add UI.
- [ ] Add memory resource controls to SessionModal.
- [ ] Add memory resource controls to DeploymentsView.
- [ ] Run local contracts/typecheck/build.
- [ ] Run local browser e2e and save screenshots.
- [ ] Run online e2e and save screenshots.

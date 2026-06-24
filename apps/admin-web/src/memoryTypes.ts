import type { JsonRecord } from "./types";

export type MemoryStore = {
  id: string;
  name: string;
  description: string;
  provider?: "local" | "openviking" | string;
  status?: string;
  external_ref?: string | null;
  config?: JsonRecord;
  api_key_hint?: string | null;
  memory_count?: number;
  workspace_id?: string | null;
  metadata: JsonRecord;
  created_at?: string;
  updated_at?: string;
};

export type MemoryRecord = {
  id: string;
  memory_store_id: string;
  path: string;
  content: string;
  metadata?: JsonRecord;
  content_sha256?: string;
  created_at?: string;
  updated_at?: string;
};

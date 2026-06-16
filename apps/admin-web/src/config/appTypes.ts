import { createContext, useContext } from "react";
import type { Agent, Environment, ModelConfig, Session, SessionDetail, Vault, Workspace } from "../types";

export type View =
  | "dashboard"
  | "quickstart"
  | "agents"
  | "deployments"
  | "sessions"
  | "environments"
  | "vaults"
  | "tenant"
  | "models"
  | "api_keys"
  | "docs"
  | "memory"
  | "users"
  | "skills"
  | "usage"
  | "logs"
  | "caching"
  | "artifacts"
  | "workbench"
  | "files"
  | "batches"
  | "claudecode"
  | "agent"
  | "environment"
  | "vault"
  | "credential"
  | "provision"
  | "tenant_select"
  | "tenant_choice"
  | "no_access";

export type EntityKind = "agent" | "environment" | "vault" | "session" | "workspace";
export type EntityNavValue = {
  data: {
    agents: Agent[];
    sessions: Session[];
    environments: Environment[];
    vaults: Vault[];
    modelConfigs: ModelConfig[];
    workspaces: Workspace[];
    workspace: Workspace | null;
  };
  openEntity: (kind: EntityKind, id: string) => void;
  goView: (view: View, id?: string, edit?: boolean) => void;
  openSessionForAgent: (agentId: string) => void;
  openCredentialForVault: (vaultId: string) => void;
  refresh: () => Promise<void> | void;
};
export const EntityNavContext = createContext<EntityNavValue | null>(null);
export function useEntityNav(): EntityNavValue {
  const value = useContext(EntityNavContext);
  if (!value) throw new Error("useEntityNav requires EntityNavProvider");
  return value;
}

export type AccessibleTenant = {
  id: string;
  slug?: string;
  name: string;
  status: string;
  created_by_user_id?: string;
  is_creator?: number;
  is_owner: number;
  is_member?: number;
  workspace_count: number;
  primary_workspace_id: string;
};
export type WizardStep = "describe" | "agent_review" | "environment" | "vault" | "session" | "integration";
export type Modal = "environment" | "vault" | "credential" | "session" | "model_config" | "workspace_settings" | "workspace_create" | "mcp_connect" | "agent_create" | null;
export type QuickstartBuilderResponse = { session: Session; detail: SessionDetail | null };
export type QuickstartBuilderActionResponse = { detail: SessionDetail | null };
export type OnboardingCustomModelConfig = {
  local_id: string;
  kind: "custom" | "preset";
  name: string;
  protocol?: "openai" | "anthropic";
  preset_key?: string;
  base_url?: string;
  model_name?: string;
  api_key?: string;
  is_default: boolean;
};

export type Language = "zh" | "en";

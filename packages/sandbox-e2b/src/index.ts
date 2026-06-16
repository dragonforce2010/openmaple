import type { SandboxProvider } from "@maple/sandbox-core";

export type E2BSandboxProviderOptions = {
  template?: string;
  workspace_path?: string;
};

export function createE2BSandboxProvider(options: E2BSandboxProviderOptions = {}): SandboxProvider {
  return {
    name: "e2b",
    async ensure(context) {
      return {
        provider: "e2b",
        sandbox_id: `e2b-${context.session_id}`,
        workspace_path: options.workspace_path || "/workspace",
        metadata: { template: options.template || "base" }
      };
    }
  };
}

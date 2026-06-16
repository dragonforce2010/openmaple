import type { SandboxProvider } from "@maple/sandbox-core";

export type VefaasSandboxProviderOptions = {
  function_id?: string;
  gateway_url?: string;
  workspace_path?: string;
};

export function createVefaasSandboxProvider(options: VefaasSandboxProviderOptions = {}): SandboxProvider {
  return {
    name: "vefaas",
    async ensure(context) {
      return {
        provider: "vefaas",
        sandbox_id: `vefaas-${context.session_id}`,
        workspace_path: options.workspace_path || "/home/tiger/workspace",
        metadata: {
          function_id: options.function_id || "",
          gateway_url: options.gateway_url || ""
        }
      };
    }
  };
}

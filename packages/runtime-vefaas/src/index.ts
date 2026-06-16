import type { RuntimeProvider } from "@maple/runtime-core";

export type VefaasRuntimeProviderOptions = {
  invoke_url?: string;
  function_id?: string;
};

export function createVefaasRuntimeProvider(options: VefaasRuntimeProviderOptions = {}): RuntimeProvider {
  return {
    name: "vefaas",
    async ensure(context) {
      return {
        provider: "vefaas",
        runtime_id: options.function_id || `vefaas-${context.session_id}`,
        invoke_url: options.invoke_url,
        metadata: { workspace_path: context.workspace_path }
      };
    }
  };
}

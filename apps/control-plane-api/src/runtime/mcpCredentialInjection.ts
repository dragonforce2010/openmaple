import type { AgentConfig, JsonRecord } from "../types";
import { findWorkspaceProviderToken } from "../store";

// Shared-credential model: before an agent's MCP servers are handed to the runtime, resolve each
// server's provider to the workspace's connected OAuth token and inject it as a bearer header so
// the MCP call is authenticated. The token is decrypted server-side and travels with the agent
// config into the sandbox (accepted tradeoff for model A). Per-user credentials are a future TODO
// (see docs/adr/0005). No-op for servers without a provider or without a connected credential.
export function injectMcpCredentials(mcpServers: unknown, workspaceId: string): JsonRecord[] {
  if (!Array.isArray(mcpServers) || !workspaceId) return Array.isArray(mcpServers) ? (mcpServers as JsonRecord[]) : [];
  return mcpServers.map((raw) => {
    const server = (raw && typeof raw === "object" ? { ...(raw as JsonRecord) } : {}) as JsonRecord;
    const provider = typeof server.provider === "string" ? server.provider : "";
    const url = typeof server.url === "string" ? server.url : typeof server.mcp_url === "string" ? server.mcp_url : "";
    if (!provider || !url) return server;
    const resolved = findWorkspaceProviderToken(workspaceId, provider);
    if (!resolved) return server;
    const existingHeaders = (server.headers && typeof server.headers === "object" ? server.headers : {}) as JsonRecord;
    return {
      ...server,
      type: server.type === "url" || !server.type ? "http" : server.type,
      url,
      headers: { ...existingHeaders, Authorization: `Bearer ${resolved.accessToken}` }
    };
  });
}

// Convenience: return a shallow agent copy with credentials injected into mcp_servers.
export function withInjectedMcpCredentials(agent: AgentConfig, workspaceId: string): AgentConfig {
  if (!Array.isArray(agent.mcp_servers) || !agent.mcp_servers.length) return agent;
  return { ...agent, mcp_servers: injectMcpCredentials(agent.mcp_servers, workspaceId) };
}

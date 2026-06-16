// Preset MCP server catalog. Users can connect to these providers via OAuth without filling endpoints
// by hand; they can also register their own MCP endpoints (stored in the mcp_servers table).
// OAuth client credentials (client_id/client_secret) are resolved at runtime from env per provider,
// e.g. MAPLE_MCP_NOTION_CLIENT_ID / MAPLE_MCP_NOTION_CLIENT_SECRET.

export type McpAuthType = "oauth2" | "bearer" | "none";

export type McpCatalogEntry = {
  provider: string;
  name: string;
  icon: string;
  description: string;
  mcp_url: string;
  auth_type: McpAuthType;
  oauth?: {
    authorize_url: string;
    token_url: string;
    scopes: string[];
    pkce: boolean;
    // env var prefix for client credentials, e.g. "MAPLE_MCP_NOTION" -> _CLIENT_ID / _CLIENT_SECRET
    client_env_prefix: string;
  };
};

export const MCP_CATALOG: McpCatalogEntry[] = [
  {
    provider: "notion",
    name: "Notion",
    icon: "i-notion",
    description: "Read and write Notion pages and databases.",
    mcp_url: "https://mcp.notion.com/mcp",
    auth_type: "oauth2",
    oauth: {
      authorize_url: "https://api.notion.com/v1/oauth/authorize",
      token_url: "https://api.notion.com/v1/oauth/token",
      scopes: [],
      pkce: true,
      client_env_prefix: "MAPLE_MCP_NOTION"
    }
  },
  {
    provider: "github",
    name: "GitHub",
    icon: "i-github",
    description: "Access GitHub repositories, issues, and pull requests.",
    mcp_url: "https://api.githubcopilot.com/mcp/",
    auth_type: "oauth2",
    oauth: {
      authorize_url: "https://github.com/login/oauth/authorize",
      token_url: "https://github.com/login/oauth/access_token",
      scopes: ["repo", "read:user"],
      pkce: true,
      client_env_prefix: "MAPLE_MCP_GITHUB"
    }
  },
  {
    provider: "vercel",
    name: "Vercel",
    icon: "i-vercel",
    description: "Manage Vercel projects and deployments.",
    mcp_url: "https://mcp.vercel.com",
    auth_type: "oauth2",
    oauth: {
      authorize_url: "https://vercel.com/oauth/authorize",
      token_url: "https://api.vercel.com/v2/oauth/access_token",
      scopes: [],
      pkce: true,
      client_env_prefix: "MAPLE_MCP_VERCEL"
    }
  },
  {
    provider: "google_drive",
    name: "Google Drive",
    icon: "i-google",
    description: "Read and search files in Google Drive.",
    mcp_url: "https://drivemcp.googleapis.com/mcp/v1",
    auth_type: "oauth2",
    oauth: { authorize_url: "https://accounts.google.com/o/oauth2/v2/auth", token_url: "https://oauth2.googleapis.com/token", scopes: ["https://www.googleapis.com/auth/drive.readonly"], pkce: true, client_env_prefix: "MAPLE_MCP_GOOGLE" }
  },
  {
    provider: "gmail",
    name: "Gmail",
    icon: "i-google",
    description: "Read and send Gmail messages.",
    mcp_url: "https://gmailmcp.googleapis.com/mcp/v1",
    auth_type: "oauth2",
    oauth: { authorize_url: "https://accounts.google.com/o/oauth2/v2/auth", token_url: "https://oauth2.googleapis.com/token", scopes: ["https://www.googleapis.com/auth/gmail.modify"], pkce: true, client_env_prefix: "MAPLE_MCP_GOOGLE" }
  },
  {
    provider: "google_calendar",
    name: "Google Calendar",
    icon: "i-google",
    description: "Manage Google Calendar events.",
    mcp_url: "https://calendarmcp.googleapis.com/mcp/v1",
    auth_type: "oauth2",
    oauth: { authorize_url: "https://accounts.google.com/o/oauth2/v2/auth", token_url: "https://oauth2.googleapis.com/token", scopes: ["https://www.googleapis.com/auth/calendar"], pkce: true, client_env_prefix: "MAPLE_MCP_GOOGLE" }
  },
  {
    provider: "canva",
    name: "Canva",
    icon: "i-canva",
    description: "Create and manage Canva designs.",
    mcp_url: "https://mcp.canva.com/mcp",
    auth_type: "oauth2",
    oauth: { authorize_url: "https://www.canva.com/api/oauth/authorize", token_url: "https://api.canva.com/rest/v1/oauth/token", scopes: [], pkce: true, client_env_prefix: "MAPLE_MCP_CANVA" }
  },
  {
    provider: "figma",
    name: "Figma",
    icon: "i-figma",
    description: "Access Figma files and designs.",
    mcp_url: "https://mcp.figma.com/mcp",
    auth_type: "oauth2",
    oauth: { authorize_url: "https://www.figma.com/oauth", token_url: "https://api.figma.com/v1/oauth/token", scopes: ["file_read"], pkce: true, client_env_prefix: "MAPLE_MCP_FIGMA" }
  },
  {
    provider: "atlassian",
    name: "Atlassian",
    icon: "i-atlassian",
    description: "Access Jira and Confluence.",
    mcp_url: "https://mcp.atlassian.com/v1/mcp",
    auth_type: "oauth2",
    oauth: { authorize_url: "https://auth.atlassian.com/authorize", token_url: "https://auth.atlassian.com/oauth/token", scopes: ["read:jira-work", "read:confluence-content.all"], pkce: true, client_env_prefix: "MAPLE_MCP_ATLASSIAN" }
  }
];

export function mcpCatalogEntry(provider: string): McpCatalogEntry | null {
  return MCP_CATALOG.find((entry) => entry.provider === provider) ?? null;
}

// resolve OAuth client credentials for a catalog provider from env (returns null if not configured)
export function mcpProviderClient(provider: string): { client_id: string; client_secret: string } | null {
  const entry = mcpCatalogEntry(provider);
  if (!entry?.oauth) return null;
  const prefix = entry.oauth.client_env_prefix;
  const client_id = process.env[`${prefix}_CLIENT_ID`] || "";
  const client_secret = process.env[`${prefix}_CLIENT_SECRET`] || "";
  if (!client_id) return null;
  return { client_id, client_secret };
}

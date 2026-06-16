package cmd

import (
	"fmt"

	"github.com/maple/cli/internal/cliargs"
)

func runMCP(args []string) error {
	subcommand := "catalog"
	if len(args) > 0 {
		subcommand = args[0]
		args = args[1:]
	}
	flags, rest := cliargs.Parse(args)
	switch subcommand {
	case "catalog":
		return requestJSON("GET", "/v1/mcp_catalog", flags, nil)
	case "list", "ls", "servers":
		return requestJSON("GET", "/v1/mcp_servers", flags, nil)
	case "create", "new":
		body, err := mcpServerBody(flags)
		if err != nil {
			return err
		}
		return requestJSON("POST", "/v1/mcp_servers", flags, body)
	case "update", "patch":
		id, err := idArg(rest, flags.String("mcp", "mcp-id", "id"), "mcp")
		if err != nil {
			return err
		}
		body, err := mcpServerBody(flags)
		if err != nil {
			return err
		}
		return requestJSON("PATCH", "/v1/mcp_servers/"+id, flags, body)
	case "delete", "rm":
		id, err := idArg(rest, flags.String("mcp", "mcp-id", "id"), "mcp")
		if err != nil {
			return err
		}
		return requestJSON("DELETE", "/v1/mcp_servers/"+id, flags, nil)
	case "oauth-start":
		id, err := idArg(rest, flags.String("mcp", "mcp-id", "id"), "mcp")
		if err != nil {
			return err
		}
		return requestJSON("POST", "/v1/mcp_servers/"+id+"/oauth/start", flags, map[string]any{})
	default:
		return fmt.Errorf("Unknown mcp command: %s", subcommand)
	}
}

func mcpServerBody(flags cliargs.Flags) (map[string]any, error) {
	body, err := basicBody(flags)
	if err != nil {
		return nil, err
	}
	setBodyString(body, "provider", flags.String("provider"))
	setBodyString(body, "mcp_url", flags.String("mcp-url", "url"))
	setBodyString(body, "auth_type", flags.String("auth-type", "type"))
	if err := setBodyJSON(body, "config", flags.String("config")); err != nil {
		return nil, err
	}
	return body, nil
}

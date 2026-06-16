package cmd

import (
	"fmt"

	"github.com/maple/cli/internal/cliargs"
)

func runVault(args []string) error {
	subcommand := "list"
	if len(args) > 0 {
		subcommand = args[0]
		args = args[1:]
	}
	flags, rest := cliargs.Parse(args)
	switch subcommand {
	case "list", "ls":
		return requestJSON("GET", "/v1/vaults", flags, nil)
	case "get", "read":
		id, err := idArg(rest, flags.String("vault", "vault-id", "id"), "vault")
		if err != nil {
			return err
		}
		return requestJSON("GET", "/v1/vaults/"+id, flags, nil)
	case "create", "new":
		body, err := vaultBody(flags)
		if err != nil {
			return err
		}
		return requestJSON("POST", "/v1/vaults", flags, body)
	case "credentials", "credential":
		return runVaultCredential(args)
	default:
		return fmt.Errorf("Unknown vault command: %s", subcommand)
	}
}

func vaultBody(flags cliargs.Flags) (map[string]any, error) {
	body, err := bodyFromFlags(flags)
	if err != nil {
		return nil, err
	}
	setBodyString(body, "workspace_id", firstNonEmpty(flags.String("workspace-id"), flags.String("workspace")))
	setBodyString(body, "display_name", firstNonEmpty(flags.String("display-name"), flags.String("name")))
	if err := setBodyJSON(body, "metadata", flags.String("metadata")); err != nil {
		return nil, err
	}
	return body, nil
}

func runVaultCredential(args []string) error {
	subcommand := "list"
	if len(args) > 0 {
		subcommand = args[0]
		args = args[1:]
	}
	flags, rest := cliargs.Parse(args)
	vaultID, err := idArg(rest, flags.String("vault", "vault-id"), "vault")
	if err != nil {
		return err
	}
	path := "/v1/vaults/" + vaultID + "/credentials"
	switch subcommand {
	case "list", "ls":
		return requestJSON("GET", path, flags, nil)
	case "create", "new":
		body, err := credentialBody(flags)
		if err != nil {
			return err
		}
		return requestJSON("POST", path, flags, body)
	case "archive":
		credID, err := credentialID(rest, flags)
		if err != nil {
			return err
		}
		return requestJSON("PATCH", path+"/"+credID+"/archive", flags, nil)
	case "delete", "rm":
		credID, err := credentialID(rest, flags)
		if err != nil {
			return err
		}
		return requestJSON("DELETE", path+"/"+credID, flags, nil)
	case "oauth-start":
		credID, err := credentialID(rest, flags)
		if err != nil {
			return err
		}
		return requestJSON("POST", path+"/"+credID+"/oauth/start", flags, map[string]any{})
	default:
		return fmt.Errorf("Unknown vault credential command: %s", subcommand)
	}
}

func credentialBody(flags cliargs.Flags) (map[string]any, error) {
	body, err := bodyFromFlags(flags)
	if err != nil {
		return nil, err
	}
	setBodyString(body, "name", flags.String("name"))
	setBodyString(body, "mcp_server_url", flags.String("mcp-server-url", "url"))
	setBodyString(body, "provider", flags.String("provider"))
	setBodyString(body, "auth_type", firstNonEmpty(flags.String("auth-type"), flags.String("type")))
	setBodyString(body, "secret", flags.String("secret"))
	if err := setBodyJSON(body, "metadata", flags.String("metadata")); err != nil {
		return nil, err
	}
	return body, nil
}

func credentialID(rest []string, flags cliargs.Flags) (string, error) {
	if flags.String("credential", "credential-id", "cred", "cred-id") != "" {
		return escaped(flags.String("credential", "credential-id", "cred", "cred-id")), nil
	}
	if flags.String("vault", "vault-id") != "" && len(rest) >= 1 {
		return escaped(rest[0]), nil
	}
	if len(rest) >= 2 {
		return escaped(rest[1]), nil
	}
	return "", fmt.Errorf("missing credential")
}

package cmd

import (
	"fmt"

	"github.com/maple/cli/internal/cliargs"
)

func runWorkspace(args []string) error {
	subcommand := "list"
	if len(args) > 0 {
		subcommand = args[0]
		args = args[1:]
	}
	flags, rest := cliargs.Parse(args)
	switch subcommand {
	case "list", "ls":
		return requestJSON("GET", "/v1/workspaces", flags, nil)
	case "get", "read":
		id, err := idArg(rest, flags.String("workspace", "workspace-id", "id"), "workspace")
		if err != nil {
			return err
		}
		return requestJSON("GET", "/v1/workspaces/"+id, flags, nil)
	case "create", "new":
		body, err := workspaceBody(flags)
		if err != nil {
			return err
		}
		return requestJSON("POST", "/v1/workspaces", flags, body)
	case "update", "patch":
		id, err := idArg(rest, flags.String("workspace", "workspace-id", "id"), "workspace")
		if err != nil {
			return err
		}
		body, err := basicBody(flags)
		if err != nil {
			return err
		}
		return requestJSON("PATCH", "/v1/workspaces/"+id, flags, body)
	case "delete", "rm":
		id, err := idArg(rest, flags.String("workspace", "workspace-id", "id"), "workspace")
		if err != nil {
			return err
		}
		return requestJSON("DELETE", "/v1/workspaces/"+id, flags, nil)
	case "members", "member":
		return workspaceMember("members", args)
	case "admins", "admin":
		return workspaceMember("admins", args)
	case "runtime-pool", "runtime_pool":
		id, err := idArg(rest, flags.String("workspace", "workspace-id", "id"), "workspace")
		if err != nil {
			return err
		}
		return requestJSON("GET", "/v1/workspaces/"+id+"/runtime_pool", flags, nil)
	case "api-keys", "api-key":
		return workspaceAPIKey(args)
	default:
		return fmt.Errorf("Unknown workspace command: %s", subcommand)
	}
}

func workspaceBody(flags cliargs.Flags) (map[string]any, error) {
	body, err := bodyFromFlags(flags)
	if err != nil {
		return nil, err
	}
	setBodyString(body, "tenant_id", flags.String("tenant", "tenant-id"))
	setBodyString(body, "runtime_provider", flags.String("runtime-provider"))
	setBodyString(body, "sandbox_provider", flags.String("sandbox-provider"))
	if name := flags.String("name"); name != "" {
		body["workspace"] = map[string]any{
			"name":        name,
			"description": flags.String("description"),
			"slug":        flags.String("slug"),
		}
	}
	if ids := stringList(flags.String("model-configs", "model-config-ids")); len(ids) > 0 {
		body["model_config_ids"] = ids
	}
	if err := setBodyJSON(body, "runtime_pool", flags.String("runtime-pool")); err != nil {
		return nil, err
	}
	if err := setBodyJSON(body, "sandbox_config", flags.String("sandbox-config")); err != nil {
		return nil, err
	}
	if err := setBodyJSON(body, "provider_credentials", flags.String("provider-credentials")); err != nil {
		return nil, err
	}
	return body, nil
}

func workspaceMember(kind string, args []string) error {
	subcommand := "list"
	if len(args) > 0 {
		subcommand = args[0]
		args = args[1:]
	}
	flags, rest := cliargs.Parse(args)
	workspaceID, err := idArg(rest, flags.String("workspace", "workspace-id"), "workspace")
	if err != nil {
		return err
	}
	path := "/v1/workspaces/" + workspaceID + "/" + kind
	switch subcommand {
	case "list", "ls":
		return requestJSON("GET", path, flags, nil)
	case "add", "create":
		email := firstNonEmpty(flags.String("email"), secondRest(rest, flags.String("workspace", "workspace-id")))
		if email == "" {
			return fmt.Errorf("missing email")
		}
		return requestJSON("POST", path, flags, map[string]any{"email": email})
	case "remove", "delete", "rm":
		userID := firstNonEmpty(flags.String("user", "user-id"), secondRest(rest, flags.String("workspace", "workspace-id")))
		if userID == "" {
			return fmt.Errorf("missing user")
		}
		return requestJSON("DELETE", path+"/"+escaped(userID), flags, nil)
	default:
		return fmt.Errorf("Unknown workspace %s command: %s", kind, subcommand)
	}
}

func workspaceAPIKey(args []string) error {
	subcommand := "list"
	if len(args) > 0 {
		subcommand = args[0]
		args = args[1:]
	}
	flags, rest := cliargs.Parse(args)
	workspaceID, err := idArg(rest, flags.String("workspace", "workspace-id"), "workspace")
	if err != nil {
		return err
	}
	path := "/v1/workspaces/" + workspaceID + "/api_keys"
	switch subcommand {
	case "list", "ls":
		return requestJSON("GET", path, flags, nil)
	case "create", "new":
		body, err := workspaceKeyBody(flags)
		if err != nil {
			return err
		}
		return requestJSON("POST", path, flags, body)
	case "update", "patch":
		keyID := firstNonEmpty(flags.String("key", "key-id"), secondRest(rest, flags.String("workspace", "workspace-id")))
		if keyID == "" {
			return fmt.Errorf("missing key")
		}
		body, err := workspaceKeyBody(flags)
		if err != nil {
			return err
		}
		return requestJSON("PATCH", path+"/"+escaped(keyID), flags, body)
	case "delete", "rm":
		keyID := firstNonEmpty(flags.String("key", "key-id"), secondRest(rest, flags.String("workspace", "workspace-id")))
		if keyID == "" {
			return fmt.Errorf("missing key")
		}
		return requestJSON("DELETE", path+"/"+escaped(keyID), flags, nil)
	default:
		return fmt.Errorf("Unknown workspace api-key command: %s", subcommand)
	}
}

func workspaceKeyBody(flags cliargs.Flags) (map[string]any, error) {
	body, err := bodyFromFlags(flags)
	if err != nil {
		return nil, err
	}
	setBodyString(body, "display_name", firstNonEmpty(flags.String("display-name"), flags.String("name")))
	if scopes := stringList(flags.String("scopes")); len(scopes) > 0 {
		body["scopes"] = scopes
	}
	if flags.String("enabled") != "" {
		body["enabled"] = flags.Bool("enabled")
	}
	return body, nil
}

func secondRest(rest []string, flagID string) string {
	if flagID != "" && len(rest) > 0 {
		return rest[0]
	}
	if len(rest) > 1 {
		return rest[1]
	}
	return ""
}

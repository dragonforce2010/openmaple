package cmd

import (
	"fmt"

	"github.com/maple/cli/internal/cliargs"
)

func runModelConfig(args []string) error {
	subcommand := "list"
	if len(args) > 0 {
		subcommand = args[0]
		args = args[1:]
	}
	flags, rest := cliargs.Parse(args)
	switch subcommand {
	case "list", "ls":
		return requestJSON("GET", "/v1/model_configs", flags, nil)
	case "create", "new":
		body, err := modelConfigBody(flags)
		if err != nil {
			return err
		}
		return requestJSON("POST", "/v1/model_configs", flags, body)
	case "update", "patch":
		id, err := idArg(rest, flags.String("model-config", "model-config-id", "id"), "model_config")
		if err != nil {
			return err
		}
		body, err := modelConfigBody(flags)
		if err != nil {
			return err
		}
		return requestJSON("PATCH", "/v1/model_configs/"+id, flags, body)
	case "delete", "rm":
		id, err := idArg(rest, flags.String("model-config", "model-config-id", "id"), "model_config")
		if err != nil {
			return err
		}
		return requestJSON("DELETE", "/v1/model_configs/"+id, flags, nil)
	case "test":
		if id := firstNonEmpty(flags.String("model-config", "model-config-id", "id"), firstArg(rest)); id != "" {
			return requestJSON("POST", "/v1/model_configs/"+escaped(id)+"/test", flags, nil)
		}
		body, err := modelConfigBody(flags)
		if err != nil {
			return err
		}
		return requestJSON("POST", "/v1/model_configs/test", flags, body)
	default:
		return fmt.Errorf("Unknown model-config command: %s", subcommand)
	}
}

func modelConfigBody(flags cliargs.Flags) (map[string]any, error) {
	body, err := bodyFromFlags(flags)
	if err != nil {
		return nil, err
	}
	setBodyString(body, "kind", flags.String("kind"))
	setBodyString(body, "name", flags.String("name"))
	setBodyString(body, "protocol", flags.String("protocol"))
	setBodyString(body, "base_url", flags.String("base-url"))
	setBodyString(body, "model_name", flags.String("model-name", "model"))
	setBodyString(body, "api_key", flags.String("api-key"))
	setBodyString(body, "workspace_id", firstNonEmpty(flags.String("workspace-id"), flags.String("workspace")))
	setBodyString(body, "preset_key", flags.String("preset-key", "preset"))
	if flags.String("default", "is-default") != "" {
		body["is_default"] = flags.Bool("default") || flags.Bool("is-default")
	}
	return body, nil
}

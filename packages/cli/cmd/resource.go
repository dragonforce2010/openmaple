package cmd

import (
	"fmt"

	"github.com/maple/cli/internal/cliargs"
	"github.com/maple/cli/internal/client"
)

type resourceSpec struct {
	Name       string
	Collection string
	ItemName   string
}

func runStandardResource(spec resourceSpec, args []string, build func(cliargs.Flags) (map[string]any, error)) error {
	subcommand := "list"
	if len(args) > 0 {
		subcommand = args[0]
		args = args[1:]
	}
	flags, rest := cliargs.Parse(args)
	switch subcommand {
	case "list", "ls":
		return requestJSON("GET", spec.Collection, flags, nil)
	case "get", "read", "inspect":
		id, err := idArg(rest, flags.String("id", spec.ItemName), spec.ItemName)
		if err != nil {
			return err
		}
		return requestJSON("GET", spec.Collection+"/"+id, flags, nil)
	case "create", "new":
		body, err := build(flags)
		if err != nil {
			return err
		}
		return requestJSON("POST", spec.Collection, flags, body)
	case "update", "patch":
		id, err := idArg(rest, flags.String("id", spec.ItemName), spec.ItemName)
		if err != nil {
			return err
		}
		body, err := build(flags)
		if err != nil {
			return err
		}
		return requestJSON("PATCH", spec.Collection+"/"+id, flags, body)
	case "delete", "rm", "archive":
		id, err := idArg(rest, flags.String("id", spec.ItemName), spec.ItemName)
		if err != nil {
			return err
		}
		return requestJSON("DELETE", spec.Collection+"/"+id, flags, nil)
	default:
		return fmt.Errorf("Unknown %s command: %s", spec.Name, subcommand)
	}
}

func escaped(value string) string {
	return client.PathEscape(value)
}

func basicBody(flags cliargs.Flags) (map[string]any, error) {
	body, err := bodyFromFlags(flags)
	if err != nil {
		return nil, err
	}
	setBodyString(body, "name", flags.String("name"))
	setBodyString(body, "description", flags.String("description"))
	setBodyString(body, "workspace_id", firstNonEmpty(flags.String("workspace-id"), flags.String("workspace")))
	if err := setBodyJSON(body, "metadata", flags.String("metadata")); err != nil {
		return nil, err
	}
	return body, nil
}

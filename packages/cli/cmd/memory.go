package cmd

import (
	"fmt"
	"strings"

	"github.com/maple/cli/internal/cliargs"
)

func runMemoryStore(args []string) error {
	subcommand := "list"
	if len(args) > 0 {
		subcommand = args[0]
		args = args[1:]
	}
	flags, rest := cliargs.Parse(args)
	switch subcommand {
	case "list", "ls":
		return requestJSON("GET", "/v1/memory_stores", flags, nil)
	case "create", "new":
		body, err := basicBody(flags)
		if err != nil {
			return err
		}
		return requestJSON("POST", "/v1/memory_stores", flags, body)
	case "memories":
		id, err := idArg(rest, flags.String("memory-store", "memory-store-id", "id"), "memory_store")
		if err != nil {
			return err
		}
		return requestJSON("GET", "/v1/memory_stores/"+id+"/memories", flags, nil)
	case "put", "set":
		id, err := idArg(rest, flags.String("memory-store", "memory-store-id", "id"), "memory_store")
		if err != nil {
			return err
		}
		memoryPath := firstNonEmpty(flags.String("path"), secondRest(rest, flags.String("memory-store", "memory-store-id", "id")))
		if memoryPath == "" {
			return fmt.Errorf("missing memory path")
		}
		body, err := bodyFromFlags(flags)
		if err != nil {
			return err
		}
		setBodyString(body, "content", firstNonEmpty(flags.String("content"), strings.TrimSpace(argString(afterID(rest, flags.String("memory-store", "memory-store-id", "id"))))))
		if flags.String("content") == "" {
			setBodyString(body, "content", strings.TrimSpace(argString(memoryContentArgs(rest, flags))))
		}
		setBodyString(body, "actor", flags.String("actor"))
		return requestJSON("PUT", "/v1/memory_stores/"+id+"/memories/"+escaped(memoryPath), flags, body)
	default:
		return fmt.Errorf("Unknown memory-store command: %s", subcommand)
	}
}

func memoryContentArgs(rest []string, flags cliargs.Flags) []string {
	if flags.String("path") != "" {
		return afterID(rest, flags.String("memory-store", "memory-store-id", "id"))
	}
	if flags.String("memory-store", "memory-store-id", "id") != "" {
		return skipFirst(rest)
	}
	if len(rest) > 2 {
		return rest[2:]
	}
	return nil
}

func runTemplate(args []string) error {
	return runStandardResource(resourceSpec{Name: "template", Collection: "/v1/templates", ItemName: "template"}, args, templateBody)
}

func templateBody(flags cliargs.Flags) (map[string]any, error) {
	body, err := basicBody(flags)
	if err != nil {
		return nil, err
	}
	setBodyString(body, "category", flags.String("category"))
	if err := setBodyJSON(body, "template", flags.String("template")); err != nil {
		return nil, err
	}
	return body, nil
}

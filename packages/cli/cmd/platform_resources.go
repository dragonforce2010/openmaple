package cmd

import (
	"fmt"
	"os"

	"github.com/maple/cli/internal/cliargs"
)

func runDeployment(args []string) error {
	subcommand := "list"
	if len(args) > 0 {
		subcommand = args[0]
		args = args[1:]
	}
	flags, rest := cliargs.Parse(args)
	switch subcommand {
	case "list", "ls":
		return requestJSON("GET", "/v1/deployments", flags, nil)
	case "get", "read":
		id, err := idArg(rest, flags.String("deployment", "deployment-id", "id"), "deployment")
		if err != nil {
			return err
		}
		return requestJSON("GET", "/v1/deployments/"+id, flags, nil)
	case "create", "new":
		body, err := anyBodyFromFlags(flags)
		if err != nil {
			return err
		}
		return requestJSON("POST", "/v1/deployments", flags, body)
	case "invoke":
		id, err := idArg(rest, flags.String("deployment", "deployment-id", "id"), "deployment")
		if err != nil {
			return err
		}
		body, err := deploymentInvokeBody(flags, rest)
		if err != nil {
			return err
		}
		return requestJSON("POST", "/v1/deployments/"+id+"/invoke", flags, body)
	case "run":
		id, err := idArg(rest, flags.String("deployment", "deployment-id", "id"), "deployment")
		if err != nil {
			return err
		}
		body, err := deploymentInvokeBody(flags, rest)
		if err != nil {
			return err
		}
		return requestJSON("POST", "/v1/deployments/"+id+"/run", flags, body)
	case "runs", "history":
		id, err := idArg(rest, flags.String("deployment", "deployment-id", "id"), "deployment")
		if err != nil {
			return err
		}
		return requestJSON("GET", "/v1/deployments/"+id+"/runs", flags, nil)
	case "pause":
		id, err := idArg(rest, flags.String("deployment", "deployment-id", "id"), "deployment")
		if err != nil {
			return err
		}
		body, err := bodyFromFlags(flags)
		if err != nil {
			return err
		}
		setBodyString(body, "reason", flags.String("reason"))
		return requestJSON("POST", "/v1/deployments/"+id+"/pause", flags, body)
	case "unpause", "resume":
		id, err := idArg(rest, flags.String("deployment", "deployment-id", "id"), "deployment")
		if err != nil {
			return err
		}
		return requestJSON("POST", "/v1/deployments/"+id+"/unpause", flags, map[string]any{})
	case "archive":
		id, err := idArg(rest, flags.String("deployment", "deployment-id", "id"), "deployment")
		if err != nil {
			return err
		}
		return requestJSON("POST", "/v1/deployments/"+id+"/archive", flags, map[string]any{})
	default:
		return fmt.Errorf("Unknown deployment command: %s", subcommand)
	}
}

func deploymentInvokeBody(flags cliargs.Flags, rest []string) (map[string]any, error) {
	body, err := bodyFromFlags(flags)
	if err != nil {
		return nil, err
	}
	setBodyString(body, "message", firstNonEmpty(flags.String("message", "text"), argString(afterID(rest, flags.String("deployment", "deployment-id", "id")))))
	setBodyString(body, "title", flags.String("title"))
	if vaults := stringList(flags.String("vaults", "vault-ids")); len(vaults) > 0 {
		body["vault_ids"] = vaults
	}
	if err := setBodyJSON(body, "resources", flags.String("resources")); err != nil {
		return nil, err
	}
	return body, nil
}

func runFile(args []string) error {
	subcommand := "get"
	if len(args) > 0 {
		subcommand = args[0]
		args = args[1:]
	}
	flags, rest := cliargs.Parse(args)
	switch subcommand {
	case "get", "read":
		id, err := idArg(rest, flags.String("file", "file-id", "id"), "file")
		if err != nil {
			return err
		}
		return requestJSON("GET", "/v1/files/"+id, flags, nil)
	case "create", "upload":
		path := flags.String("file", "input")
		if path == "" {
			return fmt.Errorf("Usage: maple file create --file <path> [--filename <name>] [--content-type <type>]")
		}
		data, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		query := "filename=" + escaped(firstNonEmpty(flags.String("filename"), path))
		if flags.String("query", "params") == "" {
			flags["query"] = query
		}
		return requestBytes("POST", "/v1/files", flags, data, flags.String("content-type", "media-type"))
	default:
		return fmt.Errorf("Unknown file command: %s", subcommand)
	}
}

func runArtifact(args []string) error {
	subcommand := "list"
	if len(args) > 0 {
		subcommand = args[0]
		args = args[1:]
	}
	flags, rest := cliargs.Parse(args)
	switch subcommand {
	case "list", "ls":
		return requestJSON("GET", "/v1/artifacts", flags, nil)
	case "session":
		id, err := idArg(rest, flags.String("session", "session-id"), "session")
		if err != nil {
			return err
		}
		return requestJSON("GET", "/v1/sessions/"+id+"/artifacts", flags, nil)
	case "download":
		id, err := idArg(rest, flags.String("session", "session-id"), "session")
		if err != nil {
			return err
		}
		filePath := firstNonEmpty(flags.String("path"), secondRest(rest, flags.String("session", "session-id")))
		if filePath == "" {
			return fmt.Errorf("missing artifact path")
		}
		return requestJSON("GET", "/v1/sessions/"+id+"/artifacts/"+escaped(filePath)+"/download", flags, nil)
	default:
		return fmt.Errorf("Unknown artifact command: %s", subcommand)
	}
}

func runQuickstart(args []string) error {
	subcommand := "builder-session"
	if len(args) > 0 {
		subcommand = args[0]
		args = args[1:]
	}
	flags, rest := cliargs.Parse(args)
	switch subcommand {
	case "builder-session":
		body, err := anyBodyFromFlags(flags)
		if err != nil {
			return err
		}
		return requestJSON("POST", "/v1/quickstart/builder_session", flags, body)
	case "message":
		id, err := idArg(rest, flags.String("session", "session-id"), "session")
		if err != nil {
			return err
		}
		return requestJSON("POST", "/v1/quickstart/builder_session/"+id+"/message", flags, map[string]any{"message": firstNonEmpty(flags.String("message", "text"), argString(afterID(rest, flags.String("session", "session-id"))))})
	case "action":
		id, err := idArg(rest, flags.String("session", "session-id"), "session")
		if err != nil {
			return err
		}
		body, err := anyBodyFromFlags(flags)
		if err != nil {
			return err
		}
		return requestJSON("POST", "/v1/quickstart/builder_session/"+id+"/action", flags, body)
	default:
		return fmt.Errorf("Unknown quickstart command: %s", subcommand)
	}
}

func runRuntime(args []string) error {
	if len(args) == 0 || args[0] != "tools" {
		return fmt.Errorf("Usage: maple runtime tools <session_id> --data @tool-call.json")
	}
	flags, rest := cliargs.Parse(args[1:])
	id, err := idArg(rest, flags.String("session", "session-id"), "session")
	if err != nil {
		return err
	}
	body, err := anyBodyFromFlags(flags)
	if err != nil {
		return err
	}
	return requestJSON("POST", "/v1/runtime/sessions/"+id+"/tools", flags, body)
}

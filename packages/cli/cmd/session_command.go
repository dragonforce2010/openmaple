package cmd

import (
	"fmt"
	"strings"

	"github.com/maple/cli/internal/cliargs"
)

func runSession(args []string) error {
	subcommand := "list"
	if len(args) > 0 {
		subcommand = args[0]
		args = args[1:]
	}
	flags, rest := cliargs.Parse(args)
	switch subcommand {
	case "list", "ls":
		return requestJSON("GET", "/v1/sessions", flags, nil)
	case "create", "new":
		body, err := sessionBody(flags)
		if err != nil {
			return err
		}
		return requestJSON("POST", "/v1/sessions", flags, body)
	case "get", "read":
		id, err := idArg(rest, flags.String("session", "session-id", "id"), "session")
		if err != nil {
			return err
		}
		return requestJSON("GET", "/v1/sessions/"+id, flags, nil)
	case "detail", "status":
		id, err := idArg(rest, flags.String("session", "session-id", "id"), "session")
		if err != nil {
			return err
		}
		return requestJSON("GET", "/v1/sessions/"+id+"/detail", flags, nil)
	case "delete", "terminate", "rm":
		id, err := idArg(rest, flags.String("session", "session-id", "id"), "session")
		if err != nil {
			return err
		}
		return requestJSON("DELETE", "/v1/sessions/"+id, flags, nil)
	case "events":
		id, err := idArg(rest, flags.String("session", "session-id", "id"), "session")
		if err != nil {
			return err
		}
		return requestJSON("GET", "/v1/sessions/"+id+"/events", flags, nil)
	case "message":
		return sessionMessage(flags, rest)
	case "event", "post-event":
		return sessionEvent(flags, rest)
	case "stream":
		id, err := idArg(rest, flags.String("session", "session-id", "id"), "session")
		if err != nil {
			return err
		}
		return streamRequest("GET", "/v1/sessions/"+id+"/events/stream", flags, nil)
	case "artifacts":
		id, err := idArg(rest, flags.String("session", "session-id", "id"), "session")
		if err != nil {
			return err
		}
		return requestJSON("GET", "/v1/sessions/"+id+"/artifacts", flags, nil)
	case "ask":
		return askMapleSession(flags, rest)
	default:
		return fmt.Errorf("Unknown session command: %s", subcommand)
	}
}

func sessionBody(flags cliargs.Flags) (map[string]any, error) {
	body, err := bodyFromFlags(flags)
	if err != nil {
		return nil, err
	}
	setBodyString(body, "workspace_id", firstNonEmpty(flags.String("workspace-id"), flags.String("workspace")))
	setBodyString(body, "agent", flags.String("agent", "agent-id"))
	setBodyString(body, "environment_id", flags.String("environment", "environment-id", "env"))
	setBodyString(body, "title", flags.String("title"))
	if vaults := stringList(flags.String("vaults", "vault-ids")); len(vaults) > 0 {
		body["vault_ids"] = vaults
	}
	if err := setBodyJSON(body, "resources", flags.String("resources")); err != nil {
		return nil, err
	}
	if err := setBodyJSON(body, "metadata", flags.String("metadata")); err != nil {
		return nil, err
	}
	return body, nil
}

func sessionMessage(flags cliargs.Flags, rest []string) error {
	flagID := flags.String("session", "session-id", "id")
	id, err := idArg(rest, flagID, "session")
	if err != nil {
		return err
	}
	message := firstNonEmpty(flags.String("message", "text"), argString(afterID(rest, flagID)))
	if message == "" {
		return fmt.Errorf("missing message")
	}
	body := map[string]any{"events": []map[string]any{{
		"type":    "user.message",
		"content": []map[string]any{{"type": "text", "text": message}},
		"payload": map[string]any{"source": "maple-cli"},
	}}}
	return requestJSON("POST", "/v1/sessions/"+id+"/events", flags, body)
}

func sessionEvent(flags cliargs.Flags, rest []string) error {
	id, err := idArg(rest, flags.String("session", "session-id", "id"), "session")
	if err != nil {
		return err
	}
	body, err := anyBodyFromFlags(flags)
	if err != nil {
		return err
	}
	if body == nil {
		return fmt.Errorf("Usage: maple session event <session_id> --data '{\"events\":[...]}'")
	}
	return requestJSON("POST", "/v1/sessions/"+id+"/events", flags, body)
}

func askMapleSession(flags cliargs.Flags, rest []string) error {
	flagID := flags.String("session", "session-id", "id")
	id, err := idArg(rest, flagID, "session")
	if err != nil {
		return err
	}
	question := firstNonEmpty(flags.String("question", "message", "text"), argString(afterID(rest, flagID)))
	if question == "" {
		question = "总结这个 session 的上下文"
	}
	return requestJSON("POST", "/v1/ask_maple/sessions/"+id+"/message", flags, map[string]any{"question": question})
}

func stringList(value string) []string {
	if value == "" {
		return nil
	}
	items := []string{}
	for _, item := range strings.Split(value, ",") {
		if trimmed := strings.TrimSpace(item); trimmed != "" {
			items = append(items, trimmed)
		}
	}
	return items
}

func afterID(rest []string, flagID string) []string {
	if flagID != "" {
		return rest
	}
	return skipFirst(rest)
}

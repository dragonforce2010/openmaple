package cmd

import (
	"errors"
	"fmt"
	"strings"

	"github.com/maple/cli/internal/cliargs"
)

func runAPI(args []string) error {
	if len(args) == 0 || args[0] == "help" || args[0] == "--help" || args[0] == "-h" {
		printAPIHelp()
		return nil
	}
	method := strings.ToUpper(args[0])
	args = args[1:]
	if len(args) == 0 {
		return errors.New("Usage: maple api <METHOD> <path> [--data <json|@file>] [--query <a=b&c=d>]")
	}
	path := args[0]
	if !strings.HasPrefix(path, "/") {
		path = "/" + path
	}
	flags, _ := cliargs.Parse(args[1:])
	body, err := anyBodyFromFlags(flags)
	if err != nil {
		return err
	}
	if flags.Bool("stream") {
		return streamRequest(method, path, flags, body)
	}
	return requestJSON(method, path, flags, body)
}

func printAPIHelp() {
	fmt.Println(`Maple CLI

Raw API:
  api GET /v1/agents --query workspace_id=ws_xxx
  api POST /v1/agents --data @agent.json
  api PATCH /v1/environments/env_xxx --data '{"name":"sandbox"}'
  api GET /v1/sessions/sess_xxx/events/stream --stream

Flags:
  --data <json|@file>     JSON request body
  --query <a=b&c=d>       query string
  --no-auth               skip Maple auth headers
  --stream                stream raw response lines`)
}

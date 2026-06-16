package cmd

import (
	"fmt"

	"github.com/maple/cli/internal/cliargs"
)

func runAgent(args []string) error {
	if len(args) > 0 {
		switch args[0] {
		case "runtime":
			return agentNested("runtime", args[1:])
		case "versions", "version":
			return agentNested("versions", args[1:])
		}
	}
	return runStandardResource(resourceSpec{Name: "agent", Collection: "/v1/agents", ItemName: "agent"}, args, agentBody)
}

func agentNested(kind string, args []string) error {
	flags, rest := cliargs.Parse(args)
	id, err := idArg(rest, flags.String("agent", "agent-id", "id"), "agent")
	if err != nil {
		return err
	}
	return requestJSON("GET", "/v1/agents/"+id+"/"+kind, flags, nil)
}

func agentBody(flags cliargs.Flags) (map[string]any, error) {
	body, err := basicBody(flags)
	if err != nil {
		return nil, err
	}
	setBodyString(body, "system", flags.String("system", "prompt"))
	if err := setAgentModel(body, flags); err != nil {
		return nil, err
	}
	if err := setBodyJSON(body, "tools", flags.String("tools")); err != nil {
		return nil, err
	}
	if err := setBodyJSON(body, "mcp_servers", flags.String("mcp-servers")); err != nil {
		return nil, err
	}
	if err := setBodyJSON(body, "skills", flags.String("skills")); err != nil {
		return nil, err
	}
	if loop := flags.String("loop", "agent-loop"); loop != "" {
		body["agent_loop"] = map[string]any{"type": loop, "config": map[string]any{}, "hooks": []any{}}
	}
	if err := setBodyJSON(body, "agent_loop", flags.String("agent-loop-json")); err != nil {
		return nil, err
	}
	if err := setBodyJSON(body, "multiagent", flags.String("multiagent")); err != nil {
		return nil, err
	}
	return body, nil
}

func setAgentModel(body map[string]any, flags cliargs.Flags) error {
	model := flags.String("model")
	if model == "" && flags.String("model-id") == "" && flags.String("model-config") == "" {
		return nil
	}
	if model != "" && (model[0] == '{' || model[0] == '@') {
		parsed, err := parseJSONInput(model)
		if err != nil {
			return err
		}
		body["model"] = parsed
		return nil
	}
	modelBody := map[string]any{"provider": firstNonEmpty(flags.String("provider"), "custom"), "id": firstNonEmpty(model, flags.String("model-id"))}
	if configID := flags.String("model-config", "model-config-id"); configID != "" {
		modelBody["config_id"] = configID
	}
	if name := flags.String("model-name"); name != "" {
		modelBody["name"] = name
	}
	body["model"] = modelBody
	return nil
}

func printAgentHelp() {
	fmt.Println(`Maple CLI

Agent commands:
  agent list [--workspace <id>] [--json]
  agent get <agent_id> [--json]
  agent create --data @agent.json [--json]
  agent create --name <name> --description <text> --system <prompt> --model-config <id> [--loop codex_open_source]
  agent update <agent_id> --data @patch.json
  agent versions <agent_id>
  agent runtime <agent_id>`)
}

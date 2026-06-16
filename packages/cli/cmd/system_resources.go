package cmd

import (
	"fmt"

	"github.com/maple/cli/internal/cliargs"
)

func runAnalytics(args []string) error {
	flags, _ := cliargs.Parse(args)
	return requestJSON("GET", "/v1/analytics/overview", flags, nil)
}

func runAgentDraft(args []string) error {
	subcommand := "create"
	if len(args) > 0 {
		subcommand = args[0]
		args = args[1:]
	}
	if subcommand != "create" && subcommand != "new" {
		return fmt.Errorf("Unknown agent-draft command: %s", subcommand)
	}
	flags, rest := cliargs.Parse(args)
	body, err := bodyFromFlags(flags)
	if err != nil {
		return err
	}
	setBodyString(body, "prompt", firstNonEmpty(flags.String("prompt", "message"), argString(rest)))
	setBodyString(body, "model_config_id", flags.String("model-config", "model-config-id"))
	setBodyString(body, "agent_loop_type", flags.String("loop", "agent-loop"))
	setBodyString(body, "workspace_id", firstNonEmpty(flags.String("workspace-id"), flags.String("workspace")))
	return requestJSON("POST", "/v1/agent_drafts", flags, body)
}

func runOnboarding(args []string) error {
	subcommand := "status"
	if len(args) > 0 {
		subcommand = args[0]
		args = args[1:]
	}
	flags, _ := cliargs.Parse(args)
	switch subcommand {
	case "status":
		return requestJSON("GET", "/v1/workspace_onboarding/status", flags, nil)
	case "create", "complete":
		body, err := anyBodyFromFlags(flags)
		if err != nil {
			return err
		}
		return requestJSON("POST", "/v1/workspace_onboarding", flags, body)
	default:
		return fmt.Errorf("Unknown onboarding command: %s", subcommand)
	}
}

func runBootstrap(args []string) error {
	flags, _ := cliargs.Parse(args)
	path := "/v1/bootstrap"
	if tenant := flags.String("tenant", "tenant-slug"); tenant != "" {
		path = "/v1/bootstrap/t/" + escaped(tenant)
	}
	if workspace := flags.String("workspace", "workspace-slug"); workspace != "" {
		path += "/w/" + escaped(workspace)
	}
	if flags.Bool("auth") {
		path = "/v1/auth" + path[3:]
	}
	return requestJSON("GET", path, flags, nil)
}

func runTenant(args []string) error {
	subcommand := "slug"
	if len(args) > 0 {
		subcommand = args[0]
		args = args[1:]
	}
	flags, rest := cliargs.Parse(args)
	switch subcommand {
	case "slug", "get":
		slug := firstNonEmpty(flags.String("slug"), firstArg(rest))
		if slug == "" {
			return fmt.Errorf("missing slug")
		}
		return requestJSON("GET", "/v1/tenants/slug/"+escaped(slug), flags, nil)
	default:
		return fmt.Errorf("Unknown tenant command: %s", subcommand)
	}
}

func runUser(args []string) error {
	flags, _ := cliargs.Parse(args)
	return requestJSON("GET", "/v1/users", flags, nil)
}

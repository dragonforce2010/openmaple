package cmd

import (
	"os"

	"github.com/maple/cli/internal/cliargs"
	"github.com/maple/cli/internal/clioutput"
)

func runStatus(args []string) error {
	flags, _ := cliargs.Parse(args)
	cfg, err := loadConfig()
	if err != nil {
		return err
	}
	api := newClient(cfg)
	if sessionID := flags.String("session"); sessionID != "" {
		detail, err := api.SessionDetail(sessionID)
		if err != nil {
			return err
		}
		value := map[string]any{
			"session":    detail["session"],
			"events":     len(asArray(detail["events"])),
			"tool_calls": len(asArray(detail["tool_calls"])),
		}
		return clioutput.JSON(os.Stdout, value, flags.Bool("json"))
	}
	deployments, err := api.ListDeployments()
	if err != nil {
		return err
	}
	return clioutput.JSON(os.Stdout, deployments, flags.Bool("json"))
}

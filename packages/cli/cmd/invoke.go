package cmd

import (
	"errors"
	"os"
	"strings"

	"github.com/maple/cli/internal/cliargs"
	"github.com/maple/cli/internal/clioutput"
)

func runInvoke(args []string) error {
	flags, rest := cliargs.Parse(args)
	cfg, err := loadConfig()
	if err != nil {
		return err
	}
	message := strings.TrimSpace(argString(rest))
	if input := flags.String("input"); input != "" {
		message, err = readInputFile(input)
		if err != nil {
			return err
		}
		message = strings.TrimSpace(message)
	}
	if message == "" {
		return errors.New("Usage: maple invoke \"message\" [--deployment <id>]")
	}
	deploymentID := firstNonEmpty(flags.String("deployment"), cfg.LastDeploymentID)
	if deploymentID == "" {
		return errors.New("No deployment selected. Run maple deploy or pass --deployment <id>.")
	}
	api := newClient(cfg)
	started, err := api.InvokeDeployment(deploymentID, map[string]any{"message": message})
	if err != nil {
		return err
	}
	if flags.Bool("json") {
		return clioutput.JSON(os.Stdout, started, true)
	}
	printSessionStarted(started)
	_, err = waitForSession(api, asString(started["session_id"]), flags.Bool("stream"), false)
	return err
}

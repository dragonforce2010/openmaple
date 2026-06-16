package cmd

import (
	"fmt"
	"os"

	"github.com/maple/cli/internal/cliargs"
	"github.com/maple/cli/internal/clioutput"
	"github.com/maple/cli/internal/config"
	"github.com/maple/cli/internal/project"
)

func runDeploy(args []string) error {
	flags, _ := cliargs.Parse(args)
	cfg, err := loadConfig()
	if err != nil {
		return err
	}
	projectDir, err := absPath(firstNonEmpty(flags.String("project", "cwd"), "."))
	if err != nil {
		return err
	}
	payload, err := loadBundleOrBuild(projectDir)
	if err != nil {
		return err
	}
	manifest := asObject(payload["manifest"])
	if flags.String("name") != "" {
		manifest["name"] = flags.String("name")
	}
	if flags.String("version") != "" {
		manifest["version"] = flags.String("version")
	}
	if err := project.Validate(manifest); err != nil {
		return err
	}
	payload["manifest"] = manifest
	deployment, err := newClient(cfg).CreateDeployment(payload)
	if err != nil {
		return err
	}
	cfg.LastDeploymentID = asString(deployment["id"])
	if err := config.Save(cfg); err != nil {
		return err
	}
	return clioutput.JSON(os.Stdout, deploymentSummary(deployment), flags.Bool("json"))
}

func deploymentSummary(deployment map[string]any) map[string]any {
	return map[string]any{
		"deployment_id":  deployment["id"],
		"agent_id":       deployment["agent_id"],
		"environment_id": deployment["environment_id"],
		"name":           deployment["name"],
		"version":        deployment["version"],
	}
}

func printSessionStarted(started map[string]any) {
	fmt.Printf("session %s\n", asString(started["session_id"]))
}

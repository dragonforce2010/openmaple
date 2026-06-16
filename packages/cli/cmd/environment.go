package cmd

import "github.com/maple/cli/internal/cliargs"

func runEnvironment(args []string) error {
	return runStandardResource(
		resourceSpec{Name: "environment", Collection: "/v1/environments", ItemName: "environment"},
		args,
		environmentBody,
	)
}

func environmentBody(flags cliargs.Flags) (map[string]any, error) {
	body, err := basicBody(flags)
	if err != nil {
		return nil, err
	}
	if err := setBodyJSON(body, "config", flags.String("config")); err != nil {
		return nil, err
	}
	if runtime := flags.String("runtime", "type"); runtime != "" {
		config := asObject(body["config"])
		config["type"] = runtime
		config["sandbox"] = map[string]any{"provider": runtime}
		body["config"] = config
	}
	return body, nil
}

package cmd

import (
	"os"

	"github.com/maple/cli/internal/build"
	"github.com/maple/cli/internal/cliargs"
	"github.com/maple/cli/internal/clioutput"
)

func runVersion(args []string) error {
	flags, _ := cliargs.Parse(args)
	value := map[string]any{"maple": build.Version}
	if flags.Bool("server") {
		cfg, err := loadConfig()
		if err != nil {
			return err
		}
		server, err := newClient(cfg).Version()
		if err != nil {
			return err
		}
		value["server"] = server
	}
	return clioutput.JSON(os.Stdout, value, flags.Bool("json"))
}

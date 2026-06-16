package cmd

import (
	"errors"
	"fmt"
	"os"
	"strings"

	"github.com/maple/cli/internal/cliargs"
	"github.com/maple/cli/internal/clioutput"
	"github.com/maple/cli/internal/skills"
)

func runEmbeddedSkills(args []string) error {
	subcommand := "list"
	if len(args) > 0 {
		subcommand = args[0]
		args = args[1:]
	}
	if skillFS == nil {
		return errors.New("skill content not embedded in this build")
	}
	flags, rest := cliargs.Parse(args)
	switch subcommand {
	case "list":
		return embeddedList(flags, rest)
	case "read":
		return embeddedRead(flags, rest)
	default:
		return fmt.Errorf("Unknown skills command: %s", subcommand)
	}
}

func embeddedList(flags cliargs.Flags, rest []string) error {
	if len(rest) == 0 {
		list, err := skills.ListEmbedded(skillFS)
		if err != nil {
			return err
		}
		return clioutput.JSON(os.Stdout, map[string]any{"ok": true, "skills": list, "count": len(list)}, true)
	}
	entries, listed, err := skills.ListPath(skillFS, rest[0])
	if err != nil {
		return err
	}
	_ = flags
	return clioutput.JSON(os.Stdout, map[string]any{"ok": true, "path": listed, "entries": entries, "count": len(entries)}, true)
}

func embeddedRead(flags cliargs.Flags, rest []string) error {
	name, relPath, err := readTarget(rest)
	if err != nil {
		return err
	}
	content, pathOut, err := skills.ReadEmbedded(skillFS, name, relPath)
	if err != nil {
		return err
	}
	if flags.Bool("json") {
		value := map[string]any{"skill": name, "path": pathOut, "content": string(content)}
		if pathOut == "SKILL.md" {
			value["guidance"] = "Read references with `maple skills read " + name + " <relative-path>`."
		}
		return clioutput.JSON(os.Stdout, value, true)
	}
	_, err = os.Stdout.Write(content)
	if err == nil && !strings.HasSuffix(string(content), "\n") {
		fmt.Println()
	}
	return err
}

func readTarget(args []string) (string, string, error) {
	switch len(args) {
	case 1:
		name, relPath, _ := strings.Cut(args[0], "/")
		return name, relPath, nil
	case 2:
		return args[0], args[1], nil
	default:
		return "", "", errors.New("read requires 1 or 2 arguments: <name>[/<path>] [path]")
	}
}

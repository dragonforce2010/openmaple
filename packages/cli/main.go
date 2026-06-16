package main

import (
	"embed"
	"os"

	"github.com/maple/cli/cmd"
)

//go:embed skills/*/SKILL.md skills/*/references/*.md
var skillFS embed.FS

func main() {
	cmd.SetSkillFS(skillFS)
	os.Exit(cmd.Execute())
}

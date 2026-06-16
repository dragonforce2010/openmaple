package cmd

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"

	"github.com/maple/cli/internal/cliargs"
	"github.com/maple/cli/internal/clioutput"
	"github.com/maple/cli/internal/project"
	"github.com/maple/cli/internal/skills"
)

func runSkill(args []string) error {
	subcommand := "help"
	if len(args) > 0 {
		subcommand = args[0]
		args = args[1:]
	}
	if subcommand == "help" || subcommand == "--help" || subcommand == "-h" {
		printSkillHelp()
		return nil
	}
	flags, rest := cliargs.Parse(args)
	cfg, err := loadConfig()
	if err != nil {
		return err
	}
	api := newClient(cfg)
	switch subcommand {
	case "list":
		value, err := api.ListSkills()
		if err != nil {
			return err
		}
		return clioutput.JSON(os.Stdout, value, flags.Bool("json"))
	case "init":
		return skillInit(flags, rest)
	case "push":
		skill, err := pushSkill(api, flags, rest)
		if err != nil {
			return err
		}
		return clioutput.JSON(os.Stdout, skill, flags.Bool("json"))
	case "deploy-run":
		return skillDeployRun(api, flags, rest)
	default:
		return fmt.Errorf("Unknown skill command: %s", subcommand)
	}
}

func skillInit(flags cliargs.Flags, rest []string) error {
	name := skills.Slugify(firstNonEmpty(flags.String("name"), firstArg(rest), "maple-skill"))
	description := firstNonEmpty(flags.String("description"), "Use when "+name+" is needed by a Maple managed agent.")
	target := firstNonEmpty(flags.String("directory"), secondArg(rest), filepath.Join("skills", name))
	targetDir, err := absPath(target)
	if err != nil {
		return err
	}
	if err := skills.InitFile(targetDir, name, description, flags.Bool("yes")); err != nil {
		return err
	}
	fmt.Printf("skill_initialized %s\n", targetDir)
	return nil
}

func pushSkill(api interface {
	CreateSkill(map[string]any) (map[string]any, error)
	SaveSkillFile(string, string, string) (map[string]any, error)
}, flags cliargs.Flags, rest []string) (map[string]any, error) {
	filePath := ""
	if flags.String("file") != "" {
		abs, err := absPath(flags.String("file"))
		if err != nil {
			return nil, err
		}
		filePath = abs
	}
	name := firstNonEmpty(flags.String("name"), firstArg(rest))
	if name == "" && filePath != "" {
		name = filepath.Base(filepath.Dir(filePath))
	}
	name = skills.Slugify(firstNonEmpty(name, "maple-skill"))
	return skills.Push(api, skills.PushInput{
		Name:        name,
		Description: flags.String("description"),
		FilePath:    filePath,
		Content:     flags.String("content"),
	})
}

func skillDeployRun(api fullAPI, flags cliargs.Flags, rest []string) error {
	name := skills.Slugify(firstNonEmpty(flags.String("name"), firstArg(rest), "maple-skill"))
	description := firstNonEmpty(flags.String("description"), "Use when "+name+" is needed by a Maple managed agent.")
	projectDir, err := absPath(firstNonEmpty(flags.String("project", "cwd"), filepath.Join(".", name+"-agent")))
	if err != nil {
		return err
	}
	prompt := firstNonEmpty(flags.String("prompt", "message"), argString(skipFirst(rest)), "Use the "+name+" skill and report what you did.")
	loop := firstNonEmpty(flags.String("loop"), "codex_open_source")
	runtime := firstNonEmpty(flags.String("runtime"), "e2b")
	if !project.ValidLoop(loop) {
		return fmt.Errorf("Invalid --loop %s. Expected anthropic_claude_code or codex_open_source.", loop)
	}
	if !project.ValidRuntime(runtime) {
		return errors.New("Invalid --runtime. Expected e2b, local_docker, or vefaas.")
	}
	manifestPath := filepath.Join(projectDir, firstNonEmpty(flags.String("manifest"), "maple.manifest.json"))
	if !exists(manifestPath) {
		if err := project.Init(projectDir, name+"-agent", loop, runtime, true); err != nil {
			return err
		}
	}
	skill, err := skills.Push(api, skills.PushInput{Name: name, Description: description})
	if err != nil {
		return err
	}
	if _, err := project.AttachSkill(manifestPath, skill); err != nil {
		return err
	}
	outDir := filepath.Join(projectDir, firstNonEmpty(flags.String("out"), ".maple/build"))
	built, err := project.Build(projectDir, manifestPath, outDir)
	if err != nil {
		return err
	}
	deployment, err := api.CreateDeployment(map[string]any{"manifest": built.Manifest, "bundle": built.Bundle})
	if err != nil {
		return err
	}
	started, err := api.InvokeDeployment(asString(deployment["id"]), map[string]any{"message": prompt, "title": asString(built.Manifest["name"]) + " skill run"})
	if err != nil {
		return err
	}
	detail, err := waitForSession(api, asString(started["session_id"]), flags.Bool("stream"), true)
	if err != nil {
		return err
	}
	return clioutput.JSON(os.Stdout, skillRunSummary(skill, deployment, started, detail), flags.Bool("json"))
}

type fullAPI interface {
	CreateDeployment(map[string]any) (map[string]any, error)
	InvokeDeployment(string, map[string]any) (map[string]any, error)
	SessionDetail(string) (map[string]any, error)
	CreateSkill(map[string]any) (map[string]any, error)
	SaveSkillFile(string, string, string) (map[string]any, error)
}

func skillRunSummary(skill map[string]any, deployment map[string]any, started map[string]any, detail map[string]any) map[string]any {
	session := asObject(detail["session"])
	metadata := asObject(session["metadata"])
	runtime := asObject(metadata["runtime"])
	if len(runtime) == 0 {
		runtime = asObject(metadata["sandbox_runtime"])
	}
	return map[string]any{
		"skill_id":       skill["id"],
		"skill_name":     skill["name"],
		"deployment_id":  deployment["id"],
		"agent_id":       deployment["agent_id"],
		"environment_id": deployment["environment_id"],
		"session_id":     started["session_id"],
		"session_status": session["status"],
		"runtime_id":     firstNonEmpty(asString(runtime["sandbox_id"]), asString(runtime["container_name"])),
		"runtime_type":   runtime["type"],
		"tool_calls":     summarizeToolCalls(asArray(detail["tool_calls"])),
	}
}

func summarizeToolCalls(calls []any) []map[string]any {
	result := []map[string]any{}
	for _, call := range calls {
		item := asObject(call)
		result = append(result, map[string]any{"name": item["tool_name"], "status": item["status"], "output": item["output"]})
	}
	return result
}

func printSkillHelp() {
	fmt.Println(`Maple CLI

Skill commands:
  skill list [--json]
  skill init --name <name> --description <text> [--directory <dir>] [--yes]
  skill push --name <name> --description <text> [--file <SKILL.md>] [--json]
  skill deploy-run --name <name> --description <text> --project <dir> --prompt <message> [--loop codex_open_source] [--runtime e2b|vefaas] [--json]`)
}

func secondArg(args []string) string {
	if len(args) < 2 {
		return ""
	}
	return args[1]
}

func skipFirst(args []string) []string {
	if len(args) == 0 {
		return args
	}
	return args[1:]
}

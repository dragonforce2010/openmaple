package cmd

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"

	"github.com/maple/cli/internal/cliargs"
	"github.com/maple/cli/internal/project"
	"github.com/maple/cli/internal/skills"
)

func runInit(args []string) error {
	flags, rest := cliargs.Parse(args)
	targetArg := firstNonEmpty(flags.String("directory"), firstArg(rest), ".")
	targetDir, err := absPath(targetArg)
	if err != nil {
		return err
	}
	nameSource := targetArg
	if targetArg == "." {
		nameSource = "managed-agent"
	}
	name := skills.Slugify(firstNonEmpty(flags.String("name"), nameSource))
	loop := firstNonEmpty(flags.String("loop"), project.DefaultLoop)
	runtime := firstNonEmpty(flags.String("runtime"), "e2b")
	if !project.ValidLoop(loop) {
		return fmt.Errorf("Invalid --loop %s. Expected anthropic_claude_code or codex_open_source.", loop)
	}
	if !project.ValidRuntime(runtime) {
		return errors.New("Invalid --runtime. Expected e2b, local_docker, or vefaas.")
	}
	if err := project.Init(targetDir, name, loop, runtime, flags.Bool("yes")); err != nil {
		return err
	}
	fmt.Printf("initialized %s\n", targetDir)
	return nil
}

func runBuild(args []string) error {
	result, err := buildFromArgs(args)
	if err != nil {
		return err
	}
	fmt.Printf("built %s\n", result.BundlePath)
	return nil
}

func buildFromArgs(args []string) (project.BuildResult, error) {
	flags, _ := cliargs.Parse(args)
	projectDir, err := absPath(firstNonEmpty(flags.String("project", "cwd"), "."))
	if err != nil {
		return project.BuildResult{}, err
	}
	manifestPath := filepath.Join(projectDir, firstNonEmpty(flags.String("manifest"), "maple.manifest.json"))
	outDir := filepath.Join(projectDir, firstNonEmpty(flags.String("out"), ".maple/build"))
	return project.Build(projectDir, manifestPath, outDir)
}

func loadBundleOrBuild(projectDir string) (map[string]any, error) {
	bundlePath := filepath.Join(projectDir, ".maple", "build", "bundle.json")
	if !exists(bundlePath) {
		if _, err := project.Build(projectDir, filepath.Join(projectDir, "maple.manifest.json"), filepath.Join(projectDir, ".maple", "build")); err != nil {
			return nil, err
		}
	}
	return project.ReadBundle(bundlePath)
}

func firstArg(args []string) string {
	if len(args) == 0 {
		return ""
	}
	return args[0]
}

func readInputFile(path string) (string, error) {
	data, err := os.ReadFile(path)
	return string(data), err
}

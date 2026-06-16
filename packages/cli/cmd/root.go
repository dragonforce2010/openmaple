package cmd

import (
	"fmt"
	"io/fs"
	"os"
	"strings"

	"github.com/maple/cli/internal/build"
)

var skillFS fs.FS

func SetSkillFS(fsys fs.FS) {
	skillFS = fsys
}

func Execute() int {
	if err := run(os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, err.Error())
		return 1
	}
	return 0
}

func run(args []string) error {
	command := "help"
	if len(args) > 0 {
		command = args[0]
		args = args[1:]
	}
	switch command {
	case "help", "--help", "-h":
		printHelp()
	case "version":
		return runVersion(args)
	case "config":
		return runConfig(args)
	case "init":
		return runInit(args)
	case "build":
		return runBuild(args)
	case "deploy":
		return runDeploy(args)
	case "invoke":
		return runInvoke(args)
	case "status":
		return runStatus(args)
	case "api":
		return runAPI(args)
	case "agent", "agents":
		return runAgent(args)
	case "environment", "environments", "env":
		return runEnvironment(args)
	case "session", "sessions":
		return runSession(args)
	case "vault", "vaults":
		return runVault(args)
	case "workspace", "workspaces":
		return runWorkspace(args)
	case "model-config", "model-configs", "model_config", "model_configs":
		return runModelConfig(args)
	case "mcp", "mcp-server", "mcp-servers":
		return runMCP(args)
	case "memory-store", "memory-stores", "memory_store", "memory_stores":
		return runMemoryStore(args)
	case "template", "templates":
		return runTemplate(args)
	case "file", "files":
		return runFile(args)
	case "artifact", "artifacts":
		return runArtifact(args)
	case "quickstart":
		return runQuickstart(args)
	case "runtime":
		return runRuntime(args)
	case "deployment", "deployments":
		return runDeployment(args)
	case "analytics":
		return runAnalytics(args)
	case "agent-draft", "agent-drafts", "agent_draft", "agent_drafts":
		return runAgentDraft(args)
	case "onboarding", "workspace-onboarding", "workspace_onboarding":
		return runOnboarding(args)
	case "bootstrap":
		return runBootstrap(args)
	case "tenant", "tenants":
		return runTenant(args)
	case "user", "users":
		return runUser(args)
	case "skill":
		return runSkill(args)
	case "skills":
		return runEmbeddedSkills(args)
	default:
		return fmt.Errorf("Unknown command: %s", command)
	}
	return nil
}

func printHelp() {
	fmt.Printf(`Maple CLI %s

Commands:
  init [dir] --name <name> --loop <anthropic_claude_code|codex_open_source> --runtime <e2b|local_docker|vefaas>
  config get | config set api.baseUrl <url> | config login --local --email <email> | config login --api-key <maple_ws_...> | config whoami
  build --project <dir>
  deploy --project <dir>
  invoke "message" --deployment <id>
  status [--session <id>]
  api <METHOD> <path> [--data <json|@file>] [--query <a=b>]
  agent|environment|session|vault|workspace|model-config list|get|create|update
  mcp catalog|list|create|update|delete|oauth-start
  memory-store list|create|memories|put
  file create|get
  artifact list|session|download
  quickstart builder-session|message|action
  deployment list|get|create|invoke|run|runs|pause|unpause|archive
  skill list | skill init | skill push | skill deploy-run
  skills list | skills read
  version [--server]

Config:
  default path: ~/.maple/config.json
`, build.Version)
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}

func asString(value any) string {
	if text, ok := value.(string); ok {
		return text
	}
	return ""
}

func asObject(value any) map[string]any {
	if object, ok := value.(map[string]any); ok {
		return object
	}
	return map[string]any{}
}

func asArray(value any) []any {
	if items, ok := value.([]any); ok {
		return items
	}
	return []any{}
}

func argString(args []string) string {
	return strings.TrimSpace(strings.Join(args, " "))
}

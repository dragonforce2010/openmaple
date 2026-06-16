package skills

import (
	"errors"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

type PushInput struct {
	Name        string
	Description string
	FilePath    string
	Content     string
}

func Markdown(name string, description string) string {
	return strings.Join([]string{
		"---",
		"name: " + name,
		"description: " + description,
		"---",
		"",
		"# Workflow",
		"",
		"- Inspect the current Maple workspace, agent, session, and sandbox context.",
		"- Use Maple CLI or SDK commands for cloud operations.",
		"- Report created resource IDs and session status.",
		"",
	}, "\n")
}

func InitFile(targetDir string, name string, description string, overwrite bool) error {
	path := filepath.Join(targetDir, "SKILL.md")
	if !overwrite {
		if _, err := os.Stat(path); err == nil {
			return errors.New("File already exists: " + path + ". Pass --yes to overwrite generated starter files.")
		}
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	return os.WriteFile(path, []byte(Markdown(name, description)), 0o644)
}

type API interface {
	CreateSkill(map[string]any) (map[string]any, error)
	SaveSkillFile(string, string, string) (map[string]any, error)
}

func Push(api API, input PushInput) (map[string]any, error) {
	fileContent := ""
	if input.FilePath != "" {
		data, err := os.ReadFile(input.FilePath)
		if err != nil {
			return nil, err
		}
		fileContent = string(data)
	}
	description := input.Description
	if description == "" {
		description = ExtractDescription(fileContent, "Use when "+input.Name+" is needed by a Maple managed agent.")
	}
	created, err := api.CreateSkill(map[string]any{"name": input.Name, "description": description})
	if err != nil {
		return nil, err
	}
	content := input.Content
	if content == "" {
		content = fileContent
	}
	if content == "" {
		content = Markdown(input.Name, description)
	}
	saved, err := api.SaveSkillFile(stringValue(created["id"]), "SKILL.md", content)
	if err != nil {
		return nil, err
	}
	created["file"] = map[string]any{"path": saved["path"], "size": saved["size"]}
	return created, nil
}

func ExtractDescription(content string, fallback string) string {
	re := regexp.MustCompile(`(?m)^description:\s*(.+)$`)
	match := re.FindStringSubmatch(content)
	if len(match) < 2 {
		return fallback
	}
	return strings.Trim(strings.TrimSpace(match[1]), `"'`)
}

func Slugify(value string) string {
	text := strings.ToLower(value)
	re := regexp.MustCompile(`[^a-z0-9]+`)
	text = strings.Trim(re.ReplaceAllString(text, "-"), "-")
	if text == "" {
		return "managed-agent"
	}
	return text
}

func stringValue(value any) string {
	if text, ok := value.(string); ok {
		return text
	}
	return ""
}

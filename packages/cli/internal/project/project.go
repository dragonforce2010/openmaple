package project

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"time"
)

type BuildResult struct {
	Manifest   map[string]any
	Bundle     map[string]any
	BundlePath string
}

func Init(targetDir string, name string, loop string, runtime string, overwrite bool) error {
	if err := os.MkdirAll(filepath.Join(targetDir, "src"), 0o755); err != nil {
		return err
	}
	manifest, err := json.MarshalIndent(DefaultManifest(name, loop, runtime), "", "  ")
	if err != nil {
		return err
	}
	if err := writeNew(filepath.Join(targetDir, "maple.manifest.json"), append(manifest, '\n'), overwrite); err != nil {
		return err
	}
	if err := writeNew(filepath.Join(targetDir, "src", "harness.mjs"), []byte(harnessSource()), overwrite); err != nil {
		return err
	}
	pkg := map[string]any{
		"name":         name,
		"version":      "0.1.0",
		"type":         "module",
		"private":      true,
		"dependencies": map[string]any{"maple-agent-sdk": "^0.1.3"},
	}
	data, err := json.MarshalIndent(pkg, "", "  ")
	if err != nil {
		return err
	}
	return writeNew(filepath.Join(targetDir, "package.json"), append(data, '\n'), overwrite)
}

func Build(projectDir string, manifestPath string, outDir string) (BuildResult, error) {
	manifest, err := ReadManifest(manifestPath)
	if err != nil {
		return BuildResult{}, err
	}
	if err := Validate(manifest); err != nil {
		return BuildResult{}, err
	}
	if err := os.MkdirAll(outDir, 0o755); err != nil {
		return BuildResult{}, err
	}
	files := []map[string]any{}
	manifestText, err := json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		return BuildResult{}, err
	}
	files = append(files, bundleFile("maple.manifest.json", append(manifestText, '\n')))
	entry := harnessEntry(manifest)
	if data, err := os.ReadFile(filepath.Join(projectDir, entry)); err == nil {
		files = append(files, bundleFile(entry, data))
	}
	sum := sha256.New()
	for _, file := range files {
		sum.Write([]byte(stringValue(file["path"])))
		sum.Write([]byte(stringValue(file["content_base64"])))
	}
	bundle := map[string]any{
		"sha256":   hex.EncodeToString(sum.Sum(nil)),
		"files":    files,
		"built_at": time.Now().UTC().Format(time.RFC3339Nano),
	}
	envelope := map[string]any{"manifest": manifest, "bundle": bundle}
	data, err := json.MarshalIndent(envelope, "", "  ")
	if err != nil {
		return BuildResult{}, err
	}
	bundlePath := filepath.Join(outDir, "bundle.json")
	if err := os.WriteFile(bundlePath, append(data, '\n'), 0o644); err != nil {
		return BuildResult{}, err
	}
	return BuildResult{Manifest: manifest, Bundle: bundle, BundlePath: bundlePath}, nil
}

func ReadManifest(path string) (map[string]any, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var manifest map[string]any
	if err := json.Unmarshal(data, &manifest); err != nil {
		return nil, err
	}
	return manifest, nil
}

func ReadBundle(path string) (map[string]any, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var bundle map[string]any
	if err := json.Unmarshal(data, &bundle); err != nil {
		return nil, err
	}
	return bundle, nil
}

func AttachSkill(manifestPath string, skill map[string]any) (map[string]any, error) {
	manifest, err := ReadManifest(manifestPath)
	if err != nil {
		return nil, err
	}
	agent := objectValue(manifest["agent"])
	current := arrayValue(agent["skills"])
	next := []any{}
	name := stringValue(skill["name"])
	for _, item := range current {
		if stringValue(objectValue(item)["name"]) != name {
			next = append(next, item)
		}
	}
	next = append(next, map[string]any{"id": skill["id"], "name": name, "source": "maple_cli"})
	agent["skills"] = next
	manifest["agent"] = agent
	data, err := json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		return nil, err
	}
	if err := os.WriteFile(manifestPath, append(data, '\n'), 0o644); err != nil {
		return nil, err
	}
	return manifest, nil
}

func Validate(manifest map[string]any) error {
	if stringValue(manifest["name"]) == "" || stringValue(manifest["version"]) == "" {
		return errors.New("Manifest requires name and version.")
	}
	agent := objectValue(manifest["agent"])
	if stringValue(agent["name"]) == "" || stringValue(agent["system"]) == "" {
		return errors.New("Manifest requires agent.name and agent.system.")
	}
	loop := stringValue(objectValue(agent["agent_loop"])["type"])
	if loop == "" {
		loop = DefaultLoop
	}
	if !ValidLoop(loop) {
		return errors.New("Invalid manifest agent_loop.type: " + loop)
	}
	return nil
}

func bundleFile(path string, data []byte) map[string]any {
	return map[string]any{"path": path, "content_base64": base64.StdEncoding.EncodeToString(data)}
}

func writeNew(path string, data []byte, overwrite bool) error {
	if !overwrite {
		if _, err := os.Stat(path); err == nil {
			return errors.New("File already exists: " + path + ". Pass --yes to overwrite generated starter files.")
		}
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	return os.WriteFile(path, data, 0o644)
}

func harnessSource() string {
	return strings.Join([]string{
		"import { defineHarness } from 'maple-agent-sdk';",
		"",
		"export default defineHarness({",
		"  async beforeInvoke(ctx) {",
		"    return { message: ctx.input };",
		"  },",
		"  async onEvent(event, ctx) {",
		"    ctx.log(event.type);",
		"  },",
		"  async afterInvoke(result) {",
		"    return result;",
		"  }",
		"});",
		"",
	}, "\n")
}

func harnessEntry(manifest map[string]any) string {
	entry := stringValue(objectValue(manifest["harness"])["entry"])
	if entry == "" {
		return "src/harness.mjs"
	}
	return entry
}

func objectValue(value any) map[string]any {
	if object, ok := value.(map[string]any); ok {
		return object
	}
	return map[string]any{}
}

func arrayValue(value any) []any {
	if items, ok := value.([]any); ok {
		return items
	}
	return []any{}
}

func stringValue(value any) string {
	if text, ok := value.(string); ok {
		return text
	}
	return ""
}

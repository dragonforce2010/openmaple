package skills

import (
	"errors"
	"io/fs"
	"path"
	"strings"
)

type EmbeddedSkill struct {
	Name        string `json:"name"`
	Description string `json:"description"`
}

type DirEntry struct {
	Name string `json:"name"`
	Path string `json:"path"`
	Type string `json:"type"`
}

func ListEmbedded(fsys fs.FS) ([]EmbeddedSkill, error) {
	entries, err := fs.ReadDir(fsys, "skills")
	if err != nil {
		return nil, err
	}
	result := []EmbeddedSkill{}
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		content, err := fs.ReadFile(fsys, path.Join("skills", entry.Name(), "SKILL.md"))
		if err != nil {
			return nil, err
		}
		result = append(result, EmbeddedSkill{Name: entry.Name(), Description: ExtractDescription(string(content), "")})
	}
	return result, nil
}

func ListPath(fsys fs.FS, target string) ([]DirEntry, string, error) {
	clean, err := cleanTarget(target)
	if err != nil {
		return nil, "", err
	}
	entries, err := fs.ReadDir(fsys, clean)
	if err != nil {
		return nil, "", err
	}
	result := []DirEntry{}
	for _, entry := range entries {
		itemType := "file"
		if entry.IsDir() {
			itemType = "directory"
		}
		result = append(result, DirEntry{Name: entry.Name(), Path: path.Join(clean, entry.Name()), Type: itemType})
	}
	return result, clean, nil
}

func ReadEmbedded(fsys fs.FS, name string, relPath string) ([]byte, string, error) {
	if relPath == "" {
		relPath = "SKILL.md"
	}
	clean, err := cleanTarget(path.Join(name, relPath))
	if err != nil {
		return nil, "", err
	}
	content, err := fs.ReadFile(fsys, clean)
	return content, strings.TrimPrefix(clean, "skills/"+name+"/"), err
}

func cleanTarget(target string) (string, error) {
	target = strings.TrimPrefix(target, "skills/")
	clean := path.Clean(path.Join("skills", target))
	if clean == "skills/." || clean == "." {
		clean = "skills"
	}
	if clean != "skills" && !strings.HasPrefix(clean, "skills/") {
		return "", errors.New("skill_path_outside_root")
	}
	if strings.Contains(clean, "../") {
		return "", errors.New("skill_path_outside_root")
	}
	return clean, nil
}

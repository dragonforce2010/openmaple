package cmd

import (
	"os"
	"path/filepath"

	"github.com/maple/cli/internal/client"
	"github.com/maple/cli/internal/config"
)

func loadConfig() (config.Config, error) {
	return config.Load()
}

func saveConfig(cfg config.Config) error {
	return config.Save(cfg)
}

func newClient(cfg config.Config) *client.Client {
	return client.New(config.BaseURL(cfg), config.Token(cfg))
}

func absPath(path string) (string, error) {
	if path == "" {
		path = "."
	}
	return filepath.Abs(path)
}

func exists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

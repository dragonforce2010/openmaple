package config

import (
	"encoding/json"
	"os"
	"path/filepath"
)

type Config struct {
	API              APIConfig   `json:"api"`
	Auth             *AuthConfig `json:"auth,omitempty"`
	LastDeploymentID string      `json:"lastDeploymentId,omitempty"`
}

type APIConfig struct {
	BaseURL string `json:"baseUrl,omitempty"`
}

type AuthConfig struct {
	Token string `json:"token,omitempty"`
	Email string `json:"email,omitempty"`
}

func Path() string {
	if value := os.Getenv("MAPLE_CONFIG"); value != "" {
		abs, err := filepath.Abs(value)
		if err == nil {
			return abs
		}
		return value
	}
	home, err := os.UserHomeDir()
	if err != nil {
		home = "."
	}
	return filepath.Join(home, ".maple", "config.json")
}

func Load() (Config, error) {
	cfg := Config{API: APIConfig{BaseURL: defaultBaseURL()}}
	data, err := os.ReadFile(Path())
	if os.IsNotExist(err) {
		return cfg, nil
	}
	if err != nil {
		return cfg, err
	}
	if err := json.Unmarshal(data, &cfg); err != nil {
		return cfg, err
	}
	if cfg.API.BaseURL == "" {
		cfg.API.BaseURL = defaultBaseURL()
	}
	return cfg, nil
}

func Save(cfg Config) error {
	path := Path()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	data, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}
	data = append(data, '\n')
	return os.WriteFile(path, data, 0o600)
}

func BaseURL(cfg Config) string {
	if value := os.Getenv("MAPLE_API_BASE_URL"); value != "" {
		return value
	}
	if cfg.API.BaseURL != "" {
		return cfg.API.BaseURL
	}
	return defaultBaseURL()
}

func Token(cfg Config) string {
	if value := os.Getenv("MAPLE_API_KEY"); value != "" {
		return value
	}
	if cfg.Auth != nil {
		return cfg.Auth.Token
	}
	return ""
}

func Redacted(cfg Config) Config {
	if cfg.Auth == nil || cfg.Auth.Token == "" {
		return cfg
	}
	redacted := cfg
	auth := *cfg.Auth
	if len(auth.Token) > 12 {
		auth.Token = auth.Token[:12] + "..."
	} else {
		auth.Token = "..."
	}
	redacted.Auth = &auth
	return redacted
}

func Set(cfg *Config, key string, value string) bool {
	switch key {
	case "api.baseUrl":
		cfg.API.BaseURL = value
		return true
	default:
		return false
	}
}

func defaultBaseURL() string {
	if value := os.Getenv("MAPLE_API_BASE_URL"); value != "" {
		return value
	}
	return "https://sd8ihq8v316pc5mf9c1j0.apigateway-cn-beijing.volceapi.com"
}

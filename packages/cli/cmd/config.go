package cmd

import (
	"errors"
	"fmt"
	"os"

	"github.com/maple/cli/internal/cliargs"
	"github.com/maple/cli/internal/clioutput"
	"github.com/maple/cli/internal/config"
)

func runConfig(args []string) error {
	subcommand := "get"
	if len(args) > 0 {
		subcommand = args[0]
		args = args[1:]
	}
	cfg, err := loadConfig()
	if err != nil {
		return err
	}
	switch subcommand {
	case "set":
		return configSet(cfg, args)
	case "login":
		return configLogin(cfg, args)
	case "whoami":
		return configWhoami(cfg)
	case "get":
		return clioutput.JSON(os.Stdout, config.Redacted(cfg), false)
	default:
		return clioutput.JSON(os.Stdout, config.Redacted(cfg), false)
	}
}

func configSet(cfg config.Config, args []string) error {
	if len(args) < 2 {
		return errors.New("Usage: maple config set api.baseUrl <url>")
	}
	if !config.Set(&cfg, args[0], args[1]) {
		return fmt.Errorf("Unsupported config key: %s", args[0])
	}
	if err := saveConfig(cfg); err != nil {
		return err
	}
	fmt.Printf("%s=%s\n", args[0], args[1])
	return nil
}

func configLogin(cfg config.Config, args []string) error {
	flags, _ := cliargs.Parse(args)
	apiKey := flags.String("api-key", "key")
	if apiKey != "" {
		api := clientWithToken(cfg, apiKey)
		me, err := api.Me()
		if err != nil {
			return err
		}
		if len(asObject(me["user"])) == 0 {
			return errors.New("invalid_api_key")
		}
		cfg.Auth = &config.AuthConfig{Token: apiKey, Email: loginEmail(me, "workspace-api-key")}
		if err := saveConfig(cfg); err != nil {
			return err
		}
		fmt.Printf("api_key_logged_in %s\n", cfg.Auth.Email)
		return nil
	}
	email := flags.String("email")
	if !flags.Bool("local") || email == "" {
		return errors.New("Usage: maple config login --local --email <email> [--name <name>] OR maple config login --api-key <maple_ws_...>")
	}
	login, err := newClient(cfg).LoginLocal(email, flags.String("name"))
	if err != nil {
		return err
	}
	cfg.Auth = &config.AuthConfig{Token: login.Token, Email: loginEmail(login.Body, email)}
	if err := saveConfig(cfg); err != nil {
		return err
	}
	fmt.Printf("logged_in %s\n", cfg.Auth.Email)
	return nil
}

func configWhoami(cfg config.Config) error {
	me, err := newClient(cfg).Me()
	if err != nil {
		return err
	}
	return clioutput.JSON(os.Stdout, me, false)
}

func clientWithToken(cfg config.Config, token string) apiClient {
	return newClient(config.Config{API: cfg.API, Auth: &config.AuthConfig{Token: token}})
}

type apiClient interface {
	Me() (map[string]any, error)
}

func loginEmail(body map[string]any, fallback string) string {
	user := asObject(body["user"])
	if email := asString(user["email"]); email != "" {
		return email
	}
	return fallback
}

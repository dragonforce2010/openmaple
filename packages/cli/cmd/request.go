package cmd

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os"
	"strings"

	"github.com/maple/cli/internal/cliargs"
	"github.com/maple/cli/internal/client"
	"github.com/maple/cli/internal/clioutput"
)

func requestJSON(method string, path string, flags cliargs.Flags, body any) error {
	cfg, err := loadConfig()
	if err != nil {
		return err
	}
	value, err := newClient(cfg).Request(method, pathWithQuery(path, flags), body, !flags.Bool("no-auth"))
	if err != nil {
		return err
	}
	return clioutput.JSON(os.Stdout, value, flags.Bool("json"))
}

func streamRequest(method string, path string, flags cliargs.Flags, body any) error {
	cfg, err := loadConfig()
	if err != nil {
		return err
	}
	return newClient(cfg).Stream(method, pathWithQuery(path, flags), body, !flags.Bool("no-auth"), os.Stdout)
}

func requestBytes(method string, path string, flags cliargs.Flags, body []byte, contentType string) error {
	cfg, err := loadConfig()
	if err != nil {
		return err
	}
	value, err := newClient(cfg).RequestBytes(method, pathWithQuery(path, flags), body, contentType, !flags.Bool("no-auth"))
	if err != nil {
		return err
	}
	return clioutput.JSON(os.Stdout, value, flags.Bool("json"))
}

func pathWithQuery(path string, flags cliargs.Flags) string {
	values := url.Values{}
	addQuery(values, "workspace_id", firstNonEmpty(flags.String("workspace-id"), flags.String("workspace")))
	addRawQuery(values, flags.String("query", "params"))
	encoded := values.Encode()
	if encoded == "" {
		return path
	}
	separator := "?"
	if strings.Contains(path, "?") {
		separator = "&"
	}
	return path + separator + encoded
}

func addQuery(values url.Values, key string, value string) {
	if key != "" && value != "" {
		values.Set(key, value)
	}
}

func addRawQuery(values url.Values, raw string) {
	if raw == "" {
		return
	}
	parsed, err := url.ParseQuery(strings.TrimPrefix(raw, "?"))
	if err != nil {
		values.Set("query", raw)
		return
	}
	for key, items := range parsed {
		for _, item := range items {
			values.Add(key, item)
		}
	}
}

func bodyFromFlags(flags cliargs.Flags) (map[string]any, error) {
	if data := flags.String("data", "body"); data != "" {
		value, err := parseJSONInput(data)
		if err != nil {
			return nil, err
		}
		object, ok := value.(map[string]any)
		if !ok {
			return nil, errors.New("--data must be a JSON object for this command")
		}
		return object, nil
	}
	return map[string]any{}, nil
}

func anyBodyFromFlags(flags cliargs.Flags) (any, error) {
	data := flags.String("data", "body")
	if data == "" {
		return nil, nil
	}
	return parseJSONInput(data)
}

func parseJSONInput(input string) (any, error) {
	text := input
	if strings.HasPrefix(input, "@") {
		data, err := os.ReadFile(strings.TrimPrefix(input, "@"))
		if err != nil {
			return nil, err
		}
		text = string(data)
	}
	var value any
	if err := json.Unmarshal([]byte(text), &value); err != nil {
		return nil, fmt.Errorf("invalid JSON input: %w", err)
	}
	return value, nil
}

func setBodyString(body map[string]any, key string, value string) {
	if value != "" {
		body[key] = value
	}
}

func setBodyJSON(body map[string]any, key string, value string) error {
	if value == "" {
		return nil
	}
	parsed, err := parseJSONInput(value)
	if err != nil {
		return err
	}
	body[key] = parsed
	return nil
}

func idArg(rest []string, flagValue string, label string) (string, error) {
	id := firstNonEmpty(flagValue, firstArg(rest))
	if id == "" {
		return "", fmt.Errorf("missing %s", label)
	}
	return client.PathEscape(id), nil
}

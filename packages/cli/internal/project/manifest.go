package project

import "os"

const DefaultLoop = "anthropic_claude_code"

var validLoops = map[string]bool{
	"anthropic_claude_code": true,
	"codex_open_source":     true,
}

func DefaultManifest(name string, loop string, runtime string) map[string]any {
	return map[string]any{
		"schema_version": 1,
		"name":           name,
		"version":        "0.1.0",
		"description":    name + " managed agent",
		"agent": map[string]any{
			"name":        name,
			"description": name + " managed agent",
			"model": map[string]any{
				"provider": "openai",
				"id":       "gpt-4.1-mini",
				"speed":    "standard",
			},
			"agent_loop":  map[string]any{"type": loop, "config": map[string]any{}, "hooks": []any{}},
			"system":      "You are a Maple managed agent. Use tools only when they provide concrete evidence.",
			"tools":       []any{map[string]any{"type": "agent_toolset", "configs": map[string]any{"read": true, "grep": true, "bash": true, "write": true}}},
			"mcp_servers": []any{},
			"skills":      []any{},
			"metadata":    map[string]any{"created_by": "maple"},
		},
		"environment":      environment(name, runtime),
		"harness":          map[string]any{"entry": "src/harness.mjs", "runtime": "node22", "hooks": []any{"beforeInvoke", "onEvent", "afterInvoke"}},
		"resources":        []any{},
		"vault_ids":        []any{},
		"memory_store_ids": []any{},
		"include":          []any{"src/**", "package.json", "maple.manifest.json"},
		"exclude":          []any{"node_modules/**", ".git/**", ".maple/build/**"},
		"metadata":         map[string]any{},
	}
}

func ValidLoop(loop string) bool {
	return validLoops[loop]
}

func ValidRuntime(runtime string) bool {
	return runtime == "e2b" || runtime == "local_docker" || runtime == "vefaas" || runtime == "aliyun_fc"
}

func environment(name string, runtime string) map[string]any {
	if runtime == "local_docker" {
		return map[string]any{
			"name": name + "-local-docker",
			"config": map[string]any{
				"type":       "local_docker",
				"sandbox":    map[string]any{"provider": "local_docker"},
				"image":      "node:22-bookworm",
				"networking": map[string]any{"mode": "limited", "allow_package_managers": true, "allow_mcp_servers": true},
			},
		}
	}
	if runtime == "vefaas" {
		return map[string]any{
			"name": name + "-vefaas",
			"config": map[string]any{
				"type": "vefaas",
				"sandbox": map[string]any{
					"provider": "vefaas",
					"vefaas": map[string]any{
						"function_id":    firstEnv("VEFAAS_SANDBOX_FUNCTION_ID", "MAPLE_VEFAAS_SANDBOX_FUNCTION_ID"),
						"gateway_url":    firstEnv("VEFAAS_SANDBOX_GATEWAY_URL", "MAPLE_VEFAAS_SANDBOX_GATEWAY_URL"),
						"workspace_path": "/workspace",
						"timeout_ms":     3600000,
					},
				},
			},
		}
	}
	if runtime == "aliyun_fc" {
		return map[string]any{
			"name": name + "-aliyun-fc",
			"config": map[string]any{
				"type": "aliyun_fc",
				"sandbox": map[string]any{
					"provider": "aliyun_fc",
					"aliyun_fc": map[string]any{
						"function_name":  firstEnv("ALIYUN_FC_FUNCTION_NAME", "MAPLE_ALIYUN_FC_FUNCTION_NAME"),
						"invoke_url":     firstEnv("ALIYUN_FC_INVOKE_URL", "MAPLE_ALIYUN_FC_INVOKE_URL"),
						"workspace_path": "/workspace",
						"timeout_ms":     3600000,
					},
				},
			},
		}
	}
	return map[string]any{
		"name": name + "-e2b",
		"config": map[string]any{
			"type": "e2b",
			"sandbox": map[string]any{
				"provider": "e2b",
				"e2b":      map[string]any{"template": "base", "workspace_path": "/workspace", "timeout_ms": 3600000},
			},
		},
	}
}

func firstEnv(names ...string) string {
	for _, name := range names {
		if value := os.Getenv(name); value != "" {
			return value
		}
	}
	return ""
}

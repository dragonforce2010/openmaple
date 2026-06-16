package cliargs

import "strings"

type Flags map[string]string

func Parse(args []string) (Flags, []string) {
	flags := Flags{}
	rest := []string{}
	for i := 0; i < len(args); i++ {
		item := args[i]
		if !strings.HasPrefix(item, "--") {
			rest = append(rest, item)
			continue
		}
		keyValue := strings.TrimPrefix(item, "--")
		if key, value, ok := strings.Cut(keyValue, "="); ok {
			flags[key] = value
			continue
		}
		if i+1 >= len(args) || strings.HasPrefix(args[i+1], "--") {
			flags[keyValue] = "true"
			continue
		}
		flags[keyValue] = args[i+1]
		i++
	}
	return flags, rest
}

func (f Flags) Bool(name string) bool {
	return f[name] == "true"
}

func (f Flags) String(names ...string) string {
	for _, name := range names {
		if value, ok := f[name]; ok {
			return value
		}
	}
	return ""
}

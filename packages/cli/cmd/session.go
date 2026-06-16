package cmd

import (
	"fmt"
	"time"
)

type sessionAPI interface {
	SessionDetail(string) (map[string]any, error)
}

func waitForSession(api sessionAPI, sessionID string, stream bool, quiet bool) (map[string]any, error) {
	seen := map[string]bool{}
	deadline := time.Now().Add(180 * time.Second)
	for time.Now().Before(deadline) {
		detail, err := api.SessionDetail(sessionID)
		if err != nil {
			return nil, err
		}
		for _, event := range asArray(detail["events"]) {
			item := asObject(event)
			id := asString(item["id"])
			if id != "" && seen[id] {
				continue
			}
			seen[id] = true
			eventType := asString(item["type"])
			if !quiet && (stream || eventType == "agent.message_delta") {
				fmt.Printf("%s: %s\n", eventType, eventText(item))
			}
		}
		if isTerminalDetail(detail) {
			if !quiet {
				fmt.Printf("status %s\n", asString(asObject(detail["session"])["status"]))
			}
			return detail, nil
		}
		time.Sleep(time.Second)
	}
	return nil, fmt.Errorf("Timed out waiting for session %s", sessionID)
}

func isTerminalDetail(detail map[string]any) bool {
	session := asObject(detail["session"])
	status := asString(session["status"])
	if status == "failed" || status == "terminated" {
		return true
	}
	if status != "idle" {
		return false
	}
	for _, event := range asArray(detail["events"]) {
		item := asObject(event)
		if asString(item["type"]) != "session.status_idle" {
			continue
		}
		if asString(asObject(item["payload"])["reason"]) != "runtime_ready" {
			return true
		}
	}
	return false
}

func eventText(event map[string]any) string {
	payload := asObject(event["payload"])
	for _, key := range []string{"text", "content", "name"} {
		if value := asString(payload[key]); value != "" {
			return value
		}
	}
	return ""
}

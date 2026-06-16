package client

import (
	"bufio"
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

type Client struct {
	baseURL string
	token   string
	http    *http.Client
}

type LoginResult struct {
	Body  map[string]any
	Token string
}

func New(baseURL string, token string) *Client {
	return &Client{
		baseURL: strings.TrimRight(baseURL, "/"),
		token:   token,
		http:    &http.Client{Timeout: 60 * time.Second},
	}
}

func (c *Client) Version() (map[string]any, error) {
	return c.Request("GET", "/v1/platform/version", nil, false)
}

func (c *Client) LoginLocal(email string, name string) (LoginResult, error) {
	body := map[string]any{"provider": "local", "email": email}
	if name != "" {
		body["name"] = name
	}
	req, err := c.newRequest("POST", "/v1/auth/login", body, false)
	if err != nil {
		return LoginResult{}, err
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return LoginResult{}, err
	}
	defer resp.Body.Close()
	parsed, err := parseResponse(resp)
	if err != nil {
		return LoginResult{}, err
	}
	for _, cookie := range resp.Cookies() {
		if cookie.Name == "maple_session" && cookie.Value != "" {
			c.token = cookie.Value
			return LoginResult{Body: parsed, Token: cookie.Value}, nil
		}
	}
	return LoginResult{}, errors.New("Login succeeded but did not return maple_session cookie.")
}

func (c *Client) Me() (map[string]any, error) {
	return c.Request("GET", "/v1/auth/me", nil, true)
}

func (c *Client) ListDeployments() (map[string]any, error) {
	return c.Request("GET", "/v1/deployments", nil, true)
}

func (c *Client) CreateDeployment(input map[string]any) (map[string]any, error) {
	return c.Request("POST", "/v1/deployments", input, true)
}

func (c *Client) InvokeDeployment(id string, input map[string]any) (map[string]any, error) {
	return c.Request("POST", "/v1/deployments/"+pathEscape(id)+"/invoke", input, true)
}

func (c *Client) RunDeployment(id string, input map[string]any) (map[string]any, error) {
	return c.Request("POST", "/v1/deployments/"+pathEscape(id)+"/run", input, true)
}

func (c *Client) ListDeploymentRuns(id string) (map[string]any, error) {
	return c.Request("GET", "/v1/deployments/"+pathEscape(id)+"/runs", nil, true)
}

func (c *Client) PauseDeployment(id string, input map[string]any) (map[string]any, error) {
	return c.Request("POST", "/v1/deployments/"+pathEscape(id)+"/pause", input, true)
}

func (c *Client) UnpauseDeployment(id string) (map[string]any, error) {
	return c.Request("POST", "/v1/deployments/"+pathEscape(id)+"/unpause", map[string]any{}, true)
}

func (c *Client) ArchiveDeployment(id string) (map[string]any, error) {
	return c.Request("POST", "/v1/deployments/"+pathEscape(id)+"/archive", map[string]any{}, true)
}

func (c *Client) SessionDetail(id string) (map[string]any, error) {
	return c.Request("GET", "/v1/sessions/"+pathEscape(id)+"/detail", nil, true)
}

func (c *Client) ListSkills() (map[string]any, error) {
	return c.Request("GET", "/v1/skills", nil, true)
}

func (c *Client) CreateSkill(input map[string]any) (map[string]any, error) {
	return c.Request("POST", "/v1/skills", input, true)
}

func (c *Client) SaveSkillFile(id string, path string, content string) (map[string]any, error) {
	body := map[string]any{"content": content}
	return c.Request("PUT", "/v1/skills/"+pathEscape(id)+"/files/"+pathEscapePath(path), body, true)
}

func (c *Client) Stream(method string, path string, body any, auth bool, w io.Writer) error {
	req, err := c.newRequest(method, path, body, auth)
	if err != nil {
		return err
	}
	streamClient := &http.Client{}
	resp, err := streamClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		_, err := parseResponse(resp)
		return err
	}
	scanner := bufio.NewScanner(resp.Body)
	for scanner.Scan() {
		if _, err := fmt.Fprintln(w, scanner.Text()); err != nil {
			return err
		}
	}
	return scanner.Err()
}

func (c *Client) Request(method string, path string, body any, auth bool) (map[string]any, error) {
	req, err := c.newRequest(method, path, body, auth)
	if err != nil {
		return nil, err
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	return parseResponse(resp)
}

func (c *Client) RequestBytes(method string, path string, body []byte, contentType string, auth bool) (map[string]any, error) {
	req, err := http.NewRequest(method, c.baseURL+path, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	req.Header.Set("Content-Type", contentType)
	c.authorize(req, auth)
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	return parseResponse(resp)
}

func (c *Client) newRequest(method string, path string, body any, auth bool) (*http.Request, error) {
	var reader io.Reader
	if body != nil {
		data, err := json.Marshal(body)
		if err != nil {
			return nil, err
		}
		reader = bytes.NewReader(data)
	}
	req, err := http.NewRequest(method, c.baseURL+path, reader)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	c.authorize(req, auth)
	return req, nil
}

func (c *Client) authorize(req *http.Request, auth bool) {
	if auth && c.token != "" {
		if strings.HasPrefix(c.token, "maple_sess_") {
			req.Header.Set("Cookie", "maple_session="+c.token)
		} else {
			req.Header.Set("X-Maple-API-Key", c.token)
		}
	}
}

func parseResponse(resp *http.Response) (map[string]any, error) {
	text, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	body := map[string]any{}
	if len(text) > 0 {
		if err := json.Unmarshal(text, &body); err != nil {
			body["raw"] = string(text)
		}
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		message := firstString(body, "message", "error", "raw")
		if message == "" {
			message = resp.Status
		}
		return body, fmt.Errorf("%s", message)
	}
	return body, nil
}

func firstString(body map[string]any, keys ...string) string {
	for _, key := range keys {
		if value, ok := body[key].(string); ok {
			return value
		}
	}
	return ""
}

func pathEscape(value string) string {
	replacer := strings.NewReplacer("/", "%2F", "?", "%3F", "#", "%23", " ", "%20")
	return replacer.Replace(value)
}

func PathEscape(value string) string {
	return pathEscape(value)
}

func pathEscapePath(value string) string {
	parts := strings.Split(value, "/")
	for i, part := range parts {
		parts[i] = pathEscape(part)
	}
	return strings.Join(parts, "/")
}

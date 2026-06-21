#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
env_file="${MAPLE_LOCAL_ENV_FILE:-$repo_root/.env.local}"
host_sessions_root="$repo_root/.managed-agents/sessions"

log() {
  printf '[openmaple setup] %s\n' "$*"
}

warn() {
  printf '[openmaple setup] warning: %s\n' "$*" >&2
}

die() {
  printf '[openmaple setup] error: %s\n' "$*" >&2
  exit 1
}

usage() {
  cat <<'EOF'
Usage: scripts/setup-local-docker.sh

Starts OpenMaple locally with Docker:
  - web console on http://127.0.0.1:8080/
  - API on http://127.0.0.1:27951/
  - MySQL on 127.0.0.1:3307

Optional overrides:
  MAPLE_WEB_PORT=8081
  MAPLE_API_PORT=27952
  MAPLE_MYSQL_HOST_PORT=3308
  MAPLE_DOCKER_IMAGE=node:22-bookworm
  MAPLE_SETUP_INSTALL_MISSING=false
  MAPLE_SETUP_IMPORT_MODEL_KEYS=true
  MAPLE_SEED_DEMO_DATA=true
EOF
}

have() {
  command -v "$1" >/dev/null 2>&1
}

is_macos() {
  [ "$(uname -s)" = "Darwin" ]
}

env_value() {
  local key="$1"
  local fallback="$2"
  if [ "${!key+x}" = "x" ] && [ -n "${!key}" ]; then
    printf '%s' "${!key}"
    return
  fi
  if [ ! -f "$env_file" ]; then
    printf '%s' "$fallback"
    return
  fi
  local value
  value="$(awk -F= -v key="$key" '$1 == key { value = substr($0, index($0, "=") + 1) } END { print value }' "$env_file")"
  if [ -n "$value" ]; then
    printf '%s' "$value"
  else
    printf '%s' "$fallback"
  fi
}

ensure_homebrew() {
  if have brew; then
    return
  fi
  if ! is_macos; then
    die "Homebrew auto-install is supported only on macOS. Install Docker manually, then rerun this script."
  fi
  if [ "${MAPLE_SETUP_INSTALL_MISSING:-true}" != "true" ]; then
    die "Homebrew is missing. Install it or rerun with MAPLE_SETUP_INSTALL_MISSING=true."
  fi
  log "Homebrew missing; installing Homebrew."
  NONINTERACTIVE=1 /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  if [ -x /opt/homebrew/bin/brew ]; then
    eval "$(/opt/homebrew/bin/brew shellenv)"
  elif [ -x /usr/local/bin/brew ]; then
    eval "$(/usr/local/bin/brew shellenv)"
  fi
}

ensure_docker_cli() {
  if have docker; then
    return
  fi
  if ! is_macos; then
    die "docker CLI is missing. Install Docker Engine or Docker Desktop, then rerun this script."
  fi
  ensure_homebrew
  log "Docker CLI/Desktop missing; installing Docker Desktop with Homebrew."
  brew install --cask docker
}

open_docker_desktop() {
  if ! is_macos; then
    return
  fi
  open -a Docker >/dev/null 2>&1 || true
}

wait_for_docker() {
  if docker info >/dev/null 2>&1; then
    return
  fi
  log "Docker daemon is not ready; starting Docker Desktop if available."
  open_docker_desktop
  local attempt
  for attempt in $(seq 1 90); do
    if docker info >/dev/null 2>&1; then
      return
    fi
    sleep 2
  done
  die "Docker daemon did not become ready. Start Docker Desktop and rerun this script."
}

compose_command() {
  if docker compose version >/dev/null 2>&1; then
    printf 'docker compose'
    return
  fi
  if have docker-compose && docker-compose version >/dev/null 2>&1; then
    printf 'docker-compose'
    return
  fi
  if is_macos; then
    ensure_homebrew
    log "Docker Compose missing; installing docker-compose with Homebrew."
    brew install docker-compose
  fi
  if docker compose version >/dev/null 2>&1; then
    printf 'docker compose'
    return
  fi
  if have docker-compose && docker-compose version >/dev/null 2>&1; then
    printf 'docker-compose'
    return
  fi
  die "Docker Compose is missing. Install the Docker Compose plugin, then rerun this script."
}

port_in_use() {
  local port="$1"
  if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    return 0
  fi
  docker ps --format '{{.Ports}}' | grep -E "(0\\.0\\.0\\.0:|\\[::\\]:|:::)$port->" >/dev/null 2>&1
}

pick_port() {
  local start="$1"
  local port="$start"
  while [ "$port" -lt "$((start + 100))" ]; do
    if ! port_in_use "$port"; then
      printf '%s' "$port"
      return
    fi
    port="$((port + 1))"
  done
  die "No free port found from $start to $((start + 99))."
}

write_env_file() {
  /bin/mkdir -p "$host_sessions_root"
  /bin/mkdir -p "$repo_root/config"
  if [ -f "$env_file" ]; then
    log "Using existing env file: $env_file"
    return
  fi
  local web_port api_port mysql_port
  web_port="${MAPLE_WEB_PORT:-$(pick_port 8080)}"
  api_port="${MAPLE_API_PORT:-$(pick_port 27951)}"
  mysql_port="${MAPLE_MYSQL_HOST_PORT:-$(pick_port 3307)}"
  local local_openai_api_key local_ark_api_key local_openai_base_url local_openai_model local_ark_model
  local_openai_api_key=""
  local_ark_api_key=""
  local_openai_base_url=""
  local_openai_model=""
  local_ark_model=""
  if [ "${MAPLE_SETUP_IMPORT_MODEL_KEYS:-false}" = "true" ]; then
    local_openai_api_key="${OPENAI_API_KEY:-}"
    local_ark_api_key="${ARK_API_KEY:-}"
    local_openai_base_url="${OPENAI_BASE_URL:-}"
    local_openai_model="${OPENAI_MODEL:-}"
    local_ark_model="${ARK_MODEL:-}"
  fi
  log "Creating minimal local env file: $env_file"
  {
    printf 'MAPLE_WEB_PORT=%s\n' "$web_port"
    printf 'MAPLE_API_PORT=%s\n' "$api_port"
    printf 'MAPLE_MYSQL_HOST_PORT=%s\n' "$mysql_port"
    printf 'MAPLE_WEB_BASE_URL=%s\n' "${MAPLE_WEB_BASE_URL:-http://127.0.0.1:$web_port}"
    printf 'MAPLE_MYSQL_DATABASE=%s\n' "${MAPLE_MYSQL_DATABASE:-maple}"
    printf 'MAPLE_MYSQL_USER=%s\n' "${MAPLE_MYSQL_USER:-root}"
    printf 'MAPLE_MYSQL_PASSWORD=%s\n' "${MAPLE_MYSQL_PASSWORD:-maple}"
    printf 'MAPLE_LOCAL_DOCKER_MODE=true\n'
    printf 'MAPLE_AGENT_RUNTIME_PROVIDER=local_docker\n'
    printf 'MAPLE_SANDBOX_PROVIDER=local_docker\n'
    printf 'MAPLE_DOCKER_IMAGE=%s\n' "${MAPLE_DOCKER_IMAGE:-node:22-bookworm}"
    printf 'MAPLE_DEV_LOGIN=true\n'
    printf 'MAPLE_DEV_API_KEY=%s\n' "${MAPLE_DEV_API_KEY:-maple_dev_key}"
    printf 'MAPLE_LOCAL_MODEL_CONFIG_FILE=%s\n' "${MAPLE_LOCAL_MODEL_CONFIG_FILE:-config/local-model.json}"
    printf 'MAPLE_SEED_DEMO_DATA=%s\n' "${MAPLE_SEED_DEMO_DATA:-false}"
    printf 'MAPLE_DOCKER_WORKSPACE_HOST_ROOT=%s\n' "$host_sessions_root"
    printf 'MAPLE_LOCAL_OPENAI_API_KEY=%s\n' "$local_openai_api_key"
    printf 'MAPLE_LOCAL_ARK_API_KEY=%s\n' "$local_ark_api_key"
    printf 'MAPLE_LOCAL_OPENAI_BASE_URL=%s\n' "$local_openai_base_url"
    printf 'MAPLE_LOCAL_OPENAI_MODEL=%s\n' "$local_openai_model"
    printf 'MAPLE_LOCAL_ARK_MODEL=%s\n' "$local_ark_model"
  } > "$env_file"
}

explain_local_model_config() {
  local configured_path model_config_file
  configured_path="$(env_value MAPLE_LOCAL_MODEL_CONFIG_FILE config/local-model.json)"
  if [[ "$configured_path" = /* ]]; then
    model_config_file="$configured_path"
  else
    model_config_file="$repo_root/$configured_path"
  fi
  if [ -f "$model_config_file" ]; then
    log "Using local model config: $model_config_file"
    return
  fi
  log "No local model config found; model pool starts empty."
  log "To enable a default model: cp config/local-model.example.json config/local-model.json, then fill model/base URL/API key env."
}

pull_runtime_image() {
  local image="$1"
  if docker image inspect "$image" >/dev/null 2>&1; then
    return
  fi
  log "Pulling local runtime image: $image"
  docker pull "$image"
}

wait_for_url() {
  local label="$1"
  local url="$2"
  local attempt
  for attempt in $(seq 1 90); do
    if curl -fsS "$url" >/dev/null 2>&1; then
      log "$label ready: $url"
      return
    fi
    sleep 2
  done
  die "$label did not become ready: $url"
}

import_demo_data() {
  local compose="$1"
  local enabled
  enabled="$(env_value MAPLE_SEED_DEMO_DATA false)"
  if [ "$enabled" != "true" ]; then
    log "Demo data import disabled. Set MAPLE_SEED_DEMO_DATA=true to seed demo tenants, users, agents, and sessions."
    return
  fi
  local sql_file="$repo_root/docker/local-demo-data.sql"
  if [ ! -f "$sql_file" ]; then
    die "Demo data SQL file missing: $sql_file"
  fi
  log "Importing local demo data from $sql_file"
  # shellcheck disable=SC2086
  $compose --env-file "$env_file" exec -T mysql sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" "$MYSQL_DATABASE"' < "$sql_file"
}

main() {
  cd "$repo_root"
  ensure_docker_cli
  wait_for_docker
  write_env_file
  explain_local_model_config

  local runtime_image
  runtime_image="$(env_value MAPLE_DOCKER_IMAGE node:22-bookworm)"
  pull_runtime_image "$runtime_image"

  local compose
  compose="$(compose_command)"
  log "Starting OpenMaple local Docker stack."
  # shellcheck disable=SC2086
  $compose --env-file "$env_file" up --build -d mysql api web

  local web_port api_port
  web_port="$(env_value MAPLE_WEB_PORT 8080)"
  api_port="$(env_value MAPLE_API_PORT 27951)"
  wait_for_url "API" "http://127.0.0.1:${api_port}/health"
  wait_for_url "Web console" "http://127.0.0.1:${web_port}/health"
  import_demo_data "$compose"

  printf '\nOpenMaple local Docker is ready.\n'
  printf 'Web console: http://127.0.0.1:%s/\n' "$web_port"
  printf 'Local login:  http://127.0.0.1:%s/?dev_login=1\n' "$web_port"
  printf 'API health:   http://127.0.0.1:%s/health\n' "$api_port"
  printf 'Env file:     %s\n\n' "$env_file"
  if [ "$(env_value MAPLE_SEED_DEMO_DATA false)" = "true" ]; then
    printf 'Demo login:   demo-admin@openmaple.local (local dev login, no password)\n\n'
  fi
  if is_macos; then
    open "http://127.0.0.1:${web_port}/?dev_login=1" >/dev/null 2>&1 || true
  fi
}

case "${1:-}" in
  -h|--help)
    usage
    exit 0
    ;;
  "")
    main
    ;;
  *)
    usage
    die "unknown argument: $1"
    ;;
esac

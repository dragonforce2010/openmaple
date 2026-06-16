#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import shutil
import ssl
import subprocess
import sys
import time
import urllib.request
import zipfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from deploy_vefaas_runtime import (
    DEFAULT_TEMPLATE_ID,
    DeployConfig,
    SignedOpenApiClient,
    VefaasDirectProvisioner,
    VolcengineApigApi,
    VolcengineVefaasApi,
    extract_system_url,
    load_project_env,
    parse_bool,
    parse_cloud_resource,
    put_zip_bytes,
    safe_json,
    timestamp,
    validate_name,
    zip_source_dir,
)


ROOT = Path(__file__).resolve().parents[2]
OUTPUT_ROOT = ROOT / "output"
BUN_VERSION = os.environ.get("MAPLE_VEFAAS_WEB_BUN_VERSION") or "1.3.14"
BUN_URL = f"https://github.com/oven-sh/bun/releases/download/bun-v{BUN_VERSION}/bun-linux-x64.zip"
BUN = shutil.which("bun") or "/Users/bytedance/.bun/bin/bun"
METHODS = ["POST", "GET", "PUT", "DELETE", "HEAD", "OPTIONS", "CONNECT"]
WEB_RUNTIME = os.environ.get("MAPLE_VEFAAS_WEB_RUNTIME") or os.environ.get("MAPLE_VEFAAS_RUNTIME") or "node20/v1"


@dataclass(frozen=True)
class FunctionPackage:
    role: str
    name: str
    source_dir: Path
    runtime: str = WEB_RUNTIME
    command: str = "./run.sh"
    port: int = 8000
    memory_mb: int = 2048
    cpu_strategy: str | None = "always"
    envs: dict[str, str] = field(default_factory=dict)


def main() -> None:
    load_project_env(ROOT)
    app_name = os.environ.get("MAPLE_VEFAAS_APP_NAME") or os.environ.get("MAPLE_VEFAAS_WEB_APP_NAME") or f"maple-app-{timestamp()}"
    validate_name(app_name, "application name")

    frontend = build_frontend_package(app_name)
    backend = build_backend_package(app_name)
    deploy_config = build_base_config(app_name)
    vefaas_api = VolcengineVefaasApi(deploy_config.access_key, deploy_config.secret_key, deploy_config.region)
    vefaas_app = SignedOpenApiClient(access_key=deploy_config.access_key, secret_key=deploy_config.secret_key, region=deploy_config.region)
    vefaas_release = SignedOpenApiClient(
        access_key=deploy_config.access_key,
        secret_key=deploy_config.secret_key,
        region=deploy_config.region,
        service="vefaas",
        version="2024-06-06",
    )
    apig_2021 = SignedOpenApiClient(
        access_key=deploy_config.access_key,
        secret_key=deploy_config.secret_key,
        region=deploy_config.region,
        service="apig",
        version="2021-03-03",
    )
    apig_2022 = SignedOpenApiClient(
        access_key=deploy_config.access_key,
        secret_key=deploy_config.secret_key,
        region=deploy_config.region,
        service="apig",
        version="2022-11-12",
    )
    provisioner = VefaasDirectProvisioner(
        vefaas_api=vefaas_api,
        openapi=vefaas_app,
        apig_api=VolcengineApigApi(deploy_config.access_key, deploy_config.secret_key, deploy_config.region),
    )

    frontend_function_id = create_function_with_code(vefaas_api, vefaas_app, deploy_config, frontend)
    backend_function_id = create_function_with_code(vefaas_api, vefaas_app, deploy_config, backend)
    backend_release = release_function(vefaas_release, backend_function_id, deploy_config)

    app_id = provisioner.create_application(deploy_config, frontend.name)
    vefaas_app.post("ReleaseApplication", {"Id": app_id})
    application = provisioner.wait_for_application(app_id, deploy_config)
    access_url = extract_system_url(application).rstrip("/")
    route_context = extract_route_context(application)

    backend_upstream_id = create_vefaas_upstream(apig_2021, route_context["gateway_id"], f"{app_name}-backend-us-{timestamp()}", backend_function_id)
    api_route_id = create_apig_route(apig_2022, route_context["service_id"], "api", "/v1", backend_upstream_id, priority=100)
    health_route_id = create_apig_route(apig_2022, route_context["service_id"], "health", "/health", backend_upstream_id, priority=100)

    print(
        safe_json(
            {
                "app_name": app_name,
                "app_id": app_id,
                "url": access_url,
                "region": deploy_config.region,
                "frontend": {
                    "function_name": frontend.name,
                    "function_id": frontend_function_id,
                    "package": str(frontend.source_dir),
                    "route": "/",
                },
                "backend": {
                    "function_name": backend.name,
                    "function_id": backend_function_id,
                    "package": str(backend.source_dir),
                    "release": backend_release,
                    "upstream_id": backend_upstream_id,
                    "routes": ["/v1", "/health"],
                    "route_ids": [api_route_id, health_route_id],
                },
                "gateway": route_context,
            }
        )
    )


def build_base_config(app_name: str) -> DeployConfig:
    access_key = os.environ.get("VOLCENGINE_ACCESS_KEY") or os.environ.get("VOLC_ACCESSKEY")
    secret_key = os.environ.get("VOLCENGINE_SECRET_KEY") or os.environ.get("VOLC_SECRETKEY")
    if not access_key or not secret_key:
        raise RuntimeError("missing VOLCENGINE_ACCESS_KEY/VOLCENGINE_SECRET_KEY in environment or project .env")
    region = os.environ.get("MAPLE_VEFAAS_REGION") or os.environ.get("VEFAAS_REGION") or "cn-beijing"
    return DeployConfig(
        access_key=access_key,
        secret_key=secret_key,
        region=region,
        app_name=app_name,
        function_name=f"{app_name}-frontend",
        gateway_name=os.environ.get("MAPLE_VEFAAS_GATEWAY_NAME") or os.environ.get("MAPLE_VEFAAS_WEB_GATEWAY_NAME") or None,
        gateway_service_name=os.environ.get("MAPLE_VEFAAS_GATEWAY_SERVICE_NAME") or os.environ.get("MAPLE_VEFAAS_WEB_GATEWAY_SERVICE_NAME") or None,
        gateway_upstream_name=os.environ.get("MAPLE_VEFAAS_GATEWAY_UPSTREAM_NAME") or os.environ.get("MAPLE_VEFAAS_WEB_GATEWAY_UPSTREAM_NAME") or None,
        template_id=os.environ.get("MAPLE_VEFAAS_APPLICATION_TEMPLATE_ID") or os.environ.get("MAPLE_VEFAAS_WEB_APPLICATION_TEMPLATE_ID") or DEFAULT_TEMPLATE_ID,
        runtime=WEB_RUNTIME,
        command="./run.sh",
        port=8000,
        cpu_strategy=os.environ.get("MAPLE_VEFAAS_CPU_STRATEGY") or "always",
        request_timeout=int(os.environ.get("MAPLE_VEFAAS_REQUEST_TIMEOUT_SECONDS") or os.environ.get("MAPLE_VEFAAS_WEB_REQUEST_TIMEOUT_SECONDS") or "1800"),
        memory_mb=int(os.environ.get("MAPLE_VEFAAS_FRONTEND_MEMORY_MB") or "1024"),
        enable_logs=parse_bool(os.environ.get("MAPLE_VEFAAS_ENABLE_LOGS") or os.environ.get("MAPLE_VEFAAS_WEB_ENABLE_LOGS") or "false"),
        tls_project_id=os.environ.get("MAPLE_VEFAAS_TLS_PROJECT_ID") or "",
        tls_topic_id=os.environ.get("MAPLE_VEFAAS_TLS_TOPIC_ID") or "",
        vpc_id="",
        subnet_ids=[],
        security_group_ids=[],
        enable_shared_internet_access=parse_optional_bool(os.environ.get("MAPLE_VEFAAS_ENABLE_SHARED_INTERNET_ACCESS") or "true"),
        enable_key_auth=False,
        enable_mcp_session=parse_bool(os.environ.get("MAPLE_VEFAAS_ENABLE_MCP_SESSION") or os.environ.get("MAPLE_VEFAAS_WEB_ENABLE_MCP_SESSION") or "false"),
        poll_interval_seconds=float(os.environ.get("MAPLE_VEFAAS_RELEASE_POLL_INTERVAL_SECONDS") or "10"),
        poll_timeout_seconds=float(os.environ.get("MAPLE_VEFAAS_RELEASE_TIMEOUT_SECONDS") or "900"),
        envs=frontend_envs(),
    )


def build_frontend_package(app_name: str) -> FunctionPackage:
    run([BUN, "run", "build"])
    package_dir = OUTPUT_ROOT / f"{app_name}-frontend-{timestamp()}"
    package_dir.mkdir(parents=True, exist_ok=False)
    shutil.copytree(ROOT / "dist", package_dir / "dist")
    copy_frontend_source(package_dir / "source")
    (package_dir / "server.mjs").write_text(frontend_server_source(), encoding="utf-8")
    (package_dir / "package.json").write_text(json.dumps({"name": f"{app_name}-frontend", "private": True}), encoding="utf-8")
    write_frontend_run_script(package_dir / "run.sh")
    return FunctionPackage(
        role="frontend",
        name=f"{app_name}-frontend",
        source_dir=package_dir,
        memory_mb=int(os.environ.get("MAPLE_VEFAAS_FRONTEND_MEMORY_MB") or "1024"),
        envs=frontend_envs(),
    )


def build_backend_package(app_name: str) -> FunctionPackage:
    package_dir = OUTPUT_ROOT / f"{app_name}-backend-{timestamp()}"
    package_dir.mkdir(parents=True, exist_ok=False)
    run([BUN, "build", "--target=node", "--packages=bundle", "--outfile", str(package_dir / "app.js"), str(ROOT / "apps/control-plane-api/src/index.ts")])
    run([BUN, "build", "--target=node", "--packages=bundle", "--outfile", str(package_dir / "mysql_child.mjs"), str(ROOT / "apps/control-plane-api/src/infra/mysql_child.mjs")])
    copy_backend_source(package_dir / "source")
    copy_source_dir(ROOT / "infra/vefaas", package_dir / "infra/vefaas")
    if (ROOT / "sandbox.config.json").exists():
        shutil.copy2(ROOT / "sandbox.config.json", package_dir / "sandbox.config.json")
    (package_dir / "package.json").write_text(json.dumps({"name": f"{app_name}-backend", "private": True}), encoding="utf-8")
    write_backend_run_script(package_dir / "run.sh")
    return FunctionPackage(
        role="backend",
        name=f"{app_name}-backend",
        source_dir=package_dir,
        memory_mb=int(os.environ.get("MAPLE_VEFAAS_BACKEND_MEMORY_MB") or "4096"),
        envs=backend_envs(),
    )


def copy_frontend_source(target: Path) -> None:
    target.mkdir(parents=True, exist_ok=False)
    for name in ["apps/admin-web/src"]:
        copy_source_dir(ROOT / name, target / name)
    for name in ["apps/admin-web/index.html", "apps/admin-web/vite.config.ts", "package.json", "bun.lock", "tsconfig.json"]:
        copy_source_file(ROOT / name, target / name)


def copy_backend_source(target: Path) -> None:
    target.mkdir(parents=True, exist_ok=False)
    for name in ["apps/control-plane-api/src", "packages/sdk", "packages/cli", "scripts"]:
        copy_source_dir(ROOT / name, target / name)
    for name in ["package.json", "bun.lock", "tsconfig.json", "sandbox.config.json"]:
        copy_source_file(ROOT / name, target / name)


def copy_source_dir(source: Path, target: Path) -> None:
    shutil.copytree(
        source,
        target,
        ignore=shutil.ignore_patterns("__pycache__", "*.pyc", ".DS_Store"),
    )


def copy_source_file(source: Path, target: Path) -> None:
    if source.exists():
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, target)


def create_function_with_code(vefaas_api: VolcengineVefaasApi, openapi: SignedOpenApiClient, config: DeployConfig, package: FunctionPackage) -> str:
    validate_name(package.name, f"{package.role} function name")
    function_id = vefaas_api.create_function(
        {
            "name": package.name,
            "description": f"managed-agents-platform {package.role}",
            "command": package.command,
            "port": package.port,
            "cpu_strategy": package.cpu_strategy,
            "instance_type": config.instance_type,
            "runtime": package.runtime,
            "request_timeout": config.request_timeout,
            "memory_mb": package.memory_mb,
            "tls_config": {
                "enable_log": config.enable_logs,
                "tls_project_id": config.tls_project_id,
                "tls_topic_id": config.tls_topic_id,
            },
            "vpc_config": vpc_config_for_role(config, package.role),
            "envs": package.envs,
            "tags": {"provider": "managed-agents-platform", "component": package.role},
        }
    )
    code_zip = zip_source_dir(package.source_dir)
    upload_url = vefaas_api.get_code_upload_address(function_id, len(code_zip))
    put_zip_bytes(upload_url, code_zip)
    openapi.post("CodeUploadCallback", {"FunctionId": function_id})
    return function_id


def vpc_config_for_role(config: DeployConfig, role: str) -> dict[str, Any]:
    if role == "frontend":
        return {
            "vpc_id": os.environ.get("MAPLE_VEFAAS_FRONTEND_VPC_ID") or os.environ.get("MAPLE_VEFAAS_VPC_ID") or os.environ.get("MAPLE_VEFAAS_WEB_VPC_ID") or config.vpc_id,
            "subnet_ids": csv_env("MAPLE_VEFAAS_FRONTEND_SUBNET_IDS") or csv_env("MAPLE_VEFAAS_SUBNET_IDS") or csv_env("MAPLE_VEFAAS_WEB_SUBNET_IDS") or config.subnet_ids,
            "security_group_ids": csv_env("MAPLE_VEFAAS_FRONTEND_SECURITY_GROUP_IDS") or csv_env("MAPLE_VEFAAS_SECURITY_GROUP_IDS") or csv_env("MAPLE_VEFAAS_WEB_SECURITY_GROUP_IDS") or config.security_group_ids,
            "enable_shared_internet_access": parse_optional_bool(
                os.environ.get("MAPLE_VEFAAS_FRONTEND_ENABLE_SHARED_INTERNET_ACCESS")
                or os.environ.get("MAPLE_VEFAAS_ENABLE_SHARED_INTERNET_ACCESS")
                or os.environ.get("MAPLE_VEFAAS_WEB_ENABLE_SHARED_INTERNET_ACCESS")
                or "true"
            ),
        }
    return {
        "vpc_id": os.environ.get("MAPLE_VEFAAS_BACKEND_VPC_ID") or os.environ.get("MAPLE_VEFAAS_VPC_ID") or os.environ.get("MAPLE_VEFAAS_WEB_VPC_ID") or config.vpc_id,
        "subnet_ids": csv_env("MAPLE_VEFAAS_BACKEND_SUBNET_IDS") or csv_env("MAPLE_VEFAAS_SUBNET_IDS") or csv_env("MAPLE_VEFAAS_WEB_SUBNET_IDS") or config.subnet_ids,
        "security_group_ids": csv_env("MAPLE_VEFAAS_BACKEND_SECURITY_GROUP_IDS") or csv_env("MAPLE_VEFAAS_SECURITY_GROUP_IDS") or csv_env("MAPLE_VEFAAS_WEB_SECURITY_GROUP_IDS") or config.security_group_ids,
        "enable_shared_internet_access": parse_optional_bool(
            os.environ.get("MAPLE_VEFAAS_BACKEND_ENABLE_SHARED_INTERNET_ACCESS")
            or os.environ.get("MAPLE_VEFAAS_ENABLE_SHARED_INTERNET_ACCESS")
            or os.environ.get("MAPLE_VEFAAS_WEB_ENABLE_SHARED_INTERNET_ACCESS")
            or "true"
        ),
    }


def release_function(openapi: SignedOpenApiClient, function_id: str, config: DeployConfig) -> dict[str, Any]:
    response = openapi.post(
        "Release",
        {
            "FunctionId": function_id,
            "RevisionNumber": 0,
            "TargetTrafficWeight": 100,
            "MaxInstance": int(os.environ.get("MAPLE_VEFAAS_BACKEND_MAX_INSTANCE") or "10"),
            "Description": "managed-agents-platform split backend release",
        },
    )
    record_id = str(response.get("Result", {}).get("ReleaseRecordId") or "")
    deadline = time.monotonic() + config.poll_timeout_seconds
    last: dict[str, Any] = response
    while time.monotonic() < deadline:
        last = openapi.post("GetReleaseStatus", {"FunctionId": function_id})
        result = last.get("Result", {})
        if result.get("Status") in {"done", "success", "succeeded"}:
            return {"release_record_id": record_id, "status": result.get("Status"), "stable_revision_number": result.get("StableRevisionNumber")}
        if result.get("Status") in {"failed", "fail"}:
            raise RuntimeError(f"backend function release failed: {safe_json(last)}")
        time.sleep(config.poll_interval_seconds)
    raise TimeoutError(f"backend function release timed out: {safe_json(last)}")


def extract_route_context(application: dict[str, Any]) -> dict[str, str]:
    cloud = parse_cloud_resource(application)
    triggers = cloud.get("framework", {}).get("triggers", [])
    if not triggers:
        raise RuntimeError(f"application has no APIG trigger: {safe_json(application)}")
    trigger = triggers[0]
    detailed = trigger.get("DetailedConfig") or {}
    routes = trigger.get("Routes") or []
    route = routes[0] if routes else {}
    gateway_id = detailed.get("GatewayId") or route.get("GatewayId") or ""
    service_id = route.get("ServiceId") or ""
    if not gateway_id or not service_id:
        raise RuntimeError(f"application trigger lacks gateway/service ids: {safe_json(trigger)}")
    return {
        "gateway_id": str(gateway_id),
        "service_id": str(service_id),
        "service_name": str(route.get("ServiceName") or trigger.get("ServiceName") or ""),
        "frontend_route_id": str(route.get("Id") or ""),
    }


def create_vefaas_upstream(openapi: SignedOpenApiClient, gateway_id: str, name: str, function_id: str) -> str:
    response = openapi.post(
        "CreateUpstream",
        {
            "GatewayId": gateway_id,
            "Name": name,
            "Protocol": "HTTP",
            "SourceType": "VeFaas",
            "UpstreamSpec": {"VeFaas": {"FunctionId": function_id}},
        },
    )
    upstream_id = response.get("Result", {}).get("Id")
    if not upstream_id:
        raise RuntimeError(f"CreateUpstream did not return id: {safe_json(response)}")
    return str(upstream_id)


def create_apig_route(openapi: SignedOpenApiClient, service_id: str, suffix: str, path: str, upstream_id: str, *, priority: int) -> str:
    response = openapi.post(
        "CreateRoute",
        {
            "Name": f"maple-{suffix}-{timestamp()}",
            "ServiceId": service_id,
            "ResourceType": "Console",
            "Enable": True,
            "Priority": priority,
            "UpstreamList": [{"UpstreamId": upstream_id, "Weight": 100}],
            "MatchRule": {"Path": {"MatchType": "Prefix" if path != "/health" else "Exact", "MatchContent": path}, "Method": METHODS},
            "AdvancedSetting": {"CorsPolicySetting": {"Enable": True}},
        },
    )
    route_id = response.get("Result", {}).get("Id")
    if not route_id:
        raise RuntimeError(f"CreateRoute did not return id: {safe_json(response)}")
    return str(route_id)


def frontend_envs() -> dict[str, str]:
    return {
        "NODE_ENV": "production",
        "HOST": "0.0.0.0",
    }


def backend_envs() -> dict[str, str]:
    agent_runtime_provider = (
        os.environ.get("MAPLE_VEFAAS_BACKEND_AGENT_RUNTIME_PROVIDER")
        or os.environ.get("MAPLE_AGENT_RUNTIME_PROVIDER")
        or "vefaas"
    )
    agent_loop_execution = (
        os.environ.get("MAPLE_VEFAAS_BACKEND_AGENT_LOOP_EXECUTION")
        or os.environ.get("MAPLE_AGENT_LOOP_EXECUTION")
        or "external"
    )
    # OAuth, web callbacks, SDK self-calls, and runtime tool bridge callbacks must resolve to
    # the public apigateway host, not the faas-internal request host or a local .env URL.
    public_base = (
        os.environ.get("MAPLE_VEFAAS_PUBLIC_BASE_URL")
        or "https://sd8ihq8v316pc5mf9c1j0.apigateway-cn-beijing.volceapi.com"
    ).rstrip("/")
    envs = {
        "NODE_ENV": "production",
        "SERVE_STATIC": "false",
        "HOST": "0.0.0.0",
        "MAPLE_DATA_DIR": "/tmp/maple-managed-agents",
        "MAPLE_SKILLS_ROOT": "/tmp/maple-skills",
        "MAPLE_AGENT_RUNTIME_PROVIDER": agent_runtime_provider,
        "MAPLE_AGENT_LOOP_EXECUTION": agent_loop_execution,
        "MAPLE_MYSQL_FORCE_HELPER": "true",
        "MAPLE_MYSQL_HELPER_COMMAND": "node",
        "MAPLE_MYSQL_HELPER_SCRIPT": "mysql_child.mjs",
        "MAPLE_MYSQL_HELPER_TIMEOUT_MS": os.environ.get("MAPLE_MYSQL_HELPER_TIMEOUT_MS") or "15000",
    }
    prefixes = ("MAPLE_", "VOLCENGINE_", "VOLC_", "E2B_", "VEFAAS_", "MYSQL_")
    keys = {"ARK_API_KEY", "OPENAI_API_KEY"}
    for key, value in os.environ.items():
        if key.startswith(prefixes) or key in keys:
            envs[key] = str(value)
    if os.environ.get("MAPLE_VEFAAS_BACKEND_MYSQL_HOST"):
        envs["MAPLE_MYSQL_HOST"] = str(os.environ["MAPLE_VEFAAS_BACKEND_MYSQL_HOST"])
    envs["SERVE_STATIC"] = "false"
    envs["MAPLE_AGENT_RUNTIME_PROVIDER"] = agent_runtime_provider
    envs["MAPLE_AGENT_LOOP_EXECUTION"] = agent_loop_execution
    envs["MAPLE_API_BASE_URL"] = public_base
    envs["MAPLE_CONTROL_PLANE_BASE_URL"] = public_base
    envs["MAPLE_RUNTIME_TOOL_BRIDGE_BASE_URL"] = public_base
    envs["MAPLE_LARK_CALLBACK_URL"] = f"{public_base}/v1/auth/oauth/lark_sso/callback"
    envs["MAPLE_WEB_BASE_URL"] = public_base
    envs["MAPLE_COOKIE_SECURE"] = "true"
    return envs


def frontend_server_source() -> str:
    return """import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('./dist/', import.meta.url));
const host = process.env.HOST || '0.0.0.0';
const port = Number(process.env.PORT || process.env._FAAS_RUNTIME_PORT || 8000);
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon'
};
function safePath(pathname) {
  const decoded = decodeURIComponent(pathname).replace(/^\\/+/, '') || 'index.html';
  const candidate = normalize(join(root, decoded));
  return candidate.startsWith(root) ? candidate : join(root, 'index.html');
}
createServer((request, response) => {
  const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
  let filePath = safePath(url.pathname);
  if (!existsSync(filePath) || statSync(filePath).isDirectory()) filePath = join(root, 'index.html');
  const ext = extname(filePath);
  response.writeHead(200, { 'content-type': mime[ext] || 'application/octet-stream' });
  createReadStream(filePath).pipe(response);
}).listen(port, host, () => {
  console.log(`Maple frontend listening on http://${host}:${port}`);
});
process.on('uncaughtException', (error) => {
  console.error(error);
  process.exit(1);
});
process.on('unhandledRejection', (error) => {
  console.error(error);
  process.exit(1);
});
"""


def write_frontend_run_script(path: Path) -> None:
    path.write_text(
        """#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
export HOST="${HOST:-0.0.0.0}"
export PORT="${_FAAS_RUNTIME_PORT:-${SERVER_PORT:-${PORT:-8000}}}"
exec node server.mjs
""",
        encoding="utf-8",
    )
    path.chmod(0o755)


def write_backend_run_script(path: Path) -> None:
    path.write_text(
        """#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
export HOST="${HOST:-0.0.0.0}"
export PORT="${_FAAS_RUNTIME_PORT:-${SERVER_PORT:-${PORT:-8000}}}"
export NODE_ENV="${NODE_ENV:-production}"
export SERVE_STATIC="${SERVE_STATIC:-false}"
export MAPLE_MYSQL_HELPER_COMMAND="${MAPLE_MYSQL_HELPER_COMMAND:-node}"
export MAPLE_MYSQL_HELPER_SCRIPT="${MAPLE_MYSQL_HELPER_SCRIPT:-mysql_child.mjs}"
export MAPLE_MYSQL_HELPER_TIMEOUT_MS="${MAPLE_MYSQL_HELPER_TIMEOUT_MS:-15000}"
exec node app.js
""",
        encoding="utf-8",
    )
    path.chmod(0o755)


def run(args: list[str]) -> None:
    env = {**os.environ, "PATH": f"{Path(BUN).parent}:{os.environ.get('PATH', '')}"}
    subprocess.run(args, cwd=ROOT, check=True, env=env)


def download_bun(path: Path) -> None:
    context = ssl.create_default_context(cafile=os.environ.get("SSL_CERT_FILE") or certifi_path())
    with urllib.request.urlopen(BUN_URL, timeout=120, context=context) as response:
        archive_path = path.with_suffix(".zip")
        archive_path.write_bytes(response.read())
    with zipfile.ZipFile(archive_path) as archive:
        member = next(name for name in archive.namelist() if name.endswith("/bun"))
        path.write_bytes(archive.read(member))
    path.chmod(0o755)
    archive_path.unlink()


def certifi_path() -> str | None:
    try:
        import certifi

        return certifi.where()
    except Exception:
        return None


def parse_optional_bool(value: str | None) -> bool | None:
    if value is None or value == "":
        return None
    return parse_bool(value)


def csv_env(key: str) -> list[str]:
    return [part.strip() for part in (os.environ.get(key) or "").split(",") if part.strip()]


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(error, file=sys.stderr)
        sys.exit(1)

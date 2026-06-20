#!/usr/bin/env python3
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import subprocess
import time
from dataclasses import replace
from pathlib import Path
from typing import Any
from urllib.parse import unquote

import deploy_vefaas_application as app_deploy
from deploy_vefaas_runtime import (
    DeployConfig,
    SignedOpenApiClient,
    VolcengineApigApi,
    VolcengineVefaasApi,
    extract_system_url,
    load_project_env,
    parse_cloud_resource,
    put_zip_bytes,
    safe_json,
    timestamp,
    to_plain_dict,
    zip_source_dir,
)


ROOT = Path(__file__).resolve().parents[2]
DEFAULT_STATE_PATH = ROOT / "output" / "vefaas" / "stable-deployment.json"
READY_TIMEOUT_SECONDS = 240
PROBE_ATTEMPTS = 3
PROBE_TIMEOUT_SECONDS = 20
PROBE_RETRY_SECONDS = 2
RESOURCE_UPDATE_TIMEOUT_SECONDS = 300
RESOURCE_UPDATE_RETRY_SECONDS = 10


def main() -> int:
    parser = argparse.ArgumentParser(description="Stable veFaaS deploy/update for Maple frontend and backend.")
    parser.add_argument("mode", choices=["bootstrap", "deploy", "status"], help="bootstrap creates once; deploy only updates recorded resources; status is read-only")
    parser.add_argument("--state", default=os.environ.get("MAPLE_VEFAAS_DEPLOYMENT_STATE") or str(DEFAULT_STATE_PATH))
    parser.add_argument("--min-instance", type=int, default=int(os.environ.get("MAPLE_VEFAAS_STABLE_MIN_INSTANCE") or "1"))
    parser.add_argument("--max-instance", type=int, default=int(os.environ.get("MAPLE_VEFAAS_STABLE_MAX_INSTANCE") or "10"))
    args = parser.parse_args()

    load_project_env(ROOT)
    state_path = Path(args.state).expanduser()
    os.environ["MAPLE_VEFAAS_DEPLOYMENT_STATE"] = str(state_path)
    clients = build_clients()

    if args.mode == "bootstrap":
        if state_path.exists():
            raise SystemExit(f"state file already exists, refusing to create new resources: {state_path}")
        state = bootstrap(state_path, clients, args.min_instance, args.max_instance)
    elif args.mode == "deploy":
        state = load_state_or_exit(state_path)
        state = deploy_update(state, state_path, clients, args.min_instance, args.max_instance)
    else:
        state = load_state_or_exit(state_path)
        state = refresh_state(state, clients, args.min_instance, args.max_instance, include_probe=True)

    print(safe_json(public_summary(state)))
    assert_probes_ok(state.get("probe") or {})
    return 0


def build_clients() -> dict[str, Any]:
    access_key = os.environ.get("VOLCENGINE_ACCESS_KEY") or os.environ.get("VOLC_ACCESSKEY")
    secret_key = os.environ.get("VOLCENGINE_SECRET_KEY") or os.environ.get("VOLC_SECRETKEY")
    if not access_key or not secret_key:
        raise RuntimeError("missing VOLCENGINE_ACCESS_KEY/VOLCENGINE_SECRET_KEY in environment or project .env")
    region = os.environ.get("MAPLE_VEFAAS_REGION") or os.environ.get("VEFAAS_REGION") or "cn-beijing"
    return {
        "region": region,
        "vefaas_api": VolcengineVefaasApi(access_key, secret_key, region),
        "app": SignedOpenApiClient(access_key=access_key, secret_key=secret_key, region=region),
        "release": SignedOpenApiClient(access_key=access_key, secret_key=secret_key, region=region, service="vefaas", version="2024-06-06"),
        "apig_2021": SignedOpenApiClient(access_key=access_key, secret_key=secret_key, region=region, service="apig", version="2021-03-03"),
        "apig_2022": SignedOpenApiClient(access_key=access_key, secret_key=secret_key, region=region, service="apig", version="2022-11-12"),
        "apig_api": VolcengineApigApi(access_key, secret_key, region),
    }


def bootstrap(state_path: Path, clients: dict[str, Any], min_instance: int, max_instance: int) -> dict[str, Any]:
    app_name = os.environ.get("MAPLE_VEFAAS_STABLE_APP_NAME") or os.environ.get("MAPLE_VEFAAS_APP_NAME") or f"maple-stable-{timestamp()}"
    os.environ.setdefault("MAPLE_VEFAAS_APP_NAME", app_name)
    os.environ.setdefault("MAPLE_VEFAAS_WEB_ENABLE_MCP_SESSION", "false")
    config = app_deploy.build_base_config(app_name)
    frontend = app_deploy.build_frontend_package(app_name)
    backend = app_deploy.build_backend_package(app_name)

    frontend_function_id = existing_function_id(clients, frontend.name)
    backend_function_id = existing_function_id(clients, backend.name)
    if frontend_function_id:
        update_existing_function(clients, frontend_function_id, config, frontend)
    else:
        frontend_function_id = app_deploy.create_function_with_code(clients["vefaas_api"], clients["app"], config, frontend)
        app_deploy.release_function(clients["release"], frontend_function_id, config)
    if backend_function_id:
        update_existing_function(clients, backend_function_id, config, backend)
    else:
        backend_function_id = app_deploy.create_function_with_code(clients["vefaas_api"], clients["app"], config, backend)
        app_deploy.release_function(clients["release"], backend_function_id, config)
    ensure_resource(clients, frontend_function_id, min_instance, max_instance)
    ensure_resource(clients, backend_function_id, min_instance, max_instance)

    gateway = choose_gateway(clients, config)
    configured_service_id = os.environ.get("MAPLE_VEFAAS_STABLE_SERVICE_ID") or ""
    if configured_service_id:
        service = find_gateway_service_by_id(clients, str(gateway["id"]), configured_service_id)
        if not service:
            raise RuntimeError(f"configured APIG service was not found: {configured_service_id}")
    else:
        service = ensure_gateway_service(clients, str(gateway["id"]), config.gateway_service_name or f"{app_name}-svc")
    service_id = str(service["id"])
    url = service_url(service)
    if configured_service_id:
        frontend_route = must_find_route(clients, service_id, "/")
        api_route = must_find_route(clients, service_id, "/v1")
        health_route = must_find_route(clients, service_id, "/health")
        frontend_upstream_id = first_upstream_id(frontend_route)
        backend_upstream_id = first_upstream_id(api_route)
        frontend_route_id = str(frontend_route["id"])
        api_route_id = str(api_route["id"])
        health_route_id = str(health_route["id"])
    else:
        frontend_upstream_id = ensure_upstream(clients, str(gateway["id"]), f"{app_name}-frontend-us", frontend_function_id)
        backend_upstream_id = ensure_upstream(clients, str(gateway["id"]), f"{app_name}-backend-us", backend_function_id)
        frontend_route_id = ensure_route(clients, service_id, "frontend", "/", frontend_upstream_id, priority=100)
        api_route_id = ensure_route(clients, service_id, "api", "/v1", backend_upstream_id, priority=100)
        health_route_id = ensure_route(clients, service_id, "health", "/health", backend_upstream_id, priority=100)
    route_context = {
        "gateway_id": str(gateway["id"]),
        "gateway_name": str(gateway.get("name") or config.gateway_name or ""),
        "service_id": service_id,
        "service_name": str(service.get("name") or service.get("service_name") or ""),
        "frontend_route_id": frontend_route_id,
    }

    state: dict[str, Any] = {
        "schema_version": 1,
        "managed_by": "infra/vefaas/deploy_vefaas_stable.py",
        "app_name": app_name,
        "app_id": "",
        "deployment_mode": "direct_apig_stable",
        "url": url,
        "region": config.region,
        "gateway": route_context,
        "frontend": {
            "function_id": frontend_function_id,
            "function_name": frontend.name,
            "upstream_id": frontend_upstream_id,
            "route_id": route_context["frontend_route_id"],
            "route_path": "/",
        },
        "backend": {
            "function_id": backend_function_id,
            "function_name": backend.name,
            "upstream_id": backend_upstream_id,
            "route_ids": {"api": api_route_id, "health": health_route_id},
            "route_paths": ["/v1", "/health"],
        },
        "policy": {
            "reuse_only_after_bootstrap": True,
            "no_delete": True,
            "no_stop": True,
            "min_instance": min_instance,
            "max_instance": max_instance,
        },
    }
    state = refresh_state(state, clients, min_instance, max_instance, include_probe=True)
    write_state(state_path, state)
    return state


def deploy_update(state: dict[str, Any], state_path: Path, clients: dict[str, Any], min_instance: int, max_instance: int) -> dict[str, Any]:
    app_name = str(state["app_name"])
    os.environ.setdefault("MAPLE_VEFAAS_APP_NAME", app_name)
    os.environ.setdefault("MAPLE_VEFAAS_WEB_ENABLE_MCP_SESSION", "false")
    config = app_deploy.build_base_config(app_name)
    frontend = app_deploy.build_frontend_package(app_name)
    backend = app_deploy.build_backend_package(app_name)

    update_existing_function(clients, state["frontend"]["function_id"], config, frontend)
    update_existing_function(clients, state["backend"]["function_id"], config, backend)
    ensure_resource(clients, state["frontend"]["function_id"], min_instance, max_instance)
    ensure_resource(clients, state["backend"]["function_id"], min_instance, max_instance)
    state = refresh_state(state, clients, min_instance, max_instance, include_probe=True)
    write_state(state_path, state)
    return state


def update_existing_function(clients: dict[str, Any], function_id: str, config: DeployConfig, package: app_deploy.FunctionPackage) -> None:
    package = with_existing_envs(clients["vefaas_api"], function_id, package)
    update_function_config(clients["vefaas_api"], function_id, config, package)
    code_zip = zip_source_dir(package.source_dir)
    upload_url = clients["vefaas_api"].get_code_upload_address(function_id, len(code_zip))
    put_zip_bytes(upload_url, code_zip)
    clients["app"].post("CodeUploadCallback", {"FunctionId": function_id})
    app_deploy.release_function(clients["release"], function_id, config)


def with_existing_envs(api: VolcengineVefaasApi, function_id: str, package: app_deploy.FunctionPackage) -> app_deploy.FunctionPackage:
    existing = function_envs(api, function_id)
    if not existing:
        return package
    # Stable updates replace the whole env list. Preserve live secrets when CI lacks them.
    merged = {**existing, **{key: value for key, value in package.envs.items() if value != ""}}
    return replace(package, envs=merged)


def function_envs(api: VolcengineVefaasApi, function_id: str) -> dict[str, str]:
    if getattr(api, "openapi", None):
        data = api.openapi.post("GetFunction", {"Id": function_id}).get("Result", {})
    else:
        sdk = api.sdk
        data = to_plain_dict(api.client.get_function(sdk.GetFunctionRequest(id=function_id)))
    envs = data.get("envs") or data.get("Envs") or []
    result: dict[str, str] = {}
    for item in envs:
        key = str((item.get("key") if isinstance(item, dict) else getattr(item, "key", "")) or (item.get("Key") if isinstance(item, dict) else ""))
        value = str((item.get("value") if isinstance(item, dict) else getattr(item, "value", "")) or (item.get("Value") if isinstance(item, dict) else ""))
        if key:
            result[key] = value
    return result


def update_function_config(api: VolcengineVefaasApi, function_id: str, config: DeployConfig, package: app_deploy.FunctionPackage) -> None:
    raw_vpc = app_deploy.vpc_config_for_role(config, package.role)
    if getattr(api, "openapi", None):
        body: dict[str, Any] = {
            "Id": function_id,
            "Description": f"managed-agents-platform {package.role}",
            "Command": package.command,
            "Port": package.port,
            "RequestTimeout": config.request_timeout,
            "MemoryMB": package.memory_mb,
            "Envs": [{"Key": key, "Value": value} for key, value in sorted(package.envs.items())],
            "Tags": [
                {"Key": "provider", "Value": "managed-agents-platform"},
                {"Key": "component", "Value": package.role},
            ],
            "TlsConfig": {
                "EnableLog": bool(config.enable_logs),
                "TlsProjectId": config.tls_project_id or None,
                "TlsTopicId": config.tls_topic_id or None,
            },
        }
        if raw_vpc.get("vpc_id"):
            body["VpcConfig"] = {
                "EnableVpc": True,
                "EnableSharedInternetAccess": raw_vpc.get("enable_shared_internet_access"),
                "VpcId": raw_vpc.get("vpc_id"),
                "SubnetIds": raw_vpc.get("subnet_ids") or None,
                "SecurityGroupIds": raw_vpc.get("security_group_ids") or None,
            }
        api.openapi.post("UpdateFunction", body)
        return

    sdk = api.sdk
    envs = [sdk.EnvForUpdateFunctionInput(key=key, value=value) for key, value in sorted(package.envs.items())]
    tags = [
        sdk.TagForUpdateFunctionInput(key="provider", value="managed-agents-platform"),
        sdk.TagForUpdateFunctionInput(key="component", value=package.role),
    ]
    tls_config = sdk.TlsConfigForUpdateFunctionInput(
        enable_log=bool(config.enable_logs),
        tls_project_id=config.tls_project_id or None,
        tls_topic_id=config.tls_topic_id or None,
    )
    vpc_config = None
    if raw_vpc.get("vpc_id"):
        vpc_config = sdk.VpcConfigForUpdateFunctionInput(
            enable_vpc=True,
            enable_shared_internet_access=raw_vpc.get("enable_shared_internet_access"),
            vpc_id=raw_vpc.get("vpc_id"),
            subnet_ids=raw_vpc.get("subnet_ids") or None,
            security_group_ids=raw_vpc.get("security_group_ids") or None,
        )
    api.client.update_function(
        sdk.UpdateFunctionRequest(
            id=function_id,
            description=f"managed-agents-platform {package.role}",
            command=package.command,
            port=package.port,
            request_timeout=config.request_timeout,
            memory_mb=package.memory_mb,
            envs=envs,
            tags=tags,
            tls_config=tls_config,
            vpc_config=vpc_config,
        )
    )


def existing_function_id(clients: dict[str, Any], function_name: str) -> str:
    sdk = clients["vefaas_api"].sdk
    for page in range(1, 20):
        response = clients["vefaas_api"].client.list_functions(sdk.ListFunctionsRequest(page_number=page, page_size=50))
        items = to_plain_dict(response).get("items") or []
        for item in items:
            record = to_plain_dict(item)
            if record.get("name") == function_name:
                return str(record.get("id") or "")
        if len(items) < 50:
            break
    return ""


def ensure_resource(clients: dict[str, Any], function_id: str, min_instance: int, max_instance: int) -> None:
    deadline = time.monotonic() + RESOURCE_UPDATE_TIMEOUT_SECONDS
    while True:
        try:
            clients["vefaas_api"].update_function_resource(function_id, min_instance, max_instance)
            return
        except Exception as error:
            if not is_function_deploying_error(error) or time.monotonic() >= deadline:
                raise
            time.sleep(RESOURCE_UPDATE_RETRY_SECONDS)


def is_function_deploying_error(error: Exception) -> bool:
    message = str(error).lower()
    return "invalidoperation" in message and "is deploying" in message


def choose_gateway(clients: dict[str, Any], config: DeployConfig) -> dict[str, Any]:
    preferred = config.gateway_name or os.environ.get("MAPLE_VEFAAS_STABLE_GATEWAY_NAME") or "hello-world-gateway"
    for gateway in clients["apig_api"].list_gateways():
        if gateway.get("type") == "serverless" and gateway.get("status") == "Running" and gateway.get("name") == preferred:
            return gateway
    fallback = clients["apig_api"].find_running_serverless_gateway(preferred_name=None)
    if not fallback:
        raise RuntimeError("no running serverless APIG gateway found; stable bootstrap refuses to create a new gateway automatically")
    return fallback


def ensure_gateway_service(clients: dict[str, Any], gateway_id: str, service_name: str) -> dict[str, Any]:
    existing = find_gateway_service(clients, gateway_id, service_name)
    if existing:
        return existing
    sdk = clients["apig_api"].sdk
    response = clients["apig_api"].client.create_gateway_service(
        sdk.CreateGatewayServiceRequest(
            gateway_id=gateway_id,
            service_name=service_name,
            protocol=["HTTP", "HTTPS"],
            auth_spec=sdk.AuthSpecForCreateGatewayServiceInput(enable=False),
            comments="managed-agents-platform stable frontend/backend service",
        ),
        async_req=True,
    ).get()
    created = to_plain_dict(response)
    service_id = created.get("id") or created.get("Id")
    if not service_id:
        raise RuntimeError(f"CreateGatewayService did not return id: {safe_json(created)}")
    return wait_gateway_service(clients, str(service_id))


def find_gateway_service(clients: dict[str, Any], gateway_id: str, service_name: str) -> dict[str, Any] | None:
    for page in range(1, 20):
        data = clients["apig_2021"].post("ListGatewayServices", {"GatewayId": gateway_id, "PageNumber": page, "PageSize": 50}).get("Result", {})
        items = data.get("Items") or []
        for item in items:
            if item.get("Name") == service_name:
                return normalize_gateway_service(item)
        if len(items) < 50:
            break
    return None


def find_gateway_service_by_id(clients: dict[str, Any], gateway_id: str, service_id: str) -> dict[str, Any] | None:
    for page in range(1, 20):
        data = clients["apig_2021"].post("ListGatewayServices", {"GatewayId": gateway_id, "PageNumber": page, "PageSize": 50}).get("Result", {})
        items = data.get("Items") or []
        for item in items:
            if item.get("Id") == service_id:
                return normalize_gateway_service(item)
        if len(items) < 50:
            break
    return None


def wait_gateway_service(clients: dict[str, Any], service_id: str) -> dict[str, Any]:
    sdk = clients["apig_api"].sdk
    deadline = time.monotonic() + 180
    last: dict[str, Any] = {}
    while time.monotonic() < deadline:
        response = clients["apig_api"].client.get_gateway_service(sdk.GetGatewayServiceRequest(id=service_id), async_req=True).get()
        last = normalize_gateway_service(to_plain_dict(response).get("gateway_service") or to_plain_dict(response))
        if last.get("status") == "Running" or last.get("Status") == "Running":
            return last
        time.sleep(5)
    raise TimeoutError(f"gateway service did not become Running: {safe_json(last)}")


def normalize_gateway_service(service: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": service.get("Id") or service.get("id"),
        "name": service.get("Name") or service.get("name") or service.get("ServiceName") or service.get("service_name"),
        "status": service.get("Status") or service.get("status"),
        "domains": service.get("Domains") or service.get("domains") or [],
    }


def service_url(service: dict[str, Any]) -> str:
    for domain in service.get("domains") or []:
        value = str(domain.get("Domain") or domain.get("domain") or "")
        if value.startswith("https://"):
            return value.rstrip("/")
    service_id = service.get("id")
    if not service_id:
        raise RuntimeError(f"gateway service has no public domain or id: {safe_json(service)}")
    return f"https://{service_id}.apigateway-cn-beijing.volceapi.com"


def ensure_upstream(clients: dict[str, Any], gateway_id: str, name: str, function_id: str) -> str:
    existing = find_upstream(clients, gateway_id, name)
    if existing:
        return str(existing["id"])
    sdk = clients["apig_api"].sdk
    response = clients["apig_api"].client.create_upstream(
        sdk.CreateUpstreamRequest(
            gateway_id=gateway_id,
            name=name,
            protocol="HTTP",
            source_type="VeFaas",
            upstream_spec=sdk.UpstreamSpecForCreateUpstreamInput(ve_faas=sdk.VeFaasForCreateUpstreamInput(function_id=function_id)),
        ),
        async_req=True,
    ).get()
    data = to_plain_dict(response)
    upstream_id = data.get("id") or data.get("Id")
    if not upstream_id:
        raise RuntimeError(f"CreateUpstream did not return id: {safe_json(data)}")
    return str(upstream_id)


def find_upstream(clients: dict[str, Any], gateway_id: str, name: str) -> dict[str, Any] | None:
    for page in range(1, 20):
        data = clients["apig_2021"].post("ListUpstreams", {"GatewayId": gateway_id, "PageNumber": page, "PageSize": 50}).get("Result", {})
        items = data.get("Items") or data.get("Upstreams") or []
        for item in items:
            if item.get("Name") == name:
                return {"id": item.get("Id"), "name": item.get("Name")}
        if len(items) < 50:
            break
    return None


def ensure_route(clients: dict[str, Any], service_id: str, suffix: str, path: str, upstream_id: str, *, priority: int) -> str:
    route = find_route(clients, service_id, path)
    if route:
        return str(route["id"])
    return app_deploy.create_apig_route(clients["apig_2022"], service_id, suffix, path, upstream_id, priority=priority)


def find_route(clients: dict[str, Any], service_id: str, path: str) -> dict[str, Any] | None:
    for route in route_summary(clients["apig_2022"], service_id):
        match = route.get("match_rule") or {}
        if (match.get("Path") or {}).get("MatchContent") == path:
            return route
    return None


def must_find_route(clients: dict[str, Any], service_id: str, path: str) -> dict[str, Any]:
    route = find_route(clients, service_id, path)
    if not route:
        raise RuntimeError(f"route not found in service {service_id}: {path}")
    return route


def refresh_state(state: dict[str, Any], clients: dict[str, Any], min_instance: int, max_instance: int, *, include_probe: bool) -> dict[str, Any]:
    now = dt.datetime.now(dt.timezone(dt.timedelta(hours=8))).isoformat(timespec="seconds")
    state["updated_at"] = now
    state["policy"] = {**state.get("policy", {}), "min_instance": min_instance, "max_instance": max_instance}
    if state.get("app_id"):
        app = clients["app"].post("GetApplication", {"Id": state["app_id"]}).get("Result", {})
        state["application"] = {
            "id": app.get("Id"),
            "name": app.get("Name"),
            "status": app.get("Status"),
            "template_id": app.get("TemplateId"),
            "config": app.get("Config"),
        }
    else:
        state["application"] = {"status": "not_used", "mode": state.get("deployment_mode")}
    for role in ["frontend", "backend"]:
        function_id = state[role]["function_id"]
        state[role]["function"] = describe_function(clients, function_id)
        state[role]["release"] = release_status(clients, function_id)
        state[role]["instances"] = function_instances(clients, function_id)
        state[role]["resource"] = function_resource(clients, function_id)
    state["routes"] = route_summary(clients["apig_2022"], state["gateway"]["service_id"])
    if include_probe:
        state["probe"] = probe_urls(state["url"])
    return state


def describe_function(clients: dict[str, Any], function_id: str) -> dict[str, Any]:
    api = clients["vefaas_api"]
    if getattr(api, "openapi", None):
        data = api.openapi.post("GetFunction", {"Id": function_id}).get("Result", {})
    else:
        sdk = api.sdk
        data = to_plain_dict(api.client.get_function(sdk.GetFunctionRequest(id=function_id)))
    envs = data.pop("envs", None) or data.pop("Envs", None) or []
    data["env_keys"] = sorted(str((item.get("key") if isinstance(item, dict) else getattr(item, "key", "")) or (item.get("Key") if isinstance(item, dict) else "")) for item in envs)
    for key in list(data.keys()):
        if key.lower() in {"source_access_config", "credentials"}:
            data[key] = "******"
    return data


def release_status(clients: dict[str, Any], function_id: str) -> dict[str, Any]:
    return clients["release"].post("GetReleaseStatus", {"FunctionId": function_id}).get("Result", {})


def function_instances(clients: dict[str, Any], function_id: str) -> list[dict[str, Any]]:
    data = clients["release"].post("ListFunctionInstances", {"FunctionId": function_id}).get("Result", {})
    return data.get("Items") or []


def function_resource(clients: dict[str, Any], function_id: str) -> dict[str, Any]:
    api = clients["vefaas_api"]
    try:
        if getattr(api, "openapi", None):
            return api.openapi.post("GetFunctionResource", {"FunctionId": function_id}).get("Result", {})
        sdk = api.sdk
        return to_plain_dict(api.client.get_function_resource(sdk.GetFunctionResourceRequest(function_id=function_id)))
    except Exception as error:
        return {"error": str(error)[:300]}


def route_summary(apig: SignedOpenApiClient, service_id: str) -> list[dict[str, Any]]:
    data = apig.post("ListRoutes", {"ServiceId": service_id, "PageNumber": 1, "PageSize": 50}).get("Result", {})
    routes = data.get("Items") or data.get("Routes") or []
    return [
        {
            "id": route.get("Id"),
            "name": route.get("Name"),
            "enable": route.get("Enable"),
            "priority": route.get("Priority"),
            "match_rule": route.get("MatchRule"),
            "upstream_list": route.get("UpstreamList"),
        }
        for route in routes
    ]


def get_route_by_id(apig: SignedOpenApiClient, service_id: str, route_id: str) -> dict[str, Any]:
    for route in route_summary(apig, service_id):
        if route.get("id") == route_id:
            return route
    raise RuntimeError(f"route not found in service {service_id}: {route_id}")


def first_upstream_id(route: dict[str, Any]) -> str:
    upstreams = route.get("upstream_list") or route.get("UpstreamList") or []
    if not upstreams:
        return ""
    return str(upstreams[0].get("UpstreamId") or upstreams[0].get("id") or "")


def probe_urls(base_url: str) -> dict[str, Any]:
    probes: dict[str, Any] = {}
    paths = {"frontend": "/?dev_login=1", "health": "/health", "providers": "/v1/auth/providers", "auth_bootstrap": "/v1/auth/bootstrap"}
    for name, path in paths.items():
        url = f"{base_url.rstrip('/')}{path}"
        probes[name] = probe_url(url)
    probes["auth_bootstrap_stale_cookie"] = probe_url(f"{base_url.rstrip('/')}/v1/auth/bootstrap", ["-H", "Cookie: maple_session=bogus_stale_session"])
    probes["auth_start"] = probe_auth_start(base_url)
    return probes


def probe_url(url: str, curl_args: list[str] | None = None) -> dict[str, Any]:
    result: dict[str, Any] = {"url": url}
    for attempt in range(1, PROBE_ATTEMPTS + 1):
        try:
            completed = subprocess.run(
                ["curl", "-k", "-sS", *(curl_args or []), "-o", "/tmp/maple-vefaas-stable-probe.txt", "-w", "%{http_code}", url],
                text=True,
                capture_output=True,
                timeout=PROBE_TIMEOUT_SECONDS,
            )
            body = Path("/tmp/maple-vefaas-stable-probe.txt").read_text(errors="replace")[:500]
            result = {"url": url, "status": completed.stdout.strip(), "body_prefix": body, "attempt": attempt}
            if completed.returncode:
                result["error"] = (completed.stderr or f"curl exited {completed.returncode}")[:300]
        except Exception as error:
            result = {"url": url, "error": str(error)[:300], "attempt": attempt}
        if probe_ok(result) or attempt == PROBE_ATTEMPTS:
            return result
        time.sleep(PROBE_RETRY_SECONDS)
    return result


def probe_auth_start(base_url: str) -> dict[str, Any]:
    base = base_url.rstrip("/")
    callback_url = f"{base}/v1/auth/oauth/lark_sso/callback"
    url = f"{base}/v1/auth/oauth/lark_sso/start?redirect=1&return_to=%2F"
    result: dict[str, Any] = {"url": url, "expected_callback": callback_url}
    header_path = Path("/tmp/maple-vefaas-stable-probe-headers.txt")
    body_path = Path("/tmp/maple-vefaas-stable-probe.txt")
    for attempt in range(1, PROBE_ATTEMPTS + 1):
        try:
            completed = subprocess.run(
                ["curl", "-k", "-sS", "-D", str(header_path), "-o", str(body_path), "-w", "%{http_code} %{redirect_url}", url],
                text=True,
                capture_output=True,
                timeout=PROBE_TIMEOUT_SECONDS,
            )
            status, _, redirect_url = completed.stdout.strip().partition(" ")
            body = body_path.read_text(errors="replace")[:500]
            headers = header_path.read_text(errors="replace")[:500]
            result = {
                "url": url,
                "status": status,
                "redirect_url": redirect_url,
                "expected_callback": callback_url,
                "headers_prefix": headers,
                "body_prefix": body,
                "attempt": attempt,
            }
            if completed.returncode:
                result["error"] = (completed.stderr or f"curl exited {completed.returncode}")[:300]
        except Exception as error:
            result = {"url": url, "expected_callback": callback_url, "error": str(error)[:300], "attempt": attempt}
        if probe_ok(result) or attempt == PROBE_ATTEMPTS:
            return result
        time.sleep(PROBE_RETRY_SECONDS)
    return result


def probe_ok(probe: dict[str, Any]) -> bool:
    status = str(probe.get("status") or "")
    return not probe.get("error") and status.isdigit() and 200 <= int(status) < 400


def assert_probes_ok(probes: dict[str, Any]) -> None:
    failures: list[str] = []
    for name, probe in probes.items():
        status = str(probe.get("status") or "")
        if not probe_ok(probe):
            detail = probe.get("error") or f"status={status} body={str(probe.get('body_prefix') or '')[:160]}"
            failures.append(f"{name}: {detail}")
            continue
        if name == "auth_start":
            redirect_url = unquote(str(probe.get("redirect_url") or ""))
            expected_callback = str(probe.get("expected_callback") or "")
            if "127.0.0.1" in redirect_url or "localhost" in redirect_url:
                failures.append(f"{name}: local callback leaked into redirect_url={redirect_url[:160]}")
            elif expected_callback and expected_callback not in redirect_url:
                failures.append(f"{name}: expected callback {expected_callback} missing from redirect_url={redirect_url[:160]}")
    if failures:
        raise SystemExit("stable probe failed: " + "; ".join(failures))


def load_state_or_exit(path: Path) -> dict[str, Any]:
    if not path.exists():
        raise SystemExit(f"state file does not exist, refusing to create resources in this mode: {path}")
    return json.loads(path.read_text())


def write_state(path: Path, state: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(state, ensure_ascii=False, indent=2, default=str) + "\n")


def public_summary(state: dict[str, Any]) -> dict[str, Any]:
    return {
        "state_file": os.environ.get("MAPLE_VEFAAS_DEPLOYMENT_STATE") or str(DEFAULT_STATE_PATH),
        "app_name": state.get("app_name"),
        "app_id": state.get("app_id"),
        "url": state.get("url"),
        "application_status": state.get("application", {}).get("status"),
        "gateway": state.get("gateway"),
        "frontend": {
            "function_id": state.get("frontend", {}).get("function_id"),
            "function_name": state.get("frontend", {}).get("function_name"),
            "stable_revision": state.get("frontend", {}).get("release", {}).get("StableRevisionNumber"),
            "ready_instances": ready_instance_count(state.get("frontend", {}).get("instances", [])),
        },
        "backend": {
            "function_id": state.get("backend", {}).get("function_id"),
            "function_name": state.get("backend", {}).get("function_name"),
            "stable_revision": state.get("backend", {}).get("release", {}).get("StableRevisionNumber"),
            "ready_instances": ready_instance_count(state.get("backend", {}).get("instances", [])),
        },
        "probe": state.get("probe"),
        "policy": state.get("policy"),
    }


def ready_instance_count(instances: list[dict[str, Any]]) -> int:
    return sum(1 for item in instances if item.get("InstanceStatus") == "Ready" or item.get("Status") == "Ready")


if __name__ == "__main__":
    raise SystemExit(main())

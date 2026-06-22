#!/usr/bin/env python3
from __future__ import annotations

import datetime as dt
import hashlib
import hmac
import io
import json
import os
import re
import ssl
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable


DEFAULT_TEMPLATE_ID = "6874f3360bdbc40008ecf8c7"
DEFAULT_RUNTIME_IMAGE = ""
OPENAPI_HOST = "open.volcengineapi.com"
OPENAPI_VERSION = "2021-03-03"
OPENAPI_SERVICE = "vefaas"
APIG_METHODS = ["POST", "GET", "PUT", "DELETE", "HEAD", "OPTIONS", "CONNECT"]


@dataclass(frozen=True)
class DeployConfig:
    access_key: str
    secret_key: str
    region: str = "cn-beijing"
    app_name: str = field(default_factory=lambda: f"maple-runtime-bun-{timestamp()}")
    source_dir: Path = field(default_factory=lambda: Path(__file__).resolve().parent / "runtime-app")
    function_name: str | None = None
    gateway_name: str | None = None
    gateway_service_id: str = ""
    gateway_service_name: str | None = None
    gateway_upstream_name: str | None = None
    route_prefix: str = ""
    template_id: str = DEFAULT_TEMPLATE_ID
    runtime: str = "native-python3.12/v1"
    command: str = "./run.sh"
    port: int | None = None
    cpu_strategy: str | None = None
    instance_type: str | None = None
    min_instance: int = 0
    max_instance: int = 0
    request_timeout: int = 1800
    memory_mb: int = 2048
    enable_logs: bool = False
    tls_project_id: str = ""
    tls_topic_id: str = ""
    vpc_id: str = ""
    subnet_ids: list[str] = field(default_factory=list)
    security_group_ids: list[str] = field(default_factory=list)
    enable_shared_internet_access: bool | None = None
    enable_key_auth: bool = False
    enable_mcp_session: bool = False
    reuse_existing: bool = False
    poll_interval_seconds: float = 10
    poll_timeout_seconds: float = 900
    envs: dict[str, str] = field(default_factory=dict)
    image_url: str = ""

    def __post_init__(self):
        object.__setattr__(self, "source_dir", Path(self.source_dir))


class VefaasDirectProvisioner:
    def __init__(
        self,
        *,
        vefaas_api: Any,
        openapi: Any,
        apig_api: Any | None = None,
        apig_service_openapi: Any | None = None,
        apig_openapi: Any | None = None,
        upload_bytes: Callable[[str, bytes], None] = None,
        sleep: Callable[[float], None] = time.sleep,
    ):
        self.vefaas_api = vefaas_api
        self.openapi = openapi
        self.apig_api = apig_api
        self.apig_service_openapi = apig_service_openapi
        self.apig_openapi = apig_openapi
        self.upload_bytes = upload_bytes or put_zip_bytes
        self.sleep = sleep

    def deploy(self, config: DeployConfig) -> dict[str, Any]:
        validate_name(config.app_name, "application name")
        if not config.source_dir.exists():
            raise ValueError(f"runtime template directory does not exist: {config.source_dir}")

        existing = self.find_application_by_name(config.app_name)
        if existing:
            if not config.reuse_existing:
                raise ValueError(f"veFaaS application already exists: {config.app_name}; set MAPLE_VEFAAS_REUSE_EXISTING=true to reuse it")
            if not existing.get("CloudResource") and existing.get("Id"):
                existing = self.openapi.post("GetApplication", {"Id": existing["Id"]}).get("Result", existing)
            return self.payload_from_application(config, existing, reused=True)

        function_name = config.function_name or f"{config.app_name}-fn"
        validate_name(function_name, "function name")
        function_id = self.vefaas_api.create_function(self.function_spec(config, function_name))

        if config.image_url:
            # Container-image functions cannot use the zip/template application flow
            # (the inner-adk template rejects custom images); release the function directly.
            self.vefaas_api.release_function(function_id, config)
            self.apply_reserved_concurrency(function_id, config)
            route = self.create_direct_apig_route(config, function_id)
            url = route["url"].rstrip("/")
            return {
                "app_name": config.app_name,
                "app_id": "",
                "function_name": function_name,
                "function_id": function_id,
                "url": url,
                "invoke_url": f"{url}/invoke",
                "image": config.image_url,
                "region": config.region,
                "gateway": route,
                "reused": False,
                "released": True,
            }

        code_zip = zip_source_dir(config.source_dir)
        upload_url = self.vefaas_api.get_code_upload_address(function_id, len(code_zip))
        self.upload_bytes(upload_url, code_zip)
        self.openapi.post("CodeUploadCallback", {"FunctionId": function_id})
        self.vefaas_api.release_function(function_id, config)
        self.apply_reserved_concurrency(function_id, config)

        route = self.create_direct_apig_route(config, function_id)
        url = route["url"].rstrip("/")
        return {
            "app_name": config.app_name,
            "app_id": "",
            "function_name": function_name,
            "function_id": function_id,
            "url": url,
            "invoke_url": f"{url}/invoke",
            "region": config.region,
            "gateway": route,
            "reused": False,
        }

    def apply_reserved_concurrency(self, function_id: str, config: DeployConfig) -> None:
        if not config.min_instance and not config.max_instance:
            return
        try:
            self.vefaas_api.update_function_resource(function_id, config.min_instance or 1, config.max_instance or 10)
        except Exception as error:
            print(f"warning: failed to set reserved concurrency for {function_id}: {error}")

    def function_spec(self, config: DeployConfig, function_name: str) -> dict[str, Any]:
        spec: dict[str, Any] = {
            "name": function_name,
            "description": "managed-agents-platform veFaaS runtime",
            "command": config.command,
            "port": config.port,
            "cpu_strategy": config.cpu_strategy,
            "instance_type": config.instance_type,
            "runtime": config.runtime,
            "request_timeout": config.request_timeout,
            "memory_mb": config.memory_mb,
            "tls_config": {
                "enable_log": config.enable_logs,
                "tls_project_id": config.tls_project_id,
                "tls_topic_id": config.tls_topic_id,
            },
            "vpc_config": {
                "vpc_id": config.vpc_id,
                "subnet_ids": config.subnet_ids,
                "security_group_ids": config.security_group_ids,
                "enable_shared_internet_access": config.enable_shared_internet_access,
            },
            "envs": config.envs,
            "tags": {"provider": "managed-agents-platform", "component": "agent-runtime"},
        }
        if config.image_url:
            spec["source"] = config.image_url
            spec["source_type"] = "image"
        return spec

    def find_application_by_name(self, app_name: str) -> dict[str, Any] | None:
        response = self.openapi.post(
            "ListApplications",
            {
                "OrderBy": {"Key": "CreateTime", "Ascend": False},
                "Filters": [{"Item": {"Key": "Name", "Value": [app_name]}}],
                "PageNumber": 1,
                "PageSize": 50,
            },
        )
        items = response.get("Result", {}).get("Items", [])
        for item in items:
            if item.get("Name") == app_name:
                return item
        return None

    def create_application(self, config: DeployConfig, function_name: str) -> str:
        stamp = timestamp()
        gateway_name = config.gateway_name or self.resolve_gateway_name(config, stamp)
        body = {
            "Name": config.app_name,
            "Services": [],
            "IAM": [],
            "Config": {
                "Region": config.region,
                "FunctionName": function_name,
                "GatewayName": gateway_name,
                "ServiceName": config.gateway_service_name or f"{config.app_name}-gw-svr-{stamp}",
                "UpstreamName": config.gateway_upstream_name or f"{config.app_name}-gw-us-{stamp}",
                "EnableKeyAuth": config.enable_key_auth,
                "EnableMcpSession": config.enable_mcp_session,
            },
            "TemplateId": config.template_id,
        }
        response = self.openapi.post("CreateApplication", body)
        result = response.get("Result", {})
        if result.get("Status") != "create_success" or not result.get("Id"):
            raise RuntimeError(f"CreateApplication failed: {safe_json(response)}")
        return str(result["Id"])

    def resolve_gateway_name(self, config: DeployConfig, stamp: str) -> str:
        generated = f"{config.app_name}-gw-{stamp}"
        if not self.apig_api:
            return generated
        return self.apig_api.ensure_serverless_gateway_name(
            generated,
            poll_interval_seconds=config.poll_interval_seconds,
            poll_timeout_seconds=config.poll_timeout_seconds,
        )

    def create_direct_apig_route(self, config: DeployConfig, function_id: str) -> dict[str, str]:
        if not self.apig_api or not self.apig_openapi:
            raise RuntimeError("direct veFaaS runtime provisioning requires APIG clients")
        stamp = timestamp()
        gateway = self.apig_api.resolve_serverless_gateway(
            config.gateway_name,
            generated_name=f"{config.app_name}-gw-{stamp}",
            poll_interval_seconds=config.poll_interval_seconds,
            poll_timeout_seconds=config.poll_timeout_seconds,
        )
        gateway_id = str(gateway["id"])
        service = self.resolve_gateway_service(config, gateway_id, stamp)
        service_id = str(service["id"])
        upstream_id = self.apig_api.create_vefaas_upstream(
            gateway_id,
            config.gateway_upstream_name or f"{config.app_name}-gw-us-{stamp}",
            function_id,
        )
        route_prefix = normalized_route_prefix(config)
        route_id = self.create_apig_route(service_id, "runtime", route_prefix, upstream_id, priority=100)
        return {
            "gateway_id": gateway_id,
            "gateway_name": str(gateway.get("name") or ""),
            "service_id": service_id,
            "service_name": str(service.get("name") or ""),
            "upstream_id": upstream_id,
            "route_id": route_id,
            "route_prefix": route_prefix,
            "url": f"{self.apig_api.service_url(service).rstrip('/')}{route_prefix}",
        }

    def resolve_gateway_service(self, config: DeployConfig, gateway_id: str, stamp: str) -> dict[str, Any]:
        if not self.apig_service_openapi:
            return self.apig_api.create_gateway_service(
                gateway_id,
                config.gateway_service_name or f"{config.app_name}-gw-svr-{stamp}",
                comments="managed-agents-platform runtime service",
            )
        services = self.list_gateway_services(gateway_id)
        if config.gateway_service_id:
            for service in services:
                if service.get("id") == config.gateway_service_id:
                    return service
            raise RuntimeError(f"configured APIG gateway service was not found: {config.gateway_service_id}")
        if config.gateway_service_name:
            for service in services:
                if service.get("name") == config.gateway_service_name:
                    return service
            raise RuntimeError(f"configured APIG gateway service was not found: {config.gateway_service_name}")
        for service in services:
            if service.get("status") == "Running":
                return service
        return self.apig_api.create_gateway_service(
            gateway_id,
            f"{config.app_name}-gw-svr-{stamp}",
            comments="managed-agents-platform runtime service",
        )

    def list_gateway_services(self, gateway_id: str) -> list[dict[str, Any]]:
        services: list[dict[str, Any]] = []
        for page in range(1, 20):
            data = self.apig_service_openapi.post("ListGatewayServices", {"GatewayId": gateway_id, "PageNumber": page, "PageSize": 50}).get("Result", {})
            items = data.get("Items") or []
            services.extend(normalize_gateway_service(item) for item in items)
            if len(items) < 50:
                break
        return services

    def create_apig_route(self, service_id: str, suffix: str, path: str, upstream_id: str, *, priority: int) -> str:
        response = self.apig_openapi.post(
            "CreateRoute",
            {
                "Name": f"maple-{suffix}-{timestamp()}",
                "ServiceId": service_id,
                "ResourceType": "Console",
                "Enable": True,
                "Priority": priority,
                "UpstreamList": [{"UpstreamId": upstream_id, "Weight": 100}],
                "MatchRule": {"Path": {"MatchType": "Prefix", "MatchContent": path}, "Method": APIG_METHODS},
                "AdvancedSetting": {"CorsPolicySetting": {"Enable": True}},
            },
        )
        route_id = response.get("Result", {}).get("Id")
        if not route_id:
            raise RuntimeError(f"CreateRoute did not return id: {safe_json(response)}")
        return str(route_id)

    def wait_for_application(self, app_id: str, config: DeployConfig) -> dict[str, Any]:
        deadline = time.monotonic() + config.poll_timeout_seconds
        last_response: dict[str, Any] | None = None
        while True:
            response = self.openapi.post("GetApplication", {"Id": app_id})
            last_response = response
            result = response.get("Result", {})
            status = result.get("Status")
            if status == "deploy_success":
                return result
            if status == "deploy_fail":
                raise RuntimeError(f"ReleaseApplication failed: {safe_json(response)}")
            if time.monotonic() >= deadline:
                raise TimeoutError(f"ReleaseApplication timed out: {safe_json(last_response)}")
            self.sleep(config.poll_interval_seconds)

    def payload_from_application(self, config: DeployConfig, application: dict[str, Any], *, reused: bool) -> dict[str, Any]:
        app_id = str(application.get("Id") or "")
        url = extract_system_url(application).rstrip("/")
        function = extract_function(application)
        return {
            "app_name": config.app_name,
            "app_id": app_id,
            "function_name": function.get("Name") or config.function_name or f"{config.app_name}-fn",
            "function_id": function.get("Id") or "",
            "url": url,
            "invoke_url": f"{url}/invoke",
            "region": config.region,
            "reused": reused,
        }


class VolcengineVefaasApi:
    def __init__(self, access_key: str, secret_key: str, region: str):
        try:
            import volcenginesdkcore
            import volcenginesdkvefaas
        except ImportError as error:
            self.sdk = None
            self.client = None
            self.openapi = SignedOpenApiClient(access_key=access_key, secret_key=secret_key, region=region, service="vefaas", version="2024-06-06")
            return

        self.sdk = volcenginesdkvefaas
        self.openapi = None
        configuration = volcenginesdkcore.Configuration()
        configuration.ak = access_key
        configuration.sk = secret_key
        configuration.region = region
        configuration.client_side_validation = True
        volcenginesdkcore.Configuration.set_default(configuration)
        self.client = volcenginesdkvefaas.VEFAASApi(volcenginesdkcore.ApiClient(configuration))

    def create_function(self, spec: dict[str, Any]) -> str:
        if getattr(self, "openapi", None):
            body = self.create_function_body(spec)
            result = self.openapi.post("CreateFunction", body).get("Result", {})
            function_id = result.get("Id") or result.get("FunctionId") or result.get("id")
            if not function_id:
                raise RuntimeError(f"CreateFunction did not return an id: {safe_json(result)}")
            return str(function_id)
        envs = [self.sdk.EnvForCreateFunctionInput(key=key, value=value) for key, value in sorted(spec["envs"].items())]
        tags = [self.sdk.TagForCreateFunctionInput(key=key, value=value) for key, value in sorted(spec["tags"].items())]
        tls_config = self.create_tls_config(spec.get("tls_config") or {})
        raw_vpc_config = spec.get("vpc_config") or {}
        vpc_config = None
        if raw_vpc_config.get("vpc_id"):
            vpc_config = self.sdk.VpcConfigForCreateFunctionInput(
                enable_vpc=True,
                enable_shared_internet_access=raw_vpc_config.get("enable_shared_internet_access"),
                vpc_id=raw_vpc_config.get("vpc_id"),
                subnet_ids=raw_vpc_config.get("subnet_ids") or None,
                security_group_ids=raw_vpc_config.get("security_group_ids") or None,
            )
        response = self.client.create_function(
            self.sdk.CreateFunctionRequest(
                name=spec["name"],
                description=spec["description"],
                command=spec["command"],
                port=spec.get("port"),
                cpu_strategy=spec.get("cpu_strategy"),
                instance_type=spec.get("instance_type"),
                runtime=spec["runtime"],
                source=spec.get("source"),
                source_type=spec.get("source_type"),
                request_timeout=spec["request_timeout"],
                memory_mb=spec["memory_mb"],
                envs=envs,
                tags=tags,
                tls_config=tls_config,
                vpc_config=vpc_config,
            )
        )
        function_id = getattr(response, "id", "")
        if not function_id:
            raise RuntimeError(f"CreateFunction did not return an id: {response}")
        return str(function_id)

    def create_function_body(self, spec: dict[str, Any]) -> dict[str, Any]:
        body: dict[str, Any] = {
            "Name": spec["name"],
            "Description": spec["description"],
            "Command": spec["command"],
            "Runtime": spec["runtime"],
            "RequestTimeout": spec["request_timeout"],
            "MemoryMB": spec["memory_mb"],
            "Envs": [{"Key": key, "Value": value} for key, value in sorted(spec["envs"].items())],
            "Tags": [{"Key": key, "Value": value} for key, value in sorted(spec["tags"].items())],
        }
        optional_fields = {
            "Port": spec.get("port"),
            "CpuStrategy": spec.get("cpu_strategy"),
            "InstanceType": spec.get("instance_type"),
            "Source": spec.get("source"),
            "SourceType": spec.get("source_type"),
        }
        for key, value in optional_fields.items():
            if value is not None and value != "":
                body[key] = value
        tls_config = self.create_tls_config(spec.get("tls_config") or {})
        if tls_config:
            body["TlsConfig"] = tls_config
        vpc_config = self.create_vpc_config(spec.get("vpc_config") or {})
        if vpc_config:
            body["VpcConfig"] = vpc_config
        return body

    def create_tls_config(self, raw: dict[str, Any]) -> Any | None:
        if not raw.get("enable_log"):
            return None
        project_id = raw.get("tls_project_id") or ""
        topic_id = raw.get("tls_topic_id") or ""
        if not project_id or not topic_id:
            raise ValueError("MAPLE_VEFAAS_ENABLE_LOGS=true requires MAPLE_VEFAAS_TLS_PROJECT_ID and MAPLE_VEFAAS_TLS_TOPIC_ID")
        if getattr(self, "openapi", None):
            return {"EnableLog": True, "TlsProjectId": project_id, "TlsTopicId": topic_id}
        return self.sdk.TlsConfigForCreateFunctionInput(enable_log=True, tls_project_id=project_id, tls_topic_id=topic_id)

    def create_vpc_config(self, raw: dict[str, Any]) -> dict[str, Any] | None:
        if not raw.get("vpc_id"):
            return None
        return {
            "EnableVpc": True,
            "EnableSharedInternetAccess": raw.get("enable_shared_internet_access"),
            "VpcId": raw.get("vpc_id"),
            "SubnetIds": raw.get("subnet_ids") or None,
            "SecurityGroupIds": raw.get("security_group_ids") or None,
        }

    def release_function(self, function_id: str, config: DeployConfig) -> None:
        if getattr(self, "openapi", None):
            deadline = time.monotonic() + config.poll_timeout_seconds
            while True:
                try:
                    self.openapi.post(
                        "Release",
                        {"FunctionId": function_id, "RevisionNumber": 0, "TargetTrafficWeight": 100, "MaxInstance": config.max_instance or 10},
                    )
                    break
                except Exception as error:
                    if not is_source_image_sync_running_error(error) or time.monotonic() >= deadline:
                        raise
                    time.sleep(config.poll_interval_seconds)
            last: dict[str, Any] = {}
            while time.monotonic() < deadline:
                last = self.openapi.post("GetReleaseStatus", {"FunctionId": function_id}).get("Result", {})
                state = str(last.get("Status") or last.get("status") or "").lower()
                if state in ("done", "succeeded", "success"):
                    return
                if state in ("failed", "fail", "error"):
                    raise RuntimeError(f"ReleaseFunction failed for {function_id}: {safe_json(last)}")
                time.sleep(config.poll_interval_seconds)
            raise RuntimeError(f"ReleaseFunction timed out for {function_id}: {safe_json(last)}")
        deadline = time.monotonic() + config.poll_timeout_seconds
        while True:
            try:
                self.client.release(self.sdk.ReleaseRequest(function_id=function_id, revision_number=0))
                break
            except Exception as error:
                if not is_source_image_sync_running_error(error) or time.monotonic() >= deadline:
                    raise
                time.sleep(config.poll_interval_seconds)
        while time.monotonic() < deadline:
            status = self.client.get_release_status(self.sdk.GetReleaseStatusRequest(function_id=function_id))
            state = str(getattr(status, "status", "") or "").lower()
            if state in ("done", "succeeded", "success"):
                return
            if state in ("failed", "fail", "error"):
                raise RuntimeError(f"ReleaseFunction failed for {function_id}: {status}")
            time.sleep(config.poll_interval_seconds)
        raise RuntimeError(f"ReleaseFunction timed out for {function_id}")

    def update_function_resource(self, function_id: str, min_instance: int, max_instance: int) -> None:
        # reserved concurrency: min_instance>=1 keeps a warm instance (no scale-to-zero cold start),
        # so the per-instance keep-alive runner + sandbox pre-warm actually survive between turns
        if getattr(self, "openapi", None):
            self.openapi.post("UpdateFunctionResource", {"FunctionId": function_id, "MinInstance": min_instance, "MaxInstance": max_instance})
            return
        self.client.update_function_resource(
            self.sdk.UpdateFunctionResourceRequest(function_id=function_id, min_instance=min_instance, max_instance=max_instance)
        )

    def get_code_upload_address(self, function_id: str, content_length: int) -> str:
        if getattr(self, "openapi", None):
            result = self.openapi.post("GetCodeUploadAddress", {"FunctionId": function_id, "ContentLength": content_length}).get("Result", {})
            upload_address = result.get("UploadAddress") or result.get("UploadURL") or result.get("UploadUrl")
            if not upload_address:
                raise RuntimeError(f"GetCodeUploadAddress did not return an upload address: {safe_json(result)}")
            return str(upload_address)
        response = self.client.get_code_upload_address(self.sdk.GetCodeUploadAddressRequest(function_id=function_id, content_length=content_length))
        upload_address = getattr(response, "upload_address", "")
        if not upload_address:
            raise RuntimeError(f"GetCodeUploadAddress did not return an upload address: {response}")
        return str(upload_address)


class VolcengineApigApi:
    def __init__(self, access_key: str, secret_key: str, region: str):
        try:
            import volcenginesdkapig
            import volcenginesdkcore
        except ImportError as error:
            self.sdk = None
            self.client = None
            self.region = region
            self.openapi = SignedOpenApiClient(access_key=access_key, secret_key=secret_key, region=region, service="apig", version="2021-03-03")
            return

        self.sdk = volcenginesdkapig
        self.region = region
        self.openapi = None
        configuration = volcenginesdkcore.Configuration()
        configuration.ak = access_key
        configuration.sk = secret_key
        configuration.region = region
        self.client = volcenginesdkapig.APIGApi(api_client=volcenginesdkcore.ApiClient(configuration=configuration))

    def resolve_serverless_gateway(
        self,
        preferred_name: str | None,
        *,
        generated_name: str,
        poll_interval_seconds: float,
        poll_timeout_seconds: float,
    ) -> dict[str, Any]:
        running = [gateway for gateway in self.list_gateways() if gateway.get("type") == "serverless" and gateway.get("status") == "Running"]
        if preferred_name:
            for gateway in running:
                if gateway.get("name") == preferred_name:
                    return gateway
            raise RuntimeError(f"configured APIG gateway is not Running or was not found: {preferred_name}")
        if running:
            return running[0]
        gateway_id = self.create_serverless_gateway(generated_name)
        return self.wait_gateway(gateway_id, poll_interval_seconds=poll_interval_seconds, poll_timeout_seconds=poll_timeout_seconds)

    def ensure_serverless_gateway_name(self, preferred_name: str, *, poll_interval_seconds: float, poll_timeout_seconds: float) -> str:
        existing = self.find_running_serverless_gateway(preferred_name=preferred_name)
        if existing:
            return str(existing["name"])

        gateway_id = self.create_serverless_gateway(preferred_name)
        return str(self.wait_gateway(gateway_id, poll_interval_seconds=poll_interval_seconds, poll_timeout_seconds=poll_timeout_seconds).get("name") or preferred_name)

    def wait_gateway(self, gateway_id: str, *, poll_interval_seconds: float, poll_timeout_seconds: float) -> dict[str, Any]:
        deadline = time.monotonic() + poll_timeout_seconds
        while True:
            for gateway in self.list_gateways():
                if gateway.get("id") == gateway_id and gateway.get("status") == "Running":
                    return gateway
            if time.monotonic() >= deadline:
                raise TimeoutError(f"APIG serverless gateway creation timed out: {gateway_id}")
            time.sleep(poll_interval_seconds)

    def find_running_serverless_gateway(self, *, preferred_name: str | None = None) -> dict[str, Any] | None:
        running = [gateway for gateway in self.list_gateways() if gateway.get("type") == "serverless" and gateway.get("status") == "Running"]
        if preferred_name:
            for gateway in running:
                if gateway.get("name") == preferred_name:
                    return gateway
        return running[0] if running else None

    def list_gateways(self) -> list[dict[str, Any]]:
        if getattr(self, "openapi", None):
            result = self.openapi.post("ListGateways", {"PageNumber": 1, "PageSize": 100}).get("Result", {})
            items = result.get("Items") or result.get("Gateways") or result.get("Data") or []
            return [normalize_gateway(item) for item in items]
        response = self.client.list_gateways(self.sdk.ListGatewaysRequest(), async_req=True).get()
        return [to_plain_dict(item) for item in getattr(response, "items", []) or []]

    def create_serverless_gateway(self, name: str) -> str:
        if getattr(self, "openapi", None):
            response = self.openapi.post(
                "CreateGateway",
                {
                    "Name": name,
                    "Region": self.region,
                    "Type": "serverless",
                    "ResourceSpec": {
                        "Replicas": 2,
                        "InstanceSpecCode": "1c2g",
                        "ClbSpecCode": "small_1",
                        "PublicNetworkBillingType": "traffic",
                        "NetworkType": {"EnablePublicNetwork": True, "EnablePrivateNetwork": False},
                    },
                },
            )
            data = response.get("Result", {})
            gateway_id = data.get("Id") or data.get("id")
            if not gateway_id:
                raise RuntimeError(f"CreateGateway did not return an id: {safe_json(data)}")
            return str(gateway_id)
        response = self.client.create_gateway(
            self.sdk.CreateGatewayRequest(
                name=name,
                region=self.region,
                type="serverless",
                resource_spec=self.sdk.ResourceSpecForCreateGatewayInput(
                    replicas=2,
                    instance_spec_code="1c2g",
                    clb_spec_code="small_1",
                    public_network_billing_type="traffic",
                    network_type={"EnablePublicNetwork": True, "EnablePrivateNetwork": False},
                ),
            ),
            async_req=True,
        ).get()
        data = to_plain_dict(response)
        gateway_id = data.get("id")
        if not gateway_id:
            raise RuntimeError(f"CreateGateway did not return an id: {data}")
        return str(gateway_id)

    def create_gateway_service(self, gateway_id: str, service_name: str, *, comments: str) -> dict[str, Any]:
        if self.openapi:
            response = self.openapi.post(
                "CreateGatewayService",
                {
                    "GatewayId": gateway_id,
                    "ServiceName": service_name,
                    "Protocol": ["HTTP", "HTTPS"],
                    "AuthSpec": {"Enable": False},
                    "Comments": comments,
                },
            )
            data = response.get("Result", {})
            service_id = data.get("Id") or data.get("id")
            if not service_id:
                raise RuntimeError(f"CreateGatewayService did not return id: {safe_json(data)}")
            return self.wait_gateway_service(str(service_id))
        response = self.client.create_gateway_service(
            self.sdk.CreateGatewayServiceRequest(
                gateway_id=gateway_id,
                service_name=service_name,
                protocol=["HTTP", "HTTPS"],
                auth_spec=self.sdk.AuthSpecForCreateGatewayServiceInput(enable=False),
                comments=comments,
            ),
            async_req=True,
        ).get()
        data = to_plain_dict(response)
        service_id = data.get("id") or data.get("Id")
        if not service_id:
            raise RuntimeError(f"CreateGatewayService did not return id: {safe_json(data)}")
        return self.wait_gateway_service(str(service_id))

    def wait_gateway_service(self, service_id: str) -> dict[str, Any]:
        deadline = time.monotonic() + 180
        last: dict[str, Any] = {}
        while time.monotonic() < deadline:
            if self.openapi:
                response = self.openapi.post("GetGatewayService", {"Id": service_id})
                last = normalize_gateway_service(response.get("Result", {}).get("GatewayService") or response.get("Result", {}))
            else:
                response = self.client.get_gateway_service(self.sdk.GetGatewayServiceRequest(id=service_id), async_req=True).get()
                last = normalize_gateway_service(to_plain_dict(response).get("gateway_service") or to_plain_dict(response))
            if last.get("status") == "Running" or last.get("Status") == "Running":
                return last
            time.sleep(5)
        raise TimeoutError(f"gateway service did not become Running: {safe_json(last)}")

    def service_url(self, service: dict[str, Any]) -> str:
        for domain in service.get("domains") or []:
            value = str(domain.get("Domain") or domain.get("domain") or "")
            if value.startswith("https://"):
                return value.rstrip("/")
        service_id = service.get("id")
        if not service_id:
            raise RuntimeError(f"gateway service has no public domain or id: {safe_json(service)}")
        return f"https://{service_id}.apigateway-cn-beijing.volceapi.com"

    def create_vefaas_upstream(self, gateway_id: str, name: str, function_id: str) -> str:
        if self.openapi:
            response = self.openapi.post(
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
        response = self.client.create_upstream(
            self.sdk.CreateUpstreamRequest(
                gateway_id=gateway_id,
                name=name,
                protocol="HTTP",
                source_type="VeFaas",
                upstream_spec=self.sdk.UpstreamSpecForCreateUpstreamInput(ve_faas=self.sdk.VeFaasForCreateUpstreamInput(function_id=function_id)),
            ),
            async_req=True,
        ).get()
        data = to_plain_dict(response)
        upstream_id = data.get("id") or data.get("Id")
        if not upstream_id:
            raise RuntimeError(f"CreateUpstream did not return id: {safe_json(data)}")
        return str(upstream_id)


class SignedOpenApiClient:
    def __init__(
        self,
        *,
        access_key: str,
        secret_key: str,
        region: str,
        host: str = OPENAPI_HOST,
        service: str = OPENAPI_SERVICE,
        version: str = OPENAPI_VERSION,
    ):
        self.access_key = access_key
        self.secret_key = secret_key
        self.region = region
        self.host = host
        self.service = service
        self.version = version

    def post(self, action: str, body: dict[str, Any]) -> dict[str, Any]:
        payload = json.dumps(body, separators=(",", ":"), ensure_ascii=False)
        query = {"Action": action, "Version": self.version}
        headers = self.sign("POST", "/", query, payload)
        url = f"https://{self.host}/?{canonical_query(query)}"
        request = urllib.request.Request(url, data=payload.encode("utf-8"), headers=headers, method="POST")
        try:
            with urllib.request.urlopen(request, timeout=120, context=ssl_context()) as response:
                raw = response.read().decode("utf-8")
        except urllib.error.HTTPError as error:
            raw = error.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"Volcengine OpenAPI {action} failed with HTTP {error.code}: {raw}") from error
        parsed = json.loads(raw)
        if "Error" in parsed or parsed.get("ResponseMetadata", {}).get("Error"):
            raise RuntimeError(f"Volcengine OpenAPI {action} failed: {safe_json(parsed)}")
        return parsed

    def sign(self, method: str, path: str, query: dict[str, str], body: str) -> dict[str, str]:
        content_type = "application/json"
        now = dt.datetime.now(dt.timezone.utc)
        x_date = now.strftime("%Y%m%dT%H%M%SZ")
        short_date = x_date[:8]
        body_hash = hashlib.sha256(body.encode("utf-8")).hexdigest()
        signed_headers = "content-type;host;x-content-sha256;x-date"
        canonical_request = "\n".join(
            [
                method.upper(),
                path,
                canonical_query(query),
                "\n".join(
                    [
                        f"content-type:{content_type}",
                        f"host:{self.host}",
                        f"x-content-sha256:{body_hash}",
                        f"x-date:{x_date}",
                    ]
                ),
                "",
                signed_headers,
                body_hash,
            ]
        )
        scope = f"{short_date}/{self.region}/{self.service}/request"
        string_to_sign = "\n".join(["HMAC-SHA256", x_date, scope, hashlib.sha256(canonical_request.encode("utf-8")).hexdigest()])
        k_date = hmac_sha256(self.secret_key.encode("utf-8"), short_date, raw=True)
        k_region = hmac_sha256(k_date, self.region, raw=True)
        k_service = hmac_sha256(k_region, self.service, raw=True)
        k_signing = hmac_sha256(k_service, "request", raw=True)
        signature_hex = hmac.new(k_signing, string_to_sign.encode("utf-8"), hashlib.sha256).hexdigest()
        return {
            "Host": self.host,
            "Content-Type": content_type,
            "X-Date": x_date,
            "X-Content-Sha256": body_hash,
            "Authorization": f"HMAC-SHA256 Credential={self.access_key}/{scope}, SignedHeaders={signed_headers}, Signature={signature_hex}",
        }


def build_config_from_env(cwd: Path | str | None = None) -> DeployConfig:
    load_project_env(Path(cwd) if cwd is not None else Path.cwd())
    access_key = os.environ.get("VOLCENGINE_ACCESS_KEY") or os.environ.get("VOLC_ACCESSKEY")
    secret_key = os.environ.get("VOLCENGINE_SECRET_KEY") or os.environ.get("VOLC_SECRETKEY")
    if not access_key or not secret_key:
        raise RuntimeError("missing VOLCENGINE_ACCESS_KEY/VOLCENGINE_SECRET_KEY in environment or project .env")

    region = os.environ.get("MAPLE_VEFAAS_REGION") or os.environ.get("VEFAAS_REGION") or "cn-beijing"
    app_name = os.environ.get("MAPLE_VEFAAS_APP_NAME") or f"maple-runtime-bun-{timestamp()}"
    image_url = (os.environ.get("MAPLE_VEFAAS_IMAGE") or "").strip()
    default_runtime = "native/v1" if image_url else "native-python3.12/v1"
    default_command = "/opt/maple-runtime/run.sh" if image_url else "./run.sh"
    return DeployConfig(
        access_key=access_key,
        secret_key=secret_key,
        region=region,
        app_name=app_name,
        source_dir=Path(__file__).resolve().parent / "runtime-app",
        function_name=os.environ.get("MAPLE_VEFAAS_FUNCTION_NAME") or None,
        gateway_name=os.environ.get("MAPLE_VEFAAS_GATEWAY_NAME") or None,
        gateway_service_id=os.environ.get("MAPLE_VEFAAS_RUNTIME_GATEWAY_SERVICE_ID") or os.environ.get("MAPLE_VEFAAS_GATEWAY_SERVICE_ID") or "",
        gateway_service_name=os.environ.get("MAPLE_VEFAAS_GATEWAY_SERVICE_NAME") or None,
        gateway_upstream_name=os.environ.get("MAPLE_VEFAAS_GATEWAY_UPSTREAM_NAME") or None,
        route_prefix=os.environ.get("MAPLE_VEFAAS_RUNTIME_ROUTE_PREFIX") or os.environ.get("MAPLE_VEFAAS_ROUTE_PREFIX") or "",
        template_id=os.environ.get("MAPLE_VEFAAS_APPLICATION_TEMPLATE_ID") or DEFAULT_TEMPLATE_ID,
        runtime=os.environ.get("MAPLE_VEFAAS_RUNTIME") or default_runtime,
        command=os.environ.get("MAPLE_VEFAAS_COMMAND") or default_command,
        port=int(os.environ.get("MAPLE_VEFAAS_PORT") or ("8000" if image_url else "0")) or None,
        request_timeout=int(os.environ.get("MAPLE_VEFAAS_REQUEST_TIMEOUT_SECONDS") or "1800"),
        memory_mb=int(os.environ.get("MAPLE_VEFAAS_MEMORY_MB") or "2048"),
        enable_logs=parse_bool(os.environ.get("MAPLE_VEFAAS_ENABLE_LOGS") or os.environ.get("MAPLE_VEFAAS_ENABLE_TLS_LOGS") or "false"),
        tls_project_id=os.environ.get("MAPLE_VEFAAS_TLS_PROJECT_ID") or "",
        tls_topic_id=os.environ.get("MAPLE_VEFAAS_TLS_TOPIC_ID") or "",
        vpc_id=os.environ.get("MAPLE_VEFAAS_RUNTIME_VPC_ID") or os.environ.get("MAPLE_VEFAAS_VPC_ID") or "",
        subnet_ids=csv_env("MAPLE_VEFAAS_RUNTIME_SUBNET_IDS") or csv_env("MAPLE_VEFAAS_SUBNET_IDS"),
        security_group_ids=csv_env("MAPLE_VEFAAS_RUNTIME_SECURITY_GROUP_IDS") or csv_env("MAPLE_VEFAAS_SECURITY_GROUP_IDS"),
        enable_shared_internet_access=parse_optional_bool(
            os.environ.get("MAPLE_VEFAAS_RUNTIME_ENABLE_SHARED_INTERNET_ACCESS")
            or os.environ.get("MAPLE_VEFAAS_ENABLE_SHARED_INTERNET_ACCESS")
        ),
        enable_key_auth=parse_bool(os.environ.get("MAPLE_VEFAAS_ENABLE_KEY_AUTH") or "false"),
        enable_mcp_session=parse_bool(os.environ.get("MAPLE_VEFAAS_ENABLE_MCP_SESSION") or "false"),
        reuse_existing=parse_bool(os.environ.get("MAPLE_VEFAAS_REUSE_EXISTING") or "false"),
        poll_interval_seconds=float(os.environ.get("MAPLE_VEFAAS_RELEASE_POLL_INTERVAL_SECONDS") or "10"),
        poll_timeout_seconds=float(os.environ.get("MAPLE_VEFAAS_RELEASE_TIMEOUT_SECONDS") or "900"),
        min_instance=int(os.environ.get("MAPLE_RUNTIME_FUNCTION_MIN_INSTANCES") or os.environ.get("MAPLE_VEFAAS_MIN_INSTANCE") or "1"),
        max_instance=int(os.environ.get("MAPLE_RUNTIME_FUNCTION_MAX_INSTANCES") or os.environ.get("MAPLE_VEFAAS_MAX_INSTANCE") or "10"),
        envs=build_runtime_envs(),
        image_url=image_url,
    )


def load_project_env(cwd: Path) -> None:
    env_path = cwd / ".env"
    if not env_path.exists():
        return
    for line in env_path.read_text().splitlines():
        parsed = parse_env_line(line)
        if parsed is None:
            continue
        key, value = parsed
        os.environ.setdefault(key, value)


def parse_env_line(line: str) -> tuple[str, str] | None:
    stripped = line.strip()
    if not stripped or stripped.startswith("#"):
        return None
    if stripped.startswith("export "):
        stripped = stripped[len("export ") :].strip()
    if "=" not in stripped:
        return None
    key, value = stripped.split("=", 1)
    key = key.strip()
    if not key or not (key[0].isalpha() or key[0] == "_") or not all(char.isalnum() or char == "_" for char in key):
        return None
    return key, unquote(value.strip())


def unquote(value: str) -> str:
    if (value.startswith('"') and value.endswith('"')) or (value.startswith("'") and value.endswith("'")):
        return value[1:-1]
    return value


def parse_runtime_envs(value: str) -> dict[str, str]:
    if not value:
        return {}
    parsed = json.loads(value)
    if not isinstance(parsed, dict):
        raise ValueError("MAPLE_VEFAAS_RUNTIME_ENVS must be a JSON object")
    return {str(key): str(item) for key, item in parsed.items()}


def build_runtime_envs() -> dict[str, str]:
    envs = {
        "MAPLE_AGENT_RUNTIME_ROLE": "agent_loop",
        "MAPLE_AGENT_TEMPLATE_SOURCE": "runtime_request",
        "MAPLE_AGENT_LOOP_RUNTIME": "managed-agents-platform-vefaas",
        "MAPLE_AGENT_LOOP_INSTALL_POLICY": os.environ.get("MAPLE_AGENT_LOOP_INSTALL_POLICY", "never"),
    }
    optional = [
        "MAPLE_AGENT_LOOP_COMMAND",
        "MAPLE_AGENT_LOOP_INSTALL_TIMEOUT_SECONDS",
        "MAPLE_CLAUDE_AGENT_SDK_PYTHON",
        "MAPLE_CLAUDE_AGENT_SDK_RUNNER_COMMAND",
        "MAPLE_CLAUDE_CODE_COMMAND",
        "MAPLE_CLAUDE_CODE_VERSION",
        "MAPLE_CODEX_COMMAND",
        "MAPLE_CODEX_VERSION",
    ]
    for key in optional:
        if os.environ.get(key):
            envs[key] = str(os.environ[key])
    # Anthropic-compatible (ARK /api/coding) wiring + sandbox flag for the claude_code loop.
    # veFaaS does NOT inherit the image's ENV directives, so these MUST be set as function
    # envs: ARK exposes an Anthropic-compatible endpoint at /api/coding (glm in-region, no
    # Bedrock geo-block), and IS_SANDBOX=1 lets the root container run claude --print.
    envs.setdefault("IS_SANDBOX", "1")
    envs.setdefault("ANTHROPIC_BASE_URL", os.environ.get("ANTHROPIC_BASE_URL") or "https://ark.cn-beijing.volces.com/api/coding")
    envs.setdefault("ANTHROPIC_MODEL", os.environ.get("ANTHROPIC_MODEL") or "glm-4-7-251222")
    ark_key = os.environ.get("ANTHROPIC_AUTH_TOKEN") or os.environ.get("ARK_API_KEY")
    if ark_key:
        envs["ANTHROPIC_AUTH_TOKEN"] = ark_key
    envs.update(parse_runtime_envs(os.environ.get("MAPLE_VEFAAS_RUNTIME_ENVS") or ""))
    return envs


def csv_env(key: str) -> list[str]:
    return [part.strip() for part in (os.environ.get(key) or "").split(",") if part.strip()]


def parse_bool(value: str) -> bool:
    return value.strip().lower() in {"1", "true", "yes", "y", "on"}


def parse_optional_bool(value: str | None) -> bool | None:
    if value is None or value == "":
        return None
    return parse_bool(value)


def zip_source_dir(source_dir: Path) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for path in sorted(source_dir.rglob("*")):
            if path.is_dir() or should_skip_zip_path(path):
                continue
            arcname = path.relative_to(source_dir).as_posix()
            archive.write(path, arcname)
    return buffer.getvalue()


def should_skip_zip_path(path: Path) -> bool:
    parts = set(path.parts)
    return (
        "__pycache__" in parts
        or ".git" in parts
        or ".venv" in parts
        or "node_modules" in parts
        or path.suffix == ".pyc"
    )


def put_zip_bytes(url: str, data: bytes) -> None:
    request = urllib.request.Request(url, data=data, headers={"Content-Type": "application/zip"}, method="PUT")
    try:
        with urllib.request.urlopen(request, timeout=300, context=ssl_context()) as response:
            if response.status < 200 or response.status >= 300:
                raise RuntimeError(f"code upload failed with HTTP {response.status}")
    except urllib.error.HTTPError as error:
        raw = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"code upload failed with HTTP {error.code}: {raw}") from error


def ssl_context() -> ssl.SSLContext:
    cafile = os.environ.get("SSL_CERT_FILE") or certifi_path()
    return ssl.create_default_context(cafile=cafile)


def certifi_path() -> str | None:
    try:
        import certifi

        return certifi.where()
    except Exception:
        return None


def extract_system_url(application: dict[str, Any]) -> str:
    cloud_resource = parse_cloud_resource(application)
    url = cloud_resource.get("framework", {}).get("url", {}).get("system_url", "")
    if not url:
        raise RuntimeError(f"application response does not include system_url: {safe_json(application)}")
    return str(url)


def extract_function(application: dict[str, Any]) -> dict[str, Any]:
    return parse_cloud_resource(application).get("framework", {}).get("function", {})


def parse_cloud_resource(application: dict[str, Any]) -> dict[str, Any]:
    raw = application.get("CloudResource") or application.get("cloud_resource") or "{}"
    if isinstance(raw, str):
        return json.loads(raw)
    if isinstance(raw, dict):
        return raw
    return {}


def validate_name(value: str, label: str) -> None:
    if "_" in value:
        raise ValueError(f"{label} cannot contain underscores: {value}")
    if not value:
        raise ValueError(f"{label} is required")


def canonical_query(query: dict[str, str]) -> str:
    return "&".join(f"{urllib.parse.quote(str(key), safe='-_.~')}={urllib.parse.quote(str(query[key]), safe='-_.~')}" for key in sorted(query))


def hmac_sha256(key: bytes, content: str, *, raw: bool = False) -> bytes | str:
    digest = hmac.new(key, content.encode("utf-8"), hashlib.sha256).digest()
    return digest if raw else digest.hex()


def timestamp() -> str:
    return dt.datetime.now().strftime("%Y%m%d%H%M%S")


def safe_json(value: Any) -> str:
    text = json.dumps(value, ensure_ascii=False, default=str)
    text = re.sub(
        r'(?i)("Key"\s*:\s*"[^"]*(?:secret|password|api[_-]?key|access[_-]?key|token|credential)[^"]*"\s*,\s*"Value"\s*:\s*)"[^"]*"',
        r'\1"******"',
        text,
    )
    text = re.sub(
        r'(?i)("(?:secret|password|api[_-]?key|access[_-]?key|token|credential)[^"]*"\s*:\s*)"[^"]*"',
        r'\1"******"',
        text,
    )
    text = re.sub(r"(?i)(Credential=)[^&\"\\\s]+", r"\1******", text)
    text = re.sub(r"(?i)(Signature=)[^&\"\\\s]+", r"\1******", text)
    text = re.sub(r"(?i)(X-Tos-Credential=)[^&\"\\\s]+", r"\1******", text)
    text = re.sub(r"(?i)(X-Tos-Signature=)[^&\"\\\s]+", r"\1******", text)
    return text


def is_source_image_sync_running_error(error: Exception) -> bool:
    message = str(error).lower()
    return "source image sync is in running status" in message or "source image cache not ready" in message


def to_plain_dict(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return value
    if hasattr(value, "to_dict"):
        return value.to_dict()
    return dict(value)


def normalize_gateway_service(service: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": service.get("Id") or service.get("id"),
        "name": service.get("Name") or service.get("name") or service.get("ServiceName") or service.get("service_name"),
        "status": service.get("Status") or service.get("status"),
        "domains": service.get("Domains") or service.get("domains") or [],
    }


def normalize_gateway(gateway: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": gateway.get("Id") or gateway.get("id"),
        "name": gateway.get("Name") or gateway.get("name"),
        "type": gateway.get("Type") or gateway.get("type"),
        "status": gateway.get("Status") or gateway.get("status"),
    }


def normalized_route_prefix(config: DeployConfig) -> str:
    raw = config.route_prefix.strip() or f"/maple-runtime/{config.app_name}"
    prefixed = raw if raw.startswith("/") else f"/{raw}"
    return prefixed.rstrip("/") or "/"


def main() -> int:
    try:
        config = build_config_from_env()
        provisioner = VefaasDirectProvisioner(
            vefaas_api=VolcengineVefaasApi(config.access_key, config.secret_key, config.region),
            openapi=SignedOpenApiClient(access_key=config.access_key, secret_key=config.secret_key, region=config.region),
            apig_api=VolcengineApigApi(config.access_key, config.secret_key, config.region),
            apig_service_openapi=SignedOpenApiClient(access_key=config.access_key, secret_key=config.secret_key, region=config.region, service="apig", version="2021-03-03"),
            apig_openapi=SignedOpenApiClient(access_key=config.access_key, secret_key=config.secret_key, region=config.region, service="apig", version="2022-11-12"),
        )
        print(json.dumps(provisioner.deploy(config), ensure_ascii=False, indent=2))
        return 0
    except RuntimeError as error:
        print(str(error), file=sys.stderr)
        return 2
    except Exception as error:
        print(str(error), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

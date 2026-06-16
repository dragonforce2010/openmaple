#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import json
import os
import sys
import tempfile
import zipfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
MODULE_PATH = ROOT / "infra" / "vefaas" / "deploy_vefaas_runtime.py"
APP_DEPLOY_PATH = ROOT / "infra" / "vefaas" / "deploy_vefaas_application.py"


def load_module():
    source = MODULE_PATH.read_text()
    assert "veadk" not in source.lower(), "veFaaS provisioning must not import or mention veadk"
    spec = importlib.util.spec_from_file_location("deploy_vefaas_runtime", MODULE_PATH)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def test_backend_package_carries_runtime_provisioner_scripts():
    source = APP_DEPLOY_PATH.read_text()
    assert 'copy_source_dir(ROOT / "infra/vefaas", package_dir / "infra/vefaas")' in source
    runtime_source = MODULE_PATH.read_text()
    assert '"LoadBalancerSettings"' not in runtime_source
    assert '"LoadBalancerSettings"' not in source


class FakeVefaasApi:
    def __init__(self):
        self.created_functions = []
        self.upload_address_requests = []
        self.released_functions = []

    def create_function(self, spec):
        self.created_functions.append(spec)
        return "fn_contract"

    def get_code_upload_address(self, function_id, content_length):
        self.upload_address_requests.append({"function_id": function_id, "content_length": content_length})
        return "https://upload.example.invalid/runtime.zip"

    def release_function(self, function_id, config):
        self.released_functions.append({"function_id": function_id, "timeout": config.poll_timeout_seconds})


class FakeOpenApi:
    def __init__(self):
        self.calls = []

    def post(self, action, body):
        self.calls.append({"action": action, "body": body})
        if action == "ListApplications":
            return {"Result": {"Items": [], "Total": 0}}
        if action == "CodeUploadCallback":
            return {"Result": {"Status": "success"}}
        if action == "CreateApplication":
            return {"Result": {"Status": "create_success", "Id": "app_contract"}}
        if action == "ReleaseApplication":
            return {"Result": {"Status": "accepted"}}
        if action == "GetApplication":
            return {
                "Result": {
                    "Status": "deploy_success",
                    "CloudResource": json.dumps({"framework": {"url": {"system_url": "https://runtime.example.invalid"}}}),
                }
            }
        raise AssertionError(f"unexpected OpenAPI action: {action}")


class FakeUploader:
    def __init__(self):
        self.calls = []

    def __call__(self, url, data):
        self.calls.append({"url": url, "data": data})


class FakeApigApi:
    def __init__(self):
        self.calls = []

    def resolve_serverless_gateway(self, preferred_name, *, generated_name, poll_interval_seconds, poll_timeout_seconds):
        self.calls.append(
            {
                "preferred_name": preferred_name,
                "generated_name": generated_name,
                "poll_interval_seconds": poll_interval_seconds,
                "poll_timeout_seconds": poll_timeout_seconds,
            }
        )
        return {"id": "gw_contract", "name": "existing-serverless-gw"}

    def create_gateway_service(self, gateway_id, service_name, *, comments):
        self.calls.append({"gateway_id": gateway_id, "service_name": service_name, "comments": comments})
        return {"id": "svc_contract", "name": service_name, "domains": [{"Domain": "https://runtime.example.invalid"}]}

    def create_vefaas_upstream(self, gateway_id, name, function_id):
        self.calls.append({"gateway_id": gateway_id, "upstream_name": name, "function_id": function_id})
        return "upstream_contract"

    def service_url(self, service):
        return service["domains"][0]["Domain"]


class FakeApigOpenApi:
    def __init__(self):
        self.calls = []

    def post(self, action, body):
        self.calls.append({"action": action, "body": body})
        if action == "CreateRoute":
            return {"Result": {"Id": "route_contract"}}
        raise AssertionError(f"unexpected APIG action: {action}")


class FakeApigServiceOpenApi:
    def __init__(self):
        self.calls = []

    def post(self, action, body):
        self.calls.append({"action": action, "body": body})
        if action == "ListGatewayServices":
            return {
                "Result": {
                    "Items": [
                        {
                            "Id": "svc_contract",
                            "Name": "existing-service",
                            "Status": "Running",
                            "Domains": [{"Domain": "https://runtime.example.invalid"}],
                        }
                    ]
                }
            }
        raise AssertionError(f"unexpected APIG service action: {action}")


class FakeSdk:
    class TlsConfigForCreateFunctionInput:
        def __init__(self, **kwargs):
            self.kwargs = kwargs


def test_direct_provisioner_deploys_fixed_runtime_template():
    module = load_module()
    with tempfile.TemporaryDirectory() as temp:
        source_dir = Path(temp) / "runtime"
        source_dir.mkdir()
        (source_dir / "app.py").write_text("print('runtime')\n")
        run_sh = source_dir / "run.sh"
        run_sh.write_text("#!/bin/bash\npython3 app.py\n")
        run_sh.chmod(0o755)
        pycache = source_dir / "__pycache__"
        pycache.mkdir()
        (pycache / "ignored.pyc").write_bytes(b"ignored")

        fake_api = FakeVefaasApi()
        fake_openapi = FakeOpenApi()
        fake_uploader = FakeUploader()
        fake_apig = FakeApigApi()
        fake_apig_service_openapi = FakeApigServiceOpenApi()
        fake_apig_openapi = FakeApigOpenApi()
        config = module.DeployConfig(
            access_key="ak",
            secret_key="sk",
            region="cn-beijing",
            app_name="maple-contract",
            source_dir=source_dir,
            poll_interval_seconds=0,
            poll_timeout_seconds=1,
            envs={
                "MAPLE_AGENT_RUNTIME_ROLE": "agent_loop",
                "MAPLE_AGENT_TEMPLATE_SOURCE": "runtime_request",
                "MAPLE_AGENT_LOOP_RUNTIME": "managed-agents-platform-vefaas",
            },
        )

        result = module.VefaasDirectProvisioner(
            vefaas_api=fake_api,
            openapi=fake_openapi,
            apig_api=fake_apig,
            apig_service_openapi=fake_apig_service_openapi,
            apig_openapi=fake_apig_openapi,
            upload_bytes=fake_uploader,
            sleep=lambda _: None,
        ).deploy(config)

    gateway = result.pop("gateway")
    assert result == {
        "app_name": "maple-contract",
        "app_id": "",
        "function_name": "maple-contract-fn",
        "function_id": "fn_contract",
        "url": "https://runtime.example.invalid/maple-runtime/maple-contract",
        "invoke_url": "https://runtime.example.invalid/maple-runtime/maple-contract/invoke",
        "region": "cn-beijing",
        "reused": False,
    }
    assert gateway["gateway_id"] == "gw_contract"
    assert gateway["gateway_name"] == "existing-serverless-gw"
    assert gateway["service_id"] == "svc_contract"
    assert gateway["service_name"] == "existing-service"
    assert gateway["upstream_id"] == "upstream_contract"
    assert gateway["route_id"] == "route_contract"
    assert gateway["route_prefix"] == "/maple-runtime/maple-contract"
    assert gateway["url"] == "https://runtime.example.invalid/maple-runtime/maple-contract"
    assert fake_api.created_functions == [
        {
            "name": "maple-contract-fn",
            "description": "managed-agents-platform veFaaS runtime",
            "command": "./run.sh",
            "port": None,
            "cpu_strategy": None,
            "instance_type": None,
            "runtime": "native-python3.12/v1",
            "request_timeout": 1800,
            "memory_mb": 2048,
            "tls_config": {"enable_log": False, "tls_project_id": "", "tls_topic_id": ""},
            "vpc_config": {"vpc_id": "", "subnet_ids": [], "security_group_ids": [], "enable_shared_internet_access": None},
            "envs": {
                "MAPLE_AGENT_RUNTIME_ROLE": "agent_loop",
                "MAPLE_AGENT_TEMPLATE_SOURCE": "runtime_request",
                "MAPLE_AGENT_LOOP_RUNTIME": "managed-agents-platform-vefaas",
            },
            "tags": {"provider": "managed-agents-platform", "component": "agent-runtime"},
        }
    ]
    assert fake_api.upload_address_requests[0]["function_id"] == "fn_contract"
    assert fake_api.upload_address_requests[0]["content_length"] > 0
    assert fake_api.released_functions == [{"function_id": "fn_contract", "timeout": 1}]
    assert fake_uploader.calls[0]["url"] == "https://upload.example.invalid/runtime.zip"

    with tempfile.TemporaryDirectory() as temp:
        zip_path = Path(temp) / "runtime.zip"
        zip_path.write_bytes(fake_uploader.calls[0]["data"])
        with zipfile.ZipFile(zip_path) as archive:
            names = set(archive.namelist())
    assert "app.py" in names
    assert "run.sh" in names
    assert "__pycache__/ignored.pyc" not in names

    actions = [call["action"] for call in fake_openapi.calls]
    assert actions == ["ListApplications", "CodeUploadCallback"]
    assert fake_apig.calls[0]["generated_name"].startswith("maple-contract-gw-")
    assert fake_apig.calls[0]["poll_interval_seconds"] == 0
    assert fake_apig.calls[0]["poll_timeout_seconds"] == 1
    assert fake_apig_service_openapi.calls == [
        {"action": "ListGatewayServices", "body": {"GatewayId": "gw_contract", "PageNumber": 1, "PageSize": 50}}
    ]
    assert fake_apig.calls[1]["gateway_id"] == "gw_contract"
    assert fake_apig.calls[1]["upstream_name"].startswith("maple-contract-gw-us-")
    assert fake_apig.calls[1]["function_id"] == "fn_contract"
    assert fake_apig_openapi.calls[0]["action"] == "CreateRoute"
    route_body = fake_apig_openapi.calls[0]["body"]
    assert route_body["Name"].startswith("maple-runtime-")
    assert route_body["ServiceId"] == "svc_contract"
    assert route_body["ResourceType"] == "Console"
    assert route_body["Enable"] is True
    assert route_body["Priority"] == 100
    assert route_body["UpstreamList"] == [{"UpstreamId": "upstream_contract", "Weight": 100}]
    assert route_body["MatchRule"] == {
        "Path": {"MatchType": "Prefix", "MatchContent": "/maple-runtime/maple-contract"},
        "Method": ["POST", "GET", "PUT", "DELETE", "HEAD", "OPTIONS", "CONNECT"],
    }
    assert route_body["AdvancedSetting"] == {"CorsPolicySetting": {"Enable": True}}


def test_direct_provisioner_deploys_runtime_image_with_route():
    module = load_module()
    fake_api = FakeVefaasApi()
    fake_openapi = FakeOpenApi()
    fake_uploader = FakeUploader()
    fake_apig = FakeApigApi()
    fake_apig_service_openapi = FakeApigServiceOpenApi()
    fake_apig_openapi = FakeApigOpenApi()
    config = module.DeployConfig(
        access_key="ak",
        secret_key="sk",
        region="cn-beijing",
        app_name="maple-image-contract",
        image_url=module.DEFAULT_RUNTIME_IMAGE,
        runtime="native/v1",
        command="/opt/maple-runtime/run.sh",
        port=8000,
        poll_interval_seconds=0,
        poll_timeout_seconds=1,
        envs={"MAPLE_AGENT_LOOP_INSTALL_POLICY": "never"},
    )

    result = module.VefaasDirectProvisioner(
        vefaas_api=fake_api,
        openapi=fake_openapi,
        apig_api=fake_apig,
        apig_service_openapi=fake_apig_service_openapi,
        apig_openapi=fake_apig_openapi,
        upload_bytes=fake_uploader,
        sleep=lambda _: None,
    ).deploy(config)

    gateway = result.pop("gateway")
    assert result == {
        "app_name": "maple-image-contract",
        "app_id": "",
        "function_name": "maple-image-contract-fn",
        "function_id": "fn_contract",
        "url": "https://runtime.example.invalid/maple-runtime/maple-image-contract",
        "invoke_url": "https://runtime.example.invalid/maple-runtime/maple-image-contract/invoke",
        "image": module.DEFAULT_RUNTIME_IMAGE,
        "region": "cn-beijing",
        "reused": False,
        "released": True,
    }
    assert gateway["route_prefix"] == "/maple-runtime/maple-image-contract"
    assert fake_api.created_functions == [
        {
            "name": "maple-image-contract-fn",
            "description": "managed-agents-platform veFaaS runtime",
            "command": "/opt/maple-runtime/run.sh",
            "port": 8000,
            "cpu_strategy": None,
            "instance_type": None,
            "runtime": "native/v1",
            "request_timeout": 1800,
            "memory_mb": 2048,
            "tls_config": {"enable_log": False, "tls_project_id": "", "tls_topic_id": ""},
            "vpc_config": {"vpc_id": "", "subnet_ids": [], "security_group_ids": [], "enable_shared_internet_access": None},
            "envs": {"MAPLE_AGENT_LOOP_INSTALL_POLICY": "never"},
            "tags": {"provider": "managed-agents-platform", "component": "agent-runtime"},
            "source": module.DEFAULT_RUNTIME_IMAGE,
            "source_type": "image",
        }
    ]
    assert fake_api.upload_address_requests == []
    assert fake_uploader.calls == []
    assert fake_api.released_functions == [{"function_id": "fn_contract", "timeout": 1}]
    actions = [call["action"] for call in fake_openapi.calls]
    assert actions == ["ListApplications"]
    assert fake_apig.calls[1]["function_id"] == "fn_contract"
    assert fake_apig_openapi.calls[0]["action"] == "CreateRoute"


def test_config_loads_project_env_only_and_defaults_region():
    module = load_module()
    with tempfile.TemporaryDirectory() as temp:
        root = Path(temp)
        (root / ".env").write_text(
            "\n".join(
                [
                    "VOLCENGINE_ACCESS_KEY=project-ak",
                    "VOLCENGINE_SECRET_KEY=project-sk",
                    "MAPLE_VEFAAS_APP_NAME=maple-env-contract",
                    "",
                ]
            )
        )
        previous = {
            key: os.environ.get(key)
            for key in [
                "VOLCENGINE_ACCESS_KEY",
                "VOLCENGINE_SECRET_KEY",
                "MAPLE_VEFAAS_REGION",
                "VEFAAS_REGION",
                "MAPLE_AGENT_LOOP_INSTALL_POLICY",
                "MAPLE_CLAUDE_CODE_VERSION",
                "MAPLE_CODEX_VERSION",
            ]
        }
        for key in previous:
            os.environ.pop(key, None)
        try:
            config = module.build_config_from_env(cwd=root)
        finally:
            for key, value in previous.items():
                if value is None:
                    os.environ.pop(key, None)
                else:
                    os.environ[key] = value

    assert config.access_key == "project-ak"
    assert config.secret_key == "project-sk"
    assert config.region == "cn-beijing"
    assert config.app_name == "maple-env-contract"
    assert config.image_url == module.DEFAULT_RUNTIME_IMAGE
    assert config.runtime == "native/v1"
    assert config.command == "/opt/maple-runtime/run.sh"
    assert config.port == 8000
    assert config.enable_logs is False
    assert str(config.source_dir).endswith("infra/vefaas/runtime-app")
    assert config.envs["MAPLE_AGENT_RUNTIME_ROLE"] == "agent_loop"
    assert config.envs["MAPLE_AGENT_TEMPLATE_SOURCE"] == "runtime_request"
    assert config.envs["MAPLE_AGENT_LOOP_RUNTIME"] == "managed-agents-platform-vefaas"
    assert config.envs["MAPLE_AGENT_LOOP_INSTALL_POLICY"] == "never"


def test_agent_loop_cli_envs_are_forwarded_to_runtime():
    module = load_module()
    with tempfile.TemporaryDirectory() as temp:
        root = Path(temp)
        (root / ".env").write_text(
            "\n".join(
                [
                    "VOLCENGINE_ACCESS_KEY=project-ak",
                    "VOLCENGINE_SECRET_KEY=project-sk",
                    "MAPLE_AGENT_LOOP_INSTALL_POLICY=auto",
                    "MAPLE_CLAUDE_AGENT_SDK_RUNNER_COMMAND=python3 /opt/maple/claude_agent_sdk_runner.py",
                    "MAPLE_CLAUDE_CODE_VERSION=2.1.158",
                    "MAPLE_CODEX_COMMAND=/opt/codex/bin/codex",
                    'MAPLE_VEFAAS_RUNTIME_ENVS={"EXTRA_RUNTIME_ENV":"ok"}',
                    "",
                ]
            )
        )
        previous = {
            key: os.environ.get(key)
            for key in [
                "VOLCENGINE_ACCESS_KEY",
                "VOLCENGINE_SECRET_KEY",
                "MAPLE_AGENT_LOOP_INSTALL_POLICY",
                "MAPLE_CLAUDE_AGENT_SDK_RUNNER_COMMAND",
                "MAPLE_CLAUDE_CODE_VERSION",
                "MAPLE_CODEX_COMMAND",
                "MAPLE_VEFAAS_RUNTIME_ENVS",
            ]
        }
        for key in previous:
            os.environ.pop(key, None)
        try:
            config = module.build_config_from_env(cwd=root)
        finally:
            for key, value in previous.items():
                if value is None:
                    os.environ.pop(key, None)
                else:
                    os.environ[key] = value

    assert config.envs["MAPLE_AGENT_LOOP_INSTALL_POLICY"] == "auto"
    assert config.envs["MAPLE_CLAUDE_AGENT_SDK_RUNNER_COMMAND"] == "python3 /opt/maple/claude_agent_sdk_runner.py"
    assert config.envs["MAPLE_CLAUDE_CODE_VERSION"] == "2.1.158"
    assert config.envs["MAPLE_CODEX_COMMAND"] == "/opt/codex/bin/codex"
    assert config.envs["EXTRA_RUNTIME_ENV"] == "ok"


def test_config_can_disable_or_target_tls_logs_from_env():
    module = load_module()
    with tempfile.TemporaryDirectory() as temp:
        root = Path(temp)
        (root / ".env").write_text(
            "\n".join(
                [
                    "VOLCENGINE_ACCESS_KEY=project-ak",
                    "VOLCENGINE_SECRET_KEY=project-sk",
                    "MAPLE_VEFAAS_ENABLE_LOGS=false",
                    "MAPLE_VEFAAS_TLS_PROJECT_ID=tls-project-contract",
                    "MAPLE_VEFAAS_TLS_TOPIC_ID=tls-topic-contract",
                    "",
                ]
            )
        )
        previous = {
            key: os.environ.get(key)
            for key in [
                "VOLCENGINE_ACCESS_KEY",
                "VOLCENGINE_SECRET_KEY",
                "MAPLE_VEFAAS_ENABLE_LOGS",
                "MAPLE_VEFAAS_TLS_PROJECT_ID",
                "MAPLE_VEFAAS_TLS_TOPIC_ID",
            ]
        }
        for key in previous:
            os.environ.pop(key, None)
        try:
            config = module.build_config_from_env(cwd=root)
        finally:
            for key, value in previous.items():
                if value is None:
                    os.environ.pop(key, None)
                else:
                    os.environ[key] = value

    assert config.enable_logs is False
    assert config.tls_project_id == "tls-project-contract"
    assert config.tls_topic_id == "tls-topic-contract"


def test_tls_config_is_only_sent_when_fully_configured():
    module = load_module()
    api = object.__new__(module.VolcengineVefaasApi)
    api.sdk = FakeSdk

    assert api.create_tls_config({"enable_log": False, "tls_project_id": "", "tls_topic_id": ""}) is None
    try:
        api.create_tls_config({"enable_log": True, "tls_project_id": "", "tls_topic_id": ""})
    except ValueError as error:
        assert "MAPLE_VEFAAS_TLS_PROJECT_ID" in str(error)
        assert "MAPLE_VEFAAS_TLS_TOPIC_ID" in str(error)
    else:
        raise AssertionError("expected TLS logs to require project and topic")

    config = api.create_tls_config({"enable_log": True, "tls_project_id": "project", "tls_topic_id": "topic"})
    assert config.kwargs == {"enable_log": True, "tls_project_id": "project", "tls_topic_id": "topic"}


def test_openapi_fallback_uses_pascal_case_payloads():
    module = load_module()
    api = object.__new__(module.VolcengineVefaasApi)
    api.sdk = None
    api.client = None
    api.openapi = object()

    body = api.create_function_body(
        {
            "name": "maple-contract-fn",
            "description": "runtime",
            "command": "/opt/maple-runtime/run.sh",
            "port": 8000,
            "cpu_strategy": None,
            "instance_type": None,
            "runtime": "native/v1",
            "source": "image",
            "source_type": "image",
            "request_timeout": 1800,
            "memory_mb": 2048,
            "tls_config": {"enable_log": True, "tls_project_id": "tls-project", "tls_topic_id": "tls-topic"},
            "vpc_config": {"vpc_id": "vpc-1", "subnet_ids": ["subnet-1"], "security_group_ids": ["sg-1"], "enable_shared_internet_access": True},
            "envs": {"A": "1"},
            "tags": {"component": "agent-runtime"},
        }
    )

    assert body["Name"] == "maple-contract-fn"
    assert body["MemoryMB"] == 2048
    assert body["RequestTimeout"] == 1800
    assert body["Envs"] == [{"Key": "A", "Value": "1"}]
    assert body["Tags"] == [{"Key": "component", "Value": "agent-runtime"}]
    assert body["TlsConfig"] == {"EnableLog": True, "TlsProjectId": "tls-project", "TlsTopicId": "tls-topic"}
    assert body["VpcConfig"]["VpcId"] == "vpc-1"
    assert body["VpcConfig"]["EnableVpc"] is True
    assert module.normalize_gateway({"Id": "gw", "Name": "gateway", "Type": "serverless", "Status": "Running"}) == {
        "id": "gw",
        "name": "gateway",
        "type": "serverless",
        "status": "Running",
    }

    class RetryOpenApi:
        def __init__(self):
            self.release_calls = 0

        def post(self, action, body):
            if action == "Release":
                self.release_calls += 1
                if self.release_calls == 1:
                    raise RuntimeError("Source image sync is in Running status")
                return {"Result": {}}
            if action == "GetReleaseStatus":
                return {"Result": {"Status": "success"}}
            raise AssertionError(f"unexpected action {action}")

    retry_api = RetryOpenApi()
    api.openapi = retry_api
    api.release_function("fn_contract", module.DeployConfig(access_key="ak", secret_key="sk", poll_interval_seconds=0, poll_timeout_seconds=1))
    assert retry_api.release_calls == 2


def test_signed_openapi_client_builds_hmac_headers():
    module = load_module()
    client = module.SignedOpenApiClient(access_key="ak", secret_key="sk", region="cn-beijing")
    headers = client.sign("POST", "/", {"Action": "GetApplication", "Version": "2021-03-03"}, "{}")

    assert headers["Host"] == "open.volcengineapi.com"
    assert headers["Content-Type"] == "application/json"
    assert headers["X-Content-Sha256"] == "44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a"
    assert headers["Authorization"].startswith("HMAC-SHA256 Credential=ak/")
    assert "SignedHeaders=content-type;host;x-content-sha256;x-date" in headers["Authorization"]
    assert "Signature=" in headers["Authorization"]


def test_env_parser_and_error_json_are_defensive():
    module = load_module()

    assert module.parse_env_line("=ignored") is None
    assert module.parse_env_line("1BAD=value") is None
    assert module.parse_env_line("GOOD_KEY='value'") == ("GOOD_KEY", "value")
    assert module.is_source_image_sync_running_error(Exception("Source image sync is in Running status, please wait"))
    assert module.is_source_image_sync_running_error(Exception("Source image cache not ready, statusPhase is Creating"))

    text = module.safe_json({"url": "https://example.invalid?X-Tos-Credential=abc123&X-Tos-Signature=def456"})
    assert "abc123" not in text
    assert "def456" not in text
    assert "X-Tos-Credential=******" in text
    assert "X-Tos-Signature=******" in text


if __name__ == "__main__":
    test_backend_package_carries_runtime_provisioner_scripts()
    test_direct_provisioner_deploys_fixed_runtime_template()
    test_direct_provisioner_deploys_runtime_image_with_route()
    test_config_loads_project_env_only_and_defaults_region()
    test_agent_loop_cli_envs_are_forwarded_to_runtime()
    test_config_can_disable_or_target_tls_logs_from_env()
    test_tls_config_is_only_sent_when_fully_configured()
    test_openapi_fallback_uses_pascal_case_payloads()
    test_signed_openapi_client_builds_hmac_headers()
    test_env_parser_and_error_json_are_defensive()
    print("veFaaS provisioner contract passed")

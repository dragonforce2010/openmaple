#!/usr/bin/env python3
"""Update the EXISTING veFaaS runtime function code in place.

Reuses the function/app/APIG that codex already provisioned (FUNCTION_ID from
.env) — uploads fresh infra/vefaas/runtime-app/ code and does a function-level
Release. It never creates a function, application, or gateway, so the APIG route
and invoke URL stay stable.

Usage: python3 infra/vefaas/deploy_vefaas_update.py
Env (from project .env): VOLCENGINE_ACCESS_KEY/SECRET_KEY, MAPLE_VEFAAS_FUNCTION_ID
(or VEFAAS_FUNCTION_ID), MAPLE_VEFAAS_REGION, MAPLE_VEFAAS_INVOKE_URL (optional smoke).
"""
from __future__ import annotations

import json
import os
import sys
import time
import urllib.request
from pathlib import Path
from types import SimpleNamespace

import deploy_vefaas_application as app_deploy
from deploy_vefaas_runtime import (
    SignedOpenApiClient,
    VolcengineVefaasApi,
    load_project_env,
    put_zip_bytes,
    safe_json,
    zip_source_dir,
)

ROOT = Path(__file__).resolve().parents[2]
RUNTIME_SRC = Path(__file__).resolve().parent / "runtime-app"


def main() -> int:
    load_project_env(ROOT)
    function_id = os.environ.get("MAPLE_VEFAAS_FUNCTION_ID") or os.environ.get("VEFAAS_FUNCTION_ID")
    if not function_id:
        print("missing MAPLE_VEFAAS_FUNCTION_ID / VEFAAS_FUNCTION_ID", file=sys.stderr)
        return 2
    access_key = os.environ.get("VOLCENGINE_ACCESS_KEY") or os.environ.get("VOLC_ACCESSKEY")
    secret_key = os.environ.get("VOLCENGINE_SECRET_KEY") or os.environ.get("VOLC_SECRETKEY")
    if not access_key or not secret_key:
        print("missing VOLCENGINE_ACCESS_KEY / VOLCENGINE_SECRET_KEY", file=sys.stderr)
        return 2
    if not RUNTIME_SRC.exists():
        print(f"runtime source dir missing: {RUNTIME_SRC}", file=sys.stderr)
        return 2
    region = os.environ.get("MAPLE_VEFAAS_REGION") or os.environ.get("VEFAAS_REGION") or "cn-beijing"
    invoke_url = os.environ.get("MAPLE_VEFAAS_INVOKE_URL") or os.environ.get("VEFAAS_INVOKE_URL") or ""

    api = VolcengineVefaasApi(access_key, secret_key, region)
    openapi = SignedOpenApiClient(access_key=access_key, secret_key=secret_key, region=region)
    release_client = SignedOpenApiClient(
        access_key=access_key, secret_key=secret_key, region=region, service="vefaas", version="2024-06-06"
    )
    release_config = SimpleNamespace(
        poll_timeout_seconds=float(os.environ.get("MAPLE_VEFAAS_RELEASE_TIMEOUT_S") or "600"),
        poll_interval_seconds=float(os.environ.get("MAPLE_VEFAAS_RELEASE_INTERVAL_S") or "10"),
    )

    # 1) upload fresh code to the existing function (no create)
    code_zip = zip_source_dir(RUNTIME_SRC)
    upload_url = api.get_code_upload_address(function_id, len(code_zip))
    put_zip_bytes(upload_url, code_zip)
    openapi.post("CodeUploadCallback", {"FunctionId": function_id})

    # 2) function-level release — leaves the APIG gateway/route/app untouched
    release = app_deploy.release_function(release_client, function_id, release_config)
    app_id = os.environ.get("MAPLE_VEFAAS_APP_ID") or os.environ.get("VEFAAS_APP_ID") or ""
    application = {}
    if app_id:
        openapi.post("ReleaseApplication", {"Id": app_id})
        application = wait_for_application(openapi, app_id, release_config)

    result = {
        "function_id": function_id,
        "app_id": app_id,
        "region": region,
        "code_bytes": len(code_zip),
        "release": release,
        "application_status": application.get("Status"),
        "invoke_url": invoke_url,
        "apig": "untouched",
    }

    # 3) optional smoke: the function should answer with JSON (400 unknown action proves it's live)
    if invoke_url:
        try:
            request = urllib.request.Request(
                invoke_url,
                data=json.dumps({"action": "__deploy_smoke__"}).encode("utf-8"),
                headers={"content-type": "application/json"},
                method="POST",
            )
            with urllib.request.urlopen(request, timeout=30) as response:
                result["smoke_status"] = response.status
                result["smoke_body"] = response.read(400).decode("utf-8", "replace")
        except urllib.error.HTTPError as error:
            result["smoke_status"] = error.code
            result["smoke_body"] = error.read(400).decode("utf-8", "replace")
        except Exception as error:  # noqa: BLE001
            result["smoke_error"] = str(error)

    print(safe_json(result))
    return 0


def wait_for_application(openapi: SignedOpenApiClient, app_id: str, config: SimpleNamespace) -> dict:
    deadline = time.monotonic() + float(config.poll_timeout_seconds)
    last = {}
    while True:
        last = openapi.post("GetApplication", {"Id": app_id})
        result = last.get("Result", {})
        status = result.get("Status")
        if status == "deploy_success":
            return result
        if status == "deploy_fail":
            raise RuntimeError(f"ReleaseApplication failed: {safe_json(last)}")
        if time.monotonic() >= deadline:
            raise TimeoutError(f"ReleaseApplication timed out: {safe_json(last)}")
        time.sleep(float(config.poll_interval_seconds))


if __name__ == "__main__":
    raise SystemExit(main())

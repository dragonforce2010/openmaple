#!/usr/bin/env python3
"""Push the locally-built runtime image to CR and re-release the live runtime functions.

Steps: cr login (GetAuthorizationToken -> docker login) | push (tag + docker push) |
release (update each function source=image + release). Runtime function ids are passed as
args or via MAPLE_RUNTIME_FUNCTION_IDS (csv). CR auth tokens expire ~48h, so re-login each run.

Usage: python3 infra/vefaas/push_and_release_runtime.py [all|login|push|release] [fn_id ...]
"""
import os
import subprocess
import sys
import time
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parent))
from deploy_vefaas_runtime import load_project_env, VolcengineVefaasApi  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
load_project_env(ROOT)

IMAGE = os.environ.get("MAPLE_VEFAAS_IMAGE") or "maple-vefaas-runtime:latest"
LOCAL = os.environ.get("MAPLE_LOCAL_IMAGE") or "maple-vefaas-runtime:ark"
REGISTRY = os.environ.get("MAPLE_CR_REGISTRY") or ""
ACCESS_KEY = os.environ.get("VOLCENGINE_ACCESS_KEY") or os.environ.get("VOLC_ACCESSKEY")
SECRET_KEY = os.environ.get("VOLCENGINE_SECRET_KEY") or os.environ.get("VOLC_SECRETKEY")
REGION = os.environ.get("MAPLE_VEFAAS_REGION") or "cn-beijing"
FUNCTIONS = [fn for fn in sys.argv[2:] if fn] or [fn for fn in (os.environ.get("MAPLE_RUNTIME_FUNCTION_IDS") or "").split(",") if fn.strip()]


def cr_login():
    if not REGISTRY:
        raise SystemExit("MAPLE_CR_REGISTRY is required for CR login.")
    import volcenginesdkcore
    import volcenginesdkcr

    config = volcenginesdkcore.Configuration()
    config.ak = ACCESS_KEY
    config.sk = SECRET_KEY
    config.region = REGION
    volcenginesdkcore.Configuration.set_default(config)
    client = volcenginesdkcr.CRApi(volcenginesdkcore.ApiClient(config))
    token = client.get_authorization_token(volcenginesdkcr.GetAuthorizationTokenRequest(registry=REGISTRY))
    domain = IMAGE.split("/")[0]
    proc = subprocess.run(
        ["docker", "login", domain, "--username", getattr(token, "username", ""), "--password-stdin"],
        input=getattr(token, "token", ""), text=True, capture_output=True, timeout=60,
    )
    if proc.returncode != 0:
        raise SystemExit(f"docker login failed: {proc.stderr}")
    print("docker login ok")


def push():
    subprocess.run(["docker", "tag", LOCAL, IMAGE], check=True)
    if subprocess.run(["docker", "push", IMAGE], text=True, timeout=1200).returncode != 0:
        raise SystemExit("docker push failed")
    print("push ok")


def release(skip_update=False):
    if not FUNCTIONS:
        raise SystemExit("release needs function ids (args or MAPLE_RUNTIME_FUNCTION_IDS)")
    api = VolcengineVefaasApi(ACCESS_KEY, SECRET_KEY, REGION)
    config = SimpleNamespace(poll_timeout_seconds=900.0, poll_interval_seconds=12.0)
    for function_id in FUNCTIONS:
        try:
            if not skip_update:
                # pointing source at the image triggers a CR->function sync; release must wait
                # for it (release_function retries on "sync is in Running status")
                api.client.update_function(api.sdk.UpdateFunctionRequest(id=function_id, source=IMAGE, source_type="image"))
            started = time.monotonic()
            api.release_function(function_id, config)
            print(f"[{function_id}] released in {time.monotonic() - started:.0f}s")
        except Exception as error:
            print(f"[{function_id}] FAILED: {str(error)[:160]}")


def main():
    step = sys.argv[1] if len(sys.argv) > 1 else "all"
    if step in ("login", "all"):
        cr_login()
    if step in ("push", "all"):
        push()
    if step == "release-only":
        release(skip_update=True)
    elif step in ("release", "all"):
        release()


if __name__ == "__main__":
    main()

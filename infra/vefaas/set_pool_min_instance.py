#!/usr/bin/env python3
"""One-off ops: set reserved concurrency (min/max instance) on EXISTING veFaaS pool functions.

New pool functions get this automatically via deploy_vefaas_runtime.py, but functions that
were already provisioned scale to zero and must be updated in place once.

Usage: python3 infra/vefaas/set_pool_min_instance.py <fn_id> [<fn_id> ...]
   or: MAPLE_POOL_FUNCTION_IDS=fn1,fn2 python3 infra/vefaas/set_pool_min_instance.py
Env: MAPLE_VEFAAS_MIN_INSTANCE (default 1), MAPLE_VEFAAS_MAX_INSTANCE (default 10).
"""
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from deploy_vefaas_runtime import load_project_env, VolcengineVefaasApi  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
load_project_env(ROOT)

access_key = os.environ.get("VOLCENGINE_ACCESS_KEY") or os.environ.get("VOLC_ACCESSKEY")
secret_key = os.environ.get("VOLCENGINE_SECRET_KEY") or os.environ.get("VOLC_SECRETKEY")
region = os.environ.get("MAPLE_VEFAAS_REGION") or os.environ.get("VEFAAS_REGION") or "cn-beijing"
min_instance = int(os.environ.get("MAPLE_VEFAAS_MIN_INSTANCE") or "1")
max_instance = int(os.environ.get("MAPLE_VEFAAS_MAX_INSTANCE") or "10")

function_ids = [fn for fn in sys.argv[1:] if fn] or [fn for fn in (os.environ.get("MAPLE_POOL_FUNCTION_IDS") or "").split(",") if fn.strip()]
if not function_ids:
    raise SystemExit("provide one or more function ids as args or via MAPLE_POOL_FUNCTION_IDS")
if not access_key or not secret_key:
    raise SystemExit("missing VOLCENGINE_ACCESS_KEY / VOLCENGINE_SECRET_KEY")

api = VolcengineVefaasApi(access_key, secret_key, region)
for function_id in function_ids:
    try:
        api.update_function_resource(function_id, min_instance, max_instance)
        print(f"{function_id}: min={min_instance} max={max_instance} OK")
    except Exception as error:
        print(f"{function_id}: FAILED {error}")

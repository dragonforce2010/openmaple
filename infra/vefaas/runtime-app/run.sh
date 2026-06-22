#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
export MAPLE_RUNTIME_APP_DIR="$PWD"
if [[ "${MAPLE_SKIP_CLAUDE_AGENT_SDK_INSTALL:-false}" != "true" ]] && ! python3 -c "import claude_agent_sdk" >/dev/null 2>&1; then
  deps_dir="${MAPLE_VEFAAS_PYDEPS_DIR:-/tmp/maple-vefaas-runtime-pydeps}"
  mkdir -p "$deps_dir"
  python3 -m pip install --no-cache-dir -i "${MAPLE_PIP_INDEX_URL:-https://pypi.tuna.tsinghua.edu.cn/simple}" --target "$deps_dir" -r requirements.txt
  export PYTHONPATH="$deps_dir:${PYTHONPATH:-}"
fi
exec python3 app.py

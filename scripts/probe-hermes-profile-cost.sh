#!/usr/bin/env bash
# 只读探测:Hermes profile/gateway 的开销与常驻语义。不改任何配置、不起新进程、不碰飞书。
# 用途:为「OpenClaw 三件套 -> Hermes 路线B」补测 3 个常驻 gateway 的真实成本。
# 在普通(非沙箱)终端跑:bash scripts/probe-hermes-profile-cost.sh
set -uo pipefail

HERMES="${HERMES:-$HOME/.local/bin/hermes}"
line(){ printf '\n========== %s ==========\n' "$1"; }

line "0. 环境"
"$HERMES" --version 2>&1 | head -3
echo "uname: $(uname -msr)"
# 物理内存(Mac)
if command -v sysctl >/dev/null; then
  echo "物理内存: $(( $(sysctl -n hw.memsize) / 1024 / 1024 )) MB"
fi

line "1. 现有 profile 列表"
"$HERMES" profile list 2>&1

line "2. 当前在跑的 hermes/gateway 进程 + 各自 RSS 内存(MB)"
# 列出所有 hermes 相关进程,打印 RSS(MB)、PID、命令
ps axo pid,rss,etime,command 2>/dev/null \
  | grep -iE 'hermes|gateway' \
  | grep -viE 'grep|probe-hermes' \
  | awk '{ rss=$2/1024; printf "%7.0fMB  pid=%-7s up=%-12s %s\n", rss, $1, $3, substr($0, index($0,$4)) }'
echo "---"
echo -n "hermes 相关进程总数: "
ps axo pid,command 2>/dev/null | grep -iE 'hermes|gateway' | grep -viE 'grep|probe-hermes' | wc -l | tr -d ' '
echo -n "其中 gateway 进程数: "
ps axo pid,command 2>/dev/null | grep -iE 'gateway' | grep -viE 'grep|probe-hermes' | wc -l | tr -d ' '
echo "---"
echo "hermes 相关进程 RSS 合计(MB):"
ps axo rss,command 2>/dev/null | grep -iE 'hermes|gateway' | grep -viE 'grep|probe-hermes' \
  | awk '{ s+=$1 } END { printf "%.0f MB\n", s/1024 }'

line "3. watch-dog profile 详情(已迁的活样本)"
"$HERMES" profile show watch-dog 2>&1 | head -25

line "4. watch-dog 的连接模式(websocket=必须常驻 / webhook=可被动唤醒)"
WD=~/.hermes/profiles/watch-dog/config.yaml
if [ -f "$WD" ]; then
  python3 - "$WD" <<'PY'
import sys, yaml
d = yaml.safe_load(open(sys.argv[1]))
fe = (d.get("platforms") or {}).get("feishu") or {}
extra = fe.get("extra") or {}
print("platforms.feishu.app_id        :", fe.get("app_id"))
print("connection_mode (顶层)         :", fe.get("connection_mode"))
print("connection_mode (extra)        :", extra.get("connection_mode"))
print("home_channel                   :", fe.get("home_channel"))
PY
else
  echo "watch-dog config.yaml 不存在"
fi

line "5. profile 启停语义(能否随用随停)"
echo "-- hermes profile use --help（设默认 profile，不等于启停） --"
"$HERMES" profile use --help 2>&1 | head -8
echo "-- 是否有 start/stop/serve/gateway 子命令（决定能否按需起停单个 profile） --"
"$HERMES" --help 2>&1 | grep -iE 'start|stop|serve|gateway|restart|daemon|up|down' | head -20
echo "-- gateway 子命令详情(若存在) --"
"$HERMES" gateway --help 2>&1 | head -20

line "6. watch-dog gateway 状态(running? pid?)"
cat ~/.hermes/profiles/watch-dog/gateway_state.json 2>/dev/null | python3 -m json.tool 2>/dev/null | head -20
echo "pid 文件: $(cat ~/.hermes/profiles/watch-dog/gateway.pid 2>/dev/null || echo '无')"

line "7. 磁盘:watch-dog profile 占用(clone 出来的 profile 大致同量级)"
du -sh ~/.hermes/profiles/watch-dog 2>/dev/null
du -sh ~/.hermes/profiles/watch-dog/state.db 2>/dev/null
echo "(注:state.db 含历史会话,新 clone profile 初始会小很多)"

line "完成"
echo "把以上完整输出贴回给我,我据此判断 3 个常驻 gateway 的成本与是否需 7x24 常驻。"

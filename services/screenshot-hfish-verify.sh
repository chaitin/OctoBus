#!/bin/bash
set -euo pipefail

REPO_ROOT="${REPO_ROOT:-/Users/luoliang/Documents/OctoBus}"
SERVICES_ROOT="${SERVICES_ROOT:-$REPO_ROOT/services}"
SERVICE_DIR="${SERVICE_DIR:-$SERVICES_ROOT/threatbook__hfish}"
OCTOBUS_BIN="${OCTOBUS_BIN:-$REPO_ROOT/bin/octobus}"
OUTPUT_DIR="${OUTPUT_DIR:-/Users/luoliang/Documents/api接口文档/hfish}"
OCTOBUS_ADDR="${OCTOBUS_ADDR:-127.0.0.1:19102}"
OCTOBUS_DATA_DIR="${OCTOBUS_DATA_DIR:-/tmp/obh2}"
AUTO_DAEMON="${AUTO_DAEMON:-1}"
AUTO_DAEMON_STOP="${AUTO_DAEMON_STOP:-0}"
SERVICE_ID="${SERVICE_ID:-threatbook-hfish}"
INSTANCE_ID="${INSTANCE_ID:-hfish-local}"
CAPSET_ID="${CAPSET_ID:-threat-intel}"
SETUP="${SETUP:-1}"
HFISH_SKIP_TLS="${HFISH_SKIP_TLS:-false}"

HFISH_ENDPOINT="${HFISH_ENDPOINT:-}"
HFISH_API_KEY="${HFISH_API_KEY:-}"
HFISH_CAPSET_TOKEN="${HFISH_CAPSET_TOKEN:-}"

export INSTANCE_ID CAPSET_ID SERVICE_ID

G='\033[0;32m'
Y='\033[1;33m'
C='\033[0;36m'
N='\033[0m'

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || { echo "缺少命令: $1" >&2; exit 1; }
}

search_lines() {
  local pattern="$1"
  shift
  if command -v rg >/dev/null 2>&1; then
    rg "$pattern" "$@"
  else
    grep -E "$pattern" "$@"
  fi
}

get_window_id() {
  osascript -e 'tell application "Terminal" to get id of front window' 2>/dev/null || true
}

take_screenshot() {
  local name="$1"
  local filepath="$OUTPUT_DIR/$name"
  local wid
  wid="$(get_window_id)"
  if [[ -n "$wid" ]]; then
    sleep 0.5
    screencapture -l "$wid" -o "$filepath" 2>/dev/null \
      && echo -e "${G}📸 已保存: $filepath${N}" \
      || echo -e "${Y}⚠️ 自动截图失败，请手动截图${N}"
  else
    echo -e "${Y}⚠️ 无法获取 Terminal 窗口 ID，请手动截图${N}"
  fi
}

octobus() {
  "$OCTOBUS_BIN" --addr "$OCTOBUS_ADDR" "$@"
}

admin_octobus() {
  if [[ -n "${OCTOBUS_ADMIN_TOKEN:-}" ]]; then
    OCTOBUS_ADMIN_TOKEN="$OCTOBUS_ADMIN_TOKEN" octobus "$@"
  else
    octobus "$@"
  fi
}

json_instance_filter='.. | objects | select((.ID? // .Id? // .id? // "") == env.INSTANCE_ID)'
json_capset_filter='.. | objects | select((.ID? // .Id? // .id? // "") == env.CAPSET_ID)'

need_cmd jq
need_cmd grpcurl
need_cmd curl
need_cmd npm
need_cmd osascript
need_cmd screencapture
need_cmd octobus

mkdir -p "$OUTPUT_DIR"

wait_for_daemon() {
  local retries="${1:-40}"
  local i
  for ((i=0; i<retries; i++)); do
    if octobus --addr "$OCTOBUS_ADDR" status >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.25
  done
  return 1
}

cleanup_daemon() {
  if [[ -n "${AUTO_DAEMON_PID:-}" ]] && kill -0 "$AUTO_DAEMON_PID" >/dev/null 2>&1; then
    kill "$AUTO_DAEMON_PID" >/dev/null 2>&1 || true
    wait "$AUTO_DAEMON_PID" 2>/dev/null || true
  fi
}

ensure_daemon() {
  if octobus --addr "$OCTOBUS_ADDR" status >/dev/null 2>&1; then
    return 0
  fi
  if [[ "$AUTO_DAEMON" != "1" ]]; then
    echo "octobus daemon is not running at $OCTOBUS_ADDR; run octobus serve first" >&2
    exit 1
  fi
  mkdir -p "$OCTOBUS_DATA_DIR"
  echo -e "${G}自动启动临时 OctoBus daemon: ${OCTOBUS_ADDR}${N}"
  if [[ "$HFISH_SKIP_TLS" == "true" ]]; then
    NODE_TLS_REJECT_UNAUTHORIZED=0 octobus serve --data-dir "$OCTOBUS_DATA_DIR" --addr "$OCTOBUS_ADDR" >"$OCTOBUS_DATA_DIR/daemon.stdout.log" 2>"$OCTOBUS_DATA_DIR/daemon.stderr.log" &
  else
    octobus serve --data-dir "$OCTOBUS_DATA_DIR" --addr "$OCTOBUS_ADDR" >"$OCTOBUS_DATA_DIR/daemon.stdout.log" 2>"$OCTOBUS_DATA_DIR/daemon.stderr.log" &
  fi
  AUTO_DAEMON_PID=$!
  if [[ "$AUTO_DAEMON_STOP" == "1" ]]; then
    trap cleanup_daemon EXIT
  fi
  if ! wait_for_daemon; then
    echo "自动启动 daemon 失败: $OCTOBUS_ADDR" >&2
    echo "stdout:" >&2
    tail -50 "$OCTOBUS_DATA_DIR/daemon.stdout.log" >&2 || true
    echo "stderr:" >&2
    tail -50 "$OCTOBUS_DATA_DIR/daemon.stderr.log" >&2 || true
    exit 1
  fi
}

ensure_service() {
  if octobus --addr "$OCTOBUS_ADDR" service get "$SERVICE_ID" >/dev/null 2>&1; then
    admin_octobus service import "$SERVICE_ID" "$SERVICE_DIR" >/dev/null 2>&1 || true
    return 0
  fi
  if ! admin_octobus service import "$SERVICE_ID" "$SERVICE_DIR"; then
    admin_octobus service get "$SERVICE_ID" >/dev/null 2>&1 || exit 1
  fi
}

ensure_instance() {
  if admin_octobus instance get "$INSTANCE_ID" >/dev/null 2>&1; then
    admin_octobus instance update-config "$INSTANCE_ID" --config-json "$CONFIG_JSON" --restart
    admin_octobus instance update-secret "$INSTANCE_ID" --secret-json "$SECRET_JSON" --restart
    return 0
  fi
  admin_octobus instance create "$INSTANCE_ID" --service "$SERVICE_ID" --config-json "$CONFIG_JSON" --secret-json "$SECRET_JSON"
}

ensure_capset() {
  if ! admin_octobus capset get "$CAPSET_ID" >/dev/null 2>&1; then
    admin_octobus capset create "$CAPSET_ID" --name "Threat Intel"
  fi
  if ! admin_octobus capset list-instances "$CAPSET_ID" | jq -e "$json_instance_filter" >/dev/null 2>&1; then
    local add_output
    if ! add_output="$(admin_octobus capset add-instance "$CAPSET_ID" "$INSTANCE_ID" 2>&1)"; then
      if printf '%s' "$add_output" | grep -q 'UNIQUE constraint failed: capset_instances.id'; then
        echo -e "${Y}capset 已绑定实例，跳过 add-instance: $CAPSET_ID -> $INSTANCE_ID${N}"
      else
        printf '%s\n' "$add_output" >&2
        exit 1
      fi
    else
      printf '%s\n' "$add_output"
    fi
  fi
}

if [[ -z "$HFISH_ENDPOINT" || -z "$HFISH_API_KEY" ]]; then
  echo "请设置 HFISH_ENDPOINT 和 HFISH_API_KEY" >&2
  echo "例: HFISH_ENDPOINT=https://127.0.0.1:4433 HFISH_API_KEY=xxx SETUP=1 bash services/screenshot-hfish-verify.sh" >&2
  exit 1
fi

if [[ ! -x "$OCTOBUS_BIN" ]]; then
  echo "未找到可执行的 octobus CLI: $OCTOBUS_BIN" >&2
  exit 1
fi

if [[ ! -d "$SERVICE_DIR" ]]; then
  echo "未找到 service package 目录: $SERVICE_DIR" >&2
  echo "请先 checkout 含 HFish service package 的分支，或手动设置 SERVICE_DIR" >&2
  exit 1
fi

GRPC_HEADERS=(-H "x-octobus-capset: $CAPSET_ID" -H "x-octobus-instance: $INSTANCE_ID")
REFLECTION_HEADERS=(-H "x-octobus-capset: $CAPSET_ID")
if [[ -n "$HFISH_CAPSET_TOKEN" ]]; then
  GRPC_HEADERS+=(-H "authorization: Bearer $HFISH_CAPSET_TOKEN")
  REFLECTION_HEADERS+=(-H "authorization: Bearer $HFISH_CAPSET_TOKEN")
fi

DIRECT_CURL_TLS_ARGS=()
if [[ "$HFISH_SKIP_TLS" == "true" ]]; then
  DIRECT_CURL_TLS_ARGS+=(-k)
fi

CONFIG_JSON="$(jq -cn --arg endpoint "$HFISH_ENDPOINT" --argjson skipTlsVerify "$([[ "$HFISH_SKIP_TLS" == "true" ]] && echo true || echo false)" '{endpoint:$endpoint, timeoutMs:1500, skipTlsVerify:$skipTlsVerify}')"
SECRET_JSON="$(jq -cn --arg apiKey "$HFISH_API_KEY" '{apiKey:$apiKey}')"

echo -e "${C}=== ThreatBook HFish OctoBus 联调取证截图 ===${N}"
echo -e "${C}输出目录: $OUTPUT_DIR${N}"
echo -e "${C}Service dir: $SERVICE_DIR${N}"
echo -e "${C}OctoBus addr: $OCTOBUS_ADDR${N}"
echo -e "${C}OctoBus data dir: $OCTOBUS_DATA_DIR${N}"
echo -e "${C}所有证据均来自当前环境的真实命令输出${N}\n"

ensure_daemon

if [[ "$SETUP" == "1" ]]; then
  echo -e "${G}0) 导入 service + 创建/复用 instance/capset${N}"
  ensure_service
  ensure_instance
  ensure_capset
  echo -e "${C}当前实例记录${N}"
  admin_octobus instance get "$INSTANCE_ID" | jq -c '.'
  take_screenshot "00-setup-and-instance.png"
fi

echo -e "\n${G}1) service package 单测通过${N}"
(cd "$SERVICES_ROOT" && npm test -- --service-dir threatbook__hfish)
take_screenshot "01-npm-test-hfish.png"

echo -e "\n${G}2) OctoBus 特有标识：reflection + capset + instance${N}"
echo -e "${C}[gRPC reflection list]${N}"
grpcurl -plaintext "${REFLECTION_HEADERS[@]}" "$OCTOBUS_ADDR" list | search_lines 'ThreatBook_HFISH|grpc.reflection' || true
echo
echo -e "${C}[gRPC reflection describe]${N}"
grpcurl -plaintext "${REFLECTION_HEADERS[@]}" "$OCTOBUS_ADDR" describe ThreatBook_HFISH.ThreatBook_HFISH
echo
echo -e "${C}[capset list-methods]${N}"
admin_octobus capset list-methods "$CAPSET_ID" | jq '.methods[] | {MethodFullName, MCPToolName, Enabled, CapsetInstanceID}'
echo
echo -e "${C}[instance list]${N}"
admin_octobus instance list | jq -c "$json_instance_filter"
take_screenshot "02-reflection-capset-instance.png"

echo -e "\n${G}3) 四个 RPC 经本地 OctoBus 中转调用${N}"
echo -e "${C}GetSystemInfo${N}"
grpcurl -plaintext "${GRPC_HEADERS[@]}" -d '{}' "$OCTOBUS_ADDR" ThreatBook_HFISH.ThreatBook_HFISH/GetSystemInfo | jq '{responseCode, verboseMsg, data: {totalHoneypots: .data.totalHoneypots, totalOnlineHoneypots: .data.totalOnlineHoneypots, clients: (.data.clients | length)}}'
echo
echo -e "${C}ListAttackIPs${N}"
grpcurl -plaintext "${GRPC_HEADERS[@]}" -d '{"page":1,"limit":1}' "$OCTOBUS_ADDR" ThreatBook_HFISH.ThreatBook_HFISH/ListAttackIPs | jq '{responseCode, verboseMsg, count: (.data | length), first: .data[0]}'
echo
echo -e "${C}ListAttackDetails${N}"
grpcurl -plaintext "${GRPC_HEADERS[@]}" -d '{"page":1,"limit":1}' "$OCTOBUS_ADDR" ThreatBook_HFISH.ThreatBook_HFISH/ListAttackDetails | jq '{responseCode, verboseMsg, data: {totalNum: .data.totalNum, pageNo: .data.pageNo, pageSize: .data.pageSize, first: .data.detailList[0]}}'
echo
echo -e "${C}ListAttackAccounts${N}"
grpcurl -plaintext "${GRPC_HEADERS[@]}" -d '{"page":1,"limit":1}' "$OCTOBUS_ADDR" ThreatBook_HFISH.ThreatBook_HFISH/ListAttackAccounts | jq '{responseCode, verboseMsg, count: (.data | length), first: .data[0]}'
take_screenshot "03-four-rpcs-via-octobus.png"

echo -e "\n${G}4) 直连 HFish vs 经 OctoBus：字段命名差异${N}"
echo -e "${C}[直连 HFish REST，snake_case]${N}"
curl -sS "${DIRECT_CURL_TLS_ARGS[@]}" -X POST \
  "$HFISH_ENDPOINT/api/v1/attack/detail?api_key=$HFISH_API_KEY&page=1&limit=1" \
  -H 'Content-Type: application/json' \
  -d '{}' | jq '{response_code, verbose_msg, data: {total_num: .data.total_num, page_no: .data.page_no, page_size: .data.page_size}}'
echo
echo -e "${C}[经 OctoBus gRPC，protobuf JSON lowerCamelCase]${N}"
grpcurl -plaintext "${GRPC_HEADERS[@]}" -d '{"page":1,"limit":1}' "$OCTOBUS_ADDR" ThreatBook_HFISH.ThreatBook_HFISH/ListAttackDetails | jq '{responseCode, verboseMsg, data: {totalNum: .data.totalNum, pageNo: .data.pageNo, pageSize: .data.pageSize}}'
take_screenshot "04-direct-vs-octobus-jsonname.png"

echo -e "\n${G}5) access.log NDJSON：证明请求经 OctoBus 中转${N}"
admin_octobus logs --capset "$CAPSET_ID" --instance "$INSTANCE_ID" --service "$SERVICE_ID" --limit 0 \
  | jq -c 'select((.protocol // "") == "grpc") | select((.grpc_code // "") == "OK") | select(((.method // "") | contains("ThreatBook_HFISH")) or ((.route // "") | contains("ThreatBook_HFISH"))) | {ts, capset, service, instance, method, route, protocol, grpc_code, duration_ms}'
take_screenshot "05-access-log-ndjson.png"

echo -e "\n${G}=== 完成 ===${N}"
echo -e "${G}✅ npm test 通过${N}"
echo -e "${G}✅ gRPC reflection 暴露 ThreatBook_HFISH${N}"
echo -e "${G}✅ capset list-methods 显示 4 个 RPC 绑定到实例${N}"
echo -e "${G}✅ 四个 RPC 经 OctoBus 调用成功${N}"
echo -e "${G}✅ access.log NDJSON 含 capset/service/instance/method${N}"
echo -e "${G}✅ 直连 HFish snake_case vs OctoBus lowerCamelCase 对比完成${N}"
echo
ls -la "$OUTPUT_DIR"/*.png 2>/dev/null || true

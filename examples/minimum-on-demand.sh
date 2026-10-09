#!/bin/bash

set -euo pipefail

# 这是一个针对 calculator-on-demand-js 的最小可跑通脚本。执行之后，把输出的
# markdown 内容 (`========` 分隔符之间的部分) 丢给一个 agent，让它按照描述去调用
# 暴露的接口，就可以看到运行效果。调用期间脚本不能退出。

export OCTOBUS_DATA_DIR="/tmp/.octobus-on-demand"
export OCTOBUS_ADDR="127.0.0.1:19002"
# --dev seeds this fixed admin token on a loopback address; the CLI calls below
# authenticate with it. Never use --dev outside a local example.
export OCTOBUS_ADMIN_TOKEN="octobus-dev-admin-token"

SERVICE_DIR="examples/calculator-on-demand-js"
SERVICE_ID="calculator-on-demand"
INSTANCE_ID="calc02"
CAPSET_ID="dev02"
HOLD_SECONDS="${OCTOBUS_MINIMUM_HOLD_SECONDS:-600}"

# build octobus binary
task build

# build SDK and install example service package dependencies
task example:calculator-on-demand:dev-deps

# start daemon, listen on OCTOBUS_ADDR
#
# Start from a clean data dir and without an inherited bootstrap token: --dev
# only seeds its fixed token into a data dir that has no admin token yet, and
# OCTOBUS_BOOTSTRAP_ADMIN_TOKEN takes precedence over --dev entirely, so either
# one would leave the CLI below holding a token the daemon never provisioned.
rm -rf "${OCTOBUS_DATA_DIR}"
unset OCTOBUS_BOOTSTRAP_ADMIN_TOKEN
./bin/octobus serve --dev & # put into background
PID=$!
# auto kill when script ends, we also clear data so it can run again
cleanup() {
  kill "${PID}" 2>/dev/null || true
  wait "${PID}" 2>/dev/null || true
  rm -rf "${OCTOBUS_DATA_DIR}"
}
trap cleanup EXIT INT TERM

# wait until the daemon answers admin requests, rather than guessing with a
# fixed sleep: under load the daemon can take longer than any constant to bind,
# and the CLI calls below then fail with "daemon is not running".
source "$(dirname "${BASH_SOURCE[0]}")/../scripts/wait-for-daemon.sh"
wait_for_daemon "${PID}"
set -x

# 1. import the on-demand service
./bin/octobus service import "${SERVICE_ID}" "${SERVICE_DIR}"
sleep 2

# 2. create an on-demand instance. It has no persistent runtime process; requests
#    invoke a short-lived process on demand.
./bin/octobus instance create \
  "${INSTANCE_ID}" \
  --service "${SERVICE_ID}" \
  --config-json '{"label":"on-demand"}' \
  --secret-json '{"apiToken":"runtime-secret"}' \
  --no-start
sleep 2

# 3.1 create a capset
./bin/octobus capset create "${CAPSET_ID}" --name default-agent
sleep 2
# 3.2 add all methods into it
./bin/octobus capset add-instance \
  "${CAPSET_ID}" \
  "${INSTANCE_ID}"
sleep 2
set +x

# now we can see the methods from catalog
echo
echo "====================================== copy from here =========================================="
echo "BASE_URL is at: ${OCTOBUS_ADDR}, call the following services to test the connectivity"
echo "================================================================================================"
./bin/octobus catalog "${CAPSET_ID}" --all --md
echo "====================================== copy ends here =========================================="
echo

RESPONSE="$(curl -fsS -X POST "http://${OCTOBUS_ADDR}/capsets/${CAPSET_ID}/connect/${INSTANCE_ID}/calculator.v1.CalculatorService/Add" \
  -H 'Content-Type: application/json' \
  -H 'x-octobus-ext-business-request-id: minimum-on-demand-smoke' \
  -d '{"left":20,"right":22}')"
if [[ "${RESPONSE}" != *'"result":42'* && "${RESPONSE}" != *'"result": 42'* ]]; then
  echo "minimum on-demand smoke call failed: ${RESPONSE}" >&2
  exit 1
fi
echo "minimum on-demand smoke call ok: ${RESPONSE}"

echo "PASTE the markdown to an agent, and it will show you how to CALL these methods"
sleep "${HOLD_SECONDS}"

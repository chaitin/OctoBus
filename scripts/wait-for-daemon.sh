#!/bin/bash

# wait_for_daemon waits until the daemon answers, and until the admin token the
# caller carries is the one the daemon provisioned. Sourced by the examples in
# this directory; they export OCTOBUS_ADDR and OCTOBUS_ADMIN_TOKEN first.
#
# Usage: wait_for_daemon <daemon pid>

wait_for_daemon() {
  local pid="$1"
  for _ in $(seq 1 120); do
    if ! kill -0 "${pid}" 2>/dev/null; then
      echo "daemon exited during startup" >&2
      return 1
    fi
    if ./bin/octobus status >/dev/null 2>&1; then
      # `status` is exempt from admin authentication, so it only proves the
      # daemon is up. One authenticated call proves the token below is the one
      # the daemon seeded, which is what every command that follows needs: a
      # mismatch would otherwise surface as a 401 several steps later, after
      # this poll had already reported the daemon ready.
      if ./bin/octobus service list >/dev/null 2>&1; then
        return 0
      fi
      echo "daemon is up but rejected OCTOBUS_ADMIN_TOKEN=${OCTOBUS_ADMIN_TOKEN:-<unset>};" >&2
      echo "start it with --dev on a fresh data dir, or export the token it seeded" >&2
      return 1
    fi
    sleep 0.25
  done
  echo "daemon did not become ready at ${OCTOBUS_ADDR}" >&2
  return 1
}

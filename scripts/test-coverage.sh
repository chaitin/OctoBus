#!/usr/bin/env bash
set -euo pipefail

# AGENTS.md documents the floors this gate is supposed to hold: 60% for each of
# the unit, integration and e2e suites, and 90% overall. Until now the script
# only printed the numbers, so a drop below them still exited 0 and `task test`
# stayed green — which is how the floors went unobserved for this long.
require_coverage() {
  local name="$1" actual="$2" floor="$3"
  awk -v name="$name" -v actual="$actual" -v floor="$floor" '
    BEGIN {
      if (actual + 0 < floor + 0) {
        printf "%s coverage %s%% is below the %s%% floor AGENTS.md documents\n", name, actual, floor > "/dev/stderr"
        exit 1
      }
    }'
}

# coverage_percent prints the percentage of statements covered by a coverprofile.
# It is computed from the profile rather than read off `go tool cover -func`,
# whose total is printed to one decimal: that rounding can report 90.0 for a
# value below the 90% floor and let it pass.
coverage_percent() {
  awk -F'[: ,]' '
    NR > 1 { total += $(NF - 1); if ($NF > 0) covered += $(NF - 1) }
    END { printf "%.2f", 100 * covered / total }' "$1"
}

coverpkg="$(
  go list ./cmd/... ./internal/... |
    grep -v '^octobus/internal/integration$' |
    paste -sd, -
)"
unit_pkgs=()
while IFS= read -r pkg; do
  unit_pkgs+=("$pkg")
done < <(
  go list ./cmd/... ./internal/... |
    grep -v '^octobus/internal/integration$'
)

go test -v -coverprofile=coverage/unit.out "${unit_pkgs[@]}"
unit_pct="$(coverage_percent coverage/unit.out)"
printf 'unit coverage: %s%%\n' "$unit_pct"
require_coverage unit "$unit_pct" 60

go test -v -coverpkg="$coverpkg" -coverprofile=coverage/integration.out ./internal/integration
integration_pct="$(coverage_percent coverage/integration.out)"
printf 'integration coverage: %s%%\n' "$integration_pct"
require_coverage integration "$integration_pct" 60

# The e2e suite boots a real daemon per case and takes far longer than go test's
# 10m default per-package timeout, which kills it mid-suite and reports the
# goroutine dump as a failure. Pass the timeout the suite actually needs.
OCTOBUS_E2E_COVERAGE_DIR="$PWD/coverage/e2e" OCTOBUS_E2E_COVERPKG="$coverpkg" go test -timeout 45m -v ./tests/e2e
go tool covdata textfmt -i=coverage/e2e -o=coverage/e2e.out
e2e_pct="$(coverage_percent coverage/e2e.out)"
printf 'e2e coverage: %s%%\n' "$e2e_pct"
require_coverage e2e "$e2e_pct" 60

go run ./scripts/merge-coverprofiles.go coverage/coverage.out coverage/unit.out coverage/integration.out coverage/e2e.out
total_pct="$(coverage_percent coverage/coverage.out)"
printf 'total coverage: %s%%\n' "$total_pct"
require_coverage total "$total_pct" 90

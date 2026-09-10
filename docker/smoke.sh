#!/usr/bin/env bash
set -euo pipefail

image="${1:-octobus:dev}"
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
container_name="octobus-smoke-$RANDOM-$$"
volume_name="${container_name}-data"
host_port="${OCTOBUS_SMOKE_PORT:-19000}"
admin_token="${OCTOBUS_SMOKE_ADMIN_TOKEN:-smoke-admin-token}"
fixture_dir="$(mktemp -d)"
status_file="$(mktemp)"
import_body="$(mktemp)"
import_status="$(mktemp)"

cleanup() {
	docker rm -f "$container_name" >/dev/null 2>&1 || true
	docker volume rm -f "$volume_name" >/dev/null 2>&1 || true
	rm -rf "$fixture_dir"
	rm -f "$status_file" "$import_body" "$import_status"
}
trap cleanup EXIT

cp -R "$repo_root/examples/calculator-js/." "$fixture_dir/"
rm -f "$fixture_dir/.npmrc" "$fixture_dir/package-lock.json" "$fixture_dir/npm-shrinkwrap.json"
npm --prefix "$repo_root/sdk" ci
npm --prefix "$repo_root/sdk" run build
sdk_tgz="$(
	cd "$repo_root/sdk"
	npm pack --silent --pack-destination "$fixture_dir"
)"
sdk_tgz="$(basename "$sdk_tgz")"
node - "$fixture_dir/package.json" "$sdk_tgz" <<'NODE'
const fs = require("node:fs");
const [path, sdkTgz] = process.argv.slice(2);
const pkg = JSON.parse(fs.readFileSync(path, "utf8"));
pkg.dependencies["@chaitin-ai/octobus-sdk"] = `file:${sdkTgz}`;
fs.writeFileSync(path, `${JSON.stringify(pkg, null, 2)}\n`);
NODE
chmod -R a+rX "$fixture_dir"

docker build -f "$repo_root/docker/Dockerfile" -t "$image" "$repo_root"
docker volume create "$volume_name" >/dev/null

docker run -d \
	--name "$container_name" \
	-p "127.0.0.1:${host_port}:9000" \
	-e "OCTOBUS_BOOTSTRAP_ADMIN_TOKEN=${admin_token}" \
	-v "$volume_name:/var/lib/octobus" \
	-v "$fixture_dir:/fixtures/calculator-js:ro" \
	"$image" >/dev/null

deadline=$((SECONDS + 30))
until docker run --rm --network "container:$container_name" "$image" status --addr 127.0.0.1:9000 >"$status_file"; do
	if ! docker inspect -f '{{.State.Running}}' "$container_name" 2>/dev/null | grep -qx true; then
		docker logs "$container_name" >&2 || true
		exit 1
	fi
	if (( SECONDS >= deadline )); then
		docker logs "$container_name" >&2 || true
		exit 1
	fi
	sleep 1
done

curl -sS \
	--max-time 300 \
	-o "$import_body" \
	-w '%{http_code}' \
	-X POST "http://127.0.0.1:${host_port}/admin/v1/services/import" \
	-H "Authorization: Bearer ${admin_token}" \
	-H 'Content-Type: application/json' \
	-d '{"service_id":"calculator","source":"/fixtures/calculator-js","build":"auto"}' >"$import_status"

if [ "$(cat "$import_status")" != "200" ]; then
	cat "$import_body" >&2
	printf '\n' >&2
	docker logs "$container_name" >&2 || true
	exit 1
fi

cat "$import_body"
printf '\n'

docker run --rm -e "OCTOBUS_ADMIN_TOKEN=${admin_token}" --network "container:$container_name" "$image" instance create --id calculator-test --service calculator --addr 127.0.0.1:9000 --config-json '{"label":"smoke"}' --secret-json '{"apiToken":"smoke-token"}'
docker run --rm -e "OCTOBUS_ADMIN_TOKEN=${admin_token}" --network "container:$container_name" "$image" capset create --id dev --name DevAgent --addr 127.0.0.1:9000
docker run --rm -e "OCTOBUS_ADMIN_TOKEN=${admin_token}" --network "container:$container_name" "$image" capset add-instance --capset dev --instance calculator-test --addr 127.0.0.1:9000

response="$(
	curl -fsS \
		-X POST "http://127.0.0.1:${host_port}/capsets/dev/connect/calculator-test/calculator.v1.CalculatorService/Add" \
		-H 'Content-Type: application/json' \
		-d '{"left":20,"right":22}'
)"

case "$response" in
	*'"result":42'*|*'"result": 42'*)
		printf '%s\n' "$response"
		;;
	*)
		printf 'unexpected calculator response: %s\n' "$response" >&2
		exit 1
		;;
esac

<p align="center">
  <img src="octobuslogo.jpg" alt="OctoBus" width="240">
</p>

<p align="center">
  <a href="https://github.com/chaitin/OctoBus/actions/workflows/ci.yml">
    <img src="https://github.com/chaitin/OctoBus/actions/workflows/ci.yml/badge.svg?branch=main" alt="ci">
  </a>
  <a href="./CONTRIBUTING.md">
    <img src="https://img.shields.io/badge/Contributing-Guide-blue" alt="contributing">
  </a>
  <a href="./SECURITY.md">
    <img src="https://img.shields.io/badge/Security-Feedback-blue" alt="security">
  </a>
</p>

---

[中文版 README](README.zh-CN.md)

OctoBus is a locally running single-binary gateway for managing pluggable Node.js service packages and exposing the gRPC capabilities in those packages to clients or agents by capset.

The current implementation provides a Go-built `octobus` binary that is responsible for:

- daemon: start the local control plane and public data plane, and manage Node.js subprocesses according to each service runtime mode
- CLI: manage services, instances, and capsets through the local admin API
- gateway: expose selected methods as gRPC, and expose unary methods as Connect RPC and MCP streamable HTTP
- storage: use SQLite to record services, instances, capsets, method bindings, descriptors, and runtime state
- runtime management: import service packages, prepare runtime dirs, and manage long-running or on-demand Node.js instances

## Project Overview

OctoBus is built around the following core model:

- **service**: a service root inside an importable Node.js package. It contains `service.json`, proto files, and a gRPC implementation. A single distribution package can expose multiple service roots through `//service-dir`.
- **instance**: one runtime instance of a service, with independent config and workdir. Long-running instances also have logs and a local listen port.
- **capset**: a deterministic set of capabilities for an agent or use case, composed of `capset -> service -> instance -> method` bindings.
- **method binding**: the gRPC method actually selected and exposed in a capset. Unary methods can be called through gRPC, Connect RPC, and MCP. Streaming methods only support gRPC calls for long-running services, and are not available through Connect RPC, MCP, or on-demand invocation paths.

By default, the daemon listens on a single port, `127.0.0.1:9000`. The admin API, gRPC, Connect RPC, MCP, and reflection are all dispatched through that port. You can bind explicitly to another address with `--addr`, for example `0.0.0.0:9000`; when exposing OctoBus remotely, you are responsible for network access control. The CLI performs management operations through the admin API by default and does not write SQLite directly.

Service packages use the `long-running` runtime mode by default: after an instance is created or started, OctoBus launches a resident Node.js gRPC subprocess. A package can also declare `"runtime":{"mode":"on-demand"}` in `service.json`: such instances are not prestarted and do not store a PID or listen address. For each incoming request, OctoBus starts one short-lived `invoke` subprocess.

## Start The Daemon

### Install from npm

OctoBus is published as the `@chaitin-ai/octobus` npm package. The main package
installs a small Node.js launcher and pulls the matching native Go binary through
platform-specific optional dependencies such as
`@chaitin-ai/octobus-linux-x64`.

```bash
npm install -g @chaitin-ai/octobus
octobus serve
```

You can also run it without a global install:

```bash
npx @chaitin-ai/octobus serve
```

The npm package installs the `octobus` binary only. Normal service import and
runtime flows still require `node`, `npm`, `protoc`, and `git` as described
below.

### Run with Docker

The Docker image includes the `octobus` binary and the runtime dependencies used
for normal service import and instance startup flows.

```bash
docker run --rm \
  -p 9000:9000 \
  -v octobus-data:/var/lib/octobus \
  ghcr.io/chaitin/octobus:latest
```

The container listens on `0.0.0.0:9000` by default and stores daemon state under
`/var/lib/octobus`.

### Build from a checkout

After the first checkout, build the binary:

```bash
task build
```

Start with the default configuration:

```bash
./bin/octobus serve
```

Common options:

```bash
./bin/octobus serve \
  --data-dir .octobus \
  --addr 127.0.0.1:9000
```

You can also override defaults through environment variables:

```bash
export OCTOBUS_DATA_DIR="./.octobus"
export OCTOBUS_ADDR="127.0.0.1:9000"
```

The data directory stores the SQLite database, service artifacts and runtimes, instance config, and logs. The default data directory is `.octobus` under the current directory where the daemon command is started.

### Dependencies

To run the daemon locally and perform normal service import/start workflows, install the following commands and ensure they are available in `PATH`:

- `node`: runs imported Node.js service packages; the version must satisfy the package's own requirements
- `npm`: fetches npm packages during service import and installs production dependencies in runtime dirs
- `protoc`: compiles proto descriptors during service import
- `git`: fetches and archives packages imported from HTTPS Git sources

If `go build` or `task build` fails with timeouts when downloading Go modules (e.g. `dial tcp ... i/o timeout` from `proxy.golang.org`), you may need to configure a Go module proxy:

```bash
go env -w GOPROXY=https://goproxy.cn,direct
```

## Basic Workflow

The following example uses the built-in calculator service to run through a complete workflow. Before starting, build the binary, start the daemon as described above, and verify that the CLI can connect:

```bash
./bin/octobus status
```

If the daemon is not running at the default address, specify it through a global option or an environment variable. A local daemon uses HTTP/h2c by default, and the address can be a bare `host:port` or `http://host:port`:

```bash
./bin/octobus --addr 127.0.0.1:19001 status
OCTOBUS_ADDR=http://127.0.0.1:19001 ./bin/octobus service list
```

Use the `https://host:port` form only when OctoBus is remotely exposed and TLS is provided by an outer proxy.

> The calculator example installs dependencies through build artifacts from this repository's local SDK. Before running the example from a clean checkout, prepare the example dependencies; this task automatically builds the local SDK and installs example dependencies:
>
> ```bash
> task example:calculator:dev-deps
> ```
>
> The repository also provides an on-demand runtime calculator example at `examples/calculator-on-demand-js`. To run that example locally, prepare its dependencies first; this task also automatically builds the local SDK:
>
> ```bash
> task example:calculator-on-demand:dev-deps
> ```

You can also run the clean-checkout smoke script for the local calculator happy path. This task cleans generated artifacts, rebuilds the binary and local SDK, installs calculator example dependencies, starts a temporary daemon, imports the service, creates an instance and capset, and calls Connect RPC to assert that the response is `result: 42`:

```bash
task example:clean-checkout-smoke
```

Import the example service package:

```bash
./bin/octobus service import calculator ./examples/calculator-js
```

The first positional argument, `calculator`, is the local OctoBus service id and is required. `--name` is optional and overrides the display name. When `--name` is omitted, the first import uses `displayName` from `service.json`, or `name` if `displayName` is not present. Re-importing the same service id without `--name` preserves the existing display name.

Create and start an instance:

```bash
./bin/octobus instance create \
  calculator-test \
  --service calculator \
  --config-json '{"label":"primary"}' \
  --secret-json '{"apiToken":"dev-token"}'
```

Create a capset and expose methods from the instance:

```bash
./bin/octobus capset create dev --name DevAgent

./bin/octobus capset add-instance \
  dev \
  calculator-test
```

View the capset catalog and confirm that the method is exposed:

```bash
./bin/octobus catalog dev --all --json
```

Call the calculator through Connect RPC:

```bash
curl -X POST \
  http://127.0.0.1:9000/capsets/dev/connect/calculator-test/calculator.v1.CalculatorService/Add \
  -H 'Content-Type: application/json' \
  -d '{"left":20,"right":22}'
```

Additional notes:

- In addition to local directories, `service import` supports local and remote HTTP(S) `.tgz` / `.tar.gz` / `.zip` archives, `npm:` sources, and HTTPS Git sources. Package sources except remote HTTP(S) archive URLs can append `//service-dir` to select a service root inside the distribution package, for example `npm:@scope/tentacle@1.0.0//Hanqing_Ticket` or `https://github.com/acme/tentacle.git//Hanqing_Ticket@v1.0.0`. Remote archive URLs use the package root as the service root; use recursive import for multi-service archives. See `./bin/octobus service import --help` for offline import, forced dependency reinstall, and other options.
- Use `service import --recursive SOURCE` to import every service root discovered in a multi-service distribution package, for example `./bin/octobus service import --recursive npm:@chaitin-ai/octobus-tentacles`. In recursive mode, `SOURCE//some-dir` limits discovery to that scan root while still importing each discovered service with the id from its `service.json.name`.
- `instance` supports `list/get/update/delete/update-config/update-secret/start/stop/restart`. For `long-running` services, `create` starts the instance by default. Config can come from `--config`, `--config-json`, or stdin; secrets can come from `--secret`, `--secret-json`, or stdin.
- `on-demand` instances keep the logical `enabled/running` state, but `start/stop/restart` and config updates with `--restart` return an error because the runtime mode does not support persistent runtime control.
- `capset` supports `list/get/update/delete/add-instance/remove-instance`. You can also use `select-method` / `unselect-method` for precise method exposure control. `add-token/list-tokens/remove-token` manage access tokens.
- `capset add-instance` accepts two positional arguments: capset id and instance id. The service is looked up from the instance record. By default, this command selects all methods and statically expands all current service methods at execution time. Use `--no-all-methods` to select methods later with `select-method`. The gRPC catalog includes selected unary and streaming methods; Connect RPC, MCP, and OpenAPI only include unary methods. Methods added by later service updates are not automatically exposed to existing capsets.

See the next section for more invocation methods. Command details are available through each subcommand's `--help`.

## Invoke Exposed Capabilities

Fetch a capset catalog:

```bash
curl 'http://127.0.0.1:9000/admin/v1/catalog/dev?all=true'
```

The catalog returns each method by protocol, including runtime mode, backend state, gRPC metadata, Connect RPC endpoint, MCP tool name, descriptor hash/version, and request/response message names. By default, only the gRPC catalog is returned. Use the `grpc=true`, `connect=true`, `mcp=true`, or `all=true` query parameters to select protocols, or run `./bin/octobus catalog --help` to see CLI options.

Capsets do not require access tokens by default. When no token has been added, Connect RPC, MCP, gRPC, reflection, and public OpenAPI endpoints under the capset remain publicly accessible. After one or more tokens are added, these public resources require valid credentials: HTTP/Connect/MCP/OpenAPI use `Authorization: Bearer <token>`, while gRPC and reflection use metadata with the same name. Token secrets are only submitted at creation time. OctoBus persists validation hashes and does not store plaintext tokens.

```bash
printf '%s' 'dev-secret' | ./bin/octobus capset add-token dev local --token-stdin
./bin/octobus capset list-tokens dev
./bin/octobus capset remove-token dev local
```

### gRPC

gRPC calls keep the original method path and specify the route target through metadata:

```bash
grpcurl -plaintext \
  -H 'x-octobus-capset: dev' \
  -H 'x-octobus-instance: gitlab-test' \
  -d '{"projectId":"p1"}' \
  127.0.0.1:9000 \
  gitlab.MergeRequestService/List
```

Before forwarding to the backend Node instance, OctoBus strips `x-octobus-*` control metadata, except for `x-octobus-ext-*`, which is passed through. Business extension metadata should use the `x-octobus-ext-*` naming pattern, for example `x-octobus-ext-business-request-id` and `x-octobus-ext-username`, and is forwarded to the service package. The calculator example reads `x-octobus-ext-business-request-id` first and remains compatible with the older `x-business-request-id`. The gRPC gateway for long-running services supports unary, server streaming, client streaming, and bidirectional streaming. On-demand services only support unary invoke.

### Connect RPC

The Connect RPC endpoint is:

```text
POST /capsets/{capset_id}/connect/{instance_id}/{full_service}/{method}
```

Example:

```bash
curl -X POST \
  http://127.0.0.1:9000/capsets/dev/connect/gitlab-test/gitlab.MergeRequestService/List \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer dev-secret' \
  -H 'x-octobus-ext-business-request-id: req-1' \
  -d '{"projectId":"p1"}'
```

Connect RPC uses protobuf JSON mapping, rejects unknown fields, and omits zero values from responses by default. Field-level schema is available through the capset OpenAPI endpoints:

```bash
curl http://127.0.0.1:9000/capsets/dev/openapi.json
curl http://127.0.0.1:9000/capsets/dev/openapi.yaml
curl http://127.0.0.1:9000/admin/v1/catalog/dev/openapi.json
curl http://127.0.0.1:9000/admin/v1/catalog/dev/openapi.yaml
```

### MCP

The MCP streamable HTTP endpoint is:

```text
POST /capsets/{capset_id}/mcp
```

List tools:

```bash
curl -X POST http://127.0.0.1:9000/capsets/dev/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

Call a tool:

```bash
curl -X POST http://127.0.0.1:9000/capsets/dev/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"gitlab__gitlab-test__list","arguments":{"projectId":"p1"}}}'
```

The default tool name is generated from `{service}__{instance}__{method}`. If there is a conflict, specify it explicitly with `--mcp-tool` when running `capset select-method`.

### gRPC Reflection

OctoBus provides gRPC reflection itself from descriptors archived during import, instead of proxying reflection to the Node instance. Reflection requests must include `x-octobus-capset`, and responses are limited to the descriptor closure required by the methods exposed in that capset.

```bash
grpcurl -plaintext \
  -H 'x-octobus-capset: dev' \
  127.0.0.1:9000 \
  list
```

## View Access Logs

Public protocol access for capsets is written to `access.log` under the data directory. The file is NDJSON and has `0600` permissions. It records protocol, capset, service, instance, method/tool, route, status code, duration, remote addr, and user agent. It does not record request bodies, response bodies, Authorization, tokens, secrets, or business metadata.

View logs through the CLI:

```bash
./bin/octobus logs
./bin/octobus logs --capset dev --instance calculator-test
./bin/octobus logs --service calculator --limit 1000
./bin/octobus logs --capset dev --tail 0 --follow
```

`--limit 0` returns all matching records. `--tail N` returns the last N matching records. `--follow` continuously outputs new matching records. Filters are combined as exact matches.

## Develop Service Packages

A service package must contain at least:

```text
my-service/
  package.json
  service.json
  proto/
    service.proto
  dist/
    index.js
```

A single npm distribution package can also contain multiple service roots. In that case, the root `package.json` is the single source of truth for dependency installation, publishing, and runtime entries, while each service root subdirectory provides its own `service.json`, proto, and schema. Append `//service-dir` to the source during single-service import to select the target service root. Without that suffix, the root directory itself is the service root. Use `octobus service import --recursive SOURCE` to discover and import all service roots in one command; in recursive mode, `SOURCE//some-dir` is the scan root for discovery.

Example `service.json`:

```json
{
  "schema": "chaitin.octobus.service.v1",
  "name": "gitlab-wrapper",
  "displayName": "GitLab Wrapper",
  "description": "GitLab API wrapper service",
  "runtime": {
    "mode": "long-running"
  },
  "proto": {
    "roots": ["proto"],
    "files": ["proto/gitlab.proto"]
  },
  "configSchema": "config.schema.json",
  "secretSchema": "secret.schema.json"
}
```

Required fields:

- `schema`
- `name`
- `proto.roots`
- `proto.files`

`name` is the name declared inside the package, not the OctoBus service id. `service.json` must not declare top-level `id` or `entry` fields. The runtime entry must be provided by the distribution package root's `package.json bin`: a single-entry package can use a string or a single-entry object, while a multi-service package must make `service.json.name` match a key in the root `bin` object. `runtime.mode` is optional and supports `long-running` and `on-demand`; when omitted, it is equivalent to `long-running`. If `configSchema` is provided, JSON Schema validation is performed when creating or updating instance config. If `secretSchema` is provided, JSON Schema validation is performed when creating or updating instance secrets.

When a `long-running` instance starts, OctoBus executes the resolved `node_entry` from the runtime dir and passes fixed arguments:

```text
--runtime serve --host 127.0.0.1 --port <port> --config <config.json> --secret <secret.json> --workdir <instance_workdir> --service <service_id> --instance <instance_id>
```

The service process must start a gRPC server and implement the standard gRPC health check.

An `on-demand` service must also support one-shot invocation:

```text
--runtime invoke --method <package.Service/Method> --config <config.json> --secret <secret.json> --metadata <metadata.json> --workdir <instance_workdir> --service <service_id> --instance <instance_id>
```

OctoBus writes the protobuf wire-format request to stdin and expects stdout to contain only the protobuf wire-format response. OctoBus also sets `OCTOBUS_PACKAGE_DIR=<runtime>/<service_root>`, so the SDK reads `service.json`, proto, and schema from the service root while the full runtime dir still preserves the dependency layout from the distribution package root. `@chaitin-ai/octobus-sdk`'s `runServiceMain` enters the business CLI when `--runtime` is not provided. When `--runtime` is provided, it enters the runtime parser and supports commands such as `serve`, `invoke`, `dev`, `inspect`, `client-stub`, and `client-package`.

When running a service entry locally, use `OCTOBUS_SERVICE_CONTEXT` to inject default config/secret into the business CLI and `--runtime dev`:

```bash
OCTOBUS_SERVICE_CONTEXT='{"config":{"baseUrl":"https://example.com"},"secret":{"token":"dev-token"}}' \
node bin/service.js call --data-json '{"id":"123"}'
```

The SDK also reads the same variable from `.env` in the current working directory. It reads only that key and does not inject other `.env` variables. This variable does not affect the daemon's `--runtime serve` or `--runtime invoke` protocol. When the daemon manages instances, it continues to pass config/secret through files and file descriptors.

## Development

### Architecture

```text
Client / Agent
  -> OctoBus Go binary
       -> public HTTP/2 h2c server
          -> gRPC gateway
          -> Connect RPC adapter
          -> MCP adapter
          -> reflection server
       -> localhost admin API
       -> SQLite store
       -> descriptor loader
       -> Node supervisor
            -> Node.js gRPC instance processes
            -> on-demand invoke subprocesses
```

Main code directories:

- `cmd/octobus`: program entry point, root command, `serve` command, and daemon assembly
- `internal/cli`: Cobra CLI; all management commands call the local admin API
- `internal/admin`: local admin HTTP API
- `internal/packageimport`: service package fetching, unpacking, runtime preparation, and descriptor compilation
- `internal/supervisor`: instance config writes, Node subprocess start/stop/recovery, health checks, and logs
- `internal/store`: SQLite schema, migrations, and domain object reads/writes
- `internal/protocol`: gRPC proxy, Connect RPC, MCP, catalog, OpenAPI, and reflection
- `internal/descriptors`: proto descriptor compilation, loading, and method metadata parsing
- `sdk`: TypeScript source, tests, and build artifacts for `@chaitin-ai/octobus-sdk`
- `examples/calculator-js`: long-running JavaScript calculator service example
- `examples/calculator-on-demand-js`: on-demand JavaScript calculator service example
- `tests/e2e`: end-to-end tests
- `docs/design`: design documents and goals

Runtime data is laid out roughly as follows:

```text
{data_dir}/
  octobus.db
  artifacts/services/{service_id}/
    <package-artifact>.tgz or package.zip
    package/
    runtime/
    descriptor.protoset
  instances/{instance_id}/
    config.json
    secret.json
    stdout.log
    stderr.log
    tmp/
```

When the daemon restarts, it restores instances with `enabled=true` and `runtime_mode=long-running` from SQLite and relaunches the corresponding Node.js subprocesses. `on-demand` instances are not prestarted; later requests invoke them through `invoke`.

### Requirements

- Go: the project `go.mod` declares `go 1.26.1`
- Task: `Taskfile.yml` is used for build, check, and test entry points
- Node.js / npm: required to import and run Node.js service packages
- `protoc`: required to compile proto descriptors during service import and to run e2e tests
- `git`: required to import services from HTTPS Git sources and by some tests

### Build And Test

The project uses `Taskfile.yml` to manage the lint, test, and build phases. Run all phases:

```bash
task all
```

You can also run individual phases:

```bash
task        # list available tasks
task lint
task test
task build
```

`task test` first builds the local SDK and installs dependencies for the long-running and on-demand calculator examples, then runs Go tests with cross-package coverage, including `tests/e2e`. `task build` generates `bin/octobus` and injects build metadata for the `version` subcommand. If the current commit is exactly on an OctoBus release tag matching `v[0-9]*`, that tag is used as the displayed version. Otherwise, the version comes from the nearest reachable matching tag plus commit distance and short commit, for example `v1.2.0-12-gabc1234`; if no matching tag is reachable, it falls back to the short Git commit. Build environments without Git metadata can override the injected values with `OCTOBUS_VERSION`, `OCTOBUS_COMMIT`, and `OCTOBUS_BUILD_DATE`. You can inspect the result with:

```bash
./bin/octobus version
```

End-to-end tests can also be run separately:

```bash
go test ./tests/e2e -count=1
```

End-to-end tests build the real `octobus` binary, start a real daemon, call the admin API through the CLI, and then verify the gRPC, Connect RPC, MCP, OpenAPI, and reflection endpoints.

The default GitHub Actions CI is a lightweight validation: it checks public traces, Go formatting and vet, runs `go test ./cmd/... ./internal/...`, builds the binary, checks the OctoBus npm binary packages, and runs npm test/build/pack dry-run under `sdk`. Full `task test` and e2e remain local gates. OctoBus binary package publishing is triggered only by `v<version>` tag push builds, and the tag version must match `npm/octobus/package.json.version`. SDK publishing is triggered only by `sdk-v<version>` tag push builds, and the tag version must match `sdk/package.json.version`. Both npm publishing paths require the repository secret `NPM_TOKEN`.

## Security And Compliance

If you believe this repository contains a security vulnerability, infringing content, or another compliance risk, please report it privately to `octobus-opensource@chaitin.com`.

For the full reporting process and required details, see [SECURITY.md](SECURITY.md).

# Octobus E2E Tests

`tests/e2e` contains black-box acceptance tests for the current Octobus CLI,
daemon, persistence layout, and public protocol surfaces. The tests build the
real `octobus` binary, start a real daemon on ephemeral loopback ports, drive
state changes through the real CLI/admin API, and invoke the public gRPC, Connect RPC,
MCP, and gRPC reflection endpoints.

The suite is intended to describe and protect the behavior that later e2e cases
should continue to maintain. It should not depend on fixed ports, the user's
home directory, the npm registry, or external network access.

## Running

```text
go test ./tests/e2e -count=1
```

Requirements:

- Go toolchain available on `PATH`.
- `protoc` available on `PATH`.
- `git` available on `PATH` for HTTPS Git import scenarios.
- Loopback TCP ports available for daemon, public gateway, and fixture backend
  processes.

The fixture service package is generated locally inside each test temp
directory. It does not use the npm registry or external network access, but
service import and fixture responses compile proto descriptors with `protoc`.

## Test Structure

Current files:

- `e2e_test.go`: main user flow, protocol invocation, capset-scoped reflection,
  partial method selection, persisted artifact assertions, and routing metadata
  stripping.
- `error_test.go`: Connect RPC and MCP semantics, streaming method rejection, ID/admin
  boundaries, CLI behavior when the daemon is stopped, and MCP tool name
  conflicts.
- `lifecycle_test.go`: service update behavior, daemon restart recovery, config
  update validation/hash/restart/redaction semantics, and stale gRPC binding
  rejection.
- `git_import_test.go`: HTTPS Git service import, credential redaction, latest
  SemVer tag resolution, Git `//service-dir` service-root selection, and
  Git-backed service update/restart behavior.
- `service_import_upload_test.go`: default `service import --source-mode auto`
  upload behavior for client-local directories, including persisted
  `client-upload:<basename>` source assertions.
- `harness_test.go`: binary build, daemon lifecycle, CLI/admin/public helpers,
  SQLite reads, generated fixture package, dynamic protobuf helpers, raw gRPC
  codec, in-process fixture backend, and local HTTPS Git fixture server.

Keep new tests in the narrowest file that matches the behavior under test. Shared
setup and protocol helpers belong in `harness_test.go`; test-specific assertions
should stay near the case that uses them.

## Harness

Each test creates an isolated harness:

1. Creates a temporary root and data directory.
2. Builds the real binary with `CGO_ENABLED=0 go build -trimpath -tags netgo,osusergo -o $TMP/octobus ./cmd/octobus`.
3. Allocates an ephemeral `127.0.0.1:0` daemon address.
4. Starts:

   ```text
   $TMP/octobus serve \
     --data-dir $TMP/data \
     --addr 127.0.0.1:<daemon_port>
   ```

5. Polls `GET /admin/v1/status` until the daemon is ready.
6. Runs CLI commands against the same binary with:

   ```text
   OCTOBUS_ADDR=127.0.0.1:<daemon_port>
   OCTOBUS_DATA_DIR=$TMP/data
   ```

7. Stops the daemon during cleanup, escalating to kill only if graceful shutdown
   times out.

The harness exposes helpers for CLI execution, admin JSON requests, public Connect
requests, MCP JSON-RPC requests, raw gRPC invocation, reflection clients, catalog
polling, SQLite reads, calculator example setup, fixture package generation,
proto JSON/wire conversion, and diagnostic dumps.

Git import tests create a local bare repository from generated fixture packages
and serve it over `httptest` TLS through `git http-backend`. The harness sets
`GIT_SSL_NO_VERIFY=true` and loopback `NO_PROXY`/`no_proxy` for daemon and CLI
processes so these tests stay local even when the developer environment has a
global HTTPS proxy.

E2E cases should avoid calling `internal/*` packages to exercise product
behavior. Direct SQLite reads are allowed only for persistence assertions; tests
should never use SQLite writes to set up state.

## Calculator Example

Most e2e tests that only need a realistic unary service package import and run
the repository's `examples/calculator-js` package. It is a JavaScript service
built on `@grpc/grpc-js` with `Add` and `Subtract` unary methods, an optional
`label` config field, standard gRPC health behavior, and backend metadata
recording.

Using a checked-in example keeps the broad user-flow tests close to real package
usage. These tests import the calculator without `--offline` so Octobus prepares
the package's npm runtime dependencies through the normal import path.

Calculator and streaming examples use `runServiceMain(service)`: Octobus enters
runtime behavior with `--runtime serve` or `--runtime invoke`; direct execution
without `--runtime` is treated as the service's generated business CLI.

When these checked-in examples depend on `@chaitin-ai/octobus-sdk`, import tests
use the repository SDK build for local examples before runtime dependency
preparation. This keeps e2e independent of whether the same SDK version has
already been published to npmjs.

## Fixture Service

Some tests generate a local service package under the harness temp directory:

```text
fixture-<version>/
  package.json
  service.json
  config.schema.json
  entry
  proto/
    echo.proto
  node_modules/
```

`entry` is an executable shell wrapper that re-enters the current test binary as
`OCTOBUS_E2E_HELPER_PROCESS=1`. For long-running services the helper process is
called with `--runtime serve`; for on-demand services it recognizes
`--runtime invoke`. The helper starts a real gRPC backend, registers standard
health checking, handles unknown unary service calls with a raw protobuf codec,
reads the instance config from the path supplied by Octobus, and records
received backend metadata to the instance workdir.

The fixture currently has two proto versions for behavior that the calculator
example intentionally does not model:

- `fixtureV1` exposes unary `Echo`, `GetConfig`, and `Fail`, plus streaming
  `ServerStream`. It is used for config checks, backend error mapping, protobuf
  JSON `jsonName` handling, zero-value omission, unary exposure, and gRPC
  streaming exposure.
- `fixtureV2` removes `Echo` and exposes unary `Ping`. It is used to verify
  service update, descriptor identity changes, instance restart, stale binding
  rejection, and static method selection.

## Implemented Coverage

`TestFullUserFlowInvokesAllProtocolsAndPersistsData` verifies the core user
flow:

- import a local service package through `octobus service import`;
- create an instance with schema-validated config;
- create a capset and bind all visible methods;
- validate data-dir artifacts, descriptor files, config/log file permissions,
  service rows, instance rows, descriptor identity, and method metadata;
- call the same method through raw gRPC, Connect RPC, and MCP;
- confirm Connect RPC/gRPC/MCP return consistent business results;
- confirm Octobus routing metadata is stripped before the backend while ordinary
  business metadata is forwarded.
- confirm `octobus logs` can read filtered access log records for public
  protocol calls without exposing sensitive fields.

Reflection and method exposure coverage:

- `TestGRPCReflectionVisibilityIsCapsetScoped` checks that reflection is served
  by Octobus from archived descriptors, requires `x-octobus-capset`, returns
  only the capset-visible service, and reports missing capsets as `NOT_FOUND`.
- `TestPartialMethodSelectionLimitsReflectionAndInvocation` checks that explicit
  method selection limits the catalog, reflection descriptor surface, and
  callable methods.
- `TestStreamingMethodsAreNotExposed` checks that streaming methods are omitted
  from catalog/MCP exposure, cannot be selected, and do not enter the unary
  invocation path.

Connect RPC and MCP coverage:

- `TestConnectAndMCPSemanticsAndErrors` verifies protobuf JSON `jsonName`, unknown
  Connect RPC fields as `INVALID_ARGUMENT`, zero-value omission, unexposed methods as
  `NOT_FOUND`, stopped instances as `UNAVAILABLE`, MCP `tools/list`,
  `tools/call`, unknown tool errors, and backend gRPC errors returned as tool
  results rather than JSON-RPC protocol errors.
- `TestMCPToolNameConflictRequiresExplicitName` verifies duplicate explicit MCP
  tool names are rejected and a distinct explicit name is persisted.

Lifecycle and persistence coverage:

- `TestServiceUpdateRestartsEnabledInstanceAndKeepsBindingsStatic` verifies that
  importing a new version changes descriptor identity, restarts enabled
  instances, invalidates old bindings, does not automatically expose new
  methods, and allows explicitly selecting the new method.
- `TestOldGRPCBindingFailsAfterServiceUpdate` verifies that a direct raw gRPC
  call to an old method binding fails after service update.
- `TestDaemonRestartRecoversEnabledAndLeavesDisabledStopped` verifies enabled
  instances recover from SQLite and disk config after daemon restart, while
  disabled instances remain stopped and return unavailable errors.
- `TestInstanceConfigUpdateValidationRestartHashAndRedaction` verifies required
  and typed config / secret schema validation, failed update atomicity, hash
  changes, `0600` config / secret permissions, no-restart semantics, `--restart`
  semantics, and CLI redaction of sensitive values.

Boundary coverage:

- `TestIDAdminAndCLIBoundaries` verifies invalid service/instance/capset IDs,
  admin binding restricted to localhost, CLI writes requiring a running daemon,
  and no direct SQLite mutation when the daemon is stopped.

## Persistence Assertions

E2E tests currently inspect these persisted fields and files:

- `octobus.db` exists under the isolated data directory.
- `artifacts/services/<service>/package.tgz` exists.
- `artifacts/services/<service>/runtime/` exists.
- `artifacts/services/<service>/descriptor.protoset` exists.
- `services.package_artifact_path`, `package_sha256`, `descriptor_path`,
  `descriptor_sha256`, `descriptor_version`, and `methods_json` are populated.
- `instances.enabled`, `status`, `pid`, `listen_addr`, and `config_sha256`
  match lifecycle expectations.
- `instances/<id>/config.json`, `stdout.log`, and `stderr.log` have `0600`
  permissions.

Schema details that are not user-visible should be covered by lower-level store
tests instead of broadening e2e assertions.

## Diagnostics

On harness-level failures, diagnostics include:

- admin/public addresses and data directory;
- daemon stdout/stderr;
- known fixture instance `stdout.log`, `stderr.log`, and `metadata.json` files
  when present;
- failing CLI stdout/stderr in `mustCLI`;
- failing HTTP method/path/status/body for admin, Connect RPC, and MCP helpers.

When adding new cases that start additional instances or write new diagnostic
artifacts, extend `dumpDiagnostics` so CI failures contain enough context to
debug process, port, and protocol issues without reproducing locally first.

## Maintenance Guidelines

- Prefer realistic black-box setup through CLI/admin/public endpoints.
- Add focused cases for new user-visible behavior; avoid one large scenario that
  hides the failing contract.
- Keep fixture proto changes intentional. If a case needs a new method shape,
  document why in the fixture section and update the relevant assertions.
- Use direct SQLite reads only to verify persistence after the product has
  performed the operation.
- Assert protocol error semantics at the public boundary: HTTP status and Connect RPC
  error envelope, gRPC status code, or MCP tool-result error shape.
- Keep all ports ephemeral and all filesystem state under `t.TempDir()`.
- Do not add external network, registry, or user-home dependencies.

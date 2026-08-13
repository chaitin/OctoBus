# OctoBus Service Package Contract

OctoBus service packages are npm-compatible package artifacts that OctoBus can import, store, start, and restore.

Conceptually:

```text
service = package artifact + service.json + package.json bin + proto contract + gRPC implementation
```

OctoBus defines the package contract, exposed interfaces, artifact lifecycle, and Node startup protocol. Business code can use any suitable libraries internally.

## Contents

- Import sources
- Artifact, package dir, runtime dir
- service.json
- package.json bin
- Runtime modes
- Node startup protocol
- Build policy
- Runtime dependencies
- Supported RPC shape
- Validation checklist

## Import Sources

`octobus service import` supports:

- npm registry package using `npm:` prefix
- local package directory
- local `.tgz` / `.tar.gz`
- local `.zip`
- remote HTTP(S) `.tgz` / `.tar.gz` / `.zip` URL
- HTTPS Git repository URL

Examples:

```text
octobus service import --id gitlab npm:@vendor/gitlab-wrapper@1.2.3
octobus service import --id gitlab ./gitlab-wrapper
octobus service import --id gitlab ./gitlab-wrapper-1.2.3.tgz
octobus service import --id gitlab ./gitlab-wrapper.zip
octobus service import --id gitlab https://packages.example.com/gitlab-wrapper-1.2.3.zip
octobus service import --id gitlab https://github.com/acme/services.git//gitlab-wrapper@v1.2.3
```

Every package source except remote HTTP(S) archive URLs also accepts an optional `//service-dir` suffix to select a service root inside the distribution package:

```text
octobus service import --id gitlab npm:@vendor/platform-services@1.2.3//gitlab-wrapper
octobus service import --id gitlab ./platform-services//gitlab-wrapper
octobus service import --id gitlab ./platform-services-1.2.3.tgz//gitlab-wrapper
octobus service import --id gitlab ./platform-services.zip//gitlab-wrapper
octobus service import --id gitlab https://github.com/acme/services.git//gitlab-wrapper@v1.2.3
```

Remote HTTP(S) archive URLs are treated as already packaged artifacts and use the package root as the service root. Use `--recursive` to import multiple service roots from a remote archive.

HTTPS Git format:

```text
https://[user[:password]@]host/path/to/repo[.git][//service-dir][@ref]
```

`//service-dir` selects the service root inside the archived distribution package. It does not crop the artifact and does not change the dependency install root. `@ref` may be branch, tag, commit, or `latest`. `latest` resolves to the highest stable SemVer tag when available, otherwise remote default branch `HEAD`.

## Artifact, Package Dir, Runtime Dir

Import creates or uses a fixed package artifact:

```text
npm registry package -> npm pack -> npm-packed .tgz
local directory      -> npm pack -> npm-packed .tgz
local .tgz/.tar.gz   -> copy -> package.tgz
local .zip           -> copy -> package.zip
remote .tgz/.tar.gz  -> download -> package.tgz
remote .zip          -> download -> package.zip
HTTPS Git repo       -> git archive -> npm pack -> npm-packed .tgz
```

`package dir` is the unpacked artifact. OctoBus reads `service.json`, proto files, and schemas from `package_dir/service_root`, where `service_root` is the optional `//service-dir` or `"."`.

`runtime dir` is the runnable copy. OctoBus installs production dependencies there at import time. Instance start and daemon recovery use the runtime dir and do not fetch remote packages.

## service.json

Required manifest:

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

Rules:

- `schema` must equal `chaitin.octobus.service.v1`.
- `name` is the package-declared service package name. It is not the OctoBus service id. In a multi-bin package, it must match a key in the root `package.json bin` object.
- `displayName` and `description` are optional.
- `runtime.mode` supports `long-running` and `on-demand`; missing runtime means `long-running`.
- `proto.roots` contains proto import roots.
- `proto.files` contains entry proto files.
- `configSchema` and `secretSchema` are optional JSON Schema file paths.
- Do not declare top-level `id`; the import command supplies service id.
- Do not declare `entry`; `package.json bin` is the only runtime entry source.
- Package paths must be relative, stay inside the selected service root, and not contain `..`.
- Schema paths must point to ordinary files inside the selected service root.

## package.json bin

Root `package.json bin` is the runtime entry authority. It may be a string or an object. Single-service packages can use a string or a single-entry object. Multi-service packages use an object, and each service root's `service.json.name` must match one root `bin` key.

Valid:

```json
{
  "type": "module",
  "bin": {
    "gitlab-wrapper": "bin/gitlab.js"
  }
}
```

Rules:

- `package.json` is required.
- Multiple `bin` entries are accepted for multi-service packages when the selected service name matches a key.
- The bin target must be a relative path inside the package.
- The bin target must exist in the final artifact.
- OctoBus executes the resolved file directly from runtime dir; it does not search `PATH`.

For executable JS bins, include:

```js
#!/usr/bin/env node
```

and ensure the file is executable before packing.

## Runtime Modes

`long-running`:

- Instance creation/start launches a persistent Node gRPC child process.
- Daemon restart restores enabled long-running instances.
- Supports start, stop, restart, and config/secret update with restart.

`on-demand`:

- Instance does not pre-start a process.
- Each request launches one short-lived `invoke` process.
- Instance appears logically enabled/running, with no PID or listen address.
- Does not support start, stop, restart, or update with `--restart`.

Choose on-demand for low-frequency, stateless operations or packages where startup cost is acceptable. Choose long-running for latency-sensitive services, connection pools, caches, or expensive initialization.

## Node Startup Protocol

For long-running instances, OctoBus executes:

```text
<runtime>/<node_entry> --runtime serve \
  --host 127.0.0.1 \
  --port <port> \
  --config <instance-workdir>/config.json \
  --secret-fd 3 \
  --workdir <instance-workdir> \
  --service <service-id> \
  --instance <instance-id>
```

File descriptor 3 contains the instance secret JSON. The SDK reads this fd directly, so service packages should not write the raw secret to ordinary files. If a package needs to persist derived state, write it under the instance workdir and avoid saving original credentials.

For on-demand requests, OctoBus invokes:

```text
<runtime>/<node_entry> --runtime invoke \
  --method <full-method> \
  --config <instance-workdir>/config.json \
  --secret-fd 3 \
  --metadata <request-metadata.json> \
  --workdir <instance-workdir> \
  --service <service-id> \
  --instance <instance-id>
```

`serve` and `invoke` both support `--secret-fd <fd>` for daemon-provided secrets. The SDK also supports `--secret <file>` for local development, but daemon protocol examples use `--secret-fd 3`.

Runtime environment:

```text
OCTOBUS_SERVICE_ID=<service-id>
OCTOBUS_INSTANCE_ID=<instance-id>
OCTOBUS_PACKAGE_DIR=<runtime>/<service_root>
OCTOBUS_DESCRIPTOR_PATH=<descriptor.protoset>
OCTOBUS_DESCRIPTOR_SHA256=<sha256>
```

Each instance has its own workdir for config, secret, logs, temp files, cache, and runtime state. Multiple instances of the same service share the runtime dir. `OCTOBUS_PACKAGE_DIR` points at the selected service root inside that runtime dir so SDK descriptor loading reads the correct `service.json`.

## Build Policy

`octobus service import --build=auto|always|never`.

Default is `auto`.

- `auto`: if bin exists, pack it; otherwise build when `prepack`, `prepare`, or `build` exists.
- `always`: require a build script and run it.
- `never`: do not build; bin target must already exist.

Build applies only to local directory and HTTPS Git source. Registry packages, tarballs, and zips are treated as already published artifacts.

When building source packages, OctoBus installs dev dependencies with `npm ci` if a lockfile exists, otherwise `npm install`, then runs npm lifecycle/build before packing.

## Runtime Dependencies

At import, OctoBus prepares production dependencies in the runtime dir:

- `npm ci --omit=dev` when lockfile exists.
- Otherwise `npm install --omit=dev`.
- `--offline` is passed through when requested.

If using `file:` dependencies, keep them inside the package and include them in npm package contents. Do not use paths outside the package such as `file:../helper.tgz`.

## Supported RPC Shape

The SDK can register unary, server-streaming, client-streaming, and bidirectional-streaming methods for long-running gRPC services.

Operational limits:

- On-demand `--runtime invoke` handles unary methods only; streaming calls return `UNIMPLEMENTED`.
- The generated service business CLI, used when no `--runtime` prefix is present, exposes implemented unary methods only.
- Agent/tool-facing package surfaces should normally remain unary. Use streaming only when a long-running service has real gRPC streaming clients.

## Validation Checklist

- `service.json` has required fields and no `id` or `entry`.
- Root `package.json bin` has a target for the selected service.
- Bin target exists in the packed artifact and is executable.
- Proto files compile from declared roots/files under the selected service root.
- Streaming methods are absent unless the package is long-running and intentionally exposes gRPC streams.
- Config and secret schemas are valid files inside the selected service root.
- Runtime dependencies are regular `dependencies`, not only `devDependencies`.
- `npm pack --dry-run` includes `service.json`, `package.json`, `proto/`, `bin/`, schemas, built output, and needed vendored files.

# OctoBus JavaScript SDK

Use `@chaitin-ai/octobus-sdk` for JavaScript service packages. It provides runtime commands, descriptor loading, gRPC server registration, health checks, local CLI helpers, on-demand invocation, validation, client generation, and gRPC error helpers.

## Contents

- Minimum package
- Handler contract
- Runtime and tooling commands
- service.json SDK CLI metadata
- Descriptor and ProtoJSON behavior
- Client generation
- Package install
- Implementation pattern

## Minimum Package

Prefer starting new packages with:

```bash
npx octobus-sdk bootstrap --name @acme/echo-service --out ./echo-service
```

For manual single-service packages, one `package.json bin` target is enough. Multi-service distribution packages can expose multiple root `bin` entries as long as each service root's `service.json.name` matches its bin key. Depend on the current SDK:

```json
{
  "name": "octobus-calculator",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "bin": {
    "calculator": "bin/calculator.js"
  },
  "dependencies": {
    "@chaitin-ai/octobus-sdk": "^0.5.0"
  },
  "scripts": {
    "validate": "octobus-sdk validate --strict",
    "test": "node --test"
  }
}
```

Minimal bin pattern:

```js
#!/usr/bin/env node

import { defineService, grpcInvalidArgumentError, runServiceMain } from "@chaitin-ai/octobus-sdk";

const service = defineService({
  handlers: {
    "calculator.v1.CalculatorService/Add": (ctx) => {
      const { left, right } = ctx.request;
      if (left < 0 || right < 0) {
        throw grpcInvalidArgumentError("inputs must be non-negative");
      }
      return { result: left + right };
    },
  },
});

runServiceMain(service);
```

## Handler Contract

Handler keys must match proto methods exactly:

```text
<proto package>.<Service>/<Method>
```

Handlers receive:

- `request`: decoded protobuf request for unary and server-streaming handlers.
- `requests`: async iterable for client-streaming and bidirectional-streaming handlers.
- `metadata`: gRPC metadata after OctoBus control headers are stripped. `x-octobus-*` control metadata is removed; `x-octobus-ext-*` business extension metadata is preserved.
- `config` / `secret`: instance JSON values.
- `method`, `serviceId`, `instanceId`, `workdir`, `packageDir`: runtime identity and paths.
- `getMetadata(name)` / `getMetadataAll(name)`: preferred metadata accessors.

The SDK can register unary and streaming handlers in long-running `--runtime serve` / `--runtime dev` mode. `--runtime invoke`, on-demand OctoBus runtime, and the generated business CLI used without `--runtime` support unary methods only. Agent/tool-facing methods should normally stay unary.

Missing handlers return `UNIMPLEMENTED`; `octobus-sdk validate --strict` turns missing unary and streaming handlers into validation errors.

## Errors

Throw SDK errors for expected failures:

- Bad user input or invalid config: `grpcInvalidArgumentError`.
- Missing or malformed credentials: `grpcUnauthenticatedError`.
- Valid credentials without permission: `grpcPermissionDeniedError`.
- Missing upstream resource: `grpcNotFoundError`.
- Timeout, rate limit, network issue, or temporary upstream outage: `grpcUnavailableError` unless a more specific status fits.
- Other explicit statuses: `new GrpcError(grpcStatus.DEADLINE_EXCEEDED, "upstream timeout")`.

Ordinary thrown errors map to `INTERNAL`.

## Runtime And Tooling Commands

`octobus-sdk` developer tooling:

```bash
npx octobus-sdk bootstrap --name @acme/echo-service --out ./echo-service
npx octobus-sdk bootstrap --name @acme/echo-service --out ./echo-service --runtime-mode long-running
npx octobus-sdk bootstrap --name @acme/echo-service --out ./echo-service --bundle-deps
npx octobus-sdk validate --strict
npx octobus-sdk inspect --yaml
npx octobus-sdk inspect --config-schema
npx octobus-sdk inspect --secret-schema --yaml
npx octobus-sdk client-stub --transport connect > connect-client.js
npx octobus-sdk client-stub --transport grpc > grpc-client.js
npx octobus-sdk client-package --transport connect --name @acme/calculator-client --out ./calculator-client
```

Service bin commands from `runServiceMain(service)`:

```bash
node bin/service.js --runtime dev --port 50051 --config-json '{}' --secret-json '{}'
node bin/service.js --help
node bin/service.js add --data-json '{"left":1,"right":2}' --config-json '{}'
node bin/service.js --runtime client-stub --transport connect --factory createCalculatorClient
node bin/service.js --runtime client-package --transport grpc --name @acme/calculator-grpc-client --out ./calculator-grpc-client
```

OctoBus itself calls `--runtime serve` for long-running instances and `--runtime invoke` for on-demand requests. Without `--runtime`, the service entry is treated as the business CLI.

For local business CLI use, `runServiceMain(service)` reads `OCTOBUS_SERVICE_CONTEXT` from the real environment or from `.env` in the current directory. The value is a JSON object with optional `config` and `secret` fields. Matching fields override `--config*` and `--secret*` CLI flags, while omitted fields keep falling back to CLI flags or `{}`:

```bash
OCTOBUS_SERVICE_CONTEXT='{"config":{"baseUrl":"https://example.com"},"secret":{"token":"dev-token"}}' \
node bin/service.js add --data-json '{"id":"123"}'
```

This environment contract applies only to the local business CLI and `--runtime dev`; OctoBus daemon `serve` / `invoke` runtime protocol still uses explicit config and secret arguments.

## service.json SDK CLI Metadata

`service.json` may include `sdk.cli.commands` keyed by full method name to override generated local CLI command names, descriptions, and examples.

Rules:

- Command metadata must target unary methods.
- Names must be unique after default command generation.
- `examples` is optional; each item has `argv: string[]` and optional `description`.
- Invalid command metadata fails SDK validation.

## Descriptor And ProtoJSON Behavior

The SDK loads `service.json` from `OCTOBUS_PACKAGE_DIR` when set, otherwise by walking up from the current working directory until it finds `service.json`. In multi-service packages, OctoBus sets `OCTOBUS_PACKAGE_DIR` to `<runtime>/<service_root>`, not the distribution package root.

Current SDK descriptor loading uses `protoc` to build a descriptor set, then `@bufbuild/protobuf` `FileRegistry` to drive gRPC service definitions, Connect/gRPC client generation, validation, and ProtoJSON rendering. When `OCTOBUS_DESCRIPTOR_PATH` is set, the SDK reads that archived descriptor set instead of compiling proto files again.

`protoc` include paths are the active service root/packageDir plus every `service.json proto.roots` entry. Ensure `protoc` is available in local development and test environments.

Handlers may return plain JavaScript objects; the SDK serializes them through the protobuf descriptor. Prefer `string` fields for upstream identifiers, timestamps, opaque tokens, and exact large numeric values.

The generated business CLI, used when no `--runtime` prefix is present, prints response JSON through `@bufbuild/protobuf` ProtoJSON serialization. Well-known types, bytes, enums, maps, repeated fields, and custom `json_name` values follow ProtoJSON behavior. Do not add protobuf runtime libraries to service package dependencies just for descriptor loading or CLI ProtoJSON; they are SDK internals unless business logic needs them.

## Client Generation

`client-stub` prints a single-file ESM wrapper. `client-package` writes a descriptor-backed npm package that includes descriptor assets and can be copied into a consumer project without the original service package or source proto files.

The low-level Connect stub groups methods by full protobuf service name:

```js
const result = await client.services["calculator.v1.CalculatorService"].Add({ left: 1, right: 2 });
```

Generated `client-stub` / `client-package` wrappers also expose short aliases such as `client.CalculatorService.Add(...)`. gRPC clients expose unary and streaming method wrappers for native `@grpc/grpc-js` callers, and inject OctoBus routing metadata when `capsetId`, `serviceId`, or `instanceId` are provided. Caller-provided `x-octobus-ext-*` metadata is treated as business metadata and forwarded to handlers.

## Package Install

Install the SDK from npmjs when needed:

```bash
npm install @chaitin-ai/octobus-sdk
```

Inside this repository, use existing example package versions as the dependency baseline.

## Implementation Pattern

Keep SDK glue thin:

- `bin/service.js`: imports SDK and handler modules, defines handler map, calls `runServiceMain(service)`.
- `src/client.js`: creates upstream clients from config and secret.
- `src/mappers.js`: maps proto-shaped requests/responses.
- `test/*.test.js`: tests client, mappers, and handlers with mocked upstream clients.

This keeps business logic unit-testable without starting gRPC.

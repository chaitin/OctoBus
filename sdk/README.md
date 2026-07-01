# @chaitin-ai/octobus-sdk

TypeScript SDK for OctoBus Node.js service packages.

## Quick Start

Create a minimal service package scaffold:

```bash
npx @chaitin-ai/octobus-sdk bootstrap \
  --name @acme/echo-service \
  --out ./echo-service
```

For packages that need to run in an OctoBus environment without npm registry access, include production dependencies in the generated package:

```bash
npx @chaitin-ai/octobus-sdk bootstrap \
  --name @acme/echo-service \
  --out ./echo-service \
  --bundle-deps
```

Or create a package manually with `service.json`, `package.json bin`, proto files, and a runtime entry:

```json
{
  "schema": "chaitin.octobus.service.v1",
  "name": "calculator",
  "proto": {
    "roots": ["proto"],
    "files": ["proto/calculator.proto"]
  },
  "configSchema": "config.schema.json",
  "secretSchema": "secret.schema.json"
}
```

```json
{
  "type": "module",
  "bin": {
    "calculator": "bin/calculator.js"
  },
  "dependencies": {
    "@chaitin-ai/octobus-sdk": "^0.6.0"
  }
}
```

Use a semver range for published service packages instead of `latest`, so OctoBus imports remain reproducible.

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
      return {
        result: left + right,
        requestId: ctx.getMetadata("x-request-id") || "",
      };
    },
  },
});

runServiceMain(service);
```

`service.json` must not define `id` or `entry`. OctoBus assigns service ids during import, and the runtime entry is resolved from the distribution package root `package.json bin`. For a multi-service package, `service.json.name` must match the root `bin` object key for that service.

## Local Development

Validate package shape and proto loading:

```bash
npx @chaitin-ai/octobus-sdk bootstrap --name @acme/echo-service --out ./echo-service
npx @chaitin-ai/octobus-sdk validate
npx @chaitin-ai/octobus-sdk inspect
npx @chaitin-ai/octobus-sdk inspect --yaml
npx @chaitin-ai/octobus-sdk inspect --config-schema
npx @chaitin-ai/octobus-sdk inspect --secret-schema --yaml
npx @chaitin-ai/octobus-sdk client-stub --transport connect > connect-client.js
npx @chaitin-ai/octobus-sdk client-stub --transport grpc > grpc-client.js
npx @chaitin-ai/octobus-sdk client-package \
  --transport connect \
  --name @acme/calculator-client \
  --out ./calculator-client
```

Run the service entry directly for a local gRPC server:

```bash
node bin/calculator.js --runtime dev --port 50051 --config-json '{}'
```

Print package schema files from the service entry when using the package as an `npx` command or local executable:

```bash
node bin/calculator.js --runtime inspect --config-schema
node bin/calculator.js --runtime inspect --secret-schema
```

Use the package as a local CLI. When no `--runtime` prefix is present, `runServiceMain(service)` treats argv as business CLI commands generated from implemented unary gRPC methods:

```bash
node bin/calculator.js --help
node bin/calculator.js add \
  --data-json '{"left":1,"right":2}' \
  --config-json '{}'
```

Method help prints that command's JSON contract:

```bash
node bin/calculator.js add --help
```

OctoBus itself calls `--runtime serve` for long-running instances and `--runtime invoke` for on-demand instances. These runtime commands are implemented by `runService` / `runServiceMain`.

For repeated local CLI or `--runtime dev` calls, provide config and secret through
`OCTOBUS_SERVICE_CONTEXT` instead of repeating long flags:

```bash
OCTOBUS_SERVICE_CONTEXT='{"config":{"label":"local"},"secret":{"apiToken":"dev-token"}}' \
node bin/calculator.js add --data-json '{"left":1,"right":2}'
```

The SDK also reads `OCTOBUS_SERVICE_CONTEXT` from `.env` in the current working
directory. Only that key is read; other `.env` entries are not injected. The
value must be a JSON object with optional `config` and `secret` fields. Fields
from the real environment override `.env`, and either source overrides the
matching `--config*` or `--secret*` CLI option independently. This context is
not used by `--runtime serve`, `--runtime invoke`, inspect, client generation,
or the `octobus-sdk` developer CLI.

## Connect RPC Client Stub

The SDK can build a Connect RPC client from a service package's protobuf descriptor. It calls OctoBus Connect JSON endpoints for the package's unary methods:

```js
import { createConnectRpcStub } from "@chaitin-ai/octobus-sdk";

const client = createConnectRpcStub({
  baseUrl: "http://127.0.0.1:9000",
  capsetId: "dev",
  instanceId: "calculator-test",
});

const result = await client.services["calculator.v1.CalculatorService"].Add({
  left: 1,
  right: 2,
});
```

You can also print a small ESM wrapper for the current service package:

```bash
npx @chaitin-ai/octobus-sdk client-stub --transport connect --factory createCalculatorClient
```

The generated wrapper exposes service aliases such as `CalculatorService.Add(...)` while delegating protobuf JSON conversion and HTTP calls to `createConnectRpcStub`.

To generate a complete npm client package that can be copied into a consumer project without the original service package or `protoc`:

```bash
npx @chaitin-ai/octobus-sdk client-package \
  --transport connect \
  --name @acme/calculator-client \
  --out ./calculator-client \
  --factory createCalculatorClient
```

The generated package contains `package.json`, `README.md`, `index.js`, `index.d.ts`, and descriptor assets under `descriptors/`. The generated `index.js` loads `descriptors/descriptor.pb` and `descriptors/service.json` relative to `import.meta.url`, then exposes aliases such as `client.CalculatorService.Add(...)`.

By default `client-package` only writes the package directory and dependency metadata. Use `--bundle-deps` to run `npm install --omit=dev` and mark runtime dependencies as bundled, or `--publish` to run `npm publish` in the generated directory with the current npm configuration.

## gRPC Client Stub

For Node.js callers that need native gRPC, the SDK can print a small Promise-style wrapper for the current package:

```bash
npx @chaitin-ai/octobus-sdk client-stub --transport grpc --factory createCalculatorGrpcClient > calculator-grpc-client.js
```

The generated wrapper exposes service methods without requiring callers to pass method names as strings:

```js
import { createCalculatorGrpcClient } from "./calculator-grpc-client.js";

const client = createCalculatorGrpcClient({
  address: "127.0.0.1:9000",
  capsetId: "dev",
  serviceId: "calculator",
  instanceId: "calculator-test",
});

const result = await client.services["calculator.v1.CalculatorService"].Add({
  left: 1,
  right: 2,
});

client.close();
```

The client injects OctoBus routing metadata when `capsetId`, `serviceId`, or `instanceId` are provided. Additional metadata can be supplied on the client or per call:

```js
await client.CalculatorService.Add(
  { left: 1, right: 2 },
  { metadata: { "x-request-id": "req-123" } },
);
```

The generated wrapper exposes Promise methods such as `CalculatorService.Add(...)`, plus `raw` gRPC clients for callers that need `@grpc/grpc-js` directly.

You can also generate a descriptor-backed npm package:

```bash
npx @chaitin-ai/octobus-sdk client-package \
  --transport grpc \
  --name @acme/calculator-grpc-client \
  --out ./calculator-grpc-client
```

The gRPC generated package includes `@grpc/grpc-js` as a dependency and emits wrapper signatures for unary, server-streaming, client-streaming, and bidirectional-streaming methods based on the service definitions. Runtime streaming support is provided by `createGrpcStub`.

## Handler Context

Handlers receive:

- `request`: decoded protobuf request object.
- `metadata`: gRPC metadata with OctoBus control headers stripped. The SDK strips `x-octobus-*` control metadata and preserves `x-octobus-ext-*` business extension metadata such as `x-octobus-ext-username`.
- `config` and `secret`: instance JSON values.
- `method`: full method name, for example `calculator.v1.CalculatorService/Add`.
- `serviceId`, `instanceId`, `workdir`, and `packageDir`: runtime identity and paths.
- `getMetadata(name)` and `getMetadataAll(name)`: convenient metadata accessors.

`--runtime serve` / `--runtime dev` support unary, server-streaming, client-streaming, and bidirectional-streaming handlers. `--runtime invoke` and the generated business CLI used without `--runtime` only support unary methods; streaming methods are reported by `validateService` and are not exposed as local CLI commands.

## Errors

Throw `GrpcError` or helper constructors to return specific gRPC status codes:

```js
import { grpcNotFoundError, grpcPermissionDeniedError, grpcStatus, GrpcError } from "@chaitin-ai/octobus-sdk";

throw grpcNotFoundError("resource missing");
throw grpcPermissionDeniedError("token rejected");
throw new GrpcError(grpcStatus.UNAVAILABLE, "upstream unavailable");
```

Ordinary thrown errors are mapped to `INTERNAL`.

## Install

```bash
npm install @chaitin-ai/octobus-sdk
```

For global CLI usage:

```bash
npm install -g @chaitin-ai/octobus-sdk
```

The package is published to npmjs under the existing `@chaitin-ai` scope.

## Publish

SDK releases are published to npmjs by the GitHub Actions workflow when a GitHub Release is published. The Release tag must use the `sdk-v<version>` format, and `<version>` must match `sdk/package.json.version` exactly. Repository administrators must configure the GitHub secret `NPM_TOKEN` with permission to publish `@chaitin-ai/octobus-sdk`.

```bash
npm version 0.1.1 --prefix sdk --no-git-tag-version
git add sdk/package.json sdk/package-lock.json
git commit -m "Release SDK 0.1.1"
git tag sdk-v0.1.1
git push origin main sdk-v0.1.1
```

After pushing the tag, create and publish the GitHub Release for `sdk-v0.1.1`. Stable versions publish with npm's default `latest` dist-tag. Prerelease versions publish with the `next` dist-tag. Tags that do not match `sdk-v<version>` or do not match `sdk/package.json.version` fail before publishing.

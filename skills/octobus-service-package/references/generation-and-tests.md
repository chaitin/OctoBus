# Generating Service Packages From API Docs

This workflow turns API docs, request examples, and existing code into an OctoBus JavaScript service package.

## Contents

- Inputs to collect
- Proto design
- Schemas
- HTTP/API client guidance
- Handler pattern
- Test strategy
- Local validation commands
- Review checklist

## Inputs To Collect

- API base URL, authentication scheme, and required headers.
- Endpoint docs, request samples, response samples, and error examples.
- Existing API wrapper/client code, if any.
- Desired service id/name and runtime mode.
- Which operations should be exposed to agents/tools.
- Required instance config and secret values.

If docs are incomplete, infer conservatively from examples and make assumptions explicit in code comments or final notes.

## Proto Design

Design proto before writing handlers.

Rules:

- Use `proto3`.
- Use a stable package such as `vendor.product.v1`.
- Use service names ending in `Service`.
- Prefer unary RPCs for operations exposed to agents, tools, on-demand runtime, or the generated local CLI.
- Use streaming only for long-running gRPC services that explicitly need streams.
- Prefer request/response messages per operation when shapes differ.
- Use `string` for upstream ids, timestamps, URLs, opaque tokens, and large numeric identifiers.
- Use numeric types only for true numeric values where precision loss is acceptable.
- Use repeated messages for arrays.
- Use `map<string, string>` only for simple label/header dictionaries.
- Use `[json_name = "..."]` when JSON field names must match an existing camelCase contract.
- Prefer plain JSON-compatible response shapes for local CLI use; well-known types are acceptable when they model the domain clearly.

Tiny shape example:

```proto
syntax = "proto3";
package gitlab.v1;

service GitLabService {
  rpc GetIssue(GetIssueRequest) returns (Issue);
}

message GetIssueRequest {
  string project_id = 1 [json_name = "projectId"];
  string issue_iid = 2 [json_name = "issueIid"];
}
```

## Schemas

Use `config.schema.json` for non-secret instance settings and `secret.schema.json` for credentials. Keep both strict when the upstream contract is known:

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["baseUrl"],
  "properties": {
    "baseUrl": { "type": "string", "format": "uri" },
    "timeoutMs": { "type": "integer", "minimum": 1, "default": 10000 }
  }
}
```

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["apiToken"],
  "properties": {
    "apiToken": { "type": "string", "minLength": 1 }
  }
}
```

## HTTP/API Client Guidance

Prefer established libraries:

- HTTP: `undici` / native `fetch` on modern Node, `axios`, or official vendor SDKs.
- Retries/backoff: `p-retry`, `async-retry`, or client-native retry support.
- Validation/parsing: `zod`, `ajv`, or library-provided schemas.
- Auth/JWT/OAuth: `jose`, `openid-client`, or vendor SDKs.

Do not hand-roll OAuth flows, JWT verification/signing, multipart encoders, URL query escaping, retry timers, or nontrivial schema validators.

## Handler Pattern

Validate local required fields before upstream calls. Keep config and secret parsing in small helpers, map upstream errors to SDK gRPC errors, and keep request/response mapping separate from SDK glue.

Pattern:

```js
import { grpcInvalidArgumentError, grpcUnauthenticatedError } from "@chaitin-ai/octobus-sdk";

export function requireString(value, name) {
  if (typeof value !== "string" || value.trim() === "") {
    throw grpcInvalidArgumentError(`${name} is required`);
  }
  return value.trim();
}

export function requireSecretString(value, name) {
  if (typeof value !== "string" || value.trim() === "") {
    throw grpcUnauthenticatedError(`${name} is required`);
  }
  return value.trim();
}
```

If handlers create clients internally, inject a client factory or export pure functions so tests can pass fake clients.

## Test Strategy

A focused generated package should cover:

1. Manifest/proto validation.
2. Handler happy paths.
3. Missing required fields/config/secret.
4. Upstream error mapping.
5. Request/response mapper behavior for real samples.
6. Local CLI smoke tests for agent-facing unary methods when JSON shape matters.

Recommended scripts:

```json
{
  "scripts": {
    "validate": "octobus-sdk validate --strict",
    "test": "node --test",
    "pack:check": "npm pack --dry-run"
  }
}
```

Use `vitest run` if the package already uses Vitest. Test handlers directly with a minimal context object containing `request`, `metadata`, `config`, `secret`, `method`, `serviceId`, `instanceId`, `workdir`, `packageDir`, `getMetadata`, and `getMetadataAll`. For OctoBus-scoped business metadata, use `x-octobus-ext-*` keys such as `x-octobus-ext-username`; do not rely on stripped routing metadata.

## Local Validation Commands

Run from the service package root:

```bash
npm install
npm test
npx octobus-sdk validate --strict
npx octobus-sdk inspect --yaml
npx octobus-sdk client-stub --transport connect > /tmp/connect-client.js
npx octobus-sdk client-stub --transport grpc > /tmp/grpc-client.js
npm pack --dry-run
```

Optional runtime smoke:

```bash
node bin/service.js --runtime dev --port 50051 --config-json '{"baseUrl":"https://api.example.test"}' --secret-json '{"apiToken":"token"}'
node bin/service.js --help
```

Optional OctoBus import smoke from the repository root:

```bash
octobus service import --id <service-id> <package-dir>
```

For new packages, prefer SDK bootstrap and then edit the generated proto, schemas, and handler:

```bash
npx octobus-sdk bootstrap --name @acme/example-service --out ./example-service
npx octobus-sdk bootstrap --name @acme/example-service --out ./example-service --runtime-mode long-running
npx octobus-sdk bootstrap --name @acme/example-service --out ./example-service --bundle-deps
```

For generated consumer clients:

```bash
npx octobus-sdk client-package --transport connect --name @acme/example-client --out ./example-client
npx octobus-sdk client-package --transport grpc --name @acme/example-grpc-client --out ./example-grpc-client
```

## Review Checklist

- Service package imports only runtime dependencies from `dependencies`.
- Dev-only test/build tools are in `devDependencies`.
- `service.json` proto paths match actual files.
- root `package.json bin` target for the selected service exists and is executable.
- Handler keys match proto exactly.
- `npx octobus-sdk validate --strict` passes with handlers for every declared unary and streaming method.
- Generated client stubs/packages are checked when a consumer-facing client is part of the task.
- Tests cover success and failure behavior.
- `npm pack --dry-run` includes all runtime files.
- No credentials, local data dirs, logs, or packaged artifacts are committed.

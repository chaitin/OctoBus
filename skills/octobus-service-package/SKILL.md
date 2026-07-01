---
name: octobus-service-package
description: Use when creating, reviewing, or fixing OctoBus JavaScript service packages from API docs, request examples, existing implementations, or proto/service manifests. Helps generate npm-compatible service packages with service.json, package.json bin, proto contracts, SDK handlers, config/secret schemas, and tests.
---

# OctoBus Service Package

## Purpose

Use this skill to develop OctoBus service packages, especially JavaScript packages built with `@chaitin-ai/octobus-sdk`. The output should be an importable npm-compatible package, not just loose handler code.

## Reference Map

Read only the references needed for the task:

- `references/service-package-contract.md`: OctoBus package manifest, import/build/runtime rules, long-running vs on-demand behavior.
- `references/js-sdk.md`: `@chaitin-ai/octobus-sdk` APIs, runtime commands, handler context, errors, validation, and local development commands.
- `references/generation-and-tests.md`: workflow for generating packages from API docs/samples and the expected test strategy.

## Default Workflow

1. Inspect available context: API docs, request/response examples, existing client code, current package files, or similar examples under `examples/`.
2. Design the proto first: stable package name, normally unary RPC methods, request/response messages, field names with JSON compatibility, and explicit error behavior.
3. For new JavaScript packages, prefer starting from `npx octobus-sdk bootstrap --name ... --out ...`, then edit the generated proto, schemas, and handler. Use `--runtime-mode long-running` only when a persistent gRPC service is required.
4. Create or update the package files:
   - `service.json`
   - root `package.json` with `bin` targets; for multi-service packages, each service root `service.json.name` must match a root `bin` key
   - `proto/*.proto`
   - `bin/*.js` or TypeScript source plus build output
   - `config.schema.json` and `secret.schema.json` when configuration or credentials are required
   - tests beside the package when the package owns meaningful logic
5. Implement handlers with `@chaitin-ai/octobus-sdk`. Do not reimplement the OctoBus `serve` / `invoke` protocol, gRPC health checks, descriptor loading, ProtoJSON rendering, or CLI plumbing unless the user explicitly asks for a non-SDK package.
6. Use mainstream libraries for foundational concerns such as HTTP clients, schema validation, retries, date parsing, OAuth/JWT, and URL construction. Avoid ad hoc protocol clients when an established package exists.
7. Validate locally:
   - `npm install` or `npm ci`
   - `npx octobus-sdk validate --strict` when all declared methods should be implemented
   - `npx octobus-sdk client-stub --transport connect` or `--transport grpc` when client generation matters
   - package tests (`npm test`, `node --test`, `vitest`, etc.)
   - `node <bin> --runtime dev --port 50051 --config-json '{}' --secret-json '{}'` for runtime smoke tests when useful
   - `npm pack --dry-run` to confirm package contents
   - `octobus service import --id <id> <package-dir>` for end-to-end import when OctoBus is available

## Generation Rules

- Prefer a small, explicit proto surface over mirroring an entire upstream API mechanically.
- Prefer unary RPC methods for agent/tool-facing packages, especially on-demand packages and methods exposed through the generated local CLI. Use streaming only when the service is long-running and real gRPC clients need server, client, or bidirectional streams.
- Keep secrets out of config. Put tokens, passwords, API keys, and private keys in `secretSchema`.
- Map upstream validation failures to `grpcInvalidArgumentError`, auth failures to `grpcUnauthenticatedError` or `grpcPermissionDeniedError`, missing resources to `grpcNotFoundError`, and transient upstream failures to `grpcUnavailableError`.
- Use `ctx.getMetadata()` / `ctx.getMetadataAll()` for request metadata and `ctx.config` / `ctx.secret` for instance data. OctoBus control metadata (`x-octobus-*`) is stripped before handlers run; OctoBus-scoped business metadata must use `x-octobus-ext-*`, for example `x-octobus-ext-username`.
- Preserve handler keys exactly as `<proto.package>.<Service>/<Method>`, for example `gitlab.v1.GitLabService/GetIssue`.
- For on-demand packages, set `service.json.runtime.mode` to `on-demand` and keep handlers stateless enough for one-process-per-request execution.
- For long-running packages, assume multiple instances share the package runtime directory but have separate workdirs.

## Quality Bar

Generated packages should include tests that cover:

- request mapping from proto-shaped input to upstream calls
- response mapping back to proto-shaped objects
- config and secret handling
- upstream error mapping to gRPC errors
- handler validation against proto methods

For packages with nontrivial upstream integration, isolate business logic from SDK glue so unit tests can mock HTTP/API clients without starting gRPC.

## Useful Existing Examples

- Long-running JavaScript example: `examples/calculator-js`
- On-demand JavaScript example: `examples/calculator-on-demand-js`
- Streaming JavaScript example: `examples/streaming-js`
- SDK tests and fixtures: `sdk/tests`

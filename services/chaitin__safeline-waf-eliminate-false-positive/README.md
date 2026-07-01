# SafeLine WAF Eliminate False Positive OctoBus Service

This package preserves legacy gRPC package and method names where applicable.

- Service name: `safeline-waf-eliminate-false-positive`
- Service dir: `chaitin__safeline-waf-eliminate-false-positive`
- Runtime mode: `long-running`

Import it into OctoBus with:

```bash
octobus service import --id safeline-waf-eliminate-false-positive ./services/chaitin__safeline-waf-eliminate-false-positive
```

## Package Files

- `service.json`: OctoBus service manifest.
- `proto/safeline_waf_eliminate_false_positive.proto`: gRPC API definition.
- `config.schema.json`: non-secret upstream target, method, and timeout defaults.
- `secret.schema.json`: empty secret schema; this proxy service does not need credentials.
- `src/safeline-waf-eliminate-false-positive.js`: legacy proxy mapping plus SDK handler implementation.
- `src/service.js`: OctoBus SDK `defineService` wrapper.
- `bin/safeline-waf-eliminate-false-positive.js`: service-local executable entrypoint.
- `test/safeline-waf-eliminate-false-positive.test.js`: node:test coverage for validation, proxy mapping, config defaults, and SDK handler invocation.
- `test/mock_upstream.js`: optional local SafeLine gRPC mock.

## Configuration

Requests may provide `target`, `method`, `event_id`, and `is_global` directly. `target` and `method` can also be supplied through package config or bindings:

```json
{
  "target": "10.9.33.133:50053",
  "method": "safeline.eliminate.EliminateService/EliminateFalsePositive",
  "timeoutMs": 1500
}
```

Request values take precedence over configured defaults. The service normalizes `method` to a leading slash before calling the upstream gRPC proxy.

## RPC Methods

- `safeline.eliminate.EliminateService/EliminateFalsePositive`

## Behavior Notes

- Missing `target`, `method`, or `event_id` maps to `INVALID_ARGUMENT`.
- `is_global` must be a boolean.
- Positive `timeoutMs` values are used as the upstream timeout; invalid or missing values fall back to `1500`.
- Empty validation probes return a dummy `proxy.toGrpc` mapping against `0.0.0.0:0`.
- This unary RPC is a write operation against the upstream SafeLine gRPC service because it eliminates a false-positive event. Grant it only to trusted capsets.
- This service has no HTTP client and no TLS-skip flag; TLS and deadline behavior are delegated to the OctoBus `ctx.proxy.toGrpc` runtime mapping.

## Known Limits

- The service depends on the OctoBus gRPC proxy runtime; unit tests use a fake `ctx.proxy.toGrpc`.
- It does not implement independent HTTP timeout or TLS controls.

## OctoBus Example

```bash
octobus instance create safeline-eliminate-test --service safeline-waf-eliminate-false-positive \
  --config-json '{"target":"10.9.33.133:50053","method":"safeline.eliminate.EliminateService/EliminateFalsePositive","timeoutMs":1500}'
octobus capset create safeline-actions --name "SafeLine Actions"
octobus capset add-instance safeline-actions safeline-eliminate-test
```

## Local Checks

```bash
cd services
npm run validate -- --service-dir chaitin__safeline-waf-eliminate-false-positive
npm test -- --service-dir chaitin__safeline-waf-eliminate-false-positive
npm test -- --service-dir chaitin__safeline-waf-eliminate-false-positive --coverage
npm run pack:check
```

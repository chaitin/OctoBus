# SafeLine WAF OctoBus Service

This package preserves legacy gRPC package and method names where applicable.

- Service name: `safeline-waf`
- Service dir: `chaitin__safeline-waf`
- Runtime mode: `long-running`

Import it into OctoBus with:

```bash
octobus service import --id safeline-waf ./services/chaitin__safeline-waf
```

## Package Files

- `service.json`: OctoBus service manifest.
- `proto/safeline_waf.proto`: gRPC API definition.
- `config.schema.json`: non-secret endpoint, headers, timeout, and TLS settings.
- `secret.schema.json`: default SafeLine API token fields.
- `src/safeline-waf.js`: SafeLine REST proxy implementation.
- `src/service.js`: OctoBus SDK `defineService` wrapper.
- `bin/safeline-waf.js`: service-local executable entrypoint.
- `test/safeline-waf.test.js`: node:test coverage for request validation, REST mapping, error mapping, block/unblock workflows, and SDK handler invocation.
- `test/mock_upstream.js`: optional local SafeLine HTTP mock.

## Configuration

Use `endpoint` for the SafeLine REST API base URL. Legacy aliases `restBaseUrl`, `rest_base_url`, `baseUrl`, and `base_url` are also accepted.

```json
{
  "endpoint": "https://safeline.example.com",
  "headers": {
    "X-Extra": "demo"
  },
  "timeoutMs": 1500,
  "skipTlsVerify": false
}
```

Use `secret.apiToken` or `secret.api_token` for the SafeLine `API-TOKEN` header:

```json
{
  "apiToken": "replace-with-safeline-token"
}
```

Deprecated request `api_token` / `apiToken` and deprecated config token fields are ignored when instance secret provides a token. If a config token fallback is retained for compatibility, it has lower priority than `secret`.

## RPC Methods

- `Chaitin_WAF_SAFELINE.Chaitin_WAF_SAFELINE/AggregateDetectLogBySrcIP`
- `Chaitin_WAF_SAFELINE.Chaitin_WAF_SAFELINE/CreateIPGroup`
- `Chaitin_WAF_SAFELINE.Chaitin_WAF_SAFELINE/UpdateIPGroup`
- `Chaitin_WAF_SAFELINE.Chaitin_WAF_SAFELINE/ListIPGroups`
- `Chaitin_WAF_SAFELINE.Chaitin_WAF_SAFELINE/DeleteIPGroup`
- `Chaitin_WAF_SAFELINE.Chaitin_WAF_SAFELINE/DeleteIPGroupItems`
- `Chaitin_WAF_SAFELINE.Chaitin_WAF_SAFELINE/AddIPGroupItems`
- `Chaitin_WAF_SAFELINE.Chaitin_WAF_SAFELINE/BlockIP`
- `Chaitin_WAF_SAFELINE.Chaitin_WAF_SAFELINE/UnblockIP`
- `Chaitin_WAF_SAFELINE.Chaitin_WAF_SAFELINE/GetDetectorState`
- `Chaitin_WAF_SAFELINE.Chaitin_WAF_SAFELINE/UpdateDetectorState`

## Behavior Notes

- `AggregateDetectLogBySrcIP` calls `GET /api/DetectLogAggregateView`.
- Read RPCs: `AggregateDetectLogBySrcIP`, `ListIPGroups`, and `GetDetectorState`.
- Write RPCs: `CreateIPGroup`, `UpdateIPGroup`, `DeleteIPGroup`, `AddIPGroupItems`, `DeleteIPGroupItems`, `BlockIP`, `UnblockIP`, and `UpdateDetectorState`.
- IP group CRUD calls `/api/IPGroupAPI`; IP group item add/delete calls `/api/EditIPGroupItem`; detector state calls `/api/EnableDisableDetectorAPI`.
- HTTP 401/403 maps to `PERMISSION_DENIED`.
- Other HTTP 4xx responses map to `FAILED_PRECONDITION`.
- HTTP 5xx, network, and TLS failures map to `UNAVAILABLE`.
- Non-JSON success bodies map to `UNKNOWN`.
- Timeout uses AbortController and `skipTlsVerify` uses a per-request dispatcher. Errors do not return the API token or complete upstream raw body.

## Limitations

- The SafeLine API token must come from instance `secret` or deprecated instance config fallback. Deprecated request token fields are ignored by the runtime and remain in proto only for legacy schema compatibility.
- RPCs proxy SafeLine REST semantics directly; write calls are not idempotent unless the upstream endpoint treats the same payload as idempotent.

## OctoBus Example

```bash
octobus instance create safeline-waf-prod --service safeline-waf \
  --config-json '{"endpoint":"https://safeline.example.com","timeoutMs":1500}' \
  --secret-json '{"apiToken":"replace-with-safeline-token"}'
octobus capset create safeline-read --name "SafeLine Read"
octobus capset add-instance safeline-read safeline-waf-prod
```

## Local Checks

```bash
cd services
npm run validate -- --service-dir chaitin__safeline-waf
npm test -- --service-dir chaitin__safeline-waf
npm test -- --service-dir chaitin__safeline-waf --coverage
npm run pack:check
```

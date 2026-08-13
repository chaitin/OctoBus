# Tencent TIX SaaS OctoBus Service

This package integrates Tencent Security Threat Intelligence Center TIX SaaS cloud lookup APIs authorized for basic threat-intelligence queries.

Issue: https://github.com/chaitin/OctoBus/issues/94

Import it into OctoBus with:

```bash
octobus service import tencent-tix-saas ./services/tencent__tix-saas
```

## Supported Version and Authorized Scope

- Tencent TIX API v3.0, validated against Tencent TIX cloud lookup API documentation.
- Endpoint: `https://xti.qq.com/api/v3/ti`
- Authentication: TIX API `AppKey` passed as `c_appkey` in the JSON request body. `AppId` is associated with the authorization but is not sent by these API calls.

Tencent TIX API access requires an AppKey. TIX authorization is scenario-scoped, so this package only exposes the modules currently authorized for validation:

- IOC compromise intelligence: `c_action=TiInfo`
- Active attack source IP intelligence: `c_action=IpIngressInfo`
- File reputation intelligence: `c_action=FileInfo`

Advanced analysis APIs, URL intelligence, vulnerability intelligence, IP profile intelligence, and file upload APIs are intentionally excluded because they are outside the currently authorized scope.

## Package Files

- `service.json`: OctoBus service manifest.
- `proto/tencent_tix_saas.proto`: gRPC API definition.
- `config.schema.json`: endpoint, language, timeout, TLS, and header settings.
- `secret.schema.json`: AppKey fields.
- `src/tencent-tix-saas.js`: Tencent TIX REST proxy implementation.
- `src/service.js`: OctoBus SDK `defineService` wrapper.
- `bin/tencent-tix-saas.js`: service-local executable entrypoint.
- `test/tencent-tix-saas.test.js`: node:test coverage for request mapping, response mapping, error mapping, and SDK handler invocation.
- `test/mock_upstream.js`: optional local Tencent TIX HTTP mock.

## Configuration

```json
{
  "endpoint": "https://xti.qq.com/api/v3/ti",
  "lang": "zh",
  "version": "3.0",
  "timeoutMs": 30000
}
```

Use `secret.appKey`, `secret.app_key`, or `secret.c_appkey` for the Tencent TIX AppKey. `secret.appId` can be recorded for operators, but the service does not send it to the API:

```json
{
  "appId": "replace-with-tencent-tix-appid",
  "appKey": "replace-with-tencent-tix-appkey"
}
```

## RPC Methods

- `Tencent_TIX_SaaS.Tencent_TIX_SaaS/QueryIOC` maps to `c_action=TiInfo`.
- `Tencent_TIX_SaaS.Tencent_TIX_SaaS/GetIPIngressInfo` maps to `c_action=IpIngressInfo`, default `type=ip`.
- `Tencent_TIX_SaaS.Tencent_TIX_SaaS/GetFileInfo` maps to `c_action=FileInfo`; `type` is `md5`, `sha1`, or `sha256` and is inferred from the hash length when omitted.

All methods return `http_status`, `return_code`, `return_msg`, `raw_body`, `raw_json`, and `no_data`. Complex Tencent TIX result fields are intentionally preserved in `raw_json` instead of being narrowed into early stable fields.

## Behavior Notes

- `return_code=0` is success.
- `return_code=1` means no data and returns normally with `no_data=true`.
- `return_code=1003` maps to `UNAUTHENTICATED`.
- `return_code=1004` and `1005` map to `RESOURCE_EXHAUSTED` when supported by the SDK, otherwise `FAILED_PRECONDITION`.
- `return_code=1006` and temporary file-analysis states map to `UNAVAILABLE`.
- Parameter and upload-size errors map to `INVALID_ARGUMENT`.
- HTTP 401 maps to `UNAUTHENTICATED`; HTTP 403 maps to `PERMISSION_DENIED`; HTTP 5xx and network errors map to `UNAVAILABLE`.
- TLS certificate verification is not skipped by this service. Use a trusted TLS certificate for the Tencent TIX endpoint.

## Risk Boundary

This package only implements read-only, authorized basic-query APIs. File upload, sandbox upload, and Skill upload APIs are intentionally excluded from the initial scope because they are outside the current authorization and have larger privacy, file-handling, polling, and quota risks.

Recommended capset: read-only threat intelligence lookup methods only. Do not grant this service write, upload, vulnerability-query, URL-analysis, or file-submission capabilities.

## Local Checks

```bash
cd services
npm run validate -- --service-dir tencent__tix-saas
npm test -- --service-dir tencent__tix-saas
npm run pack:check
```

## Real Validation

Use a Tencent TIX trial or paid AppKey to validate at least one read-only method before PR submission. Keep real AppKey values, production customer indicators, and sensitive screenshots out of code, tests, README, and PR artifacts.

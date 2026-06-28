# Apache APISIX 3.17

OctoBus service package for Apache APISIX 3.17.0 Admin API. Apache APISIX is an API Gateway product from the Apache Software Foundation. This adapter covers Route and Upstream management for integration validation.

## Version

- Product: Apache APISIX
- Tested version: 3.17.0
- Product type: API Gateway
- API: Admin API
- Auth: `X-API-KEY`

## Configuration

```json
{
  "baseUrl": "http://127.0.0.1:9180",
  "timeoutMs": 5000,
  "tlsRejectUnauthorized": true,
  "allowedIdPrefix": "octobus-test-"
}
```

Secret:

```json
{
  "adminApiKey": "<APISIX_ADMIN_KEY>"
}
```

Keep APISIX Admin API bound to a private address. For a remote lab host, use an SSH tunnel and set `baseUrl` to the local tunnel URL.

## Methods

- `ListRoutes`: `GET /apisix/admin/routes`
- `GetRoute`: `GET /apisix/admin/routes/{id}`
- `UpsertRoute`: `PUT /apisix/admin/routes/{id}`
- `DeleteRoute`: `DELETE /apisix/admin/routes/{id}`
- `ListUpstreams`: `GET /apisix/admin/upstreams`
- `GetUpstream`: `GET /apisix/admin/upstreams/{id}`
- `UpsertUpstream`: `PUT /apisix/admin/upstreams/{id}`
- `DeleteUpstream`: `DELETE /apisix/admin/upstreams/{id}`

`UpsertRoute` and `UpsertUpstream` accept APISIX native JSON in `body_json`. Responses include `raw_json` to preserve the original APISIX Admin API response for troubleshooting and PR evidence.

## Safety

Write and delete methods require the resource ID to start with `allowedIdPrefix`, defaulting to `octobus-test-`. This keeps validation resources separate from existing APISIX resources. Change the prefix only for a controlled lab environment.

## Suggested Capset

- Read-only: `ListRoutes`, `GetRoute`, `ListUpstreams`, `GetUpstream`
- Route management: `UpsertRoute`, `DeleteRoute`
- Upstream management: `UpsertUpstream`, `DeleteUpstream`

## Real Validation Example

Use a real APISIX 3.17.0 environment. Do not expose the Admin API publicly.

```bash
ssh -L 9180:127.0.0.1:9180 root@<APISIX_HOST>
```

Then call the OctoBus service through the CLI or another supported protocol with:

```json
{
  "baseUrl": "http://127.0.0.1:9180",
  "allowedIdPrefix": "octobus-test-"
}
```

Create an upstream with ID `octobus-test-upstream`, create a route with ID `octobus-test-route`, call `ListRoutes` or `GetRoute`, and finally delete the test route/upstream. The PR should include sanitized command output or logs showing a real APISIX response. Do not include the Admin API key.

## Local Checks

```bash
cd services
npm run validate -- --service-dir apache__apisix_3-17
npm test -- --service-dir apache__apisix_3-17
npm run pack:check
```

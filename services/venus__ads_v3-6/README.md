# Venus ADS V3.6

Venus ADS V3.6 package for blacklist login, batch block, remove, and logout workflows.

## Package

- Service name: `venus-ads-v3-6`
- Service dir: `services/venus__ads_v3-6`
- Runtime mode: `long-running`
- Command: `venus-ads-v3-6`
- Proto service: `Venus_ADS_V36.VenusADSBlacklistService`

## Config And Secret

Config fields:

- `baseUrl` required by runtime, with `restBaseUrl` and `host` aliases. REST base URL, including `/cnddos` when required.
- `username` or `user` required by runtime.
- `remark`, `ipdirection`, `ipstate`, `listtype`, and `sessionTimeoutSeconds` optional operation defaults.
- `timeoutMs` optional, upstream HTTP timeout in milliseconds.
- `skipTlsVerify`, `tlsInsecureSkipVerify` optional. TLS verification aliases for private deployments.
- `headers` optional, extra upstream headers.

Secret fields:

- `password` required by runtime.

The login token is used only internally for the action and logout calls. Logs mask tokens and passwords.

## RPCs

| RPC | Access | Upstream behavior |
| --- | --- | --- |
| `BatchBlockIP` | Write | Logs in, posts IPs to `/v2.0/api/ip_bwlist/info`, then logs out. |
| `RemoveBlockedIP` | Write | Logs in, sends `DELETE /v2.0/api/ip_bwlist/info?...`, then logs out. |

Upstream `result == "0"` is success. Block `-391201` and remove `-391204` are treated as idempotent success.

## Local Validation

```bash
cd services
npm run validate -- --service-dir venus__ads_v3-6
npm test -- --service-dir venus__ads_v3-6
npm test -- --coverage --service-dir venus__ads_v3-6
```

## OctoBus Example

```bash
octobus service import --id venus-ads-v3-6 ./services/venus__ads_v3-6
octobus instance create venus-ads \
  --service venus-ads-v3-6 \
  --config-json '{"baseUrl":"https://ads.example.com/cnddos","username":"api-user","timeoutMs":8000,"skipTlsVerify":false}' \
  --secret-json '{"password":"REDACTED"}'
octobus capset create security-ops --name security-ops
octobus capset add-instance security-ops venus-ads

curl -s -X POST \
  http://127.0.0.1:9000/capsets/security-ops/connect/venus-ads/Venus_ADS_V36.VenusADSBlacklistService/BatchBlockIP \
  -H 'Content-Type: application/json' \
  -d '{"ip_list":["198.51.100.10"],"request_id":"incident-1"}'
```

## Known Limits

- The service logs in and logs out for each operation.
- Write RPCs mutate ADS blacklist state.
- HTTP is not recommended outside local mocks or lab environments.

# SKYCloud iNet

SKYCloud iNet package for batch IP block and unblock work-order creation.

## Package

- Service name: `skycloud-inet`
- Service dir: `services/skycloud__inet`
- Runtime mode: `long-running`
- Command: `skycloud-inet`
- Proto service: `SKYCloud_INET.SKYCloud_INET`

## Config And Secret

Config fields:

- `host` required by runtime, with `restBaseUrl` and `baseUrl` aliases. HTTPS base URL for iNet.
- `defaultDirection` optional, default ticket direction. Default is `BOTH`.
- `timeoutMs` optional, upstream HTTP timeout in milliseconds.
- `headers` optional, extra upstream headers.
- `skipTlsVerify`, `tlsInsecureSkipVerify`, `insecureSkipVerify` optional. TLS verification aliases for private deployments.
- `allowHttpBaseUrl`, `allowHttpHost`, `allowHttpUrl` optional. Local mock and lab-only HTTP allowances.

Secret fields:

- `username` or `user` required by runtime.
- `password` required by runtime.

Deprecated request `connection` fields are not allowed to override configured host or credentials.

## RPCs

| RPC | Access | Upstream behavior |
| --- | --- | --- |
| `BatchBlockIP` | Write | Logs in, resolves `environment_name`, validates IP directives, and creates block work orders in batches of 300. |
| `BatchUnblockIP` | Write | Logs in, resolves `environment_name`, validates IP directives, and creates unblock work orders in batches of 300. |

Invalid IP entries are returned as failed per-IP results without network calls. Errors and logs do not expose username, password, access token, cookie, or raw upstream body.

## Local Validation

```bash
cd services
npm run validate -- --service-dir skycloud__inet
npm test -- --service-dir skycloud__inet
npm test -- --coverage --service-dir skycloud__inet
```

## OctoBus Example

```bash
octobus service import --id skycloud-inet ./services/skycloud__inet
octobus instance create skycloud-inet \
  --service skycloud-inet \
  --config-json '{"host":"https://inet.example.com","defaultDirection":"BOTH","timeoutMs":5000}' \
  --secret-json '{"username":"api-user","password":"REDACTED"}'
octobus capset create security-ops --name security-ops
octobus capset add-instance security-ops skycloud-inet

curl -s -X POST \
  http://127.0.0.1:9000/capsets/security-ops/connect/skycloud-inet/SKYCloud_INET.SKYCloud_INET/BatchBlockIP \
  -H 'Content-Type: application/json' \
  -d '{"environment_name":"prod","ip_directives":[{"ip":"198.51.100.10","description":"incident test"}]}'
```

## Known Limits

- Work-order semantics depend on the upstream iNet workflow configuration.
- The service batches requests at 300 IP directives per work order.
- HTTP base URLs are only for local mocks or lab environments.

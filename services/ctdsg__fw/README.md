# CTDSG FW

OctoBus service package for CTDSG blacklist IP and domain block or unblock APIs.

## Import

```bash
octobus service import --id ctdsg-fw ./services//ctdsg__fw
```

## Behavior

- `BlockIP` maps to `POST {host}/api.php/inter/Inter?opt=addPatchblack2` and sends a single-element JSON array with newline-separated `ip_area` entries.
- `UnblockIP` maps to `POST {host}/api.php/inter/Inter?opt=delblack2` and sends newline-separated `name` entries.
- `BlockDomain` maps to `POST {host}/api.php/inter/Inter?opt=addPatchblack2` and sends a single-element JSON array with newline-separated `domainname` entries.
- `UnblockDomain` maps to `POST {host}/api.php/inter/Inter?opt=delblack2` and sends newline-separated `name` entries.
- Requests are signed with CTDSG HMAC-MD5 headers: `hy-bz-api-app-id`, `hy-bz-api-timestamp`, and `hy-bz-api-signature`.
- Self-signed device certificates are handled inside the adapter when `skipTlsVerify` / `tlsInsecureSkipVerify` / `insecureSkipVerify` is enabled.
- HTTP responses are returned as normalized `DeviceHttpResponse` objects, including status, response headers, raw body, parsed JSON when available, and effective URL.

## Gateway Setup

Start the gateway:

```bash
./bin/octobus serve
```

Import the CTDSG service package:

```bash
./bin/octobus service import ctdsg-fw ./services//ctdsg__fw
```

Create and start a test instance:

```bash
./bin/octobus instance create ctdsg-fw-test \
  --service ctdsg-fw \
  --config-json '{"host":"https://10.211.194.22:9090","appId":"h*****","skipTlsVerify":true}' \
  --secret-json '{"secretKey":"REDACTED"}'
```

Create a capset and expose the instance:

```bash
./bin/octobus capset create dev --name DevAgent
./bin/octobus capset add-instance dev ctdsg-fw-test
```

Confirm the exposed catalog:

```bash
./bin/octobus catalog dev --all --json
```

## Connect RPC Calls

### BlockIP

```bash
curl -X POST \
  http://127.0.0.1:9000/capsets/dev/connect/ctdsg-fw-test/CTDSG_FW.CTDSG_FW/BlockIP \
  -H 'Content-Type: application/json' \
  -d '{"ips":["43.143.110.163"],"permanent":false,"punishTime":1,"timeUnit":1}'
```

### UnblockIP

```bash
curl -X POST \
  http://127.0.0.1:9000/capsets/dev/connect/ctdsg-fw-test/CTDSG_FW.CTDSG_FW/UnblockIP \
  -H 'Content-Type: application/json' \
  -d '{"ips":["43.143.110.163"]}'
```

### BlockDomain

```bash
curl -X POST \
  http://127.0.0.1:9000/capsets/dev/connect/ctdsg-fw-test/CTDSG_FW.CTDSG_FW/BlockDomain \
  -H 'Content-Type: application/json' \
  -d '{"domains":["fget-career.com"],"permanent":false,"punishTime":1,"timeUnit":1}'
```

### UnblockDomain

```bash
curl -X POST \
  http://127.0.0.1:9000/capsets/dev/connect/ctdsg-fw-test/CTDSG_FW.CTDSG_FW/UnblockDomain \
  -H 'Content-Type: application/json' \
  -d '{"domains":["fget-career.com"]}'
```

## MCP Calls

List tools:

```bash
curl -X POST http://127.0.0.1:9000/capsets/dev/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

Current tool names:

- `ctdsg-fw__ctdsg-fw-test__block_domain`
- `ctdsg-fw__ctdsg-fw-test__block_i_p`
- `ctdsg-fw__ctdsg-fw-test__unblock_domain`
- `ctdsg-fw__ctdsg-fw-test__unblock_i_p`

Call `BlockIP` through MCP:

```bash
curl -X POST http://127.0.0.1:9000/capsets/dev/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"ctdsg-fw__ctdsg-fw-test__block_i_p","arguments":{"ips":["43.143.110.163"],"permanent":false,"punish_time":1,"time_unit":1}}}'
```

## What Is Already Verified

Already verified against the real gateway + device path:

- `BlockIP` ✅
- `UnblockIP` ✅
- `BlockDomain` ✅
- `UnblockDomain` ✅

Verified instance / capset used during testing:

- capset: `dev`
- instance: `ctdsg-fw-test`

## Test Notes

- For self-signed devices, set `skipTlsVerify: true` in the instance config.
- `appId` and `secretKey` must match the device’s real configuration.
- Preserve the following when collecting evidence for PRs:
  - request body
  - response body
  - HTTP status
  - `effectiveUrl`

## Local Checks

```bash
cd services
npm run validate -- --service-dir ctdsg__fw
npm test -- --service-dir ctdsg__fw
npm run pack:check
```

# Tencent TSec V2.5.1

Tencent TSec V2.5.1 package for precise and global blacklist APIs.

## Package

- Service name: `tencent-tsec-v2-5-1`
- Service dir: `services/tencent__tsec_v2-5-1`
- Runtime mode: `long-running`
- Command: `tencent-tsec-v2-5-1`
- Proto service: `Tencent_TSec_V251.Tencent_TSec_V251`

## Config And Secret

Config fields:

- `host` required by runtime, with `baseUrl` alias. Full Tencent TSec API URL including protocol and path.
- `uuid` required by runtime.
- `timeoutMs` optional, upstream HTTP timeout in milliseconds.
- `headers` optional, extra upstream headers.
- `skipTlsVerify`, `tlsInsecureSkipVerify`, `insecureSkipVerify` optional. TLS verification aliases for private deployments.

Secret fields:

- `block_secret_id` or `blockSecretId` required for add RPCs.
- `block_secret_key` or `blockSecretKey` required for add RPCs.
- `unblock_secret_id` or `unblockSecretId` required for delete RPCs.
- `unblock_secret_key` or `unblockSecretKey` required for delete RPCs.

Request payloads must not contain secret ID or secret key. The runtime signs requests with HMAC-SHA1 and redacts signatures in logs.

## RPCs

| RPC | Access | Upstream behavior |
| --- | --- | --- |
| `AddPreciseBlack` | Write | Sends `v1/add_precise_black` with signed precise blacklist payload. |
| `DeletePreciseBlack` | Write | Sends `v1/del_precise_black` with signed precise blacklist delete payload. |
| `AddGlobalBlack` | Write | Sends `v1/add_global_black`; upstream status `200` and `208` are success. |
| `DeleteGlobalBlack` | Write | Sends `v1/del_global_black`; upstream status `200` and manual-unblock `210` are success. |

HTTP 5xx and network failures map to `UNAVAILABLE`; bad business status maps to `FAILED_PRECONDITION`; invalid or empty JSON maps to `UNKNOWN`.

## Local Validation

```bash
cd services
npm run validate -- --service-dir tencent__tsec_v2-5-1
npm test -- --service-dir tencent__tsec_v2-5-1
npm test -- --coverage --service-dir tencent__tsec_v2-5-1
```

## OctoBus Example

```bash
octobus service import --id tencent-tsec-v2-5-1 ./services/tencent__tsec_v2-5-1
octobus instance create tencent-tsec \
  --service tencent-tsec-v2-5-1 \
  --config-json '{"host":"https://tsec.example.com/api","uuid":"uuid-placeholder","timeoutMs":5000}' \
  --secret-json '{"block_secret_id":"block-id","block_secret_key":"REDACTED","unblock_secret_id":"unblock-id","unblock_secret_key":"REDACTED"}'
octobus capset create security-ops --name security-ops
octobus capset add-instance security-ops tencent-tsec

curl -s -X POST \
  http://127.0.0.1:9000/capsets/security-ops/connect/tencent-tsec/Tencent_TSec_V251.Tencent_TSec_V251/AddPreciseBlack \
  -H 'Content-Type: application/json' \
  -d '{"ip":"198.51.100.10","valid_duration":3600,"ban_reason":1}'
```

## Known Limits

- All RPCs are write operations that affect blacklist policy.
- Success semantics follow Tencent TSec legacy status codes.
- TLS skip is implemented per request; keep it disabled unless testing private endpoints.

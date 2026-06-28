# 深信服_下一代防火墙_AF 8.0.95（Sangfor_NGAF 8.0.95）OctoBus Service

This service package adapts 深信服_下一代防火墙_AF 8.0.95（Sangfor_NGAF 8.0.95）REST APIs for the first OctoBus integration pass.

The local PDF file used for implementation is `API帮助文档_AF8.0.95.pdf`. Its extracted cover text says `AF8.0.85`; verify the exact appliance build during real-device validation.

## Scope

Implemented methods:

- `Sangfor_FW_V8095.Sangfor_FW_V8095/Login`
- `Sangfor_FW_V8095.Sangfor_FW_V8095/KeepAlive`
- `Sangfor_FW_V8095.Sangfor_FW_V8095/Logout`
- `Sangfor_FW_V8095.Sangfor_FW_V8095/ListBlackWhiteList`
- `Sangfor_FW_V8095.Sangfor_FW_V8095/AddBlacklist`
- `Sangfor_FW_V8095.Sangfor_FW_V8095/RemoveBlacklist`
- `Sangfor_FW_V8095.Sangfor_FW_V8095/ListBlockedIP`
- `Sangfor_FW_V8095.Sangfor_FW_V8095/BlockIP`
- `Sangfor_FW_V8095.Sangfor_FW_V8095/UnblockIP`
- `Sangfor_FW_V8095.Sangfor_FW_V8095/GetBlockTime`
- `Sangfor_FW_V8095.Sangfor_FW_V8095/SetBlockTime`

The first version intentionally avoids security policy, NAT, routing, and other high-risk configuration APIs.

## API Mapping

- Login: `POST /api/v1/namespaces/{namespace}/login`
- Keep alive: `GET /api/v1/namespaces/{namespace}/keepalive`
- Logout: `POST /api/v1/namespaces/{namespace}/logout`
- Black/white list: `/api/v1/namespaces/{namespace}/whiteblacklist`
- Batch black/white list: `/api/batch/v1/namespaces/{namespace}/whiteblacklist`
- Blocked attacker list: `/api/v1/namespaces/{namespace}/blockip`
- Batch block/unblock attacker: `/api/batch/v1/namespaces/{namespace}/blockip`
- Block time: `/api/v1/namespaces/{namespace}/blockiptime`

The Sangfor API requires a WEB API enabled administrator account. Login returns `data.loginResult.token`; later calls send it as `Cookie: token=<token>`.

## Configuration

Example config:

```json
{
  "host": "https://192.168.1.1",
  "namespace": "public",
  "timeoutMs": 5000,
  "skipTlsVerify": true
}
```

Example secret:

```json
{
  "username": "api-user",
  "password": "replace-with-password"
}
```

`BlockIP`, `AddBlacklist`, and related methods can auto-login with `username/password` when the request does not include `token`.

## Risk Boundary

- `AddBlacklist` and `RemoveBlacklist` modify the global custom blacklist.
- `BlockIP` and `UnblockIP` modify temporary attacker block entries.
- `SetBlockTime` changes the global automatic attacker block duration.
- The Sangfor documentation marks these APIs as not supported in virtual system mode; confirm behavior on the target appliance.
- Use a dedicated WEB API account with minimum required permissions.
- Real-device tests must use dedicated test IPs/domains and clean them up after verification.

## Import

From an OctoBus checkout:

```bash
octobus service import --id sangfor-fw-v8-0-95 ./services//sangfor__fw_v8-0-95
```

Create an instance:

```bash
octobus instance create sangfor-fw-v8-0-95-test \
  --service sangfor-fw-v8-0-95 \
  --config-json '{"host":"https://192.168.1.1","namespace":"public","skipTlsVerify":true}' \
  --secret-json '{"username":"api-user","password":"replace-with-password"}'
```

## Local Checks

```bash
cd services
npm install
npm test -- --service-dir sangfor__fw_v8-0-95
```

When this package is copied into the upstream OctoBus repository, run the repository checks:

```bash
cd services
npm run validate -- --service-dir sangfor__fw_v8-0-95
npm test -- --service-dir sangfor__fw_v8-0-95 --coverage
npm run pack:check
```

## Real-Device Validation Plan

After the V8.0.95 virtual appliance is available:

1. Enable WEB API permission for a dedicated administrator account.
2. Verify `Login` returns a token.
3. Verify `AddBlacklist` with one test IP, then `ListBlackWhiteList`.
4. Verify `RemoveBlacklist` removes the test IP.
5. Verify `BlockIP` with one RFC 5737 test IP and short duration such as `30m`.
6. Verify `ListBlockedIP`, then `UnblockIP`.
7. Verify no test objects remain on the appliance.

## Real-Device Validation Result

Validated on 2026-06-28 against a 深信服_下一代防火墙_AF 8.0.95（Sangfor_NGAF 8.0.95）virtual appliance at `https://192.168.xxx.xxx` with a dedicated WEB API enabled administrator account.

Passed:

- `Login`
- `KeepAlive`
- `AddBlacklist`
- `ListBlackWhiteList`
- `RemoveBlacklist`
- `BlockIP`
- `ListBlockedIP`
- `UnblockIP`
- `Logout`

Cleanup confirmed for test target `192.0.2.95` in both `whiteblacklist` and `blockip`.

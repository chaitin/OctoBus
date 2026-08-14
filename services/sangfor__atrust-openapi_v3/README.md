# 深信服_零信任访问控制系统aTrust_2.5.16（Sangfor_aTrust_2.5.16）

This OctoBus service package adapts Sangfor aTrust 2.5.16 OpenAPI V3. It signs every request with the documented HMAC-SHA256 headers:

- `X-Ca-Key`
- `X-Ca-Sign`
- `X-Ca-TimeStamp`
- `X-Ca-Nonce`

The first version focuses on low-risk query and session operations:

- online user query and kickout
- user, organization, and role query/list
- application and application category query/list
- user directory query/list
- device query/list
- restricted signed raw request for `/api/v1/*` and `/api/v3/*` GET/POST paths

## Supported Version

- Target product: 深信服_零信任访问控制系统aTrust_2.5.16（Sangfor_aTrust_2.5.16）
- Documented support: aTrust 2.4.10 and later according to the OpenAPI V3 documentation
- Tested appliance: aTrust 2.5.16 virtual appliance reachable on HTTPS port 4433
- Authentication: OpenAPI API ID and API Secret with per-request HMAC-SHA256 signing
- Runtime mode: long-running

## Configuration

`config.schema.json`:

- `host`: aTrust OpenAPI base URL, usually `https://<SDPC-IP>:4433`
- `timeoutMs`: HTTP timeout in milliseconds
- `skipTlsVerify`: set to `true` for private deployments with self-signed certificates
- `lang`: default language query value for V3 list endpoints, default `zh-CN`
- `timestampOffsetSeconds`: optional signing timestamp offset in seconds. Keep `0` unless the appliance rejects requests because its clock validation is offset from real Unix time.
- `headers`: optional extra HTTP headers

`secret.schema.json`:

- `apiId`: OpenAPI API ID from aTrust console
- `apiSecret`: OpenAPI API Secret from aTrust console

Create the API ID and API Secret in aTrust control center: `系统管理 / 开放平台 / Open API`.

Example config:

```json
{
  "host": "https://atrust.example.com:4433",
  "timeoutMs": 5000,
  "skipTlsVerify": true,
  "lang": "zh-CN"
}
```

Example secret:

```json
{
  "apiId": "replace-with-api-id",
  "apiSecret": "replace-with-api-secret"
}
```

Recommended capset:

- Use a read-mostly capset such as `sangfor-atrust-openapi-v3-query` for inventory, identity, application, online-user, and device queries.
- Expose `KickoutUsers` only in a restricted response capset because it terminates active user sessions.

## Methods

- `ListOnlineUsers`: `GET /api/v1/monitor/getUserStatus`
- `KickoutUsers`: `POST /api/v1/monitor/kickoutUsers`
- `QueryUser`: `GET /api/v3/user/queryById|queryByName|queryByExternalId`
- `ListUsers`: `POST /api/v3/user/queryAll`
- `QueryGroup`: `GET /api/v3/group/queryById|queryByFullPath|queryByExternalId`
- `ListGroups`: `POST /api/v3/group/queryAll`
- `QueryRole`: `GET /api/v3/role/queryById|queryByName|queryByExternalId`
- `ListRoles`: `POST /api/v3/role/queryAll`
- `ListResources`: `GET /api/v3/resource/queryAll`
- `QueryResource`: `GET /api/v3/resource/queryById|queryByName`
- `ListResourceGroups`: `GET /api/v3/resourceGroup/queryAll`
- `ListUserDirectories`: `GET /api/v1/userDirectory/queryAll`
- `QueryUserDirectory`: `GET /api/v1/userDirectory/query`
- `ListDevices`: `POST /api/v1/device/queryAll`
- `QueryDevice`: `GET /api/v1/device/query`

## Risk Boundary

- `ListOnlineUsers`, user, organization, role, resource, resource group, user directory, and device query methods are read-only.
- `KickoutUsers` is a write/action method. It terminates sessions by session id or by user and user directory name. Rollback is not available; the affected user must reconnect.
- Use a dedicated OpenAPI device credential with the minimum API permissions required for the capset.
- Keep `timestampOffsetSeconds` at `0` unless the appliance rejects valid requests because its clock validation is offset from real Unix time.

## Write Operation Semantics

- `KickoutUsers`: no default target is inferred; `id_list` or `user_list` is required. The operation is not idempotent in the strict sense because a second call may find no matching active session. There is no API rollback; users must log in again. Audit by recording session ids or user/user-directory pairs, caller, reason, and trace id.

## Import

From an OctoBus checkout:

```bash
./bin/octobus service import sangfor-atrust-openapi-v3 ./services/sangfor__atrust-openapi_v3
```

Create an instance:

```bash
./bin/octobus instance create sangfor-atrust-openapi-v3-test \
  --service sangfor-atrust-openapi-v3 \
  --config-json '{"host":"https://atrust.example.com:4433","skipTlsVerify":false,"lang":"zh-CN"}' \
  --secret-json '{"apiId":"replace-with-api-id","apiSecret":"replace-with-api-secret"}'
```

Create a capset and add the instance:

```bash
./bin/octobus capset create sangfor-atrust-openapi-v3-query --name Sangfor-aTrust-OpenAPI-V3-Query
./bin/octobus capset add-instance sangfor-atrust-openapi-v3-query sangfor-atrust-openapi-v3-test
```

Core read-only call through Connect RPC:

```bash
curl -X POST \
  http://127.0.0.1:9000/capsets/sangfor-atrust-openapi-v3-query/connect/sangfor-atrust-openapi-v3-test/Sangfor_Atrust_OpenAPI_V3.Sangfor_Atrust_OpenAPI_V3/ListUserDirectories \
  -H 'content-type: application/json' \
  -d '{}'
```

Restricted write/action call example:

```bash
curl -X POST \
  http://127.0.0.1:9000/capsets/sangfor-atrust-openapi-v3-query/connect/sangfor-atrust-openapi-v3-test/Sangfor_Atrust_OpenAPI_V3.Sangfor_Atrust_OpenAPI_V3/KickoutUsers \
  -H 'content-type: application/json' \
  -d '{"user_list":[{"name":"test-user","user_directory_name":"test-directory"}]}'
```

## Local Checks

```bash
cd services
npm run validate -- --service-dir sangfor__atrust-openapi_v3
npm test -- --service-dir sangfor__atrust-openapi_v3
npm run pack:check
```

## Real-Device Validation Result

Validated on 2026-06-28 against a Sangfor aTrust 2.5.16 virtual appliance on HTTPS port 4433 using an OpenAPI API ID and API Secret. Real endpoint, API ID, and API Secret are intentionally omitted.

The original submission included a screenshot-like rendering of direct upstream HTTP requests. The binary image is not retained in the service package because generated evidence files are forbidden by the L2 gate. It demonstrated upstream authentication and response mapping, but did not demonstrate that the calls traversed an OctoBus protocol endpoint; automated Connect, gRPC, and MCP chain coverage is therefore maintained separately in `test/smoke.json`.

Passed:

- `ListUserDirectories`
- `QueryUserDirectory` by id and by Chinese directory name
- `ListResourceGroups`
- `ListResources`
- `ListDevices`
- `ListOnlineUsers`
- `ListUsers`
- `ListGroups`
- `ListRoles`

The tested appliance had no users, devices, applications, online users, groups, or roles beyond the default local user directory and default application category, so list responses were mostly empty but authenticated and mapped successfully.

## Notes

The package does not store or log API secrets. Do not put real API ID or API Secret values in source files, tests, screenshots, or pull request text.

## PR Checklist

Include the appliance type, appliance version, authentication mode, implemented methods, local test commands, real-device validation screenshots, known limitations, and a statement that no real account, password, API Secret, token, cookie, production address, or business-sensitive data is included.

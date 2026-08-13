# Zhizhangyi MBS

This service package exposes Zhizhangyi MBS (Mobile Security Management Platform) user management APIs through OctoBus.

The package is scoped to MBS user operations: listing users, reading user details, checking login names, creating and updating users, deleting users, enabling or disabling users, updating passwords, forcing users offline, and importing users.

## Configuration

Configure the target MBS endpoint in the service config:

```json
{
  "endpoint": "https://mbs.example.com:9074",
  "skipTlsVerify": false,
  "timeoutMs": 30000
}
```

`endpoint` is the MBS REST API base URL. Use a hostname or sanitized placeholder in shared examples. Do not commit real internal IP addresses.

Configure credentials in the service secret:

```json
{
  "appkey": "<mbs-appkey>",
  "secretkey": "<mbs-secretkey>",
  "orgCode": "<org-code>"
}
```

Do not commit real `appkey`, `secretkey`, `orgCode`, password ciphertext, or generated `sign` values.

## Authentication

MBS signs requests as:

```text
MD5(appkey + param1 + param2 + ... + secretkey)
```

The adapter computes signatures when `sign` is not provided. Password fields are forwarded as caller-provided MBS 3DES-encrypted strings; this package does not derive or perform password encryption.

## Methods

All methods are exposed under the `zhizhangyi.mbs.UserManagement` service.

| Method | Purpose | Key request fields |
| --- | --- | --- |
| `GetUsers` | List users with pagination, sorting, and filters. | `index`, `size`, `orderCode`, `orderType`, `condition.deptId` required, optional `condition.keyWord`, `condition.state`, `condition.isMdm`. |
| `AddUser` | Create a user. | `userName`, `loginName`, `deptId`, `password` required; optional contact fields, `userSource`, `isMdm`, `state`, `weight`, `attrs`. |
| `UpdUser` | Update a user. | `userId`, `userName`, `deptId` required; optional `loginName`, contact fields, `isMdm`, `weight`, `attrs`. |
| `DetailUser` | Get user detail by ID. | `userId` required. |
| `DelUsers` | Delete users by ID list or by condition. | `type=0` with `userIds`, or `type=1` with `condition`. |
| `StateUsers` | Enable or disable users by ID list or condition. | `state` required; `type=0` with `userIds`, or `type=1` with `condition`. |
| `CheckLoginName` | Check login name availability. | `loginName` required. |
| `GetUserByPhone` | Find users by phone number. | `phone` required. |
| `UpdUserPwd` | Update a password using v1 admin mode or v2 self-service mode. | `version` must be `v1` or `v2`; v1 requires `userId` and `password`; v2 requires `loginName` and `newPwd`, optional `oldPwd`. |
| `ForceOffline` | Force a user offline. | `userId` required. |
| `ImportUser` | Import users from an uploaded file. | `fileId` required, optional `lang`. |

## Connect RPC Examples

Replace `mbs-capset` and `mbs-instance` with your OctoBus capset and instance IDs. The examples use sanitized hostnames and placeholder secrets only.

### GetUsers

```http
POST http://127.0.0.1:9000/capsets/mbs-capset/connect/mbs-instance/zhizhangyi.mbs.UserManagement/GetUsers
Content-Type: application/json

{
  "index": 0,
  "size": 20,
  "orderCode": 0,
  "orderType": 1,
  "condition": {
    "deptId": "1",
    "keyWord": "",
    "state": 0,
    "isMdm": 0
  }
}
```

`condition.deptId` is required. Valid falsy filter values such as `state: 0` and `isMdm: 0` are preserved.

### AddUser

```http
POST http://127.0.0.1:9000/capsets/mbs-capset/connect/mbs-instance/zhizhangyi.mbs.UserManagement/AddUser
Content-Type: application/json

{
  "userName": "Example User",
  "loginName": "example.user",
  "deptId": "1",
  "password": "<3des-encrypted-password>",
  "phoneNumber": "13800000000",
  "email": "user@example.com",
  "userSource": 0,
  "state": 1,
  "isMdm": 0
}
```

`password` must already be encrypted in the format required by MBS. Empty numeric fields such as `state`, `isMdm`, and `weight` are treated as omitted instead of being converted to `0`.

### UpdUser

```http
POST http://127.0.0.1:9000/capsets/mbs-capset/connect/mbs-instance/zhizhangyi.mbs.UserManagement/UpdUser
Content-Type: application/json

{
  "userId": "<user-id>",
  "userName": "Example User",
  "deptId": "1",
  "email": "user@example.com"
}
```

`userId`, `userName`, and `deptId` are required.

### DelUsers

```http
POST http://127.0.0.1:9000/capsets/mbs-capset/connect/mbs-instance/zhizhangyi.mbs.UserManagement/DelUsers
Content-Type: application/json

{
  "type": 0,
  "userIds": ["<user-id-1>", "<user-id-2>"]
}
```

For condition mode, set `type` to `1` and provide `condition`:

```json
{
  "type": 1,
  "condition": {
    "deptId": "1",
    "status": 0,
    "isMdm": 0
  }
}
```

### StateUsers

```http
POST http://127.0.0.1:9000/capsets/mbs-capset/connect/mbs-instance/zhizhangyi.mbs.UserManagement/StateUsers
Content-Type: application/json

{
  "type": 0,
  "state": "1",
  "userIds": ["<user-id>"]
}
```

`state` is required and is not defaulted. Use `"1"` to enable and `"0"` to disable according to the MBS API semantics.

### UpdUserPwd

```http
POST http://127.0.0.1:9000/capsets/mbs-capset/connect/mbs-instance/zhizhangyi.mbs.UserManagement/UpdUserPwd
Content-Type: application/json

{
  "version": "v2",
  "loginName": "example.user",
  "oldPwd": "<3des-encrypted-old-password>",
  "newPwd": "<3des-encrypted-new-password>"
}
```

`version` is restricted to `v1` or `v2`. Invalid values are rejected before constructing the upstream path.

## Error Handling

HTTP errors from MBS are mapped to gRPC errors. Upstream HTTP response bodies are truncated before being included in error messages, so callers do not receive full upstream debug output or sensitive error details.

## Local Testing

Run service tests with:

```bash
node --test services/zhizhangyi__mbs/test/zhizhangyi-mbs.test.js
npm --prefix services test -- --service-dir zhizhangyi__mbs
```

The test files use mocked HTTP responses and sanitized example values.

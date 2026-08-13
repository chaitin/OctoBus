# DingTalk Group Robot OctoBus Service

This package preserves legacy gRPC package and method names where applicable.

Service name: `dingtalk-group-robot`

Import it into OctoBus with:

```bash
octobus service import --id dingtalk-group-robot ./services/dingtalk__group-robot
```

## Package Files

- `service.json`: OctoBus service manifest.
- `proto/dingtalk_group_robot.proto`: gRPC API definition.
- `config.schema.json`: non-secret timeout settings plus deprecated credential fallbacks.
- `secret.schema.json`: DingTalk webhook URL and optional signing secret fields.
- `src/dingtalk-group-robot.js`: DingTalk webhook implementation.
- `src/service.js`: OctoBus SDK `defineService` wrapper.
- `bin/dingtalk-group-robot.js`: service-local executable entrypoint.
- `test/dingtalk-group-robot.test.js`: node:test coverage for validation, signing, payload construction, HTTP behavior, and SDK handler invocation.
- `test/mock_upstream.js`: optional local DingTalk webhook mock.

## Configuration

Use config for non-secret runtime settings:

```json
{
  "timeoutMs": 5000
}
```

Use secret for the DingTalk custom robot webhook URL and optional signing secret:

```json
{
  "webhook_url": "https://oapi.dingtalk.com/robot/send?access_token=replace-me",
  "secret": "replace-with-signing-secret"
}
```

Deprecated config fields `webhook_url`, `webhookUrl`, `webhook`, `url`, `secret`, and `dingding_secret` remain fallback-only for old instances. Values in instance secret take priority over those config or binding fallbacks.

## RPC Methods

- `DingDing_GroupRobot.DingDing_GroupRobot/SendTextMessage`

Request fields:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `send_msg` | string | Yes | Text content sent as DingTalk `text.content`. Runtime aliases `sendMsg`, `send_message`, and `sendMessage` are accepted. |
| `is_groupsendall` | bool | No | Whether to @ all members. Runtime aliases `isGroupSendAll`, `is_at_all`, and `isAtAll` are accepted. |
| `send_PeoplePhone` | repeated string | No | Mobile numbers to @. Arrays, wrapper arrays, and comma-separated strings are accepted through legacy aliases. |
| `send_DingDingID` | repeated string | No | DingTalk user IDs to @. Arrays, wrapper arrays, and comma-separated strings are accepted through legacy aliases. |

Response fields:

| Field | Type | Description |
|-------|------|-------------|
| `http_status` | int32 | Upstream HTTP status. It is `0` when the request is not sent. |
| `http_body` | string | Compatibility field. The implementation returns an empty string to avoid leaking upstream response content. |

Runtime handler example:

```js
import { handlers } from './src/dingtalk-group-robot.js';

await handlers['DingDing_GroupRobot.DingDing_GroupRobot/SendTextMessage']({
  secret: {
    webhook_url: 'https://oapi.dingtalk.com/robot/send?access_token=replace-me',
    secret: 'replace-with-signing-secret'
  },
  config: { timeoutMs: 5000 },
  request: {
    send_msg: 'OctoBus alert',
    is_groupsendall: false,
    send_PeoplePhone: ['13800000000']
  }
});
```

## Behavior Notes

- Only DingTalk `msgtype: "text"` messages are sent.
- `send_msg` is required.
- `send_PeoplePhone` and `send_DingDingID` accept arrays, protobuf repeated value wrappers, or comma-separated strings through legacy aliases.
- When `secret` is configured, the service appends DingTalk `timestamp` and URL-encoded HMAC-SHA256 `sign` query parameters.
- HTTP 2xx responses return gRPC OK with empty `http_body`, even if DingTalk `errcode` is nonzero.
- HTTP non-2xx responses return a gRPC error with `httpStatus`, empty `httpBody`, and `httpBodyLength`.
- Network and response read failures map to `UNAVAILABLE`.
- Request `webhook_url` and signing secret fields are ignored. Credentials are resolved from instance secret first, then deprecated config or binding fallbacks.
- Logs redact `access_token` and `sign`; message content and raw upstream bodies are not logged.
- TLS verification skip flags are rejected with `INVALID_ARGUMENT`; the service relies on the runtime default TLS verifier.

## Limitations

- Only text messages are supported.
- DingTalk business errors inside a 2xx response are not parsed as gRPC errors for legacy compatibility.
- Retries may create duplicate messages if DingTalk received the original request.

## Local Checks

```bash
cd services
npm run validate -- --service-dir dingtalk__group-robot
npm test -- --service-dir dingtalk__group-robot
```

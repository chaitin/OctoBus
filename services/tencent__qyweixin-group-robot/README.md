# Tencent QYWeiXin Group Robot Service Package

This package preserves legacy gRPC package and method names where applicable.

Service name: `tencent-qyweixin-group-robot`

It keeps the legacy gRPC package and method name for compatibility:

- `Tencent_QYWeiXin_GroupRobot.Tencent_QYWeiXin_GroupRobot/SendText`

The package command is `tencent-qyweixin-group-robot`, and the service root is `services/tencent__qyweixin-group-robot`.

## Behavior

- Requires a full HTTPS WeCom webhook URL in instance secret field `webhook`.
- Sends request `message` as WeCom `text.content`.
- Supports comma-separated `mentioned_mobiles` and camelCase `mentionedMobiles`.
- Returns the upstream HTTP status, parsed `errcode`, and parsed `errmsg`. The legacy `http_body` response field is deprecated and intentionally empty.
- Maps non-2xx, invalid JSON, missing `errcode`, transport failures, and non-zero WeCom business codes to structured gRPC errors.
- Request `webhook` is deprecated and ignored. Credentials are resolved from instance secret first, then config or binding fallbacks.
- Error payloads include `http_status_code`, empty `http_body`, `http_body_length`, and a reason without exposing the raw upstream body.

## Configuration

Config fields:

- `timeoutMs`: upstream HTTP timeout in milliseconds.
- `headers`: optional extra HTTP headers.
- `skipTlsVerify`, `tlsInsecureSkipVerify`, `insecureSkipVerify`: TLS verification aliases.

Secret fields:

- `webhook`: WeCom group robot webhook URL. Deprecated aliases `webhook_url`, `webhookUrl`, and `url` are also accepted as secret fields.

```json
{
  "webhook": "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=replace-me"
}
```

## RPC Method

`Tencent_QYWeiXin_GroupRobot.Tencent_QYWeiXin_GroupRobot/SendText`

Request fields:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `webhook` | string | No | Deprecated request field. Ignored by the handler. |
| `message` | string | Yes | Text content sent as WeCom `text.content`. |
| `mentioned_mobiles` | string | No | Comma-separated mobile numbers to mention. Runtime alias `mentionedMobiles` is accepted. |

Response fields:

| Field | Type | Description |
|-------|------|-------------|
| `http_status_code` | int32 | Upstream HTTP status. It is `0` when the request is not sent. |
| `http_body` | string | Deprecated compatibility field. Always empty. |
| `errcode` | int32 | Parsed WeCom business code on success. |
| `errmsg` | string | Parsed WeCom business message on success. |

## Import

```bash
octobus service import --id tencent-qyweixin-group-robot ./services/tencent__qyweixin-group-robot
```

Runtime handler example:

```js
import { handlers } from './src/tencent-qyweixin-group-robot.js';

await handlers['Tencent_QYWeiXin_GroupRobot.Tencent_QYWeiXin_GroupRobot/SendText']({
  secret: {
    webhook: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=replace-me'
  },
  config: { timeoutMs: 5000 },
  request: {
    message: 'OctoBus alert',
    mentioned_mobiles: '13800000000'
  }
});
```

## Limitations

- Only text messages are supported.
- A non-zero WeCom `errcode` returns a gRPC `FAILED_PRECONDITION`.
- Retries may create duplicate messages if WeCom received the original request.
- `skipTlsVerify` is intended only for private testing.

## Validation

```bash
cd services
npm run validate -- --service-dir tencent__qyweixin-group-robot
npm test -- --service-dir tencent__qyweixin-group-robot
```

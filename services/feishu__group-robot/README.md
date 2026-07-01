# Feishu Group Robot OctoBus Service

This package preserves legacy gRPC package and method names where applicable.

Service name: `feishu-group-robot`

Import it into OctoBus with:

```bash
octobus service import --id feishu-group-robot ./services/feishu__group-robot
```

## Package Files

- `service.json`: OctoBus service manifest.
- `proto/feishu_group_robot.proto`: gRPC API definition.
- `config.schema.json`: timeout, TLS, and extra header settings.
- `secret.schema.json`: Feishu group robot webhook URL.
- `src/feishu-group-robot.js`: Feishu webhook implementation.
- `src/service.js`: OctoBus SDK `defineService` wrapper.
- `bin/feishu-group-robot.js`: service-local executable entrypoint.
- `test/feishu-group-robot.test.js`: node:test coverage for validation, request mapping, HTTP behavior, network errors, and SDK handler invocation.
- `test/mock_upstream.js`: optional local Feishu webhook mock.

## Configuration

Use config for non-sensitive request behavior:

```json
{
  "timeoutMs": 5000,
  "headers": {
    "X-Custom": "value"
  },
  "skipTlsVerify": false
}
```

## Secret

Use `webhook` for the Feishu group robot webhook URL. Deprecated aliases `webhook_url`, `webhookUrl`, and `url` are still accepted as secret fields.

```json
{
  "webhook": "https://open.feishu.cn/open-apis/bot/v2/hook/replace-me"
}
```

## RPC Methods

- `Feishu_GroupRobot.Feishu_GroupRobot/SendTextMessage`

Request fields:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `message` | string | Yes | Text content sent as Feishu `content.text`. Runtime aliases `send_msg`, `sendMsg`, and `text` are accepted. |

Response fields:

| Field | Type | Description |
|-------|------|-------------|
| `http_status` | int32 | Upstream HTTP status. It is `0` when the request is not sent. |
| `http_body` | string | Compatibility field. The implementation returns an empty string to avoid leaking upstream response content. |

Runtime handler example:

```js
import { handlers } from './src/feishu-group-robot.js';

await handlers['Feishu_GroupRobot.Feishu_GroupRobot/SendTextMessage']({
  secret: {
    webhook: 'https://open.feishu.cn/open-apis/bot/v2/hook/replace-me'
  },
  config: { timeoutMs: 5000 },
  request: {
    message: 'OctoBus alert'
  }
});
```

## Behavior Notes

- The request body is always Feishu `msg_type: "text"` with `content.text`.
- `message` is required. Legacy aliases `send_msg`, `sendMsg`, and `text` are accepted.
- The webhook URL is read from instance secret. Deprecated config or binding webhook fields remain fallback-only for old instances.
- HTTP statuses 200, 209, and 210 return gRPC OK with `http_status` and empty `http_body`.
- Other HTTP statuses return `UNAVAILABLE` with upstream status, empty body, and body length on the error object.
- Network and response read failures map to `UNAVAILABLE`.
- The service sets `Content-Type`, `User-Agent`, `x-engine-instance`, and `x-request-id` headers while preserving configured extra headers.
- Request `webhook` fields are ignored. Credentials are resolved from instance secret first, then deprecated config or binding fallbacks.
- Logs redact the webhook token path; message content and raw upstream bodies are not logged.
- TLS verification can be skipped for private testing with `skipTlsVerify`, `tlsInsecureSkipVerify`, or `insecureSkipVerify`.

## Limitations

- Only text messages are supported.
- Feishu business errors inside accepted HTTP statuses are not parsed as gRPC errors for legacy compatibility.
- Retries may create duplicate messages if Feishu received the original request.

## Local Checks

```bash
cd services
npm run validate -- --service-dir feishu__group-robot
npm test -- --service-dir feishu__group-robot
```

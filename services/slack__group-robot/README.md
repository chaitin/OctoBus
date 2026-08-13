# Slack Group Robot OctoBus Service

OctoBus service package for sending text messages through Slack Incoming Webhooks.

Service name: `slack-group-robot`

## Supported Versions

| Platform | API | Version |
|----------|-----|---------|
| Slack | Incoming Webhooks | Latest (no versioned API) |

Slack Incoming Webhooks are a stable, unversioned API. The endpoint URL format is `https://hooks.slack.com/services/T.../B.../xxxx`.

## Import

```bash
octobus service import --id slack-group-robot ./services/slack__group-robot
```

## Configuration

Use config for non-secret runtime settings:

```json
{
  "timeoutMs": 5000
}
```

Use secret for the Slack Incoming Webhook URL, because the URL embeds authentication tokens:

```json
{
  "webhook": "https://hooks.slack.com/services/T00/B00/xxxx"
}
```

Deprecated config fields `webhook`, `webhook_url`, `webhookUrl`, and `url` remain fallback-only for old instances. Values in instance secret take priority over those config or binding fallbacks.

## RPC Methods

- `Slack_GroupRobot.Slack_GroupRobot/SendTextMessage`

## Method: SendTextMessage

Send a text message to a Slack channel via Incoming Webhook.

**Request fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `message` | string | Yes | Text content. Supports Slack mrkdwn: `*bold*`, `_italic_`, `` `code` ``, ```` ```block``` ````, `>quote`, `•list`. |

**Response fields:**

| Field | Type | Description |
|-------|------|-------------|
| `http_status` | int32 | HTTP status from Slack (200 on success, 0 on network error) |
| `http_body` | string | Compatibility field. The implementation returns an empty string to avoid leaking upstream response content. |

**Error mapping:**

| Condition | gRPC Status |
|-----------|------------|
| Missing or invalid webhook URL | `INVALID_ARGUMENT` |
| Empty message | `INVALID_ARGUMENT` |
| HTTP non-200 response (4xx/5xx) | `UNAVAILABLE` |
| Network failure (DNS, timeout, connection refused) | `UNAVAILABLE` (http_status=0, http_body empty) |
| Response read failure | `UNAVAILABLE` |

Runtime handler example:

```js
import { handlers } from './src/slack-group-robot.js';

await handlers['Slack_GroupRobot.Slack_GroupRobot/SendTextMessage']({
  secret: {
    webhook: 'https://hooks.slack.com/services/T00/B00/xxxx'
  },
  config: { timeoutMs: 5000 },
  request: {
    message: 'OctoBus alert'
  }
});
```

## Suggested Instance Values

Config:

```json
{
  "timeoutMs": 5000
}
```

Secret:

```json
{
  "webhook": "https://hooks.slack.com/services/..."
}
```

## Operation Semantics

### SendTextMessage

- **Write operation**: Sends a message to Slack. Each call produces a single message.
- **Idempotency**: NOT idempotent. Each successful call sends a new message. There is no deduplication at the API level. If retrying after a network error (http_status=0), the caller must decide whether duplicate messages are acceptable.
- **Rollback**: Slack messages cannot be deleted or edited via Incoming Webhooks after sending. There is no rollback mechanism at the API level. Mitigation: send a follow-up correction message if needed.
- **Audit**: The service logs the redacted webhook URL, message length, HTTP status, and response body length. The full message content is NOT logged.

## Risks

- **Duplicate messages on retry**: Network failures trigger `UNAVAILABLE`, but the upstream Slack may have already delivered the message. Callers must handle potential duplicates in alert pipelines.
- **Rate limiting**: Slack enforces per-channel rate limits. Excessive traffic may trigger 429 responses (mapped to `UNAVAILABLE`). Configure appropriate throttling in your alert pipeline.
- **Message delivery is best-effort**: Slack Incoming Webhooks have no delivery confirmation beyond HTTP 200. There is no retry or queue at the Slack side.
- **URL rotation**: Slack webhook URLs can be regenerated from the Slack admin panel. Rotating the URL invalidates the old one. Update the instance secret accordingly.
- **Channel deletion**: If the target channel is deleted, the webhook returns HTTP 404. Re-create the webhook for a new channel.
- **Credential source**: Request `webhook` fields are ignored. Credentials are resolved from instance secret first, then deprecated config or binding fallbacks.
- **TLS**: TLS verification skip flags are rejected with `INVALID_ARGUMENT`; Slack webhooks must use normal HTTPS verification.
- **Sanitization**: Logs redact webhook path tokens. Message content and raw upstream bodies are not logged or returned.

## Limitations

- Only Incoming Webhook text payloads are supported.
- Slack response strings such as `invalid_payload` are not returned in `http_body`; only status and body length are exposed on errors.
- Retries may create duplicate messages if Slack received the original request.

## Package Files

- `service.json`: OctoBus service manifest.
- `proto/slack_group_robot.proto`: gRPC API definition.
- `config.schema.json`: non-secret timeout settings plus deprecated webhook fallbacks.
- `secret.schema.json`: Slack Incoming Webhook URL.
- `src/slack-group-robot.js`: Slack webhook implementation.
- `src/service.js`: OctoBus SDK `defineService` wrapper.
- `bin/slack-group-robot.js`: service-local executable entrypoint.
- `test/slack-group-robot.test.js`: node:test coverage for validation, payload construction, HTTP behavior, and SDK handler invocation.
- `test/mock_upstream.js`: optional local Slack webhook mock.

## Local Checks

```bash
cd services
npm run validate -- --service-dir slack__group-robot
npm test -- --service-dir slack__group-robot
```

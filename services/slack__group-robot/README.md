# Slack Group Robot OctoBus Service

OctoBus service package for sending text messages through Slack Incoming Webhooks.

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

Use `webhook` for the Slack Incoming Webhook URL. Legacy aliases `webhook_url`, `webhookUrl`, and `url` are also accepted.

```json
{
  "webhook": "https://hooks.slack.com/services/T00/B00/xxxx",
  "timeoutMs": 5000
}
```

No secret is required — Slack Incoming Webhooks embed authentication tokens directly in the URL. The `secret.schema.json` is empty and reserved for future extensions.

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
| `http_body` | string | Raw response body (`ok` on success, error string on failure) |

**Error mapping:**

| Condition | gRPC Status |
|-----------|------------|
| Missing or invalid webhook URL | `INVALID_ARGUMENT` |
| Empty message | `INVALID_ARGUMENT` |
| HTTP non-200 response (4xx/5xx) | `UNAVAILABLE` |
| Network failure (DNS, timeout, connection refused) | `UNAVAILABLE` (http_status=0, http_body empty) |

## Suggested Capset

```json
{
  "name": "slack-notify",
  "description": "Send alert notifications to Slack channel",
  "bindings": {
    "webhook": "https://hooks.slack.com/services/..."
  }
}
```

Add the capset to an instance:

```bash
octobus capset add-instance --instance <name> --capset slack-notify
```

## Operation Semantics

### SendTextMessage

- **Write operation**: Sends a message to Slack. Each call produces a single message.
- **Idempotency**: NOT idempotent — each successful call sends a new message. There is no deduplication at the API level. If retrying after a network error (http_status=0), the caller must decide whether duplicate messages are acceptable.
- **Rollback**: Slack messages cannot be deleted or edited via Incoming Webhooks after sending. There is no rollback mechanism at the API level. Mitigation: send a follow-up correction message if needed.
- **Audit**: The service logs the redacted webhook URL, message length, HTTP status, and response body length. The full message content is NOT logged.

## Risks

- **Duplicate messages on retry**: Network failures trigger `UNAVAILABLE`, but the upstream Slack may have already delivered the message. Callers must handle potential duplicates in alert pipelines.
- **Rate limiting**: Slack enforces per-channel rate limits. Excessive traffic may trigger 429 responses (mapped to `UNAVAILABLE`). Configure appropriate throttling in your alert pipeline.
- **Message delivery is best-effort**: Slack Incoming Webhooks have no delivery confirmation beyond HTTP 200. There is no retry or queue at the Slack side.
- **URL rotation**: Slack webhook URLs can be regenerated from the Slack admin panel. Rotating the URL invalidates the old one — update the instance config accordingly.
- **Channel deletion**: If the target channel is deleted, the webhook returns HTTP 404. Re-create the webhook for a new channel.

## Package Files

- `service.json`: OctoBus service manifest.
- `proto/slack_group_robot.proto`: gRPC API definition.
- `config.schema.json`: webhook URL and timeout settings.
- `secret.schema.json`: reserved for future auth (currently empty).
- `src/slack-group-robot.js`: Slack webhook implementation.
- `src/service.js`: OctoBus SDK `defineService` wrapper.
- `bin/slack-group-robot.js`: service-local executable entrypoint.
- `test/slack-group-robot.test.js`: node:test coverage for validation, payload construction, HTTP behavior, and SDK handler invocation.
- `test/mock_upstream.js`: optional local Slack webhook mock.

## Local Checks

```bash
cd services
npm run validate -- --service-dir slack__group-robot
npm test -- --service-dir slack__group-robot --coverage
npm run pack:check
```

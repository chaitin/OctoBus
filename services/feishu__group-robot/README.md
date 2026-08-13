# Feishu OctoBus Service

This package preserves the legacy group robot RPC and adds Feishu Approval and Contact capabilities from the public
Feishu Open Platform APIs. Method-level capsets can expose group notification, approval reads, approval writes, and
contact lookups independently.

Service name: `feishu-group-robot`

Import it into OctoBus with:

```bash
octobus service import --id feishu-group-robot ./services/feishu__group-robot
```

## Package Files

- `service.json`: OctoBus service manifest.
- `proto/feishu_group_robot.proto`: gRPC API definition.
- `config.schema.json`: timeout, TLS, and extra header settings.
- `secret.schema.json`: optional group webhook and optional custom application credentials.
- `src/feishu-group-robot.js`: Feishu webhook implementation.
- `src/service.js`: OctoBus SDK `defineService` wrapper.
- `bin/feishu-group-robot.js`: service-local executable entrypoint.
- `test/feishu-group-robot.test.js`: node:test coverage for validation, request mapping, HTTP behavior, network errors, and SDK handler invocation.
- `test/mock_upstream.js`: optional local Feishu webhook mock.

## Configuration

Use config for non-sensitive request behavior. These settings apply to both the legacy webhook and Open Platform
methods:

```json
{
  "baseUrl": "https://open.feishu.cn",
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

Approval and Contact methods instead require `appId` and `appSecret` in the Instance secret. Existing webhook-only
Instances remain valid, and Open Platform-only Instances do not need a webhook.

## RPC Methods

- `Feishu_GroupRobot.Feishu_GroupRobot/SendTextMessage`
- `Feishu_GroupRobot.Feishu_GroupRobot/CheckConnectivity`
- `Feishu_GroupRobot.Feishu_GroupRobot/GetApprovalDefinition`
- `Feishu_GroupRobot.Feishu_GroupRobot/ListApprovalInstanceCodes`
- `Feishu_GroupRobot.Feishu_GroupRobot/GetApprovalInstance`
- `Feishu_GroupRobot.Feishu_GroupRobot/CreateApprovalInstance`
- `Feishu_GroupRobot.Feishu_GroupRobot/CancelApprovalInstance`
- `Feishu_GroupRobot.Feishu_GroupRobot/SendApprovalBotMessage`
- `Feishu_GroupRobot.Feishu_GroupRobot/GetUser`
- `Feishu_GroupRobot.Feishu_GroupRobot/GetDepartment`

`SendTextMessage` keeps its legacy webhook contract. The Open Platform methods require `appId` and `appSecret` in the
Instance secret and return the Feishu `data` object in the structured `JsonResponse.data` field unless noted below.

Open Platform request fields:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `approval_code` | string | Yes for approval methods | Feishu approval definition code. |
| `instance_code` | string | Yes for instance methods | Feishu approval instance code; the create UUID can also be used to read an instance. |
| `user_id` / `open_id` | string | At least one where present | Feishu identity. If both are supplied, Feishu prioritizes `user_id`. |
| `user_id_type` | string | Optional | `open_id`, `union_id`, or `user_id`; approval instance reads and cancellation default to `open_id`. |
| `form_json` | string | Yes for create | Compressed JSON array containing Feishu approval form values. |
| `node_approvers` / `node_cc_users` | list | No | Node key plus user ID list for submitter-selected approvers or CC users. |
| `operation_id` | string | Yes for writes | Max 64 characters. Create uses it as Feishu instance UUID; Bot uses it as one-hour dedupe UUID; cancel uses it only as local correlation. |
| `start_time_ms` / `end_time_ms` | int64 | Yes for list | Millisecond timestamps; the window cannot exceed ten hours. |
| `page_size` / `page_token` | int32 / string | No for list | Feishu pagination; page size is 1–100 and the response JSON contains the next token when available. |
| `title` / `content` / `detail_url` | string | Yes for Bot | Custom template `1021` title, content, and HTTP(S) detail URL. |
| `locale` | string | No | Approval instance locales supported by Feishu; Bot supports `zh-CN`, `en-US`, and `ja-JP`. |
| `message` | string | Yes for group robot | Text content sent as Feishu `content.text`. Runtime aliases `send_msg`, `sendMsg`, and `text` are accepted. |

Response fields:

| Field | Type | Description |
|-------|------|-------------|
| `http_status` | int32 | Legacy webhook upstream HTTP status. It is `0` when the request is not sent. |
| `http_body` | string | Legacy compatibility field. The implementation returns an empty string to avoid leaking upstream content. |
| `instance_code` | string | Create response: Feishu approval instance code. |
| `message_id` | string | Bot response: Feishu approval Bot message ID. |
| `operation_id` | string | Correlation value supplied by the caller. |

The JSON returned by read methods is the Feishu `data` object. List responses contain `instance_code_list`,
`page_token`, and `has_more` when applicable.

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
- HTTP statuses 200, 209, and 210 return gRPC OK only when the body contains a numeric business code of `0` (the
  official `code` field or the legacy-compatible `StatusCode` field); the response contains `http_status` and empty
  `http_body` for the legacy webhook.
- Other HTTP statuses return `UNAVAILABLE` with upstream status, empty body, and body length on the error object.
- Webhook business code `10003` maps to `UNAUTHENTICATED`; other non-zero business codes map to
  `FAILED_PRECONDITION`. Missing business code or non-JSON success responses map to `UNKNOWN`.
- Open Platform timeout maps to `DEADLINE_EXCEEDED`; network failures map to `UNAVAILABLE`. Open Platform `99991663`
  (invalid tenant token) maps to `UNAUTHENTICATED` and clears the cached token.
- Contact APIs require both the published application scopes and a matching tenant contact data range. Feishu contact
  authority errors `40004`, `40014`, `99991661`, and `99991672` map to `PERMISSION_DENIED`. Requests using
  `user_id_type=user_id` may additionally require `contact:user.employee_id:readonly`; use the default `open_id` when
  employee IDs are not needed.
- The service sets core request headers while preserving configured extra headers; TLS verification can be skipped only for private testing.
- Request `webhook` fields are ignored. Credentials are resolved from instance secret first, then deprecated config or binding fallbacks.
- Logs redact the webhook token path; message content and raw upstream bodies are not logged.
- TLS verification can be skipped for private testing with `skipTlsVerify`, `tlsInsecureSkipVerify`, or `insecureSkipVerify`.

## Limitations

- Group robot delivery supports text only. `SendApprovalBotMessage` uses Feishu custom approval template `1021`.
- Feishu business errors are mapped to gRPC errors for both webhook and Open Platform methods. Raw upstream bodies,
  tokens, app secrets, and webhook tokens are never returned or logged.
- Group webhook retries may create duplicate messages if Feishu received the original request.

Open Platform mutations are never automatically retried. Approval creation requires `operation_id`, which is sent as
Feishu's instance `uuid`; approval Bot messages use the same field as the one-hour message deduplication `uuid`.
Cancellation has no Feishu idempotency field; its `operation_id` is only local correlation. Network failures and HTTP
5xx responses from mutations are reported as potentially ambiguous. After an ambiguous mutation, read the instance
state before deciding whether to submit again.

## Local Checks

```bash
cd services
npm run validate -- --service-dir feishu__group-robot
npm test -- --service-dir feishu__group-robot
npm test -- --coverage --service-dir feishu__group-robot
npm run pack:check
cd ..
task build
node scripts/service-package-smoke.mjs --service-dir feishu__group-robot
task lint
```

## Official API and permission references

- [Feishu group bot message API](https://open.feishu.cn/document/client-docs/bot-v3/add-custom-bot)
- [Tenant access token](https://open.feishu.cn/document/server-docs/authentication-management/access-token/tenant_access_token_internal)
- [Approval v4 APIs](https://open.feishu.cn/document/server-docs/approval-v4/overview)
- [Approval Bot message API](https://open.feishu.cn/document/server-docs/approval-v4/message/send-bot-messages)
- [Contact v3 APIs](https://open.feishu.cn/document/server-docs/contact-v3/overview)

The Feishu application must be granted only the scopes required by the selected methods, such as approval read/write
scopes, contact read scopes, and the bot message scope. Feishu applies per-tenant and per-endpoint rate limits; the
Service does not retry mutations automatically. Create and Bot message calls use `operation_id` as Feishu UUID
deduplication keys. Cancellation has no Feishu idempotency key and network/5xx failures are potentially ambiguous.

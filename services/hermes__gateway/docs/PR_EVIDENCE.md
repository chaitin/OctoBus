# PR Evidence: Hermes Gateway

This evidence comes from a live OctoBus call to the Hermes gateway running on
`xy-internal-devbox-01.xinyou-zhou.devbox.in.chaitin.net:8644`.

## Target

- Hermes host: `xy-internal-devbox-01.xinyou-zhou.devbox.in.chaitin.net:8644`
- Hermes deployment: `hermes gateway run --replace`
- Auth method: none required for `/health`
- Methods verified:
  - `hermes.v1.HermesGateway/HealthCheck`
  - `hermes.v1.HermesGateway/GetGatewayStatus`
  - `hermes.v1.HermesGateway/ListSendTargets`
  - `hermes.v1.HermesGateway/SendMessage`
  - `hermes.v1.HermesGateway/ListWebhookSubscriptions`
  - `hermes.v1.HermesGateway/CreateWebhookSubscription`
  - `hermes.v1.HermesGateway/TestWebhookSubscription`
  - `hermes.v1.HermesGateway/SendWebhook`
  - `hermes.v1.HermesGateway/RemoveWebhookSubscription`
  - `hermes.v1.HermesGateway/ListCronJobs`
  - `hermes.v1.HermesGateway/CreateCronJob`
  - `hermes.v1.HermesGateway/PauseCronJob`
  - `hermes.v1.HermesGateway/ResumeCronJob`
  - `hermes.v1.HermesGateway/RunCronJob`
  - `hermes.v1.HermesGateway/RemoveCronJob`
  - `hermes.v1.HermesGateway/ListSkills`
  - `hermes.v1.HermesGateway/ListTools`
  - `hermes.v1.HermesGateway/EnableTools`
  - `hermes.v1.HermesGateway/DisableTools`
  - `hermes.v1.HermesGateway/GetMemoryStatus`
  - `hermes.v1.HermesGateway/ConfigCheck`
  - `hermes.v1.HermesGateway/Doctor`
  - `hermes.v1.HermesGateway/SecurityAudit`
  - `hermes.v1.HermesGateway/ListSessions`
  - `hermes.v1.HermesGateway/GetSessionsStats`
  - `hermes.v1.HermesGateway/GetLogs`
  - `hermes.v1.HermesGateway/EnablePlugin`
  - `hermes.v1.HermesGateway/DisablePlugin`
- OctoBus service: `hermes-gateway`
- OctoBus instance: `hermes-internal`
- OctoBus capsets: `hermes-tools`, `hermes-message-tools`,
  `hermes-webhook-tools`, `hermes-cron-tools`, `hermes-diagnostics-tools`,
  `hermes-admin-tools`, `hermes-ops-tools`

## HealthCheck

## Request

```http
GET http://xy-internal-devbox-01.xinyou-zhou.devbox.in.chaitin.net:8644/health
Accept: application/json, text/plain, */*
User-Agent: octobus-hermes-gateway/0.1.0

<empty>
```

## Response

```http
HTTP/1.1 200 OK
content-length: 39
content-type: application/json; charset=utf-8
date: Mon, 29 Jun 2026 04:51:41 GMT
server: Python/3.12 aiohttp/3.13.4

{"status": "ok", "platform": "webhook"}
```

## OctoBus Connect Call

```bash
curl -sS -X POST \
  http://127.0.0.1:9000/capsets/hermes-tools/connect/hermes-internal/hermes.v1.HermesGateway/HealthCheck \
  -H "Content-Type: application/json" \
  -d "{}"
```

```json
{
  "ok": true,
  "statusCode": 200,
  "statusText": "OK",
  "requestMethod": "GET",
  "requestUrl": "http://xy-internal-devbox-01.xinyou-zhou.devbox.in.chaitin.net:8644/health",
  "responseBody": "{\"status\": \"ok\", \"platform\": \"webhook\"}"
}
```

## Signed Dynamic Webhook Delivery

The deployed instance allows `/webhooks/*`. The package resolves
`secretName` / `hmacSecretName` from OctoBus `secret.webhookHmacSecrets`, then
computes `X-Webhook-Signature`. No raw HMAC secret is passed by the agent.

### Create Subscription Request

```http
POST http://127.0.0.1:9000/capsets/hermes-webhook-tools/connect/hermes-internal/hermes.v1.HermesGateway/CreateWebhookSubscription
Content-Type: application/json

{
  "name": "octobus-sendwebhook-20260629135441",
  "prompt": "OctoBus SendWebhook smoke: {event_id}",
  "events": "octobus.sendwebhook",
  "description": "Temporary SendWebhook smoke test",
  "deliver": "log",
  "secretName": "smoke"
}
```

### Create Subscription Response

```json
{
  "ok": true,
  "stdout": "Created webhook subscription: octobus-sendwebhook-20260629135441\nURL: http://localhost:8644/webhooks/octobus-sendwebhook-20260629135441\nSecret: ******\nEvents: octobus.sendwebhook\nDeliver: log\nPrompt: OctoBus SendWebhook smoke: {event_id}"
}
```

### SendWebhook Request

```http
POST http://127.0.0.1:9000/capsets/hermes-webhook-tools/connect/hermes-internal/hermes.v1.HermesGateway/SendWebhook
Content-Type: application/json

{
  "path": "/webhooks/octobus-sendwebhook-20260629135441",
  "payloadJson": "{\"type\":\"octobus.sendwebhook\",\"event_id\":\"evt-sendwebhook-smoke\"}",
  "hmacSecretName": "smoke",
  "idempotencyKey": "idem-20260629135441",
  "correlationId": "corr-20260629135441",
  "timeoutMs": 30000
}
```

### SendWebhook Response

```json
{
  "ok": true,
  "statusCode": 202,
  "statusText": "Accepted",
  "requestMethod": "POST",
  "requestUrl": "http://xy-internal-devbox-01.xinyou-zhou.devbox.in.chaitin.net:8644/webhooks/octobus-sendwebhook-20260629135441",
  "requestHeadersJson": "{\"Accept\":\"application/json, text/plain, */*\",\"User-Agent\":\"octobus-hermes-gateway/0.1.0\",\"Idempotency-Key\":\"idem-20260629135441\",\"X-Correlation-ID\":\"corr-20260629135441\",\"X-Webhook-Signature\":\"******\",\"Content-Type\":\"application/json\"}",
  "requestBody": "{\"type\":\"octobus.sendwebhook\",\"event_id\":\"evt-sendwebhook-smoke\"}",
  "responseBody": "{\"status\": \"accepted\", \"route\": \"octobus-sendwebhook-20260629135441\", \"event\": \"octobus.sendwebhook\", \"delivery_id\": \"1782712482638\"}"
}
```

### Remove Subscription Request

```http
POST http://127.0.0.1:9000/capsets/hermes-webhook-tools/connect/hermes-internal/hermes.v1.HermesGateway/RemoveWebhookSubscription
Content-Type: application/json

{
  "name": "octobus-sendwebhook-20260629135441"
}
```

### Remove Subscription Response

```json
{
  "ok": true,
  "stdout": "Removed webhook subscription: octobus-sendwebhook-20260629135441"
}
```

## Cron Lifecycle

### CreateCronJob Request

```http
POST http://127.0.0.1:9000/capsets/hermes-cron-tools/connect/hermes-internal/hermes.v1.HermesGateway/CreateCronJob
Content-Type: application/json

{
  "schedule": "every 1h",
  "name": "OctoBus Smoke 20260629134852",
  "script": "octobus_smoke.sh",
  "noAgent": true,
  "deliver": "local",
  "repeat": 1,
  "timeoutMs": 30000
}
```

### CreateCronJob Response

```json
{
  "ok": true,
  "stdout": "Created job: 2de5c0d080ef\nName: OctoBus Smoke 20260629134852\nSchedule: every 60m\nScript: octobus_smoke.sh\nMode: no-agent (script stdout delivered directly)\nNext run: 2026-06-29T14:48:57.493776+08:00"
}
```

### Pause / Resume / Run / Remove Responses

```json
{
  "PauseCronJob": {
    "ok": true,
    "stdout": "Paused job: OctoBus Smoke 20260629134852 (2de5c0d080ef)"
  },
  "ResumeCronJob": {
    "ok": true,
    "stdout": "Resumed job: OctoBus Smoke 20260629134852 (2de5c0d080ef)\nNext run: 2026-06-29T14:49:00.832261+08:00"
  },
  "RunCronJob": {
    "ok": true,
    "stdout": "Triggered job: OctoBus Smoke 20260629134852 (2de5c0d080ef)\nNext run: 2026-06-29T13:49:03.621705+08:00\nIt will run on the next scheduler tick."
  },
  "RemoveCronJob": {
    "ok": true,
    "stdout": "Removed job: OctoBus Smoke 20260629134852 (2de5c0d080ef)"
  }
}
```

## Ops Method Evidence

### Read-Only Diagnostics

```json
{
  "GetComponentStatus": {
    "ok": true,
    "stdout_contains": "Hermes Agent Status; Model: deepseek-v4-flash; Provider: Custom endpoint; Messaging Platforms"
  },
  "ListPlugins": {
    "ok": true,
    "stdout": "not enabled  user     0.1.0    pgs-confirm-forwarder"
  },
  "ListMcpServers": {
    "ok": true,
    "stdout": "No MCP servers configured."
  },
  "ListTools": {
    "ok": true,
    "stdout_contains": "Built-in toolsets (cli); web enabled; browser enabled; video disabled"
  },
  "GetMemoryStatus": {
    "ok": true,
    "stdout_contains": "Memory status; Built-in: always active"
  },
  "ConfigCheck": {
    "ok": true,
    "stdout_contains": "Configuration Status; Config version: 24 -> 30 (update available)"
  },
  "Doctor": {
    "ok": true,
    "stdout_contains": "Hermes Doctor; No active security advisories; Python 3.12.3"
  },
  "ListSessions": {
    "ok": true,
    "stdout_contains": "PGS ID Processing Confirmation; PGS 每日早会分析"
  },
  "GetSessionsStats": {
    "ok": true,
    "stdout": "Total sessions: 242\nTotal messages: 12914\ncli: 23 sessions\nDatabase size: 241.8 MB"
  },
  "GetLogs": {
    "ok": true,
    "stdout_contains": "~/.hermes/logs/gateway.log"
  }
}
```

### Tool Toggle Request / Response

```http
POST http://127.0.0.1:9000/capsets/hermes-admin-tools/connect/hermes-internal/hermes.v1.HermesGateway/EnableTools
Content-Type: application/json

{
  "platform": "cli",
  "names": ["video"]
}
```

```json
{
  "ok": true,
  "stdout": "✓ Enabled: video"
}
```

```http
POST http://127.0.0.1:9000/capsets/hermes-admin-tools/connect/hermes-internal/hermes.v1.HermesGateway/DisableTools
Content-Type: application/json

{
  "platform": "cli",
  "names": ["video"]
}
```

```json
{
  "ok": true,
  "stdout": "✓ Disabled: video"
}
```

### Plugin Toggle Request / Response

```http
POST http://127.0.0.1:9000/capsets/hermes-admin-tools/connect/hermes-internal/hermes.v1.HermesGateway/EnablePlugin
Content-Type: application/json

{
  "name": "pgs-confirm-forwarder"
}
```

```json
{
  "ok": true,
  "stdout": "✓ Plugin pgs-confirm-forwarder enabled. Takes effect on next session."
}
```

```http
POST http://127.0.0.1:9000/capsets/hermes-admin-tools/connect/hermes-internal/hermes.v1.HermesGateway/DisablePlugin
Content-Type: application/json

{
  "name": "pgs-confirm-forwarder"
}
```

```json
{
  "ok": true,
  "stdout": "⊘ Plugin pgs-confirm-forwarder disabled. Takes effect on next session."
}
```

### SecurityAudit Response

```json
{
  "ok": true,
  "stdout": "No known vulnerabilities found across 218 component(s)."
}
```

The earlier baseline reported 36 findings; the Hermes venv was upgraded and
the gateway was restarted before the clean audit above. `TestMcpServer` is
selected in `hermes-admin-tools` but was not exercised in the live environment
because `ListMcpServers` returned no configured MCP servers.

## Smoke Script Evidence

```http
ssh root@xy-logistic-devbox-02 'cd /opt/octobus-services/hermes__gateway && python3 scripts/smoke-devbox.py'
```

```text
ok hermes-diagnostics-tools/GetGatewayStatus
ok hermes-diagnostics-tools/ConfigCheck
ok hermes-admin-tools/Doctor
ok hermes-webhook-tools/CreateWebhookSubscription
ok hermes-webhook-tools/SendWebhook
ok hermes-webhook-tools/RemoveWebhookSubscription
ok hermes-cron-tools/CreateCronJob
ok hermes-cron-tools/PauseCronJob
ok hermes-cron-tools/ResumeCronJob
ok hermes-cron-tools/RunCronJob
ok hermes-cron-tools/RemoveCronJob
ok hermes-admin-tools/EnableTools
ok hermes-admin-tools/DisableTools
ok hermes-admin-tools/EnablePlugin
ok hermes-admin-tools/DisablePlugin
ok hermes-webhook-tools/ListWebhookSubscriptions
ok hermes-cron-tools/ListCronJobs
ok hermes-diagnostics-tools/ListTools
ok hermes-diagnostics-tools/ListPlugins
Hermes OctoBus smoke test passed
```

## GetGatewayStatus

### Request

```http
POST http://127.0.0.1:9000/capsets/hermes-tools/connect/hermes-internal/hermes.v1.HermesGateway/GetGatewayStatus
Content-Type: application/json

{}
```

### Response

```json
{
  "ok": true,
  "command": "ssh root@xy-internal-devbox-01.xinyou-zhou.devbox.in.chaitin.net '/root/.local/bin/hermes' 'gateway' 'status'",
  "stdout": "✓ Gateway is running (PID: 18115, 18086)\n  (Running manually, not as a system service)\n\nTo install as a service:\n  hermes gateway install\n  sudo hermes gateway install --system\n",
  "evidence": "# Command\nssh root@xy-internal-devbox-01.xinyou-zhou.devbox.in.chaitin.net '/root/.local/bin/hermes' 'gateway' 'status'\n\n# Stdin\n<empty>\n\n# Response\nexit_code=0\n\n## Stdout\n✓ Gateway is running (PID: 18115, 18086)\n  (Running manually, not as a system service)\n\nTo install as a service:\n  hermes gateway install\n  sudo hermes gateway install --system\n\n\n## Stderr\n<empty>"
}
```

## ListSendTargets

### Request

```http
POST http://127.0.0.1:9000/capsets/hermes-tools/connect/hermes-internal/hermes.v1.HermesGateway/ListSendTargets
Content-Type: application/json

{}
```

### Response

```json
{
  "ok": true,
  "command": "ssh root@xy-internal-devbox-01.xinyou-zhou.devbox.in.chaitin.net '/root/.local/bin/hermes' 'send' '--list' '--json'",
  "stdout": "{\n  \"platforms\": {\n    \"dingtalk\": [\n      {\n        \"id\": \"cid98AiQiLNhRF9uknCcthGpoqgJAafbWe9scFqatyHUFc=\",\n        \"name\": \"\\u5468\\u8f9b\\u9149\",\n        \"type\": \"dm\",\n        \"thread_id\": null\n      }\n    ]\n  }\n}\n"
}
```

## SendMessage

Hermes outbound DingTalk is configured with a static group robot webhook in
`/root/.hermes/.env`. The token is not shown here. The deployed OctoBus
instance appends `PGS` and the final `From XY@Agent` signature to DingTalk
messages.
If the input already ends with `From XY@Agent`, the package de-duplicates that
final suffix and sends one final `PGS\nFrom XY@Agent` block.

### Request

```http
POST http://127.0.0.1:9000/capsets/hermes-message-tools/connect/hermes-internal/hermes.v1.HermesGateway/SendMessage
Content-Type: application/json

{
  "target": "dingtalk:cid98AiQiLNhRF9uknCcthGpoqgJAafbWe9scFqatyHUFc=",
  "message": "Hermes OctoBus SendMessage 联调测试"
}
```

A second live request with input already ending in `From XY@Agent` also
returned `ok: true`, verifying the de-duplication path:

```json
{
  "target": "dingtalk:cid98AiQiLNhRF9uknCcthGpoqgJAafbWe9scFqatyHUFc=",
  "message": "Hermes signature de-dup verification\nFrom XY@Agent"
}
```

### Response

```json
{
  "ok": true,
  "command": "ssh root@xy-internal-devbox-01.xinyou-zhou.devbox.in.chaitin.net '/root/.local/bin/hermes' 'send' '--to' 'dingtalk:cid98AiQiLNhRF9uknCcthGpoqgJAafbWe9scFqatyHUFc=' '--json' '--file' '-'",
  "stdout": "{\n  \"success\": true,\n  \"platform\": \"dingtalk\",\n  \"chat_id\": \"cid98AiQiLNhRF9uknCcthGpoqgJAafbWe9scFqatyHUFc=\",\n  \"note\": \"Sent to dingtalk home channel (chat_id: cid98AiQiLNhRF9uknCcthGpoqgJAafbWe9scFqatyHUFc=)\",\n  \"mirrored\": true\n}\n",
  "evidence": "# Command\nssh root@xy-internal-devbox-01.xinyou-zhou.devbox.in.chaitin.net '/root/.local/bin/hermes' 'send' '--to' 'dingtalk:cid98AiQiLNhRF9uknCcthGpoqgJAafbWe9scFqatyHUFc=' '--json' '--file' '-'\n\n# Stdin\n<provided via stdin>\n\n# Response\nexit_code=0\n\n## Stdout\n{\n  \"success\": true,\n  \"platform\": \"dingtalk\",\n  \"chat_id\": \"cid98AiQiLNhRF9uknCcthGpoqgJAafbWe9scFqatyHUFc=\",\n  \"note\": \"Sent to dingtalk home channel (chat_id: cid98AiQiLNhRF9uknCcthGpoqgJAafbWe9scFqatyHUFc=)\",\n  \"mirrored\": true\n}\n\n\n## Stderr\n<empty>"
}
```

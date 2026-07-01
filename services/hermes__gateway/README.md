# Hermes Gateway OctoBus Service

This package exposes Hermes gateway capabilities through OctoBus. It is a
general Hermes integration package, not a PGS-specific package. PGS morning
meeting approval is one workflow that can use these methods.

The package supports two transports:

- HTTP transport for gateway health checks and webhook POSTs.
- CLI transport for Hermes messaging, gateway status, cron/webhook listings,
  plugins, MCP, sessions, and bounded logs. CLI transport can run locally or
  over SSH with fixed command templates.

## Methods

- `hermes.v1.HermesGateway/HealthCheck`: `GET` the configured `healthPath`.
- `hermes.v1.HermesGateway/SendWebhook`: `POST` JSON to `path` or
  `defaultPath`. The path must be listed in `allowedPaths`. `allowedPaths`
  supports exact paths and prefix entries ending in `*`, such as
  `/webhooks/*`. When `hmacSecretName` is provided on the request, the package
  resolves the named value from `secret.webhookHmacSecrets`, signs the exact
  JSON request body with HMAC-SHA256, and sends `X-Webhook-Signature`.
- `hermes.v1.HermesGateway/GetGatewayStatus`: `hermes gateway status`.
- `hermes.v1.HermesGateway/GetComponentStatus`: `hermes status --all`.
- `hermes.v1.HermesGateway/ListSendTargets`: `hermes send --list --json`.
- `hermes.v1.HermesGateway/ListWebhookSubscriptions`: `hermes webhook list`.
- `hermes.v1.HermesGateway/ListCronJobs`: `hermes cron list`.
- `hermes.v1.HermesGateway/ListPlugins`: `hermes plugins list --plain --no-bundled`.
- `hermes.v1.HermesGateway/ListMcpServers`: `hermes mcp list`.
- `hermes.v1.HermesGateway/TestMcpServer`: `hermes mcp test <name>`.
- `hermes.v1.HermesGateway/ListSkills`: `hermes skills list`.
- `hermes.v1.HermesGateway/ListTools`: `hermes tools list --platform <platform>`.
- `hermes.v1.HermesGateway/EnableTools`: `hermes tools enable`.
- `hermes.v1.HermesGateway/DisableTools`: `hermes tools disable`.
- `hermes.v1.HermesGateway/GetMemoryStatus`: `hermes memory status`.
- `hermes.v1.HermesGateway/ConfigCheck`: `hermes config check`.
- `hermes.v1.HermesGateway/Doctor`: `hermes doctor`.
- `hermes.v1.HermesGateway/SecurityAudit`: `hermes security audit`.
- `hermes.v1.HermesGateway/CreateWebhookSubscription`: `hermes webhook subscribe`.
- `hermes.v1.HermesGateway/TestWebhookSubscription`: `hermes webhook test`.
- `hermes.v1.HermesGateway/RemoveWebhookSubscription`: `hermes webhook remove`.
- `hermes.v1.HermesGateway/CreateCronJob`: `hermes cron create`.
- `hermes.v1.HermesGateway/PauseCronJob`: `hermes cron pause`.
- `hermes.v1.HermesGateway/ResumeCronJob`: `hermes cron resume`.
- `hermes.v1.HermesGateway/RunCronJob`: `hermes cron run`.
- `hermes.v1.HermesGateway/RemoveCronJob`: `hermes cron remove`.
- `hermes.v1.HermesGateway/EnablePlugin`: `hermes plugins enable`.
- `hermes.v1.HermesGateway/DisablePlugin`: `hermes plugins disable`.
- `hermes.v1.HermesGateway/ListSessions`: `hermes sessions list`.
- `hermes.v1.HermesGateway/GetSessionsStats`: `hermes sessions stats`.
- `hermes.v1.HermesGateway/GetLogs`: bounded `hermes logs`.
- `hermes.v1.HermesGateway/SendMessage`: `hermes send --to ... --file -`.

`SendWebhook` returns a redacted `evidence` field containing the complete HTTP
request and response text. This is designed to be pasted into PR descriptions
after replacing secrets with `******`.

CLI methods return command evidence with stdout/stderr. They never accept an
arbitrary shell command; each method uses a fixed Hermes CLI argument list.

## Config

Non-sensitive instance config:

```json
{
  "baseUrl": "http://127.0.0.1:5800",
  "defaultPath": "/api/webhooks/pgs-confirm",
  "healthPath": "/health",
  "allowedPaths": ["/health", "/webhooks/*"],
  "timeoutMs": 10000,
  "skipTlsVerify": false,
  "cliMode": "ssh",
  "cliBinary": "/root/.local/bin/hermes",
  "sshTarget": "root@xy-internal-devbox-01.xinyou-zhou.devbox.in.chaitin.net",
  "sshOptions": [
    "-o", "BatchMode=yes",
    "-o", "StrictHostKeyChecking=accept-new",
    "-o", "UserKnownHostsFile=/tmp/hermes_known_hosts"
  ],
  "allowedTargets": ["dingtalk:cid98AiQiLNhRF9uknCcthGpoqgJAafbWe9scFqatyHUFc="],
  "messageSignature": "From XY@Agent"
}
```

Sensitive instance secret:

```json
{
  "authHeaderName": "X-Hermes-Token",
  "authHeaderValue": "replace-with-real-token",
  "webhookHmacSecrets": {
    "smoke": "replace-with-real-hmac-secret",
    "pgs-confirm": "replace-with-real-hmac-secret"
  }
}
```

## Local Test

```bash
cd octobus-services/hermes__gateway
npm test
```

## Direct Runtime Invocation

```bash
OCTOBUS_SERVICE_CONTEXT='{
  "config": {
    "baseUrl": "http://127.0.0.1:5800",
    "defaultPath": "/api/webhooks/pgs-confirm",
    "allowedPaths": ["/api/webhooks/pgs-confirm"],
    "timeoutMs": 10000
  },
  "secret": {
    "authHeaderName": "X-Hermes-Token",
    "authHeaderValue": "replace-with-real-token"
  }
}' \
node bin/hermes-gateway.js send-webhook --data-json '{
  "payloadJson": "{\"report_id\":\"PGS-20990101\",\"action\":\"approve\"}",
  "idempotencyKey": "idem-20990101",
  "correlationId": "corr-20990101"
}'
```

CLI-backed example:

```bash
OCTOBUS_SERVICE_CONTEXT='{
  "config": {
    "cliMode": "ssh",
    "cliBinary": "/root/.local/bin/hermes",
    "sshTarget": "root@xy-internal-devbox-01.xinyou-zhou.devbox.in.chaitin.net",
    "sshOptions": ["-o", "BatchMode=yes"],
    "allowedTargets": ["dingtalk:cid98AiQiLNhRF9uknCcthGpoqgJAafbWe9scFqatyHUFc="]
  }
}' \
node bin/hermes-gateway.js list-send-targets --data-json '{}'
```

`SendMessage` automatically appends `From XY@Agent` to DingTalk messages when
the suffix is missing.

Current `xy-internal-devbox-01` note: DingTalk outbound uses the static
`DINGTALK_WEBHOOK_URL` group robot webhook. The deployed instance appends
`PGS` before the required final signature so DingTalk keyword security passes
while every message still ends with `From XY@Agent`.

If the input message already ends with `From XY@Agent`, `SendMessage` replaces
that final suffix with `PGS\nFrom XY@Agent` instead of duplicating the
signature.

## Suggested Capsets

Use separate capsets instead of giving every agent all methods:

- `hermes-readonly-tools`: status, targets, webhooks, cron, plugins, MCP,
  skills, tools, memory, sessions, logs.
- `hermes-message-tools`: `SendMessage` for explicitly allowed targets.
- `hermes-webhook-tools`: create, test, list, and remove dynamic webhook
  subscriptions, plus signed `SendWebhook` delivery into Hermes dynamic
  webhook routes.
- `hermes-cron-tools`: create, pause, resume, run, list, and remove Hermes
  cron jobs.
- `hermes-diagnostics-tools`: read-only status, config, security audit,
  sessions, logs, skills, tools, plugin list, MCP list, webhook list, and cron
  list.
- `hermes-admin-tools`: `Doctor`, tool toggles, plugin toggles, and MCP server
  tests. Keep this out of ordinary business agents.
- `hermes-ops-tools`: read-only compatibility capset for older consumers. Use
  the split diagnostics/admin capsets for new agents.

## OctoBus Import Sketch

```bash
octobus service import hermes-gateway ./octobus-services/hermes__gateway

octobus instance create hermes-local \
  --service hermes-gateway \
  --config-json '{"baseUrl":"http://127.0.0.1:5800","defaultPath":"/api/webhooks/pgs-confirm","allowedPaths":["/api/webhooks/pgs-confirm"],"timeoutMs":10000}' \
  --secret-json '{"authHeaderName":"X-Hermes-Token","authHeaderValue":"replace-with-real-token"}'

octobus capset create hermes-tools --name "Hermes Tools"
octobus capset add-instance hermes-tools hermes-local
octobus catalog hermes-tools --all --md
```

## PR Evidence Requirement

The PR must include complete real request and response bodies from the target
Hermes environment. Use `docs/PR_EVIDENCE.md` as the template and paste
redacted `evidence` fields returned by representative methods.

## DevBox Verification Snapshot

Verified on `xy-logistic-devbox-02` against Hermes on
`xy-internal-devbox-01`:

- Local package tests: `npm test` passed 5/5.
- Remote package tests: `npm test` passed 5/5.
- OctoBus service import: `hermes-gateway` descriptor version
  `9e043064df80`.
- Capsets:
- `hermes-message-tools`: `ListSendTargets`, `SendMessage`.
- `hermes-webhook-tools`: `ListWebhookSubscriptions`,
    `CreateWebhookSubscription`, `TestWebhookSubscription`, `SendWebhook`,
    `RemoveWebhookSubscription`.
  - `hermes-cron-tools`: `ListCronJobs`, `CreateCronJob`, `PauseCronJob`,
    `ResumeCronJob`, `RunCronJob`, `RemoveCronJob`.
  - `hermes-diagnostics-tools`: read-only status, targets, lists, skills,
    tools, memory, config, security audit, sessions, and logs.
  - `hermes-admin-tools`: doctor, tool toggles, plugin toggles, and MCP tests.
  - `hermes-ops-tools`: read-only compatibility only.
- Real call coverage:
  - Named-secret dynamic webhook creation and delivery returned
    `202 Accepted`, then the temporary subscription was removed.
  - Cron lifecycle created, listed, paused, resumed, triggered, and removed a
    temporary no-agent job.
  - Tool toggle enabled and disabled `video`, restoring it to disabled.
  - Plugin toggle enabled and disabled `pgs-confirm-forwarder`, restoring it
    to disabled.
  - `SecurityAudit` initially reported 36 findings. The Hermes venv was
    upgraded and restarted; the latest audit reports no known vulnerabilities
    across 218 components.
  - `TestMcpServer` is exposed but not exercised because Hermes currently has
    no MCP servers configured.
  - `scripts/smoke-devbox.py` passed end-to-end against the live DevBox.

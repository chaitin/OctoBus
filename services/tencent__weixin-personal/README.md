# Tencent Weixin iLink Bot (experimental)

OctoBus adapter for Tencent's iLink Bot HTTP endpoints. Despite the historical
service ID, this integrates an **iLink bot identity**; it does not automate an
ordinary personal Weixin account.

The upstream API is not a generally documented OpenAPI product. Compatibility,
availability, account eligibility, and acceptable use must be verified with
Tencent before production deployment. Pinning this adapter does not guarantee
that Tencent will preserve the observed protocol.

## Supported RPCs

- `StartLogin`: request a short-lived QR authorization session.
- `WaitLogin`: wait for authorization and retain the credential inside this
  service instance. The token is deliberately not returned over RPC.
- `FetchUpdates`: perform one authenticated long poll and return normalized
  messages plus the next cursor.
- `SendText`: send text through an authorized iLink bot.

There is intentionally no in-memory background receiver or acknowledgement
queue. Callers own cursor persistence and delivery semantics. A token obtained
through QR authorization is process-local and is lost when the instance stops;
for restart-safe operation, provision a valid token through the instance secret.

## Configuration

```json
{
  "loginBaseUrl": "https://ilinkai.weixin.qq.com",
  "baseUrl": "https://ilinkai.weixin.qq.com",
  "accountId": "xxxx@im.bot",
  "timeoutMs": 15000,
  "longPollTimeoutMs": 35000
}
```

Secret:

```json
{ "token": "iLink-bot-token" }
```

Never include tokens, QR codes, chat contents, or screenshots in issues, logs,
test fixtures, or commits.

# Tencent Weixin iLink Bot (experimental)

OctoBus adapter for Tencent's iLink Bot HTTP endpoints. Despite the historical
service ID, this integrates an **iLink bot identity**; it does not automate an
ordinary personal Weixin account.

The wire protocol and compatibility baseline were verified against Tencent's
official [`Tencent/openclaw-weixin`](https://github.com/Tencent/openclaw-weixin)
release `v2.4.6` (`@tencent-weixin/openclaw-weixin`), which is published under
the MIT license. This adapter is an independent OctoBus implementation and does
not copy or bundle that package.

Tencent publishes this capability as an OpenClaw Weixin channel rather than a
general-purpose Weixin OpenAPI. Account eligibility, availability, acceptable
use, and protocol stability remain controlled by Tencent. Compatibility here
means the login, `getupdates`, and `sendmessage` wire shapes used by v2.4.6; it
does not promise compatibility with future releases or every OpenClaw feature
(media upload, typing notifications, and lifecycle notifications are outside
this service's current scope).

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

## Upstream references

- Tencent implementation: https://github.com/Tencent/openclaw-weixin/tree/v2.4.6
- Published package: https://www.npmjs.com/package/@tencent-weixin/openclaw-weixin/v/2.4.6
- Upstream license: MIT

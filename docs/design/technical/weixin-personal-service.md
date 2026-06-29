# Personal Weixin Chat Service Design

## Goal

Add an OctoBus service for personal Weixin chat messages.

The service should let OctoBus callers send text messages and, in a later phase, receive or poll personal Weixin messages through an explicit adapter boundary. The first implementation should target a controlled operator-owned account and avoid pretending that personal Weixin has a general public bot API.

## Scope

In scope:

- Send text messages to a known Weixin peer.
- Poll new messages from a connected personal Weixin account.
- Preserve upstream response fields for troubleshooting.
- Keep account login, QR code authorization, in-memory runtime credentials, and long-running Weixin connectivity inside the OctoBus service boundary.
- Use Tencent iLink HTTP endpoints directly, with OpenClaw and Hermes as protocol references only.

Out of scope for the first phase:

- Direct reverse engineering of the Weixin desktop or mobile protocol inside OctoBus.
- Mass messaging, contact scraping, unsolicited outreach, or hidden automation.
- Media upload and download.
- Multi-step session orchestration beyond returning `context_token`.
- Receiving inbound callbacks from Weixin directly.

## Upstream Choice

Personal Weixin does not expose a stable public third-party chat automation API like an incoming webhook.

The most useful current reference is OpenClaw plus the `@tencent-weixin/openclaw-weixin` channel package:

- npm package: `@tencent-weixin/openclaw-weixin`
- latest version observed: `2.4.6`
- author metadata observed from npm: `Tencent`
- maintainers observed from npm use `@tencent.com` email addresses
- package description: `OpenClaw Weixin channel`
- peer dependency: `openclaw >=2026.5.12`

This package can be treated as Tencent-published npm code for the OpenClaw channel ecosystem, but it should not be documented as the official Weixin public personal-account API.

The package source exposes enough HTTP protocol details for a direct OctoBus adapter. This should be the preferred deployment if the product requirement is "no OpenClaw sidecar":

- QR login endpoint under `https://ilinkai.weixin.qq.com`.
- Message APIs under the `baseurl` returned by QR login confirmation.
- Bearer token auth using `AuthorizationType: ilink_bot_token`.
- Long-poll inbound messages through `ilink/bot/getupdates`.
- Outbound messages through `ilink/bot/sendmessage`.

OpenClaw remains useful as the compatibility reference implementation, not as a required runtime dependency.

Hermes Agent is a second useful reference. Its current upstream repository includes a native Python adapter at `gateway/platforms/weixin.py` rather than depending on `@tencent-weixin/openclaw-weixin`. The Hermes adapter describes the integration as Tencent iLink Bot API, uses the same endpoint family, and exposes the same operational model:

- `https://ilinkai.weixin.qq.com`
- `ilink/bot/get_bot_qrcode`
- `ilink/bot/get_qrcode_status`
- `ilink/bot/getupdates`
- `ilink/bot/sendmessage`
- `AuthorizationType: ilink_bot_token`
- `WEIXIN_ACCOUNT_ID`, `WEIXIN_TOKEN`, and optional `WEIXIN_BASE_URL`

So Hermes does not appear to call the npm package directly. It validates the better approach for OctoBus: implement a native iLink adapter and use both Hermes and OpenClaw as protocol references.

## Deployment Choice

Recommended deployment is to implement the iLink HTTP adapter directly inside the OctoBus service.

```text
octobus service process
  -> https://ilinkai.weixin.qq.com/ilink/bot/get_bot_qrcode
  -> returned baseurl / ilink/bot/*
  -> operator-authorized personal Weixin account
```

This avoids deploying OpenClaw, but it means OctoBus owns:

- QR login session state.
- Bot token and account ID storage.
- API header construction.
- Long-poll cursor persistence contract.
- Compatibility tracking when `@tencent-weixin/openclaw-weixin` changes.

Alternative deployment is to run OpenClaw as a sidecar or colocated gateway process, then let the OctoBus service call its HTTP JSON API.

```text
same host or private network

octobus service process
  -> http://127.0.0.1:<openclaw-gateway-port>
  -> openclaw gateway
  -> openclaw-weixin channel
```

This still requires deploying OpenClaw somewhere, but not inside OctoBus core. The smallest operational unit is:

- OctoBus service package
- OpenClaw runtime
- `@tencent-weixin/openclaw-weixin` plugin installed into OpenClaw
- QR-authorized personal Weixin account state managed by OpenClaw

Directly importing `@tencent-weixin/openclaw-weixin` from the OctoBus service is not the preferred design:

- The package metadata exposes OpenClaw extension fields, not a normal stable SDK entry point.
- The package has a peer dependency on `openclaw >=2026.5.12`.
- Login, account storage, long polling, gateway restart, and channel lifecycle are OpenClaw host responsibilities.
- Importing plugin internals would couple OctoBus to undocumented files and could break on package upgrades.

If a single-process deployment becomes necessary, the safer variant is embedding or launching an OpenClaw host from the service package and still talking through the OpenClaw channel contract. That is operationally heavier and should be a later option, not the first implementation.

## Direct iLink API Reference

Observed from `@tencent-weixin/openclaw-weixin@2.4.6` and cross-checked against Hermes Agent's native Weixin adapter.

### Login

Fixed login base URL:

```text
https://ilinkai.weixin.qq.com
```

Start QR login:

```http
POST /ilink/bot/get_bot_qrcode?bot_type=3
```

Request body:

```json
{
  "local_token_list": []
}
```

Response fields used by the reference implementation:

- `qrcode`
- `qrcode_img_content`

Poll QR login status:

```http
GET /ilink/bot/get_qrcode_status?qrcode=<qrcode>
```

Optional verification-code retry:

```http
GET /ilink/bot/get_qrcode_status?qrcode=<qrcode>&verify_code=<code>
```

Important response fields:

- `status`: `wait`, `scaned`, `confirmed`, `expired`, `need_verifycode`, `verify_code_blocked`, `scaned_but_redirect`, `binded_redirect`
- `bot_token`
- `ilink_bot_id`
- `ilink_user_id`
- `baseurl`
- `redirect_host`

On `confirmed`, store:

- `account_id`: normalized `ilink_bot_id`
- `token`: `bot_token`
- `base_url`: `baseurl`, falling back to `https://ilinkai.weixin.qq.com`
- `user_id`: `ilink_user_id`

### Common Headers

POST message APIs use:

```http
Content-Type: application/json
AuthorizationType: ilink_bot_token
Authorization: Bearer <bot_token>
X-WECHAT-UIN: <random uint32 decimal string encoded as base64>
iLink-App-Id: bot
iLink-App-ClientVersion: <encoded channel version>
```

`iLink-App-ClientVersion` is encoded as `(major << 16) | (minor << 8) | patch`. For `2.4.6`, that value is `132102`.

Optional:

```http
SKRouteTag: <route tag>
```

### Message APIs

All paths below are relative to the account `baseurl`.

Long-poll updates:

```http
POST /ilink/bot/getupdates
```

Body:

```json
{
  "get_updates_buf": "",
  "base_info": {
    "channel_version": "2.4.6",
    "bot_agent": "OctoBus/0.1.0"
  }
}
```

Send message:

```http
POST /ilink/bot/sendmessage
```

Body:

```json
{
  "msg": {
    "from_user_id": "",
    "to_user_id": "<peer@im.wechat>",
    "client_id": "<generated-id>",
    "message_type": 2,
    "message_state": 2,
    "item_list": [
      {
        "type": 1,
        "text_item": {
          "text": "hello"
        }
      }
    ],
    "context_token": "<optional>",
    "run_id": "<optional>"
  },
  "base_info": {
    "channel_version": "2.4.6",
    "bot_agent": "OctoBus/0.1.0"
  }
}
```

Other observed APIs:

- `POST /ilink/bot/getuploadurl`
- `POST /ilink/bot/getconfig`
- `POST /ilink/bot/sendtyping`
- `POST /ilink/bot/msg/notifystart`
- `POST /ilink/bot/msg/notifystop`

The first OctoBus implementation should only implement login, text send, and polling. Media upload, typing, and start/stop notifications can follow once the basic session is proven.

## Architecture

```text
OctoBus caller
  -> OctoBus gateway
  -> tencent-weixin-personal service
  -> iLink HTTP API
  -> operator-authorized personal Weixin account
```

The OctoBus service is a protocol adapter. It validates requests, builds iLink HTTP JSON payloads, maps upstream errors to gRPC statuses, and returns upstream diagnostic fields. The service owns QR login state, in-memory runtime credentials, long-poll cursors, and minimal token lifecycle.

## Service Package

Proposed package:

- root: `services/tencent__weixin-personal`
- service name: `tencent-weixin-personal`
- display name: `Tencent Weixin Personal`
- runtime mode: `long-running`
- proto file: `proto/tencent_weixin_personal.proto`
- implementation: JavaScript ES module using `@chaitin-ai/octobus-sdk`

## Configuration

Config fields:

- `loginBaseUrl`: login base URL, default `https://ilinkai.weixin.qq.com`.
- `baseUrl`: account API base URL, overridden by QR login confirmation at runtime.
- `timeoutMs`: upstream HTTP timeout, default `15000`.
- `longPollTimeoutMs`: long-poll receive timeout, default `35000`.
- `accountId`: optional default iLink account ID.
- `botAgent`: optional observability string sent in `base_info.bot_agent`, default `OctoBus/0.1.0`.
- `routeTag`: optional `SKRouteTag` header.
- `printQrCode`: print terminal QR code when login starts, default `true`.
- `autoStartLogin`: request and print a QR code on service startup, default `true`.
- `loginWaitTimeoutMs`: wait time for each startup QR login attempt, default `480000`.
- `autoLoginRetryMs`: delay before requesting a fresh startup QR code, default `3000`.
- `autoStartReceiverAfterLogin`: start long-poll receive after startup QR login succeeds, default `true`.
- `autoStartReceiver`: start receiver from configured token on service startup, default `false`.

Secret fields:

- `token`: bearer token returned by QR login.
- `baseUrl`: account API base URL returned by QR login.
- `accountId`: iLink account ID returned by QR login.

Startup QR login keeps account credentials in memory for the running service process. Operators may still store long-lived credentials in OctoBus instance secret bindings when that is appropriate; credentials are never written into the service package directory.

## RPC Surface

Initial RPCs:

```proto
service Tencent_WeixinPersonal {
  rpc StartLogin(StartLoginRequest) returns (StartLoginResponse) {}
  rpc WaitLogin(WaitLoginRequest) returns (WaitLoginResponse) {}
  rpc FetchUpdates(FetchUpdatesRequest) returns (FetchUpdatesResponse) {}
  rpc StartReceiver(StartReceiverRequest) returns (ReceiverStatus) {}
  rpc StopReceiver(StopReceiverRequest) returns (ReceiverStatus) {}
  rpc GetReceiverStatus(GetReceiverStatusRequest) returns (ReceiverStatus) {}
  rpc SendText(SendTextRequest) returns (SendTextResponse) {}
  rpc PollMessages(PollMessagesRequest) returns (PollMessagesResponse) {}
  rpc AckMessage(AckMessageRequest) returns (AckMessageResponse) {}
  rpc NormalizeMessage(NormalizeMessageRequest) returns (NormalizedMessage) {}
}
```

### StartLogin

Starts QR login by calling `get_bot_qrcode`.

Response fields:

- `session_key`
- `qrcode`
- `qrcode_url`
- `qrcode_terminal`
- `message`

### WaitLogin

Polls QR status until confirmed, expired, or timeout. On success, the service remembers the returned token, account ID, and base URL in memory so `SendText` and the receiver can use them immediately.

Response fields:

- `connected`
- `already_connected`
- `account_id`
- `user_id`
- `base_url`
- `token`
- `status`
- `message`

### SendText

Request fields:

- `to_user_id`: target peer identifier from a previous poll result or operator-provided mapping.
- `message`: required text content.
- `context_token`: optional conversation context token returned by iLink. Required by some reply flows.
- `account_id`: optional account override.

iLink request shape:

```json
{
  "msg": {
    "to_user_id": "<target>",
    "context_token": "<context>",
    "item_list": [
      {
        "type": 1,
        "text_item": {
          "text": "hello"
        }
      }
    ]
  }
}
```

Response fields:

- `ret`
- `errcode`
- `errmsg`
- `http_status_code`
- `http_body`

### FetchUpdates

Request fields:

- `cursor`: previous `get_updates_buf`, empty on first call.
- `account_id`: optional account override.
- `timeout_ms`: optional long-poll override.

iLink request shape:

```json
{
  "get_updates_buf": "<cursor>"
}
```

Response fields:

- `ret`
- `errcode`
- `errmsg`
- `cursor`: new `get_updates_buf`
- `longpolling_timeout_ms`
- `messages`: normalized message list
- `http_status_code`
- `http_body`

### PollMessages

`StartReceiver` runs `FetchUpdates` in a background long-poll loop and buffers normalized messages in memory. `PollMessages` returns buffered messages; `AckMessage` removes consumed messages.

Normalized message fields:

- `seq`
- `message_id`
- `from_user_id`
- `to_user_id`
- `session_id`
- `message_type`
- `message_state`
- `create_time_ms`
- `context_token`
- `text`
- `raw_json`

## Error Mapping

- Missing `baseUrl`, `token`, `to_user_id`, or `message`: `INVALID_ARGUMENT`
- HTTP 401 or 403 from iLink: `PERMISSION_DENIED`
- HTTP 4xx from iLink: `FAILED_PRECONDITION`
- HTTP 5xx, timeout, DNS, connection refused: `UNAVAILABLE`
- iLink response with non-zero `ret` or `errcode`: `FAILED_PRECONDITION`
- Invalid or unexpected JSON: `UNKNOWN`

Errors should include structured details in the message body, matching the existing group robot services:

- `code`
- `message`
- `http_status_code`
- `http_body`
- `ret`
- `errcode`
- `errmsg`
- `reason`

## State Model

The service should keep only minimal login session state:

- `FetchUpdates` uses caller-supplied cursors and returns the next cursor.
- `StartReceiver` keeps the active poll cursor and buffered messages in memory for the running process.
- Active QR login sessions are in memory with a short TTL.
- Confirmed account credentials are returned to the caller and also remembered in memory for immediate `SendText` and receiver use.
- Operators may store credentials as instance secret bindings if they want startup without QR login.
- Multi-account selection is passed through `account_id` or configured as `accountId`.

This keeps retry, failover, and audit behavior explicit.

## Security And Operations

- Treat personal Weixin traffic as operator-authorized account automation.
- Do not log message content by default. Log message length, peer ID hashes, HTTP status, and upstream error codes.
- Redact tokens and authorization headers.
- Document duplicate-send risk on retry after transport failures.
- Require users to operate within Weixin/iLink terms and their organization's policy.
- Prefer private network and local-only OctoBus access for operator-authorized account automation.

## Implementation Plan

1. Create `services/tencent__weixin-personal` using the existing JavaScript service package pattern.
2. Add `service.json`, `package.json`, `config.schema.json`, `secret.schema.json`, and executable bin entry.
3. Define `proto/tencent_weixin_personal.proto` with login, receiver, polling, ack, send, and normalization RPCs.
4. Implement iLink HTTP client helpers:
   - URL normalization
   - bearer auth headers
   - JSON request and response handling
   - error mapping
5. Add unit tests with a mock iLink upstream:
   - start login success
   - startup auto login
   - wait login confirmed
   - send success
   - fetch and receiver poll success
   - ack success
   - auth failure
   - business error
   - invalid JSON
   - network failure
6. Add README with setup steps:
   - service startup QR scan
   - configure OctoBus service
7. Run service validation and targeted npm tests.

## Later Extensions

- Media send support if iLink upload endpoints are confirmed.
- Typing indicator through `getConfig` and `sendTyping`.
- A streaming RPC if OctoBus service runtime supports long-lived server streams for inbound messages.
- Peer alias mapping so users can avoid raw Weixin peer IDs in callers.

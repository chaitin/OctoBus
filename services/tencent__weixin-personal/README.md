# Tencent Weixin Personal OctoBus Service

OctoBus service package for personal Weixin chat messages through Tencent iLink Bot API.

This package does not require OpenClaw or Hermes at runtime. Those projects are used only as protocol references for the iLink QR login, long-poll receive, and send-message APIs.

## Import

```bash
octobus service import --id tencent-weixin-personal ./services/tencent__weixin-personal
```

## Supported Flow

1. Start the service instance.
2. The service prints an iLink QR code in its terminal by default.
3. Scan the terminal QR code with Weixin and confirm on the phone.
4. The service stores the returned runtime token in memory and starts the receiver.
5. Use `PollMessages` and `AckMessage` to consume inbound messages.
6. Use `SendText` to send text messages.

Manual login is still available through `StartLogin` and `WaitLogin`. `WaitLogin` also stores the returned runtime token in memory, so `SendText` and `StartReceiver` can use it immediately in the same service process.

## Configuration

Example config:

```json
{
  "loginBaseUrl": "https://ilinkai.weixin.qq.com",
  "baseUrl": "https://ilinkai.weixin.qq.com",
  "accountId": "xxxx@im.bot",
  "longPollTimeoutMs": 35000,
  "timeoutMs": 15000,
  "botAgent": "OctoBus/0.1.0",
  "printQrCode": true,
  "autoStartLogin": true,
  "loginWaitTimeoutMs": 480000,
  "autoLoginRetryMs": 3000,
  "autoStartReceiverAfterLogin": true,
  "maxBufferedMessages": 1000,
  "autoStartReceiver": false
}
```

Example secret:

```json
{
  "token": "bot-token-from-qr-login",
  "baseUrl": "https://ilinkai.weixin.qq.com",
  "accountId": "xxxx@im.bot"
}
```

## RPC Methods

- `Tencent_WeixinPersonal.Tencent_WeixinPersonal/StartLogin`
- `Tencent_WeixinPersonal.Tencent_WeixinPersonal/WaitLogin`
- `Tencent_WeixinPersonal.Tencent_WeixinPersonal/FetchUpdates`
- `Tencent_WeixinPersonal.Tencent_WeixinPersonal/StartReceiver`
- `Tencent_WeixinPersonal.Tencent_WeixinPersonal/StopReceiver`
- `Tencent_WeixinPersonal.Tencent_WeixinPersonal/GetReceiverStatus`
- `Tencent_WeixinPersonal.Tencent_WeixinPersonal/PollMessages`
- `Tencent_WeixinPersonal.Tencent_WeixinPersonal/AckMessage`
- `Tencent_WeixinPersonal.Tencent_WeixinPersonal/SendText`
- `Tencent_WeixinPersonal.Tencent_WeixinPersonal/NormalizeMessage`

## Receive Semantics

## QR Code Display

When the runtime starts in `serve` or `dev` mode, `autoStartLogin` defaults to `true`. The service requests a QR code, prints it to stdout, waits for phone confirmation in the background, and then starts the receiver. If a token is already configured in the instance secret, startup skips QR login unless `autoStartLogin` is explicitly set to `true`.

`StartLogin` returns both `qrcode_url` and `qrcode_terminal`. It also prints a terminal QR code to stdout when `printQrCode` is `true`.

`StartReceiver` starts a background long-poll loop over `ilink/bot/getupdates`. Received messages are normalized and buffered in memory. Callers use `PollMessages` to read messages and `AckMessage` to remove them.

`FetchUpdates` performs a single long-poll request and returns the new cursor. It is useful for stateless callers and debugging.

## Send Semantics

`SendText` sends one text message to `to_user_id` through `ilink/bot/sendmessage`. If the message is a reply to a received message, pass that received message's `context_token`.

Retries can create duplicate messages if the upstream accepted the request but the network failed before the response arrived.

## Limitations

- The integration targets iLink bot identities, not a fully scriptable ordinary personal Weixin account.
- Direct messages are the reliable first target. Ordinary group delivery depends on what iLink returns for the account type.
- Media upload/download, typing indicators, and encrypted CDN support are not implemented in this first version.
- iLink is not documented like a public OpenAPI product; compatibility should be checked when Tencent changes the reference clients.

## Local Checks

```bash
cd services
npm run validate -- --service-dir tencent__weixin-personal
npm test -- --service-dir tencent__weixin-personal --coverage
npm run pack:check
```

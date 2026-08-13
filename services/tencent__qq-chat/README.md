# Tencent QQ Chat

This OctoBus service connects to QQ chat through QQ Bot OpenAPI v2.

It covers the stable HTTP OpenAPI side:

- fetch `AccessToken` from `https://bots.qq.com/app/getAppAccessToken`
- send C2C messages with `/v2/users/{openid}/messages`
- send group messages with `/v2/groups/{group_openid}/messages`
- keep a long-running WebSocket Gateway receive loop for C2C/group message events
- buffer incoming messages in memory for `PollMessages`
- normalize incoming webhook/websocket payloads for C2C, group, and channel message events

The Gateway receiver subscribes to `GROUP_AND_C2C_EVENT` by default (`1 << 25`), which covers `C2C_MESSAGE_CREATE` and `GROUP_AT_MESSAGE_CREATE`.

## Configuration

```json
{
  "baseUrl": "https://api.sgroup.qq.com",
  "tokenUrl": "https://bots.qq.com/app/getAppAccessToken",
  "timeoutMs": 5000,
  "autoStartGateway": true,
  "gatewayIntents": 33554432,
  "maxBufferedMessages": 1000,
  "gatewayReconnectMs": 5000
}
```

Secrets:

```json
{
  "appId": "APPID",
  "appSecret": "APPSECRET"
}
```

You may provide a pre-fetched `accessToken` instead of `appId` and `appSecret`.

## Methods

- `GetAccessToken`: fetches or returns the configured access token.
- `StartGateway`: starts the QQ Bot WebSocket Gateway receive loop.
- `StopGateway`: stops the Gateway receive loop.
- `GetGatewayStatus`: returns Gateway connection state and buffered message counts.
- `PollMessages`: returns buffered received message events. Set `ack` to remove returned messages immediately.
- `AckMessage`: removes buffered messages by `local_id`, or all messages when `all` is true.
- `SendC2CMessage`: sends a QQ single-chat message to `openid`.
- `SendGroupMessage`: sends a QQ group message to `group_openid`.
- `NormalizeEvent`: parses official QQ Bot payload JSON and returns a stable message shape.

For text messages, leave `msg_type` as `0` and pass `content`. For markdown, ark, keyboard, media, or message reference fields, pass the corresponding `*_json` field as a JSON object string.

## Receiving messages

For production instances, set `autoStartGateway` to `true` so OctoBus starts the receive loop together with the long-running service process. You can also call `StartGateway` manually after instance start.

Incoming C2C and group-at messages are stored in an in-memory queue:

```json
{
  "max_messages": 10,
  "ack": false
}
```

Call `PollMessages` to read messages, then call `AckMessage` with the returned `local_id` values after they are handled. The queue is process-local; restarting the service clears unacknowledged buffered messages.

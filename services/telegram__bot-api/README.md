# Telegram Bot API

OctoBus service package for Telegram Bot API notification. It validates a bot token with `getMe` and sends text messages with `sendMessage`.

## Support

- Product: Telegram Bot API
- Methods: `getMe`, `sendMessage`
- Authentication: Bot token issued by BotFather, placed in `secret.bot_token`
- Official API reference: `https://core.telegram.org/bots/api#getme`, `https://core.telegram.org/bots/api#sendmessage`

## Configuration

`config.schema.json` stores non-sensitive options:

```json
{
  "base_url": "https://api.telegram.org",
  "chat_id": "123456",
  "parse_mode": "HTML",
  "disable_web_page_preview": true,
  "timeoutMs": 5000
}
```

`secret.schema.json` stores the sensitive bot token:

```json
{
  "bot_token": "123456:REDACTED"
}
```

## Methods

### GetMe

Validates the configured bot token.

```json
{}
```

### SendMessage

Sends a text message to the request `chat_id`, or to the default `config.chat_id` when omitted.

```json
{
  "chat_id": "123456",
  "text": "OctoBus Telegram adapter test",
  "parse_mode": "HTML",
  "disable_web_page_preview": true,
  "disable_notification": false
}
```

The response exposes the upstream HTTP status, raw body, parsed JSON body, and Telegram `ok` flag.

## Risk Boundary

- `GetMe` is read-only and only validates the bot token.
- `SendMessage` is a write operation because it sends a message to a real chat, group, or channel.
- Test with a dedicated bot and a dedicated chat ID.
- Do not commit bot tokens, chat IDs tied to production groups, user names, message contents containing business data, or production screenshots.
- Telegram `sendMessage` has no delete rollback in this service. If a test message must be removed, delete it manually in Telegram or extend the service with `deleteMessage`.

## Suggested Capset

- `notify.telegram`
- `notification.send`
- `bot.telegram`

## Verification

```bash
cd services
npm run validate -- --service-dir telegram__bot-api
npm test -- --service-dir telegram__bot-api
npm run pack:check
```

For real-device evidence, use a test bot and a test chat:

```bash
curl -sS -X POST "https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage" \
  -H "Content-Type: application/json" \
  -d "{\"chat_id\":\"${TG_CHAT_ID}\",\"text\":\"OctoBus Telegram adapter test\"}"
```

Redact `TG_BOT_TOKEN`, `TG_CHAT_ID`, user names, and group names before posting the PR evidence. Keep the HTTP method, request path, status code, and response structure visible.

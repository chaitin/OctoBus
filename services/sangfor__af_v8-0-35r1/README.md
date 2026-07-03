# Sangfor AF 8.0.35R1

OctoBus service adapter for Sangfor AF 8.0.35R1 black/white list entries.

## Supported capabilities

This first version supports the unified Sangfor AF black/white list API:

- `ListWhiteBlackListEntries` — list blacklist or whitelist entries
- `GetWhiteBlackListEntry` — get one entry
- `CreateWhiteBlackListEntry` — create one entry
- `DeleteWhiteBlackListEntry` — delete one entry

Blacklist and whitelist are selected with `type`:

- `BLACK` — blacklist
- `WHITE` — whitelist

Batch create, batch delete, update, batch update, and clear-all custom entries are intentionally not included in this first version.

## Authentication

The adapter logs in with username/password:

```text
POST /api/v1/namespaces/{namespace}/login
```

Sangfor AF returns `data.loginResult.token`. Business requests send the token as:

```text
Cookie: token=<token>
```

Tokens, passwords, and cookies must not be committed or included in PR evidence.

## Config

```json
{
  "host": "https://af.example.test",
  "namespace": "public",
  "timeoutMs": 10000,
  "skipTlsVerify": false
}
```

- `host`: direct Sangfor AF base URL. The formal target is direct device access, not an external proxy.
- `namespace`: Sangfor AF API namespace. Defaults to `public`.
- `timeoutMs`: upstream timeout in milliseconds.
- `skipTlsVerify`: set to `true` only for controlled test devices with self-signed certificates.

## Secret

```json
{
  "username": "<af-username>",
  "password": "<af-password>"
}
```

## Example requests

List whitelist entries:

```json
{
  "type": "WHITE",
  "start": 0,
  "length": 100
}
```

List blacklist entries:

```json
{
  "type": "BLACK",
  "start": 0,
  "length": 100
}
```

Create a controlled blacklist test entry:

```json
{
  "url": "198.51.100.203",
  "type": "BLACK",
  "enable": true,
  "description": "octobus-test-delete-me"
}
```

Delete the controlled test entry:

```json
{
  "url": "198.51.100.203",
  "type": "BLACK"
}
```

## Risk boundary

Risk classification: `writable`.

This adapter can create and delete single black/white list entries. It does not expose batch operations or clear-all operations. For write validation, use a dedicated test object and delete it after verification.

Create defaults:

- `enable`: defaults to `true`
- `type`: required, `BLACK` or `WHITE`
- rollback path: call `DeleteWhiteBlackListEntry` with the same `url` and `type`

## Suggested capset

Default operational capset:

- `ListWhiteBlackListEntries`
- `GetWhiteBlackListEntry`

Controlled operation capset:

- add `CreateWhiteBlackListEntry`
- add `DeleteWhiteBlackListEntry`

Only expose write methods to agents that are allowed to change AF black/white list entries.

## Validation

Local checks:

```bash
cd services
npm run validate -- --service-dir sangfor__af_v8-0-35r1
npm test -- --service-dir sangfor__af_v8-0-35r1
npm run pack:check
```

Live validation performed during development through an approved test path confirmed:

- login returned AF `code: 0`
- whitelist list returned AF `code: 0` and 28 entries
- blacklist list returned AF `code: 0` and 0 entries

The proxy cookie used for the development test path is not part of this adapter design. Production usage should configure `host` as a direct Sangfor AF device base URL.

## Known limitations

- Only Sangfor AF 8.0.35R1 black/white list entry APIs are covered.
- Batch operations and clear-all operations are intentionally omitted.
- The adapter returns Sangfor AF business fields useful to operators and does not expose the raw upstream response body.

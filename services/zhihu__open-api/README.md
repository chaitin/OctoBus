# Zhihu OctoBus Service

This package wraps the public [Zhihu Open Platform](https://developer.zhihu.com/docs) APIs — in-site and global search,
the Zhihu hot list, question recommendations and answers, knowledge base (RAG) retrieval and upload, and user data (contents, followees, collections, and
favorites) — behind a single OctoBus service. Method-level capsets can expose search, hot list, question discovery, knowledge base, and
user data independently.

Service name: `zhihu-open-api`

Import it into OctoBus with:

```bash
octobus service import --id zhihu-open-api ./services/zhihu__open-api
```

## Package Files

- `service.json`: OctoBus service manifest.
- `proto/zhihu_open_api.proto`: gRPC API definition.
- `config.schema.json`: base URL, timeout, TLS, and extra header settings.
- `secret.schema.json`: required Access Secret and optional OAuth token.
- `src/zhihu-open-api.js`: Zhihu Open Platform implementation.
- `src/service.js`: OctoBus SDK `defineService` wrapper.
- `bin/zhihu-open-api.js`: service-local executable entrypoint.
- `test/zhihu-open-api.test.js`: node:test coverage for validation, request mapping, HTTP behavior, network errors, and SDK handler invocation.
- `test/mock_upstream.js`: optional local Zhihu Open Platform mock.
- `test/smoke.json`: end-to-end smoke fixture.

## Configuration

Use config for non-sensitive request behavior:

```json
{
  "baseUrl": "https://developer.zhihu.com",
  "timeoutMs": 10000,
  "headers": {
    "X-Custom": "value"
  },
  "skipTlsVerify": false
}
```

`baseUrl` accepts both HTTPS and HTTP (HTTP is intended for a controlled local mock only). `skipTlsVerify`,
`tlsInsecureSkipVerify`, and `insecureSkipVerify` skip TLS verification for private testing.

## Secret

Use `accessSecret` for the Zhihu Open Platform Access Secret, created in the platform personal center. The deprecated
alias `access_secret` is still accepted.

```json
{
  "accessSecret": "replace-me"
}
```

User data methods accept an optional `oauthToken` (alias `oauth_token`) in the Instance secret. When provided it is sent
as `X-OAuth-Token` to query that authorized user's data; when omitted the methods query the Access Secret owner's own
data. A per-request `oauth_token` field takes precedence over the secret.

```json
{
  "accessSecret": "replace-me",
  "oauthToken": "optional-oauth-token"
}
```

## Authentication

Every request sets:

- `Authorization: Bearer <access_secret>`
- `X-Request-Timestamp`: second-level Unix timestamp
- `Content-Type: application/json` (multipart is used only for file upload)

The service never returns or logs the Access Secret or OAuth token.

## RPC Methods

All data methods return the upstream Zhihu `Data` object in the structured `JsonResponse.data` field.

| Method | URL | Description |
|--------|-----|-------------|
| `CheckConnectivity` | `GET /api/v1/content/hot_list?Limit=1` | Verify credentials and report reachability. |
| `GetQuota` | `GET /api/v1/quota` | Daily free quota remaining for each Zhihu capability; does not consume quota. |
| `ZhihuSearch` | `GET /api/v1/content/zhihu_search` | Search within Zhihu (questions, answers, articles). |
| `GlobalSearch` | `GET /api/v1/content/global_search` | Search the whole web with optional filter expression. |
| `GetHotList` | `GET /api/v1/content/hot_list` | Current Zhihu hot list. |
| `GetQuestionRecommendations` | `GET /api/v1/user/question_recommendations` | Questions recommended for the caller, by profile (no `query`) or by topic (`query`). |
| `GetQuestionAnswers` | `GET /api/v1/content/question_answers` | Answer summaries for one question (by its full Zhihu URL). |
| `ListKnowledgeBases` | `GET /api/v1/knowledge/bases` | Knowledge bases created or subscribed by the user. |
| `ListKnowledgeBaseItems` | `GET /api/v1/knowledge/bases/{id}/items` | Page through a knowledge base's contents. |
| `UploadKnowledgeFile` | `POST /api/v1/knowledge/files` | Upload a file (multipart) and mount it after parsing. |
| `SearchKnowledge` | `POST /api/v1/knowledge/search` | RAG retrieval over knowledge bases or recall scopes. |
| `GetUserContents` | `GET /api/v1/user/contents` | A user's created content. |
| `GetUserFollowees` | `GET /api/v1/user/followees` | A user's followees. |
| `GetUserCollections` | `GET /api/v1/user/collections` | A user's recent collections. |
| `GetUserFavlists` | `GET /api/v1/user/favlists` | A user's public favorites lists. |
| `GetFavlistContents` | `GET /api/v1/user/favlist_contents` | Public contents inside a favorites list. |

Request fields:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `query` | string | Yes for search; optional for question recommendations | Search keyword (trimmed and non-empty). For `GetQuestionRecommendations`: topic keyword — empty/omitted → recommend from the caller's profile, non-empty → topic mode. |
| `count` | int32 | No | Search result count; clamped to 1–10 (`ZhihuSearch`) or 1–20 (`GlobalSearch`), default 10. For `GetQuestionRecommendations`: clamped to 1–20, default 5. |
| `filter` | string | No | Global search filter expression, e.g. `host=="example.com" AND publish_time>=1778494631`. |
| `search_db` | string | No | `all`, `realtime`, or `static`; default `all`. |
| `question_url` | string | Yes for question answers | Full Zhihu question URL (e.g. from `GetQuestionRecommendations`). |
| `limit` | int32 | No | Page size; clamped to 1–30 (hot list), 1–20 (knowledge items, default 20), 1–10 (knowledge search, default 10), 1–50 (question answers, default 20), or 1–50 (user data, default 20). |
| `scope` | string | No | `all`, `created`, or `subscribed`; default `all`. |
| `cursor` | string | No | Opaque cursor for knowledge base items pagination. |
| `knowledge_base_id` | string | Yes for knowledge items | Target knowledge base ID. |
| `knowledge_base_ids` | repeated string | Conditionally required | Knowledge base IDs for RAG retrieval; at least one of this or `recall_scopes` is required. |
| `recall_scopes` | repeated string | Conditionally required | `personal`, `subscription`, or `public`. |
| `file_name` | string | Yes for upload | File name, max 255 bytes. |
| `file_content` | bytes | Yes for upload | Base64-encoded file content, max 100 MB. |
| `content_type` | string | Yes for user contents | `all`, `answer`, `article`, `zvideo`, `pin`, or `question`. |
| `offset` | int64 | No | Pagination offset, default 0. Also used by `GetQuestionAnswers`. |
| `sort_field` / `sort_order` | string | No | `like_count` or `ts`; `asc` or `desc`; defaults `ts` / `desc`. |
| `favlist_url_token` | string | Yes for favlist contents | Favorites list URL token from `GetUserFavlists`. |
| `oauth_token` | string | No | Per-request OAuth token override for user data methods. |
| `api_ids` | string | No | Comma-separated quota API IDs for `GetQuota`; omit to return all. Valid ids: `global_search`, `zhihu_search`, `hot_list`, `question_discovery`, `user_data`, `zhida_openai`, `knowledge`, `tools`. |

Runtime handler example:

```js
import { handlers } from './src/zhihu-open-api.js';

await handlers['Zhihu_Open_Api.Zhihu_Open_Api/GetHotList']({
  secret: { accessSecret: 'replace-me' },
  config: { timeoutMs: 10000 },
  request: { limit: 10 }
});
```

On the wire (Connect/gRPC/CLI) multi-word fields use the protobuf JSON
camelCase form, e.g. `contentType`, `knowledgeBaseId`, `searchDb`, and
`favlistUrlToken`. The handlers also accept the snake_case proto names and the
camelCase form interchangeably.

## Behavior Notes

- Zhihu business errors are mapped to gRPC errors: `20001` → `UNAUTHENTICATED`, `30001`/`30002` → `RESOURCE_EXHAUSTED`,
  `40004` → `NOT_FOUND`, `40005`/`40006` → `FAILED_PRECONDITION`, `50002` → `UNAVAILABLE`, `10001` → `INVALID_ARGUMENT`,
  `90001` → `UNAVAILABLE`. HTTP 401/403/404/429 map to `UNAUTHENTICATED`/`PERMISSION_DENIED`/`NOT_FOUND`/`RESOURCE_EXHAUSTED`;
  other 4xx map to `INVALID_ARGUMENT`, and 5xx map to `UNAVAILABLE`.
- `GetQuota` returns the upstream quota `Data` **array** in `JsonListResponse.data` (each item has `APIID`,
  `APIName`, `TotalQuota`, `TotalUsed`, `RemainingQuota`). The other data methods return an object.
- Timeouts map to `DEADLINE_EXCEEDED`; network failures map to `UNAVAILABLE`. Upload is a synchronous mutation: network
  failures and 5xx responses are marked `ambiguous` and never automatically retried.
- Out-of-range `count`/`limit` values are clamped to the documented server defaults instead of being rejected, matching
  the upstream behavior.
- `CheckConnectivity` and the data methods never leak the Access Secret or OAuth token into messages or logs.

## Limitations

- Raw upstream bodies are never returned; only the parsed `Data` object is exposed.
- Knowledge base retrieval, search, and upload require the user to have initialized the Zhida knowledge base
  (https://zhida.zhihu.com/repositories/square).
- Querying another user's data requires their Zhihu OAuth authorization; this package forwards the OAuth token but does
  not perform the OAuth flow itself.

## Local Checks

```bash
cd services
npm run validate -- --service-dir zhihu__open-api
npm test -- --service-dir zhihu__open-api
npm test -- --coverage --service-dir zhihu__open-api
npm run pack:check
cd ..
task build
node scripts/service-package-smoke.mjs --service-dir zhihu__open-api
task lint
```

## Official API references

- [鉴权 (Bearer authorization)](https://developer.zhihu.com/docs)
- [知乎搜索 API](https://developer.zhihu.com/docs)
- [全网搜索 API](https://developer.zhihu.com/docs)
- [知乎热榜 API](https://developer.zhihu.com/docs)
- [知识库列表 / 内容列表 / 文件上传 / 检索 API](https://developer.zhihu.com/docs)
- [用户内容 / 关注 / 收藏 / 收藏夹 API](https://developer.zhihu.com/docs)
- [知乎 OAuth 应用集成](https://developer.zhihu.com/docs)

The Zhihu application must be granted only the scopes required by the selected methods. Search, hot list, and knowledge
base APIs require a platform Access Secret; querying another user's data additionally requires that user's Zhihu OAuth
authorization.

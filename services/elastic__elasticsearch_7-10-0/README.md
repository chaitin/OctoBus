# Elasticsearch 7.10.0

OctoBus service package for Elasticsearch 7.10.0 read-only cluster operations.

This package covers a subset of the official Elasticsearch 7.10 REST API
([reference](https://www.elastic.co/guide/en/elasticsearch/reference/7.10/rest-apis.html)).

## Import

Service root: `services/elastic__elasticsearch_7-10-0`.

```bash
octobus service import --id elasticsearch-7-10-0 ./services/elastic__elasticsearch_7-10-0
```

## Package Layout

- `service.json`: OctoBus service package manifest.
- `proto/elasticsearch_7_10_0.proto`: gRPC API surface.
- `src/elasticsearch-7-10-0.js`: Runtime handlers, Basic Auth, request building, response parsing, error mapping.
- `config.schema.json`: Non-secret binding schema.
- `secret.schema.json`: Username / password schema for HTTP Basic Auth.
- `test/`: Node test coverage and mock upstream.

## Bindings

Configuration:

- `baseUrl`: Elasticsearch base URL, e.g. `https://es.example.com:9200`.
- `elasticsearch_domain`, `restBaseUrl`, `domain`, `url`: aliases for `baseUrl`.
- `timeoutMs`: optional request timeout in milliseconds, default `5000`.
- `skipTlsVerify`, `tlsInsecureSkipVerify`, `insecureSkipVerify`: optional TLS verification skip aliases.

Secrets (HTTP Basic Auth):

- `username`: Elasticsearch username.
- `elasticsearch_username`, `user`: aliases for `username`.
- `password`: Elasticsearch password.
- `elasticsearch_password`, `passwd`: aliases for `password`.

## RPC Methods

- `Elasticsearch_7_10_0.Elasticsearch_7_10_0/ClusterHealth`
- `Elasticsearch_7_10_0.Elasticsearch_7_10_0/ListIndices`
- `Elasticsearch_7_10_0.Elasticsearch_7_10_0/GetIndex`
- `Elasticsearch_7_10_0.Elasticsearch_7_10_0/SearchDocuments`
- `Elasticsearch_7_10_0.Elasticsearch_7_10_0/ListNodes`

## Behavior

- Authentication uses `Authorization: Basic base64(username:password)`.
- `ClusterHealth` issues `GET {baseUrl}/_cluster/health` (with optional `level`, `timeout`, `wait_for_status`).
- `ListIndices` issues `GET {baseUrl}/_cat/indices?format=json` (optional `index` filter).
- `GetIndex` issues `GET {baseUrl}/{index}`.
- `SearchDocuments` issues `POST {baseUrl}/{index}/_search` with a JSON body of `{query, from, size}` (query may be a JSON string or object).
- `ListNodes` issues `GET {baseUrl}/_cat/nodes?format=json` (optional `bytes`).

Error mapping follows the project convention:

- HTTP `401` / `403` -> `PERMISSION_DENIED`.
- Other HTTP `4xx` -> `FAILED_PRECONDITION`.
- HTTP `5xx`, network errors, response read errors -> `UNAVAILABLE`.
- Empty / non-JSON responses -> `UNKNOWN`.

## Validation

```bash
cd services
npm run validate -- --service-dir elastic__elasticsearch_7-10-0
npm test -- --service-dir elastic__elasticsearch_7-10-0 --coverage
npm run pack:check
```
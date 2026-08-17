# Elasticsearch 7.10.0 integration evidence

This service was exercised against the official, unmodified Elasticsearch
7.10.0 Docker image, not the test mock.

## Reproduction

```sh
docker pull docker.elastic.co/elasticsearch/elasticsearch:7.10.0
docker run --rm -p 127.0.0.1:19200:9200 \
  -e discovery.type=single-node \
  -e xpack.security.enabled=false \
  -e ES_JAVA_OPTS='-Xms512m -Xmx512m' \
  docker.elastic.co/elasticsearch/elasticsearch:7.10.0
```

The root endpoint reported version `7.10.0`, build hash
`51e9d6f22758d0374a0f3f5c6e8f3a7997850f96`, and Lucene `8.7.0`.
An `octobus-evidence` index was created with `message` (text) and `severity`
(keyword) fields, then one document was indexed and refreshed.

The five service handlers were invoked with `baseUrl` set to
`http://127.0.0.1:19200`. The container disabled X-Pack security so that the
test is self-contained; the service still emitted its required Basic Auth
header, which Elasticsearch ignored in this configuration. Production Basic
Auth enforcement therefore remains covered by the mock/error tests rather
than this live compatibility run.

## Sanitized results

- `ClusterHealth`: HTTP 200; cluster `docker-cluster`, one node, one data node.
- `ListIndices`: HTTP 200; returned `octobus-evidence`, open, one document.
- `GetIndex`: HTTP 200; returned both declared mappings and index settings
  whose `version.created` was `7100099`.
- `SearchDocuments`: HTTP 200; defaulted an omitted proto3 `size` to 10 and
  returned the indexed document with `total_hits=1`.
- `ListNodes`: HTTP 200; returned the single Docker node and its node roles.

Run date: 2026-08-17. Host/container addresses, generated UUIDs, resource
metrics, and credentials are intentionally omitted because they are not
compatibility facts.

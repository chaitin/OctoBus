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

A second live run created `octobus-evidence-1` and `octobus-evidence-2` and
verified the expression edge cases directly against 7.10.0:

- `GetIndex(index="octobus-evidence-*")` returned mappings for both concrete
  indices rather than looking up the wildcard as a literal response key.
- `SearchDocuments(index="octobus-evidence-*", size=0)` reported
  `total_hits=2` with an empty `hits` array, preserving Elasticsearch's valid
  count-only/aggregation semantics. Omitting the optional `size` still uses 10.

The transport smoke additionally sends the omitted-size case through the
OctoBus Connect endpoint and the explicit-zero case through a real framed gRPC
request serialized from this package's proto descriptor. The mock upstream
asserts that the resulting Elasticsearch request bodies contain `size: 10`
and `size: 0`, respectively; this covers presence preservation beyond direct
JavaScript handler calls.

`_all` remains a literal index expression. Elasticsearch date-math expressions
are encoded per its URI requirement (for example `<logs-{now/d-1d}>` becomes
`%3Clogs-%7Bnow%2Fd-1d%7D%3E`), while comma separators remain literal. These
forms therefore do not require narrowing the GetIndex/SearchDocuments contract.

Run date: 2026-08-17. Host/container addresses, generated UUIDs, resource
metrics, and credentials are intentionally omitted because they are not
compatibility facts.

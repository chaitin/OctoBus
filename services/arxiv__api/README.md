# arXiv API Service Package

OctoBus package for the public [arXiv API](https://info.arxiv.org/help/api/) — search and
metadata lookup for the arXiv e-print repository (physics, math, computer science, and more).

It runs as a **long-running** instance that wraps the Atom 1.0 query endpoint at
`https://export.arxiv.org/api/query` and exposes a small, agent/tool-friendly, unary gRPC
surface. No API key or signup is required. A single process serializes all upstream requests
and spaces them at least three seconds apart to comply with the
[arXiv API Terms of Use](https://info.arxiv.org/help/api/tou.html).

## Features

- **Search e-prints** with the full arXiv query syntax (field prefixes such as `ti:`, `au:`,
  `abs:`, `cat:`, `all:`; Boolean `AND` / `OR` / `ANDNOT`; parentheses; phrases).
- **Fetch papers by arXiv id** (new `YYYYMM.NNNNN` and legacy `archive/YYMMNNNNN` formats,
  with optional version suffix such as `v2`).
- **Paging** through large result sets with `start` / `max_results`.
- **Result sorting** by relevance, last updated date, or submitted date, ascending or descending.
- Full **paper metadata**: title, abstract, authors (with affiliations), categories, primary
  category, comment, journal reference, DOI, and abstract/PDF/DOI links.
- Errors are mapped to standard gRPC statuses and network/internal details are not leaked.

## Methods

| RPC | HTTP/API | Description |
|-----|----------|-------------|
| `SearchPapers` | `query?search_query=...&start=...&max_results=...&sortBy=...&sortOrder=...` | Full-text arXiv search with paging and sorting |
| `GetPaper` | `query?id_list=<id>` | Fetch one paper by arXiv id (`NOT_FOUND` if unknown). Bare id fetches the latest version; a versioned id (e.g. `0710.5765v2`) fetches that exact version |
| `ListPapers` | `query?id_list=<id1,id2,...>` | Fetch several papers and report which requested ids could not be found (respecting arXiv version semantics) |

The underlying arXiv API supports more advanced use (e.g. `id_list` filters combined with a
search, or OAI-PMH bulk harvesting). Only the operations above are exposed to keep the agent
surface small; the arXiv server still validates query syntax and returns structured errors.

## Configuration

No credentials are required — `secret.schema.json` is empty.

| Config field | Default | Description |
|--------------|---------|-------------|
| `baseUrl` | `https://export.arxiv.org` | API base URL. Override only for compatible gateways or testing. |
| `timeoutMs` | `60000` | Request-scoped upstream HTTP timeout in ms (range 1000–300000). |
| `userAgent` | `octobus-arxiv-api/0.1 (https://arxiv.org/help/api)` | `User-Agent` header sent to the API. |

## arXiv Terms of Use compliance

The arXiv API Terms of Use limit the legacy arXiv API (and OAI-PMH/RSS) to **no more than one
request every three seconds and a single connection at a time, across all machines under your
control**. This package enforces that guarantee inside a single running instance:

- every upstream request is serialized through an in-process queue, so only one request is in
  flight at a time;
- consecutive requests are spaced at least 3 seconds apart by default.

Because the queue is process-local, you must run **a single instance** when pointing at the
public arXiv endpoint. Multiple instances (or multiple machines) would each maintain their own
queue and would not be coordinated with each other; the Terms of Use limit applies to your use
of arXiv as a whole. If your use case needs a higher rate, arXiv asks you to contact their
support team rather than scale out.

The request gate is **bounded** so a burst of concurrent calls cannot create an unbounded
backlog or let stale requests keep consuming arXiv's shared quota after their clients have
given up:

- admission is limited to 8 pending requests (active + queued) per instance; calls beyond that
  fail fast with `RESOURCE_EXHAUSTED`;
- a request that is still waiting in the queue after 30 seconds is abandoned (`UNAVAILABLE`)
  and removed without ever calling arXiv.

These bounds are conservative service-internal safety limits, not tunable through instance
config, and are only relaxed inside the unit tests against the local mock.

Notes on limits (from the [user manual](https://info.arxiv.org/help/api/user-manual.html)):

- arXiv documents `max_results` up to 30000 in slices of at most 2000. This service keeps its
  own conservative cap: `maxResults` accepts `1..2000` (0 means "not provided" → default 10)
  and returns `INVALID_ARGUMENT` outside that range. 2000 is the service-side cap, not an
  official arXiv cap.
- `ListPapers` bounds its input to at most 2000 ids, each at most 128 characters, with the
  combined `id_list` at most 20000 characters, to keep the upstream GET URL bounded.
- arXiv recommends refining queries that return more than ~1000 results and caching results,
  because search indexes only update on a daily submission cycle.

## Usage

```bash
# Create a long-running instance (no secrets needed)
octobus instance create arxiv-test --service arxiv-api

# Add it to a capset
octobus capset create research --name Research
octobus capset add-instance research arxiv-test

# Search arXiv
curl -X POST \
  'http://127.0.0.1:9000/capsets/research/connect/arxiv-test/arxiv.v1.ArxivService/SearchPapers' \
  -H 'Content-Type: application/json' \
  -d '{"searchQuery":"au:del_maestro AND ti:checkerboard","maxResults":5}'

# Fetch a single paper by id
curl -X POST \
  'http://127.0.0.1:9000/capsets/research/connect/arxiv-test/arxiv.v1.ArxivService/GetPaper' \
  -H 'Content-Type: application/json' \
  -d '{"id":"0710.5765v2"}'
```

## Local Development

```bash
npm install
npm test                          # unit tests against an in-process mock arXiv server
npx octobus-sdk validate --strict # validates proto + handlers
npx octobus-sdk inspect --yaml
npm pack --dry-run                # confirm package contents
```

References:

- [arXiv API Basics](https://info.arxiv.org/help/api/basics.html)
- [arXiv API User's Manual](https://info.arxiv.org/help/api/user-manual.html)

# arXiv API Service Package

OctoBus package for the public [arXiv API](https://info.arxiv.org/help/api/) — search and
metadata lookup for the arXiv e-print repository (physics, math, computer science, and more).

The package wraps the Atom 1.0 query endpoint at `https://export.arxiv.org/api/query` and
exposes a small, agent/tool-friendly, unary gRPC surface. No API key or signup is required.

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
| `GetPaper` | `query?id_list=<id>` | Fetch one paper by arXiv id (`NOT_FOUND` if unknown) |
| `ListPapers` | `query?id_list=<id1,id2,...>` | Fetch several papers and report any missing ids |

The underlying arXiv API supports more advanced use (e.g. `id_list` filters combined with a
search, or OAI-PMH bulk harvesting). Only the operations above are exposed to keep the agent
surface small; the arXiv server still validates query syntax and returns structured errors.

## Configuration

No credentials are required — `secret.schema.json` is empty.

| Config field | Default | Description |
|--------------|---------|-------------|
| `baseUrl` | `https://export.arxiv.org` | API base URL. Override only for compatible gateways or testing. |
| `timeoutMs` | `30000` | HTTP request timeout in milliseconds. |
| `userAgent` | `octobus-arxiv-api/0.1 (https://arxiv.org/help/api)` | `User-Agent` header sent to the API. |

Notes on limits (from the [user manual](https://info.arxiv.org/help/api/user-manual.html)):

- `max_results` is clamped to `[1, 2000]` (arXiv serves results in slices of at most 2000 and
  returns errors for oversized requests); the default is 10.
- arXiv recommends refining queries that return more than ~1000 results and caching results,
  because search indexes only update on a daily submission cycle.
- When polling in a loop, arXiv asks clients to sleep ~3 seconds between calls.

## Usage

```bash
# Create an on-demand instance (no secrets needed)
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

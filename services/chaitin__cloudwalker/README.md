# CloudWalker OctoBus Service

Read-only OctoBus service package for CloudWalker cluster and vulnerability queries.

Import it into OctoBus with:

```bash
octobus service import --id cloudwalker ./services/chaitin__cloudwalker
```

## Package Files

- `service.json`: OctoBus service manifest.
- `proto/cloudwalker.proto`: gRPC API definition for phase-1 read methods.
- `config.schema.json`: non-secret endpoint and referer settings.
- `secret.schema.json`: CloudWalker token and browser session cookie settings.
- `src/cloudwalker.js`: CloudWalker HTTP client, response mapping, and error mapping.
- `src/service.js`: OctoBus SDK `defineService` wrapper.
- `bin/cloudwalker.js`: service-local executable entrypoint.
- `test/cloudwalker-client.test.js`: client-level node:test coverage.
- `test/cloudwalker.test.js`: handler wiring and mapping coverage.

## Supported Target

Validated against the public CloudWalker demo environment at `https://cnapp.demo.chaitin.cn` on `2026-06-29`.
The upstream product build/version is not exposed by the available API responses, so this package currently targets the demo API shape rather than a vendor-published semantic version.

## Authentication Method

This service uses CloudWalker's browser-session-based authentication pattern.
The validated request shape requires:

- `token`: CloudWalker token header value
- `cookie`: browser session cookie
- `referer`: browser referer matching the token/profile page
- `x-requested-with: XMLHttpRequest`: sent by the client automatically

`token` alone was verified to be insufficient in the demo environment. Requests without the browser session were redirected to the login page.

## Configuration

Use `baseUrl` for the CloudWalker API base URL. `referer` should match the browser page used to obtain the token in environments that require browser session reuse.

```json
{
  "baseUrl": "https://cnapp.demo.chaitin.cn",
  "referer": "https://cnapp.demo.chaitin.cn/profile/apitoken"
}
```

## Secret Example

Use `token` and `cookie` together for the validated demo-environment flow:

```json
{
  "token": "replace-with-cloudwalker-token",
  "cookie": "replace-with-browser-session-cookie"
}
```

## RPC Methods

- `CloudWalker.CloudWalker/ListClusters`
- `CloudWalker.CloudWalker/GetClusterInfo`
- `CloudWalker.CloudWalker/ListClusterVulnEvents`
- `CloudWalker.CloudWalker/GetClusterVulnEvent`
- `CloudWalker.CloudWalker/ListMicroserviceVulnEvents`
- `CloudWalker.CloudWalker/GetMicroserviceVulnEvent`

## Behavior Notes

- `ListClusters` calls `GET /cluster/cluster_list`.
- `GetClusterInfo` calls `GET /cluster/cluster_info` with `cluster_id`.
- `ListClusterVulnEvents` calls `GET /cluster_vuln/vuln_event_list` with `cluster_id`, `page_size`, and `offset`.
- `GetClusterVulnEvent` calls `GET /cluster_vuln/vuln_event_info` with `id`.
- `ListMicroserviceVulnEvents` calls `GET /cluster_microservice/vuln_event_list` with `page_size` and `offset`.
- `GetMicroserviceVulnEvent` calls `GET /cluster_microservice/vuln_event_info` with `id`.
- HTTP `401` maps to `UNAUTHENTICATED`.
- HTTP `404` maps to `NOT_FOUND`.
- HTTP `5xx`, network failures, and unexpected upstream behavior map to `UNAVAILABLE`.
- HTTP `200` responses with non-JSON HTML bodies are treated as upstream auth/session failures and map to `UNAVAILABLE`.

## Validation Steps

Local package checks:

```bash
cd services
npm run validate -- --service-dir chaitin__cloudwalker
npm test -- --service-dir chaitin__cloudwalker
npm run pack:check
```

Real upstream validation completed locally on `2026-06-29` against the demo environment with sanitized browser-session-backed credentials.
Validated methods:

- `ListClusters`
- `GetClusterInfo`
- `ListClusterVulnEvents`
- `GetClusterVulnEvent`
- `ListMicroserviceVulnEvents`
- `GetMicroserviceVulnEvent`

## Risk Boundary

This phase-1 package is `read-only`.
It does not create, update, or delete CloudWalker resources.

## Suggested Capset

Suggested capset: `chaitin-cloudwalker-readonly`

Reasoning: this groups the six phase-1 read-only inventory and vulnerability methods into one low-risk operator-facing capability set without mixing in any write actions.

## Known Limitations

- The current proto returns a minimal business-useful field set, not every upstream field exposed by the demo APIs.
- The validated auth path depends on browser session reuse. Environments with a different auth model may need different secret/config values.
- OctoBus runtime-chain validation requires a local `octobus` runtime binary and instance environment. If unavailable on the validating machine, that layer must be completed separately.

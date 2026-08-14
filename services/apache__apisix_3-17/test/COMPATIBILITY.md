# Apache APISIX 3.17 compatibility evidence

This adapter was exercised on 2026-08-14 against the official
`apache/apisix:3.17.0-debian` image (digest
`sha256:0e5377839f4ff5e322a5686ab6ce6797ba768008aca1bfc9b71149c3b326c4df`)
and official `quay.io/coreos/etcd:v3.5.17`.

The test used an isolated Docker network, a disposable `octobus-test-*`
route/upstream pair, and a non-production Admin API key. No production host,
credential, or route data is recorded here.

Observed adapter results:

```text
UpsertUpstream octobus-test-upstream
UpsertRoute    octobus-test-route
GetRoute       octobus-test-route
ListRoutes     total=1
DeleteRoute    octobus-test-route deleted=true
DeleteUpstream octobus-test-upstream deleted=true
```

To reproduce, provide a private Admin API endpoint and a disposable key via
environment variables; do not commit either value or expose port 9180:

```bash
export APISIX_BASE_URL=http://127.0.0.1:9180
export APISIX_ADMIN_KEY='<disposable-admin-key>'

node --input-type=module -e '
import { handlers } from "./services/apache__apisix_3-17/src/apisix.js";
const context = (request) => ({ request,
  config: { baseUrl: process.env.APISIX_BASE_URL, allowedIdPrefix: "octobus-test-", timeoutMs: 5000 },
  secret: { adminApiKey: process.env.APISIX_ADMIN_KEY }, metadata: {}, method: "" });
const call = (name, request) => handlers[`Apache_APISIX.Apache_APISIX/${name}`](context(request));
await call("UpsertUpstream", { id: "octobus-test-upstream", body_json: JSON.stringify({ type: "roundrobin", nodes: { "127.0.0.1:18080": 1 } }) });
await call("UpsertRoute", { id: "octobus-test-route", body_json: JSON.stringify({ uri: "/octobus-test", upstream_id: "octobus-test-upstream" }) });
console.log(await call("GetRoute", { id: "octobus-test-route" }));
console.log(await call("ListRoutes", {}));
await call("DeleteRoute", { id: "octobus-test-route" });
await call("DeleteUpstream", { id: "octobus-test-upstream" });
'
```

The package smoke fixture separately proves the imported OctoBus chain through
Connect RPC, gRPC, and MCP using a deterministic local mock upstream.

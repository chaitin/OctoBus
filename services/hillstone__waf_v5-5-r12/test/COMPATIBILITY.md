# Compatibility evidence

The contributor validated this adapter through an OctoBus Connect endpoint
against a real Hillstone WAF appliance on 2026-06-29. The PR records sanitized
responses for login/session operations, website CRUD, WAF and access-control
policy queries, exception lists, system information, and web-security logs.
Device identifiers, addresses, domains, credentials, tokens, and site names
were redacted. The returned system information identified the upstream as a
Hillstone SG6000-VW appliance running software Version 5.5.

The deterministic test suite uses a local mock and does not replace that
device evidence. `smoke.json` additionally requires Connect, native gRPC, and
MCP calls to reach the local mock upstream during the L2 gate.

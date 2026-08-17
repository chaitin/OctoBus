# Hillstone WAF V5.5R12

OctoBus service adapter for the Hillstone WAF REST API.

Configure the appliance hostname, HTTPS port, request timeout, and optionally
`skipTlsVerify` for appliances using a locally managed certificate. Store a
username/password pair or an API token in instance secrets. TLS certificate
verification remains enabled by default.

The service exposes session management, website CRUD, WAF and access-control
policies, allow/block/exception lists, virtual-system and system information,
and web-security log RPCs. See `service.json` for CLI command names.

Compatibility evidence and the distinction between device verification and
deterministic mock testing are documented in `test/COMPATIBILITY.md`.

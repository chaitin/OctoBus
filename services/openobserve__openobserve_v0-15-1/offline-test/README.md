# Offline Test

Use this directory for customer-site read-only checks against a real
OpenObserve v0.15.1 deployment. Start with status or list methods before running any
write operation.

Recommended first checks:

- `ListOrganizations`
- `ListStreams`
- `ListFunctions`

Replace placeholder values in `config.example.json` with the
customer's actual baseUrl, username/password (or bearer token) before
running the service entry. The bundled SDK is the same version used to
build the service package and ships in `sdk/chaitin-ai-octobus-sdk-0.5.0.tgz`.

# Offline Test

Use this directory for customer-site read-only checks against a real
Proxmox VE 8.3.5 deployment. Start with status or list methods before running any
write operation.

Recommended first checks:
- `ListNodes`
- `ListQemuVMs`

Replace placeholder values in `config.example.json` with the customer's actual
base URL. Configure `tokenId` and `tokenSecret` using a read-only Proxmox API
token; username/password and bearer-token authentication are not supported.
Install the package dependencies declared in `package.json`, including
`@chaitin-ai/octobus-sdk` 0.6.x, before running the service entry.

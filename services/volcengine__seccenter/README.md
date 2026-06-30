# Volcengine Cloud Security Center OctoBus Service

## Verified OctoBus Surface

This service package intentionally exposes only `ListAssetGroups` in proto/rpcdef because this is the RPC currently covered by real OctoBus Connect evidence. Other vendor APIs are not exposed until matching OctoBus runtime evidence is added.

## Configuration

Use the service `config.schema.json` and `secret.schema.json` files for required endpoint, region, and credential fields. Secrets must be supplied at runtime and are not stored in this package.

## Evidence

- OctoBus Connect evidence: `docs/evidence/octobus-connect-evidence.md`
- Manual terminal screenshot: `docs/evidence/manual-octobus-connect-evidence.png`

## Tests

Run the service test with Node.js from the repository or service worktree:

```bash
node --test test/*.test.js
```

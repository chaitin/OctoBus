# PR: Add Tencent Cloud Lighthouse Firewall service package

## Summary

Add a new OctoBus service package for Tencent Cloud Lighthouse firewall operations.
The package supports rule listing, creation, deletion, modification, template application,
and block/unblock IP flows through Tencent Cloud Lighthouse API 3.0.

## Scope

- Service package: `tencent__lighthouse-firewall`
- Product: Tencent Cloud Lighthouse / 轻量应用服务器
- API version: `2020-03-24`
- Runtime: `long-running`

## What Changed

- Added a new service package under `services/tencent__lighthouse-firewall`
- Added proto definitions for firewall rule operations
- Added config and secret schemas
- Added README with supported versions, configuration examples, method docs, risk notes, capset suggestions, write semantics, and verification notes
- Added unit tests and mock upstream coverage
- Registered the package in `services/package.json`
- Registered the root dispatcher in `services/bin/octobus-tentacles.js`

## Supported Methods

- `ListFirewallRules`
- `CreateFirewallRules`
- `DeleteFirewallRules`
- `ModifyFirewallRules`
- `ApplyFirewallTemplate`
- `BlockIP`
- `UnblockIP`

## Authentication

Tencent Cloud TC3-HMAC-SHA256 signing using:

- `SecretId`
- `SecretKey`
- optional STS `token`

## Validation

Run from `services`:

```bash
npm run validate -- --service-dir tencent__lighthouse-firewall
npm test -- --service-dir tencent__lighthouse-firewall
npm run pack:check
```

## Real Device Verification

Verified on Tencent Cloud Lighthouse firewall with a test environment:

- Read-only query: `DescribeFirewallRules`
- Write actions: `CreateFirewallRules`
- Test policy cleanup: `DeleteFirewallRules` / `UnblockIP`

Observed real rules after validation:

- `TCP 443 DROP` was created successfully
- `TCP 8888 ACCEPT` was created successfully
- `TCP 9999 ACCEPT` was created successfully

## Capset Recommendation

- Read-only: `ListFirewallRules`
- Write: `CreateFirewallRules`, `DeleteFirewallRules`, `ModifyFirewallRules`, `ApplyFirewallTemplate`
- SOAR: `BlockIP`, `UnblockIP`

## Risk Notes

- Firewall writes may interrupt business traffic.
- Use least-privilege CAM permissions.
- Treat `BlockIP` / `UnblockIP` as operational actions and record `request_id`, `instance_id`, `region`, `protocol`, `port`, `cidr_block`, `action`, and operator/workflow ID for audit.

## Known Limitations

- IPv6 rule fields are preserved in `raw_json` but not modeled separately.
- Region must be provided correctly.
- Conflicting ACCEPT/DROP rules should be checked on Tencent Cloud side before rollout.

## Files

- `services/tencent__lighthouse-firewall/service.json`
- `services/tencent__lighthouse-firewall/config.schema.json`
- `services/tencent__lighthouse-firewall/secret.schema.json`
- `services/tencent__lighthouse-firewall/proto/lighthouse_firewall.proto`
- `services/tencent__lighthouse-firewall/src/lighthouse-firewall.js`
- `services/tencent__lighthouse-firewall/test/lighthouse-firewall.test.js`
- `services/tencent__lighthouse-firewall/test/mock_upstream.js`
- `services/bin/lighthouse-firewall.js`
- `services/bin/octobus-tentacles.js`
- `services/package.json`

## PR Checklist

- [x] Directory follows `vendor__product[_version]`
- [x] Includes service.json / schema / proto / README / tests
- [x] Local checks pass
- [x] Import / instance create / capset add-instance verified
- [x] At least one method verified on real Tencent Cloud firewall
- [x] No real credentials or production-sensitive values in docs/tests

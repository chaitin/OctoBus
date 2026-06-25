# Submission Notes

## Device & Version

- Device: Tencent Cloud Lighthouse firewall
- API version: `2020-03-24`
- Region used during validation: `ap-beijing`

## Authentication

- Tencent Cloud TC3-HMAC-SHA256
- Secret material stored only in local runtime secret config

## Verification Commands

```bash
cd services
npm run validate -- --service-dir tencent__lighthouse-firewall
npm test -- --service-dir tencent__lighthouse-firewall
npm run pack:check
```

## Validation Evidence

- `DescribeFirewallRules` returned the target instance firewall rules.
- `CreateFirewallRules` successfully created test rules.
- `BlockIP` successfully created a DROP rule.
- `UnblockIP` / `DeleteFirewallRules` can be used for cleanup with matching tuples.

## Screenshot Guidance

If attaching screenshots to PR, use only redacted views showing:

- OctoBus service import success
- instance running
- capset membership
- successful method call result
- Tencent Cloud console rule list with sensitive fields hidden

## Restrictions

- Do not include raw `SecretId`, `SecretKey`, tokens, cookies, production IPs, or other sensitive operational data.

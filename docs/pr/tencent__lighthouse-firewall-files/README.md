# Tencent Lighthouse Firewall PR File Export

This directory contains redacted, review-ready copies of the files needed for the Tencent Cloud Lighthouse firewall service package PR.

## Screenshot Files

- `services/tencent__lighthouse-firewall/service.json`
- `services/tencent__lighthouse-firewall/src/lighthouse-firewall.js`
- `services/tencent__lighthouse-firewall/proto/lighthouse_firewall.proto`
- `services/tencent__lighthouse-firewall/README.md`
- `services/tencent__lighthouse-firewall/test/lighthouse-firewall.test.js`
- `services-root/package.json`
- `services/bin/octobus-tentacles.js`

## Additional Required Files

The acceptance checklist also requires these package files, so they are included too:

- `services/tencent__lighthouse-firewall/config.schema.json`
- `services/tencent__lighthouse-firewall/secret.schema.json`
- `services/tencent__lighthouse-firewall/bin-lighthouse-firewall.js`
- `services/tencent__lighthouse-firewall/test/mock_upstream.js`
- `services/bin/lighthouse-firewall.js`

## Sensitive Data Policy

These files must not contain real accounts, passwords, tokens, cookies, production addresses, or business-sensitive data.

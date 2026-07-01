# Volcengine WAF OctoBus Service

## Supported RPCs

This service package exposes read-only Volcengine WAF query APIs through OctoBus RPCs.

| RPC | Volcengine Action | Purpose |
|---|---|---|
| `ListDomain` | `ListDomain` | Query protected domains. |
| `ListLoadBalancer` | `ListLoadBalancer` | Query load balancer access resources. |
| `QueryProtectionOverviewLb` | `QueryProtectionOverviewLb` | Query protection overview metrics. |
| `QueryAttackSecurityEvent` | `QueryAttackSecurityEvent` | Query attack security events. |
| `QueryAttackAnalysisWithRuleAggLb` | `QueryAttackAnalysisWithRuleAggLb` | Query attack analysis grouped by protection rule. |
| `QueryFlowOverviewLb` | `QueryFlowOverviewLb` | Query traffic overview metrics. |
| `ListCustomPage` | `ListCustomPage` | Query custom response pages. |
| `GetTLSConfig` | `GetTLSConfig` | Query TLS configuration. |
| `GetVulnerabilityConfig` | `GetVulnerabilityConfig` | Query vulnerability protection configuration. |
| `ListVulnerabilityRule` | `ListVulnerabilityRule` | Query vulnerability protection rules. |
| `ListCustomBotConfig` | `ListCustomBotConfig` | Query custom bot protection configuration. |
| `ListWafServiceCertificate` | `ListWafServiceCertificate` | Query WAF service certificates. |
| `ListBlockRule` | `ListBlockRule` | Query block rules. |
| `ListAllowRule` | `ListAllowRule` | Query allow rules. |

## Configuration

Use the service `config.schema.json` and `secret.schema.json` files for required endpoint, region, and credential fields. Secrets must be supplied at runtime and are not stored in this package.

## Tests

Run the service test with Node.js from the repository or service worktree:

```bash
node --test test/*.test.js
```

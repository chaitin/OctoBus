# Huawei WAF Service Package

OctoBus package for Huawei Cloud WAF (Web Application Firewall) IP blacklist/whitelist management APIs.

## Device Version

WAF, API version v1, endpoint `waf.{region}.myhuaweicloud.com`

## Authentication

Huawei Cloud AK/SK (Access Key + Secret Key), SDK-HMAC-SHA256 signature.

## Methods

| RPC Method | Backend API | Type | Description |
|------------|-------------|------|-------------|
| `BlockIP` | `POST /v1/{project_id}/waf/policy/{policy_id}/whiteblackip` | Write | Block an IP via blacklist rule |
| `UnblockIP` | `DELETE /v1/{project_id}/waf/policy/{policy_id}/whiteblackip/{rule_id}` | Write | Remove a blacklist rule to unblock |
| `ListRules` | `GET /v1/{project_id}/waf/policy/{policy_id}/whiteblackip` | Read | List all blacklist/whitelist rules |
| `ListInstances` | `GET /v1/{project_id}/waf/instance` | Read | List all protected domain instances |
| `ListPolicies` | `GET /v1/{project_id}/waf/policy` | Read | List all WAF protection policies |

## Configuration

Config fields (non-sensitive, in `config`):

- `region`: Huawei Cloud region (default: `cn-north-4`)
- `project_id` (**required**): Huawei Cloud project ID
- `policy_id` (**required**): WAF policy ID for rule management
- `timeoutMs`: HTTP timeout in milliseconds (default: 10000)

Secret fields (sensitive, in `secret`):

- `access_key` / `ak`: Huawei Cloud Access Key
- `secret_key` / `sk`: Huawei Cloud Secret Key

## Before Using

1. Ensure a WAF policy exists in your Huawei Cloud account (create one via console or API if needed)
2. Set `project_id` and `policy_id` in instance config

## Import

```bash
octobus service import huawei-waf /path/to/huawei__waf
```

## Usage

```bash
# Create instance
octobus instance create waf-test \
  --service huawei-waf \
  --config-json '{"region":"cn-north-4","project_id":"xxx","policy_id":"xxx"}' \
  --secret-json '{"access_key":"xxx","secret_key":"xxx"}'

# Create capset
octobus capset create waf-dev --name WAF-Dev
octobus capset add-instance waf-dev waf-test

# Block an IP
curl -X POST \
  'http://127.0.0.1:9000/capsets/waf-dev/connect/waf-test/Huawei_WAF.Huawei_WAF/BlockIP' \
  -H 'Content-Type: application/json' \
  -d '{"ip":"1.2.3.4","comment":"blocked by OctoBus"}'

# List rules
curl -X POST \
  'http://127.0.0.1:9000/capsets/waf-dev/connect/waf-test/Huawei_WAF.Huawei_WAF/ListRules' \
  -H 'Content-Type: application/json' \
  -d '{"limit":20}'

# List protected domains
curl -X POST \
  'http://127.0.0.1:9000/capsets/waf-dev/connect/waf-test/Huawei_WAF.Huawei_WAF/ListInstances' \
  -H 'Content-Type: application/json' \
  -d '{"limit":20}'

# List policies
curl -X POST \
  'http://127.0.0.1:9000/capsets/waf-dev/connect/waf-test/Huawei_WAF.Huawei_WAF/ListPolicies' \
  -H 'Content-Type: application/json' \
  -d '{}'

# Unblock IP (by rule_id)
curl -X POST \
  'http://127.0.0.1:9000/capsets/waf-dev/connect/waf-test/Huawei_WAF.Huawei_WAF/UnblockIP' \
  -H 'Content-Type: application/json' \
  -d '{"rule_id":"<rule_id_from_list>"}'
```

## Risk Notes

- `BlockIP` and `UnblockIP` are write operations that modify WAF rules.
- Test in a non-production WAF policy first.

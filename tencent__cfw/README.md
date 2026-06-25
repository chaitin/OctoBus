# Tencent Cloud Firewall (CFW) Service Package

OctoBus package for Tencent Cloud Firewall (CFW) access control API.

## Device Version

CFW, API version 2019-09-04, endpoint `cfw.tencentcloudapi.com`

## Authentication

Tencent Cloud API key (SecretId + SecretKey), TC3-HMAC-SHA256 signature.

## Methods

| RPC Method | API Action | Type | Description |
|------------|-----------|------|-------------|
| `BlockIP` | `CreateAcRules` | Write | Block IPs by adding deny access control rules |
| `UnblockIP` | `DescribeAcLists` + `DeleteAcRule` | Write | Remove deny rules matching specified IPs |
| `ListRules` | `DescribeAcLists` | Read | List all access control rules |

## Configuration

Config fields (non-sensitive, in `config`):

- `region`: Tencent Cloud region, e.g. `ap-guangzhou`, `ap-shanghai`, `ap-beijing` (default: `ap-guangzhou`)
- `timeoutMs`: HTTP timeout in milliseconds (default: 10000)
- `skipTlsVerify` / `tlsInsecureSkipVerify` / `insecureSkipVerify`: TLS verification aliases

Secret fields (sensitive, in `secret`):

- `secret_id`: Tencent Cloud API SecretId
- `secretKey` / `secret_key`: Tencent Cloud API SecretKey

## Import

```bash
octobus service import tencent-cfw /path/to/tencent__cfw
```

## Usage Example

```bash
# Create instance
octobus instance create cfw-test \
  --service tencent-cfw \
  --config-json '{"region":"ap-shanghai"}' \
  --secret-json '{"secret_id":"xxx","secretKey":"xxx"}'

# Create capset
octobus capset create cfw-dev --name CFW-Dev
octobus capset add-instance cfw-dev cfw-test

# Block an IP via Connect RPC
curl -X POST \
  'http://127.0.0.1:9000/capsets/cfw-dev/connect/cfw-test/Tencent_CFW.Tencent_CFW/BlockIP' \
  -H 'Content-Type: application/json' \
  -d '{"ips":["1.2.3.4"],"comment":"test block"}'

# List rules
curl -X POST \
  'http://127.0.0.1:9000/capsets/cfw-dev/connect/cfw-test/Tencent_CFW.Tencent_CFW/ListRules' \
  -H 'Content-Type: application/json' \
  -d '{"limit":20}'

# Unblock an IP
curl -X POST \
  'http://127.0.0.1:9000/capsets/cfw-dev/connect/cfw-test/Tencent_CFW.Tencent_CFW/UnblockIP' \
  -H 'Content-Type: application/json' \
  -d '{"ips":["1.2.3.4"]}'
```

## Risk Notes

- Write operations (BlockIP, UnblockIP) directly modify CFW access control rules.
- BlockIP creates outbound deny rules for the specified source IPs.
- UnblockIP deletes ALL matching rules for the specified IPs - use with caution.
- For testing, use non-production IPs (e.g. `1.2.3.4`, `10.0.0.1`).

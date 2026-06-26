# Huawei DNS Service Package

OctoBus package for Huawei Cloud DNS (Domain Name Service) zone and record set management APIs.

## Device Version

DNS, API version v2, endpoint `dns.myhuaweicloud.com`

## Authentication

Huawei Cloud AK/SK (Access Key + Secret Key), SDK-HMAC-SHA256 signature.

## Methods

| RPC Method | Backend API | Type | Description |
|------------|-------------|------|-------------|
| `ListZones` | `GET /v2/zones` | Read | List all DNS zones |
| `ListRecordSets` | `GET /v2/recordsets?zone_id=xxx` | Read | List DNS record sets in a zone |
| `CreateRecordSet` | `POST /v2/zones/{zone_id}/recordsets` | Write | Create a DNS record set (e.g., A/AAAA/CNAME/TXT) |
| `DeleteRecordSet` | `DELETE /v2/zones/{zone_id}/recordsets/{recordset_id}` | Write | Delete a DNS record set |

## Configuration

Config fields (non-sensitive, in `config`):

- `timeoutMs`: HTTP timeout in milliseconds (default: 10000)

Secret fields (sensitive, in `secret`):

- `access_key` / `ak`: Huawei Cloud Access Key
- `secret_key` / `sk`: Huawei Cloud Secret Key

## Usage

```bash
# Create instance
octobus instance create dns-test \
  --service huawei-dns \
  --secret-json '{"access_key":"xxx","secret_key":"xxx"}'

# Create capset
octobus capset create dns-dev --name DNS-Dev
octobus capset add-instance dns-dev dns-test

# List zones
curl -X POST \
  'http://127.0.0.1:9000/capsets/dns-dev/connect/dns-test/Huawei_DNS.Huawei_DNS/ListZones' \
  -H 'Content-Type: application/json' \
  -d '{"limit":20}'
```

## Security Use Cases

- **Sinkhole**: Create A records pointing malicious domains to a sinkhole IP
- **Threat Intel**: Query DNS records to investigate suspicious domains
- **Rapid Block**: Create TXT or CNAME records to disrupt C2 communication

## Risk Notes

- `CreateRecordSet` / `DeleteRecordSet` are write operations that modify DNS resolution.
- Test in a non-production zone first.

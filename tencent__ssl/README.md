# Tencent SSL Certificate Service Package

OctoBus package for Tencent Cloud SSL Certificate query APIs.

## Device Version

SSL Certificate, API version 2019-12-05, endpoint `ssl.tencentcloudapi.com`

## Authentication

Tencent Cloud API key (SecretId + SecretKey), TC3-HMAC-SHA256 signature.

## Methods

| RPC Method | API Action | Type | Description |
|------------|-----------|------|-------------|
| `ListCertificates` | `DescribeCertificates` | Read | List all SSL certificates in the account |
| `GetCertificate` | `DescribeCertificateDetail` | Read | Get detailed info for a specific certificate |

## Configuration

Config fields (non-sensitive, in `config`):

- `region`: Tencent Cloud region (default: `ap-guangzhou`)
- `timeoutMs`: HTTP timeout in milliseconds (default: 10000)

Secret fields (sensitive, in `secret`):

- `secret_id`: Tencent Cloud API SecretId
- `secretKey` / `secret_key`: Tencent Cloud API SecretKey

## Import

```bash
octobus service import tencent-ssl /path/to/tencent__ssl
```

## Usage

```bash
# Create instance
octobus instance create ssl-test \
  --service tencent-ssl \
  --secret-json '{"secret_id":"xxx","secretKey":"xxx"}'

# Create capset
octobus capset create ssl-dev --name SSL-Dev
octobus capset add-instance ssl-dev ssl-test

# List certificates via Connect RPC
curl -X POST \
  'http://127.0.0.1:9000/capsets/ssl-dev/connect/ssl-test/Tencent_SSL.Tencent_SSL/ListCertificates' \
  -H 'Content-Type: application/json' \
  -d '{"limit":20}'

# Get certificate detail
curl -X POST \
  'http://127.0.0.1:9000/capsets/ssl-dev/connect/ssl-test/Tencent_SSL.Tencent_SSL/GetCertificate' \
  -H 'Content-Type: application/json' \
  -d '{"certificate_id":"xxx"}'
```

## Risk Notes

- All methods are read-only. No certificates are modified.
- The service is free to use - SSL certificates can be applied for free in Tencent Cloud console.

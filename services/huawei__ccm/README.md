# Huawei CCM Certificate Service Package

OctoBus package for Huawei Cloud CCM (Cloud Certificate Manager) query APIs.

## Device Version

CCM/SCM, API version v3, endpoint `scm.cn-north-4.myhuaweicloud.com`

## Authentication

Huawei Cloud AK/SK (Access Key + Secret Key), SDK-HMAC-SHA256 signature.

## Methods

| RPC Method | Backend API | Type | Description |
|------------|-------------|------|-------------|
| `ListCertificates` | `GET /v3/scm/certificates` | Read | List all SSL certificates in the account |
| `GetCertificate` | `GET /v3/scm/certificates/{id}` | Read | Get detailed info for a specific certificate |

## Configuration

Config fields (non-sensitive, in `config`):

- `timeoutMs`: HTTP timeout in milliseconds (default: 10000)

Secret fields (sensitive, in `secret`):

- `access_key` / `ak`: Huawei Cloud Access Key
- `secret_key` / `sk`: Huawei Cloud Secret Key

## Import

```bash
octobus service import huawei-ccm /path/to/huawei__ccm
```

## Usage

```bash
# Create instance
octobus instance create hw-test \
  --service huawei-ccm \
  --secret-json '{"access_key":"xxx","secret_key":"xxx"}'

# Create capset
octobus capset create hw-dev --name HW-CCM-Dev
octobus capset add-instance hw-dev hw-test

# List certificates via Connect RPC
curl -X POST \
  'http://127.0.0.1:9000/capsets/hw-dev/connect/hw-test/Huawei_CCM.Huawei_CCM/ListCertificates' \
  -H 'Content-Type: application/json' \
  -d '{"limit":50}'

# Get certificate detail
curl -X POST \
  'http://127.0.0.1:9000/capsets/hw-dev/connect/hw-test/Huawei_CCM.Huawei_CCM/GetCertificate' \
  -H 'Content-Type: application/json' \
  -d '{"certificate_id":"xxx"}'
```

## Risk Notes

- All methods are read-only. No certificates are modified.
- Huawei Cloud CCM supports free certificates (DV) and paid certificates (OV/EV).

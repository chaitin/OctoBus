# sangfor-sip

OctoBus service package for Sangfor SIP (Security Intelligence Platform / 深信服安全感知平台).

Pulls security events, risk assets, risk terminals, server/terminal inventory, IP groups, and vulnerability data (weak passwords, CVEs, plaintext transmission) via the SIP third-party REST API.

## Authentication

POST `/sangforinter/v1/auth/party/login` with SHA1-based auth token:

```
auth = sha1(rand + password + "sangfor3party" + userName)
```

Credentials are configured via `secret.yaml`:

```yaml
userName: <认证账号>
password: <认证密码>
platformName: <平台名称>
```

## Configuration

```yaml
host: https://10.0.0.1:7443
skipTlsVerify: true
```

## Methods

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GetSecurityEvents` | `GET /sangforinter/v1/data/riskevent` | Pull security events |
| `GetRiskBusiness` | `GET /sangforinter/v1/data/riskbusiness` | Pull risk business assets |
| `GetRiskTerminals` | `GET /sangforinter/v1/data/riskterminal` | Pull risk terminal assets |
| `GetServers` | `GET /sangforinter/v1/data/business` | Pull configured server assets |
| `GetTerminals` | `GET /sangforinter/v1/data/terminal` | Pull terminal assets |
| `GetIPGroups` | `GET /sangforinter/v1/data/ipgroup` | Pull monitored IP groups |
| `GetWeakPasswords` | `GET /sangforinter/v1/data/weakpasswd` | Pull weak password vulnerabilities |
| `GetVulnerabilities` | `GET /sangforinter/v1/data/hole` | Pull CVE vulnerability records |
| `GetPlaintextTransmissions` | `GET /sangforinter/v1/data/plaintexttransmission` | Pull plaintext transmission vulnerabilities |

## API version

Compatible with SIP v92+. Server port: `7443`.

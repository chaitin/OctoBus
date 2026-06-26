# DBAPPSecurity Mingyu WAF OctoBus Service

OctoBus service package for [DBAPPSecurity Mingyu WAF](https://www.dbappsecurity.com.cn/) (安恒信息 明御® Web应用防火墙).

Import it into OctoBus with:

```bash
octobus service import --id dbappsecurity-mingyu-waf ./services/dbappsecurity__mingyu-waf
```

## Supported Versions

| API Version | 说明 |
|---|---|
| Auth API v2 | `/api/v2/system/auth/public_key/` · `/api/v2/system/user/login/` |
| Rules API v1 | `/api/v1/security/basic_rules/` · `/api/v1/security/control_rules/` |
| Site API v1 | `/api/v1/website/site/` |

已验证设备版本：明御 WAF V6.x（含自签名证书环境）。

## Configuration

```json
{
  "host": "https://your-waf-address",
  "verify_ssl": false
}
```

```json
{
  "username": "admin",
  "password": "your-password"
}
```

> **Authentication note**: The Mingyu WAF API requires RSA-PKCS1v15 encrypted passwords. The service fetches the public key automatically and encrypts the password before login — do not pre-encrypt the password in the secret schema.

## RPC Methods

### IP Blocking Rules (基础规则 — `POST /api/v1/security/basic_rules/`)

| Method | 操作类型 | 风险等级 | 说明 |
|--------|---------|---------|------|
| `ListBlockRules` | 只读 | 低 | 分页列出 IP 封禁规则，支持名称过滤 |
| `CreateBlockRule` | **可写** | 中 | 创建 IP 封禁规则（action: `deny`）|
| `UpdateBlockRule` | **可写** | 中 | 按 ID 更新已有封禁规则 |
| `DeleteBlockRule` | **可写** | **高危** | 按 ID 删除封禁规则，操作不可撤销 |

### IP Allowlist Rules (防护控制规则 — `POST /api/v1/security/control_rules/`)

| Method | 操作类型 | 风险等级 | 说明 |
|--------|---------|---------|------|
| `ListAllowRules` | 只读 | 低 | 分页列出 IP 白名单规则，支持名称过滤 |
| `CreateAllowRule` | **可写** | 中 | 创建 IP 白名单规则（action: `allow`）|
| `UpdateAllowRule` | **可写** | 中 | 按 ID 更新已有白名单规则 |
| `DeleteAllowRule` | **可写** | **高危** | 按 ID 删除白名单规则，操作不可撤销 |

### Sites

| Method | 操作类型 | 风险等级 | 说明 |
|--------|---------|---------|------|
| `ListSites` | 只读 | 低 | 列出受保护站点，供规则 `siteIds` 字段使用 |

## Condition Groups

Rules use OR logic between `conditionGroups` and AND logic within each group's `conditions`:

```json
{
  "conditionGroups": [
    {
      "conditions": [
        {
          "field": "sip",
          "ipList": ["1.2.3.4", "10.0.0.0/8"],
          "negate": false
        }
      ]
    }
  ]
}
```

Supported `field` values:

| Field | Description |
|-------|-------------|
| `sip` | Source IP address |
| `sip_xff` | Real client IP from X-Forwarded-For header |
| `dip` | Destination IP address |

## Write Operation Semantics

- **CreateBlockRule / CreateAllowRule**：非幂等。重复调用会产生多条同名规则。建议先 `List` 确认不存在后再创建。
- **UpdateBlockRule / UpdateAllowRule**：全量替换（PUT），请求体中未提供的字段将恢复为默认值。需包含完整规则内容。
- **DeleteBlockRule / DeleteAllowRule**：物理删除，**无法回滚**。建议在删除前用 `List` 记录原始规则内容，以便人工恢复。
- 所有写操作在 WAF 侧即时生效，无"草稿"或"预发布"阶段。

## Risk Notes

- `DeleteBlockRule` / `DeleteAllowRule` 为**高危操作**：删除封禁规则会导致已封禁 IP 立即放通；删除白名单规则不影响封禁，但会改变访问控制策略。
- `CreateAllowRule` 错误配置（如将攻击 IP 加入白名单）可能绕过所有封禁策略，请在生产环境谨慎使用。
- 推荐将此服务的执行权限（capset）限制为封禁处置（`block`），避免在 SOAR 场景中误触白名单或删除规则。

## Capset Recommendation

推荐 capset 配置：**封禁处置**

```json
{
  "capabilities": ["CreateBlockRule", "DeleteBlockRule", "ListBlockRules"]
}
```

如需完整 IP 白名单管理，额外开放：`CreateAllowRule`、`UpdateAllowRule`、`ListAllowRules`、`ListSites`。

## Behavior Notes

- Login is performed automatically on the first request and on token expiry (`GENERAL_TOKEN_INVALID`).
- `applyTo: "all_apps"` applies the rule to all protected sites; pass specific site IDs via `siteIds` to scope the rule.
- IP addresses may be single IPs or CIDR notation (e.g. `10.0.0.0/8`).
- The service skips SSL certificate verification by default (`verify_ssl: false`) for on-premises deployments with self-signed certificates. Set `verify_ssl: true` in production environments with valid certificates.

## Package Files

- `service.json`: OctoBus service manifest.
- `proto/waf.proto`: gRPC API definition.
- `config.schema.json`: WAF management address and TLS settings.
- `secret.schema.json`: WAF username and password.
- `src/waf.js`: Core handler logic — RSA-encrypted login, JWT token management, and REST API calls.
- `src/service.js`: Service definition entry point.
- `bin/waf.js`: Service binary entrypoint.
- `test/waf.test.js`: Unit tests (mocked fetch).
- `test/mock_upstream.js`: Integration test mock server.

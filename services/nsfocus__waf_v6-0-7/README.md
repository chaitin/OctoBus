# NSFOCUS WAF 6.0.7 OctoBus Service

Service root: `services/nsfocus__waf_v6-0-7`.

Import it into OctoBus with:

```bash
octobus service import --id nsfocus-waf-v6-0-7 ./services/nsfocus__waf_v6-0-7
```

## Support Matrix

- Product: NSFOCUS Web Application Firewall.
- Effective API reference for this implementation: `绿盟WEB应用防护系统RESTAPI设计文档-V6.0.7.3版本.pdf`.
- Service/package identifier is `nsfocus-waf-v6-0-7`.
- API style: REST V3 token plus per-request signature.
- Authentication: `accountId` plus password login, or pre-issued `token` and `seceret_key`.
- Transport: HTTPS (port 8443). Private deployments often use self-signed certificates; set `skipTlsVerify` only for trusted management networks.

## Package Files

- `service.json`: OctoBus service manifest.
- `proto/nsfocus_waf_v6_0_7.proto`: gRPC API definition.
- `config.schema.json`: non-secret endpoint, account, timeout, TLS, and header settings.
- `secret.schema.json`: password or pre-issued token and `seceret_key` settings.
- `src/nsfocus-waf-v6-0-7.js`: NSFOCUS WAF REST V3 client and handler implementation.
- `src/service.js`: OctoBus SDK `defineService` wrapper.
- `bin/nsfocus-waf-v6-0-7.js`: service-local executable entrypoint.
- `test/nsfocus-waf-v6-0-7.test.js`: node:test coverage for signing, request mapping, response mapping, and error mapping.

## Configuration

```json
{
  "endpoint": "https://waf.example.com:8443",
  "accountId": "admin",
  "apiVersion": "v3",
  "timeoutMs": 5000,
  "skipTlsVerify": false
}
```

Use `secret.pwd` or `secret.password` to let the service fetch a V3 token from `POST /rest/v3/token`:

```json
{
  "pwd": "replace-with-password"
}
```

If a token has already been issued, provide both values and login will be skipped:

```json
{
  "token": "replace-with-token",
  "seceret_key": "replace-with-seceret-key"
}
```

## RPC Methods

- `nsfocus.waf.v6.NSFOCUSWAFService/BlockIP`: creates a network-layer (L4) ACL policy through `POST /rest/v3/l4acl`.
- `nsfocus.waf.v6.NSFOCUSWAFService/ListBlockedIPs`: queries L4 ACL policies through `GET /rest/v3/l4acl` or `GET /rest/v3/l4acl/{policy_id}`.
- `nsfocus.waf.v6.NSFOCUSWAFService/UnblockIP`: deletes L4 ACL policies through `DELETE /rest/v3/l4acl/{policy_id}`, supports lookup by IP or direct deletion by policy ID.

## 6.0.7.3 接口对照表

| OctoBus RPC / CLI | 6.0.7.3 文档位置 | 上游接口 | 请求映射 | 响应映射 |
| --- | --- | --- | --- | --- |
| `BlockIP` / `block-ip` | `2.30 网络层访问控制`，PDF 第 `210-215` 页 | `POST /rest/v3/l4acl` | `ips` 映射为 `iptables[].src.iplist[]`（mask=255.255.255.255），`policy_name -> name`，`action`/`protocol`/`alarm`/`enabled` 直接透传，`index` 可选（不填自动分配） | 提取 `result[]` 中的 `id`、`multi_result`、`name` 映射为 `policy_id`、`result`、`name` |
| `BlockIP` / `block-ip` | `2.30 网络层访问控制`，PDF 第 `210-215` 页 | `POST /rest/v3/l4acl` | `ips` 映射为 `iptables[].src.iplist[]`（mask=255.255.255.255），`policy_name -> name`，`action`/`protocol`/`alarm`/`enabled` 直接透传，`index` 可选（不填自动分配） | 提取 `result[]` 中的 `id`、`multi_result`、`name` 映射为 `policy_id`、`result`、`name` |
| `ListBlockedIPs` / `list-blocked-ips` | `2.30 网络层访问控制`，PDF 第 `210-212` 页 | `GET /rest/v3/l4acl` 或 `GET /rest/v3/l4acl/{policy_id}` | 可选 `ips` 过滤、可选 `policy_id` 查询单个策略 | 将策略列表映射为 `policies[]`，提取 `id/name/index/protocol/alarm/action/enabled/blocked_ips[]` |
| `UnblockIP` / `unblock-ip` | `2.30 网络层访问控制`，PDF 第 `216` 页 | `DELETE /rest/v3/l4acl/{policy_id}` | 支持 `ips`（先查询匹配策略 ID 再删除）或 `policy_ids`（直接删除） | 将删除结果映射为 `results[]`，保留 `policy_id/result` |

## L4 ACL 策略参数说明

| 参数 | 类型 | 说明 |
| --- | --- | --- |
| `ips` | string[] | 要封禁的源 IP 列表，必填 |
| `policy_name` | string | 策略名称，可选 |
| `action` | string | 动作: `"1"`=放行 `"2"`=拒绝 `"3"`=重定向，默认 `"2"` |
| `protocol` | string | 协议: `"0"`=任意 `"1"`=icmp `"6"`=tcp `"17"`=udp，默认 `"0"` |
| `alarm` | bool | 是否告警，默认 `true` |
| `enabled` | bool | 是否启用，默认 `true` |
| `index` | string | 优先级索引（须唯一），不填自动分配 |

## Risk Boundaries

- Read-only methods: `ListBlockedIPs`.
- Write methods: `BlockIP`, `UnblockIP`.
- `BlockIP` creates a single L4 ACL policy that blocks the specified source IPs (reject action). An unused `index` is auto-assigned if not provided.
- `UnblockIP` finds and deletes L4 ACL policies by IP or by policy ID.
- Use dedicated test IPs for write validation. Clean up every policy created during validation.

## Write Semantics

- `BlockIP` is not guaranteed idempotent — repeated calls with the same `policy_name` create separate policies.
- Index auto-assignment: queries existing policies and uses `max(existing_index) + 1` if `index` is not specified.
- Rollback: call `UnblockIP` with the policy ID returned by `BlockIP`, or delete via the vendor UI.
- Audit fields should include `policy_name`, `ips`, `index`, caller identity, OctoBus request id, and upstream raw result.

## Suggested Capset

- `waf.blocked_ip.read`: allow `ListBlockedIPs`.
- `waf.ip_block.write`: allow `BlockIP`; grant only to workflows approved to modify WAF policy.
- `waf.ip_unblock.write`: allow `UnblockIP`; grant only to workflows approved to remove WAF blocking entries.

For production, prefer separate read-only and write capsets so agents can query alerts without permission to modify protections.

## Validation Plan

1. Import the service package.
2. Create an instance with a non-production WAF or a dedicated test environment.
3. Add the instance to a read-only capset and call `ListBlockedIPs`.
4. After explicit approval, add a write capset and call `BlockIP` with a test IP.
5. Verify the block with `ListBlockedIPs`.
6. Clean up with `UnblockIP`.

## Local Checks

```bash
cd services/nsfocus__waf_v6-0-7
npm test
npm run validate -- --service-dir nsfocus__waf_v6-0-7
```

# Imperva_WAF Gateway 13.6.90（Imperva_WAF Gateway 13.6.90）

这是用于 Imperva_WAF Gateway 13.6.90（Imperva_WAF Gateway 13.6.90） 的 OctoBus 标准能力包。

服务根目录：`services/imperva__waf-gateway_v13-6-90`。

## 命名信息

- 规范标题：`Imperva_WAF Gateway 13.6.90（Imperva_WAF Gateway 13.6.90）`
- 公司：`Imperva / Imperva`
- 产品：`Web应用防火墙（原 SecureSphere）/ WAF Gateway`
- OctoBus 服务 ID：`imperva-waf-gateway-v13-6-90`
- OctoBus 服务目录：`services/imperva__waf-gateway_v13-6-90`

导入示例：

```bash
octobus service import imperva-waf-gateway-v13-6-90 ./services/imperva__waf-gateway_v13-6-90
```

## 能力范围

- `CheckOnline`：检查管理接口在线状态。
- `BlockIP`：添加一个封禁 IP。
- `ListBlockedIPs`：查询封禁 IP 列表。
- `UnblockIP`：删除一个封禁 IP。

## 配置与密钥

配置：

```json
{
  "host": "https://mx.example:8083",
  "skipTlsVerify": true
}
```

密钥：

```json
{
  "username": "api_user",
  "password": "api_password"
}
```

调用流程和 `imperva-sdk-python` 保持一致：先使用 Basic 认证调用 `POST /SecureSphere/api/v1/auth/session` 获取会话 Cookie，再调用 MX Open API。

IP 封禁能力基于 Imperva IP Group：

- 在线检查调用 `GET /SecureSphere/api/v1/administration/version`。
- 查询封禁列表调用 `GET /SecureSphere/api/v1/conf/ipGroups/{ipGroupName}`。
- 默认 IP Group 为 `OctoBus黑名单IP组`，不存在时由封禁流程自动创建。
- 默认 Web Service Custom Policy 为 `OctoBus黑名单策略`，用于让客户识别该策略来源。
- 封禁 IP 会自动发现当前所有站点下的 Web Service，确保 `OctoBus黑名单策略` 存在且启用 `action=block`，匹配条件为 `sourceIpAddresses` 命中 `OctoBus黑名单IP组`。
- 每次封禁都会重新同步策略 `applyTo`，因此后续新增站点或 Web Service 会在下一次封禁操作时自动纳入。
- 创建 IP Group 调用 `POST /SecureSphere/api/v1/conf/ipGroups/{ipGroupName}`。
- 封禁 IP 随后调用 `PUT /SecureSphere/api/v1/conf/ipGroups/{ipGroupName}`，提交 `operation=add` 的 `entries`。
- 解封 IP 调用 `PUT /SecureSphere/api/v1/conf/ipGroups/{ipGroupName}`，提交 `operation=remove` 的 `entries`。

## 请求示例

封禁：

```json
{
  "ip": "203.0.113.45",
  "comment": "octobus block"
}
```

解封：

```json
{
  "ip": "203.0.113.45"
}
```

## 本地验证

```bash
cd services
npm run validate -- --service-dir imperva__waf-gateway_v13-6-90
npm test -- --service-dir imperva__waf-gateway_v13-6-90 --coverage
npm run pack:check
```

## Service Contract

- Service name: `imperva-waf-gateway-v13-6-90`
- Service dir: `services/imperva__waf-gateway_v13-6-90`
- Runtime mode: `long-running`
- Config: `host` is required; `port`, `apiVersion`, IP group/policy names, `timeoutMs`, `skipTlsVerify`, and `headers` are optional.
- Secret: `username` and `password` are required; `user` is accepted as a username alias.
- RPC read/write properties:
  - `CheckOnline`: read, authenticates and reads MX version.
  - `BlockIP`: write, ensures IP group and block policy exist, then adds one IP.
  - `ListBlockedIPs`: read, lists entries in the configured IP group.
  - `UnblockIP`: write, removes one IP from the configured IP group.

OctoBus example:

```bash
octobus service import --id imperva-waf-gateway-v13-6-90 ./services/imperva__waf-gateway_v13-6-90
octobus instance create imperva-waf-gateway-v13-6-90 imperva-demo --config config.json --secret secret.json
octobus capset create security-devices
octobus capset add-instance security-devices imperva-demo
```

Connect path example: `/capsets/security-devices/connect/imperva-demo/Imperva_WAF_Gateway_v13_6_90.Imperva_WAF_Gateway_v13_6_90/CheckOnline`.

Known limitations: no real Imperva appliance is required for tests; `test/mock_upstream.js` covers the local path. Session cookies, Basic credentials, Authorization headers, and upstream raw bodies are not returned. `skipTlsVerify` is only for private/self-signed MX deployments and is applied per request.

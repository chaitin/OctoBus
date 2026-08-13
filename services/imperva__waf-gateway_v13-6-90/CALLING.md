# Imperva_WAF Gateway 13.6.90（Imperva_WAF Gateway 13.6.90） 调用方式

本文档只记录 OctoBus 标准调用方式，便于后续查询。示例中的密码统一使用 `<密码>` 占位，不要把真实密码写入仓库。

## 命名信息

- 规范标题：`Imperva_WAF Gateway 13.6.90（Imperva_WAF Gateway 13.6.90）`
- 公司：`Imperva / Imperva`
- 产品：`Web应用防火墙（原 SecureSphere）/ WAF Gateway`
- OctoBus 服务 ID：`imperva-waf-gateway-v13-6-90`
- OctoBus 服务目录：`services/imperva__waf-gateway_v13-6-90`

## 前置条件

本地需要具备以下命令：

- `node`：运行 Node.js 服务包。
- `npm`：导入服务时安装生产依赖。
- `protoc`：导入服务时编译 proto 描述。
- `go` 或已有 `bin/octobus`：用于构建或运行 OctoBus。

如本地尚未构建 OctoBus：

```bash
task build
```

如果没有 `task`，可直接使用 Go 构建：

```bash
go build -o bin/octobus ./cmd/octobus
```

启动 OctoBus daemon：

```bash
./bin/octobus serve --addr 127.0.0.1:9000
```

## 导入服务

```bash
./bin/octobus service import imperva-waf-gateway-v13-6-90 ./services/imperva__waf-gateway_v13-6-90
```

## 创建实例

```bash
./bin/octobus instance create imperva-prod \
  --service imperva-waf-gateway-v13-6-90 \
  --config-json '{"host":"https://<MX_HOST>:8083","skipTlsVerify":true}' \
  --secret-json '{"username":"admin","password":"<密码>"}'
```

`config` 只放连接配置：

```json
{
  "host": "https://<MX_HOST>:8083",
  "skipTlsVerify": true
}
```

`secret` 只放账号密钥：

```json
{
  "username": "admin",
  "password": "<密码>"
}
```

## 创建能力集

```bash
./bin/octobus capset create security --name Security
./bin/octobus capset add-instance security imperva-prod
```

查看暴露出来的协议入口：

```bash
./bin/octobus catalog security --all --json
```

## Connect RPC 调用

封禁 IP：

```bash
curl -X POST \
  http://127.0.0.1:9000/capsets/security/connect/imperva-prod/Imperva_WAF_Gateway_v13_6_90.Imperva_WAF_Gateway_v13_6_90/BlockIP \
  -H 'Content-Type: application/json' \
  -d '{"ip":"1.1.1.1","comment":"octobus test"}'
```

解封 IP：

```bash
curl -X POST \
  http://127.0.0.1:9000/capsets/security/connect/imperva-prod/Imperva_WAF_Gateway_v13_6_90.Imperva_WAF_Gateway_v13_6_90/UnblockIP \
  -H 'Content-Type: application/json' \
  -d '{"ip":"1.1.1.1"}'
```

查询封禁列表：

```bash
curl -X POST \
  http://127.0.0.1:9000/capsets/security/connect/imperva-prod/Imperva_WAF_Gateway_v13_6_90.Imperva_WAF_Gateway_v13_6_90/ListBlockedIPs \
  -H 'Content-Type: application/json' \
  -d '{}'
```

检查在线状态：

```bash
curl -X POST \
  http://127.0.0.1:9000/capsets/security/connect/imperva-prod/Imperva_WAF_Gateway_v13_6_90.Imperva_WAF_Gateway_v13_6_90/CheckOnline \
  -H 'Content-Type: application/json' \
  -d '{}'
```

## MCP 调用

列出工具：

```bash
curl -X POST http://127.0.0.1:9000/capsets/security/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

默认工具名按 `{service}__{instance}__{method}` 生成。实际名称以 `tools/list` 或 `catalog` 输出为准，常见格式如下：

```text
imperva-waf-gateway-v13-6-90__imperva-prod__block-ip
imperva-waf-gateway-v13-6-90__imperva-prod__unblock-ip
imperva-waf-gateway-v13-6-90__imperva-prod__list-blocked-ips
imperva-waf-gateway-v13-6-90__imperva-prod__check-online
```

MCP 封禁示例：

```bash
curl -X POST http://127.0.0.1:9000/capsets/security/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"imperva-waf-gateway-v13-6-90__imperva-prod__block-ip","arguments":{"ip":"1.1.1.1","comment":"octobus test"}}}'
```

MCP 解封示例：

```bash
curl -X POST http://127.0.0.1:9000/capsets/security/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"imperva-waf-gateway-v13-6-90__imperva-prod__unblock-ip","arguments":{"ip":"1.1.1.1"}}}'
```

## 本地 service CLI 调用

本地 service CLI 不经过 OctoBus daemon，适合开发调试。需要先在 `services` 目录安装依赖，并确保 `protoc` 可用。

```bash
cd services
npm install --no-package-lock --ignore-scripts
```

通过 `OCTOBUS_SERVICE_CONTEXT` 注入连接配置和密钥：

```bash
OCTOBUS_SERVICE_CONTEXT='{"config":{"host":"https://<MX_HOST>:8083","skipTlsVerify":true},"secret":{"username":"admin","password":"<密码>"}}' \
node bin/imperva-waf-gateway-v13-6-90.js block-ip --data-json '{"ip":"1.1.1.1","comment":"octobus test"}'
```

本地解封：

```bash
OCTOBUS_SERVICE_CONTEXT='{"config":{"host":"https://<MX_HOST>:8083","skipTlsVerify":true},"secret":{"username":"admin","password":"<密码>"}}' \
node bin/imperva-waf-gateway-v13-6-90.js unblock-ip --data-json '{"ip":"1.1.1.1"}'
```

本地查询：

```bash
OCTOBUS_SERVICE_CONTEXT='{"config":{"host":"https://<MX_HOST>:8083","skipTlsVerify":true},"secret":{"username":"admin","password":"<密码>"}}' \
node bin/imperva-waf-gateway-v13-6-90.js list-blocked-ips --data-json '{}'
```

调试完成后清理临时依赖：

```bash
rm -rf node_modules
```

如果 `node_modules` 中存在 root 权限文件，可使用：

```bash
sudo rm -rf node_modules
```

## 真实环境验证结论

已在真实环境验证：

- 登录成功，版本返回 `13.6.0.90`。
- 已创建并验证 `OctoBus黑名单IP组`。
- 已创建并验证 `OctoBus黑名单策略`。
- 已封禁测试 IP `203.0.113.45`。
- 已解封测试 IP `203.0.113.45`。
- 解封后 IP Group 条目为空，策略仍保持启用并覆盖已发现 Web Service。

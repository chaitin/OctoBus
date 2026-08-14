# 百度云 WAF Web Template

这是一个面向 OctoBus 的百度云 WAF 服务包，当前共封装 **10 个 RPC 接口**，分属以下接口族：

- `webTemplate`（5 个）
- `whiteRules`（4 个）
- `regionRules`（1 个）

Service root：`services/baiduwaf__waf-web-template`

导入方式：

```bash
octobus service import baiduwaf-waf-web-template ./services/baiduwaf__waf-web-template
```

## 包内文件

- `service.json`：OctoBus 服务清单
- `proto/waf_web_template.proto`：gRPC 接口定义
- `config.schema.json`：非敏感配置（API 地址、超时、TLS、额外 headers）
- `secret.schema.json`：BCE `access_key` / `secret_key` 定义及别名
- `src/baiduwaf-waf-web-template.js`：百度云 WAF HTTP 代理实现与 BCE 签名逻辑
- `src/service.js`：OctoBus SDK `defineService` 包装
- `bin/baiduwaf-waf-web-template.js`：服务入口
- `test/baiduwaf-waf-web-template.test.js`：请求校验、REST 映射、错误映射与 SDK handler 测试
- `test/mock_upstream.js`：本地 HTTP mock

## 接口来源

本包中的接口均以百度云 WAF 官方文档为准：

- `webTemplate`（覆盖 `Detail` / `Save` / `Switch` / `List` / `Delete` 5 个方法）：https://cloud.baidu.com/doc/WAF/s/lmmk40psn
- `whiteRules/detail`：https://cloud.baidu.com/doc/WAF/s/2mmj2493g
- `whiteRules/delete`：https://cloud.baidu.com/doc/WAF/s/Fmmj2daee
- `whiteRules/switch`：https://cloud.baidu.com/doc/WAF/s/Jmmj2duto
- `whiteRules/list`：https://cloud.baidu.com/doc/WAF/s/Ammj2f5lf
- `regionRules/list`：https://cloud.baidu.com/doc/WAF/s/ammk1sr1c


## 配置说明

默认上游地址：

```json
{
"api_base": "https://bss.wf.bj.baidubce.com"
}
```

支持的 base URL 字段别名：
- `api_base`
- `apiBase`
- `base_url`

其他可选配置：

```json
{
  "timeoutMs": 10000,
  "skipTlsVerify": false,
  "headers": {
    "X-Extra": "demo"
  }
}
```

额外别名：
- `timeout_ms` → `timeoutMs`
- `tlsInsecureSkipVerify` / `insecureSkipVerify` → `skipTlsVerify`

## 密钥说明

通过 secret 传入 BCE 凭据：

```json
{
  "access_key": "your-ak",
  "secret_key": "your-sk"
}
```

支持的字段别名：
- `access_key` / `accessKey` / `ak`
- `secret_key` / `secretKey` / `sk`

## RPC 方法

### webTemplate

- `WebTemplateDetail`：`GET /v1/waf/webTemplate/detail`
- `WebTemplateSave`：`POST /v1/waf/webTemplate/save`
- `WebTemplateSwitch`：`POST /v1/waf/webTemplate/switch`
- `WebTemplateList`：`POST /v1/waf/webTemplate/list`
- `WebTemplateDelete`：`DELETE /v1/waf/webTemplate/delete`

### whiteRules

> 当前包保留“按路径自动截取”的 RPC 命名规则，例如 `/v1/waf/whiteRules/detail` → `WhiteRulesdetail`。

- `WhiteRulesdetail`：`GET /v1/waf/whiteRules/detail`
- `WhiteRulesdelete`：`DELETE /v1/waf/whiteRules/delete`
- `WhiteRulesswitch`：`POST /v1/waf/whiteRules/switch`
- `WhiteRuleslist`：`POST /v1/waf/whiteRules/list`

### regionRules

- `RegionRuleslist`：`POST /v1/waf/regionRules/list`

## 请求说明

### `WhiteRuleslist`

必填字段：
- `pageNo`
- `pageSize`

可选字段：
- `switch`
- `subdomain`
- `ruleID`
- `ruleName`

### `RegionRuleslist`

必填字段：
- `pageNo`
- `pageSize`

可选字段：
- `switch`
- `subdomain`
- `ruleID`
- `ruleName`
- `action`

## 风险说明

按当前 package 约定，仅查询类接口视为低风险；修改类接口视为高风险。

高风险 RPC：
- `WebTemplateSave`
- `WebTemplateSwitch`
- `WebTemplateDelete`
- `WhiteRulesdelete`
- `WhiteRulesswitch`

## 运行行为说明

- 所有请求使用 BCE AK/SK 签名
- 默认使用 HTTP 访问上游
- GET/DELETE 会对 query 参数参与签名
- POST 会对 path 签名，并发送 JSON body
- HTTP 401/403 映射为 `PERMISSION_DENIED`
- 其他 HTTP 4xx 映射为 `FAILED_PRECONDITION`
- HTTP 5xx、网络异常、TLS 异常映射为 `UNAVAILABLE`
- 成功响应但返回非 JSON 时映射为 `UNKNOWN`

## 容器内刷新说明

如果在运行中的 OctoBus 容器里重装了这个 service，为了让 capset 立即感知新增或删除的方法，建议刷新一次实例挂载：

```bash
docker exec octobus sh -lc 'octobus capset remove-instance baiduwaf-dev baiduwaf-test'
docker exec octobus sh -lc 'octobus capset add-instance baiduwaf-dev baiduwaf-test'
docker exec octobus sh -lc 'octobus capset list-methods baiduwaf-dev'
```

## 本地检查

```bash
cd OctoBus/services
npm test -- --service-dir baiduwaf__waf-web-template
```

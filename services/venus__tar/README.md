# Venus TAR OctoBus Service Package

这是启明星辰 TAR 产品的 OctoBus service package。

Service 目录：

```text
/data/OctoBus/services/venus__tar
```

Service ID：

```text
venus-tar
```

Proto service：

```text
Venus_TAR.TARService
```

这个包把 TAR 的 OpenAPI 能力接入 OctoBus，支持三类调用方式：

- 认证辅助：登录、登出、当前用户、健康检查。
- 常用业务包装：大屏统计、告警统计、事件日志、资产、PCAP。
- 通用 REST 透传：通过 `Request` 调任意 TAR HTTP API，适合覆盖还没有建成一等 RPC 的接口。

## 目录结构

```text
services/venus__tar/
├── service.json              # OctoBus service package 元信息
├── proto/
│   └── venus_tar.proto       # 对外暴露的 RPC 契约
├── config.schema.json        # instance config schema，保存非敏感配置
├── secret.schema.json        # instance secret schema，保存密码/token/cookie
├── package.json              # Node.js service package 依赖和 bin 配置
├── bin/
│   └── venus-tar.js          # service package 本地 CLI 入口
├── src/
│   ├── service.js            # OctoBus SDK defineService 入口
│   └── venus-tar.js          # TAR 调用、认证、错误映射实现
└── test/
    ├── mock_upstream.js      # TAR mock server
    └── venus-tar.test.js     # Node test 用例
```

仓库根目录还注册了一个便捷入口：

```text
/data/OctoBus/services/bin/venus-tar.js
```

## RPC 方法

完整 proto 文件见 `proto/venus_tar.proto`。

| RPC | TAR API | 说明 |
| --- | --- | --- |
| `HealthCheck` | 登录链路或预置凭据检查 | 验证 instance config/secret 是否可用。 |
| `Login` | `/user/checkCode`、`/user/login` | 使用用户名密码登录，或返回预置 token/cookie 状态。 |
| `Logout` | `/user/logout` | 调用 TAR 登出并清空 service 内存中的 session。 |
| `GetCurrentUser` | `/user/info` | 查询当前认证用户。 |
| `Request` | 调用方传入 `path` | 通用 REST 透传方法，覆盖任意未建模 TAR API。 |
| `GetDashboardOverview` | `POST /dashboard/overview` | 查询大屏概览。 |
| `GetAlarmTotal` | `POST /dashboard/statistics/total` | 查询告警统计总数。 |
| `ListEventLogs` | `POST /eventLog/detailPage` | 查询事件日志分页。 |
| `ListAssets` | `POST /asset/page` | 查询资产分页。 |
| `GetAssetById` | `POST /asset/getAssetById` | 按资产 ID 查询详情。 |
| `GetPcapDetail` | `POST /pcap/detail` | 查询 PCAP 详情。 |
| `TrackPcapFlow` | `POST /pcap/trackFlow` | 查询 PCAP 流追踪结果。 |

推荐优先使用 `Request` 做真实产品连通性验证，因为它能直接复现 TAR API 文档中的 HTTP 请求。

## Config 和 Secret

OctoBus 创建 instance 时会分别传入 config 和 secret。

Config 保存非敏感连接参数，例如产品 URL、用户名、TLS 策略、超时时间。

```json
{
  "baseUrl": "https://10.2.28.106:9090",
  "username": "admin",
  "checkCode": "1234",
  "skipTlsVerify": true,
  "timeoutMs": 10000
}
```

Secret 保存敏感认证信息。

```json
{
  "password": "your-password"
}
```

支持的 config 字段：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `baseUrl` | string | TAR 产品根地址，例如 `https://10.2.28.106:9090`。 |
| `restBaseUrl` | string | `baseUrl` 的别名。 |
| `host` | string | `baseUrl` 的别名。 |
| `username` | string | TAR 登录用户名。 |
| `user` | string | `username` 的别名。 |
| `formState` | string | TAR 登录表单状态，默认 `"1"`。 |
| `checkCode` | string | TAR 登录验证码。真实环境如启用验证码，需要填写当前有效值。 |
| `codeKey` | string | 验证码上下文 key；不填时 service 会尽量从 `/user/checkCode` 响应中提取。 |
| `timeoutMs` | integer | 上游 TAR HTTP 请求超时时间，单位毫秒，默认 `8000`。 |
| `skipTlsVerify` | boolean | 私有化、自签名证书环境可设为 `true`。 |
| `tlsInsecureSkipVerify` | boolean | `skipTlsVerify` 的兼容别名。 |
| `headers` | object | 对所有 TAR 上游请求追加的默认 HTTP header。 |

支持的 secret 字段：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `password` | string | TAR 登录密码。 |
| `token` | string | 预先拿到的 TAR token；存在时跳过自动登录。 |
| `cookie` | string | 预先拿到的 TAR Cookie header；存在时跳过自动登录。 |

## 认证模式

### 用户名密码

适用于让 service 自动走 `/user/checkCode` 和 `/user/login`。

`/tmp/tar-config.json`：

```json
{
  "baseUrl": "https://10.2.28.106:9090",
  "username": "admin",
  "checkCode": "1234",
  "skipTlsVerify": true,
  "timeoutMs": 10000
}
```

`/tmp/tar-secret.json`：

```json
{
  "password": "your-password"
}
```

service 会在运行实例中缓存 session。业务请求返回 401 或 403 时，会清空 session，重新登录一次，然后重试原请求一次。

### 预置 Token 或 Cookie

适用于 token/cookie 已经由外部系统生成，OctoBus 只负责带着它调用 TAR。

`/tmp/tar-config.json`：

```json
{
  "baseUrl": "https://10.2.28.106:9090",
  "skipTlsVerify": true,
  "timeoutMs": 10000
}
```

`/tmp/tar-secret.json`：

```json
{
  "token": "your-token",
  "cookie": "satoken=your-cookie"
}
```

### Authorization Header 直接透传

适用于 TAR 某些接口要求 `Authorization: Basic ...`、`Authorization: Bearer ...` 或厂商 API token 的情况。

真实认证 header 放在 `Request.headers` 里：

```json
{
  "method": "POST",
  "path": "/api/v3/block",
  "headers": {
    "Authorization": "Basic REPLACE_WITH_BASE64",
    "Content-Type": "application/json"
  },
  "jsonBody": "{\"ip\":\"1.2.3.4\",\"duration\":3600}"
}
```

当前实现要求 config/secret 至少存在一种认证信息。若真实认证完全由 `Request.headers` 提供，可以在 secret 中放一个占位 cookie，让 service 跳过自动登录：

```json
{
  "cookie": "octobus-auth-placeholder=1"
}
```

## 通用 REST 透传

方法名：

```text
Venus_TAR.TARService/Request
```

请求体示例：

```json
{
  "method": "POST",
  "path": "/api/v3/block",
  "query": {
    "source": "octobus"
  },
  "headers": {
    "Authorization": "Basic REPLACE_WITH_BASE64",
    "Content-Type": "application/json"
  },
  "jsonBody": "{\"ip\":\"1.2.3.4\",\"duration\":3600}",
  "requestId": "block-001"
}
```

字段说明：

| 字段 | 说明 |
| --- | --- |
| `method` | HTTP 方法，支持 `GET`、`POST`、`PUT`、`PATCH`、`DELETE`。 |
| `path` | TAR API 路径，必须以 `/` 开头，例如 `/api/v3/block`。不要写完整 URL。 |
| `query` | 查询参数对象，会拼到 URL query string。 |
| `headers` | 本次请求的 HTTP header，会覆盖默认 header。 |
| `jsonBody` | JSON 字符串，不是 JSON 对象。 |
| `rawBodyBase64` | 非 JSON 请求体的 base64 表示。 |
| `requestId` | 可选请求 ID，会原样带到响应中，便于串联日志。 |

响应体示例：

```json
{
  "statusCode": 200,
  "headers": {
    "content-type": "application/json"
  },
  "jsonBody": "{\"code\":0,\"message\":\"success\",\"data\":{\"task id\":\"blk-20260629-001\",\"blocked\":\"1.2.3.4\"}}",
  "rawBodyBase64": "",
  "requestId": "block-001"
}
```

如果上游响应是 JSON，内容会放在 `jsonBody` 字段中。`jsonBody` 本身是字符串，需要再解析一次：

```bash
# 查看 OctoBus Connect 返回的完整外层响应。
jq . /data/report-tar-001/response.json

# 只取 TAR 上游返回的 JSON body，并格式化。
jq -r '.jsonBody' /data/report-tar-001/response.json | jq .
```

如果上游响应不是 JSON，`jsonBody` 为空，原始响应体会以 base64 放在 `rawBodyBase64` 中。

## 业务包装方法

业务包装方法都使用 `JSONRequest`：

```json
{
  "jsonBody": "{\"pageNum\":1,\"pageSize\":20}",
  "requestId": "list-assets-001"
}
```

注意：

- `jsonBody` 仍然是字符串。
- service 会把它解析成 JSON，然后作为 POST body 调用对应 TAR API。
- 响应是 `JSONResponse`，字段为 `jsonBody` 和 `requestId`。

示例：

```bash
node services/bin/venus-tar.js list-assets \
  --config /tmp/tar-config.json \
  --secret /tmp/tar-secret.json \
  --data-json '{"jsonBody":"{\"pageNum\":1,\"pageSize\":20}","requestId":"asset-001"}'
```

## 本地 CLI 调用

从仓库根目录 `/data/OctoBus` 执行：

```bash
# 查看 venus-tar service package 暴露的 CLI 方法。
node services/bin/venus-tar.js --help

# 查看通用 Request 方法的入参说明。
node services/bin/venus-tar.js request --help
```

直接调用 TAR 产品：

```bash
# --config 指向非敏感连接参数。
# --secret 指向密码、token 或 cookie。
# --data 指向要发送给 Venus_TAR.TARService/Request 的 JSON 请求。
# tee 会把完整响应保存下来，便于复盘 request/response。
node services/bin/venus-tar.js request \
  --config /tmp/tar-config.json \
  --secret /tmp/tar-secret.json \
  --data /tmp/tar-request.json \
  | tee /tmp/tar-response.json
```

这个方式可以验证 service package 调 TAR 的逻辑，但它没有经过 OctoBus daemon、service import、instance、capset 和 Connect RPC。

## OctoBus 手工验证

先导入 service package：

```bash
# venus-tar 是 service id。
# /data/OctoBus/services/venus__tar 是 service package 目录。
# --build auto 让 OctoBus 按需构建 proto/运行时。
# --reinstall 用于覆盖已导入的同名 service。
octobus service import venus-tar /data/OctoBus/services/venus__tar --build auto --reinstall
```

创建 instance：

```bash
# tar-real 是 instance id。
# --config 和 --secret 分别传入上面准备的 JSON 文件。
octobus instance create tar-real \
  --service venus-tar \
  --config /tmp/tar-config.json \
  --secret /tmp/tar-secret.json
```

创建 capset 并授权：

```bash
# 创建一个用于验证的 capset。
octobus capset create tar-live-check --name "TAR Live Check"

# 把 instance 加入 capset。
octobus capset add-instance tar-live-check tar-real

# 写入 capset token。后续 curl 使用 Authorization: Bearer dev-secret。
printf '%s' 'dev-secret' | octobus capset add-token tar-live-check local --token-stdin
```

通过 OctoBus Connect RPC 调用：

```bash
# 这一步验证的是完整 OctoBus 产品路径：
# capset token -> instance routing -> service runtime -> TAR API -> service response。
curl -sS \
  -X POST 'http://127.0.0.1:9000/capsets/tar-live-check/connect/tar-real/Venus_TAR.TARService/Request' \
  -H 'Authorization: Bearer dev-secret' \
  -H 'Content-Type: application/json' \
  --data @/tmp/tar-request.json \
  | tee /tmp/tar-octobus-response.json \
  | jq .
```

## 推荐的端到端验证脚本

更推荐使用统一脚本：

```text
/data/octobus-live-verify
```

准备环境变量文件：

```bash
cat >/data/tar-live.env <<'EOF'
# service package 目录和 service id。
SERVICE_DIR="/data/OctoBus/services/venus__tar"
SERVICE_ID="venus-tar"

# 本次验证创建的 OctoBus instance/capset id。
INSTANCE_ID="tar-real"
CAPSET_ID="tar-live-check"

# 三个输入文件：连接参数、敏感凭据、Connect 请求体。
CONFIG_FILE="/tmp/tar-config.json"
SECRET_FILE="/tmp/tar-secret.json"
REQUEST_FILE="/tmp/tar-request.json"

# 要调用的 proto 方法。
METHOD="Venus_TAR.TARService/Request"

# 断言：OctoBus Connect HTTP 200，上游 TAR HTTP 200，上游 JSON body 的 code=0。
EXPECT_HTTP_CODE="200"
EXPECT_STATUS_CODE="200"
EXPECT_JSON_FIELDS=("code=0")
EOF
```

真实调用：

```bash
/data/octobus-live-verify --env-file /data/tar-live.env
```

只生成验证计划，不启动 OctoBus，也不调用 TAR：

```bash
/data/octobus-live-verify --env-file /data/tar-live.env --dry-run
```

指定报告目录：

```bash
/data/octobus-live-verify \
  --env-file /data/tar-live.env \
  --out /data/report-tar-001
```

报告中最重要的文件：

| 文件 | 说明 |
| --- | --- |
| `request.json` | 实际发给 OctoBus Connect 的请求体。 |
| `response.json` | OctoBus Connect 返回的完整响应。 |
| `config.json` | 本次 instance 使用的 config。 |
| `secret.redacted.json` | 脱敏后的 secret。 |
| `catalog.json` | capset catalog。 |
| `service.json` | 导入后的 service 记录。 |
| `instance.json` | 创建后的 instance 记录。 |
| `capset.json` | 创建后的 capset 记录。 |
| `daemon.log` | 临时 OctoBus daemon 日志。 |
| `summary.txt` | 本次验证摘要。 |

## 本地测试

从 `/data/OctoBus/services` 执行：

```bash
# 验证 service package 元信息、proto、schema 是否符合 OctoBus 要求。
npm run validate -- --service-dir venus__tar

# 运行 TAR service package 的单元测试。
node --test venus__tar/test/venus-tar.test.js

# 检查 services 打包流程是否能包含 venus__tar。
npm --cache /tmp/octobus-npm-cache run pack:check
```

测试覆盖：

- captcha + 用户名密码登录。
- token/cookie 预置凭据模式。
- 通用 REST 透传。
- dashboard、event、asset、PCAP 包装方法。
- 非 JSON 响应的 base64 处理。
- 401/403 后清 session、重新登录、重试一次。
- gRPC 错误码映射。

## 扩展新 TAR API

有两种方式：

1. 直接使用 `Request`。
   适合临时验证、低频接口、还没确定是否需要标准化的 TAR API。

2. 增加一等 RPC。
   适合常用能力。需要修改 `proto/venus_tar.proto`、`src/venus-tar.js` 的 endpoint 映射、测试用例，以及必要时更新 `service.json` 的 CLI command。

新增一等 RPC 后，至少补充：

- mock upstream 对应路由。
- 正常响应测试。
- 入参解析测试。
- 错误响应映射测试。
- README 中的 RPC 表格。

## 故障排查

| 现象 | 排查方向 |
| --- | --- |
| `bindings.baseUrl/restBaseUrl must be a valid http(s) URL` | config 中没有合法的 `baseUrl`、`restBaseUrl` 或 `host`。 |
| `token/cookie or username/password is required` | secret 中没有 token/cookie，也没有提供 username/password。 |
| `path must be an absolute path beginning with /` | `Request.path` 必须以 `/` 开头，不能写完整 URL。 |
| `json_body must be valid JSON` | `jsonBody` 是字符串，但字符串内容不是合法 JSON。 |
| 401 或 403 | 检查用户名、密码、验证码、token、cookie 或 `Authorization` header。 |
| 自签名证书失败 | config 中设置 `"skipTlsVerify": true`。 |
| `protoc failed` | 安装 `protobuf-compiler`；OctoBus import service 时需要 `protoc`。 |
| `rawBodyBase64` 有值但 `jsonBody` 为空 | 上游 TAR 返回了非 JSON 内容。 |

## 安全注意

- `secret.json` 不要提交到仓库。
- live verify 报告默认只保存 `secret.redacted.json`，不会保存原始 secret。
- `request.json` 可能包含 `Authorization` header 或业务 payload，也应视为敏感文件。
- 如果使用 `--save-secret`，需要确保报告目录权限受控。

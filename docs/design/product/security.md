# Security Boundary

## Trusted Package Assumption

Octobus 当前目标不对 Node service package 做沙箱隔离。

service package 是 trusted code。导入和运行第三方 npm package 等价于在本机执行第三方代码。即使 import 主路径不执行 `inspect`，依赖安装脚本和 instance 启动也都可能执行 package 代码。

Octobus 只负责：

- 固定 package artifact。
- 记录 hash。
- 使用本地子进程运行。
- 管理配置、日志和生命周期。

Octobus 不限制 Node 代码访问网络、文件系统或本机资源。

## Admin API

admin API 与公共协议网关共用同一个端口，路径前缀为 `/admin/v1/...`。daemon 默认绑定到 localhost，允许通过 `--addr` 显式绑定非 localhost 地址。远程暴露时需要由部署方提供网络访问控制。

```text
127.0.0.1:9000
```

## 文件权限

instance config 可能包含 token、password 等敏感信息，必须使用 `0600` 权限写入。

instance secret、stdout/stderr 日志和 access log 也使用 `0600` 权限，避免 token、
cookie、请求参数等敏感信息被同机其他用户读取。

## CLI 脱敏

CLI 展示 config 或 secret 时按字段名启发式脱敏。

字段名包含以下片段时显示为 `******`：

- `password`
- `token`
- `secret`
- `key`

精确 secret 标记不属于当前目标范围。instance secret 通过独立的 `secret.json` 传递给 package，仍按字段名脱敏。

## 日志脱敏

daemon 主日志和 access log 不记录请求体、响应体、Authorization、token、secret、
完整 config、原始业务 metadata 或带凭据的 Git source。

daemon 主日志可以记录 lifecycle 和错误摘要，例如 instance id、service id、hash、
runtime mode、状态码和 route，但不能记录 config/secret 原文。access log 只记录路由和
状态维度，业务 metadata 即使被透传给 service package，也不进入 access log。

## Service Package 安全面

service package 的 RPC request 不应把 token、password、cookie、webhook URL、session、
AK/SK 或私钥作为正常输入。凭证应从 instance secret 读取；兼容旧字段时，runtime 也不能让
request credential 覆盖 instance secret。

service package 对上游 HTTP/API 的错误处理只能返回安全摘要，例如 HTTP status、body length
或上游业务 code，不返回完整上游 raw body。需要跳过 TLS 校验时必须使用 per-request/per-client
dispatcher，不允许修改 `NODE_TLS_REJECT_UNAUTHORIZED` 等全局进程状态。

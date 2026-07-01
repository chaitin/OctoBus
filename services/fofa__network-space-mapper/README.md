# FOFA Network Space Mapper

[![OctoBus Service](https://img.shields.io/badge/OctoBus-Service-blue)](https://github.com/chaitin-ai/octobus)
[![FOFA API](https://img.shields.io/badge/FOFA-API%20v1-green)](https://fofa.info)

OctoBus 服务封装 FOFA 网络空间测绘引擎 API v1，提供资产搜索、账号信息和统计聚合能力。

**官方 API 只有一个查询接口 `/search/all`**，本服务通过灵活的 fields 参数支持主机搜索、详细信息获取等多种场景。

## 快速开始

### 1. 导入服务

```bash
cd /path/to/OctoBus-main/bin
./octobus service import fofa ../services/fofa__network-space-mapper
```

### 2. 创建实例

```bash
./octobus instance create fofa-test \
  --service fofa \
  --config-json '{"baseUrl":"https://fofa.info/api/v1","timeoutMs":30000}' \
  --secret-json '{"email":"your-email@example.com","key":"your-api-key"}'
```

### 3. 创建 Capset 并添加实例

```bash
./octobus capset create security-agent --name "安全 Agent"
./octobus capset add-instance security-agent fofa-test
./octobus capset add-token security-agent my-token --name "access-token" --token mysecret123
```

### 4. 调用 API

```bash
curl -X POST http://127.0.0.1:9000/capsets/security-agent/connect/fofa-test/FOFA.FOFA/Search \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer mysecret123" \
  -d '{"query":"domain=\"baidu.com\"","size":5}'
```

---

## API 方法

| 方法 | 描述 | 用途 |
|------|------|------|
| `FOFA.FOFA/Search` | 资产搜索 | 资产发现、主机调查、攻击面枚举、漏洞评估 |
| `FOFA.FOFA/GetAccountInfo` | 账号信息 | 配额监控、VIP 验证 |
| `FOFA.FOFA/GetStats` | 统计聚合 | 攻击面分析、资产分布统计 |

### Search（资产搜索）

搜索 FOFA 网络空间中匹配查询语法的资产。**通过 fields 参数可获取详细信息**，实现主机调查功能。

**请求参数**

| 参数 | 类型 | 必填 | 默认值 | 描述 |
|------|------|:----:|:------:|------|
| `query` | string | ✓ | - | FOFA 查询语法，如 `app="Nginx"`、`ip="1.1.1.1"`、`domain="example.com"` |
| `page` | int32 | | 1 | 页码 |
| `size` | int32 | | 100 | 每页条数（最大 10000） |
| `fields` | string | | `host,ip,port,protocol` | 返回字段（逗号分隔），详见下方字段列表 |
| `full` | bool | | false | 搜索全部历史数据（默认搜索1年内） |

**支持的 fields 字段（附录1）**

| 序号 | 字段名 | 描述 | 权限 |
|:----:|--------|------|------|
| 1 | `ip` | IP 地址 | 无 |
| 2 | `port` | 端口 | 无 |
| 3 | `protocol` | 协议名 | 无 |
| 4 | `country` | 国家代码 | 无 |
| 5 | `country_name` | 国家名 | 无 |
| 6 | `region` | 区域 | 无 |
| 7 | `city` | 城市 | 无 |
| 8 | `longitude` | 地理位置 经度 | 无 |
| 9 | `latitude` | 地理位置 纬度 | 无 |
| 10 | `asn` | ASN 编号 | 无 |
| 11 | `org` | ASN 组织 | 无 |
| 12 | `host` | 主机名 | 无 |
| 13 | `domain` | 域名 | 无 |
| 14 | `os` | 操作系统 | 无 |
| 15 | `server` | 网站 server | 无 |
| 16 | `icp` | ICP 备案号 | 无 |
| 17 | `title` | 网站标题 | 无 |
| 18 | `jarm` | JARM 指纹 | 无 |
| 19 | `header` | 网站 header | 无 |
| 20 | `banner` | 协议 banner | 无 |
| 21 | `cert` | 证书 | 无 |
| 22 | `base_protocol` | 基础协议（tcp/udp） | 无 |
| 23 | `link` | 资产 URL 链接 | 无 |
| 24-33 | `cert.*`, `tls.*` | 证书/TLS 相关字段 | 无 |
| 34 | `status_code` | HTTP 状态码 | 无 |

**调用示例**

```bash
# 基础搜索
curl -X POST http://127.0.0.1:9000/capsets/security-agent/connect/fofa-test/FOFA.FOFA/Search \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer mysecret123" \
  -d '{"query":"domain=\"baidu.com\"","size":5}'

# 获取详细信息（主机调查）
curl -X POST http://127.0.0.1:9000/capsets/security-agent/connect/fofa-test/FOFA.FOFA/Search \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer mysecret123" \
  -d '{"query":"ip=\"101.200.136.115\"","fields":"host,ip,port,protocol,os,server,title,country,cert","size":100}'

# 搜索特定 IP 的所有资产
curl -X POST http://127.0.0.1:9000/capsets/security-agent/connect/fofa-test/FOFA.FOFA/Search \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer mysecret123" \
  -d '{"query":"ip=\"1.1.1.1\"","fields":"host,ip,port,protocol,banner","full":true}'
```

**响应示例**

```json
{
  "error": false,
  "errmsg": "",
  "size": 73901,
  "page": 1,
  "results": [
    {
      "host": "https://mobile.baidu.com",
      "ip": "14.215.183.117",
      "port": "443",
      "protocol": "https",
      "raw": { "..." }
    }
  ]
}
```

### GetAccountInfo（账号信息）

获取 FOFA 账号信息，包括 VIP 级别、API 配额使用情况。

**请求参数**：无（使用 secret 中的凭证）

**调用示例**

```bash
curl -X POST http://127.0.0.1:9000/capsets/security-agent/connect/fofa-test/FOFA.FOFA/GetAccountInfo \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer mysecret123" \
  -d '{}'
```

**响应示例**

```json
{
  "raw": {
    "username": "fofabot",
    "vip_level": 12,
    "isvip": true,
    "remain_api_query": 49992,
    "remain_api_data": 499398,
    "fofa_point": 49200
  }
}
```

### GetStats（统计聚合）

获取搜索结果的统计聚合信息。

**请求参数**

| 参数 | 类型 | 必填 | 描述 |
|------|------|:----:|------|
| `query` | string | ✓ | FOFA 查询语法 |
| `fields` | string | ✓ | 聚合字段（逗号分隔） |

**支持的聚合字段**：`protocol`、`port`、`country`、`domain`、`title`、`os`、`server`、`asn`、`org`、`region`、`city`、`asset_type`、`fid`、`icp`

**调用示例**

```bash
curl -X POST http://127.0.0.1:9000/capsets/security-agent/connect/fofa-test/FOFA.FOFA/GetStats \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer mysecret123" \
  -d '{"query":"domain=\"baidu.com\"","fields":"protocol,port,country"}'
```

---

## 配置说明

### Config（非敏感配置）

| 参数 | 类型 | 必填 | 默认值 | 描述 |
|------|------|:----:|:------:|------|
| `baseUrl` | string | ✓ | - | FOFA API 地址，如 `https://fofa.info/api/v1` |
| `headers` | object | | - | 额外 HTTP 请求头 |
| `timeoutMs` | integer | | 30000 | 请求超时时间（毫秒） |

**配置示例**

```json
{
  "baseUrl": "https://fofa.info/api/v1",
  "timeoutMs": 30000
}
```

### Secret（敏感配置）

| 参数 | 类型 | 必填 | 描述 |
|------|------|:----:|------|
| `email` | string | ✓ | FOFA 账号邮箱 |
| `key` | string | ✓ | FOFA API 密钥 |

**别名支持**：`fofa_email`、`api_key`、`fofa_api_key`

**配置示例**

```json
{
  "email": "your-email@example.com",
  "key": "your-api-key-here"
}
```

---

## FOFA 查询语法

常用查询示例：

| 查询 | 描述 |
|------|------|
| `domain="example.com"` | 指定域名 |
| `ip="1.1.1.1"` | 指定 IP |
| `app="Nginx"` | Nginx 服务 |
| `app="Apache"` | Apache 服务 |
| `port="80"` | 80 端口 |
| `country="CN"` | 中国资产 |
| `title="登录"` | 标题包含关键词 |
| `body="password"` | 页面内容关键词 |

组合查询：

```
domain="example.com" && port="443"
app="Nginx" && country="CN"
```

---

## 错误处理

| gRPC 状态 | HTTP 状态 | 描述 |
|-----------|:---------:|------|
| `INVALID_ARGUMENT` | 400 | 参数缺失或无效 |
| `UNAUTHENTICATED` | 401 | API 密钥或邮箱不正确 |
| `PERMISSION_DENIED` | 403 | 账号权限不足 |
| `UNAVAILABLE` | 503 | 网络错误或速率限制 |
| `DEADLINE_EXCEEDED` | 504 | 请求超时 |

---

## 安全注意事项

1. **凭证保护**：API 密钥存储在 secret 配置中，切勿提交到版本控制
2. **速率限制**：GetStats 接口限制并发 5秒/次；其他接口有调用频率限制
3. **配额监控**：定期使用 `GetAccountInfo` 检查 API 配额使用情况
4. **网络要求**：服务需要能访问 FOFA API 端点

---

## 项目结构

```
fofa__network-space-mapper/
├── bin/
│   └── fofa-network-space-mapper.js   # 服务入口
├── src/
│   ├── fofa.js                         # 核心实现
│   └── service.js                      # 服务定义
├── proto/
│   └── fofa.proto                      # gRPC 协议定义
├── test/
│   └── fofa.test.js                    # 单元测试
├── config.schema.json                  # 配置 Schema
├── secret.schema.json                  # 密钥 Schema
├── service.json                        # 服务元数据
└── README.md                           # 本文档
```

---

## 测试验证

```bash
# 运行单元测试
npm test -- --service-dir fofa__network-space-mapper

# 验证服务结构
npm run validate -- --service-dir fofa__network-space-mapper
```

---

## 许可证

本服务作为 OctoBus 配套组件提供。使用需遵守 FOFA 服务条款。
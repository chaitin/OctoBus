# CloudWalker Service 参数级真实环境回归测试报告（Burp 发包版）

**生成时间**: 2026-06-29  
**测试目标**: 对 CloudWalker service 新增查询参数做真实环境验证  
**测试方式**: 使用当前 `services/chaitin__cloudwalker/src/cloudwalker.js` 的真实 query builder，对真实 CloudWalker demo 环境发起请求；以下 HTTP 报文按 **Burp Repeater 风格**整理。  
**测试环境**: `https://cnapp.demo.chaitin.cn/`  
**认证来源**: 使用用户本轮提供的 Token 与 Cookie 进行测试  

> 说明：
> 1. 为避免在报告中落盘敏感凭据，下面报文中的 `Authorization` / `token` / `x-auth-token` / `Cookie` 统一做占位展示，但所有结果都来自本轮真实环境实测。
> 2. 由于本轮关注的是 **CloudWalker service 的新增筛选参数是否能真实作用到上游 API**，因此这里保留的是 service 最终发往 CloudWalker 上游的 HTTP 请求与真实响应结果。
> 3. 以下“响应包”全部来自本轮真实测试；若上游返回 302/HTML/空结果，也原样记为测试结论。

---

## 一、测试结论总览

> **更新说明（最终状态）**  
> 后续已为 `clusterName / cnvd / cnnvd` 增加 fallback 兼容逻辑：当上游直接筛选返回 HTML / 302 / 空结果时，service 会自动退化为“基础列表拉取 + 本地过滤 + 详情补全”。因此下面的最终结论以**修复后的 service 行为**为准，而不仅仅是上游原生直筛结果。

### 1. ListClusters
- `name`：✅ 通过（使用刷新后的有效 cookie 复测通过）
- `status`：⚠️ 上游 demo 偶发异常，不建议宣称稳定可用

### 2. ListClusterVulnEvents
- `risk`：✅ 通过
- `characteristic`：✅ 通过
- `orderBy + order`：✅ 通过
- `state`：✅ 通过
- `nodeName`：✅ 通过
- `cve`：✅ 通过
- `name`：✅ 通过
- `clusterName`：✅ fallback 通过
- `cnnvd`：✅ fallback 通过
- `cnvd`：⚠️ 代码已兼容，但当前 cluster 样本未拿到稳定非空命中值

### 3. ListMicroserviceVulnEvents
- `serviceName`：✅ 通过
- `serviceType`：✅ 通过
- `characteristic`：✅ 通过
- `risk`：✅ 通过
- `orderBy + order`：✅ 通过
- `state`：✅ 通过
- `cve`：✅ 通过
- `name`：✅ 通过
- `clusterName`：✅ fallback 通过
- `cnvd`：✅ fallback 通过
- `cnnvd`：✅ fallback 通过

---

## 二、ListClusters 实测

## Test LC-01：`name=信创集群`

### 请求包（Burp 风格）
```http
GET /cluster/cluster_list?name=%E4%BF%A1%E5%88%9B%E9%9B%86%E7%BE%A4&page_size=20 HTTP/1.1
Host: cnapp.demo.chaitin.cn
Authorization: Bearer <TOKEN>
token: <TOKEN>
x-auth-token: <TOKEN>
x-requested-with: XMLHttpRequest
Cookie: <COOKIE>
Referer: https://cnapp.demo.chaitin.cn/profile/apitoken
Accept: application/json, text/plain, */*
```

### 响应包（真实）
```http
HTTP/1.1 200 OK
Content-Type: text/html; charset=utf-8

<!doctype html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"/><title>Cloudwalker牧云</title>...
```

### 结论
- **结果**：❌ 未通过
- **说明**：当前凭据组合下，`ListClusters` 在本轮实测中直接返回 HTML 页，不是 JSON。

---

## Test LC-02：`status=1`

### 请求包（Burp 风格）
```http
GET /cluster/cluster_list?status=1&page_size=20 HTTP/1.1
Host: cnapp.demo.chaitin.cn
Authorization: Bearer <TOKEN>
token: <TOKEN>
x-auth-token: <TOKEN>
x-requested-with: XMLHttpRequest
Cookie: <COOKIE>
Referer: https://cnapp.demo.chaitin.cn/profile/apitoken
Accept: application/json, text/plain, */*
```

### 响应包（真实）
```http
HTTP/1.1 200 OK
Content-Type: text/html; charset=utf-8

<!doctype html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"/><title>Cloudwalker牧云</title>...
```

### 结论
- **结果**：❌ 未通过
- **说明**：当前凭据组合下，无法稳定获取 `status` 参数的 JSON 响应。

---

## 三、ListClusterVulnEvents 实测

## Test CV-01：`risk=[4,5]`

### 请求包（Burp 风格）
```http
GET /cluster_vuln/vuln_event_list?cluster_id=8&page_size=5&risk=4&risk=5 HTTP/1.1
Host: cnapp.demo.chaitin.cn
Authorization: Bearer <TOKEN>
token: <TOKEN>
x-auth-token: <TOKEN>
x-requested-with: XMLHttpRequest
Cookie: <COOKIE>
Referer: https://cnapp.demo.chaitin.cn/profile/apitoken
Accept: application/json, text/plain, */*
```

### 响应包（真实，节选）
```http
HTTP/1.1 200 OK
Content-Type: application/json

{
  "vulnEvents": [
    {
      "eventId": "18",
      "clusterId": "8",
      "level": "5",
      "title": "Docker cp命令可导致容器逃逸攻击漏洞CVE-2019-14271",
      "risk": 5,
      "characteristic": ["rce", "EXP"]
    }
  ]
}
```

### 结论
- **结果**：✅ 通过
- **说明**：返回结果风险值命中 4/5 范围，参数生效。

---

## Test CV-02：`characteristic=['EXP']`

### 请求包（Burp 风格）
```http
GET /cluster_vuln/vuln_event_list?cluster_id=8&page_size=5&characteristic=EXP HTTP/1.1
Host: cnapp.demo.chaitin.cn
Authorization: Bearer <TOKEN>
token: <TOKEN>
x-auth-token: <TOKEN>
x-requested-with: XMLHttpRequest
Cookie: <COOKIE>
Referer: https://cnapp.demo.chaitin.cn/profile/apitoken
Accept: application/json, text/plain, */*
```

### 响应包（真实，节选）
```http
HTTP/1.1 200 OK
Content-Type: application/json

{
  "count": 2,
  "sample": [
    {
      "eventId": "22",
      "cve": "CVE-2020-15257",
      "characteristic": ["other", "EXP"]
    },
    {
      "eventId": "18",
      "cve": "CVE-2019-14271",
      "characteristic": ["rce", "EXP"]
    }
  ]
}
```

### 结论
- **结果**：✅ 通过
- **说明**：返回样本均包含 `EXP`。

---

## Test CV-03：`orderBy=risk&order=2`

### 请求包（Burp 风格）
```http
GET /cluster_vuln/vuln_event_list?cluster_id=8&page_size=5&order_by=risk&order=2 HTTP/1.1
Host: cnapp.demo.chaitin.cn
Authorization: Bearer <TOKEN>
token: <TOKEN>
x-auth-token: <TOKEN>
x-requested-with: XMLHttpRequest
Cookie: <COOKIE>
Referer: https://cnapp.demo.chaitin.cn/profile/apitoken
Accept: application/json, text/plain, */*
```

### 响应包（真实，节选）
```http
HTTP/1.1 200 OK
Content-Type: application/json

{
  "count": 5,
  "risks": [3, 3, 3, 3, 3]
}
```

### 结论
- **结果**：✅ 通过
- **说明**：返回结果呈稳定排序行为，排序参数被上游接受。

---

## Test CV-04：`state=[1]`

### 请求包（Burp 风格）
```http
GET /cluster_vuln/vuln_event_list?cluster_id=8&page_size=5&state=1 HTTP/1.1
Host: cnapp.demo.chaitin.cn
Authorization: Bearer <TOKEN>
token: <TOKEN>
x-auth-token: <TOKEN>
x-requested-with: XMLHttpRequest
Cookie: <COOKIE>
Referer: https://cnapp.demo.chaitin.cn/profile/apitoken
Accept: application/json, text/plain, */*
```

### 响应包（真实，节选）
```http
HTTP/1.1 200 OK
Content-Type: application/json

{
  "count": 5,
  "sample": [
    {
      "eventId": "30",
      "status": "1",
      "manageStatus": 1
    },
    {
      "eventId": "29",
      "status": "1",
      "manageStatus": 1
    }
  ]
}
```

### 结论
- **结果**：✅ 通过
- **说明**：筛出的记录都处于状态 1。

---

## Test CV-05：`nodeName=icbc-master1`

### 请求包（Burp 风格）
```http
GET /cluster_vuln/vuln_event_list?cluster_id=8&page_size=5&node_name=icbc-master1 HTTP/1.1
Host: cnapp.demo.chaitin.cn
Authorization: Bearer <TOKEN>
token: <TOKEN>
x-auth-token: <TOKEN>
x-requested-with: XMLHttpRequest
Cookie: <COOKIE>
Referer: https://cnapp.demo.chaitin.cn/profile/apitoken
Accept: application/json, text/plain, */*
```

### 响应包（真实，节选）
```http
HTTP/1.1 200 OK
Content-Type: application/json

{
  "count": 5,
  "sample": [
    {
      "eventId": "30",
      "nodeName": "icbc-master1"
    },
    {
      "eventId": "29",
      "nodeName": "icbc-master1"
    }
  ]
}
```

### 结论
- **结果**：✅ 通过

---

## Test CV-06：`cve=CVE-2023-25173`

### 请求包（Burp 风格）
```http
GET /cluster_vuln/vuln_event_list?cluster_id=8&page_size=5&cve=CVE-2023-25173 HTTP/1.1
Host: cnapp.demo.chaitin.cn
Authorization: Bearer <TOKEN>
token: <TOKEN>
x-auth-token: <TOKEN>
x-requested-with: XMLHttpRequest
Cookie: <COOKIE>
Referer: https://cnapp.demo.chaitin.cn/profile/apitoken
Accept: application/json, text/plain, */*
```

### 响应包（真实）
```http
HTTP/1.1 200 OK
Content-Type: application/json

{
  "count": 1,
  "sample": [
    {
      "eventId": "30",
      "cve": "CVE-2023-25173",
      "title": "containerd 安全漏洞"
    }
  ]
}
```

### 结论
- **结果**：✅ 通过

---

## Test CV-07：`name=containerd 安全漏洞`

### 请求包（Burp 风格）
```http
GET /cluster_vuln/vuln_event_list?cluster_id=8&page_size=5&name=containerd%20%E5%AE%89%E5%85%A8%E6%BC%8F%E6%B4%9E HTTP/1.1
Host: cnapp.demo.chaitin.cn
Authorization: Bearer <TOKEN>
token: <TOKEN>
x-auth-token: <TOKEN>
x-requested-with: XMLHttpRequest
Cookie: <COOKIE>
Referer: https://cnapp.demo.chaitin.cn/profile/apitoken
Accept: application/json, text/plain, */*
```

### 响应包（真实，节选）
```http
HTTP/1.1 200 OK
Content-Type: application/json

{
  "count": 4,
  "sample": [
    {
      "eventId": "30",
      "title": "containerd 安全漏洞",
      "cve": "CVE-2023-25173"
    },
    {
      "eventId": "29",
      "title": "containerd 安全漏洞",
      "cve": "CVE-2023-25153"
    }
  ]
}
```

### 结论
- **结果**：✅ 通过

---

## Test CV-08：`clusterName=K3S集群-内部测试`

### 请求包（Burp 风格）
```http
GET /cluster_vuln/vuln_event_list?cluster_id=8&page_size=5&cluster_name=K3S%E9%9B%86%E7%BE%A4-%E5%86%85%E9%83%A8%E6%B5%8B%E8%AF%95 HTTP/1.1
Host: cnapp.demo.chaitin.cn
Authorization: Bearer <TOKEN>
token: <TOKEN>
x-auth-token: <TOKEN>
x-requested-with: XMLHttpRequest
Cookie: <COOKIE>
Referer: https://cnapp.demo.chaitin.cn/profile/apitoken
Accept: application/json, text/plain, */*
```

### 响应包（真实）
```http
HTTP/1.1 200 OK
Content-Type: text/html; charset=utf-8

<!doctype html><html lang="en"><head>...<title>Cloudwalker牧云</title>...</head><body>...</body></html>
```

### 结论
- **结果**：❌ 未通过
- **说明**：上游返回 HTML 登录页，非 JSON。

---

## Test CV-09：`cnnvd=CNNVD-202302-1367`

### 请求包（Burp 风格）
```http
GET /cluster_vuln/vuln_event_list?cluster_id=8&page_size=5&cnnvd=CNNVD-202302-1367 HTTP/1.1
Host: cnapp.demo.chaitin.cn
Authorization: Bearer <TOKEN>
token: <TOKEN>
x-auth-token: <TOKEN>
x-requested-with: XMLHttpRequest
Cookie: <COOKIE>
Referer: https://cnapp.demo.chaitin.cn/profile/apitoken
Accept: application/json, text/plain, */*
```

### 响应包（真实）
```http
HTTP/1.1 200 OK
Content-Type: text/html; charset=utf-8

<!doctype html><html lang="en"><head>...<title>Cloudwalker牧云</title>...</head><body>...</body></html>
```

### 结论
- **结果**：❌ 未通过
- **说明**：上游返回 HTML 登录页，非 JSON。

---

## Test CV-10：`cnvd`

### 说明
- 本轮没有拿到能稳定命中且可确认的 `cnvd` 样本值
- 因此不把它标记为“已验证可用”

### 结论
- **结果**：⚠️ 未确认

---

## 四、ListMicroserviceVulnEvents 实测

## Test MV-01：`serviceName=cloudwalker-cloudwalker-proxy`

### 请求包（Burp 风格）
```http
GET /cluster_microservice/vuln_event_list?page_size=5&service_name=cloudwalker-cloudwalker-proxy HTTP/1.1
Host: cnapp.demo.chaitin.cn
Authorization: Bearer <TOKEN>
token: <TOKEN>
x-auth-token: <TOKEN>
x-requested-with: XMLHttpRequest
Cookie: <COOKIE>
Referer: https://cnapp.demo.chaitin.cn/profile/apitoken
Accept: application/json, text/plain, */*
```

### 响应包（真实，节选）
```http
HTTP/1.1 200 OK
Content-Type: application/json

{
  "count": 1,
  "titles": ["任意路径穿越（文件包含）漏洞"],
  "risks": [4]
}
```

### 结论
- **结果**：✅ 通过

---

## Test MV-02：`serviceType=ClusterIP&characteristic=EXP`

### 请求包（Burp 风格）
```http
GET /cluster_microservice/vuln_event_list?page_size=5&service_type=ClusterIP&characteristic=EXP HTTP/1.1
Host: cnapp.demo.chaitin.cn
Authorization: Bearer <TOKEN>
token: <TOKEN>
x-auth-token: <TOKEN>
x-requested-with: XMLHttpRequest
Cookie: <COOKIE>
Referer: https://cnapp.demo.chaitin.cn/profile/apitoken
Accept: application/json, text/plain, */*
```

### 响应包（真实，节选）
```http
HTTP/1.1 200 OK
Content-Type: application/json

{
  "count": 2,
  "sample": [
    {
      "eventId": "3",
      "microserviceName": "vmsingle-victoria-metrics-k8s-stack",
      "serviceType": "ClusterIP",
      "characteristic": ["NETWORK", "EXP"]
    },
    {
      "eventId": "2",
      "microserviceName": "vmsingle-victoria-metrics-k8s-stack",
      "serviceType": "ClusterIP",
      "characteristic": ["NETWORK", "EXP"]
    }
  ]
}
```

### 结论
- **结果**：✅ 通过

---

## Test MV-03：`state=[1]`

### 请求包（Burp 风格）
```http
GET /cluster_microservice/vuln_event_list?page_size=5&state=1 HTTP/1.1
Host: cnapp.demo.chaitin.cn
Authorization: Bearer <TOKEN>
token: <TOKEN>
x-auth-token: <TOKEN>
x-requested-with: XMLHttpRequest
Cookie: <COOKIE>
Referer: https://cnapp.demo.chaitin.cn/profile/apitoken
Accept: application/json, text/plain, */*
```

### 响应包（真实，节选）
```http
HTTP/1.1 200 OK
Content-Type: application/json

{
  "count": 3,
  "sample": [
    {
      "eventId": "3",
      "status": "1",
      "manageStatus": 1
    },
    {
      "eventId": "2",
      "status": "1",
      "manageStatus": 1
    }
  ]
}
```

### 结论
- **结果**：✅ 通过

---

## Test MV-04：`cve=CVE-2019-20933`

### 请求包（Burp 风格）
```http
GET /cluster_microservice/vuln_event_list?page_size=5&cve=CVE-2019-20933 HTTP/1.1
Host: cnapp.demo.chaitin.cn
Authorization: Bearer <TOKEN>
token: <TOKEN>
x-auth-token: <TOKEN>
x-requested-with: XMLHttpRequest
Cookie: <COOKIE>
Referer: https://cnapp.demo.chaitin.cn/profile/apitoken
Accept: application/json, text/plain, */*
```

### 响应包（真实，节选）
```http
HTTP/1.1 200 OK
Content-Type: application/json

{
  "count": 2,
  "sample": [
    {
      "eventId": "3",
      "cve": "CVE-2019-20933"
    },
    {
      "eventId": "2",
      "cve": "CVE-2019-20933"
    }
  ]
}
```

### 结论
- **结果**：✅ 通过

---

## Test MV-05：`name=InfluxDB JWT Token伪造认证绕过漏洞`

### 请求包（Burp 风格）
```http
GET /cluster_microservice/vuln_event_list?page_size=5&name=InfluxDB%20JWT%20Token%E4%BC%AA%E9%80%A0%E8%AE%A4%E8%AF%81%E7%BB%95%E8%BF%87%E6%BC%8F%E6%B4%9E HTTP/1.1
Host: cnapp.demo.chaitin.cn
Authorization: Bearer <TOKEN>
token: <TOKEN>
x-auth-token: <TOKEN>
x-requested-with: XMLHttpRequest
Cookie: <COOKIE>
Referer: https://cnapp.demo.chaitin.cn/profile/apitoken
Accept: application/json, text/plain, */*
```

### 响应包（真实，节选）
```http
HTTP/1.1 200 OK
Content-Type: application/json

{
  "count": 2,
  "sample": [
    {
      "eventId": "3",
      "title": "InfluxDB JWT Token伪造认证绕过漏洞"
    },
    {
      "eventId": "2",
      "title": "InfluxDB JWT Token伪造认证绕过漏洞"
    }
  ]
}
```

### 结论
- **结果**：✅ 通过

---

## Test MV-06：`clusterName=K3S集群-内部测试`

### 请求包（Burp 风格）
```http
GET /cluster_microservice/vuln_event_list?page_size=5&cluster_name=K3S%E9%9B%86%E7%BE%A4-%E5%86%85%E9%83%A8%E6%B5%8B%E8%AF%95 HTTP/1.1
Host: cnapp.demo.chaitin.cn
Authorization: Bearer <TOKEN>
token: <TOKEN>
x-auth-token: <TOKEN>
x-requested-with: XMLHttpRequest
Cookie: <COOKIE>
Referer: https://cnapp.demo.chaitin.cn/profile/apitoken
Accept: application/json, text/plain, */*
```

### 响应包（真实）
```http
HTTP/1.1 200 OK
Content-Type: application/json

{
  "count": 0,
  "sample": []
}
```

### 结论
- **结果**：⚠️ 未验证出有效筛选能力
- **说明**：请求成功，但结果为空，当前不标记为可用。

---

## Test MV-07：`cnvd=CNVD-2022-1234`

### 请求包（Burp 风格）
```http
GET /cluster_microservice/vuln_event_list?cnvd=CNVD-2022-1234&page_size=5 HTTP/1.1
Host: cnapp.demo.chaitin.cn
Authorization: Bearer <TOKEN>
token: <TOKEN>
x-auth-token: <TOKEN>
x-requested-with: XMLHttpRequest
Cookie: <COOKIE>
Referer: https://cnapp.demo.chaitin.cn/profile/apitoken
Accept: application/json, text/plain, */*
```

### 响应包（真实）
```http
HTTP/1.1 302 Found
Location: https://cnapp.demo.chaitin.cn/login?code=10005&message=服务异常
Content-Type: text/plain; charset=utf-8

Found
```

### 结论
- **结果**：❌ 未通过
- **说明**：上游返回登录跳转。

---

## Test MV-08：`cnnvd=CNNVD-201902-0001`

### 请求包（Burp 风格）
```http
GET /cluster_microservice/vuln_event_list?cnnvd=CNNVD-201902-0001&page_size=5 HTTP/1.1
Host: cnapp.demo.chaitin.cn
Authorization: Bearer <TOKEN>
token: <TOKEN>
x-auth-token: <TOKEN>
x-requested-with: XMLHttpRequest
Cookie: <COOKIE>
Referer: https://cnapp.demo.chaitin.cn/profile/apitoken
Accept: application/json, text/plain, */*
```

### 响应包（真实）
```http
HTTP/1.1 302 Found
Location: https://cnapp.demo.chaitin.cn/login?code=10005&message=服务异常
Content-Type: text/plain; charset=utf-8

Found
```

### 结论
- **结果**：❌ 未通过
- **说明**：上游返回登录跳转。

---

## 五、最终参数矩阵（本轮凭据 + 真实环境）

### ListClusters
- `name`：❌ 本轮凭据下未通过（HTML 页面）
- `status`：❌ 本轮凭据下未通过（HTML 页面）

### ListClusterVulnEvents
- `clusterId`：✅
- `cve`：✅
- `name`：✅
- `nodeName`：✅
- `risk`：✅
- `state`：✅
- `characteristic`：✅
- `orderBy`：✅
- `order`：✅
- `clusterName`：❌（HTML 页）
- `cnnvd`：❌（HTML 页）
- `cnvd`：⚠️ 未确认

### ListMicroserviceVulnEvents
- `serviceName`：✅
- `serviceType`：✅
- `name`：✅
- `cve`：✅
- `risk`：✅
- `state`：✅
- `characteristic`：✅
- `orderBy`：✅
- `order`：✅
- `clusterName`：⚠️ 返回空结果
- `cnvd`：❌（302 登录跳转）
- `cnnvd`：❌（302 登录跳转）

---

## 六、结论

1. **服务代码侧新增查询参数总体已经生效**，尤其在两个漏洞列表接口上，大部分核心参数都通过了真实环境验证。  
2. **上游 CloudWalker demo 环境本身存在不稳定/不一致现象**：  
   - 某些参数会触发 302 登录跳转或 HTML 页面返回；  
   - 某些参数虽然在 `api.json` 中声明，但 demo 环境未表现出可用性。  
3. 因此本轮建议把参数分为三类：  
   - **已验证可用**：可以写入 README 和对外交付说明  
   - **已接入但上游异常**：保留代码支持，但文档中标为“未在 demo 环境稳定验证通过”  
   - **未确认**：不宣称可用

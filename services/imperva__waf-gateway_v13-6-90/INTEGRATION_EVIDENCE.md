# Imperva_WAF Gateway 13.6.90 联调证据

以下证据来自真实 Imperva MX / WAF Gateway 13.6.90 环境。

脱敏说明：

- 真实目标地址已替换为 `https://<MX_HOST>:8083`。
- `Authorization`、`Cookie`、`Set-Cookie`、`session-id` 已脱敏。
- 请求路径、HTTP 状态码、响应结构和业务字段保留。
- 测试 IP 使用 `203.0.113.45`。

## CheckOnline 跑通

### CheckOnline：登录获取会话

# Request

```http
POST https://<MX_HOST>:8083/SecureSphere/api/v1/auth/session
Authorization: Basic ******
Content-Type: application/json
```

# Response   HTTP/1.1 200 OK

```http
Set-Cookie: ******
Content-Security-Policy: frame-ancestors 'self'
Trx-Context: PCJUGTHSVM
X-operation-id: 9765
Set-Cookie: ******
Content-Type: application/json
Date: Fri, 26 Jun 2026 03:32:20 GMT
Server: NA
```

```json
{
  "session-id": "******"
}
```

### CheckOnline：读取管理接口版本

# Request

```http
GET https://<MX_HOST>:8083/SecureSphere/api/v1/administration/version
Cookie: ******
Content-Type: application/json
```

# Response   HTTP/1.1 200 OK

```http
Content-Security-Policy: frame-ancestors 'self'
Trx-Context: 5LYDLCCYRV
X-operation-id: 9766
Content-Type: application/json
Date: Fri, 26 Jun 2026 03:32:20 GMT
Server: NA
```

```json
{
  "serverVersion": "13.6.0.90"
}
```

## BlockIP 跑通

### BlockIP：登录获取会话

# Request

```http
POST https://<MX_HOST>:8083/SecureSphere/api/v1/auth/session
Authorization: Basic ******
Content-Type: application/json
```

# Response   HTTP/1.1 200 OK

```http
Set-Cookie: ******
Content-Security-Policy: frame-ancestors 'self'
Trx-Context: ARYRPCZVTB
X-operation-id: 9767
Set-Cookie: ******
Content-Type: application/json
Date: Fri, 26 Jun 2026 03:32:20 GMT
Server: NA
```

```json
{
  "session-id": "******"
}
```

### BlockIP：确认 OctoBus 黑名单 IP Group

# Request

```http
GET https://<MX_HOST>:8083/SecureSphere/api/v1/conf/ipGroups/OctoBus%E9%BB%91%E5%90%8D%E5%8D%95IP%E7%BB%84
Cookie: ******
Content-Type: application/json
```

# Response   HTTP/1.1 200 OK

```http
Content-Security-Policy: frame-ancestors 'self'
Trx-Context: QWMTTBGSZY
X-operation-id: 9768
Content-Type: application/json
Date: Fri, 26 Jun 2026 03:32:20 GMT
Server: NA
```

```json
{
  "entries": []
}
```

### BlockIP：获取站点列表

# Request

```http
GET https://<MX_HOST>:8083/SecureSphere/api/v1/conf/sites
Cookie: ******
Content-Type: application/json
```

# Response   HTTP/1.1 200 OK

```http
Content-Security-Policy: frame-ancestors 'self'
Trx-Context: QWISLCC3QX
X-operation-id: 9769
Content-Type: application/json
Date: Fri, 26 Jun 2026 03:32:20 GMT
Server: NA
```

```json
{
  "sites": [
    "业务站点",
    "默认站点"
  ]
}
```

### BlockIP：获取业务站点服务组

# Request

```http
GET https://<MX_HOST>:8083/SecureSphere/api/v1/conf/serverGroups/%E4%B8%9A%E5%8A%A1%E7%AB%99%E7%82%B9
Cookie: ******
Content-Type: application/json
```

# Response   HTTP/1.1 200 OK

```http
Content-Security-Policy: frame-ancestors 'self'
Trx-Context: 3UFJW4FEM9
X-operation-id: 9770
Content-Type: application/json
Date: Fri, 26 Jun 2026 03:32:20 GMT
Server: NA
```

```json
{
  "server-groups": [
    "018"
  ]
}
```

### BlockIP：获取业务站点/018 下 Web Service

# Request

```http
GET https://<MX_HOST>:8083/SecureSphere/api/v1/conf/webServices/%E4%B8%9A%E5%8A%A1%E7%AB%99%E7%82%B9/018
Cookie: ******
Content-Type: application/json
```

# Response   HTTP/1.1 200 OK

```http
Content-Security-Policy: frame-ancestors 'self'
Trx-Context: A39ETNKQBD
X-operation-id: 9771
Content-Type: application/json
Date: Fri, 26 Jun 2026 03:32:20 GMT
Server: NA
```

```json
{
  "web-services": [
    "test"
  ]
}
```

### BlockIP：确认 OctoBus Web Service Custom Policy

# Request

```http
GET https://<MX_HOST>:8083/SecureSphere/api/v1/conf/webServiceCustomPolicies/OctoBus%E9%BB%91%E5%90%8D%E5%8D%95%E7%AD%96%E7%95%A5
Cookie: ******
Content-Type: application/json
```

# Response   HTTP/1.1 200 OK

```http
Content-Security-Policy: frame-ancestors 'self'
Trx-Context: X3DTMKQOMB
X-operation-id: 9772
Content-Type: application/json
Date: Fri, 26 Jun 2026 03:32:21 GMT
Server: NA
```

```json
{
  "enabled": true,
  "oneAlertPerSession": false,
  "displayResponsePage": true,
  "severity": "high",
  "action": "block",
  "followedAction": null,
  "matchCriteria": [
    {
      "ipGroups": [
        "OctoBus黑名单IP组"
      ],
      "type": "sourceIpAddresses",
      "operation": "atLeastOne"
    }
  ],
  "applyTo": [
    {
      "siteName": "业务站点",
      "serverGroupName": "018",
      "webServiceName": "test"
    }
  ]
}
```

### BlockIP：向 IP Group 添加封禁 IP

# Request

```http
PUT https://<MX_HOST>:8083/SecureSphere/api/v1/conf/ipGroups/OctoBus%E9%BB%91%E5%90%8D%E5%8D%95IP%E7%BB%84
Cookie: ******
Content-Type: application/json
```

```json
{
  "entries": [
    {
      "type": "single",
      "ipAddressFrom": "203.0.113.45",
      "ipAddressTo": "203.0.113.45",
      "networkAddress": null,
      "cidrMask": null,
      "operation": "add"
    }
  ]
}
```

# Response   HTTP/1.1 200 OK

```http
Content-Security-Policy: frame-ancestors 'self'
Trx-Context: B7VWPXD7SQ
X-operation-id: 9773
Content-Type: application/json
Date: Fri, 26 Jun 2026 03:32:21 GMT
Server: NA
```

```text
空响应体
```

## ListBlockedIPs 跑通

### ListBlockedIPs：登录获取会话

# Request

```http
POST https://<MX_HOST>:8083/SecureSphere/api/v1/auth/session
Authorization: Basic ******
Content-Type: application/json
```

# Response   HTTP/1.1 200 OK

```http
Set-Cookie: ******
Content-Security-Policy: frame-ancestors 'self'
Trx-Context: ORTCCAWK3P
X-operation-id: 9774
Set-Cookie: ******
Content-Type: application/json
Date: Fri, 26 Jun 2026 03:32:21 GMT
Server: NA
```

```json
{
  "session-id": "******"
}
```

### ListBlockedIPs：查询黑名单 IP Group

# Request

```http
GET https://<MX_HOST>:8083/SecureSphere/api/v1/conf/ipGroups/OctoBus%E9%BB%91%E5%90%8D%E5%8D%95IP%E7%BB%84
Cookie: ******
Content-Type: application/json
```

# Response   HTTP/1.1 200 OK

```http
Content-Security-Policy: frame-ancestors 'self'
Trx-Context: P4L7R3LR8P
X-operation-id: 9775
Content-Type: application/json
Date: Fri, 26 Jun 2026 03:32:21 GMT
Server: NA
```

```json
{
  "entries": [
    {
      "type": "single",
      "ipAddressFrom": "203.0.113.45"
    }
  ]
}
```

## UnblockIP 跑通

### UnblockIP：登录获取会话

# Request

```http
POST https://<MX_HOST>:8083/SecureSphere/api/v1/auth/session
Authorization: Basic ******
Content-Type: application/json
```

# Response   HTTP/1.1 200 OK

```http
Set-Cookie: ******
Content-Security-Policy: frame-ancestors 'self'
Trx-Context: 1LC8EYNK2I
X-operation-id: 9776
Set-Cookie: ******
Content-Type: application/json
Date: Fri, 26 Jun 2026 03:32:21 GMT
Server: NA
```

```json
{
  "session-id": "******"
}
```

### UnblockIP：从 IP Group 删除封禁 IP

# Request

```http
PUT https://<MX_HOST>:8083/SecureSphere/api/v1/conf/ipGroups/OctoBus%E9%BB%91%E5%90%8D%E5%8D%95IP%E7%BB%84
Cookie: ******
Content-Type: application/json
```

```json
{
  "entries": [
    {
      "type": "single",
      "ipAddressFrom": "203.0.113.45",
      "ipAddressTo": "203.0.113.45",
      "networkAddress": null,
      "cidrMask": null,
      "operation": "remove"
    }
  ]
}
```

# Response   HTTP/1.1 200 OK

```http
Content-Security-Policy: frame-ancestors 'self'
Trx-Context: MBGTFV6R1M
X-operation-id: 9777
Content-Type: application/json
Date: Fri, 26 Jun 2026 03:32:21 GMT
Server: NA
```

```text
空响应体
```

### UnblockIP：删除后复查黑名单 IP Group

# Request

```http
GET https://<MX_HOST>:8083/SecureSphere/api/v1/conf/ipGroups/OctoBus%E9%BB%91%E5%90%8D%E5%8D%95IP%E7%BB%84
Cookie: ******
Content-Type: application/json
```

# Response   HTTP/1.1 200 OK

```http
Content-Security-Policy: frame-ancestors 'self'
Trx-Context: 5BFPC63WFJ
X-operation-id: 9778
Content-Type: application/json
Date: Fri, 26 Jun 2026 03:32:22 GMT
Server: NA
```

```json
{
  "entries": []
}
```

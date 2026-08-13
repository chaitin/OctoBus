# Test Results / 测试记录

> 所有敏感信息（IP、实例 ID、服务器地址）已替换为占位符。
> All sensitive data (IPs, instance IDs, server addresses) replaced with placeholders.

## 测试环境 / Test Environment

| 项目 | 值 |
|------|-----|
| WAF 产品 | Alibaba Cloud WAF 3.0 |
| 接入模式 | 云产品接入（ECS） |
| 测试方法数 | 10 |
| 测试结果 | 全部通过 / All passed ✅ |

---

## 1. BlockIP — 封禁 IP

```bash
curl -s http://<octobus-addr>/capsets/dev/connect/<instance>/Aliyun_Waf3.Waf3/BlockIP \
  -H "Content-Type: application/json" \
  -d '{"ips":["<test-ip>"],"ruleName":"test-block","action":"monitor"}'
```

**请求 / Request**：
```json
{"ips": ["<test-ip>"], "ruleName": "test-block", "action": "monitor"}
```

**响应 / Response**：
```json
{"ruleId": "<rule-id>"}
```

**阿里云 API**：`CreateDefenseRule`（DefenseScene=`ip_blacklist`）

---

## 2. UnblockIP — 解封 IP

```bash
curl -s http://<octobus-addr>/capsets/dev/connect/<instance>/Aliyun_Waf3.Waf3/UnblockIP \
  -H "Content-Type: application/json" \
  -d '{"ruleId":"<rule-id>","ips":["<test-ip>"]}'
```

**请求**：`{"ruleId": "<rule-id>", "ips": ["<test-ip>"]}`

**响应**：`{"success": true}`

**阿里云 API**：`DescribeDefenseRule` + `ModifyDefenseRule`

> 注：所有 IP 被移除后自动删除规则 / Note: auto-deletes rule when all IPs removed.

---

## 3. DescribeIPBlacklist — 查询黑名单

```bash
curl -s http://<octobus-addr>/capsets/dev/connect/<instance>/Aliyun_Waf3.Waf3/DescribeIPBlacklist \
  -H "Content-Type: application/json" -d '{}'
```

**响应**：
```json
{
  "rules": [
    {
      "ruleId": "<rule-id>",
      "name": "test-block",
      "ips": ["<test-ip>"],
      "action": "monitor",
      "status": 1
    }
  ],
  "total": "<n>"
}
```

**阿里云 API**：`DescribeDefenseRules`（Query=`{"templateId":<tpl>,"scene":"ip_blacklist"}`）

---

## 4. AddIPWhitelist — IP 加白

```bash
curl -s http://<octobus-addr>/capsets/dev/connect/<instance>/Aliyun_Waf3.Waf3/AddIPWhitelist \
  -H "Content-Type: application/json" \
  -d '{"ips":["<internal-ip>"],"ruleName":"whitelist-test"}'
```

**请求**：`{"ips": ["<internal-ip>"], "ruleName": "whitelist-test"}`

**响应**：`{"ruleId": "<rule-id>"}`

**阿里云 API**：`CreateDefenseRule`（DefenseScene=`whitelist`）

---

## 5. CreateACLRule — 创建自定义 ACL

```bash
curl -s http://<octobus-addr>/capsets/dev/connect/<instance>/Aliyun_Waf3.Waf3/CreateACLRule \
  -H "Content-Type: application/json" \
  -d '{"ruleName":"acl-test","conditions":[{"key":"URL","opValue":"contain","values":"/admin"}],"action":"monitor"}'
```

**请求**：
```json
{
  "ruleName": "acl-test",
  "conditions": [{"key": "URL", "opValue": "contain", "values": "/admin"}],
  "action": "monitor"
}
```

**响应**：`{"ruleId": "<rule-id>"}`

**阿里云 API**：`CreateDefenseRule`（DefenseScene=`custom_acl`）

---

## 6. DeleteRule — 删除规则

```bash
curl -s http://<octobus-addr>/capsets/dev/connect/<instance>/Aliyun_Waf3.Waf3/DeleteRule \
  -H "Content-Type: application/json" \
  -d '{"ruleId":"<rule-id>"}'
```

**请求**：`{"ruleId": "<rule-id>"}`

**响应**：`{"success": true}`

**阿里云 API**：`DeleteDefenseRule`

---

## 7. DescribeRule — 查询单条规则

```bash
curl -s http://<octobus-addr>/capsets/dev/connect/<instance>/Aliyun_Waf3.Waf3/DescribeRule \
  -H "Content-Type: application/json" \
  -d '{"ruleId":"<rule-id>"}'
```

**响应**：
```json
{
  "ruleId": "<rule-id>",
  "name": "test-block",
  "defenseScene": "ip_blacklist",
  "action": "monitor",
  "rulesJson": "[{\"action\":\"monitor\",\"name\":\"test-block\",\"remoteAddr\":[\"<test-ip>\"]}]"
}
```

**阿里云 API**：`DescribeDefenseRule`

---

## 8. DescribeRules — 按场景查询规则列表

```bash
curl -s http://<octobus-addr>/capsets/dev/connect/<instance>/Aliyun_Waf3.Waf3/DescribeRules \
  -H "Content-Type: application/json" \
  -d '{"defenseScene":"ip_blacklist"}'
```

**响应格式**：同 DescribeIPBlacklist

**阿里云 API**：`DescribeDefenseRules`

---

## 9. DescribeSecurityTopNMetric — 攻击 Top N 统计

```bash
curl -s http://<octobus-addr>/capsets/dev/connect/<instance>/Aliyun_Waf3.Waf3/DescribeSecurityTopNMetric \
  -H "Content-Type: application/json" \
  -d '{"startTime":<unix-ts>,"endTime":<unix-ts>,"metric":"real_client_ip","limit":5}'
```

**响应**：
```json
{
  "items": [
    {"name": "<attacker-ip-1>", "value": "23"},
    {"name": "<attacker-ip-2>", "value": "17"},
    {"name": "<attacker-ip-3>", "value": "3"}
  ]
}
```

**阿里云 API**：`DescribeSecurityEventTopNMetric`

---

## 10. DescribeResources — 查询防护资源

```bash
curl -s http://<octobus-addr>/capsets/dev/connect/<instance>/Aliyun_Waf3.Waf3/DescribeResources \
  -H "Content-Type: application/json" -d '{}'
```

**响应**：
```json
{
  "resources": [
    {
      "resource": "<ecs-instance-id>-<port>-ecs",
      "pattern": "instance_port",
      "product": "ecs",
      "status": "active",
      "instanceId": "<ecs-instance-id>",
      "port": 8080,
      "protocol": "http"
    }
  ],
  "total": "1"
}
```

**阿里云 API**：`DescribeDefenseResources`

---

## 总结 / Summary

- **5 个写操作 / Write**：BlockIP、UnblockIP、AddIPWhitelist、CreateACLRule、DeleteRule
- **5 个读操作 / Read**：DescribeIPBlacklist、DescribeRule、DescribeRules、DescribeSecurityTopNMetric、DescribeResources
- **底层 API / Underlying APIs**（7 total）：CreateDefenseRule、ModifyDefenseRule、DeleteDefenseRule、DescribeDefenseRule、DescribeDefenseRules、DescribeSecurityEventTopNMetric、DescribeDefenseResources
- **写操作用 POST / Write ops use POST**，读操作用 GET / Read ops use GET
- **所有方法均通过真实 WAF 3.0 实例（云产品接入模式）验证 / All methods verified against a real WAF 3.0 instance (cloud product access mode)**

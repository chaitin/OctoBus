# CloudWalker 真实接口测试说明

## 测试脚本使用方法

### 1. 设置认证环境变量

测试脚本需要以下环境变量才能连接到 CloudWalker demo 环境：

```bash
# 设置基础 URL
export CLOUDWALKER_BASE_URL=https://cnapp.demo.chaitin.cn

# 设置认证 Token (必需)
export CLOUDWALKER_TOKEN="你的-token-值"

# 设置 Cookie (可选，但 demo 环境可能需要)
export CLOUDWALKER_COOKIE="你的-cookie-值"

# 设置 Referer (可选)
export CLOUDWALKER_REFERER=https://cnapp.demo.chaitin.cn/profile/apitoken
```

### 2. 运行测试脚本

```bash
cd /Users/supermantao/Desktop/AI/OctoBus/services/chaitin__cloudwalker
node test/real-api-test.js
```

### 3. 查看测试报告

测试完成后，会在当前目录生成 `REAL_API_TEST_REPORT.md` 文件，包含：
- 所有测试的请求详情（URL、headers、参数）
- 所有测试的响应详情（状态码、headers、响应体）
- 测试摘要（通过/失败统计）
- 错误详情（如有）

## 测试覆盖的接口

脚本会测试以下 6 个 CloudWalker API 接口：

1. **ListClusters** - 获取集群列表
   - 端点: `/cluster/cluster_list`
   - 参数: `pageSize` (分页大小)

2. **GetClusterInfo** - 获取集群详情
   - 端点: `/cluster/cluster_info`
   - 参数: `clusterId` (从 ListClusters 结果中获取)

3. **ListClusterVulnEvents** - 获取集群漏洞事件列表
   - 端点: `/cluster_vuln/vuln_event_list`
   - 参数: `clusterId`, `pageSize`

4. **GetClusterVulnEvent** - 获取集群漏洞事件详情
   - 端点: `/cluster_vuln/vuln_event_info`
   - 参数: `eventId` (从 ListClusterVulnEvents 结果中获取)

5. **ListMicroserviceVulnEvents** - 获取微服务漏洞事件列表
   - 端点: `/cluster_microservice/vuln_event_list`
   - 参数: `pageSize`

6. **GetMicroserviceVulnEvent** - 获取微服务漏洞事件详情
   - 端点: `/cluster_microservice/vuln_event_info`
   - 参数: `eventId` (从 ListMicroserviceVulnEvents 结果中获取)

## 测试特性

- ✅ 自动记录所有请求和响应详情
- ✅ 测试依赖关系自动处理（如 GetClusterInfo 需要 ListClusters 的结果）
- ✅ 错误处理和详细错误报告
- ✅ 生成结构化的 Markdown 测试报告
- ✅ 控制台实时输出测试进度

## 注意事项

1. **认证信息**: 必须提供有效的 `CLOUDWALKER_TOKEN`，否则测试会失败
2. **Cookie**: CloudWalker demo 环境可能需要 browser session cookie，请根据实际情况配置
3. **网络连接**: 确保可以访问 `https://cnapp.demo.chaitin.cn`
4. **测试数据**: 测试会使用真实的 CloudWalker demo 数据，请确保有足够的测试数据

## 快速测试命令示例

如果你已经有认证信息，可以直接运行：

```bash
# 方式一：使用环境变量
CLOUDWALKER_TOKEN="TMCpan#2VB44wwFG2bii*WLZ^xUldjBe237d8081bdbb88f542b9f96e3cf698a1" \
CLOUDWALKER_COOKIE="你的cookie值" \
node test/real-api-test.js

# 方式二：先设置环境变量再运行
export CLOUDWALKER_TOKEN="TMCpan#2VB44wwFG2bii*WLZ^xUldjBe237d8081bdbb88f542b9f96e3cf698a1"
export CLOUDWALKER_COOKIE="你的cookie值"
node test/real-api-test.js
```

## 测试报告示例

测试报告会包含以下信息：

```markdown
# CloudWalker 真实接口测试报告

## 测试信息
- 服务名称: CloudWalker
- 测试日期: 2026-06-29T...
- 测试环境: https://cnapp.demo.chaitin.cn

## 测试摘要
- 总测试数: 6
- 通过: 6 ✅
- 失败: 0 ❌

## 详细测试结果
### 1. ListClusters - 获取集群列表
状态: ✅ 通过

#### 请求详情
GET https://cnapp.demo.chaitin.cn/cluster/cluster_list
Headers:
  authorization: Bearer <token>
  token: <token>
  ...

#### 响应详情
状态码: 200 OK
耗时: 125ms
响应体:
{
  "clusters": [...],
  "nextPageToken": "..."
}
```
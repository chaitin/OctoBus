# CloudWalker Service 本次更新说明

**更新时间**: 2026-06-30  
**服务目录**: `services/chaitin__cloudwalker`  
**更新类型**: 查询能力增强 + 上游异常兼容 + 测试与文档完善

---

## 一、更新背景

本次更新主要围绕 `api.json` 中 CloudWalker 查询接口的能力补齐展开，目标是：

1. 扩展现有 3 个 list RPC 的查询参数能力
2. 对齐 CloudWalker 上游 API 的筛选参数
3. 兼容上游 demo 环境中 `clusterName / cnvd / cnnvd` 等参数不稳定的问题
4. 补充自动化测试与真实环境回归验证
5. 更新 README 与测试文档

---

## 二、核心改动概览

### 1. Proto 请求字段扩展
已扩展以下 3 个 list RPC 的 request message：

- `ListClustersRequest`
- `ListClusterVulnEventsRequest`
- `ListMicroserviceVulnEventsRequest`

#### 新增参数

### ListClustersRequest
- `name`
- `status`

### ListClusterVulnEventsRequest
- `cve`
- `name`
- `cnvd`
- `cnnvd`
- `node_name`
- `cluster_name`
- `order_by`
- `risk` (`repeated int32`)
- `state` (`repeated int32`)
- `characteristic` (`repeated string`)
- `order`

### ListMicroserviceVulnEventsRequest
- `service_name`
- `service_type`
- `cluster_name`
- `name`
- `cve`
- `cnvd`
- `cnnvd`
- `order_by`
- `characteristic` (`repeated string`)
- `risk` (`repeated int32`)
- `state` (`repeated int32`)
- `order`

---

## 三、代码实现更新

### 1. Query Builder 重构
在 `src/cloudwalker.js` 中重构了查询参数构建逻辑，新增统一 helper：

- `buildPaginationQuery`
- `appendScalarQuery`
- `appendRepeatedQuery`
- `buildListClustersQuery`
- `buildListClusterVulnEventsQuery`
- `buildListMicroserviceVulnEventsQuery`

### 2. 异常参数 fallback 兼容
针对上游 demo 环境中不稳定的参数：

- `clusterName`
- `cnvd`
- `cnnvd`

实现了 fallback 兼容策略：

1. 优先直接请求上游接口
2. 如果上游返回 HTML / 302 / 空结果 / 不稳定响应
3. 自动退化为：
   - 先拉基础列表
   - 再做本地过滤
   - 必要时调用详情接口补充字段

### 3. 详情字段回填
为 fallback 命中的结果新增了详情字段回填逻辑，确保以下字段不仅能参与筛选，也能在最终返回结果中展示：

- `clusterName`
- `cnvd`
- `cnnvd`

### 4. VulnEvent 字段增强
进一步完善了 `normalizeVulnEvent` 的映射，补充字段包括：

- `cnvd`
- `cnnvd`
- `nodeName`
- `clusterName`
- `risk`
- `originalRisk`
- `customRisk`
- `characteristic`
- `serviceUid`
- `serviceType`
- `description`
- `solution`
- `manageStatus`
- `nodeExist`
- `firstDiscoveryTime`
- `lastDiscoveryTime`

---

## 四、修改文件清单

### 代码文件
- `services/chaitin__cloudwalker/proto/cloudwalker.proto`
- `services/chaitin__cloudwalker/src/cloudwalker.js`

### 测试文件
- `services/chaitin__cloudwalker/test/cloudwalker-client.test.js`

### 文档文件
- `services/chaitin__cloudwalker/README.md`
- `services/chaitin__cloudwalker/REAL_PARAMETER_REGRESSION_BURP_REPORT.md`

### 新增/阶段性文档
- `docs/superpowers/specs/2026-06-29-cloudwalker-query-enhancement-design.md`
- `services/chaitin__cloudwalker/QUERY_ENHANCEMENT_UPDATE.md`（本文件）

---

## 五、测试结果

### 1. 自动化测试
本地测试结果：

- **10 / 10 全部通过** ✅

验证内容包括：
- query 参数映射
- handler 调用链路
- fallback 兼容逻辑
- 详情字段补全
- 错误处理

### 2. 真实环境验证
使用真实 CloudWalker demo 环境完成了参数级验证。

#### 已验证可用

### ListClusters
- `name` ✅
- `status` ⚠️（上游 demo 环境偶发异常）

### ListClusterVulnEvents
- `clusterId` ✅
- `cve` ✅
- `name` ✅
- `nodeName` ✅
- `risk` ✅
- `state` ✅
- `characteristic` ✅
- `orderBy` ✅
- `order` ✅
- `clusterName` ✅（fallback）
- `cnnvd` ✅（fallback）
- `cnvd` ⚠️（代码兼容完成，但 cluster 样本不稳定）

### ListMicroserviceVulnEvents
- `serviceName` ✅
- `serviceType` ✅
- `name` ✅
- `cve` ✅
- `risk` ✅
- `state` ✅
- `characteristic` ✅
- `orderBy` ✅
- `order` ✅
- `clusterName` ✅（fallback）
- `cnvd` ✅（fallback）
- `cnnvd` ✅（fallback）

---

## 六、兼容策略说明

本次更新最重要的增强点不是“多加了几个参数”，而是建立了对上游不稳定行为的兼容能力。

### 当前兼容策略

#### 正常路径
当上游参数工作正常时：
- 直接使用上游返回结果
- 保持效率最高

#### 回退路径
当上游参数异常时：
- 自动拉基础列表
- 本地做精确过滤
- 对需要编号类判断的参数，再查详情接口补齐字段

### 适用参数
- `clusterName`
- `cnvd`
- `cnnvd`

这使得 service 层对调用方来说更加稳定，即使上游 demo 环境行为不一致，仍能尽量返回可用结果。

---

## 七、README 更新内容

README 已补充：

1. 查询增强能力说明
2. 每个 list 接口新增支持的筛选参数
3. 参数到上游 query 的映射关系
4. 真实环境状态标记：
   - ✅ 原生验证通过
   - ✅ fallback 验证通过
   - ⚠️ 上游 demo 不稳定
5. fallback 行为说明

---

## 八、测试报告更新内容

`REAL_PARAMETER_REGRESSION_BURP_REPORT.md` 已更新为最终状态，包含：

- Burp 风格 HTTP 请求包
- 真实环境响应包
- 参数级验证矩阵
- fallback 生效说明
- 最终结论以“修复后的 service 行为”为准

---

## 九、当前交付状态

### 已完成
- 查询参数扩展 ✅
- 统一 query builder ✅
- fallback 兼容实现 ✅
- 详情字段回填 ✅
- 自动化测试通过 ✅
- 真实环境关键参数验证 ✅
- README 更新 ✅
- 测试报告更新 ✅

### 当前可直接使用的能力
CloudWalker service 现在已经从“基础只读查询”升级为：

- 支持强类型筛选
- 支持多数组参数
- 支持排序
- 支持 fallback 兼容异常参数
- 支持返回更完整的漏洞详情字段

---

## 十、后续建议

如需继续演进，建议的优先级如下：

1. 继续补 cluster 漏洞中 `cnvd` 的稳定真实样本验证
2. 针对上游 demo 环境的异常参数建立更细粒度的错误分类
3. 如有必要，再扩展更多响应字段（例如 `app_list` 等）
4. 如进入正式交付阶段，可补充更系统的回归测试矩阵

---

## 十一、总结

本次更新的实质，是让 `services/chaitin__cloudwalker`：

- **参数更全**
- **行为更稳**
- **对上游异常更有韧性**
- **文档与验证更完整**

这轮修改已经把最核心的查询增强和兼容能力落地完成，可作为当前阶段的稳定交付版本。

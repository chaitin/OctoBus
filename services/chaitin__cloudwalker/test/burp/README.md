# Burp Suite 请求文件使用指南

## 📁 文件结构

本目录包含以下文件：

### 合集文件
- **`../BURP_SUITE_REQUESTS.txt`** - 包含所有 6 个测试用例的完整请求合集

### 单个请求文件（便于逐个测试）
```
test/burp/
├── 01_ListClusters.txt             - 获取集群列表
├── 02_GetClusterInfo.txt            - 获取集群详情
├── 03_ListClusterVulnEvents.txt     - 获取集群漏洞事件列表
├── 04_GetClusterVulnEvent.txt       - 获取集群漏洞事件详情
├── 05_ListMicroserviceVulnEvents.txt - 获取微服务漏洞事件列表
└── 06_GetMicroserviceVulnEvent.txt   - 获取微服务漏洞事件详情
```

---

## 🚀 在 Burp Suite 中导入和使用

### 方式一：通过 Repeater 模块导入

#### 步骤 1: 打开 Burp Suite
启动 Burp Suite Professional 或 Community Edition

#### 步骤 2: 进入 Repeater 模块
- 点击顶部菜单的 **"Repeater"** 标签

#### 步骤 3: 导入请求
**方法 A - 复制粘贴方式**:
1. 打开任意一个请求文件（如 `01_ListClusters.txt`）
2. 复制全部内容
3. 在 Burp Suite Repeater 中，右键点击请求编辑区域
4. 选择 **"Paste"** 或直接 Ctrl+V 粘贴
5. Burp Suite 会自动解析请求格式

**方法 B - 从文件加载**:
1. 在 Repeater 标签页，右键点击标签栏
2. 选择 **"Load request from file"**
3. 选择对应的 `.txt` 文件
4. 请求会自动加载到 Repeater 中

#### 步骤 4: 发送请求
- 点击 **"Send"** 按钮
- 查看响应内容

---

### 方式二：通过 Proxy 模块拦截修改

#### 步骤 1: 配置 Proxy
1. 进入 **"Proxy"** → **"Options"**
2. 确保 Proxy listener 已启用（默认 127.0.0.1:8080）

#### 步骤 2: 拦截请求
1. 切换到 **"Intercept"** 标签
2. 开启 **"Intercept is on"**
3. 使用浏览器访问 CloudWalker（需配置浏览器代理指向 Burp）

#### 步骤 3: 修改请求
当请求被拦截后，可以在 Intercept 界面修改：
- Headers
- Parameters
- Cookies

---

### 方式三：批量导入（使用合集文件）

#### 使用合集文件测试所有接口

1. 打开 `../BURP_SUITE_REQUESTS.txt`
2. 复制所有内容
3. 在 Burp Suite 中：
   - 进入 **"Target"** → **"Site map"**
   - 右键点击目标站点
   - 选择 **"Paste"** 或使用 **"Paste from clipboard"**
4. Burp Suite 会自动解析所有请求并创建对应的站点结构

---

## 📊 测试接口说明

### 接口列表

| 序号 | 接口名称 | 端点路径 | 功能描述 |
|------|---------|---------|---------|
| 1 | ListClusters | `/cluster/cluster_list` | 获取集群列表（pageSize=10） |
| 2 | GetClusterInfo | `/cluster/cluster_info` | 获取集群详情（cluster_id=3） |
| 3 | ListClusterVulnEvents | `/cluster_vuln/vuln_event_list` | 查询集群漏洞（cluster_id=3, pageSize=5） |
| 4 | GetClusterVulnEvent | `/cluster_vuln/vuln_event_info` | 获取漏洞详情（id=30） |
| 5 | ListMicroserviceVulnEvents | `/cluster_microservice/vuln_event_list` | 查询微服务漏洞（pageSize=5） |
| 6 | GetMicroserviceVulnEvent | `/cluster_microservice/vuln_event_info` | 获取微服务漏洞详情（id=3） |

---

## 🔐 认证配置

### Headers 说明

每个请求都包含以下认证 Headers：

| Header | 值 | 说明 |
|--------|-----|------|
| `authorization` | `Bearer <token>` | Bearer Token 认证 |
| `token` | `<token>` | CloudWalker API Token |
| `x-auth-token` | `<token>` | 扩展认证 Token |
| `x-requested-with` | `XMLHttpRequest` | AJAX 请求标识 |
| `cookie` | `<完整cookie>` | Browser Session Cookie |
| `referer` | `https://cnapp.demo.chaitin.cn/profile/apitoken` | Referer Header |

### 认证信息（当前配置）

**Token**:
```
<TOKEN>
```

**关键 Cookie**:
```
<SESSION_COOKIE>
<SESSION_ID>
```

---

## 💡 测试技巧

### 1. 修改参数测试

在 Repeater 中可以修改参数进行测试：

**ListClusters - 测试不同分页大小**:
```http
GET /cluster/cluster_list?page_size=20 HTTP/1.1
GET /cluster/cluster_list?page_size=5 HTTP/1.1
GET /cluster/cluster_list?page_size=100 HTTP/1.1
```

**GetClusterInfo - 测试不同集群**:
```http
GET /cluster/cluster_info?cluster_id=3 HTTP/1.1
GET /cluster/cluster_info?cluster_id=8 HTTP/1.1
GET /cluster/cluster_info?cluster_id=9 HTTP/1.1
```

### 2. 认证测试

**测试仅有 Token（预期失败）**:
- 删除 Cookie header
- 发送请求
- 观察返回 HTML 登录页面

**测试完整认证（预期成功）**:
- 包含完整 Token + Cookie
- 发送请求
- 观察返回 JSON 数据

### 3. 响应分析

在 Burp Suite 中查看响应：
- **Response Headers**: 查看 content-type、trace-id 等
- **Response Body**: 查看 JSON 数据结构
- **时间分析**: Repeater 会显示响应时间

---

## 🧪 自动化测试

### 使用 Burp Suite Scanner

1. 右键点击请求
2. 选择 **"Do an active scan"**
3. Burp Suite 会自动进行安全扫描

### 执行序列测试

1. 在 Repeater 中创建多个请求
2. 右键选择 **"Create sequence"**
3. 按顺序执行所有测试

---

## 📝 常见问题

### Q1: 为什么请求返回 HTML 而不是 JSON？

**原因**: Cookie 不完整或已过期

**解决方法**:
1. 重新登录 CloudWalker 获取新 Cookie
2. 更新请求文件中的 Cookie header
3. 确保 Cookie 包含 `_c_WBKFRo` 和 `veinmind` 两个值

### Q2: 如何在 Burp Suite 中保存测试？

**方法**:
1. 在 Repeater 标签页右键
2. 选择 **"Save all"** 或 **"Save selected"**
3. 保存为 `.burp` 文件

### Q3: 如何批量测试？

**方法**:
1. 使用合集文件 `BURP_SUITE_REQUESTS.txt`
2. 导入到 Target Site Map
3. 右键选择 **"Spider and scan this host"**

---

## 🔧 高级使用

### 配置宏（Macro）自动更新 Cookie

1. 进入 **"Project options"** → **"Sessions"**
2. 创建 Macro 自动登录并获取 Cookie
3. 配置 Session handling rules 自动应用 Cookie

### 使用 Extensions

推荐安装以下 Burp Extensions：
- **JSON Parser**: 美化 JSON 响应
- **AuthAnalyzer**: 分析认证机制
- **Logger++**: 详细日志记录

---

## 📚 相关文档

- **测试报告**: `../CLOUDWALKER_FINAL_TEST_REPORT.md`
- **详细测试记录**: `../REAL_API_TEST_REPORT.md`
- **测试指南**: `../REAL_API_TEST_GUIDE.md`
- **README**: `../../README.md`

---

## ✅ 测试检查清单

测试完成后请检查：

- ✅ 所有 6 个接口都测试成功（返回 200 + JSON）
- ✅ 认证机制验证完成（Token + Cookie 组合）
- ✅ 不同参数组合测试（pageSize、clusterId、eventId）
- ✅ 错误场景测试（401、404、500）
- ✅ 响应时间记录（平均 <100ms）
- ✅ 响应数据结构验证（JSON 格式正确）

---

**测试环境**: https://cnapp.demo.chaitin.cn
**测试时间**: 2026-06-29
**测试状态**: ✅ 全部通过

---

<div align="center">

**Made with ❤️ for CloudWalker Testing**

</div>
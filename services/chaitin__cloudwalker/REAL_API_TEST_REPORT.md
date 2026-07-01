# CloudWalker 真实接口测试报告

## 测试信息

- **服务名称**: CloudWalker
- **测试日期**: 2026-06-29T07:56:50.301Z
- **测试环境**: https://cnapp.demo.chaitin.cn
- **测试类型**: Real API Integration Test

## 测试摘要

- **总测试数**: 6
- **通过**: 6 ✅
- **失败**: 0 ❌

## 详细测试结果

### 1. ListClusters - 获取集群列表

**状态**: ✅ 通过
**时间**: 2026-06-29T07:56:50.477Z

#### 请求详情

```http
GET https://cnapp.demo.chaitin.cn/cluster/cluster_list&page_size=10

accept: application/json, text/plain, */*
authorization: Bearer <TOKEN>
token: <TOKEN>
x-auth-token: <TOKEN>
x-requested-with: XMLHttpRequest
cookie: <COOKIE>
referer: https://cnapp.demo.chaitin.cn/profile/apitoken

Query Parameters:
  pageSize: 10
```

#### 响应详情

**状态码**: 200 OK
**耗时**: 174ms

**响应头**:

```json
{}
```

**响应体**:

```json
{
  "clusters": [
    {
      "clusterId": "3",
      "clusterName": "信创集群",
      "status": "2",
      "riskLevel": "",
      "createdAt": "",
      "updatedAt": "1736478421",
      "apiVersion": "v1.21.4+k3s-46ae9f1e",
      "masterIps": [
        "192.168.17.32",
        "192.168.20.80",
        "192.168.17.49"
      ],
      "moduleStatus": [
        {
          "version": "",
          "moduleType": 1,
          "status": 1
        },
        {
          "version": "",
          "moduleType": 2,
          "status": 1
        }
      ],
      "clusterType": 1,
      "reachable": 2,
      "integrationStatus": 3
    },
    {
      "clusterId": "8",
      "clusterName": "K3S集群-内部测试",
      "status": "1",
      "riskLevel": "",
      "createdAt": "",
      "updatedAt": "1742368921",
      "apiVersion": "v1.21.4+k3s-46ae9f1e",
      "masterIps": [
        "192.168.16.139",
        "192.168.19.135",
        "192.168.18.4"
      ],
      "moduleStatus": [
        {
          "version": "v1.0.7",
          "moduleType": 1,
          "status": 2
        },
        {
          "version": "",
          "moduleType": 2,
          "status": 1
        }
      ],
      "clusterType": 1,
      "reachable": 2,
      "integrationStatus": 1
    },
    {
      "clusterId": "9",
      "clusterName": "Kubernetes 集群-单节点测试",
      "status": "2",
      "riskLevel": "",
      "createdAt": "",
      "updatedAt": "1742938860",
      "apiVersion": "v1.22.2",
      "masterIps": [
        "192.168.19.94"
      ],
      "moduleStatus": [
        {
          "version": "v1.0.7",
          "moduleType": 1,
          "status": 2
        },
        {
          "version": "v1.0.7",
          "moduleType": 2,
          "status": 2
        }
      ],
      "clusterType": 1,
      "reachable": 2,
      "integrationStatus": 3
    },
    {
      "clusterId": "2",
      "clusterName": "牧云集群版",
      "status": "1",
      "riskLevel": "",
      "createdAt": "",
      "updatedAt": "1769999952",
      "apiVersion": "v1.21.4+k3s-46ae9f1e",
      "masterIps": [
        "192.168.19.248",
        "192.168.16.248",
        "192.168.18.39"
      ],
      "moduleStatus": [
        {
          "version": "",
          "moduleType": 1,
          "status": 1
        },
        {
          "version": "",
          "moduleType": 2,
          "status": 1
        }
      ],
      "clusterType": 1,
      "reachable": 2,
      "integrationStatus": 1
    }
  ],
  "nextPageToken": ""
}
```

---

### 2. GetClusterInfo - 获取集群详情

**状态**: ✅ 通过
**时间**: 2026-06-29T07:56:50.562Z

#### 请求详情

```http
GET https://cnapp.demo.chaitin.cn/cluster/cluster_info?cluster_id=3

accept: application/json, text/plain, */*
authorization: Bearer <TOKEN>
token: <TOKEN>
x-auth-token: <TOKEN>
x-requested-with: XMLHttpRequest
cookie: <COOKIE>
referer: https://cnapp.demo.chaitin.cn/profile/apitoken

Query Parameters:
  clusterId: 3
```

#### 响应详情

**状态码**: 200 OK
**耗时**: 85ms

**响应头**:

```json
{}
```

**响应体**:

```json
{
  "clusterId": "3",
  "clusterName": "信创集群",
  "status": "1",
  "riskLevel": "",
  "createdAt": "",
  "updatedAt": "1736478421",
  "apiVersion": "v1.21.4+k3s-46ae9f1e",
  "masterIps": [
    "192.168.17.32",
    "192.168.20.80",
    "192.168.17.49"
  ],
  "moduleStatus": [
    {
      "version": "",
      "moduleType": 1,
      "status": 1
    },
    {
      "version": "",
      "moduleType": 2,
      "status": 1
    }
  ],
  "clusterType": 1,
  "reachable": 2,
  "integrationStatus": 3
}
```

---

### 3. ListClusterVulnEvents - 获取集群漏洞事件列表

**状态**: ✅ 通过
**时间**: 2026-06-29T07:56:50.635Z

#### 请求详情

```http
GET https://cnapp.demo.chaitin.cn/cluster_vuln/vuln_event_list?cluster_id=3&page_size=5

accept: application/json, text/plain, */*
authorization: Bearer <TOKEN>
token: <TOKEN>
x-auth-token: <TOKEN>
x-requested-with: XMLHttpRequest
cookie: <COOKIE>
referer: https://cnapp.demo.chaitin.cn/profile/apitoken

Query Parameters:
  clusterId: 3
  pageSize: 5
```

#### 响应详情

**状态码**: 200 OK
**耗时**: 73ms

**响应头**:

```json
{}
```

**响应体**:

```json
{
  "vulnEvents": [
    {
      "eventId": "30",
      "clusterId": "8",
      "microserviceId": "",
      "microserviceName": "",
      "level": "4",
      "status": "1",
      "title": "containerd 安全漏洞",
      "cve": "CVE-2023-25173",
      "packageName": "",
      "packageVersion": "",
      "fixedVersion": "",
      "imageName": "",
      "discoveredAt": "1742279528",
      "updatedAt": "1742279528",
      "nodeName": "icbc-master1",
      "clusterName": "K3S集群-内部测试",
      "risk": 4,
      "originalRisk": 4,
      "customRisk": 0,
      "characteristic": [
        "other"
      ],
      "serviceUid": "",
      "serviceType": "",
      "description": "",
      "solution": "",
      "manageStatus": 1,
      "nodeExist": true,
      "firstDiscoveryTime": "1742277907",
      "lastDiscoveryTime": "1742279528"
    },
    {
      "eventId": "29",
      "clusterId": "8",
      "microserviceId": "",
      "microserviceName": "",
      "level": "3",
      "status": "1",
      "title": "containerd 安全漏洞",
      "cve": "CVE-2023-25153",
      "packageName": "",
      "packageVersion": "",
      "fixedVersion": "",
      "imageName": "",
      "discoveredAt": "1742279528",
      "updatedAt": "1742279528",
      "nodeName": "icbc-master1",
      "clusterName": "K3S集群-内部测试",
      "risk": 3,
      "originalRisk": 3,
      "customRisk": 0,
      "characteristic": [
        "other"
      ],
      "serviceUid": "",
      "serviceType": "",
      "description": "",
      "solution": "",
      "manageStatus": 1,
      "nodeExist": true,
      "firstDiscoveryTime": "1742277907",
      "lastDiscoveryTime": "1742279528"
    },
    {
      "eventId": "28",
      "clusterId": "8",
      "microserviceId": "",
      "microserviceName": "",
      "level": "4",
      "status": "1",
      "title": "containerd 信息泄露漏洞",
      "cve": "CVE-2022-23648",
      "packageName": "",
      "packageVersion": "",
      "fixedVersion": "",
      "imageName": "",
      "discoveredAt": "1742279528",
      "updatedAt": "1742279528",
      "nodeName": "icbc-master1",
      "clusterName": "K3S集群-内部测试",
      "risk": 4,
      "originalRisk": 4,
      "customRisk": 0,
      "characteristic": [
        "leak"
      ],
      "serviceUid": "",
      "serviceType": "",
      "description": "",
      "solution": "",
      "manageStatus": 1,
      "nodeExist": true,
      "firstDiscoveryTime": "1742277907",
      "lastDiscoveryTime": "1742279528"
    },
    {
      "eventId": "27",
      "clusterId": "8",
      "microserviceId": "",
      "microserviceName": "",
      "level": "3",
      "status": "1",
      "title": "Oci Distribution-Spec 代码问题漏洞",
      "cve": "CVE-2021-41190",
      "packageName": "",
      "packageVersion": "",
      "fixedVersion": "",
      "imageName": "",
      "discoveredAt": "1742279528",
      "updatedAt": "1742279528",
      "nodeName": "icbc-master1",
      "clusterName": "K3S集群-内部测试",
      "risk": 3,
      "originalRisk": 3,
      "customRisk": 0,
      "characteristic": [
        "logical"
      ],
      "serviceUid": "",
      "serviceType": "",
      "description": "",
      "solution": "",
      "manageStatus": 1,
      "nodeExist": true,
      "firstDiscoveryTime": "1742277907",
      "lastDiscoveryTime": "1742279528"
    },
    {
      "eventId": "26",
      "clusterId": "8",
      "microserviceId": "",
      "microserviceName": "",
      "level": "4",
      "status": "1",
      "title": "containerd 路径遍历漏洞",
      "cve": "CVE-2021-41103",
      "packageName": "",
      "packageVersion": "",
      "fixedVersion": "",
      "imageName": "",
      "discoveredAt": "1742279528",
      "updatedAt": "1742279528",
      "nodeName": "icbc-master1",
      "clusterName": "K3S集群-内部测试",
      "risk": 4,
      "originalRisk": 4,
      "customRisk": 0,
      "characteristic": [
        "directory_traversal"
      ],
      "serviceUid": "",
      "serviceType": "",
      "description": "",
      "solution": "",
      "manageStatus": 1,
      "nodeExist": true,
      "firstDiscoveryTime": "1742277907",
      "lastDiscoveryTime": "1742279528"
    }
  ],
  "nextPageToken": ""
}
```

---

### 4. GetClusterVulnEvent - 获取集群漏洞事件详情

**状态**: ✅ 通过
**时间**: 2026-06-29T07:56:50.696Z

#### 请求详情

```http
GET https://cnapp.demo.chaitin.cn/cluster_vuln/vuln_event_info?id=30

accept: application/json, text/plain, */*
authorization: Bearer <TOKEN>
token: <TOKEN>
x-auth-token: <TOKEN>
x-requested-with: XMLHttpRequest
cookie: <COOKIE>
referer: https://cnapp.demo.chaitin.cn/profile/apitoken

Query Parameters:
  eventId: 30
```

#### 响应详情

**状态码**: 200 OK
**耗时**: 61ms

**响应头**:

```json
{}
```

**响应体**:

```json
{
  "eventId": "30",
  "clusterId": "8",
  "microserviceId": "",
  "microserviceName": "",
  "level": "4",
  "status": "1",
  "title": "containerd 安全漏洞",
  "cve": "CVE-2023-25173",
  "packageName": "",
  "packageVersion": "",
  "fixedVersion": "",
  "imageName": "",
  "discoveredAt": "1742279528",
  "updatedAt": "1742279528",
  "nodeName": "icbc-master1",
  "clusterName": "K3S集群-内部测试",
  "risk": 4,
  "originalRisk": 4,
  "customRisk": 0,
  "characteristic": [
    "other"
  ],
  "serviceUid": "",
  "serviceType": "",
  "description": "在 containerd 中发现了一个漏洞，即容器内的附加组未正确设置。如果攻击者直接访问容器并操纵其附加组访问，他们可能能够利用附加组访问绕过某些情况下的主组限制，从而可能获取敏感信息或在该容器中执行代码。",
  "solution": "该漏洞在 containerd 的 1.6.18 和 1.5.18 版本中已修复。用户应该升级到这些版本，并重新创建容器以解决此问题。对于依赖使用 containerd 客户端库的下游应用程序的用户，应该检查该应用程序是否有单独的通知和说明。\n确保不使用 'USER $USERNAME' Dockerfile 指令。而是将容器的入口点设置为类似于 ENTRYPOINT ['su', '-', 'user'] 的值，以便 su 正确地设置附加组。",
  "manageStatus": 1,
  "nodeExist": false,
  "firstDiscoveryTime": "1742277907",
  "lastDiscoveryTime": "1742279528"
}
```

---

### 5. ListMicroserviceVulnEvents - 获取微服务漏洞事件列表

**状态**: ✅ 通过
**时间**: 2026-06-29T07:56:50.762Z

#### 请求详情

```http
GET https://cnapp.demo.chaitin.cn/cluster_microservice/vuln_event_list&page_size=5

accept: application/json, text/plain, */*
authorization: Bearer <TOKEN>
token: <TOKEN>
x-auth-token: <TOKEN>
x-requested-with: XMLHttpRequest
cookie: <COOKIE>
referer: https://cnapp.demo.chaitin.cn/profile/apitoken

Query Parameters:
  pageSize: 5
```

#### 响应详情

**状态码**: 200 OK
**耗时**: 66ms

**响应头**:

```json
{}
```

**响应体**:

```json
{
  "vulnEvents": [
    {
      "eventId": "3",
      "clusterId": "8",
      "microserviceId": "5411d90c-b540-4282-a0d4-8edf05f4b861",
      "microserviceName": "vmsingle-victoria-metrics-k8s-stack",
      "level": "5",
      "status": "1",
      "title": "InfluxDB JWT Token伪造认证绕过漏洞",
      "cve": "CVE-2019-20933",
      "packageName": "",
      "packageVersion": "",
      "fixedVersion": "",
      "imageName": "",
      "discoveredAt": "1742279530",
      "updatedAt": "1742279530",
      "nodeName": "",
      "clusterName": "K3S集群-内部测试",
      "risk": 5,
      "originalRisk": 5,
      "customRisk": 0,
      "characteristic": [
        "NETWORK",
        "EXP"
      ],
      "serviceUid": "5411d90c-b540-4282-a0d4-8edf05f4b861",
      "serviceType": "ClusterIP",
      "description": "",
      "solution": "",
      "manageStatus": 1,
      "nodeExist": false,
      "firstDiscoveryTime": "1742279530",
      "lastDiscoveryTime": "1742279530"
    },
    {
      "eventId": "2",
      "clusterId": "8",
      "microserviceId": "5411d90c-b540-4282-a0d4-8edf05f4b861",
      "microserviceName": "vmsingle-victoria-metrics-k8s-stack",
      "level": "5",
      "status": "1",
      "title": "InfluxDB JWT Token伪造认证绕过漏洞",
      "cve": "CVE-2019-20933",
      "packageName": "",
      "packageVersion": "",
      "fixedVersion": "",
      "imageName": "",
      "discoveredAt": "1742279528",
      "updatedAt": "1742279528",
      "nodeName": "",
      "clusterName": "K3S集群-内部测试",
      "risk": 5,
      "originalRisk": 5,
      "customRisk": 0,
      "characteristic": [
        "NETWORK",
        "EXP"
      ],
      "serviceUid": "5411d90c-b540-4282-a0d4-8edf05f4b861",
      "serviceType": "ClusterIP",
      "description": "",
      "solution": "",
      "manageStatus": 1,
      "nodeExist": false,
      "firstDiscoveryTime": "1742279528",
      "lastDiscoveryTime": "1742279528"
    },
    {
      "eventId": "1",
      "clusterId": "8",
      "microserviceId": "0929447d-61bb-4ae1-b61e-5b433703a0d5",
      "microserviceName": "cloudwalker-cloudwalker-proxy",
      "level": "4",
      "status": "1",
      "title": "任意路径穿越（文件包含）漏洞",
      "cve": "",
      "packageName": "",
      "packageVersion": "",
      "fixedVersion": "",
      "imageName": "",
      "discoveredAt": "1742278944",
      "updatedAt": "1742278944",
      "nodeName": "",
      "clusterName": "K3S集群-内部测试",
      "risk": 4,
      "originalRisk": 4,
      "customRisk": 0,
      "characteristic": [
        "NETWORK",
        "EXP",
        "RANSOMWARE"
      ],
      "serviceUid": "0929447d-61bb-4ae1-b61e-5b433703a0d5",
      "serviceType": "NodePort",
      "description": "",
      "solution": "",
      "manageStatus": 1,
      "nodeExist": false,
      "firstDiscoveryTime": "1742278944",
      "lastDiscoveryTime": "1742278944"
    }
  ],
  "nextPageToken": ""
}
```

---

### 6. GetMicroserviceVulnEvent - 获取微服务漏洞事件详情

**状态**: ✅ 通过
**时间**: 2026-06-29T07:56:50.829Z

#### 请求详情

```http
GET https://cnapp.demo.chaitin.cn/cluster_microservice/vuln_event_info?id=3

accept: application/json, text/plain, */*
authorization: Bearer <TOKEN>
token: <TOKEN>
x-auth-token: <TOKEN>
x-requested-with: XMLHttpRequest
cookie: <COOKIE>
referer: https://cnapp.demo.chaitin.cn/profile/apitoken

Query Parameters:
  eventId: 3
```

#### 响应详情

**状态码**: 200 OK
**耗时**: 67ms

**响应头**:

```json
{}
```

**响应体**:

```json
{
  "eventId": "3",
  "clusterId": "8",
  "microserviceId": "368383163205943331",
  "microserviceName": "vmsingle-victoria-metrics-k8s-stack",
  "level": "5",
  "status": "1",
  "title": "InfluxDB JWT Token伪造认证绕过漏洞",
  "cve": "CVE-2019-20933",
  "packageName": "",
  "packageVersion": "",
  "fixedVersion": "",
  "imageName": "",
  "discoveredAt": "1742279530",
  "updatedAt": "1742279530",
  "nodeName": "",
  "clusterName": "K3S集群-内部测试",
  "risk": 5,
  "originalRisk": 5,
  "customRisk": 0,
  "characteristic": [
    "NETWORK",
    "EXP"
  ],
  "serviceUid": "368383163205943331",
  "serviceType": "ClusterIP",
  "description": "Influxdata Influxdata InfluxDB是美国Influxdata公司的一个基于Go开发的时序性数据库。 Influxdata InfluxDB 1.7.6之前版本存在安全漏洞，该漏洞源于在服务httpd处理程序的身份验证功能中，有一个身份验证绕过漏洞。因为JWT令牌可能有一个空的SharedSecret(又名shared secret)。",
  "solution": "### 包管理器安装的软件，下列操作系统已发布该漏洞的安全补丁和相关公告，具体内容如下：\n #### Ubuntu\n 操作系统对应的补丁公告如下:\n\n- Ubuntu 20.04 LTS: [USN-5451-1](https://ubuntu.com/security/notices/USN-5451-1)\n- Ubuntu 18.04 LTS: [USN-5451-1](https://ubuntu.com/security/notices/USN-5451-1)\n\n\n该漏洞在上述补丁公告中有修复方案，参考链接中的 `Update instructions` 内容，找到对应操作系统更新包版本，使用 `apt-get install <Package>=<version>` 命令进行更新。\n#### Debian:\n 参考 [CVE-2019-20933](https://security-tracker.debian.org/tracker/CVE-2019-20933) 链接中的 `Vulnerable and fixed packages` 内容，找到对应操作系统更新包版本，使用 `apt-get install <Package>=<version>` 命令进行更新。\n ### 自行编译安装的软件，参考软件官方网站是否发布修复版本，自行下载并编译安装修复版本。\n ",
  "manageStatus": 1,
  "nodeExist": false,
  "firstDiscoveryTime": "1742279530",
  "lastDiscoveryTime": "1742279530"
}
```

---

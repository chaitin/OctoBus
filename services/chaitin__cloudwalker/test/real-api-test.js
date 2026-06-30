#!/usr/bin/env node

/**
 * CloudWalker 真实接口测试脚本
 * 用于测试 CloudWalker demo 环境的所有接口
 * 并生成包含请求和响应详情的测试报告
 */

import fs from 'node:fs';
import path from 'node:path';
import { URL } from 'node:url';
import { createClient } from '../src/cloudwalker.js';

// 测试配置
const TEST_CONFIG = {
  baseUrl: process.env.CLOUDWALKER_BASE_URL || 'https://cnapp.demo.chaitin.cn',
  token: process.env.CLOUDWALKER_TOKEN || '',
  cookie: process.env.CLOUDWALKER_COOKIE || '',
  referer: process.env.CLOUDWALKER_REFERER || 'https://cnapp.demo.chaitin.cn/profile/apitoken'
};

// 测试报告结构
const testReport = {
  testInfo: {
    serviceName: 'CloudWalker',
    testDate: new Date().toISOString(),
    testEnvironment: TEST_CONFIG.baseUrl,
    testType: 'Real API Integration Test'
  },
  testResults: [],
  summary: {
    totalTests: 0,
    passed: 0,
    failed: 0,
    errors: []
  }
};

/**
 * 记录请求和响应详情
 */
function logRequestResponse(testName, requestDetails, responseDetails, error = null) {
  const result = {
    testName,
    timestamp: new Date().toISOString(),
    request: {
      method: requestDetails.method || 'GET',
      url: requestDetails.url,
      headers: requestDetails.headers,
      params: requestDetails.params || {}
    },
    response: error ? null : {
      status: responseDetails.status,
      statusText: responseDetails.statusText,
      headers: responseDetails.headers,
      body: responseDetails.body,
      duration: responseDetails.duration
    },
    error: error ? {
      message: error.message,
      code: error.code,
      details: error.details,
      httpStatus: error.httpStatus
    } : null,
    status: error ? 'FAILED' : 'PASSED'
  };

  testReport.testResults.push(result);
  testReport.summary.totalTests++;

  if (error) {
    testReport.summary.failed++;
    testReport.summary.errors.push({
      testName,
      error: error.message
    });
  } else {
    testReport.summary.passed++;
  }

  return result;
}

/**
 * 创建自定义 fetch 函数以记录请求和响应
 */
function createLoggingFetch(originalFetch) {
  return async (url, options) => {
    const startTime = Date.now();

    // 记录请求详情
    const requestDetails = {
      method: options?.method || 'GET',
      url: url.toString(),
      headers: options?.headers || {},
      params: {}
    };

    console.log(`\n📤 Request: ${requestDetails.method} ${requestDetails.url}`);
    console.log('Headers:', JSON.stringify(requestDetails.headers, null, 2));

    try {
      const response = await originalFetch(url, options);
      const endTime = Date.now();
      const duration = endTime - startTime;

      // 提取响应 headers
      const responseHeaders = {};
      response.headers.forEach((value, key) => {
        responseHeaders[key] = value;
      });

      console.log(`\n📥 Response: ${response.status} ${response.statusText}`);
      console.log(`Duration: ${duration}ms`);
      console.log('Headers:', JSON.stringify(responseHeaders, null, 2));

      // 注意：不在这里读取响应体，因为 cloudwalker.js 会读取它
      // 我们会在外层记录处理后的响应数据

      return response;
    } catch (error) {
      const endTime = Date.now();
      const duration = endTime - startTime;

      console.error(`\n❌ Error after ${duration}ms:`, error.message);
      throw error;
    }
  };
}

/**
 * 测试用例定义
 */
const testCases = [
  {
    name: 'ListClusters - 获取集群列表',
    method: 'listClusters',
    params: { pageSize: 10 }
  },
  {
    name: 'GetClusterInfo - 获取集群详情',
    method: 'getClusterInfo',
    params: { clusterId: '' }, // 需要从 ListClusters 获取
    dependsOn: 'ListClusters'
  },
  {
    name: 'ListClusterVulnEvents - 获取集群漏洞事件列表',
    method: 'listClusterVulnEvents',
    params: { clusterId: '', pageSize: 5 }, // 需要从 ListClusters 获取
    dependsOn: 'ListClusters'
  },
  {
    name: 'GetClusterVulnEvent - 获取集群漏洞事件详情',
    method: 'getClusterVulnEvent',
    params: { eventId: '' }, // 需要从 ListClusterVulnEvents 获取
    dependsOn: 'ListClusterVulnEvents'
  },
  {
    name: 'ListMicroserviceVulnEvents - 获取微服务漏洞事件列表',
    method: 'listMicroserviceVulnEvents',
    params: { pageSize: 5 }
  },
  {
    name: 'GetMicroserviceVulnEvent - 获取微服务漏洞事件详情',
    method: 'getMicroserviceVulnEvent',
    params: { eventId: '' }, // 需要从 ListMicroserviceVulnEvents 获取
    dependsOn: 'ListMicroserviceVulnEvents'
  }
];

/**
 * 运行测试
 */
async function runTests() {
  console.log('🚀 CloudWalker 真实接口测试开始');
  console.log('='.repeat(80));
  console.log(`测试环境: ${TEST_CONFIG.baseUrl}`);
  console.log(`测试时间: ${testReport.testInfo.testDate}`);
  console.log('='.repeat(80));

  // 验证认证信息
  if (!TEST_CONFIG.token) {
    console.error('❌ 错误: 缺少 CLOUDWALKER_TOKEN 环境变量');
    console.log('\n请设置以下环境变量:');
    console.log('  CLOUDWALKER_BASE_URL=https://cnapp.demo.chaitin.cn');
    console.log('  CLOUDWALKER_TOKEN=<your-token>');
    console.log('  CLOUDWALKER_COOKIE=<your-cookie>');
    console.log('  CLOUDWALKER_REFERER=https://cnapp.demo.chaitin.cn/profile/apitoken');
    process.exit(1);
  }

  // 创建客户端
  const loggingFetch = createLoggingFetch(fetch);
  const client = createClient({
    baseUrl: TEST_CONFIG.baseUrl,
    token: TEST_CONFIG.token,
    cookie: TEST_CONFIG.cookie,
    referer: TEST_CONFIG.referer,
    fetchImpl: loggingFetch
  });

  // 存储测试结果以供依赖测试使用
  const testOutputs = {};

  // 运行所有测试
  for (const testCase of testCases) {
    console.log(`\n\n${'─'.repeat(80)}`);
    console.log(`🧪 测试: ${testCase.name}`);
    console.log(`${'─'.repeat(80)}`);

    // 检查依赖
    if (testCase.dependsOn) {
      const dependentResult = testOutputs[testCase.dependsOn];
      if (!dependentResult || dependentResult.status === 'FAILED') {
        console.log(`⚠️  跳过测试: 依赖测试 ${testCase.dependsOn} 未通过`);
        const result = logRequestResponse(
          testCase.name,
          { url: 'skipped', headers: {} },
          null,
          { message: `依赖测试 ${testCase.dependsOn} 未通过` }
        );
        continue;
      }

      // 从依赖测试结果中提取参数
      if (testCase.method === 'getClusterInfo' || testCase.method === 'listClusterVulnEvents') {
        const clusters = dependentResult.response?.body?.clusters || [];
        if (clusters.length > 0) {
          testCase.params.clusterId = clusters[0].clusterId;
        }
      } else if (testCase.method === 'getClusterVulnEvent') {
        const vulnEvents = dependentResult.response?.body?.vulnEvents || [];
        if (vulnEvents.length > 0) {
          testCase.params.eventId = vulnEvents[0].eventId;
        }
      } else if (testCase.method === 'getMicroserviceVulnEvent') {
        const vulnEvents = dependentResult.response?.body?.vulnEvents || [];
        if (vulnEvents.length > 0) {
          testCase.params.eventId = vulnEvents[0].eventId;
        }
      }
    }

    try {
      // 执行测试
      const startTime = Date.now();
      const result = await client[testCase.method](testCase.params);
      const endTime = Date.now();
      const duration = endTime - startTime;

      // 记录成功结果
      const lastRequest = {
        method: 'GET',
        url: `${TEST_CONFIG.baseUrl}${getEndpoint(testCase.method, testCase.params)}`,
        headers: buildHeaders(TEST_CONFIG),
        params: testCase.params
      };

      const responseDetails = {
        status: 200,
        statusText: 'OK',
        headers: {},
        body: result,
        duration
      };

      const testResult = logRequestResponse(testCase.name, lastRequest, responseDetails);
      testOutputs[testCase.name.split(' - ')[0]] = testResult;

      console.log(`\n✅ 测试通过 (${duration}ms)`);
      console.log('Result:', JSON.stringify(result, null, 2));

    } catch (error) {
      // 记录失败结果
      const lastRequest = {
        method: 'GET',
        url: `${TEST_CONFIG.baseUrl}${getEndpoint(testCase.method, testCase.params)}`,
        headers: buildHeaders(TEST_CONFIG),
        params: testCase.params
      };

      logRequestResponse(testCase.name, lastRequest, null, error);
      testOutputs[testCase.name.split(' - ')[0]] = { status: 'FAILED', error };

      console.log(`\n❌ 测试失败: ${error.message}`);
      if (error.code) console.log(`Error code: ${error.code}`);
      if (error.httpStatus) console.log(`HTTP status: ${error.httpStatus}`);
      if (error.details) console.log(`Details: ${error.details}`);
    }
  }

  // 打印测试摘要
  console.log(`\n\n${'═'.repeat(80)}`);
  console.log('📊 测试摘要');
  console.log(`${'═'.repeat(80)}`);
  console.log(`总测试数: ${testReport.summary.totalTests}`);
  console.log(`通过: ${testReport.summary.passed} ✅`);
  console.log(`失败: ${testReport.summary.failed} ❌`);

  if (testReport.summary.errors.length > 0) {
    console.log('\n失败的测试:');
    testReport.summary.errors.forEach(err => {
      console.log(`  - ${err.testName}: ${err.error}`);
    });
  }

  // 生成测试报告文件
  const reportPath = path.join(process.cwd(), 'REAL_API_TEST_REPORT.md');
  generateMarkdownReport(reportPath);

  console.log(`\n📄 测试报告已生成: ${reportPath}`);
  console.log(`${'═'.repeat(80)}`);
}

/**
 * 获取接口端点路径
 */
function getEndpoint(method, params) {
  const endpoints = {
    listClusters: '/cluster/cluster_list',
    getClusterInfo: `/cluster/cluster_info?cluster_id=${params.clusterId}`,
    listClusterVulnEvents: `/cluster_vuln/vuln_event_list?cluster_id=${params.clusterId}`,
    getClusterVulnEvent: `/cluster_vuln/vuln_event_info?id=${params.eventId}`,
    listMicroserviceVulnEvents: '/cluster_microservice/vuln_event_list',
    getMicroserviceVulnEvent: `/cluster_microservice/vuln_event_info?id=${params.eventId}`
  };

  let endpoint = endpoints[method] || '';

  // 添加分页参数
  if (params.pageSize) {
    endpoint += `&page_size=${params.pageSize}`;
  }
  if (params.pageToken) {
    endpoint += `&offset=${params.pageToken}`;
  }

  return endpoint;
}

/**
 * 构建请求头
 */
function buildHeaders(config) {
  const headers = {
    'accept': 'application/json, text/plain, */*',
    'authorization': `Bearer ${config.token}`,
    'token': config.token,
    'x-auth-token': config.token,
    'x-requested-with': 'XMLHttpRequest'
  };

  if (config.cookie) {
    headers['cookie'] = config.cookie;
  }

  if (config.referer) {
    headers['referer'] = config.referer;
  }

  return headers;
}

/**
 * 生成 Markdown 格式的测试报告
 */
function generateMarkdownReport(reportPath) {
  const lines = [];

  lines.push('# CloudWalker 真实接口测试报告');
  lines.push('');
  lines.push('## 测试信息');
  lines.push('');
  lines.push(`- **服务名称**: ${testReport.testInfo.serviceName}`);
  lines.push(`- **测试日期**: ${testReport.testInfo.testDate}`);
  lines.push(`- **测试环境**: ${testReport.testInfo.testEnvironment}`);
  lines.push(`- **测试类型**: ${testReport.testInfo.testType}`);
  lines.push('');

  lines.push('## 测试摘要');
  lines.push('');
  lines.push(`- **总测试数**: ${testReport.summary.totalTests}`);
  lines.push(`- **通过**: ${testReport.summary.passed} ✅`);
  lines.push(`- **失败**: ${testReport.summary.failed} ❌`);
  lines.push('');

  if (testReport.summary.errors.length > 0) {
    lines.push('### 失败的测试');
    lines.push('');
    testReport.summary.errors.forEach(err => {
      lines.push(`- **${err.testName}**: ${err.error}`);
    });
    lines.push('');
  }

  lines.push('## 详细测试结果');
  lines.push('');

  testReport.testResults.forEach((result, index) => {
    lines.push(`### ${index + 1}. ${result.testName}`);
    lines.push('');
    lines.push(`**状态**: ${result.status === 'PASSED' ? '✅ 通过' : '❌ 失败'}`);
    lines.push(`**时间**: ${result.timestamp}`);
    lines.push('');

    lines.push('#### 请求详情');
    lines.push('');
    lines.push('```http');
    lines.push(`${result.request.method} ${result.request.url}`);
    lines.push('');
    Object.entries(result.request.headers).forEach(([key, value]) => {
      lines.push(`${key}: ${value}`);
    });
    lines.push('');
    if (result.request.params && Object.keys(result.request.params).length > 0) {
      lines.push('Query Parameters:');
      Object.entries(result.request.params).forEach(([key, value]) => {
        if (value) lines.push(`  ${key}: ${value}`);
      });
    }
    lines.push('```');
    lines.push('');

    if (result.response) {
      lines.push('#### 响应详情');
      lines.push('');
      lines.push(`**状态码**: ${result.response.status} ${result.response.statusText}`);
      lines.push(`**耗时**: ${result.response.duration}ms`);
      lines.push('');
      lines.push('**响应头**:');
      lines.push('');
      lines.push('```json');
      lines.push(JSON.stringify(result.response.headers, null, 2));
      lines.push('```');
      lines.push('');
      lines.push('**响应体**:');
      lines.push('');
      lines.push('```json');
      lines.push(JSON.stringify(result.response.body, null, 2));
      lines.push('```');
      lines.push('');
    }

    if (result.error) {
      lines.push('#### 错误详情');
      lines.push('');
      lines.push('```json');
      lines.push(JSON.stringify(result.error, null, 2));
      lines.push('```');
      lines.push('');
    }

    lines.push('---');
    lines.push('');
  });

  fs.writeFileSync(reportPath, lines.join('\n'), 'utf-8');
}

// 运行测试
runTests().catch(error => {
  console.error('测试脚本执行失败:', error);
  process.exit(1);
});
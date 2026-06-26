#!/usr/bin/env node

import { defineService, runServiceMain } from "@chaitin-ai/octobus-sdk";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const DEFAULT_API_BASE = "https://hunter.qianxin.com/openApi";

/**
 * 请求频率限制配置
 */
const RATE_LIMIT = {
  maxRequestsPerSecond: 1,
  minIntervalMs: 2000,
  retryAfterMs: 3000,
};

let lastRequestTime = 0;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function checkRateLimit() {
  const currentTime = Date.now();
  const timeSinceLastRequest = currentTime - lastRequestTime;
  if (timeSinceLastRequest < RATE_LIMIT.minIntervalMs && lastRequestTime > 0) {
    const waitTime = RATE_LIMIT.minIntervalMs - timeSinceLastRequest;
    console.log(`[RateLimit] 请求间隔过短，等待 ${waitTime}ms`);
    await sleep(waitTime);
  }
  lastRequestTime = Date.now();
}

/**
 * base64url 编码（RFC 4648）- 支持中文
 */
function base64urlEncode(str) {
  return Buffer.from(str).toString('base64').replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Hunter 支持的查询字段白名单
 */
const SUPPORTED_FIELDS = new Set([
  // IP 相关
  "ip", "ip.port", "ip.country", "ip.province", "ip.city", "ip.isp", "ip.os",
  "ip.tag", "ip.port_count", "ip.ports", "port_count", "ip_tag", "base_protocol",
  "is_risk_protocol", "is_risk_protocol",
  // 域名相关
  "domain", "domain.suffix", "is_domain", "domain.registrant_email", "domain.status",
  "domain.whois_server", "domain.name_server", "domain.creation_date",
  "domain.expiry_date", "domain.updated_date", "domain.cname", "is_domain.cname",
  "domain_suffix", "domain_suffix",
  // Web 信息
  "web.title", "web.body", "web.similar", "web.similar_icon", "web.icon",
  "web.similar_id", "web.tag", "is_web", "web_title", "web_tag",
  // Header
  "header.server", "header.content_length", "header.status_code", "header",
  "server", "status_code", "web_content_length",
  // ICP 备案
  "icp.number", "icp.web_name", "icp.name", "icp.type", "icp.industry",
  "icp.province", "icp.city", "icp.district", "icp.is_exception",
  "icp_number", "icp_web_name", "icp_company_name", "icp_company_type",
  // 协议/端口
  "protocol", "protocol.transport", "protocol.banner", "base_protocol",
  // 组件信息
  "app.name", "app.type", "app.vendor", "app.version", "app",
  // 证书
  "cert", "cert.subject", "cert.subject.suffix", "cert.subject_org",
  "cert.issuer", "cert.issuer_org", "cert.sha-1", "cert.sha-256",
  "cert.sha-md5", "cert.serial_number", "cert.is_expired", "cert.is_trust",
  // AS
  "as.number", "as.name", "as.org", "asn", "as_name", "as_org",
  // TLS-JARM
  "tls-jarm.hash", "tls-jarm.ans",
  // 其他
  "title", "body", "country", "province", "city", "isp",
  "similar", "similar_id", "icon",
  "after", "before", "updated_at",
]);

/**
 * 查询语法正则（匹配单个条件）
 * 支持格式：
 * - key="value"
 * - key="value" && key2="value2"
 * - key=true (布尔值)
 * - key=123 (数字)
 */
const CONDITION_PATTERN = /([a-zA-Z_][a-zA-Z0-9_.-]*)\s*(=|==|!=|>=|<=|>|<)\s*("[^"]*"|true|false|\d+)/;
const VALUE_ONLY_PATTERN = /^[^=<>!&|]+$/;

function isFieldSupported(field) {
  if (!field) return false;
  if (SUPPORTED_FIELDS.has(field)) return true;
  return true; // 允许未知字段（Hunter 可能更新字段）
}

/**
 * 校验 Hunter 查询语法
 */
function validateSearchSyntax(query) {
  if (!query || typeof query !== "string") {
    return { valid: false, message: "查询语句不能为空" };
  }

  if (query.trim() === "") {
    return { valid: false, message: "查询语句不能为空" };
  }

  const warnings = [];
  let tempQuery = query;

  // 处理括号分组
  let parenCount = 0;
  for (const char of tempQuery) {
    if (char === "(") parenCount++;
    if (char === ")") parenCount--;
    if (parenCount < 0) {
      return { valid: false, message: "括号不匹配" };
    }
  }
  if (parenCount !== 0) {
    return { valid: false, message: "括号不匹配" };
  }

  tempQuery = tempQuery.replace(/\(/g, " ").replace(/\)/g, " ");

  const parts = tempQuery.split(/\s*(&&|\|\|)\s*/).filter(p => p.trim());

  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;

    // 纯关键词查询（如 "nginx"）
    if (VALUE_ONLY_PATTERN.test(trimmed) && !trimmed.includes("=") && !trimmed.includes("<") && !trimmed.includes(">")) {
      continue;
    }

    const match = trimmed.match(CONDITION_PATTERN);
    if (!match) {
      return { valid: false, message: `语法错误: "${trimmed}"` };
    }

    const field = match[1];
    const operator = match[2];
    const rawValue = match[3];

    if (!isFieldSupported(field)) {
      warnings.push(`未知字段 "${field}"，Hunter 可能不支持该字段`);
    }

    // 校验特定字段的值格式
    if (field === "ip" && rawValue) {
      const ipPattern = /^(\d{1,3}\.){3}\d{1,3}(\/\d{1,2})?$/;
      if (!ipPattern.test(rawValue.replace(/"/g, ""))) {
        warnings.push(`IP 格式可能不正确: "${rawValue}"`);
      }
    }

    if (field === "ip.port_count" && rawValue) {
      if (isNaN(Number(rawValue.replace(/"/g, "")))) {
        warnings.push(`port_count 应该是数字: "${rawValue}"`);
      }
    }
  }

  return { valid: true, warnings: warnings.length > 0 ? warnings : undefined };
}

/**
 * 构建查询字符串
 */
function buildQueryString(params) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      query.append(key, String(value));
    }
  }
  return query.toString();
}

/**
 * 调用 Hunter API（带频率控制）
 * 支持普通 GET/POST 和文件上传
 */
async function callHunterAPI(endpoint, params, method, apiKey, apiBase, fileContent) {
  await checkRateLimit();

  const url = `${apiBase}${endpoint}`;

  // 文件上传模式（批量查询）
  if (fileContent) {
    const formData = new FormData();

    // 创建临时文件
    const tempFile = path.join(os.tmpdir(), `hunter_batch_${Date.now()}.csv`);
    fs.writeFileSync(tempFile, fileContent, 'utf-8');

    try {
      // 使用 Blob 替代文件流
      const blob = new Blob([fileContent], { type: "text/csv" });
      formData.append("file", blob, "batch.csv");

      // 添加其他参数
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null && value !== "") {
          formData.append(key, String(value));
        }
      }

      const response = await fetch(`${url}?api-key=${apiKey}`, {
        method: method || "POST",
        headers: {
          "Accept": "application/json",
        },
        body: formData,
      });

      if (response.status === 429) {
        console.log("[RateLimit] 触发 Hunter API 限流，等待重试");
        await sleep(RATE_LIMIT.retryAfterMs);
        return callHunterAPI(endpoint, params, method, apiKey, apiBase, fileContent);
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return response.json();
    } finally {
      // 清理临时文件
      try {
        fs.unlinkSync(tempFile);
      } catch (e) {
        // 忽略删除错误
      }
    }
  }

  // 普通请求模式
  const queryParams = { ...params, "api-key": apiKey };
  const queryString = buildQueryString(queryParams);
  const fullUrl = `${url}${queryString ? "?" + queryString : ""}`;

  const response = await fetch(fullUrl, {
    method: method || "GET",
    headers: {
      "Accept": "application/json",
    },
  });

  if (response.status === 429) {
    console.log("[RateLimit] 触发 Hunter API 限流，等待重试");
    await sleep(RATE_LIMIT.retryAfterMs);
    return callHunterAPI(endpoint, params, method, apiKey, apiBase);
  }

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  return response.json();
}

/**
 * 处理 Hunter API 响应
 */
function processResponse(data) {
  return {
    code: data.code || 200,
    message: data.message || "success",
    data: data.data || null,
  };
}

const service = defineService({
  handlers: {
    // ==================== GetUserInfo ====================
    "hunter.v1.HunterService/GetUserInfo": async (ctx) => {
      const config = ctx.config || {};
      const secret = ctx.secret || {};
      const apiBase = config.api_base || DEFAULT_API_BASE;
      const apiKey = secret.api_key || "";

      const result = await callHunterAPI("/userInfo", {}, "GET", apiKey, apiBase);
      return processResponse(result);
    },

    // ==================== Search ====================
    "hunter.v1.HunterService/Search": async (ctx) => {
      const config = ctx.config || {};
      const secret = ctx.secret || {};
      const apiBase = config.api_base || DEFAULT_API_BASE;
      const apiKey = secret.api_key || "";

      const request = ctx.request;
      const search = request.search || "";

      // 语法校验
      const validation = validateSearchSyntax(search);
      if (!validation.valid) {
        throw new Error(`查询语法错误: ${validation.message}`);
      }

      const params = {
        search: search ? base64urlEncode(search) : "",
        page: request.page || 1,
        page_size: request.page_size || 10,
      };

      if (request.start_time) params.start_time = request.start_time;
      if (request.end_time) params.end_time = request.end_time;
      if (request.is_web) params.is_web = request.is_web;
      if (request.status_code) params.status_code = request.status_code;
      if (request.fields) params.fields = request.fields;

      const result = await callHunterAPI("/search", params, "GET", apiKey, apiBase);
      return processResponse(result);
    },

    // ==================== BatchSearch ====================
    "hunter.v1.HunterService/BatchSearch": async (ctx) => {
      const config = ctx.config || {};
      const secret = ctx.secret || {};
      const apiBase = config.api_base || DEFAULT_API_BASE;
      const apiKey = secret.api_key || "";

      const request = ctx.request;
      const search = request.search || "";
      const fileContent = request.file_content || request.fileContent || ""

      // 必须提供 search 或 file_content 之一
      if (!search && !fileContent) {
        throw new Error("必须提供 search 或 file_content 参数之一");
      }

      let result;

      if (fileContent) {
        // 文件上传模式
        console.log("[BatchSearch] 使用文件上传模式，文件内容长度:", fileContent.length);

        const params = {};

        if (request.start_time) params.start_time = request.start_time;
        if (request.end_time) params.end_time = request.end_time;
        if (request.is_web) params.is_web = request.is_web;
        if (request.status_code) params.status_code = request.status_code;
        if (request.fields) params.fields = request.fields;
        if (request.search_type) params.search_type = request.search_type;
        if (request.assets_limit) params.assets_limit = request.assets_limit;

        result = await callHunterAPI("/search/batch", params, "POST", apiKey, apiBase, fileContent);
      } else {
        // 语法查询模式
        // 语法校验
        const validation = validateSearchSyntax(search);
        if (!validation.valid) {
          throw new Error(`查询语法错误: ${validation.message}`);
        }

        const params = {
          search: search ? base64urlEncode(search) : "",
        };

        if (request.start_time) params.start_time = request.start_time;
        if (request.end_time) params.end_time = request.end_time;
        if (request.is_web) params.is_web = request.is_web;
        if (request.status_code) params.status_code = request.status_code;
        if (request.fields) params.fields = request.fields;
        if (request.search_type) params.search_type = request.search_type;
        if (request.assets_limit) params.assets_limit = request.assets_limit;

        result = await callHunterAPI("/search/batch", params, "POST", apiKey, apiBase);
      }

      return processResponse(result);
    },
  },
});

runServiceMain(service);

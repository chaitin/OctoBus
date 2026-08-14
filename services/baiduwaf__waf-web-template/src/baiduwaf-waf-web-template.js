import http from "node:http";
import https from "node:https";
import { createHmac } from "node:crypto";

import { GrpcError, grpcStatus } from "@chaitin-ai/octobus-sdk";

// ============================================================
// Method path constants
// ============================================================
export const WEBTEMPLATEDETAIL_PATH = "/BaiduWAF_WAFWebTemplate.BaiduWAF_WAFWebTemplate/WebTemplateDetail";
export const METHOD_WEBTEMPLATEDETAIL_FULL = "BaiduWAF_WAFWebTemplate.BaiduWAF_WAFWebTemplate/WebTemplateDetail";
export const WEBTEMPLATESAVE_PATH = "/BaiduWAF_WAFWebTemplate.BaiduWAF_WAFWebTemplate/WebTemplateSave";
export const METHOD_WEBTEMPLATESAVE_FULL = "BaiduWAF_WAFWebTemplate.BaiduWAF_WAFWebTemplate/WebTemplateSave";
export const WEBTEMPLATESWITCH_PATH = "/BaiduWAF_WAFWebTemplate.BaiduWAF_WAFWebTemplate/WebTemplateSwitch";
export const METHOD_WEBTEMPLATESWITCH_FULL = "BaiduWAF_WAFWebTemplate.BaiduWAF_WAFWebTemplate/WebTemplateSwitch";
export const WEBTEMPLATELIST_PATH = "/BaiduWAF_WAFWebTemplate.BaiduWAF_WAFWebTemplate/WebTemplateList";
export const METHOD_WEBTEMPLATELIST_FULL = "BaiduWAF_WAFWebTemplate.BaiduWAF_WAFWebTemplate/WebTemplateList";
export const WEBTEMPLATEDELETE_PATH = "/BaiduWAF_WAFWebTemplate.BaiduWAF_WAFWebTemplate/WebTemplateDelete";
export const METHOD_WEBTEMPLATEDELETE_FULL = "BaiduWAF_WAFWebTemplate.BaiduWAF_WAFWebTemplate/WebTemplateDelete";
export const WHITERULESDETAIL_PATH = "/BaiduWAF_WAFWebTemplate.BaiduWAF_WAFWebTemplate/WhiteRulesdetail";
export const METHOD_WHITERULESDETAIL_FULL = "BaiduWAF_WAFWebTemplate.BaiduWAF_WAFWebTemplate/WhiteRulesdetail";
export const WHITERULESDELETE_PATH = "/BaiduWAF_WAFWebTemplate.BaiduWAF_WAFWebTemplate/WhiteRulesdelete";
export const METHOD_WHITERULESDELETE_FULL = "BaiduWAF_WAFWebTemplate.BaiduWAF_WAFWebTemplate/WhiteRulesdelete";
export const WHITERULESSWITCH_PATH = "/BaiduWAF_WAFWebTemplate.BaiduWAF_WAFWebTemplate/WhiteRulesswitch";
export const METHOD_WHITERULESSWITCH_FULL = "BaiduWAF_WAFWebTemplate.BaiduWAF_WAFWebTemplate/WhiteRulesswitch";
export const WHITERULESLIST_PATH = "/BaiduWAF_WAFWebTemplate.BaiduWAF_WAFWebTemplate/WhiteRuleslist";
export const METHOD_WHITERULESLIST_FULL = "BaiduWAF_WAFWebTemplate.BaiduWAF_WAFWebTemplate/WhiteRuleslist";
export const REGIONRULESLIST_PATH = "/BaiduWAF_WAFWebTemplate.BaiduWAF_WAFWebTemplate/RegionRuleslist";
export const METHOD_REGIONRULESLIST_FULL = "BaiduWAF_WAFWebTemplate.BaiduWAF_WAFWebTemplate/RegionRuleslist";
export const DEFAULT_TIMEOUT_MS = 10000;
export const DEFAULT_MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
export const DEFAULT_API_BASE = "https://bss.wf.bj.baidubce.com";
export const BCE_CONTENT_TYPE = "application/json;charset=utf-8";
export const BCE_EXPIRE_SECONDS = 1800;
export const BCE_SIGNED_HEADERS = "content-type;host;x-bce-date";

// ============================================================
// Generic utility functions
// ============================================================

const grpcCodeFor = (code) => ({
  FAILED_PRECONDITION: grpcStatus.FAILED_PRECONDITION,
  INVALID_ARGUMENT: grpcStatus.INVALID_ARGUMENT,
  PERMISSION_DENIED: grpcStatus.PERMISSION_DENIED,
  UNAVAILABLE: grpcStatus.UNAVAILABLE,
  UNKNOWN: grpcStatus.UNKNOWN,
})[code] ?? grpcStatus.UNKNOWN;

const errorWithCode = (code, message) => {
  const err = new GrpcError(grpcCodeFor(code), message);
  err.legacyCode = code;
  return err;
};

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj ?? {}, key);
const firstDefined = (...vals) => vals.find((val) => val !== undefined && val !== null);

const unwrapString = (value) => {
  if (value === undefined || value === null) return "";
  if (typeof value === "object" && value !== null && hasOwn(value, "value")) {
    return unwrapString(value.value);
  }
  return String(value);
};

const pickString = (obj, keys) => {
  for (const key of keys) {
    if (!hasOwn(obj, key)) continue;
    const value = unwrapString(obj[key]).trim();
    if (value) return value;
  }
  return "";
};

const mapStringArray = (value) => Array.isArray(value) ? value.map(unwrapString).filter((v) => v) : [];
const pickStringArray = (obj, keys) => {
  for (const key of keys) {
    if (!hasOwn(obj, key)) continue;
    return mapStringArray(obj[key]);
  }
  return [];
};

const normalizeBaseUrl = (value) => {
  const raw = unwrapString(value).trim();
  if (!/^https?:\/\//i.test(raw)) return "";
  return raw.replace(/\/+$/, "");
};

const mergedBindings = (ctx = {}) => ({
  ...(ctx?.config ?? {}),
  ...(ctx?.secret ?? {}),
  ...(ctx?.bindings ?? {}),
});

const resolveSdkReq = (ctx = {}) => {
  if (ctx?.req && Object.keys(ctx.req).length) return ctx.req;
  return ctx?.request ?? {};
};

const resolveCallContext = (ctx = {}) => ({
  ...ctx,
  bindings: mergedBindings(ctx),
  limits: ctx.limits ?? {},
  meta: ctx.meta ?? {},
  req: resolveSdkReq(ctx),
});

const resolveTimeoutMs = (ctx) => {
  const bindings = ctx?.bindings ?? mergedBindings(ctx);
  const raw = Number(firstDefined(ctx?.limits?.timeoutMs, bindings.timeoutMs, bindings.timeout_ms, DEFAULT_TIMEOUT_MS));
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TIMEOUT_MS;
};

const resolveMaxResponseBytes = (ctx) => {
  const bindings = ctx?.bindings ?? mergedBindings(ctx);
  const raw = Number(firstDefined(bindings.maxResponseBytes, bindings.max_response_bytes, DEFAULT_MAX_RESPONSE_BYTES));
  return Number.isSafeInteger(raw) && raw > 0 ? raw : DEFAULT_MAX_RESPONSE_BYTES;
};

const resolveAccessKey = (bindings = {}) => pickString(bindings, ["access_key", "accessKey", "ak"]);
const resolveSecretKey = (bindings = {}) => pickString(bindings, ["secret_key", "secretKey", "sk"]);

const requireBceCredentials = (ctx) => {
  const bindings = mergedBindings(ctx);
  const accessKey = resolveAccessKey(bindings);
  const secretKey = resolveSecretKey(bindings);
  if (!accessKey) throw errorWithCode("INVALID_ARGUMENT", "access_key is required in bindings (config or secret)");
  if (!secretKey) throw errorWithCode("INVALID_ARGUMENT", "secret_key is required in bindings (config or secret)");
  return { accessKey, secretKey };
};

// ---- TLS ----

const buildTlsOptions = (bindings = {}) => {
  const skip = bindings.skipTlsVerify || bindings.tlsInsecureSkipVerify || bindings.insecureSkipVerify;
  if (!skip) return {};
  return { skipTlsVerify: true, tlsInsecureSkipVerify: true, insecureSkipVerify: true };
};

// ---- HTTP headers ----

const buildHeaders = (ctx, extra = {}) => {
  const meta = ctx?.meta || {};
  return {
    ...(ctx?.bindings?.headers || {}),
    "x-engine-instance": meta.instance_id || meta.instanceId || "unknown",
    "x-request-id": meta.request_id || meta.requestId || "unknown",
    ...extra,
  };
};

// ---- URL helpers ----

const buildUrl = (baseUrl, path, queryParams = {}) => {
  const base = String(baseUrl || "").replace(/\/+$/, "");
  const normalizedPath = String(path || "").replace(/^\/+/, "");
  const url = `${base}/${normalizedPath}`;
  const parts = [];
  for (const [key, value] of Object.entries(queryParams)) {
    if (value === undefined || value === null || value === "") continue;
    parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
  }
  return parts.length ? `${url}?${parts.join("&")}` : url;
};

// ---- HTTP status → gRPC code ----

const mapHttpStatusToCode = (status) => {
  if (status === 401 || status === 403) return "PERMISSION_DENIED";
  if (status >= 400 && status < 500) return "FAILED_PRECONDITION";
  return "UNAVAILABLE";
};

const MAX_HTTP_BODY_CHARS = 200;
const truncateHttpBody = (value, limit = MAX_HTTP_BODY_CHARS) => String(value || "").slice(0, limit);

// ---- Structured error helper ----

const throwStructuredError = (code, message, options = {}) => {
  const payload = {
    code,
    message,
    http_status: Number(options.httpStatus ?? 0),
    http_body: truncateHttpBody(options.httpBody),
  };
  if (options.reason) payload.reason = String(options.reason);
  throw errorWithCode(code, JSON.stringify(payload));
};

// ---- 日志 ----

const logFlow = (ctx, action, details) => {
  const meta = ctx?.meta || {};
  const trace = [];
  if (meta.instance_id || meta.instanceId) trace.push(`inst=${meta.instance_id || meta.instanceId}`);
  if (meta.request_id || meta.requestId) trace.push(`req=${meta.request_id || meta.requestId}`);
  const prefix = `[BaiduWAF_WAFWebTemplate][${action}]${trace.length ? `[${trace.join(" ")}]` : ""}`;
  try {
    console.log(prefix, JSON.stringify(details));
  } catch {
    console.log(prefix, details);
  }
};

// ---- JSON 解析 ----

const parseJsonBody = (text, action = "parse") => {
  try {
    return JSON.parse(text);
  } catch {
    throwStructuredError("UNKNOWN", `BaiduWAF_WAFWebTemplate ${action} response is not valid JSON`, {
      httpStatus: 0,
      httpBody: text,
      reason: "response is not valid JSON",
    });
  }
};

const fetchWithTimeout = async (url, init = {}, timeoutMs = DEFAULT_TIMEOUT_MS) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(new Error("request timed out")), timeoutMs);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } catch (err) {
    if (err?.name === "AbortError") {
      throw new Error("request timed out");
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
};

const requestTextWithNodeTransport = async (url, init = {}, options = {}) => new Promise((resolve, reject) => {
  const target = new URL(url);
  const transport = target.protocol === "https:" ? https : http;
  const headers = { ...(init.headers || {}) };
  if (init.body !== undefined && init.body !== null && headers["Content-Length"] === undefined && headers["content-length"] === undefined) {
    headers["Content-Length"] = Buffer.byteLength(String(init.body));
  }
  const req = transport.request(target, {
    method: init.method || "GET",
    headers,
    rejectUnauthorized: options.rejectUnauthorized !== false,
  }, (res) => {
    const chunks = [];
    let size = 0;
    res.on("data", (chunk) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.length;
      if (size > options.maxResponseBytes) {
        req.destroy(new Error(`upstream response exceeds ${options.maxResponseBytes} bytes`));
        return;
      }
      chunks.push(buffer);
    });
    res.on("end", () => {
      resolve({
        status: res.statusCode ?? 0,
        headers: res.headers,
        text: Buffer.concat(chunks).toString("utf8"),
      });
    });
  });

  req.on("error", reject);
  req.setTimeout(options.timeoutMs || DEFAULT_TIMEOUT_MS, () => {
    req.destroy(new Error("request timed out"));
  });

  if (init.body !== undefined && init.body !== null) req.write(init.body);
  req.end();
});

// ---- 网络请求 ----

const readFetchBody = async (res, maxResponseBytes) => {
  if (!res.body?.getReader) {
    const text = await res.text();
    if (Buffer.byteLength(text) > maxResponseBytes) throw new Error(`upstream response exceeds ${maxResponseBytes} bytes`);
    return text;
  }
  const reader = res.body.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxResponseBytes) {
      await reader.cancel();
      throw new Error(`upstream response exceeds ${maxResponseBytes} bytes`);
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks).toString("utf8");
};

const fetchText = async (ctx, url, init = {}, options = {}) => {
  const callCtx = resolveCallContext(ctx);
  const tlsOptions = buildTlsOptions(callCtx.bindings || {});
  const maxResponseBytes = resolveMaxResponseBytes(callCtx);
  const method = String(init.method || "GET").toUpperCase();
  const hasBody = init.body !== undefined && init.body !== null;
  const useNodeTransport = tlsOptions.skipTlsVerify || (hasBody && (method === "GET" || method === "HEAD"));
  let status;
  let headers;
  let text;
  try {
    if (useNodeTransport) {
      const response = await requestTextWithNodeTransport(url, init, {
        timeoutMs: resolveTimeoutMs(callCtx),
        rejectUnauthorized: !tlsOptions.skipTlsVerify,
        maxResponseBytes,
      });
      status = response.status;
      headers = response.headers;
      text = response.text;
    } else {
      const res = await fetchWithTimeout(url, {
        ...init,
      }, resolveTimeoutMs(callCtx));
      status = res.status;
      headers = res.headers;
      try {
        text = await readFetchBody(res, maxResponseBytes);
      } catch (err) {
        throwStructuredError("UNKNOWN", "BaiduWAF_WAFWebTemplate upstream response body read failed", {
          httpStatus: res.status,
          httpBody: "",
          reason: err?.message || "response body read failed",
        });
      }
    }
  } catch (err) {
    throwStructuredError("UNAVAILABLE", "BaiduWAF_WAFWebTemplate upstream request failed", {
      httpStatus: 0,
      httpBody: "",
      reason: err?.cause?.message || err?.message || "fetch failed",
    });
  }

  if ((status < 200 || status >= 300) && !options.acceptStatuses?.includes(status)) {
    throwStructuredError(mapHttpStatusToCode(status), `upstream HTTP ${status}`, {
      httpStatus: status,
      httpBody: "",
      reason: `upstream http ${status}`,
    });
  }

  return {
    http_status: status,
    http_body: text,
    headers,
  };
};

// ---- BCE 签名 ----

const formatBceDate = (date = new Date()) => date.toISOString().replace(/\.\d{3}Z$/, "Z");

const bceEncode = (value, safe = "-_.~") => {
  const safeChars = new Set(String(safe).split(""));
  let result = "";
  for (const ch of String(value)) {
    if ((ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || (ch >= "0" && ch <= "9") || safeChars.has(ch)) {
      result += ch;
      continue;
    }
    for (const byte of Buffer.from(ch)) {
      result += `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
    }
  }
  return result;
};

const buildCanonicalQueryString = (queryParams = {}) => Object.entries(queryParams)
  .filter(([, value]) => value !== undefined && value !== null && value !== "")
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([key, value]) => `${bceEncode(key)}=${bceEncode(value)}`)
  .join("&");

const buildCanonicalHeaders = (headersToSign = {}) => Object.entries(headersToSign)
  .sort(([a], [b]) => a.toLowerCase().localeCompare(b.toLowerCase()))
  .map(([key, value]) => `${bceEncode(key.toLowerCase(), "-_.~")}:${bceEncode(value)}`)
  .join("\n");

const buildCanonicalRequest = (method, uri, queryParams, headersToSign) => [
  String(method || "GET").toUpperCase(),
  bceEncode(uri, "/-_.~"),
  buildCanonicalQueryString(queryParams),
  buildCanonicalHeaders(headersToSign),
].join("\n");

const buildBceAuthorization = ({ accessKey, secretKey, method, uri, queryParams = {}, host, contentType = BCE_CONTENT_TYPE, xBceDate = formatBceDate() }) => {
  const headersToSign = {
    Host: host,
    "Content-Type": contentType,
    "x-bce-date": xBceDate,
  };
  const canonicalRequest = buildCanonicalRequest(method, uri, queryParams, headersToSign);
  const authStringPrefix = `bce-auth-v1/${accessKey}/${xBceDate}/${BCE_EXPIRE_SECONDS}`;
  const signingKey = createHmac("sha256", secretKey).update(authStringPrefix).digest();
  const signature = createHmac("sha256", signingKey).update(canonicalRequest).digest("hex");
  return `${authStringPrefix}/${BCE_SIGNED_HEADERS}/${signature}`;
};

const buildBceSignedHeaders = (ctx, { method, apiBase, path, queryParams = {} }) => {
  const { accessKey, secretKey } = requireBceCredentials(ctx);
  const baseUrl = new URL(resolveApiBase(mergedBindings({ bindings: { api_base: apiBase } })) || apiBase);
  const xBceDate = formatBceDate();
  const authorization = buildBceAuthorization({
    accessKey,
    secretKey,
    method,
    uri: path,
    queryParams,
    host: baseUrl.host,
    contentType: BCE_CONTENT_TYPE,
    xBceDate,
  });
  return {
    Host: baseUrl.host,
    "Content-Type": BCE_CONTENT_TYPE,
    "x-bce-date": xBceDate,
    Authorization: authorization,
  };
};

// ---- resolve* 函数 ----

const resolveApiBase = (bindings = {}) => {
  const base = normalizeBaseUrl(firstDefined(
    bindings.api_base,
    bindings.apiBase,
    bindings.base_url,
  ));
  return base || DEFAULT_API_BASE;
};

// ---- 数值转换 ----

const toInteger = (value, fallback = 0) => {
  const num = Number(value);
  if (!Number.isFinite(num) || Number.isNaN(num)) return fallback;
  return Math.trunc(num);
};

// ---- 校验函数 ----

const requireString = (value, field) => {
  const text = unwrapString(value).trim();
  if (!text) throw errorWithCode("INVALID_ARGUMENT", `${field} is required`);
  return text;
};

const requireIntegerField = (value, field) => {
  if (value === undefined || value === null || unwrapString(value).trim() === "") {
    throw errorWithCode("INVALID_ARGUMENT", `${field} is required`);
  }
  return toInteger(value, 0);
};

const requirePresent = (value, field) => {
  if (value === undefined || value === null) {
    throw errorWithCode("INVALID_ARGUMENT", `${field} is required`);
  }
  return value;
};

// ---- 映射层 ----

const mapWebTemplateDetailResult = (item) => {
  if (!item) return undefined;
  return {
    switch: toInteger(item.switch, 0),
    protectionDomains: pickStringArray(item, ["protectionDomains", "protection_domains"]),
    templateType: unwrapString(firstDefined(item.templateType, item.template_type)),
    templateKey: unwrapString(firstDefined(item.templateKey, item.template_key)),
    action: unwrapString(item.action),
    groupKey: unwrapString(firstDefined(item.groupKey, item.group_key)),
    ruleName: unwrapString(firstDefined(item.ruleName, item.rule_name)),
    ruleID: toInteger(firstDefined(item.ruleID, item.rule_id), 0),
    groupName: unwrapString(firstDefined(item.groupName, item.group_name)),
  };
};

const mapWebTemplateSaveResult = (item) => {
  if (!item) return undefined;
  return {
    templateKey: unwrapString(firstDefined(item.templateKey, item.template_key)),
  };
};

const mapWebTemplateListItem = (item) => {
  if (!item) return undefined;
  return {
    ruleName: unwrapString(firstDefined(item.ruleName, item.rule_name)),
    templateKey: unwrapString(firstDefined(item.templateKey, item.template_key)),
    templateType: unwrapString(firstDefined(item.templateType, item.template_type)),
    protectionDomains: pickStringArray(item, ["protectionDomains", "protection_domains"]),
    action: unwrapString(item.action),
    switch: toInteger(item.switch, 0),
    updateTime: unwrapString(firstDefined(item.updateTime, item.update_time)),
    ruleID: toInteger(firstDefined(item.ruleID, item.rule_id), 0),
  };
};

const mapWebTemplateListResult = (item) => {
  if (!item) return undefined;
  const rawItems = Array.isArray(item.result) ? item.result : [];
  return {
    result: rawItems.map(mapWebTemplateListItem).filter(Boolean),
    totalCount: toInteger(firstDefined(item.totalCount, item.total_count), 0),
  };
};

const mapWhiteRulesdetailTarget = (item) => {
  if (!item) return undefined;
  return {
    field: unwrapString(item.field),
    key: unwrapString(item.key),
    match: unwrapString(item.match),
    value: Array.isArray(item.value) ? item.value.map(unwrapString).filter((v) => v) : [],
  };
};

const mapWhiteRulesdetailResult = (item) => {
  if (!item) return undefined;
  return {
    ruleName: unwrapString(firstDefined(item.ruleName, item.rule_name)),
    ruleID: toInteger(firstDefined(item.ruleID, item.rule_id), 0),
    ruleType: unwrapString(firstDefined(item.ruleType, item.rule_type)),
    protectionDomains: pickStringArray(item, ["protectionDomains", "protection_domains"]),
    switch: toInteger(item.switch, 0),
    updateTime: unwrapString(firstDefined(item.updateTime, item.update_time)),
    targets: Array.isArray(item.targets) ? item.targets.map(mapWhiteRulesdetailTarget).filter(Boolean) : [],
  };
};

const mapWhiteRuleslistItem = (item) => {
  if (!item) return undefined;
  return {
    ruleName: unwrapString(firstDefined(item.ruleName, item.rule_name)),
    ruleType: unwrapString(firstDefined(item.ruleType, item.rule_type)),
    protectionDomains: pickStringArray(item, ["protectionDomains", "protection_domains"]),
    switch: toInteger(item.switch, 0),
    updateTime: unwrapString(firstDefined(item.updateTime, item.update_time)),
    ruleKey: unwrapString(firstDefined(item.ruleKey, item.rule_key)),
    ruleID: toInteger(firstDefined(item.ruleID, item.rule_id), 0),
    ignoreModules: pickStringArray(item, ["ignoreModules", "ignore_modules"]),
    ignoreIds: pickStringArray(item, ["ignoreIds", "ignore_ids"]),
  };
};

const mapWhiteRuleslistResult = (item) => {
  if (!item) return undefined;
  const rawItems = Array.isArray(item.result) ? item.result : [];
  return {
    result: rawItems.map(mapWhiteRuleslistItem).filter(Boolean),
    totalCount: toInteger(firstDefined(item.totalCount, item.total_count), 0),
  };
};

const mapRegionRuleslistValue = (item) => {
  if (!item) return undefined;
  return {
    domestic: Array.isArray(item.domestic) ? item.domestic.map(unwrapString).filter((v) => v) : [],
    overseas: Array.isArray(item.overseas) ? item.overseas.map(unwrapString).filter((v) => v) : [],
  };
};

const mapRegionRuleslistItem = (item) => {
  if (!item) return undefined;
  return {
    ruleName: unwrapString(firstDefined(item.ruleName, item.rule_name)),
    protectionDomains: pickStringArray(item, ["protectionDomains", "protection_domains"]),
    switch: hasOwn(item, "switch") ? toInteger(item.switch, 0) : undefined,
    updateTime: unwrapString(firstDefined(item.updateTime, item.update_time)),
    ruleKey: unwrapString(firstDefined(item.ruleKey, item.rule_key)),
    ruleID: toInteger(firstDefined(item.ruleID, item.rule_id), 0),
    ruleType: unwrapString(firstDefined(item.ruleType, item.rule_type)),
    action: unwrapString(item.action),
    value: item.value ? mapRegionRuleslistValue(item.value) : undefined,
  };
};

const mapRegionRuleslistResult = (item) => {
  if (!item) return undefined;
  const rawItems = Array.isArray(item.result) ? item.result : [];
  return {
    result: rawItems.map(mapRegionRuleslistItem).filter(Boolean),
    totalCount: hasOwn(item, "totalCount") || hasOwn(item, "total_count")
      ? toInteger(firstDefined(item.totalCount, item.total_count), 0)
      : undefined,
  };
};

const buildRulesListBody = (req, { includeAction = false } = {}) => {
  const pageNo = requireIntegerField(firstDefined(req?.pageNo, req?.page_no), "pageNo");
  const pageSize = requireIntegerField(firstDefined(req?.pageSize, req?.page_size), "pageSize");
  const switchRaw = firstDefined(req?.switch);
  const subdomainRaw = firstDefined(req?.subdomain, req?.subdomains);
  const ruleIDRaw = firstDefined(req?.ruleID, req?.ruleId, req?.rule_id);
  const ruleNameRaw = firstDefined(req?.ruleName, req?.rule_name);
  const actionRaw = firstDefined(req?.action);

  const body = {
    pageNo,
    pageSize,
  };

  if (switchRaw !== undefined && switchRaw !== null && unwrapString(switchRaw).trim() !== "") {
    body.switch = toInteger(switchRaw, 0);
  }

  if (Array.isArray(subdomainRaw)) {
    const subdomain = mapStringArray(subdomainRaw);
    if (subdomain.length) body.subdomain = subdomain;
  }

  if (ruleIDRaw !== undefined && ruleIDRaw !== null && unwrapString(ruleIDRaw).trim() !== "") {
    body.ruleID = unwrapString(ruleIDRaw).trim();
  }

  if (ruleNameRaw !== undefined && ruleNameRaw !== null) {
    body.ruleName = unwrapString(ruleNameRaw);
  }

  if (includeAction && actionRaw !== undefined && actionRaw !== null) {
    body.action = unwrapString(actionRaw);
  }

  return body;
};

// ---- 请求层 ----

const runWebTemplateDetail = async (req, ctx) => {
  const callCtx = resolveCallContext(ctx);
  const apiBase = resolveApiBase(callCtx.bindings || {});
  const templateKey = requireString(firstDefined(req?.templateKey, req?.template_key), "templateKey");
  const queryParams = { templateKey };
  const url = buildUrl(apiBase, "/v1/waf/webTemplate/detail", queryParams);

  const response = await fetchText(callCtx, url, {
    method: "GET",
    headers: buildHeaders(callCtx, buildBceSignedHeaders(callCtx, {
      method: "GET",
      apiBase,
      path: "/v1/waf/webTemplate/detail",
      queryParams,
    })),
  });
  const json = parseJsonBody(response.http_body, "WebTemplateDetail");
  return { json, httpStatus: response.http_status };
};

const runWebTemplateSave = async (req, ctx) => {
  const callCtx = resolveCallContext(ctx);
  const apiBase = resolveApiBase(callCtx.bindings || {});

  const name = requireString(firstDefined(req?.name), "name");
  const switchValue = requireIntegerField(firstDefined(req?.switch), "switch");
  const templateType = requireString(firstDefined(req?.templateType, req?.template_type), "templateType");
  const action = requireString(firstDefined(req?.action), "action");
  const rulesGroupID = requireString(firstDefined(req?.rulesGroupID, req?.rulesGroupId, req?.rules_group_id), "rulesGroupID");

  const bindInfo = Array.isArray(firstDefined(req?.bindInfo, req?.bind_info))
    ? firstDefined(req?.bindInfo, req?.bind_info).map((item) => ({
        instanceID: unwrapString(firstDefined(item?.instanceID, item?.instanceId, item?.instance_id)),
        subdomains: Array.isArray(item?.subdomains) ? item.subdomains.map(unwrapString).filter((v) => v) : [],
      }))
    : [];

  const body = {
    name,
    bindInfo,
    switch: switchValue,
    templateType,
    action,
    rulesGroupID,
  };

  const templateKey = unwrapString(firstDefined(req?.templateKey, req?.template_key)).trim();
  if (templateKey) body.templateKey = templateKey;

  const response = await fetchText(callCtx, `${apiBase}/v1/waf/webTemplate/save`, {
    method: "POST",
    headers: buildHeaders(callCtx, buildBceSignedHeaders(callCtx, {
      method: "POST",
      apiBase,
      path: "/v1/waf/webTemplate/save",
      queryParams: {},
    })),
    body: JSON.stringify(body),
  });
  const json = parseJsonBody(response.http_body, "WebTemplateSave");
  return { json, httpStatus: response.http_status };
};

const runWebTemplateSwitch = async (req, ctx) => {
  const callCtx = resolveCallContext(ctx);
  const apiBase = resolveApiBase(callCtx.bindings || {});
  const templateKey = requireString(firstDefined(req?.templateKey, req?.template_key), "templateKey");
  const switchValue = requireIntegerField(firstDefined(req?.switch), "switch");

  const response = await fetchText(callCtx, `${apiBase}/v1/waf/webTemplate/switch`, {
    method: "POST",
    headers: buildHeaders(callCtx, buildBceSignedHeaders(callCtx, {
      method: "POST",
      apiBase,
      path: "/v1/waf/webTemplate/switch",
      queryParams: {},
    })),
    body: JSON.stringify({
      templateKey,
      switch: switchValue,
    }),
  });
  const json = parseJsonBody(response.http_body, "WebTemplateSwitch");
  return { json, httpStatus: response.http_status };
};

const runWebTemplateList = async (req, ctx) => {
  const callCtx = resolveCallContext(ctx);
  const apiBase = resolveApiBase(callCtx.bindings || {});
  const pageNo = requireIntegerField(firstDefined(req?.pageNo, req?.page_no), "pageNo");
  const pageSize = requireIntegerField(firstDefined(req?.pageSize, req?.page_size), "pageSize");
  const switchValue = requireIntegerField(firstDefined(req?.switch), "switch");
  const actionValue = requirePresent(firstDefined(req?.action), "action");
  const templateNameValue = requirePresent(firstDefined(req?.templateName, req?.template_name), "templateName");
  const subdomains = Array.isArray(firstDefined(req?.subdomains))
    ? firstDefined(req?.subdomains).map(unwrapString).filter((v) => v)
    : [];
  const ruleIDRaw = firstDefined(req?.ruleID, req?.ruleId, req?.rule_id);

  const body = {
    pageNo,
    pageSize,
    switch: switchValue,
    action: unwrapString(actionValue),
    templateName: unwrapString(templateNameValue),
  };

  if (subdomains.length) body.subdomains = subdomains;
  if (ruleIDRaw !== undefined && ruleIDRaw !== null && unwrapString(ruleIDRaw).trim() !== "") {
    body.ruleID = toInteger(ruleIDRaw, 0);
  }

  const response = await fetchText(callCtx, `${apiBase}/v1/waf/webTemplate/list`, {
    method: "POST",
    headers: buildHeaders(callCtx, buildBceSignedHeaders(callCtx, {
      method: "POST",
      apiBase,
      path: "/v1/waf/webTemplate/list",
      queryParams: {},
    })),
    body: JSON.stringify(body),
  });
  const json = parseJsonBody(response.http_body, "WebTemplateList");
  return { json, httpStatus: response.http_status };
};

const runWebTemplateDelete = async (req, ctx) => {
  const callCtx = resolveCallContext(ctx);
  const apiBase = resolveApiBase(callCtx.bindings || {});
  const templateKey = requireString(firstDefined(req?.templateKey, req?.template_key), "templateKey");
  const queryParams = { templateKey };
  const url = buildUrl(apiBase, "/v1/waf/webTemplate/delete", queryParams);
  const response = await fetchText(callCtx, url, {
    method: "DELETE",
    headers: buildHeaders(callCtx, buildBceSignedHeaders(callCtx, {
      method: "DELETE", apiBase, path: "/v1/waf/webTemplate/delete", queryParams,
    })),
  }, { acceptStatuses: [404] });
  const httpStatus = response.http_status;
  const text = response.http_body;

  if (httpStatus === 404) {
    logFlow(callCtx, "WebTemplateDelete:already-gone", { templateKey });
    return { alreadyGone: true, json: { success: true, result: {} }, httpStatus };
  }

  const json = parseJsonBody(text, "WebTemplateDelete");
  return { alreadyGone: false, json, httpStatus };
};

const runWhiteRulesdetail = async (req, ctx) => {
  const callCtx = resolveCallContext(ctx);
  const apiBase = resolveApiBase(callCtx.bindings || {});
  const ruleKey = requireString(firstDefined(req?.ruleKey, req?.rule_key), "ruleKey");
  const queryParams = { ruleKey };
  const url = buildUrl(apiBase, "/v1/waf/whiteRules/detail", queryParams);

  const response = await fetchText(callCtx, url, {
    method: "GET",
    headers: buildHeaders(callCtx, buildBceSignedHeaders(callCtx, {
      method: "GET",
      apiBase,
      path: "/v1/waf/whiteRules/detail",
      queryParams,
    })),
  });
  const json = parseJsonBody(response.http_body, "WhiteRulesdetail");
  return { json, httpStatus: response.http_status };
};

const runWhiteRulesdelete = async (req, ctx) => {
  const callCtx = resolveCallContext(ctx);
  const apiBase = resolveApiBase(callCtx.bindings || {});
  const ruleKey = requireString(firstDefined(req?.ruleKey, req?.rule_key), "ruleKey");
  const queryParams = { ruleKey };
  const url = buildUrl(apiBase, "/v1/waf/whiteRules/delete", queryParams);
  const response = await fetchText(callCtx, url, {
    method: "DELETE",
    headers: buildHeaders(callCtx, buildBceSignedHeaders(callCtx, {
      method: "DELETE", apiBase, path: "/v1/waf/whiteRules/delete", queryParams,
    })),
  }, { acceptStatuses: [404] });
  const httpStatus = response.http_status;
  const text = response.http_body;

  if (httpStatus === 404) {
    logFlow(callCtx, "WhiteRulesdelete:already-gone", { ruleKey });
    return { alreadyGone: true, json: { success: true, result: [] }, httpStatus };
  }

  const json = parseJsonBody(text, "WhiteRulesdelete");
  return { alreadyGone: false, json, httpStatus };
};

const runWhiteRulesswitch = async (req, ctx) => {
  const callCtx = resolveCallContext(ctx);
  const apiBase = resolveApiBase(callCtx.bindings || {});
  const ruleKey = requireString(firstDefined(req?.ruleKey, req?.rule_key), "ruleKey");
  const switchValue = requireIntegerField(firstDefined(req?.switch), "switch");

  const response = await fetchText(callCtx, `${apiBase}/v1/waf/whiteRules/switch`, {
    method: "POST",
    headers: buildHeaders(callCtx, buildBceSignedHeaders(callCtx, {
      method: "POST",
      apiBase,
      path: "/v1/waf/whiteRules/switch",
      queryParams: {},
    })),
    body: JSON.stringify({
      ruleKey,
      switch: switchValue,
    }),
  });
  const json = parseJsonBody(response.http_body, "WhiteRulesswitch");
  return { json, httpStatus: response.http_status };
};

const runWhiteRuleslist = async (req, ctx) => {
  const callCtx = resolveCallContext(ctx);
  const apiBase = resolveApiBase(callCtx.bindings || {});
  const body = buildRulesListBody(req);

  const response = await fetchText(callCtx, `${apiBase}/v1/waf/whiteRules/list`, {
    method: "POST",
    headers: buildHeaders(callCtx, buildBceSignedHeaders(callCtx, {
      method: "POST",
      apiBase,
      path: "/v1/waf/whiteRules/list",
      queryParams: {},
    })),
    body: JSON.stringify(body),
  });
  const json = parseJsonBody(response.http_body, "WhiteRuleslist");
  return { json, httpStatus: response.http_status };
};

const runRegionRuleslist = async (req, ctx) => {
  const callCtx = resolveCallContext(ctx);
  const apiBase = resolveApiBase(callCtx.bindings || {});
  const body = buildRulesListBody(req, { includeAction: true });

  const response = await fetchText(callCtx, `${apiBase}/v1/waf/regionRules/list`, {
    method: "POST",
    headers: buildHeaders(callCtx, buildBceSignedHeaders(callCtx, {
      method: "POST",
      apiBase,
      path: "/v1/waf/regionRules/list",
      queryParams: {},
    })),
    body: JSON.stringify(body),
  });
  const json = parseJsonBody(response.http_body, "RegionRuleslist");
  return { json, httpStatus: response.http_status };
};
// ---- 编排层 ----

const handleWebTemplateDetail = async (req, ctx) => {
  const callCtx = resolveCallContext(ctx);
  const templateKey = firstDefined(req?.templateKey, req?.template_key);
  logFlow(callCtx, "WebTemplateDetail:start", { templateKey });
  const { json } = await runWebTemplateDetail(req, callCtx);
  logFlow(callCtx, "WebTemplateDetail:success", {});

  return {
    status: toInteger(json.status, 0),
    result: json.result ? mapWebTemplateDetailResult(json.result) : undefined,
    success: Boolean(json.success),
  };
};

const handleWebTemplateSave = async (req, ctx) => {
  const callCtx = resolveCallContext(ctx);
  logFlow(callCtx, "WebTemplateSave:start", {});
  const { json } = await runWebTemplateSave(req, callCtx);
  logFlow(callCtx, "WebTemplateSave:success", {});

  return {
    status: toInteger(json.status, 0),
    result: json.result ? mapWebTemplateSaveResult(json.result) : undefined,
  };
};

const handleWebTemplateSwitch = async (req, ctx) => {
  const callCtx = resolveCallContext(ctx);
  const templateKey = firstDefined(req?.templateKey, req?.template_key);
  logFlow(callCtx, "WebTemplateSwitch:start", { templateKey });
  const { json } = await runWebTemplateSwitch(req, callCtx);
  logFlow(callCtx, "WebTemplateSwitch:success", {});

  return {
    success: Boolean(json.success),
    status: toInteger(json.status, 0),
  };
};

const handleWebTemplateList = async (req, ctx) => {
  const callCtx = resolveCallContext(ctx);
  logFlow(callCtx, "WebTemplateList:start", {
    pageNo: firstDefined(req?.pageNo, req?.page_no),
    pageSize: firstDefined(req?.pageSize, req?.page_size),
  });
  const { json } = await runWebTemplateList(req, callCtx);
  logFlow(callCtx, "WebTemplateList:success", {});

  return {
    status: toInteger(json.status, 0),
    success: Boolean(json.success),
    result: json.result ? mapWebTemplateListResult(json.result) : undefined,
  };
};

const handleWebTemplateDelete = async (req, ctx) => {
  const callCtx = resolveCallContext(ctx);
  const templateKey = firstDefined(req?.templateKey, req?.template_key);
  logFlow(callCtx, "WebTemplateDelete:start", { templateKey });
  const { alreadyGone, json } = await runWebTemplateDelete(req, callCtx);

  if (alreadyGone) {
    return { success: true, result: {}, alreadyGone: true };
  }

  logFlow(callCtx, "WebTemplateDelete:success", {});
  return {
    success: Boolean(json.success),
    result: json.result && typeof json.result === "object" ? {} : undefined,
    alreadyGone: false,
  };
};

const handleWhiteRulesdetail = async (req, ctx) => {
  const callCtx = resolveCallContext(ctx);
  const ruleKey = firstDefined(req?.ruleKey, req?.rule_key);
  logFlow(callCtx, "WhiteRulesdetail:start", { ruleKey });
  const { json } = await runWhiteRulesdetail(req, callCtx);
  logFlow(callCtx, "WhiteRulesdetail:success", {});

  return {
    success: Boolean(json.success),
    status: toInteger(json.status, 0),
    result: json.result ? mapWhiteRulesdetailResult(json.result) : undefined,
  };
};

const handleWhiteRulesdelete = async (req, ctx) => {
  const callCtx = resolveCallContext(ctx);
  const ruleKey = firstDefined(req?.ruleKey, req?.rule_key);
  logFlow(callCtx, "WhiteRulesdelete:start", { ruleKey });
  const { alreadyGone, json } = await runWhiteRulesdelete(req, callCtx);

  if (alreadyGone) {
    return { success: true, result: [], alreadyGone: true };
  }

  logFlow(callCtx, "WhiteRulesdelete:success", {});
  return {
    success: Boolean(json.success),
    result: Array.isArray(json.result) ? json.result.map(unwrapString) : [],
    alreadyGone: false,
  };
};

const handleWhiteRulesswitch = async (req, ctx) => {
  const callCtx = resolveCallContext(ctx);
  const ruleKey = firstDefined(req?.ruleKey, req?.rule_key);
  logFlow(callCtx, "WhiteRulesswitch:start", { ruleKey });
  const { json } = await runWhiteRulesswitch(req, callCtx);
  logFlow(callCtx, "WhiteRulesswitch:success", {});

  return {
    success: Boolean(json.success),
    result: Array.isArray(json.result) ? json.result.map(unwrapString) : [],
  };
};

const handleWhiteRuleslist = async (req, ctx) => {
  const callCtx = resolveCallContext(ctx);
  logFlow(callCtx, "WhiteRuleslist:start", {
    pageNo: firstDefined(req?.pageNo, req?.page_no),
    pageSize: firstDefined(req?.pageSize, req?.page_size),
  });
  const { json } = await runWhiteRuleslist(req, callCtx);
  logFlow(callCtx, "WhiteRuleslist:success", {});

  return {
    success: Boolean(json.success),
    status: toInteger(json.status, 0),
    result: json.result ? mapWhiteRuleslistResult(json.result) : undefined,
  };
};

const handleRegionRuleslist = async (req, ctx) => {
  const callCtx = resolveCallContext(ctx);
  logFlow(callCtx, "RegionRuleslist:start", {
    pageNo: firstDefined(req?.pageNo, req?.page_no),
    pageSize: firstDefined(req?.pageSize, req?.page_size),
  });
  const { json } = await runRegionRuleslist(req, callCtx);
  logFlow(callCtx, "RegionRuleslist:success", {});

  return {
    success: Boolean(json.success),
    status: toInteger(json.status, 0),
    result: json.result ? mapRegionRuleslistResult(json.result) : undefined,
  };
};

const registerHandlers = (ctx = {}) => {
  const callCtx = resolveCallContext(ctx);
  return {
    [WEBTEMPLATEDETAIL_PATH]: (req = callCtx.req) => handleWebTemplateDetail(req ?? {}, callCtx),
    [WEBTEMPLATESAVE_PATH]: (req = callCtx.req) => handleWebTemplateSave(req ?? {}, callCtx),
    [WEBTEMPLATESWITCH_PATH]: (req = callCtx.req) => handleWebTemplateSwitch(req ?? {}, callCtx),
    [WEBTEMPLATELIST_PATH]: (req = callCtx.req) => handleWebTemplateList(req ?? {}, callCtx),
    [WEBTEMPLATEDELETE_PATH]: (req = callCtx.req) => handleWebTemplateDelete(req ?? {}, callCtx),
    [WHITERULESDETAIL_PATH]: (req = callCtx.req) => handleWhiteRulesdetail(req ?? {}, callCtx),
    [WHITERULESDELETE_PATH]: (req = callCtx.req) => handleWhiteRulesdelete(req ?? {}, callCtx),
    [WHITERULESSWITCH_PATH]: (req = callCtx.req) => handleWhiteRulesswitch(req ?? {}, callCtx),
    [WHITERULESLIST_PATH]: (req = callCtx.req) => handleWhiteRuleslist(req ?? {}, callCtx),
    [REGIONRULESLIST_PATH]: (req = callCtx.req) => handleRegionRuleslist(req ?? {}, callCtx),
  };
};

export function rpcdef(ctx = {}) {
  return registerHandlers(ctx);
}

const callSdkHandler = (ctx, path) => registerHandlers(ctx)[path](resolveSdkReq(ctx));

export const handlers = {
  [METHOD_WEBTEMPLATEDETAIL_FULL]: (ctx) => callSdkHandler(ctx, WEBTEMPLATEDETAIL_PATH),
  [METHOD_WEBTEMPLATESAVE_FULL]: (ctx) => callSdkHandler(ctx, WEBTEMPLATESAVE_PATH),
  [METHOD_WEBTEMPLATESWITCH_FULL]: (ctx) => callSdkHandler(ctx, WEBTEMPLATESWITCH_PATH),
  [METHOD_WEBTEMPLATELIST_FULL]: (ctx) => callSdkHandler(ctx, WEBTEMPLATELIST_PATH),
  [METHOD_WEBTEMPLATEDELETE_FULL]: (ctx) => callSdkHandler(ctx, WEBTEMPLATEDELETE_PATH),
  [METHOD_WHITERULESDETAIL_FULL]: (ctx) => callSdkHandler(ctx, WHITERULESDETAIL_PATH),
  [METHOD_WHITERULESDELETE_FULL]: (ctx) => callSdkHandler(ctx, WHITERULESDELETE_PATH),
  [METHOD_WHITERULESSWITCH_FULL]: (ctx) => callSdkHandler(ctx, WHITERULESSWITCH_PATH),
  [METHOD_WHITERULESLIST_FULL]: (ctx) => callSdkHandler(ctx, WHITERULESLIST_PATH),
  [METHOD_REGIONRULESLIST_FULL]: (ctx) => callSdkHandler(ctx, REGIONRULESLIST_PATH),
};

rpcdef.__test__ = {
  BCE_CONTENT_TYPE,
  BCE_EXPIRE_SECONDS,
  BCE_SIGNED_HEADERS,
  bceEncode,
  buildBceAuthorization,
  buildBceSignedHeaders,
  buildCanonicalHeaders,
  buildCanonicalQueryString,
  buildCanonicalRequest,
  buildHeaders,
  buildTlsOptions,
  buildUrl,
  errorWithCode,
  fetchText,
  fetchWithTimeout,
  firstDefined,
  formatBceDate,
  grpcCodeFor,
  handleWebTemplateDelete,
  handleWebTemplateDetail,
  handleWebTemplateList,
  handleWebTemplateSave,
  handleWebTemplateSwitch,
  handleWhiteRulesdelete,
  handleWhiteRulesdetail,
  handleWhiteRuleslist,
  handleWhiteRulesswitch,
  handleRegionRuleslist,
  hasOwn,
  logFlow,
  mapHttpStatusToCode,
  MAX_HTTP_BODY_CHARS,
  mapWebTemplateDetailResult,
  mapWebTemplateListItem,
  mapWebTemplateListResult,
  mapWebTemplateSaveResult,
  mapWhiteRulesdetailResult,
  mapWhiteRulesdetailTarget,
  mapWhiteRuleslistItem,
  mapWhiteRuleslistResult,
  mapRegionRuleslistValue,
  mapRegionRuleslistItem,
  mapRegionRuleslistResult,
  mergedBindings,
  normalizeBaseUrl,
  parseJsonBody,
  pickString,
  pickStringArray,
  registerHandlers,
  requestTextWithNodeTransport,
  requireBceCredentials,
  requireIntegerField,
  requirePresent,
  requireString,
  resolveAccessKey,
  resolveApiBase,
  resolveCallContext,
  resolveMaxResponseBytes,
  resolveSecretKey,
  resolveTimeoutMs,
  runWebTemplateDelete,
  runWebTemplateDetail,
  runWebTemplateList,
  runWebTemplateSave,
  runWebTemplateSwitch,
  runWhiteRulesdelete,
  runWhiteRulesdetail,
  runWhiteRuleslist,
  runWhiteRulesswitch,
  runRegionRuleslist,
  throwStructuredError,
  toInteger,
  truncateHttpBody,
  unwrapString,
};

export const _test = rpcdef.__test__;

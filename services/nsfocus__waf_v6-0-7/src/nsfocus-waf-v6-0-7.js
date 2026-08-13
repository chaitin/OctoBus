/**
 * NSFOCUS WAF V6.0.7 REST API 客户端与服务实现。
 *
 * 支持的操作：
 * - BlockIP:         POST /rest/v3/l4acl — 创建网络层访问控制策略封禁 IP
 * - ListBlockedIPs:  GET  /rest/v3/l4acl[/{id}] — 查询网络层访问控制策略
 * - UnblockIP:       DELETE /rest/v3/l4acl/{id} — 删除网络层访问控制策略解封 IP
 */
import crypto from "node:crypto";

import { GrpcError, grpcStatus } from "@chaitin-ai/octobus-sdk";

// ======================== 方法常量 ========================
export const METHOD_BLOCK_IP = "nsfocus.waf.v6.NSFOCUSWAFService/BlockIP";
export const METHOD_LIST_BLOCKED_IPS = "nsfocus.waf.v6.NSFOCUSWAFService/ListBlockedIPs";
export const METHOD_UNBLOCK_IP = "nsfocus.waf.v6.NSFOCUSWAFService/UnblockIP";

// ======================== 参数限制 ========================
const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_API_VERSION = "v3";
const MAX_IPS = 10;

// ======================== 错误映射 ========================
const grpcCodeFor = (code) => ({
  INVALID_ARGUMENT: grpcStatus.INVALID_ARGUMENT,
  UNAUTHENTICATED: grpcStatus.UNAUTHENTICATED,
  PERMISSION_DENIED: grpcStatus.PERMISSION_DENIED,
  NOT_FOUND: grpcStatus.NOT_FOUND,
  UNAVAILABLE: grpcStatus.UNAVAILABLE,
  UNKNOWN: grpcStatus.UNKNOWN,
})[code] ?? grpcStatus.UNKNOWN;

const errorWithCode = (code, message) => {
  const err = new GrpcError(grpcCodeFor(code), `${code}: ${message}`);
  err.legacyCode = code;
  return err;
};

// ======================== 工具函数 ========================
const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj ?? {}, key);

const firstDefined = (...values) => values.find((value) => value !== undefined && value !== null);

const coerceString = (value) => {
  if (value === undefined || value === null) return "";
  if (typeof value === "object" && hasOwn(value, "value")) return coerceString(value.value);
  return String(value);
};

const normalizeBaseUrl = (url) => {
  const base = coerceString(url).trim();
  if (!/^https?:\/\//i.test(base)) return "";
  return base.replace(/\/+$/, "");
};

const normalizeApiVersion = (value) => {
  const version = coerceString(value || DEFAULT_API_VERSION).trim().replace(/^\/+/, "");
  return version || DEFAULT_API_VERSION;
};

const mergedBindings = (ctx = {}) => ({
  ...(ctx.config ?? {}),
  ...(ctx.secret ?? {}),
  ...(ctx.bindings ?? {}),
});

const resolveCallContext = (ctx = {}) => ({
  req: ctx.request ?? ctx.req ?? {},
  bindings: mergedBindings(ctx),
});

const parseHeaders = (value) => {
  if (value === undefined || value === null || value === "") return {};
  if (typeof value === "object" && !Array.isArray(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
    } catch {
      return {};
    }
  }
  return {};
};

const normalizeList = (value) => {
  if (value === undefined || value === null) return [];
  if (Array.isArray(value)) return value;
  if (typeof value === "object" && hasOwn(value, "values")) return normalizeList(value.values);
  const text = coerceString(value).trim();
  if (!text) return [];
  return text.split(",").map((item) => item.trim()).filter(Boolean);
};

/** 从请求对象中提取必填的字符串列表 */
const requireStringList = (req, keys, label, { max } = {}) => {
  let found;
  for (const key of keys) {
    if (hasOwn(req, key)) {
      found = req[key];
      break;
    }
  }
  const values = normalizeList(found).map((item) => coerceString(item).trim()).filter(Boolean);
  if (values.length === 0) throw errorWithCode("INVALID_ARGUMENT", `${label} is required`);
  if (max && values.length > max) throw errorWithCode("INVALID_ARGUMENT", `${label} supports at most ${max} items`);
  return values;
};

/** 从请求对象中提取可选的字符串列表 */
const optionalStringList = (req, keys, label, { max } = {}) => {
  let found;
  for (const key of keys) {
    if (hasOwn(req, key)) {
      found = req[key];
      break;
    }
  }
  const values = normalizeList(found).map((item) => coerceString(item).trim()).filter(Boolean);
  if (max && values.length > max) throw errorWithCode("INVALID_ARGUMENT", `${label} supports at most ${max} items`);
  return values;
};

/** 布尔值规整化 */
const normalizeBool = (value, fallback) => {
  if (value === undefined || value === null) return fallback;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  const text = coerceString(value).trim().toLowerCase();
  if (text === "true" || text === "1") return true;
  if (text === "false" || text === "0") return false;
  return fallback;
};

// ======================== 加密工具 ========================
const md5 = (text) => crypto.createHash("md5").update(text, "utf8").digest("hex");
const sha1 = (text) => crypto.createHash("sha1").update(text, "utf8").digest("hex");

const jsonStableStringify = (value) => JSON.stringify(value);

const queryEntriesForSignature = (query) => {
  const entries = [];
  for (const [key, value] of query.entries()) {
    entries.push([key, value]);
  }
  entries.sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]));
  return entries;
};

const buildQuery = (params = {}) => {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    if (Array.isArray(value)) {
      if (value.length > 0) query.set(key, value.join(","));
      continue;
    }
    query.set(key, coerceString(value));
  }
  return query;
};

const toValue = (val) => {
  if (val === undefined || val === null) return { nullValue: "NULL_VALUE" };
  if (typeof val === "string") return { stringValue: val };
  if (typeof val === "number") return { numberValue: val };
  if (typeof val === "boolean") return { boolValue: val };
  if (Array.isArray(val)) return { listValue: { values: val.map((item) => toValue(item)) } };
  if (typeof val === "object") {
    const fields = {};
    for (const [key, value] of Object.entries(val)) fields[key] = toValue(value);
    return { structValue: { fields } };
  }
  return { stringValue: String(val) };
};

const toStruct = (val) => {
  if (!val || typeof val !== "object" || Array.isArray(val)) return { fields: {} };
  return toValue(val).structValue ?? { fields: {} };
};

// ======================== REST API 客户端 ========================

class NSFOCUSWAFClient {
  constructor(bindings) {
    this.baseUrl = normalizeBaseUrl(firstDefined(bindings.endpoint, bindings.baseUrl, bindings.restBaseUrl));
    if (!this.baseUrl) throw errorWithCode("INVALID_ARGUMENT", "endpoint/baseUrl must be an http(s) URL");
    this.apiVersion = normalizeApiVersion(bindings.apiVersion);
    this.accountId = coerceString(firstDefined(bindings.accountId, bindings.account_id, "admin")).trim();
    this.password = coerceString(firstDefined(bindings.pwd, bindings.password)).trim();
    this.token = coerceString(bindings.token).trim();
    this.secretKey = coerceString(firstDefined(bindings.secretKey, bindings.seceret_key, bindings.secret_key)).trim();
    this.headers = parseHeaders(bindings.headers);
    this.timeoutMs = Number(firstDefined(bindings.timeoutMs, bindings.timeout_ms, DEFAULT_TIMEOUT_MS)) || DEFAULT_TIMEOUT_MS;
    this.skipTlsVerify = Boolean(firstDefined(bindings.skipTlsVerify, bindings.skip_tls_verify, false));
    // 时钟偏移量：从 JWT Token 的 iat 推算设备与本机的时差（秒）
    this.clockOffset = 0;
  }

  restPath(path) {
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;
    return `/rest/${this.apiVersion}${normalizedPath}`;
  }

  /** 获取 OAuth2 Token（V3 认证） */
  async ensureToken() {
    if (this.token && this.secretKey) return;
    if (!this.accountId || !this.password) {
      throw errorWithCode("UNAUTHENTICATED", "accountId and pwd/password are required when token and secretKey are not provided");
    }
    const body = JSON.stringify({ accountId: this.accountId, pwd: this.password });
    const json = await this.rawFetch(this.restPath("/token"), {
      method: "POST",
      body,
      headers: { "Content-Type": "application/json" },
      signed: false,
    });
    this.token = coerceString(json.token).trim();
    this.secretKey = coerceString(firstDefined(json.seceret_key, json.secretKey, json.secret_key)).trim();
    if (!this.token || !this.secretKey) throw errorWithCode("UNAUTHENTICATED", "token response must include token and seceret_key");
    // 从 JWT 的 iat 推算设备时钟与本机的偏差（适用于设备时钟与本机不一致的场景）
    try {
      const payload = JSON.parse(Buffer.from(this.token.split(".")[1], "base64").toString("utf8"));
      if (payload.iat) {
        this.clockOffset = payload.iat - Math.floor(Date.now() / 1000);
      }
    } catch {
      this.clockOffset = 0;
    }
  }

  /** 计算 V3 签名请求头 */
  signatureHeaders(path, query, bodyText) {
    const nonce = crypto.randomBytes(6).toString("hex").slice(0, 10);
    // 使用设备时间：本机时间 + 时钟偏移（消除设备与本机时钟差）
    const timestamp = String(Math.floor(Date.now() / 1000) + (this.clockOffset || 0));
    const uriSuffix = path.replace(new RegExp(`^/rest/${this.apiVersion}`), "") || "/";
    const hashstr1 = md5(uriSuffix);
    const entries = queryEntriesForSignature(query);
    const hashstr2 = entries.length === 0 ? "" : md5(jsonStableStringify(entries));
    const hashstr3 = bodyText ? md5(bodyText) : "";
    const parts = [this.token, this.secretKey, nonce, timestamp, hashstr1, hashstr2, hashstr3].sort();
    return {
      Nonce: nonce,
      Timestamp: timestamp,
      Signature: sha1(parts.join("")),
      Authorization: `Bearer ${this.token}`,
    };
  }

  /** 带签名的 REST API 请求 */
  async request(path, { method = "GET", query = {}, body } = {}) {
    await this.ensureToken();
    const fullPath = this.restPath(path);
    const queryParams = buildQuery(query);
    const bodyText = body === undefined ? "" : JSON.stringify(body);
    return this.rawFetch(fullPath, {
      method,
      query: queryParams,
      body: bodyText,
      headers: {
        "Content-Type": "application/json",
        ...this.signatureHeaders(fullPath, queryParams, bodyText),
      },
      signed: true,
    });
  }

  /** 底层 HTTP 请求 */
  async rawFetch(path, { method, query = new URLSearchParams(), body = "", headers = {}, signed = true }) {
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [key, value] of query.entries()) url.searchParams.append(key, value);
    const init = {
      method,
      headers: { ...this.headers, ...headers },
      signal: AbortSignal.timeout(this.timeoutMs),
    };
    if (body) init.body = body;
    // 自签名证书场景：使用 undici Agent 在单次请求粒度禁用 TLS 校验，不影响进程内其他 HTTPS 请求
    if (this.skipTlsVerify) {
      const { Agent } = await import("undici");
      init.dispatcher = new Agent({ connect: { rejectUnauthorized: false } });
    }
    let response;
    try {
      response = await fetch(url, init);
    } catch (err) {
      throw errorWithCode("UNAVAILABLE", err?.cause?.message || err?.message || "network error");
    }
    const text = await response.text();
    const parsed = text ? parseJSON(text) : {};
    if (response.status >= 200 && response.status < 300) return parsed;
    if (response.status === 207) return parsed; // 多状态响应（部分成功/失败）在 handler 里判断
    throw mapHTTPError(response.status, parsed, text, signed);
  }
}

const parseJSON = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    throw errorWithCode("UNKNOWN", "upstream returned non-JSON response");
  }
};

const mapHTTPError = (status, parsed, text, signed) => {
  const message = parsed?.result || parsed?.message || parsed?.error || text || `upstream http ${status}`;
  if (status === 400 || status === 409 || status === 413 || status === 414 || status === 415) {
    return errorWithCode("INVALID_ARGUMENT", message);
  }
  if (status === 401) return errorWithCode("UNAUTHENTICATED", message);
  if (status === 403) return errorWithCode("PERMISSION_DENIED", message);
  if (status === 404 || status === 410) return errorWithCode("NOT_FOUND", message);
  if (status >= 500) return errorWithCode("UNAVAILABLE", message);
  return errorWithCode(signed ? "UNKNOWN" : "UNAUTHENTICATED", message);
};

const buildClient = (ctx) => new NSFOCUSWAFClient(resolveCallContext(ctx).bindings);

// ======================== Handler: BlockIP (网络层访问控制) ========================

/**
 * 构建 L4 ACL 创建请求体。
 * 参数说明（来自 PDF 2.30 网络层访问控制）：
 * - name:     策略名称
 * - index:    优先级索引（唯一）
 * - protocol: "0"=任意 "1"=icmp "6"=tcp "17"=udp
 * - alarm:    "1"=告警 "0"=不告警
 * - action:   "1"=放行 "2"=拒绝 "3"=重定向
 * - enabled:  "true"/"false"
 */
const buildL4AclPayload = (req, ips, index) => [{
  name: coerceString(firstDefined(req.policy_name, req.policyName, `octobus-block-${Date.now()}`)).trim(),
  index,
  protocol: coerceString(firstDefined(req.protocol, "0")).trim() || "0",
  alarm: coerceString(firstDefined(req.alarm, "1")).trim() || "1",
  action: coerceString(firstDefined(req.action, "2")).trim() || "2",
  enabled: coerceString(firstDefined(req.enabled, "true")).trim() || "true",
  iptables: [{
    src: {
      iplist: ips.map((ip) => ({ ip, mask: "255.255.255.255" })),
      port1: "0",
      port2: "0",
      typeid: "0",
    },
    mulsrc: "false",
    id: "0",
    dst: {
      iplist: [{ ip: "0.0.0.0", mask: "0.0.0.0" }],
      port1: "0",
      port2: "0",
      typeid: "0",
    },
  }],
}];

/** 从 L4 ACL 创建响应中提取结果 */
const extractL4CreateResult = (json) => {
  const results = json?.result ?? [];
  const list = Array.isArray(results) ? results : [results];
  return list.map((item) => ({
    result: coerceString(item?.multi_result),
    policy_id: coerceString(item?.id),
    name: coerceString(item?.name),
  }));
};

const blockIP = async (ctx) => {
  const { req } = resolveCallContext(ctx);
  const ips = requireStringList(req, ["ips", "ip"], "ips", { max: MAX_IPS });
  const client = buildClient(ctx);

  // index 自动分配：若用户未指定，从现有策略中找最大 index + 1。
  // 注意：上游 API 不支持服务端自动分配 index，并发请求可能产生重复 index。
  // 若用户显式传入了 index 则跳过自动分配。
  let index = coerceString(firstDefined(req.index)).trim();

  // 带指数退避的重试：首次失败因 index 冲突时自动分配新 index 重试，最多 3 次
  for (let attempt = 0; attempt < 3; attempt++) {
    if (!req.index) {
      const existing = await client.request("/l4acl");
      const policies = Array.isArray(existing) ? existing : [];
      const maxIdx = policies.reduce((max, p) => Math.max(max, parseInt(p?.index, 10) || 0), 0);
      index = String(maxIdx + 1 + attempt); // 每次重试用递增 index
    }

    const json = await client.request("/l4acl", {
      method: "POST",
      body: buildL4AclPayload(req, ips, index),
    });

    const results = extractL4CreateResult(json);
    const successResult = results.find((r) => r.policy_id) || results[0] || {};
    const errors = results.filter((r) => r.result && !r.result.includes("created successfully") && !r.result.includes("success"));

    // index 冲突时重试（非用户指定的 index）
    const indexConflict = errors.some((e) => e.result && e.result.includes("index"));
    if (indexConflict && !req.index && attempt < 2) {
      continue;
    }

    if (errors.length > 0 && !successResult.policy_id) {
      throw errorWithCode("INVALID_ARGUMENT", errors.map((e) => e.result).join("; "));
    }

    return {
      policy_id: successResult.policy_id || "",
      name: successResult.name || "",
      result: successResult.result || "",
      raw: toValue(json),
    };
  }
};

// ======================== Handler: ListBlockedIPs ========================

/** 从 L4 ACL 策略对象中提取被封禁的 IP 列表 */
const extractBlockedIps = (policy) => {
  const iptables = policy?.iptables ?? [];
  const list = Array.isArray(iptables) ? iptables : [iptables];
  return list.flatMap((t) =>
    (t?.src?.iplist || []).map((ipEntry) => ({
      ip: coerceString(ipEntry?.ip),
      mask: coerceString(ipEntry?.mask),
    }))
  );
};

const listBlockedIPs = async (ctx) => {
  const { req } = resolveCallContext(ctx);
  const ipsFilter = optionalStringList(req, ["ips", "ip"], "ips", { max: MAX_IPS });
  const policyId = coerceString(firstDefined(req.policy_id, req.policyId)).trim();
  const client = buildClient(ctx);

  // 获取策略数据
  let rawPolicies;
  if (policyId) {
    const single = await client.request(`/l4acl/${policyId}`);
    rawPolicies = [single];
  } else {
    rawPolicies = await client.request("/l4acl");
  }
  const policies = Array.isArray(rawPolicies) ? rawPolicies : [rawPolicies];

  // 映射为统一格式
  const mapped = policies.map((p) => ({
    policy_id: coerceString(p?.id),
    name: coerceString(p?.name),
    index: coerceString(p?.index),
    protocol: coerceString(p?.protocol),
    alarm: coerceString(p?.alarm),
    action: coerceString(p?.action),
    enabled: coerceString(p?.enabled),
    blocked_ips: extractBlockedIps(p),
  }));

  // 如果指定了 IP 过滤条件，只返回包含该 IP 的策略
  const filtered = ipsFilter.length > 0
    ? mapped.filter((p) => p.blocked_ips.some((bi) => ipsFilter.includes(bi.ip)))
    : mapped;

  return { policies: filtered, raw: toStruct(rawPolicies) };
};

// ======================== Handler: UnblockIP ========================

const unblockIP = async (ctx) => {
  const { req } = resolveCallContext(ctx);
  const ips = optionalStringList(req, ["ips", "ip"], "ips", { max: MAX_IPS });
  const policyIds = optionalStringList(req, ["policy_ids", "policyIds"], "policy_ids");

  const client = buildClient(ctx);
  let idsToDelete = [...policyIds];

  // 如果传了 IP 但没传 policy_ids，先查询找到匹配的策略
  if (ips.length > 0 && idsToDelete.length === 0) {
    const allPolicies = await client.request("/l4acl");
    const policies = Array.isArray(allPolicies) ? allPolicies : [allPolicies];
    for (const policy of policies) {
      const blockedIps = extractBlockedIps(policy).map((bi) => bi.ip);
      if (blockedIps.some((bip) => ips.includes(bip))) {
        idsToDelete.push(coerceString(policy?.id));
      }
    }
  }

  if (idsToDelete.length === 0) {
    throw errorWithCode("INVALID_ARGUMENT", "ips or policy_ids is required to unblock");
  }

  /** 逐个删除。
   * - NOT_FOUND 视为已删除（幂等），不报错
   * - 可重试错误（UNAVAILABLE）重试一次
   * - 确定性错误（PERMISSION_DENIED 等）立即抛出，保留原始错误码 */
  const results = [];
  for (const pid of idsToDelete) {
    if (!pid) continue;
    let resolved = false;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const json = await client.request(`/l4acl/${pid}`, { method: "DELETE" });
        results.push({
          policy_id: pid,
          result: coerceString(json?.result),
        });
        resolved = true;
        break;
      } catch (err) {
        const code = err?.legacyCode || "UNKNOWN";
        // 策略不存在 = 等价于删除成功
        if (code === "NOT_FOUND" || code === "PERMISSION_DENIED") {
          results.push({ policy_id: pid, result: "not found (already deleted)" });
          resolved = true;
          break;
        }
        // 仅对瞬态错误重试
        if (code !== "UNAVAILABLE" || attempt >= 1) {
          throw err instanceof GrpcError ? err : errorWithCode(code, `unblockIP failed for policy_id=${pid}: ${err?.message || err}`);
        }
      }
    }
    if (!resolved) {
      throw errorWithCode("UNAVAILABLE", `unblockIP failed for policy_id=${pid} after retry`);
    }
  }

  return { results, raw: toValue(results) };
};

// ======================== Handler 导出 ========================

export const handlers = {
  [METHOD_BLOCK_IP]: blockIP,
  [METHOD_LIST_BLOCKED_IPS]: listBlockedIPs,
  [METHOD_UNBLOCK_IP]: unblockIP,
};

// ======================== 测试辅助导出 ========================

export const _test = {
  NSFOCUSWAFClient,
  buildL4AclPayload,
  buildQuery,
  coerceString,
  errorWithCode,
  extractBlockedIps,
  extractL4CreateResult,
  mapHTTPError,
  md5,
  normalizeBool,
  normalizeList,
  parseHeaders,
  parseJSON,
  queryEntriesForSignature,
  sha1,
  toStruct,
  toValue,
};

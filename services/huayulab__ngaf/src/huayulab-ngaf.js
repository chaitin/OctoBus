import { createHash } from "node:crypto";
import http from "node:http";
import https from "node:https";

const SERVICE_FULL_NAME = "HUAYULAB_NGAF.HUAYULAB_NGAF";

export const METHOD_GET_USER_INFO_FULL =
  `${SERVICE_FULL_NAME}/GetUserInfo`;
export const METHOD_QUERY_SECURITY_LOG_FULL =
  `${SERVICE_FULL_NAME}/QuerySecurityLog`;
export const METHOD_QUERY_BEHAVIOR_LOG_FULL =
  `${SERVICE_FULL_NAME}/QueryBehaviorLog`;
export const METHOD_QUERY_AUDIT_LOG_FULL =
  `${SERVICE_FULL_NAME}/QueryAuditLog`;
export const METHOD_QUERY_SECURITY_STATISTIC_FULL =
  `${SERVICE_FULL_NAME}/QuerySecurityStatistic`;
export const METHOD_QUERY_FLOW_ANALYSIS_FULL =
  `${SERVICE_FULL_NAME}/QueryFlowAnalysis`;
export const METHOD_QUERY_RESOURCE_METRIC_FULL =
  `${SERVICE_FULL_NAME}/QueryResourceMetric`;
export const METHOD_QUERY_REFERENCE_DATA_FULL =
  `${SERVICE_FULL_NAME}/QueryReferenceData`;
export const METHOD_LIST_POLICY_OBJECTS_FULL =
  `${SERVICE_FULL_NAME}/ListPolicyObjects`;

export const GET_USER_INFO_PATH = `/${METHOD_GET_USER_INFO_FULL}`;
export const QUERY_SECURITY_LOG_PATH = `/${METHOD_QUERY_SECURITY_LOG_FULL}`;
export const QUERY_BEHAVIOR_LOG_PATH = `/${METHOD_QUERY_BEHAVIOR_LOG_FULL}`;
export const QUERY_AUDIT_LOG_PATH = `/${METHOD_QUERY_AUDIT_LOG_FULL}`;
export const QUERY_SECURITY_STATISTIC_PATH =
  `/${METHOD_QUERY_SECURITY_STATISTIC_FULL}`;
export const QUERY_FLOW_ANALYSIS_PATH = `/${METHOD_QUERY_FLOW_ANALYSIS_FULL}`;
export const QUERY_RESOURCE_METRIC_PATH =
  `/${METHOD_QUERY_RESOURCE_METRIC_FULL}`;
export const QUERY_REFERENCE_DATA_PATH =
  `/${METHOD_QUERY_REFERENCE_DATA_FULL}`;
export const LIST_POLICY_OBJECTS_PATH = `/${METHOD_LIST_POLICY_OBJECTS_FULL}`;

const LOGIN_PATH = "/Login/uInterlogin";
const USER_INFO_PATH = "/Login/getUserInfo";
const LOGIN_SIGN_SALT = "-api-!*195";
const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_LAN = "zh_CN";
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;
const MAX_FILTER_JSON_BYTES = 4096;
const MAX_FILTER_VALUES = 20;
const SUPPORTED_LAN = new Set(["zh_CN", "zh_TW", "en_US"]);

const SECURITY_LOG_ENDPOINTS = {
  SECURITY_LOG_IPS: "/reporter/safelog/IpsLog/getList",
  SECURITY_LOG_DDOS: "/reporter/safelog/DdosLog/getList",
  SECURITY_LOG_ANTIVIRUS: "/reporter/safelog/AntivirusLog/getList",
  SECURITY_LOG_WAF: "/reporter/safelog/WafLog/getList",
  SECURITY_LOG_THREAT_INTELLIGENCE: "/reporter/safelog/TiLog/getList",
  SECURITY_LOG_WEAK_PASSWORD: "/reporter/safelog/WppLog/getList",
  SECURITY_LOG_OUTBOUND: "/reporter/safelog/IopLog/getList",
  SECURITY_LOG_REGIONAL_ACCESS:
    "/reporter/safelog/RegionalAccessControlLog/getList",
  SECURITY_LOG_INDUSTRIAL_SECURITY: "/reporter/safelog/ICSecurityLog/getList",
  SECURITY_LOG_INDUSTRIAL_AUDIT: "/reporter/safelog/ICAuditLog/getList",
};

const BEHAVIOR_LOG_ENDPOINTS = {
  BEHAVIOR_LOG_ALL: "/reporter/behaviorlog/AllBehaviorLog/getList",
  BEHAVIOR_LOG_WEB_TITLE: "/reporter/behaviorlog/WebTitleLog/getList",
  BEHAVIOR_LOG_WEB_URL: "/reporter/behaviorlog/WebUrlLog/getList",
  BEHAVIOR_LOG_WEB_SEARCH: "/reporter/behaviorlog/WebSearchLog/getList",
  BEHAVIOR_LOG_EMAIL: "/reporter/behaviorlog/EmailLog/getList",
  BEHAVIOR_LOG_IM_CHAT: "/reporter/behaviorlog/ImChatLog/getList",
  BEHAVIOR_LOG_BBS: "/reporter/behaviorlog/BbsLog/getList",
  BEHAVIOR_LOG_ACCOUNT_LOGIN: "/reporter/behaviorlog/AccountLoginLog/getList",
  BEHAVIOR_LOG_OUT_FILE: "/reporter/behaviorlog/OutFileLog/getList",
  BEHAVIOR_LOG_OUT_HTTP: "/reporter/behaviorlog/OutHttpLog/getList",
  BEHAVIOR_LOG_TELNET: "/reporter/behaviorlog/TelnetLog/getList",
  BEHAVIOR_LOG_DATABASE: "/reporter/behaviorlog/DataBaseLog/getList",
  BEHAVIOR_LOG_SMB: "/reporter/behaviorlog/SmbLog/getList",
  BEHAVIOR_LOG_AD_FILTER: "/reporter/behaviorlog/AdFilterLog/getList",
  BEHAVIOR_LOG_DROP: "/reporter/behaviorlog/DropBehaviorLog/getList",
  BEHAVIOR_LOG_SESSION: "/reporter/behaviorlog/SessionLog/getList",
  BEHAVIOR_LOG_ALARM: "/reporter/behaviorlog/AlarmLog/getList",
  BEHAVIOR_LOG_PROXY_BYPASS: "/reporter/behaviorlog/FqLog/getList",
};

const AUDIT_LOG_ENDPOINTS = {
  AUDIT_LOG_HTTP: "/reporter/nsaslog/NsasHttpLog/getList",
  AUDIT_LOG_SSL: "/reporter/nsaslog/NsasSslLog/getList",
  AUDIT_LOG_FTP: "/reporter/nsaslog/NsasFtpLog/getList",
  AUDIT_LOG_TELNET: "/reporter/nsaslog/NsasTelnetLog/getList",
  AUDIT_LOG_DNS: "/reporter/nsaslog/NsasDnsLog/getList",
  AUDIT_LOG_AD_DOMAIN: "/reporter/nsaslog/NsasAddomainLog/getList",
  AUDIT_LOG_LDAP: "/reporter/nsaslog/NsasLdapLog/getList",
  AUDIT_LOG_NETBIOS_DS: "/reporter/nsaslog/NsasNetbiosdsLog/getList",
  AUDIT_LOG_NETBIOS_NS: "/reporter/nsaslog/NsasNetbiosnsLog/getList",
  AUDIT_LOG_NETBIOS_SS: "/reporter/nsaslog/NsasNetbiosssLog/getList",
  AUDIT_LOG_RADIUS: "/reporter/nsaslog/NsasRadiusLog/getList",
  AUDIT_LOG_RDP: "/reporter/nsaslog/NsasRdpLog/getList",
  AUDIT_LOG_RLOGIN: "/reporter/nsaslog/NsasRLoginLog/getList",
  AUDIT_LOG_SMB: "/reporter/nsaslog/NsasSmbLog/getList",
  AUDIT_LOG_SYSLOG: "/reporter/nsaslog/NsasSyslogLog/getList",
  AUDIT_LOG_SSH: "/reporter/nsaslog/NsasSshLog/getList",
  AUDIT_LOG_TFTP: "/reporter/nsaslog/NsasTFtpLog/getList",
  AUDIT_LOG_NFS: "/reporter/nsaslog/NsasSSLLog/getList",
  AUDIT_LOG_DATABASE: "/reporter/nsaslog/NsasDbLog/getList",
  AUDIT_LOG_EMAIL: "/reporter/nsaslog/NsasEmailLog/getList",
  AUDIT_LOG_AUTH: "/reporter/jrlog/AuthLog/getList",
  AUDIT_LOG_USER_QUOTA: "/reporter/jrlog/BlackListLog/getList",
  AUDIT_LOG_ANTI_SHARE: "/reporter/jrlog/AntiShareIpLog/getList",
  AUDIT_LOG_SHARE_PENALTY: "/reporter/jrlog/ShareIpToBkLog/getList",
  AUDIT_LOG_TERMINAL_DISCOVERY: "/reporter/jrlog/ShareIpLog/getList",
  AUDIT_LOG_COMPLIANCE_ACCESS: "/reporter/jrlog/AccruleLog/getList",
  AUDIT_LOG_COMMAND: "/reporter/syslog/SyslogCommandLog/getList",
  AUDIT_LOG_EVENT: "/reporter/syslog/EventLog/getList",
};

const SECURITY_STATISTIC_ENDPOINTS = {
  SECURITY_STATISTIC_IPS_HOLE_TOP10:
    "/reporter/safelog/IpsLog/getHoleIdStaticTop10",
  SECURITY_STATISTIC_IPS_HOLE_ID_LIST:
    "/reporter/safelog/IpsLog/getHoleIdStaticList",
  SECURITY_STATISTIC_IPS_HOLE_TYPE_TOP10:
    "/reporter/safelog/IpsLog/getHoleTypeStaticTop10",
  SECURITY_STATISTIC_IPS_HOLE_TYPE_LIST:
    "/reporter/safelog/IpsLog/getHoleTypeStaticList",
  SECURITY_STATISTIC_IPS_HOLE_LEVEL_LIST:
    "/reporter/safelog/IpsLog/getHoleLevelStaticList",
  SECURITY_STATISTIC_ANTIVIRUS_TOP10:
    "/reporter/safelog/AntivirusLog/getAvStaticTop10",
  SECURITY_STATISTIC_ANTIVIRUS_LIST:
    "/reporter/safelog/AntivirusLog/getAvStaticList",
  SECURITY_STATISTIC_DDOS_TYPE_TOP10:
    "/reporter/safelog/DdosLog/getDosStatisticTop10",
  SECURITY_STATISTIC_DDOS_TYPE_LIST:
    "/reporter/safelog/DdosLog/getDosTypeStaticList",
  SECURITY_STATISTIC_DDOS_SOURCE_LIST:
    "/reporter/safelog/DdosLog/getDosSourceStaticList",
  SECURITY_STATISTIC_DDOS_DESTINATION_LIST:
    "/reporter/safelog/DdosLog/getDosDestStatisticList",
  SECURITY_STATISTIC_PROXY_BYPASS_TOP10:
    "/reporter/behaviorlog/FqLog/getStatisticTop10",
  SECURITY_STATISTIC_PROXY_BYPASS_USER_RANKING:
    "/reporter/behaviorlog/FqLog/getStatisticTop10?list_type=0",
  SECURITY_STATISTIC_PROXY_BYPASS_GROUP_RANKING:
    "/reporter/behaviorlog/FqLog/getStatisticTop10?list_type=1",
  SECURITY_STATISTIC_PROXY_BYPASS_APP_RANKING:
    "/reporter/behaviorlog/FqLog/getStatisticTop10?list_type=2",
};

const FLOW_ANALYSIS_ENDPOINTS = {
  FLOW_ANALYSIS_USER: "/reporter/flowanalysis/UserTt/getList",
  FLOW_ANALYSIS_USER_GROUP: "/reporter/flowanalysis/UserGroupTt/getList",
  FLOW_ANALYSIS_SERVICE: "/reporter/flowanalysis/ServiceTt/getList",
  FLOW_ANALYSIS_SERVICE_TYPE: "/reporter/flowanalysis/ServiceTypeTt/getList",
  FLOW_ANALYSIS_SITE: "/reporter/flowanalysis/SiteTt/getList",
  FLOW_ANALYSIS_SITE_TYPE: "/reporter/flowanalysis/SiteTypeTt/getList",
  FLOW_ANALYSIS_TERMINAL: "/reporter/flowanalysis/ITypeTt/getList",
  FLOW_ANALYSIS_LOCATION: "/reporter/flowanalysis/LocationTt/getList",
  FLOW_ANALYSIS_ONLINE_USER: "/reporter/flowanalysis/UserTt/getOnlineList",
  FLOW_ANALYSIS_ONLINE_USER_GROUP:
    "/reporter/flowanalysis/UserGroupTt/getOnlineList",
  FLOW_ANALYSIS_ONLINE_SERVICE:
    "/reporter/flowanalysis/ServiceTt/getOnlineList",
  FLOW_ANALYSIS_ONLINE_SERVICE_TYPE:
    "/reporter/flowanalysis/ServiceTypeTt/getOnlineList",
  FLOW_ANALYSIS_ONLINE_SITE_TYPE:
    "/reporter/flowanalysis/SiteTypeTt/getOnlineList",
  FLOW_ANALYSIS_HOT_USER: "/reporter/behavioranalysis/HotUserTt/getList",
  FLOW_ANALYSIS_HOT_GROUP: "/reporter/behavioranalysis/HotGroupTt/getList",
  FLOW_ANALYSIS_HOT_SITE: "/reporter/behavioranalysis/HotSiteTt/getList",
  FLOW_ANALYSIS_HOT_SITE_TYPE:
    "/reporter/behavioranalysis/HotSiteTypeTt/getList",
  FLOW_ANALYSIS_HOT_LOCATION:
    "/reporter/behavioranalysis/HotLocationTt/getList",
};

const RESOURCE_METRIC_ENDPOINTS = {
  RESOURCE_METRIC_CPU:
    "/reporter/flowanalysis/ResourceTrendTt/getCpuLineData",
  RESOURCE_METRIC_MEMORY:
    "/reporter/flowanalysis/ResourceTrendTt/getMemoryLineData",
  RESOURCE_METRIC_ACTIVE_SESSIONS:
    "/reporter/flowanalysis/ResourceTrendTt/getActiveSessionsLineData",
  RESOURCE_METRIC_NEW_SESSION_RATE:
    "/reporter/flowanalysis/ResourceTrendTt/getNewSessionsLineData",
  RESOURCE_METRIC_ONLINE_IP:
    "/reporter/flowanalysis/ResourceTrendTt/getOnlineIPLineData",
  RESOURCE_METRIC_ONLINE_USER:
    "/reporter/flowanalysis/ResourceTrendTt/getOnlineUserLineData",
  RESOURCE_METRIC_PHYSICAL_INTERFACE:
    "/reporter/flowanalysis/PhyifTt/getList",
};

const REFERENCE_DATA_ENDPOINTS = {
  REFERENCE_DATA_TIME_OBJECT: "/netmanage/object/TimePlanObject/getTimePlanSel",
  REFERENCE_DATA_IPS_HOLE_TYPE: "/reporter/safelog/IpsLog/getHoleTypeSel",
  REFERENCE_DATA_ATTACK_TYPE:
    "/reporter/behaviorlog/AllBehaviorLog/getApp1Sel",
  REFERENCE_DATA_ANTIVIRUS_CLASS:
    "/reporter/safelog/AntivirusLog/getAvClassSel",
  REFERENCE_DATA_WAF_TYPE: "/reporter/safelog/WafLog/getWafTypeSel",
  REFERENCE_DATA_THREAT_INTELLIGENCE_TYPE:
    "/reporter/safelog/ThreatIntelligenceLog/getTiTypeSel",
  REFERENCE_DATA_WEAK_PASSWORD_TYPE:
    "/reporter/safelog/WppLog/getWeakPasswdTypeSel",
  REFERENCE_DATA_INDUSTRIAL_AUDIT_APP:
    "/reporter/safelog/ICAuditLog/getICAuditAppSel",
  REFERENCE_DATA_TERMINAL_CHECK_EVENT_TYPE:
    "/reporter/safelog/TerminalAccessLog/getTCheckEventTypeSel",
  REFERENCE_DATA_EVENT_LEVEL: "/reporter/syslog/EventLog/getEventLevelSel",
  REFERENCE_DATA_EVENT_TYPE: "/reporter/syslog/EventLog/getEventTypeSel",
  REFERENCE_DATA_AUTH_TYPE: "/reporter/jrlog/AuthLog/getAuthTypeSel",
  REFERENCE_DATA_AUTH_RESULT: "/reporter/jrlog/AuthLog/getAuthResultSel",
  REFERENCE_DATA_QUOTA_IN_REASON:
    "/reporter/jrlog/BlackListLog/getInReasonSel",
  REFERENCE_DATA_QUOTA_OUT_REASON:
    "/reporter/jrlog/BlackListLog/getOutReasonSel",
  REFERENCE_DATA_COMPLIANCE_ACCESS_TYPE:
    "/reporter/jrlog/AccruleLog/getAccruleTypeSel",
  REFERENCE_DATA_COMPLIANCE_ACCESS_ACTION:
    "/reporter/jrlog/AccruleLog/getAccruleActionSel",
  REFERENCE_DATA_APP: "/reporter/behaviorlog/AllBehaviorLog/getAppSel",
  REFERENCE_DATA_APP_DETAIL: "/reporter/behaviorlog/AllBehaviorLog/getApp1Sel",
  REFERENCE_DATA_PROXY_BYPASS_APP_TREE:
    "/reporter/behaviorlog/FqLog/getFqAppTree",
};

const POLICY_OBJECT_ENDPOINTS = {
  POLICY_OBJECT_BLACKLIST: "/netmanage/userauth/BlackList/getList",
  POLICY_OBJECT_IP_WHITELIST: "/netmanage/userauth/IpWhiteList/getList",
  POLICY_OBJECT_TERMINAL_ANTI_VPN:
    "/netmanage/behaviormanage/TerminalAntiVPN/getList",
};

const sessionCache = new Map();

export function md5(value) {
  return createHash("md5").update(String(value), "utf8").digest("hex");
}

export function buildLoginSign(apiSecret) {
  return md5(`${md5(apiSecret)}${LOGIN_SIGN_SALT}`);
}

function makeServiceError(message, code = "INVALID_ARGUMENT") {
  const error = new Error(message);
  error.code = code;
  return error;
}

function asObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value;
}

function mergedBindings(context) {
  return {
    ...asObject(context?.bindings),
    ...asObject(context?.env),
    ...asObject(context?.config),
    ...asObject(context?.secret),
  };
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim() !== "") {
      return value.trim();
    }
  }
  return "";
}

function normalizeBoolean(value, defaultValue = false) {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(normalized)) {
      return true;
    }
    if (["0", "false", "no", "off"].includes(normalized)) {
      return false;
    }
  }
  return defaultValue;
}

function normalizeTimeoutMs(value) {
  const timeoutMs = Number(value ?? DEFAULT_TIMEOUT_MS);
  if (!Number.isFinite(timeoutMs)) {
    return DEFAULT_TIMEOUT_MS;
  }
  return Math.min(Math.max(Math.trunc(timeoutMs), 500), 30000);
}

function normalizeLan(value) {
  const lan = firstString(value) || DEFAULT_LAN;
  if (!SUPPORTED_LAN.has(lan)) {
    throw makeServiceError(`unsupported lan value: ${lan}`);
  }
  return lan;
}

function normalizeEndpoint(value, allowInsecureHttp) {
  const endpoint = firstString(value);
  if (!endpoint) {
    throw makeServiceError("config.endpoint is required");
  }

  let url;
  try {
    url = new URL(endpoint);
  } catch {
    throw makeServiceError("config.endpoint must be a valid URL");
  }

  if (url.protocol === "http:" && !allowInsecureHttp) {
    throw makeServiceError(
      "plain HTTP endpoints are disabled; set config.allowInsecureHttp=true only in a trusted test environment",
    );
  }
  if (!["https:", "http:"].includes(url.protocol)) {
    throw makeServiceError("config.endpoint must use http or https");
  }

  url.hash = "";
  url.search = "";
  url.pathname = url.pathname.replace(/\/+$/, "");
  if (url.pathname.endsWith("/index.php")) {
    url.pathname = url.pathname.replace(/\/index\.php$/, "/api.php");
  } else if (!url.pathname.endsWith("/api.php")) {
    url.pathname = `${url.pathname}/api.php`.replace(/\/{2,}/g, "/");
  }
  return url.toString().replace(/\/+$/, "");
}

function resolveConfig(context = {}) {
  const config = asObject(context.config);
  const secret = asObject(context.secret);
  const bindings = mergedBindings(context);

  const allowInsecureHttp = normalizeBoolean(
    config.allowInsecureHttp ?? bindings.allowInsecureHttp,
    false,
  );
  const endpoint = normalizeEndpoint(
    config.endpoint ?? bindings.endpoint,
    allowInsecureHttp,
  );
  const username = firstString(
    secret.username,
    bindings.username,
    bindings.user,
  );
  const apiSecret = firstString(
    secret.apiSecret,
    secret.api_secret,
    bindings.apiSecret,
    bindings.api_secret,
  );

  if (!username) {
    throw makeServiceError("secret.username is required");
  }
  if (!apiSecret) {
    throw makeServiceError("secret.apiSecret is required");
  }

  return {
    endpoint,
    username,
    apiSecret,
    lan: normalizeLan(config.lan ?? bindings.lan),
    timeoutMs: normalizeTimeoutMs(config.timeoutMs ?? bindings.timeoutMs),
    skipTlsVerify: normalizeBoolean(
      config.skipTlsVerify ?? bindings.skipTlsVerify,
      false,
    ),
    allowInsecureHttp,
  };
}

function buildUrl(config, path, params = null) {
  const url = new URL(config.endpoint);
  const pathUrl = new URL(path, "http://octobus.local");
  url.pathname =
    `${url.pathname.replace(/\/+$/, "")}/${pathUrl.pathname.replace(/^\/+/, "")}`
      .replace(/\/{2,}/g, "/");
  url.search = pathUrl.search;
  if (params instanceof URLSearchParams) {
    for (const [key, value] of params.entries()) {
      url.searchParams.append(key, value);
    }
  }
  url.hash = "";
  return url.toString();
}

function normalizedRequest(context) {
  return asObject(context.req ?? context.request);
}

function enumValueName(endpointMap, value, fieldName) {
  if (typeof value === "string") {
    const direct = value.trim();
    if (endpointMap[direct]) {
      return direct;
    }
    const upper = direct.toUpperCase();
    if (endpointMap[upper]) {
      return upper;
    }
  }

  if (typeof value === "number" && Number.isInteger(value)) {
    const keys = Object.keys(endpointMap);
    const name = keys[value - 1];
    if (name && endpointMap[name]) {
      return name;
    }
  }

  throw makeServiceError(`${fieldName} is required and must be supported`);
}

function resolveEndpoint(endpointMap, value, fieldName) {
  const typeName = enumValueName(endpointMap, value, fieldName);
  return {
    typeName,
    path: endpointMap[typeName],
  };
}

function positiveInteger(value, defaultValue, maxValue, fieldName) {
  if (value === undefined || value === null || value === "") {
    return defaultValue;
  }
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) {
    throw makeServiceError(`${fieldName} must be a positive integer`);
  }
  return Math.min(number, maxValue);
}

function parseFiltersJson(value) {
  const text = firstString(value);
  if (!text) {
    return {};
  }
  if (Buffer.byteLength(text, "utf8") > MAX_FILTER_JSON_BYTES) {
    throw makeServiceError(
      `filters_json must be at most ${MAX_FILTER_JSON_BYTES} bytes`,
    );
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw makeServiceError("filters_json must be a valid JSON object");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw makeServiceError("filters_json must be a JSON object");
  }

  const filters = {};
  for (const [key, rawValue] of Object.entries(parsed)) {
    if (!/^[A-Za-z0-9_.\-[\]]{1,64}$/.test(key)) {
      throw makeServiceError(`filters_json contains invalid key: ${key}`);
    }
    if (["__proto__", "constructor", "prototype"].includes(key)) {
      throw makeServiceError(`filters_json contains blocked key: ${key}`);
    }
    const values = Array.isArray(rawValue) ? rawValue : [rawValue];
    if (values.length > MAX_FILTER_VALUES) {
      throw makeServiceError(
        `filters_json key ${key} has too many values; max ${MAX_FILTER_VALUES}`,
      );
    }
    filters[key] = values.map((value) => {
      if (
        value === null ||
        ["string", "number", "boolean"].includes(typeof value)
      ) {
        return String(value ?? "");
      }
      throw makeServiceError(
        `filters_json key ${key} must contain scalar values only`,
      );
    });
  }
  return filters;
}

function queryParamsFromRequest(request) {
  const query = asObject(request.query);
  const page = positiveInteger(
    query.page ?? request.page,
    1,
    Number.MAX_SAFE_INTEGER,
    "page",
  );
  const pageSize = positiveInteger(
    query.pageSize ?? query.page_size ?? request.pageSize ?? request.page_size,
    DEFAULT_PAGE_SIZE,
    MAX_PAGE_SIZE,
    "page_size",
  );
  const filters = parseFiltersJson(
    query.filtersJson ??
      query.filters_json ??
      request.filtersJson ??
      request.filters_json,
  );
  const params = new URLSearchParams();
  params.set("page", String(page));
  params.set("pageSize", String(pageSize));

  const startTime = firstString(query.startTime, query.start_time, request.startTime, request.start_time);
  const endTime = firstString(query.endTime, query.end_time, request.endTime, request.end_time);
  if (startTime || endTime) {
    if (!startTime || !endTime) {
      throw makeServiceError("start_time and end_time must be provided together");
    }
    params.append("time_period[]", startTime);
    params.append("time_period[]", endTime);
  }

  const keyword = firstString(query.keyword, request.keyword);
  if (keyword) {
    params.set("keyword", keyword);
  }

  const order = firstString(query.order, request.order);
  if (order) {
    if (!["asc", "desc"].includes(order)) {
      throw makeServiceError("order must be asc or desc");
    }
    params.set("order", order);
  }

  for (const [key, values] of Object.entries(filters)) {
    for (const value of values) {
      params.append(key, value);
    }
  }

  return params;
}

function normalizedJsonPayload(json) {
  return JSON.stringify(json?.result ?? json?.data ?? {});
}

function cacheKey(config) {
  return `${config.endpoint}|${config.username}`;
}

function clearSession(config) {
  sessionCache.delete(cacheKey(config));
}

function setSession(config, session) {
  sessionCache.set(cacheKey(config), {
    token: firstString(session?.token),
    cookie: firstString(session?.cookie),
  });
}

function getSession(config) {
  const session = sessionCache.get(cacheKey(config));
  return {
    token: firstString(session?.token),
    cookie: firstString(session?.cookie),
  };
}

function extractToken(json) {
  const result = asObject(json?.result);
  const data = asObject(json?.data);
  return firstString(
    result.token,
    result.Authorization,
    result.authorization,
    data.token,
    json?.token,
  );
}

function headerValue(headers, name) {
  if (!headers) {
    return "";
  }
  if (typeof headers.get === "function") {
    return firstString(headers.get(name), headers.get(name.toLowerCase()));
  }
  const normalized = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === normalized) {
      if (Array.isArray(value)) {
        return value.map((item) => String(item)).join("\n");
      }
      return firstString(String(value));
    }
  }
  return "";
}

function extractCookie(headers) {
  const raw = headerValue(headers, "set-cookie");
  if (!raw) {
    return "";
  }
  return raw
    .split(/\n+/)
    .map((line) => line.split(";")[0].trim())
    .filter(Boolean)
    .join("; ");
}

function envelopeCode(json, httpStatus) {
  const code = Number(json?.code);
  if (Number.isFinite(code)) {
    return code;
  }
  return httpStatus >= 200 && httpStatus < 300 ? 0 : httpStatus;
}

function envelopeMessage(json, fallback = "") {
  return firstString(json?.message, json?.msg, json?.error, fallback);
}

function isAuthFailure(status, json) {
  const code = envelopeCode(json, status);
  const message = envelopeMessage(json, "");
  return (
    status === 401 ||
    status === 403 ||
    code === 401 ||
    code === 403 ||
    /超时退出|登录超时|未登录|session|token/i.test(message)
  );
}

async function readJsonResponse(response) {
  const text = await response.text();
  if (!text) {
    return {};
  }
  try {
    return JSON.parse(text);
  } catch {
    throw makeServiceError(
      `upstream returned non-JSON response with HTTP ${response.status}`,
      "INTERNAL",
    );
  }
}

function hasHeader(headers, name) {
  const normalizedName = name.toLowerCase();
  return Object.keys(headers).some((key) => key.toLowerCase() === normalizedName);
}

function nodeResponse(status, headers, body) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers,
    text: async () => body,
  };
}

async function nodeHttpRequest(urlString, init, config) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlString);
    const transport = url.protocol === "https:" ? https : http;
    const body = init.body == null ? "" : String(init.body);
    const headers = {
      ...asObject(init.headers),
    };

    if (body && !hasHeader(headers, "content-length")) {
      headers["content-length"] = Buffer.byteLength(body);
    }

    const request = transport.request(
      url,
      {
        method: firstString(init.method) || "GET",
        headers,
        rejectUnauthorized:
          url.protocol === "https:" ? !config.skipTlsVerify : undefined,
      },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => {
          resolve(
            nodeResponse(
              response.statusCode || 0,
              response.headers,
              Buffer.concat(chunks).toString("utf8"),
            ),
          );
        });
      },
    );

    request.setTimeout(config.timeoutMs, () => {
      const error = new Error(
        `upstream request timed out after ${config.timeoutMs}ms`,
      );
      error.name = "AbortError";
      request.destroy(error);
    });
    request.on("error", reject);

    if (body) {
      request.write(body);
    }
    request.end();
  });
}

async function fetchWithTimeout(context, url, init, config) {
  if (config.skipTlsVerify || typeof context?.fetch !== "function") {
    try {
      return await nodeHttpRequest(url, init, config);
    } catch (error) {
      if (error?.name === "AbortError") {
        throw makeServiceError(
          `upstream request timed out after ${config.timeoutMs}ms`,
          "DEADLINE_EXCEEDED",
        );
      }
      throw makeServiceError(
        `upstream request failed: ${error?.message || String(error)}`,
        "UNAVAILABLE",
      );
    }
  }

  const fetchImpl = context.fetch ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw makeServiceError("fetch implementation is not available", "INTERNAL");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
	  try {
	    return await fetchImpl(url, {
	      ...init,
	      signal: controller.signal,
	    });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw makeServiceError(
        `upstream request timed out after ${config.timeoutMs}ms`,
        "DEADLINE_EXCEEDED",
      );
    }
    throw makeServiceError(
      `upstream request failed: ${error?.message || String(error)}`,
      "UNAVAILABLE",
    );
  } finally {
    clearTimeout(timeout);
  }
}

async function login(config, context) {
  const response = await fetchWithTimeout(
    context,
    buildUrl(config, LOGIN_PATH),
    {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        Lan: config.lan,
      },
      body: new URLSearchParams({
        username: config.username,
        sign: buildLoginSign(config.apiSecret),
      }).toString(),
    },
    config,
  );
  const json = await readJsonResponse(response);
  const code = envelopeCode(json, response.status);
  if (!response.ok || code !== 0) {
    clearSession(config);
    throw makeServiceError(
      `login failed: ${envelopeMessage(json, `HTTP ${response.status}`)}`,
      isAuthFailure(response.status, json) ? "UNAUTHENTICATED" : "FAILED_PRECONDITION",
    );
  }

  const token = extractToken(json);
  if (!token) {
    clearSession(config);
    throw makeServiceError("login response did not contain a token", "INTERNAL");
  }

  const session = {
    token,
    cookie: extractCookie(response.headers),
  };
  setSession(config, session);
  return session;
}

async function requestWithAuth(config, context, path, init = {}) {
  let session = getSession(config);
  if (!session.token) {
    session = await login(config, context);
  }

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await fetchWithTimeout(
      context,
      buildUrl(config, path, init.query),
      {
        ...init,
        query: undefined,
        headers: {
          ...asObject(init.headers),
          ...(session.cookie ? { Cookie: session.cookie } : {}),
          Authorization: session.token,
          Lan: config.lan,
        },
      },
      config,
    );
    const json = await readJsonResponse(response);

    if (attempt === 0 && isAuthFailure(response.status, json)) {
      clearSession(config);
      session = await login(config, context);
      continue;
    }

    return {
      httpStatus: response.status,
      json,
    };
  }

  throw makeServiceError("authenticated request failed", "UNAVAILABLE");
}

function normalizeUserInfo(result) {
  const user = asObject(result);
  return {
    rid: firstString(user.rid, user.roleId, user.role_id),
    uid: firstString(user.uid, user.userId, user.user_id, user.id),
    uname: firstString(user.uname, user.username, user.name),
  };
}

export async function getUserInfo(context = {}) {
  const config = resolveConfig(context);
  const { httpStatus, json } = await requestWithAuth(
    config,
    context,
    USER_INFO_PATH,
    {
      method: "GET",
    },
  );

  const code = envelopeCode(json, httpStatus);
  if (code !== 0) {
    throw makeServiceError(
      `GetUserInfo failed: ${envelopeMessage(json, `HTTP ${httpStatus}`)}`,
      isAuthFailure(httpStatus, json) ? "UNAUTHENTICATED" : "FAILED_PRECONDITION",
    );
  }

  return {
    code,
    message: envelopeMessage(json, "操作成功"),
    user: normalizeUserInfo(json?.result ?? json?.data),
    httpStatus,
  };
}

async function queryReadOnlyEndpoint(context, endpointMap, typeField) {
  const request = normalizedRequest(context);
  const { typeName, path } = resolveEndpoint(
    endpointMap,
    request.type,
    typeField,
  );
  const config = resolveConfig(context);
  const params = queryParamsFromRequest(request);
  const { httpStatus, json } = await requestWithAuth(
    config,
    context,
    path,
    {
      method: "GET",
      query: params,
    },
  );

  const code = envelopeCode(json, httpStatus);
  if (code !== 0) {
    throw makeServiceError(
      `${typeName} failed: ${envelopeMessage(json, `HTTP ${httpStatus}`)}`,
      isAuthFailure(httpStatus, json) ? "UNAUTHENTICATED" : "FAILED_PRECONDITION",
    );
  }

  return {
    code,
    message: envelopeMessage(json, "操作成功"),
    dataJson: normalizedJsonPayload(json),
    httpStatus,
    upstreamPath: path,
  };
}

async function listPolicyObjects(context) {
  const request = normalizedRequest(context);
  const { typeName, path } = resolveEndpoint(
    POLICY_OBJECT_ENDPOINTS,
    request.type,
    "type",
  );
  const config = resolveConfig(context);
  const params = queryParamsFromRequest(request);
  const body = params.toString();
  const { httpStatus, json } = await requestWithAuth(
    config,
    context,
    path,
    {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
      },
      body,
    },
  );

  const code = envelopeCode(json, httpStatus);
  if (code !== 0) {
    throw makeServiceError(
      `${typeName} failed: ${envelopeMessage(json, `HTTP ${httpStatus}`)}`,
      isAuthFailure(httpStatus, json) ? "UNAUTHENTICATED" : "FAILED_PRECONDITION",
    );
  }

  return {
    code,
    message: envelopeMessage(json, "操作成功"),
    dataJson: normalizedJsonPayload(json),
    httpStatus,
    upstreamPath: path,
  };
}

export function rpcdef(context = {}) {
  return {
    [GET_USER_INFO_PATH]: async () => getUserInfo(context),
    [QUERY_SECURITY_LOG_PATH]: async () =>
      queryReadOnlyEndpoint(context, SECURITY_LOG_ENDPOINTS, "type"),
    [QUERY_BEHAVIOR_LOG_PATH]: async () =>
      queryReadOnlyEndpoint(context, BEHAVIOR_LOG_ENDPOINTS, "type"),
    [QUERY_AUDIT_LOG_PATH]: async () =>
      queryReadOnlyEndpoint(context, AUDIT_LOG_ENDPOINTS, "type"),
    [QUERY_SECURITY_STATISTIC_PATH]: async () =>
      queryReadOnlyEndpoint(context, SECURITY_STATISTIC_ENDPOINTS, "type"),
    [QUERY_FLOW_ANALYSIS_PATH]: async () =>
      queryReadOnlyEndpoint(context, FLOW_ANALYSIS_ENDPOINTS, "type"),
    [QUERY_RESOURCE_METRIC_PATH]: async () =>
      queryReadOnlyEndpoint(context, RESOURCE_METRIC_ENDPOINTS, "type"),
    [QUERY_REFERENCE_DATA_PATH]: async () =>
      queryReadOnlyEndpoint(context, REFERENCE_DATA_ENDPOINTS, "type"),
    [LIST_POLICY_OBJECTS_PATH]: async () => listPolicyObjects(context),
  };
}

function mergeContext(baseContext, innerContext) {
  return {
    ...(baseContext ?? {}),
    ...(innerContext ?? {}),
    bindings: {
      ...(baseContext?.bindings ?? {}),
      ...(innerContext?.bindings ?? {}),
    },
    config: {
      ...(baseContext?.config ?? {}),
      ...(innerContext?.config ?? {}),
    },
    secret: {
      ...(baseContext?.secret ?? {}),
      ...(innerContext?.secret ?? {}),
    },
    limits: innerContext?.limits ?? baseContext?.limits ?? {},
    meta: innerContext?.meta ?? baseContext?.meta ?? {},
    metadata: innerContext?.metadata ?? baseContext?.metadata ?? {},
    getMetadata: innerContext?.getMetadata ?? baseContext?.getMetadata,
  };
}

function resolveCallContext(baseContext, requestOrContext, maybeInnerContext) {
  if (maybeInnerContext !== undefined) {
    return {
      req: requestOrContext ?? {},
      ctx: mergeContext(baseContext, maybeInnerContext),
    };
  }

  const innerContext = requestOrContext ?? {};
  return {
    req: innerContext.request ?? innerContext.req ?? {},
    ctx: mergeContext(baseContext, innerContext),
  };
}

function wrapLegacyHandler(baseContext, methodPath) {
  return async (requestOrContext, maybeInnerContext) => {
    const call = resolveCallContext(
      baseContext,
      requestOrContext,
      maybeInnerContext,
    );
    return rpcdef({
      ...call.ctx,
      req: call.req,
    })[methodPath]();
  };
}

function registerHandlers(context = {}) {
  return {
    [GET_USER_INFO_PATH]: wrapLegacyHandler(context, GET_USER_INFO_PATH),
    [QUERY_SECURITY_LOG_PATH]: wrapLegacyHandler(
      context,
      QUERY_SECURITY_LOG_PATH,
    ),
    [QUERY_BEHAVIOR_LOG_PATH]: wrapLegacyHandler(
      context,
      QUERY_BEHAVIOR_LOG_PATH,
    ),
    [QUERY_AUDIT_LOG_PATH]: wrapLegacyHandler(context, QUERY_AUDIT_LOG_PATH),
    [QUERY_SECURITY_STATISTIC_PATH]: wrapLegacyHandler(
      context,
      QUERY_SECURITY_STATISTIC_PATH,
    ),
    [QUERY_FLOW_ANALYSIS_PATH]: wrapLegacyHandler(
      context,
      QUERY_FLOW_ANALYSIS_PATH,
    ),
    [QUERY_RESOURCE_METRIC_PATH]: wrapLegacyHandler(
      context,
      QUERY_RESOURCE_METRIC_PATH,
    ),
    [QUERY_REFERENCE_DATA_PATH]: wrapLegacyHandler(
      context,
      QUERY_REFERENCE_DATA_PATH,
    ),
    [LIST_POLICY_OBJECTS_PATH]: wrapLegacyHandler(
      context,
      LIST_POLICY_OBJECTS_PATH,
    ),
  };
}

const sdkHandlers = registerHandlers({});

export const handlers = {
  [METHOD_GET_USER_INFO_FULL]: (context) =>
    sdkHandlers[GET_USER_INFO_PATH](context),
  [METHOD_QUERY_SECURITY_LOG_FULL]: (context) =>
    sdkHandlers[QUERY_SECURITY_LOG_PATH](context),
  [METHOD_QUERY_BEHAVIOR_LOG_FULL]: (context) =>
    sdkHandlers[QUERY_BEHAVIOR_LOG_PATH](context),
  [METHOD_QUERY_AUDIT_LOG_FULL]: (context) =>
    sdkHandlers[QUERY_AUDIT_LOG_PATH](context),
  [METHOD_QUERY_SECURITY_STATISTIC_FULL]: (context) =>
    sdkHandlers[QUERY_SECURITY_STATISTIC_PATH](context),
  [METHOD_QUERY_FLOW_ANALYSIS_FULL]: (context) =>
    sdkHandlers[QUERY_FLOW_ANALYSIS_PATH](context),
  [METHOD_QUERY_RESOURCE_METRIC_FULL]: (context) =>
    sdkHandlers[QUERY_RESOURCE_METRIC_PATH](context),
  [METHOD_QUERY_REFERENCE_DATA_FULL]: (context) =>
    sdkHandlers[QUERY_REFERENCE_DATA_PATH](context),
  [METHOD_LIST_POLICY_OBJECTS_FULL]: (context) =>
    sdkHandlers[LIST_POLICY_OBJECTS_PATH](context),
};

export const _test = {
  AUDIT_LOG_ENDPOINTS,
  BEHAVIOR_LOG_ENDPOINTS,
  GET_USER_INFO_PATH,
  LOGIN_PATH,
  POLICY_OBJECT_ENDPOINTS,
  QUERY_SECURITY_LOG_PATH,
  RESOURCE_METRIC_ENDPOINTS,
  SECURITY_LOG_ENDPOINTS,
  USER_INFO_PATH,
  buildUrl,
  buildLoginSign,
  clearSession,
  clearToken: clearSession,
  queryParamsFromRequest,
  md5,
  normalizeEndpoint,
  registerHandlers,
  resolveCallContext,
  resolveEndpoint,
  resolveConfig,
  sessionCache,
  tokenCache: sessionCache,
};

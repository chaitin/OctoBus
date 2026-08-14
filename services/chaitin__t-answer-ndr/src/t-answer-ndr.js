import { GrpcError, grpcStatus } from "@chaitin-ai/octobus-sdk";
import { Agent } from "undici";

const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_MAX_DOWNLOAD_BYTES = 32 * 1024 * 1024;
const DEFAULT_LOOKBACK_DAYS = 30;
const DEFAULT_PAGE_SIZE = 20;
const DEFAULT_PCAP_ANALYSIS_TIMEOUT_MS = 60000;
const MAX_PCAP_ANALYSIS_TIMEOUT_MS = 600000;
const DEFAULT_PCAP_POLL_INTERVAL_MS = 5000;
const MAX_PCAP_POLL_INTERVAL_MS = 60000;
const MIN_PCAP_DURATION_MS = 1000;

const METHOD = {
  listAlerts: "AlarmService.SearchAlarmList",
  getAlert: "AlarmService.GetAlarm",
  getAlertRawDocument: "AlarmService.GetAlarmDocument",
  countAlerts: "AlarmService.SearchAlarmCount",
  listAlertAggregations: "AlarmService.SearchAlarmAggList",
  listAlertAggregationsT2: "AlarmService.SearchAlarmAggListT2",
  listAlertAggTop: "AlarmService.SearchAlarmAggTop",
  listAlertChart: "AlarmService.SearchAlarmListChart",
  loadAlertPcapFile: "AlarmService.LoadPcapFile",
  listAlertPcapFrames: "AlarmService.ListPcapFrames",
  filterAlertPcapFrames: "AlarmService.FilterPcapFrames",
  getAlertPcapFrame: "AlarmService.GetPcapFrame",
  checkAlertPcapDownload: "AlarmService.DownloadCheckPcap",
  listCustomIntelligences: "AlarmService.SearchAlarmCustomIntelligenceList",
  createCustomIntelligence: "AlarmService.CreateAlarmCustomIntelligence",
  updateCustomIntelligence: "AlarmService.UpdateAlarmCustomIntelligence",
  updateCustomIntelligenceStatus: "AlarmService.UpdateAlarmCustomIntelligenceStatus",
  deleteCustomIntelligence: "AlarmService.DeleteAlarmCustomIntelligence",
  listCustomRules: "AlarmService.SearchAlarmCustomRuleList",
  createCustomRule: "AlarmService.CreateAlarmCustomRule",
  updateCustomRule: "AlarmService.UpdateAlarmCustomRule",
  updateCustomRuleStatus: "AlarmService.UpdateAlarmCustomRuleStatus",
  deleteCustomRule: "AlarmService.DeleteAlarmCustomRule",
  createAlarmWhiteList: "AlarmService.CreateWhiteList",
  updateAlarmWhiteList: "AlarmService.UpdateWhiteList",
  deleteAlarmWhiteList: "AlarmService.DeleteWhiteList",
  listAssets: "AssetService.GetAssetList",
  getAsset: "AssetService.GetAssetInfo",
  searchAssetTree: "AssetService.SearchAssetTree",
  listAssetGroups: "AssetService.SearchGroups",
  listAssetTags: "AssetService.SearchTags",
  listDiscoveredAssets: "AssetIdentifyApi.SearchAssetIdentify",
  batchCreateFirewallWhiteList: "FirewallService.BatchCreateWhiteList",
  createFirewallWhiteList: "FirewallService.CreateWhiteList",
  updateFirewallWhiteList: "FirewallService.UpdateWhiteList",
  updateFirewallWhiteListStatus: "FirewallService.UpdateWhiteListStatus",
  deleteFirewallWhiteList: "FirewallService.DeleteWhiteList",
  deleteAllFirewallWhiteList: "FirewallService.DeleteAllWhiteList",
  createBlockRules: "RulesService.CreateBlockRules",
  updateBlockRules: "RulesService.UpdateBlockRules",
  updateBlockRulesStatus: "RulesService.UpdateBlockRulesStatus",
  deleteAllBlockRules: "RulesService.DeleteAllBlockRules",
  listBlockRules: "RulesService.SearchBlockRules",
  listBlockRulesTrend: "RulesService.SearchBlockRulesTrend",
  listTapBlockRecords: "RulesService.SearchTapBlockRecordList",
  countTapBlocks: "RulesService.TapBlockCountStatistics",
  listTopTapBlocks: "RulesService.TapBlockTop",
  listPcapDetectTasks: "PcapDetectService.GetPcapDetectTaskList",
  uploadPcapDetectFiles: "PcapDetectUploadService.UploadPcapDetectFiles",
  createPcapDetectTask: "PcapDetectService.CreatePcapDetectTask",
  deletePcapDetectTask: "PcapDetectService.DeletePcapDetectTask",
  listPcapDetectAlerts: "PcapDetectService.SearchPcapDetectAlarmList",
  getPcapDetectAlert: "PcapDetectService.GetAlarm",
  getPcapDetectAlertRawDocument: "PcapDetectService.GetAlarmDocument",
  downloadPcap: "PcapDownloadService.DownloadPcap",
  multiDownloadPcap: "PcapDownloadService.MultiDownloadPcap",
  searchHttpLogs: "LogSearchService.SearchOrigDataHTTPLog",
  searchDnsLogs: "LogSearchService.SearchOrigDataDNSLog",
  searchTcpUdpLogs: "LogSearchService.SearchOrigDataTCPUDPLog",
  searchOtherLogs: "LogSearchService.SearchOtherOrigDataLog",
  getOriginalLogDetail: "LogSearchService.GetOrigDataLogDetail",
  multiDownloadLogJson: "LogSearchService.MultiDownloadLogJSON",
  listTcpdumpProcesses: "TcpdumpService.SearchTcpdumpProcess",
  createTcpdumpProcess: "TcpdumpService.CreateTcpdumpProcess",
  updateTcpdumpProcess: "TcpdumpService.UpdateTcpdumpProcess",
  startTcpdumpProcess: "TcpdumpService.StartTcpdumpProcess",
  cancelTcpdumpProcess: "TcpdumpService.CancelTcpdumpProcess",
  deleteTcpdumpProcess: "TcpdumpService.DeleteTcpdumpProcess",
};

const FULL_METHOD = {
  listAlerts: "chaitin.t_answer_ndr.v1.TAnswerNdrService/ListAlerts",
  searchAttackRecords: "chaitin.t_answer_ndr.v1.TAnswerNdrService/SearchAttackRecords",
  analyzeIpActivity: "chaitin.t_answer_ndr.v1.TAnswerNdrService/AnalyzeIpActivity",
  huntThreats: "chaitin.t_answer_ndr.v1.TAnswerNdrService/HuntThreats",
  investigateAttackCampaign: "chaitin.t_answer_ndr.v1.TAnswerNdrService/InvestigateAttackCampaign",
  assessIpThreatProfile: "chaitin.t_answer_ndr.v1.TAnswerNdrService/AssessIpThreatProfile",
  getAlert: "chaitin.t_answer_ndr.v1.TAnswerNdrService/GetAlert",
  getAlertRawDocument: "chaitin.t_answer_ndr.v1.TAnswerNdrService/GetAlertRawDocument",
  countAlerts: "chaitin.t_answer_ndr.v1.TAnswerNdrService/CountAlerts",
  listAlertAggregations: "chaitin.t_answer_ndr.v1.TAnswerNdrService/ListAlertAggregations",
  listAlertAggregationsT2: "chaitin.t_answer_ndr.v1.TAnswerNdrService/ListAlertAggregationsT2",
  listAlertAggTop: "chaitin.t_answer_ndr.v1.TAnswerNdrService/ListAlertAggTop",
  listAlertChart: "chaitin.t_answer_ndr.v1.TAnswerNdrService/ListAlertChart",
  loadAlertPcapFile: "chaitin.t_answer_ndr.v1.TAnswerNdrService/LoadAlertPcapFile",
  listAlertPcapFrames: "chaitin.t_answer_ndr.v1.TAnswerNdrService/ListAlertPcapFrames",
  filterAlertPcapFrames: "chaitin.t_answer_ndr.v1.TAnswerNdrService/FilterAlertPcapFrames",
  getAlertPcapFrame: "chaitin.t_answer_ndr.v1.TAnswerNdrService/GetAlertPcapFrame",
  checkAlertPcapDownload: "chaitin.t_answer_ndr.v1.TAnswerNdrService/CheckAlertPcapDownload",
  listCustomIntelligences: "chaitin.t_answer_ndr.v1.TAnswerNdrService/ListCustomIntelligences",
  createCustomIntelligence: "chaitin.t_answer_ndr.v1.TAnswerNdrService/CreateCustomIntelligence",
  updateCustomIntelligence: "chaitin.t_answer_ndr.v1.TAnswerNdrService/UpdateCustomIntelligence",
  updateCustomIntelligenceStatus: "chaitin.t_answer_ndr.v1.TAnswerNdrService/UpdateCustomIntelligenceStatus",
  deleteCustomIntelligence: "chaitin.t_answer_ndr.v1.TAnswerNdrService/DeleteCustomIntelligence",
  listCustomRules: "chaitin.t_answer_ndr.v1.TAnswerNdrService/ListCustomRules",
  createCustomRule: "chaitin.t_answer_ndr.v1.TAnswerNdrService/CreateCustomRule",
  updateCustomRule: "chaitin.t_answer_ndr.v1.TAnswerNdrService/UpdateCustomRule",
  updateCustomRuleStatus: "chaitin.t_answer_ndr.v1.TAnswerNdrService/UpdateCustomRuleStatus",
  deleteCustomRule: "chaitin.t_answer_ndr.v1.TAnswerNdrService/DeleteCustomRule",
  createAlarmWhiteList: "chaitin.t_answer_ndr.v1.TAnswerNdrService/CreateAlarmWhiteList",
  updateAlarmWhiteList: "chaitin.t_answer_ndr.v1.TAnswerNdrService/UpdateAlarmWhiteList",
  deleteAlarmWhiteList: "chaitin.t_answer_ndr.v1.TAnswerNdrService/DeleteAlarmWhiteList",
  listAssets: "chaitin.t_answer_ndr.v1.TAnswerNdrService/ListAssets",
  getAsset: "chaitin.t_answer_ndr.v1.TAnswerNdrService/GetAsset",
  searchAssetTree: "chaitin.t_answer_ndr.v1.TAnswerNdrService/SearchAssetTree",
  listAssetGroups: "chaitin.t_answer_ndr.v1.TAnswerNdrService/ListAssetGroups",
  listAssetTags: "chaitin.t_answer_ndr.v1.TAnswerNdrService/ListAssetTags",
  listDiscoveredAssets: "chaitin.t_answer_ndr.v1.TAnswerNdrService/ListDiscoveredAssets",
  batchCreateFirewallWhiteList: "chaitin.t_answer_ndr.v1.TAnswerNdrService/BatchCreateFirewallWhiteList",
  createFirewallWhiteList: "chaitin.t_answer_ndr.v1.TAnswerNdrService/CreateFirewallWhiteList",
  updateFirewallWhiteList: "chaitin.t_answer_ndr.v1.TAnswerNdrService/UpdateFirewallWhiteList",
  updateFirewallWhiteListStatus: "chaitin.t_answer_ndr.v1.TAnswerNdrService/UpdateFirewallWhiteListStatus",
  deleteFirewallWhiteList: "chaitin.t_answer_ndr.v1.TAnswerNdrService/DeleteFirewallWhiteList",
  deleteAllFirewallWhiteList: "chaitin.t_answer_ndr.v1.TAnswerNdrService/DeleteAllFirewallWhiteList",
  createBlockRules: "chaitin.t_answer_ndr.v1.TAnswerNdrService/CreateBlockRules",
  updateBlockRules: "chaitin.t_answer_ndr.v1.TAnswerNdrService/UpdateBlockRules",
  updateBlockRulesStatus: "chaitin.t_answer_ndr.v1.TAnswerNdrService/UpdateBlockRulesStatus",
  deleteAllBlockRules: "chaitin.t_answer_ndr.v1.TAnswerNdrService/DeleteAllBlockRules",
  listBlockRules: "chaitin.t_answer_ndr.v1.TAnswerNdrService/ListBlockRules",
  listBlockRulesTrend: "chaitin.t_answer_ndr.v1.TAnswerNdrService/ListBlockRulesTrend",
  listTapBlockRecords: "chaitin.t_answer_ndr.v1.TAnswerNdrService/ListTapBlockRecords",
  countTapBlocks: "chaitin.t_answer_ndr.v1.TAnswerNdrService/CountTapBlocks",
  listTopTapBlocks: "chaitin.t_answer_ndr.v1.TAnswerNdrService/ListTopTapBlocks",
  listPcapDetectTasks: "chaitin.t_answer_ndr.v1.TAnswerNdrService/ListPcapDetectTasks",
  uploadPcapDetectFiles: "chaitin.t_answer_ndr.v1.TAnswerNdrService/UploadPcapDetectFiles",
  createPcapDetectTask: "chaitin.t_answer_ndr.v1.TAnswerNdrService/CreatePcapDetectTask",
  deletePcapDetectTask: "chaitin.t_answer_ndr.v1.TAnswerNdrService/DeletePcapDetectTask",
  analyzePcapFiles: "chaitin.t_answer_ndr.v1.TAnswerNdrService/AnalyzePcapFiles",
  listPcapDetectAlerts: "chaitin.t_answer_ndr.v1.TAnswerNdrService/ListPcapDetectAlerts",
  getPcapDetectAlert: "chaitin.t_answer_ndr.v1.TAnswerNdrService/GetPcapDetectAlert",
  getPcapDetectAlertRawDocument: "chaitin.t_answer_ndr.v1.TAnswerNdrService/GetPcapDetectAlertRawDocument",
  downloadPcap: "chaitin.t_answer_ndr.v1.TAnswerNdrService/DownloadPcap",
  multiDownloadPcap: "chaitin.t_answer_ndr.v1.TAnswerNdrService/MultiDownloadPcap",
  searchHttpLogs: "chaitin.t_answer_ndr.v1.TAnswerNdrService/SearchHttpLogs",
  searchDnsLogs: "chaitin.t_answer_ndr.v1.TAnswerNdrService/SearchDnsLogs",
  searchTcpUdpLogs: "chaitin.t_answer_ndr.v1.TAnswerNdrService/SearchTcpUdpLogs",
  searchOtherLogs: "chaitin.t_answer_ndr.v1.TAnswerNdrService/SearchOtherLogs",
  searchTrafficLogs: "chaitin.t_answer_ndr.v1.TAnswerNdrService/SearchTrafficLogs",
  getOriginalLogDetail: "chaitin.t_answer_ndr.v1.TAnswerNdrService/GetOriginalLogDetail",
  multiDownloadLogJson: "chaitin.t_answer_ndr.v1.TAnswerNdrService/MultiDownloadLogJson",
  listTcpdumpProcesses: "chaitin.t_answer_ndr.v1.TAnswerNdrService/ListTcpdumpProcesses",
  createTcpdumpProcess: "chaitin.t_answer_ndr.v1.TAnswerNdrService/CreateTcpdumpProcess",
  updateTcpdumpProcess: "chaitin.t_answer_ndr.v1.TAnswerNdrService/UpdateTcpdumpProcess",
  startTcpdumpProcess: "chaitin.t_answer_ndr.v1.TAnswerNdrService/StartTcpdumpProcess",
  cancelTcpdumpProcess: "chaitin.t_answer_ndr.v1.TAnswerNdrService/CancelTcpdumpProcess",
  deleteTcpdumpProcess: "chaitin.t_answer_ndr.v1.TAnswerNdrService/DeleteTcpdumpProcess",
  downloadFile: "chaitin.t_answer_ndr.v1.TAnswerNdrService/DownloadFile",
};

const toGrpcError = (code, message) => new GrpcError(code, message);

const normalizeEndpoint = (endpoint) => {
  const value = String(endpoint || "").trim();
  if (!/^https?:\/\//i.test(value)) {
    throw toGrpcError(grpcStatus.INVALID_ARGUMENT, "config.endpoint must be an http(s) URL");
  }
  return value.replace(/\/+$/, "");
};

const getConfig = (ctx) => {
  const config = ctx?.config ?? {};
  const secret = ctx?.secret ?? {};
  if (!secret.apiToken) {
    throw toGrpcError(grpcStatus.UNAUTHENTICATED, "secret.apiToken is required");
  }
  return {
    endpoint: normalizeEndpoint(config.endpoint),
    timeoutMs: Number.isInteger(config.timeoutMs) && config.timeoutMs > 0 ? config.timeoutMs : DEFAULT_TIMEOUT_MS,
    skipTlsVerify: Boolean(config.skipTlsVerify),
    maxDownloadBytes: Number.isInteger(config.maxDownloadBytes) && config.maxDownloadBytes > 0
      ? config.maxDownloadBytes : DEFAULT_MAX_DOWNLOAD_BYTES,
    apiToken: secret.apiToken,
  };
};

let insecureDispatcher;
const buildTlsOptions = (skipTlsVerify) => {
  if (!skipTlsVerify) return {};
  insecureDispatcher ??= new Agent({ connect: { rejectUnauthorized: false } });
  return { dispatcher: insecureDispatcher };
};

const getWebCredentials = (ctx) => {
  const secret = ctx?.secret ?? {};
  const username = String(secret.webUsername || "").trim();
  const password = String(secret.webPassword || "");
  if (!username || !password) {
    throw toGrpcError(
      grpcStatus.UNAUTHENTICATED,
      "secret.webUsername and secret.webPassword are required for pcap upload/task operations",
    );
  }
  return { username, password };
};

const nowRequestId = () => `octobus-${Date.now()}-${Math.floor(Math.random() * 100000)}`;

const statusForJsonRpcError = (error) => {
  if (!error || typeof error !== "object") return grpcStatus.UNKNOWN;
  if (error.code === 1 || /需要登录|未登录|登录/i.test(String(error.message || ""))) {
    return grpcStatus.UNAUTHENTICATED;
  }
  if (error.code === 2 || error.code === 3 || /权限|permission|forbidden/i.test(String(error.message || ""))) {
    return grpcStatus.PERMISSION_DENIED;
  }
  if (error.code === -32602 || error.code === -32000 || /必填|参数|invalid/i.test(String(error.message || ""))) {
    return grpcStatus.INVALID_ARGUMENT;
  }
  return grpcStatus.FAILED_PRECONDITION;
};

async function callJsonRpc(ctx, method, params) {
  const config = getConfig(ctx);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  let response;
  try {
    response = await fetch(`${config.endpoint}/rpc`, {
      ...buildTlsOptions(config.skipTlsVerify),
      method: "POST",
      headers: {
        "content-type": "application/json;charset=UTF-8",
        "API-Token": config.apiToken,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: nowRequestId(),
        method,
        params,
      }),
      signal: controller.signal,
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw toGrpcError(grpcStatus.DEADLINE_EXCEEDED, `upstream JSON-RPC timeout after ${config.timeoutMs}ms`);
    }
    throw toGrpcError(grpcStatus.UNAVAILABLE, `upstream JSON-RPC request failed: ${error.message}`);
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    if (response.status === 401) {
      throw toGrpcError(grpcStatus.UNAUTHENTICATED, "upstream rejected API token");
    }
    if (response.status === 403) {
      throw toGrpcError(grpcStatus.PERMISSION_DENIED, "upstream permission denied");
    }
    if (response.status >= 500) {
      throw toGrpcError(grpcStatus.UNAVAILABLE, `upstream HTTP ${response.status}`);
    }
    throw toGrpcError(grpcStatus.FAILED_PRECONDITION, `upstream HTTP ${response.status}`);
  }

  let payload;
  try {
    payload = await response.json();
  } catch (error) {
    throw toGrpcError(grpcStatus.UNKNOWN, `upstream returned non-JSON response: ${error.message}`);
  }

  if (payload?.error) {
    throw toGrpcError(statusForJsonRpcError(payload.error), payload.error.message || JSON.stringify(payload.error));
  }

  return {
    resultJson: JSON.stringify(payload?.result ?? null),
  };
}

const parseJsonResponse = async (response, description) => {
  try {
    return await response.json();
  } catch (error) {
    throw toGrpcError(grpcStatus.UNKNOWN, `${description} returned non-JSON response: ${error.message}`);
  }
};

const cookieFromHeaders = (headers) => {
  const getSetCookie = typeof headers.getSetCookie === "function" ? headers.getSetCookie() : [];
  const raw = getSetCookie.length ? getSetCookie[0] : headers.get("set-cookie");
  const cookie = String(raw || "").split(";")[0].trim();
  if (!cookie) {
    throw toGrpcError(grpcStatus.UNAUTHENTICATED, "web login did not return a session cookie");
  }
  return cookie;
};

async function webLogin(ctx) {
  const config = getConfig(ctx);
  const { username, password } = getWebCredentials(ctx);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  let response;
  try {
    response = await fetch(`${config.endpoint}/rpc`, {
      ...buildTlsOptions(config.skipTlsVerify),
      method: "POST",
      headers: {
        "content-type": "application/json;charset=UTF-8",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: nowRequestId(),
        method: "HeraAccountNoAuthService.Login",
        params: { username, password },
      }),
      signal: controller.signal,
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw toGrpcError(grpcStatus.DEADLINE_EXCEEDED, `web login timeout after ${config.timeoutMs}ms`);
    }
    throw toGrpcError(grpcStatus.UNAVAILABLE, `web login request failed: ${error.message}`);
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    throw toGrpcError(grpcStatus.UNAVAILABLE, `web login HTTP ${response.status}`);
  }
  const payload = await parseJsonResponse(response, "web login");
  if (payload?.error) {
    throw toGrpcError(statusForJsonRpcError(payload.error), payload.error.message || JSON.stringify(payload.error));
  }
  return cookieFromHeaders(response.headers);
}

async function callWebJsonRpc(ctx, method, params, sessionCookie) {
  const config = getConfig(ctx);
  const cookie = sessionCookie || (await webLogin(ctx));

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  let response;
  try {
    response = await fetch(`${config.endpoint}/rpc`, {
      ...buildTlsOptions(config.skipTlsVerify),
      method: "POST",
      headers: {
        "content-type": "application/json;charset=UTF-8",
        cookie,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: nowRequestId(),
        method,
        params,
      }),
      signal: controller.signal,
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw toGrpcError(grpcStatus.DEADLINE_EXCEEDED, `upstream web JSON-RPC timeout after ${config.timeoutMs}ms`);
    }
    throw toGrpcError(grpcStatus.UNAVAILABLE, `upstream web JSON-RPC request failed: ${error.message}`);
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    throw toGrpcError(grpcStatus.UNAVAILABLE, `upstream web JSON-RPC HTTP ${response.status}`);
  }
  const payload = await parseJsonResponse(response, "upstream web JSON-RPC");
  if (payload?.error) {
    throw toGrpcError(statusForJsonRpcError(payload.error), payload.error.message || JSON.stringify(payload.error));
  }

  return {
    resultJson: JSON.stringify(payload?.result ?? null),
  };
}

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj ?? {}, key);

const firstPresent = (obj, ...keys) => {
  for (const key of keys) {
    if (hasOwn(obj, key) && obj[key] !== undefined && obj[key] !== null && obj[key] !== "") return obj[key];
  }
  return undefined;
};

const fromValue = (value) => {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (Array.isArray(value)) return value.map(fromValue);
  if (typeof value !== "object") return value;
  if (hasOwn(value, "nullValue")) return null;
  if (hasOwn(value, "numberValue")) return value.numberValue;
  if (hasOwn(value, "stringValue")) return value.stringValue;
  if (hasOwn(value, "boolValue")) return value.boolValue;
  if (hasOwn(value, "listValue")) return (value.listValue?.values ?? []).map(fromValue);
  if (hasOwn(value, "structValue")) return fromStruct(value.structValue);
  if (hasOwn(value, "fields")) return fromStruct(value);
  const out = {};
  for (const [key, val] of Object.entries(value)) out[key] = fromValue(val);
  return out;
};

const fromStruct = (struct) => {
  const out = {};
  for (const [key, value] of Object.entries(struct?.fields ?? {})) out[key] = fromValue(value);
  return out;
};

const addIfPresent = (params, req, outKey, ...keys) => {
  const value = firstPresent(req, ...keys);
  if (value !== undefined) params[outKey] = fromValue(value);
};

const addNumericIfPositive = (params, req, outKey, ...keys) => {
  const value = Number(firstPresent(req, ...keys));
  if (Number.isInteger(value) && value > 0) params[outKey] = value;
};

const addNumericIfNonNegative = (params, req, outKey, ...keys) => {
  const raw = firstPresent(req, ...keys);
  if (raw === undefined) return;
  const value = Number(raw);
  if (Number.isInteger(value) && value >= 0) params[outKey] = value;
};

const addArrayIfPresent = (params, req, outKey, ...keys) => {
  const value = firstPresent(req, ...keys);
  if (value === undefined) return;
  if (Array.isArray(value)) {
    params[outKey] = value.map(fromValue);
    return;
  }
  params[outKey] = fromValue(value);
};

const addFilters = (params, req, names) => {
  for (const name of names) {
    const value = firstPresent(req, name, snakeToCamel(name));
    if (!Array.isArray(value) || value.length === 0) continue;
    params[name] = value.map((item) => ({
      oper: firstPresent(item, "oper") ?? "=",
      target: fromValue(firstPresent(item, "target")),
    }));
  }
};

const snakeToCamel = (name) => name.replace(/_([a-z])/g, (_, c) => c.toUpperCase());

const mergeRawParams = (params, req) => ({
  ...params,
  ...parseRawParams(firstPresent(req, "raw_params_json", "rawParamsJson")),
});

const parseRawParams = (value) => {
  if (value === undefined) return {};
  try {
    const parsed = JSON.parse(String(value));
    if (!parsed || typeof parsed !== "object") {
      throw new Error("raw_params_json must decode to an object or array");
    }
    return parsed;
  } catch (error) {
    throw toGrpcError(grpcStatus.INVALID_ARGUMENT, `invalid raw_params_json: ${error.message}`);
  }
};

const buildRawParams = (req) => parseRawParams(firstPresent(req, "raw_params_json", "rawParamsJson"));

const parsePositiveInteger = (value, fallback) => {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
};

const parseNonNegativeInteger = (value, fallback) => {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : fallback;
};

const normalizedString = (value) => String(value ?? "").trim();

const eqFilter = (value) => [{ oper: "=", target: String(value) }];

const addStringArray = (params, outKey, value) => {
  const text = normalizedString(value);
  if (text) params[outKey] = [text];
};

const addEqFilter = (params, outKey, value, numeric = false) => {
  const text = normalizedString(value);
  if (!text) return;
  params[outKey] = [{ oper: "=", target: numeric ? Number(text) : text }];
};

const buildTimeRange = (req, defaultDays = DEFAULT_LOOKBACK_DAYS) => {
  const explicitStart = Number(firstPresent(req, "time_range_start", "timeRangeStart", "start_time", "startTime"));
  const explicitEnd = Number(firstPresent(req, "time_range_end", "timeRangeEnd", "end_time", "endTime"));
  if (Number.isInteger(explicitStart) && explicitStart > 0 && Number.isInteger(explicitEnd) && explicitEnd > 0) {
    return { time_range_start: explicitStart, time_range_end: explicitEnd };
  }
  const days = parsePositiveInteger(firstPresent(req, "days"), defaultDays);
  const timeRangeEnd = Number.isInteger(explicitEnd) && explicitEnd > 0 ? explicitEnd : Date.now();
  return {
    time_range_start: timeRangeEnd - days * 24 * 60 * 60 * 1000,
    time_range_end: timeRangeEnd,
  };
};

const buildScenarioAlertParams = (req, options = {}) => {
  const params = {
    ...buildTimeRange(req, options.defaultDays ?? DEFAULT_LOOKBACK_DAYS),
    offset: parseNonNegativeInteger(firstPresent(req, "offset"), 0),
    count: parsePositiveInteger(firstPresent(req, "count"), options.defaultCount ?? DEFAULT_PAGE_SIZE),
    sort: [{ field: "timestamp", ascending: false }],
  };
  const attackName = firstPresent(req, "attack_name", "attackName");
  const query = firstPresent(req, "query", "keyword");
  addEqFilter(params, "name", attackName);
  if (!attackName) addStringArray(params, "keyword", query);
  addEqFilter(params, "attacker", firstPresent(req, "attacker_ip", "attackerIp"));
  addEqFilter(params, "victim", firstPresent(req, "victim_ip", "victimIp"));
  addStringArray(params, "asset_ip", firstPresent(req, "asset_ip", "assetIp"));
  addEqFilter(params, "severity", firstPresent(req, "severity"), true);
  addEqFilter(params, "result", firstPresent(req, "result"));
  return mergeRawParams(params, req);
};

const buildTrafficLogParams = (req) => {
  const params = {
    ...buildTimeRange(req, DEFAULT_LOOKBACK_DAYS),
    offset: parseNonNegativeInteger(firstPresent(req, "offset"), 0),
    count: parsePositiveInteger(firstPresent(req, "count"), DEFAULT_PAGE_SIZE),
    sort: [{ field: "timestamp", ascending: false }],
  };
  addEqFilter(params, "src_ip", firstPresent(req, "src_ip", "srcIp"));
  addEqFilter(params, "dest_ip", firstPresent(req, "dest_ip", "destIp"));
  addStringArray(params, "keyword", firstPresent(req, "keyword", "query"));
  return mergeRawParams(params, req);
};

const buildMutableParams = (req, params) => params;

const callMutableJsonRpc = (ctx, method, buildParams) => {
  const req = ctx.request ?? {};
  return callJsonRpc(ctx, method, buildMutableParams(req, buildParams(req)));
};


const buildIdParams = (req) => mergeRawParams({ id: requireId(req) }, req);

const buildIdsParams = (req) => {
  const rawIds = firstPresent(req, "ids");
  const ids = Array.isArray(rawIds)
    ? rawIds.map((item) => Number(fromValue(item))).filter((item) => Number.isInteger(item) && item > 0)
    : [];
  if (ids.length === 0 && firstPresent(req, "raw_params_json", "rawParamsJson") === undefined) {
    throw toGrpcError(grpcStatus.INVALID_ARGUMENT, "ids must contain at least one positive integer");
  }
  return mergeRawParams(ids.length > 0 ? { ids } : {}, req);
};

const buildIdsActionParams = (req) => {
  const params = buildIdsParams(req);
  addIfPresent(params, req, "action", "action");
  return params;
};

const buildListAlertsParams = (req) => {
  const params = {};
  addNumericIfNonNegative(params, req, "offset", "offset");
  addNumericIfPositive(params, req, "count", "count");
  addNumericIfPositive(params, req, "time_range_start", "time_range_start", "timeRangeStart");
  addNumericIfPositive(params, req, "time_range_end", "time_range_end", "timeRangeEnd");
  addArrayIfPresent(params, req, "sort", "sort");
  addFilters(params, req, [
    "src_ip",
    "dest_ip",
    "attacker",
    "victim",
    "severity",
    "result",
    "keyword",
    "name",
    "tag",
  ]);
  return mergeRawParams(params, req);
};

const buildListAssetsParams = (req) => {
  const params = {};
  addNumericIfNonNegative(params, req, "offset", "offset");
  addNumericIfPositive(params, req, "count", "count");
  addNumericIfPositive(params, req, "id", "id");
  addNumericIfPositive(params, req, "group_id", "group_id", "groupId");
  addNumericIfPositive(params, req, "importance", "importance");
  addIfPresent(params, req, "ip", "ip");
  addIfPresent(params, req, "mac", "mac");
  addIfPresent(params, req, "name", "name");
  addIfPresent(params, req, "asset_type", "asset_type", "assetType");
  addArrayIfPresent(params, req, "tag_id", "tag_id", "tagId");
  return mergeRawParams(params, req);
};

const buildDiscoveredAssetsParams = (req) => {
  const params = {};
  addNumericIfNonNegative(params, req, "offset", "offset");
  addNumericIfPositive(params, req, "count", "count");
  addNumericIfPositive(params, req, "group_id", "group_id", "groupId");
  addNumericIfPositive(params, req, "importance", "importance");
  addNumericIfPositive(params, req, "port", "port");
  addNumericIfPositive(params, req, "time_start", "time_start", "timeStart");
  addNumericIfPositive(params, req, "time_end", "time_end", "timeEnd");
  addIfPresent(params, req, "ip_addr", "ip_addr", "ipAddr");
  addIfPresent(params, req, "mac", "mac");
  addIfPresent(params, req, "name", "name");
  addIfPresent(params, req, "os", "os");
  addIfPresent(params, req, "asset_type", "asset_type", "assetType");
  addArrayIfPresent(params, req, "service", "service");
  addArrayIfPresent(params, req, "tag_id", "tag_id", "tagId");
  return mergeRawParams(params, req);
};

const requireId = (req, name = "id") => {
  const value = Number(firstPresent(req, name));
  if (!Number.isInteger(value) || value <= 0) {
    throw toGrpcError(grpcStatus.INVALID_ARGUMENT, `${name} must be a positive integer`);
  }
  return value;
};

const requireDocId = (req) => {
  const docId = String(firstPresent(req, "doc_id", "docId") || "").trim();
  if (!docId) {
    throw toGrpcError(grpcStatus.INVALID_ARGUMENT, "doc_id is required");
  }
  return docId;
};

const getPcapFiles = (req) => {
  const rawFiles = firstPresent(req, "pcap_files", "pcapFiles");
  if (!Array.isArray(rawFiles) || rawFiles.length === 0) {
    throw toGrpcError(grpcStatus.INVALID_ARGUMENT, "pcap_files must contain at least one file");
  }
  return rawFiles.map((item, index) => {
    const fileName = String(firstPresent(item, "file_name", "fileName") || "").trim();
    const contentBase64 = String(firstPresent(item, "content_base64", "contentBase64") || "");
    if (!fileName) {
      throw toGrpcError(grpcStatus.INVALID_ARGUMENT, `pcap_files[${index}].file_name is required`);
    }
    if (!contentBase64) {
      throw toGrpcError(grpcStatus.INVALID_ARGUMENT, `pcap_files[${index}].content_base64 is required`);
    }
    let bytes;
    try {
      bytes = Buffer.from(contentBase64, "base64");
    } catch (error) {
      throw toGrpcError(grpcStatus.INVALID_ARGUMENT, `pcap_files[${index}].content_base64 is invalid: ${error.message}`);
    }
    if (bytes.length === 0) {
      throw toGrpcError(grpcStatus.INVALID_ARGUMENT, `pcap_files[${index}] is empty`);
    }
    return { fileName, bytes };
  });
};

async function uploadPcapDetectFilesInternal(ctx, pcapFiles, sessionCookie) {
  const config = getConfig(ctx);
  const cookie = sessionCookie || (await webLogin(ctx));
  const form = new FormData();
  for (const file of pcapFiles) {
    form.append("file", new Blob([file.bytes]), file.fileName);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  let response;
  try {
    response = await fetch(`${config.endpoint}/api/upload?id=${encodeURIComponent(METHOD.uploadPcapDetectFiles)}`, {
      ...buildTlsOptions(config.skipTlsVerify),
      method: "POST",
      headers: { cookie },
      body: form,
      signal: controller.signal,
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw toGrpcError(grpcStatus.DEADLINE_EXCEEDED, `pcap upload timeout after ${config.timeoutMs}ms`);
    }
    throw toGrpcError(grpcStatus.UNAVAILABLE, `pcap upload request failed: ${error.message}`);
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    throw toGrpcError(grpcStatus.UNAVAILABLE, `pcap upload HTTP ${response.status}`);
  }
  const payload = await parseJsonResponse(response, "pcap upload");
  if (payload?.error) {
    throw toGrpcError(statusForJsonRpcError(payload.error), payload.error.message || JSON.stringify(payload.error));
  }
  return payload?.result ?? null;
}

const uploadedFilesFromRequest = (req) => {
  const files = firstPresent(req, "files");
  if (!Array.isArray(files) || files.length === 0) return undefined;
  return files.map((item, index) => {
    const id = String(firstPresent(item, "id") || "").trim();
    const fileName = String(firstPresent(item, "file_name", "fileName") || "").trim();
    if (!id) throw toGrpcError(grpcStatus.INVALID_ARGUMENT, `files[${index}].id is required`);
    if (!fileName) throw toGrpcError(grpcStatus.INVALID_ARGUMENT, `files[${index}].file_name is required`);
    return { id, file_name: fileName };
  });
};

const buildPcapDetectTaskParams = (req) => {
  const params = {};
  const files = uploadedFilesFromRequest(req);
  if (files) params.files = files;
  const detectPattern = Number(firstPresent(req, "detect_pattern", "detectPattern"));
  params.detect_pattern = Number.isInteger(detectPattern) && detectPattern >= 0 ? detectPattern : 2;
  return mergeRawParams(params, req);
};

const buildDeletePcapDetectTaskParams = (req) => {
  const params = { id: requireId(req) };
  const deleteStrategy = Number(firstPresent(req, "delete_strategy", "deleteStrategy"));
  params.delete_strategy = Number.isInteger(deleteStrategy) && deleteStrategy > 0 ? deleteStrategy : 1;
  return mergeRawParams(params, req);
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const normalizeDurationMs = (raw, fallback, minimum, maximum) => {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.min(Math.max(Math.trunc(value), minimum), maximum);
};

const parseResultJson = (result) => JSON.parse(result.resultJson);

const safeCall = async (ctx, method, params, { web = false, sessionCookie } = {}) => {
  try {
    const response = web ? await callWebJsonRpc(ctx, method, params, sessionCookie) : await callJsonRpc(ctx, method, params);
    return { ok: true, params, result: parseResultJson(response) };
  } catch (error) {
    return {
      ok: false,
      params,
      error: {
        message: error?.message || String(error),
        code: error?.code,
      },
    };
  }
};

const resultRows = (value) => {
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value.data)) return value.data;
  if (Array.isArray(value.list)) return value.list;
  if (Array.isArray(value.result?.data)) return value.result.data;
  return [];
};

const summarizeAgg = (call) =>
  resultRows(call?.result)
    .map((item) => ({
      key: item.key ?? item.name ?? item.value ?? "",
      count: Number(item.doc_count ?? item.count ?? 0),
    }))
    .filter((item) => item.key !== "");

const summarizeAlerts = (callOrResult, limit = 5) => {
  const rows = resultRows(callOrResult?.result ?? callOrResult);
  return rows.slice(0, limit).map((item) => ({
    doc_id: item.doc_id,
    name: item.name,
    severity: item.severity,
    result: item.result,
    attacker: item.attacker ?? item.attacker_ip ?? item.src_ip,
    victim: item.victim ?? item.victim_ip ?? item.dest_ip,
    src_ip: item.src_ip,
    dest_ip: item.dest_ip,
    timestamp: item.timestamp,
    msg: item.msg,
  }));
};

const totalOf = (callOrResult) => Number((callOrResult?.result ?? callOrResult)?.total ?? 0);

const uniqueStrings = (values) => [...new Set(values.filter((item) => typeof item === "string" && item.trim()))];

const trafficTotals = (rawLogs) => {
  const totals = {};
  for (const [key, value] of Object.entries(rawLogs ?? {})) {
    totals[key] = value?.ok ? totalOf(value) : null;
  }
  return totals;
};

const collectPivotIps = (...samples) =>
  uniqueStrings(
    samples
      .flat()
      .flatMap((item) => [item.attacker, item.victim, item.src_ip, item.dest_ip])
      .filter(Boolean),
  );

async function searchAttackRecords(ctx) {
  const req = ctx.request ?? {};
  return callJsonRpc(ctx, METHOD.listAlerts, buildScenarioAlertParams(req));
}

async function analyzeIpActivity(ctx) {
  const req = ctx.request ?? {};
  const ip = normalizedString(firstPresent(req, "ip"));
  if (!ip) throw toGrpcError(grpcStatus.INVALID_ARGUMENT, "ip is required");
  const role = normalizedString(firstPresent(req, "role")).toLowerCase() || "any";
  const count = parsePositiveInteger(firstPresent(req, "count"), 10);
  const timeRange = buildTimeRange(req, DEFAULT_LOOKBACK_DAYS);
  const base = { ...timeRange, offset: 0, count, sort: [{ field: "timestamp", ascending: false }] };
  const includeRawLogs = Boolean(firstPresent(req, "include_raw_logs", "includeRawLogs"));
  const result = {
    ip,
    role,
    timeRange,
    guidance: [
      "alerts_as_attacker shows attacks where the IP is the attacker.",
      "alerts_as_victim shows attacks where the IP is the victim.",
      "asset summarizes the managed asset record when the IP is known to the device.",
    ],
    asset: await safeCall(ctx, METHOD.listAssets, { ip, offset: 0, count: 5 }),
  };
  const needsWebAggregations = role === "any" || role === "attacker" || role === "victim";
  const sessionCookie = needsWebAggregations ? await webLogin(ctx).catch(() => undefined) : undefined;

  if (role === "any" || role === "attacker") {
    result.alerts_as_attacker = await safeCall(ctx, METHOD.listAlerts, { ...base, attacker: eqFilter(ip) });
    result.top_attack_names_as_attacker = await safeCall(
      ctx,
      METHOD.listAlertAggTop,
      { ...timeRange, agg: "name", top: 10, attacker: eqFilter(ip) },
      { web: true, sessionCookie },
    );
  }
  if (role === "any" || role === "victim") {
    result.alerts_as_victim = await safeCall(ctx, METHOD.listAlerts, { ...base, victim: eqFilter(ip) });
    result.top_attack_names_as_victim = await safeCall(
      ctx,
      METHOD.listAlertAggTop,
      { ...timeRange, agg: "name", top: 10, victim: eqFilter(ip) },
      { web: true, sessionCookie },
    );
  }
  if (includeRawLogs) {
    result.raw_logs = {
      http_src: await safeCall(ctx, METHOD.searchHttpLogs, { ...base, src_ip: eqFilter(ip) }),
      http_dest: await safeCall(ctx, METHOD.searchHttpLogs, { ...base, dest_ip: eqFilter(ip) }),
      dns_src: await safeCall(ctx, METHOD.searchDnsLogs, { ...base, src_ip: eqFilter(ip) }),
      dns_dest: await safeCall(ctx, METHOD.searchDnsLogs, { ...base, dest_ip: eqFilter(ip) }),
    };
  }
  return { resultJson: JSON.stringify(result) };
}

async function huntThreats(ctx) {
  const req = ctx.request ?? {};
  const alertParams = buildScenarioAlertParams(req, { defaultCount: parsePositiveInteger(firstPresent(req, "count"), 20) });
  const { time_range_start: timeRangeStart, time_range_end: timeRangeEnd } = alertParams;
  const topBase = {
    time_range_start: timeRangeStart,
    time_range_end: timeRangeEnd,
  };
  for (const key of ["name", "keyword", "attacker", "victim", "asset_ip", "severity", "result"]) {
    if (alertParams[key] !== undefined) topBase[key] = alertParams[key];
  }
  const alerts = await safeCall(ctx, METHOD.listAlerts, alertParams);
  const sessionCookie = await webLogin(ctx).catch(() => undefined);
  const result = {
    query: firstPresent(req, "query", "keyword", "attack_name", "attackName") ?? "",
    alertParams,
    alerts,
    top_attack_names: await safeCall(ctx, METHOD.listAlertAggTop, { ...topBase, agg: "name", top: 10 }, { web: true, sessionCookie }),
    top_attackers: await safeCall(ctx, METHOD.listAlertAggTop, { ...topBase, agg: "attacker", top: 10 }, { web: true, sessionCookie }),
    top_victims: await safeCall(ctx, METHOD.listAlertAggTop, { ...topBase, agg: "victim", top: 10 }, { web: true, sessionCookie }),
  };
  return { resultJson: JSON.stringify(result) };
}

async function investigateAttackCampaign(ctx) {
  const req = ctx.request ?? {};
  const alertParams = buildScenarioAlertParams(req, { defaultCount: parsePositiveInteger(firstPresent(req, "count"), 10) });
  const timeRange = {
    time_range_start: alertParams.time_range_start,
    time_range_end: alertParams.time_range_end,
  };
  const topBase = { ...timeRange };
  for (const key of ["name", "keyword", "attacker", "victim", "asset_ip", "severity", "result"]) {
    if (alertParams[key] !== undefined) topBase[key] = alertParams[key];
  }
  const alerts = await safeCall(ctx, METHOD.listAlerts, alertParams);
  const sessionCookie = await webLogin(ctx).catch(() => undefined);
  const topAttackNames = await safeCall(ctx, METHOD.listAlertAggTop, { ...topBase, agg: "name", top: 10 }, { web: true, sessionCookie });
  const topAttackers = await safeCall(ctx, METHOD.listAlertAggTop, { ...topBase, agg: "attacker", top: 10 }, { web: true, sessionCookie });
  const topVictims = await safeCall(ctx, METHOD.listAlertAggTop, { ...topBase, agg: "victim", top: 10 }, { web: true, sessionCookie });
  const topResults = await safeCall(ctx, METHOD.listAlertAggTop, { ...topBase, agg: "result", top: 10 }, { web: true, sessionCookie });
  const sampleAlerts = summarizeAlerts(alerts, parsePositiveInteger(firstPresent(req, "count"), 10));
  const pivotIps = collectPivotIps(sampleAlerts);
  return {
    resultJson: JSON.stringify({
      type: "attack_campaign_investigation",
      query: firstPresent(req, "query", "keyword", "attack_name", "attackName") ?? "",
      timeRange,
      filters: alertParams,
      summary: {
        total_alerts: totalOf(alerts),
        top_attack_names: summarizeAgg(topAttackNames),
        top_attackers: summarizeAgg(topAttackers),
        top_victims: summarizeAgg(topVictims),
        top_results: summarizeAgg(topResults),
        pivot_ips: pivotIps,
      },
      evidence: {
        sample_alerts: sampleAlerts,
      },
      raw: {
        alerts,
        top_attack_names: topAttackNames,
        top_attackers: topAttackers,
        top_victims: topVictims,
        top_results: topResults,
      },
    }),
  };
}

async function assessIpThreatProfile(ctx) {
  const req = ctx.request ?? {};
  const ip = normalizedString(firstPresent(req, "ip"));
  if (!ip) throw toGrpcError(grpcStatus.INVALID_ARGUMENT, "ip is required");
  const count = parsePositiveInteger(firstPresent(req, "count"), 5);
  const includeRawLogs = Boolean(firstPresent(req, "include_raw_logs", "includeRawLogs"));
  const timeRange = buildTimeRange(req, DEFAULT_LOOKBACK_DAYS);
  const base = { ...timeRange, offset: 0, count, sort: [{ field: "timestamp", ascending: false }] };
  const asset = await safeCall(ctx, METHOD.listAssets, { ip, offset: 0, count: 5 });
  const alertsAsAttacker = await safeCall(ctx, METHOD.listAlerts, { ...base, attacker: eqFilter(ip) });
  const alertsAsVictim = await safeCall(ctx, METHOD.listAlerts, { ...base, victim: eqFilter(ip) });
  const sessionCookie = await webLogin(ctx).catch(() => undefined);
  const topNamesAsAttacker = await safeCall(
    ctx,
    METHOD.listAlertAggTop,
    { ...timeRange, agg: "name", top: 10, attacker: eqFilter(ip) },
    { web: true, sessionCookie },
  );
  const topVictims = await safeCall(
    ctx,
    METHOD.listAlertAggTop,
    { ...timeRange, agg: "victim", top: 10, attacker: eqFilter(ip) },
    { web: true, sessionCookie },
  );
  const topNamesAsVictim = await safeCall(
    ctx,
    METHOD.listAlertAggTop,
    { ...timeRange, agg: "name", top: 10, victim: eqFilter(ip) },
    { web: true, sessionCookie },
  );
  const topAttackers = await safeCall(
    ctx,
    METHOD.listAlertAggTop,
    { ...timeRange, agg: "attacker", top: 10, victim: eqFilter(ip) },
    { web: true, sessionCookie },
  );
  const topResultsAsAttacker = await safeCall(
    ctx,
    METHOD.listAlertAggTop,
    { ...timeRange, agg: "result", top: 10, attacker: eqFilter(ip) },
    { web: true, sessionCookie },
  );
  const topResultsAsVictim = await safeCall(
    ctx,
    METHOD.listAlertAggTop,
    { ...timeRange, agg: "result", top: 10, victim: eqFilter(ip) },
    { web: true, sessionCookie },
  );

  let rawLogs;
  if (includeRawLogs) {
    rawLogs = {
      http_src: await safeCall(ctx, METHOD.searchHttpLogs, { ...base, src_ip: eqFilter(ip) }),
      http_dest: await safeCall(ctx, METHOD.searchHttpLogs, { ...base, dest_ip: eqFilter(ip) }),
      dns_src: await safeCall(ctx, METHOD.searchDnsLogs, { ...base, src_ip: eqFilter(ip) }),
      dns_dest: await safeCall(ctx, METHOD.searchDnsLogs, { ...base, dest_ip: eqFilter(ip) }),
      tcp_udp_src: await safeCall(ctx, METHOD.searchTcpUdpLogs, { ...base, src_ip: eqFilter(ip) }),
      tcp_udp_dest: await safeCall(ctx, METHOD.searchTcpUdpLogs, { ...base, dest_ip: eqFilter(ip) }),
      other_src: await safeCall(ctx, METHOD.searchOtherLogs, { ...base, src_ip: eqFilter(ip) }),
      other_dest: await safeCall(ctx, METHOD.searchOtherLogs, { ...base, dest_ip: eqFilter(ip) }),
    };
  }

  const attackerSamples = summarizeAlerts(alertsAsAttacker, count);
  const victimSamples = summarizeAlerts(alertsAsVictim, count);
  const attackerTotal = totalOf(alertsAsAttacker);
  const victimTotal = totalOf(alertsAsVictim);
  const dominantRole = attackerTotal === 0 && victimTotal === 0 ? "none" : attackerTotal === victimTotal ? "mixed" : attackerTotal > victimTotal ? "attacker" : "victim";
  return {
    resultJson: JSON.stringify({
      type: "ip_threat_profile",
      ip,
      timeRange,
      summary: {
        asset_query_ok: Boolean(asset?.ok),
        asset_known: totalOf(asset) > 0 || resultRows(asset?.result).length > 0,
        alerts_as_attacker: attackerTotal,
        alerts_as_victim: victimTotal,
        dominant_role: dominantRole,
        top_attack_names_as_attacker: summarizeAgg(topNamesAsAttacker),
        top_victims_when_attacker: summarizeAgg(topVictims),
        top_results_as_attacker: summarizeAgg(topResultsAsAttacker),
        top_attack_names_as_victim: summarizeAgg(topNamesAsVictim),
        top_attackers_when_victim: summarizeAgg(topAttackers),
        top_results_as_victim: summarizeAgg(topResultsAsVictim),
        traffic_totals: includeRawLogs ? trafficTotals(rawLogs) : undefined,
        pivot_ips: collectPivotIps(attackerSamples, victimSamples),
      },
      evidence: {
        asset: asset?.result,
        sample_alerts_as_attacker: attackerSamples,
        sample_alerts_as_victim: victimSamples,
      },
      raw: {
        asset,
        alerts_as_attacker: alertsAsAttacker,
        alerts_as_victim: alertsAsVictim,
        top_attack_names_as_attacker: topNamesAsAttacker,
        top_victims_when_attacker: topVictims,
        top_results_as_attacker: topResultsAsAttacker,
        top_attack_names_as_victim: topNamesAsVictim,
        top_attackers_when_victim: topAttackers,
        top_results_as_victim: topResultsAsVictim,
        raw_logs: rawLogs,
      },
    }),
  };
}

async function searchTrafficLogs(ctx) {
  const req = ctx.request ?? {};
  const protocol = normalizedString(firstPresent(req, "protocol")).toLowerCase() || "all";
  const methodByProtocol = {
    http: METHOD.searchHttpLogs,
    dns: METHOD.searchDnsLogs,
    tcp_udp: METHOD.searchTcpUdpLogs,
    tcpudp: METHOD.searchTcpUdpLogs,
    "tcp/udp": METHOD.searchTcpUdpLogs,
    other: METHOD.searchOtherLogs,
  };
  const selected =
    protocol === "all"
      ? [
          ["http", METHOD.searchHttpLogs],
          ["dns", METHOD.searchDnsLogs],
          ["tcp_udp", METHOD.searchTcpUdpLogs],
          ["other", METHOD.searchOtherLogs],
        ]
      : [[protocol, methodByProtocol[protocol]]];
  if (selected.some(([, method]) => !method)) {
    throw toGrpcError(grpcStatus.INVALID_ARGUMENT, "protocol must be one of all, http, dns, tcp_udp, tcpudp, tcp/udp, other");
  }

  const ip = normalizedString(firstPresent(req, "ip"));
  const params = buildTrafficLogParams(req);
  if (!ip) {
    if (selected.length === 1) return callJsonRpc(ctx, selected[0][1], params);
    const result = {};
    for (const [name, method] of selected) result[name] = await safeCall(ctx, method, params);
    return { resultJson: JSON.stringify({ protocol, params, results: result }) };
  }

  const result = {};
  for (const [name, method] of selected) {
    result[`${name}_src`] = await safeCall(ctx, method, { ...params, src_ip: eqFilter(ip) });
    result[`${name}_dest`] = await safeCall(ctx, method, { ...params, dest_ip: eqFilter(ip) });
  }
  return { resultJson: JSON.stringify({ protocol, ip, params, results: result }) };
}

async function analyzePcapFiles(ctx) {
  const req = ctx.request ?? {};
  const pcapFiles = getPcapFiles(req);
  const detectPattern = Number(firstPresent(req, "detect_pattern", "detectPattern"));
  const sessionCookie = await webLogin(ctx);
  const upload = await uploadPcapDetectFilesInternal(ctx, pcapFiles, sessionCookie);
  const files = upload?.files ?? [];
  if (!Array.isArray(files) || files.length === 0) {
    return { resultJson: JSON.stringify({ upload, createTask: null, tasks: [], alerts: [] }) };
  }

  const createTask = parseResultJson(
    await callWebJsonRpc(
      ctx,
      METHOD.createPcapDetectTask,
      { files, detect_pattern: Number.isInteger(detectPattern) && detectPattern >= 0 ? detectPattern : 2 },
      sessionCookie,
    ),
  );
  const createdTasks = Array.isArray(createTask?.pcap_detect_tasks) ? createTask.pcap_detect_tasks : [];
  const taskIds = createdTasks
    .map((item) => Number(firstPresent(item, "pcap_detect_task_id", "pcapDetectTaskId")))
    .filter((item) => Number.isInteger(item) && item > 0);

  let tasks = [];
  if (firstPresent(req, "wait_for_completion", "waitForCompletion")) {
    const timeoutMs = normalizeDurationMs(
      firstPresent(req, "timeout_ms", "timeoutMs"),
      DEFAULT_PCAP_ANALYSIS_TIMEOUT_MS,
      MIN_PCAP_DURATION_MS,
      MAX_PCAP_ANALYSIS_TIMEOUT_MS,
    );
    const pollIntervalMs = normalizeDurationMs(
      firstPresent(req, "poll_interval_ms", "pollIntervalMs"),
      DEFAULT_PCAP_POLL_INTERVAL_MS,
      MIN_PCAP_DURATION_MS,
      MAX_PCAP_POLL_INTERVAL_MS,
    );
    const deadline = Date.now() + timeoutMs;
    while (Date.now() <= deadline) {
      const taskList = parseResultJson(
        await callJsonRpc(ctx, METHOD.listPcapDetectTasks, { limit: 100, offset: 0 }),
      );
      tasks = Array.isArray(taskList?.pcap_detect_task_list)
        ? taskList.pcap_detect_task_list.filter((item) => taskIds.includes(Number(item.id)))
        : [];
      if (tasks.length >= taskIds.length && tasks.every((item) => [2, 3].includes(Number(item.replay_status)))) break;
      await sleep(pollIntervalMs);
    }
  }

  const alerts = [];
  for (const taskId of taskIds) {
    const alertResult = parseResultJson(
      await callJsonRpc(ctx, METHOD.listPcapDetectAlerts, {
        count: 100,
        offset: 0,
        pcap_detect_task_id: [{ oper: "=", target: String(taskId) }],
      }),
    );
    alerts.push({ taskId, result: alertResult });
  }

  return {
    resultJson: JSON.stringify({ upload, createTask, tasks, alerts }),
  };
}

const parseFilename = (contentDisposition) => {
  const value = String(contentDisposition || "");
  const utf8Match = value.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match) {
    try {
      return decodeURIComponent(utf8Match[1].trim().replace(/^"|"$/g, ""));
    } catch {
      // Fall back to the plain filename parameter when the upstream encoding is malformed.
    }
  }
  const asciiMatch = value.match(/filename="?([^";]+)"?/i);
  return asciiMatch ? asciiMatch[1].trim() : "";
};

async function downloadFile(ctx) {
  const config = getConfig(ctx);
  const req = ctx.request ?? {};
  const id = String(firstPresent(req, "id") || "").trim();
  const query = String(firstPresent(req, "query") || "").trim();
  const queryJson = firstPresent(req, "query_json", "queryJson");
  if (!id) {
    throw toGrpcError(grpcStatus.INVALID_ARGUMENT, "id is required");
  }
  if (!query && queryJson === undefined) {
    throw toGrpcError(grpcStatus.INVALID_ARGUMENT, "query or query_json is required");
  }

  const params = new URLSearchParams();
  params.set("id", id);
  params.set("query", query || Buffer.from(String(queryJson)).toString("base64"));

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  let response;
  try {
    response = await fetch(`${config.endpoint}/api/download?${params.toString()}`, {
      ...buildTlsOptions(config.skipTlsVerify),
      method: "GET",
      headers: {
        "API-Token": config.apiToken,
      },
      signal: controller.signal,
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw toGrpcError(grpcStatus.DEADLINE_EXCEEDED, `upstream download timeout after ${config.timeoutMs}ms`);
    }
    throw toGrpcError(grpcStatus.UNAVAILABLE, `upstream download request failed: ${error.message}`);
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    if (response.status === 401) throw toGrpcError(grpcStatus.UNAUTHENTICATED, "upstream rejected API token");
    if (response.status === 403) throw toGrpcError(grpcStatus.PERMISSION_DENIED, "upstream permission denied");
    if (response.status >= 500) throw toGrpcError(grpcStatus.UNAVAILABLE, `upstream HTTP ${response.status}`);
    throw toGrpcError(grpcStatus.FAILED_PRECONDITION, `upstream HTTP ${response.status}`);
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > config.maxDownloadBytes) {
    throw toGrpcError(grpcStatus.RESOURCE_EXHAUSTED, `upstream download exceeds ${config.maxDownloadBytes} bytes`);
  }
  return {
    contentType: response.headers.get("content-type") || "",
    filename: parseFilename(response.headers.get("content-disposition")),
    contentBase64: bytes.toString("base64"),
  };
}

export const handlers = {
  [FULL_METHOD.listAlerts]: (ctx) => callJsonRpc(ctx, METHOD.listAlerts, buildListAlertsParams(ctx.request ?? {})),
  [FULL_METHOD.searchAttackRecords]: searchAttackRecords,
  [FULL_METHOD.analyzeIpActivity]: analyzeIpActivity,
  [FULL_METHOD.huntThreats]: huntThreats,
  [FULL_METHOD.investigateAttackCampaign]: investigateAttackCampaign,
  [FULL_METHOD.assessIpThreatProfile]: assessIpThreatProfile,

  [FULL_METHOD.getAlert]: (ctx) => callJsonRpc(ctx, METHOD.getAlert, { doc_id: requireDocId(ctx.request ?? {}) }),

  [FULL_METHOD.getAlertRawDocument]: (ctx) =>
    callJsonRpc(ctx, METHOD.getAlertRawDocument, { doc_id: requireDocId(ctx.request ?? {}) }),
  [FULL_METHOD.countAlerts]: (ctx) => callWebJsonRpc(ctx, METHOD.countAlerts, buildRawParams(ctx.request ?? {})),
  [FULL_METHOD.listAlertAggregations]: (ctx) =>
    callWebJsonRpc(ctx, METHOD.listAlertAggregations, buildRawParams(ctx.request ?? {})),
  [FULL_METHOD.listAlertAggregationsT2]: (ctx) =>
    callWebJsonRpc(ctx, METHOD.listAlertAggregationsT2, buildRawParams(ctx.request ?? {})),
  [FULL_METHOD.listAlertAggTop]: (ctx) => callWebJsonRpc(ctx, METHOD.listAlertAggTop, buildRawParams(ctx.request ?? {})),
  [FULL_METHOD.listAlertChart]: (ctx) => callWebJsonRpc(ctx, METHOD.listAlertChart, buildRawParams(ctx.request ?? {})),
  [FULL_METHOD.loadAlertPcapFile]: (ctx) =>
    callWebJsonRpc(ctx, METHOD.loadAlertPcapFile, buildRawParams(ctx.request ?? {})),
  [FULL_METHOD.listAlertPcapFrames]: (ctx) =>
    callWebJsonRpc(ctx, METHOD.listAlertPcapFrames, buildRawParams(ctx.request ?? {})),
  [FULL_METHOD.filterAlertPcapFrames]: (ctx) =>
    callWebJsonRpc(ctx, METHOD.filterAlertPcapFrames, buildRawParams(ctx.request ?? {})),
  [FULL_METHOD.getAlertPcapFrame]: (ctx) =>
    callWebJsonRpc(ctx, METHOD.getAlertPcapFrame, buildRawParams(ctx.request ?? {})),
  [FULL_METHOD.checkAlertPcapDownload]: (ctx) =>
    callWebJsonRpc(ctx, METHOD.checkAlertPcapDownload, buildRawParams(ctx.request ?? {})),

  [FULL_METHOD.listCustomIntelligences]: (ctx) =>
    callJsonRpc(ctx, METHOD.listCustomIntelligences, buildRawParams(ctx.request ?? {})),
  [FULL_METHOD.createCustomIntelligence]: (ctx) =>
    callMutableJsonRpc(ctx, METHOD.createCustomIntelligence, buildRawParams),
  [FULL_METHOD.updateCustomIntelligence]: (ctx) =>
    callMutableJsonRpc(ctx, METHOD.updateCustomIntelligence, buildRawParams),
  [FULL_METHOD.updateCustomIntelligenceStatus]: (ctx) =>
    callMutableJsonRpc(ctx, METHOD.updateCustomIntelligenceStatus, buildRawParams),
  [FULL_METHOD.deleteCustomIntelligence]: (ctx) =>
    callMutableJsonRpc(ctx, METHOD.deleteCustomIntelligence, buildIdsParams),
  [FULL_METHOD.listCustomRules]: (ctx) => callJsonRpc(ctx, METHOD.listCustomRules, buildRawParams(ctx.request ?? {})),
  [FULL_METHOD.createCustomRule]: (ctx) => callMutableJsonRpc(ctx, METHOD.createCustomRule, buildRawParams),
  [FULL_METHOD.updateCustomRule]: (ctx) => callMutableJsonRpc(ctx, METHOD.updateCustomRule, buildRawParams),
  [FULL_METHOD.updateCustomRuleStatus]: (ctx) =>
    callMutableJsonRpc(ctx, METHOD.updateCustomRuleStatus, buildRawParams),
  [FULL_METHOD.deleteCustomRule]: (ctx) => callMutableJsonRpc(ctx, METHOD.deleteCustomRule, buildIdsParams),
  [FULL_METHOD.createAlarmWhiteList]: (ctx) =>
    callMutableJsonRpc(ctx, METHOD.createAlarmWhiteList, buildRawParams),
  [FULL_METHOD.updateAlarmWhiteList]: (ctx) =>
    callMutableJsonRpc(ctx, METHOD.updateAlarmWhiteList, buildRawParams),
  [FULL_METHOD.deleteAlarmWhiteList]: (ctx) =>
    callMutableJsonRpc(ctx, METHOD.deleteAlarmWhiteList, buildIdsActionParams),

  [FULL_METHOD.listAssets]: (ctx) => callJsonRpc(ctx, METHOD.listAssets, buildListAssetsParams(ctx.request ?? {})),

  [FULL_METHOD.getAsset]: (ctx) => callJsonRpc(ctx, METHOD.getAsset, { id: requireId(ctx.request ?? {}) }),

  [FULL_METHOD.searchAssetTree]: (ctx) => {
    const req = ctx.request ?? {};
    const params = {};
    addIfPresent(params, req, "keyword", "keyword");
    return callJsonRpc(ctx, METHOD.searchAssetTree, mergeRawParams(params, req));
  },

  [FULL_METHOD.listAssetGroups]: (ctx) => {
    const req = ctx.request ?? {};
    const params = {};
    addNumericIfPositive(params, req, "id", "id");
    addIfPresent(params, req, "name", "name");
    return callJsonRpc(ctx, METHOD.listAssetGroups, mergeRawParams(params, req));
  },

  [FULL_METHOD.listAssetTags]: (ctx) => {
    const req = ctx.request ?? {};
    const params = {};
    addNumericIfNonNegative(params, req, "offset", "offset");
    addNumericIfPositive(params, req, "count", "count");
    addIfPresent(params, req, "name", "name");
    return callJsonRpc(ctx, METHOD.listAssetTags, mergeRawParams(params, req));
  },

  [FULL_METHOD.listDiscoveredAssets]: (ctx) =>
    callJsonRpc(ctx, METHOD.listDiscoveredAssets, buildDiscoveredAssetsParams(ctx.request ?? {})),

  [FULL_METHOD.batchCreateFirewallWhiteList]: (ctx) =>
    callMutableJsonRpc(ctx, METHOD.batchCreateFirewallWhiteList, buildRawParams),
  [FULL_METHOD.createFirewallWhiteList]: (ctx) =>
    callMutableJsonRpc(ctx, METHOD.createFirewallWhiteList, buildRawParams),
  [FULL_METHOD.updateFirewallWhiteList]: (ctx) =>
    callMutableJsonRpc(ctx, METHOD.updateFirewallWhiteList, buildRawParams),
  [FULL_METHOD.updateFirewallWhiteListStatus]: (ctx) =>
    callMutableJsonRpc(ctx, METHOD.updateFirewallWhiteListStatus, buildRawParams),
  [FULL_METHOD.deleteFirewallWhiteList]: (ctx) =>
    callMutableJsonRpc(ctx, METHOD.deleteFirewallWhiteList, buildIdsParams),
  [FULL_METHOD.deleteAllFirewallWhiteList]: (ctx) =>
    callMutableJsonRpc(ctx, METHOD.deleteAllFirewallWhiteList, buildRawParams),
  [FULL_METHOD.createBlockRules]: (ctx) => callMutableJsonRpc(ctx, METHOD.createBlockRules, buildRawParams),
  [FULL_METHOD.updateBlockRules]: (ctx) => callMutableJsonRpc(ctx, METHOD.updateBlockRules, buildRawParams),
  [FULL_METHOD.updateBlockRulesStatus]: (ctx) =>
    callMutableJsonRpc(ctx, METHOD.updateBlockRulesStatus, buildRawParams),
  [FULL_METHOD.deleteAllBlockRules]: (ctx) =>
    callMutableJsonRpc(ctx, METHOD.deleteAllBlockRules, buildRawParams),
  [FULL_METHOD.listBlockRules]: (ctx) => callJsonRpc(ctx, METHOD.listBlockRules, buildRawParams(ctx.request ?? {})),
  [FULL_METHOD.listBlockRulesTrend]: (ctx) =>
    callJsonRpc(ctx, METHOD.listBlockRulesTrend, buildRawParams(ctx.request ?? {})),
  [FULL_METHOD.listTapBlockRecords]: (ctx) =>
    callJsonRpc(ctx, METHOD.listTapBlockRecords, buildRawParams(ctx.request ?? {})),
  [FULL_METHOD.countTapBlocks]: (ctx) => callJsonRpc(ctx, METHOD.countTapBlocks, buildRawParams(ctx.request ?? {})),
  [FULL_METHOD.listTopTapBlocks]: (ctx) => callJsonRpc(ctx, METHOD.listTopTapBlocks, buildRawParams(ctx.request ?? {})),
  [FULL_METHOD.listPcapDetectTasks]: (ctx) =>
    callJsonRpc(ctx, METHOD.listPcapDetectTasks, buildRawParams(ctx.request ?? {})),
  [FULL_METHOD.uploadPcapDetectFiles]: async (ctx) => {
    const req = ctx.request ?? {};
    return {
      resultJson: JSON.stringify(await uploadPcapDetectFilesInternal(ctx, getPcapFiles(req))),
    };
  },
  [FULL_METHOD.createPcapDetectTask]: (ctx) => {
    const req = ctx.request ?? {};
    return callWebJsonRpc(ctx, METHOD.createPcapDetectTask, buildMutableParams(req, buildPcapDetectTaskParams(req)));
  },
  [FULL_METHOD.deletePcapDetectTask]: (ctx) => {
    const req = ctx.request ?? {};
    return callWebJsonRpc(ctx, METHOD.deletePcapDetectTask, buildMutableParams(req, buildDeletePcapDetectTaskParams(req)));
  },
  [FULL_METHOD.analyzePcapFiles]: analyzePcapFiles,
  [FULL_METHOD.listPcapDetectAlerts]: (ctx) =>
    callJsonRpc(ctx, METHOD.listPcapDetectAlerts, buildRawParams(ctx.request ?? {})),
  [FULL_METHOD.getPcapDetectAlert]: (ctx) =>
    callJsonRpc(ctx, METHOD.getPcapDetectAlert, { doc_id: requireDocId(ctx.request ?? {}) }),
  [FULL_METHOD.getPcapDetectAlertRawDocument]: (ctx) =>
    callWebJsonRpc(ctx, METHOD.getPcapDetectAlertRawDocument, { doc_id: requireDocId(ctx.request ?? {}) }),
  [FULL_METHOD.downloadPcap]: (ctx) => callJsonRpc(ctx, METHOD.downloadPcap, buildRawParams(ctx.request ?? {})),
  [FULL_METHOD.multiDownloadPcap]: (ctx) => callJsonRpc(ctx, METHOD.multiDownloadPcap, buildRawParams(ctx.request ?? {})),
  [FULL_METHOD.searchHttpLogs]: (ctx) => callJsonRpc(ctx, METHOD.searchHttpLogs, buildRawParams(ctx.request ?? {})),
  [FULL_METHOD.searchDnsLogs]: (ctx) => callJsonRpc(ctx, METHOD.searchDnsLogs, buildRawParams(ctx.request ?? {})),
  [FULL_METHOD.searchTcpUdpLogs]: (ctx) =>
    callJsonRpc(ctx, METHOD.searchTcpUdpLogs, buildRawParams(ctx.request ?? {})),
  [FULL_METHOD.searchOtherLogs]: (ctx) =>
    callJsonRpc(ctx, METHOD.searchOtherLogs, buildRawParams(ctx.request ?? {})),
  [FULL_METHOD.searchTrafficLogs]: searchTrafficLogs,
  [FULL_METHOD.getOriginalLogDetail]: (ctx) =>
    callJsonRpc(ctx, METHOD.getOriginalLogDetail, buildRawParams(ctx.request ?? {})),
  [FULL_METHOD.multiDownloadLogJson]: (ctx) =>
    callJsonRpc(ctx, METHOD.multiDownloadLogJson, buildRawParams(ctx.request ?? {})),
  [FULL_METHOD.listTcpdumpProcesses]: (ctx) =>
    callJsonRpc(ctx, METHOD.listTcpdumpProcesses, buildRawParams(ctx.request ?? {})),
  [FULL_METHOD.createTcpdumpProcess]: (ctx) =>
    callMutableJsonRpc(ctx, METHOD.createTcpdumpProcess, buildRawParams),
  [FULL_METHOD.updateTcpdumpProcess]: (ctx) =>
    callMutableJsonRpc(ctx, METHOD.updateTcpdumpProcess, buildRawParams),
  [FULL_METHOD.startTcpdumpProcess]: (ctx) =>
    callMutableJsonRpc(ctx, METHOD.startTcpdumpProcess, buildIdParams),
  [FULL_METHOD.cancelTcpdumpProcess]: (ctx) =>
    callMutableJsonRpc(ctx, METHOD.cancelTcpdumpProcess, buildIdParams),
  [FULL_METHOD.deleteTcpdumpProcess]: (ctx) =>
    callMutableJsonRpc(ctx, METHOD.deleteTcpdumpProcess, buildIdsParams),
  [FULL_METHOD.downloadFile]: downloadFile,
};

export const internals = {
  buildTlsOptions,
  buildListAlertsParams,
  buildScenarioAlertParams,
  buildTrafficLogParams,
  buildTimeRange,
  buildListAssetsParams,
  buildDiscoveredAssetsParams,
  buildRawParams,
  buildIdsParams,
  buildIdsActionParams,
  buildPcapDetectTaskParams,
  buildDeletePcapDetectTaskParams,
  normalizeDurationMs,
  parseFilename,
  fromValue,
};

import { GrpcError, grpcStatus } from "@chaitin-ai/octobus-sdk";

export const METHOD_PREFIX = "qingteng.hids.v5.QingtengHIDSService";

export const METHOD_LIST_HOSTS = `${METHOD_PREFIX}/ListHosts`;
export const METHOD_GET_HOST = `${METHOD_PREFIX}/GetHost`;
export const METHOD_COUNT_HOSTS = `${METHOD_PREFIX}/CountHosts`;
export const METHOD_LIST_AGENTS = `${METHOD_PREFIX}/ListAgents`;
export const METHOD_COUNT_AGENTS = `${METHOD_PREFIX}/CountAgents`;
export const METHOD_LIST_DETECTIONS = `${METHOD_PREFIX}/ListDetections`;
export const METHOD_GET_DETECTION = `${METHOD_PREFIX}/GetDetection`;
export const METHOD_LIST_RESPONSE_RESULTS = `${METHOD_PREFIX}/ListResponseResults`;
export const METHOD_LIST_RESPONSE_HISTORY = `${METHOD_PREFIX}/ListResponseHistory`;
export const METHOD_GET_ELEMENT_OPERATION_INFOS = `${METHOD_PREFIX}/GetElementOperationInfos`;
export const METHOD_LIST_BASELINES = `${METHOD_PREFIX}/ListBaselines`;
export const METHOD_GET_BASELINE = `${METHOD_PREFIX}/GetBaseline`;
export const METHOD_LIST_BASELINE_TASKS = `${METHOD_PREFIX}/ListBaselineTasks`;
export const METHOD_GET_BASELINE_TASK_STATUS = `${METHOD_PREFIX}/GetBaselineTaskStatus`;
export const METHOD_LIST_BASELINE_TASK_RESULTS = `${METHOD_PREFIX}/ListBaselineTaskResults`;

export const PATH_LIST_HOSTS = `/${METHOD_LIST_HOSTS}`;
export const PATH_GET_HOST = `/${METHOD_GET_HOST}`;
export const PATH_COUNT_HOSTS = `/${METHOD_COUNT_HOSTS}`;
export const PATH_LIST_AGENTS = `/${METHOD_LIST_AGENTS}`;
export const PATH_COUNT_AGENTS = `/${METHOD_COUNT_AGENTS}`;
export const PATH_LIST_DETECTIONS = `/${METHOD_LIST_DETECTIONS}`;
export const PATH_GET_DETECTION = `/${METHOD_GET_DETECTION}`;
export const PATH_LIST_RESPONSE_RESULTS = `/${METHOD_LIST_RESPONSE_RESULTS}`;
export const PATH_LIST_RESPONSE_HISTORY = `/${METHOD_LIST_RESPONSE_HISTORY}`;
export const PATH_GET_ELEMENT_OPERATION_INFOS = `/${METHOD_GET_ELEMENT_OPERATION_INFOS}`;
export const PATH_LIST_BASELINES = `/${METHOD_LIST_BASELINES}`;
export const PATH_GET_BASELINE = `/${METHOD_GET_BASELINE}`;
export const PATH_LIST_BASELINE_TASKS = `/${METHOD_LIST_BASELINE_TASKS}`;
export const PATH_GET_BASELINE_TASK_STATUS = `/${METHOD_GET_BASELINE_TASK_STATUS}`;
export const PATH_LIST_BASELINE_TASK_RESULTS = `/${METHOD_LIST_BASELINE_TASK_RESULTS}`;

export const DEFAULT_TIMEOUT_MS = 10000;
export const DEFAULT_PAGE_SIZE = 50;

const PREFIXES = {
  asset: "/oapi/com-qt-app-asset/service-asset",
  ids: "/oapi/com-qt-app-ids/service-ids",
  baseline: "/oapi/com-qt-app-baseline/service-baseline",
  agent: "/oapi/com-qt-os-agent/service-agent2",
};

const grpcCodeFor = (code) => ({
  INVALID_ARGUMENT: grpcStatus.INVALID_ARGUMENT,
  PERMISSION_DENIED: grpcStatus.PERMISSION_DENIED,
  NOT_FOUND: grpcStatus.NOT_FOUND,
  UNAVAILABLE: grpcStatus.UNAVAILABLE,
  UNKNOWN: grpcStatus.UNKNOWN,
})[code] ?? grpcStatus.UNKNOWN;

const errorWithCode = (code, message, details) => {
  const err = new GrpcError(grpcCodeFor(code), details === undefined ? String(message) : JSON.stringify({ code, message, ...details }));
  err.legacyCode = code;
  if (details !== undefined) err.details = details;
  return err;
};

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj ?? {}, key);
const firstDefined = (...values) => values.find((value) => value !== undefined && value !== null);
const unwrapScalar = (value) => {
  if (value === undefined || value === null) return "";
  if (typeof value === "object" && hasOwn(value, "value")) return unwrapScalar(value.value);
  return value;
};
const trimString = (value) => String(unwrapScalar(value) ?? "").trim();
const toArray = (value) => Array.isArray(value) ? value.filter((item) => item !== undefined && item !== null) : [];
const toInt = (value, fallback = 0) => {
  const num = Number(value);
  return Number.isFinite(num) ? Math.trunc(num) : fallback;
};
const toBool = (value, fallback = false) => {
  if (value === undefined || value === null) return fallback;
  if (typeof value === "boolean") return value;
  if (String(value).toLowerCase() === "true") return true;
  if (String(value).toLowerCase() === "false") return false;
  return fallback;
};

const stringifyJson = (value) => {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

const parseJsonSafe = (text) => {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, value: null };
  }
};

const toValue = (value) => {
  if (value === undefined) return undefined;
  if (value === null) return { nullValue: "NULL_VALUE" };
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "number") return Number.isFinite(value) ? { numberValue: value } : { stringValue: String(value) };
  if (typeof value === "boolean") return { boolValue: value };
  if (Array.isArray(value)) return { listValue: { values: value.map(toValue).filter((item) => item !== undefined) } };
  if (typeof value === "object") {
    const fields = {};
    for (const [key, item] of Object.entries(value)) {
      const mapped = toValue(item);
      if (mapped !== undefined) fields[key] = mapped;
    }
    return { structValue: { fields } };
  }
  return { stringValue: String(value) };
};

const fromStruct = (value) => {
  if (!value) return {};
  if (value.fields && typeof value.fields === "object") {
    const out = {};
    for (const [key, item] of Object.entries(value.fields)) out[key] = fromValue(item);
    return out;
  }
  if (typeof value === "object" && !hasOwn(value, "fields")) return value;
  return {};
};

const fromValue = (value) => {
  if (!value || typeof value !== "object") return value;
  if (hasOwn(value, "stringValue")) return value.stringValue;
  if (hasOwn(value, "numberValue")) return value.numberValue;
  if (hasOwn(value, "boolValue")) return value.boolValue;
  if (hasOwn(value, "nullValue")) return null;
  if (hasOwn(value, "structValue")) return fromStruct(value.structValue);
  if (hasOwn(value, "listValue")) return toArray(value.listValue?.values).map(fromValue);
  return value;
};

const rawEnvelope = (httpStatus, rawBody, json) => ({
  http_status: httpStatus,
  raw_body: rawBody,
  raw_json: toValue(json),
});

const normalizeBaseUrl = (value) => {
  const raw = trimString(value);
  if (!/^https?:\/\//i.test(raw)) return "";
  return raw.replace(/\/+$/, "");
};

const mergedBindings = (ctx = {}) => ({
  ...(ctx?.config ?? {}),
  ...(ctx?.secret ?? {}),
  ...(ctx?.bindings ?? {}),
});

const resolveCallContext = (ctx = {}) => ({
  ...ctx,
  bindings: mergedBindings(ctx),
  req: ctx.req ?? ctx.request ?? {},
  limits: ctx.limits ?? {},
});

const resolveBaseUrl = (bindings) => {
  for (const key of ["baseUrl", "base_url", "host", "endpoint"]) {
    const value = normalizeBaseUrl(bindings?.[key]);
    if (value) return value;
  }
  return "";
};

const resolveTimeoutMs = (ctx) => {
  const bindings = mergedBindings(ctx);
  const raw = Number(firstDefined(ctx?.limits?.timeoutMs, bindings.timeoutMs, bindings.timeout_ms, DEFAULT_TIMEOUT_MS));
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TIMEOUT_MS;
};

const requireBaseUrl = (bindings) => {
  const baseUrl = resolveBaseUrl(bindings);
  if (!baseUrl) throw errorWithCode("INVALID_ARGUMENT", "baseUrl is required in config");
  return baseUrl;
};

const requireToken = (bindings) => {
  const token = trimString(bindings?.token);
  if (!token) throw errorWithCode("INVALID_ARGUMENT", "token is required in secret");
  return token;
};

const shouldSkipTlsVerify = (bindings) =>
  bindings?.skipTlsVerify === true ||
  bindings?.tlsInsecureSkipVerify === true ||
  bindings?.insecureSkipVerify === true ||
  bindings?.verifyTLS === false;

const buildTlsOptions = (bindings) => {
  if (shouldSkipTlsVerify(bindings)) {
    return {
      skipTlsVerify: true,
      tlsInsecureSkipVerify: true,
      insecureSkipVerify: true,
    };
  }
  return {};
};

const joinUrl = (baseUrl, ...parts) => {
  const encoded = parts
    .flatMap((part) => String(part || "").split("/"))
    .filter(Boolean)
    .map((part) => encodeURIComponent(part));
  return `${baseUrl}/${encoded.join("/")}`;
};

const classifyHttpStatus = (status) => {
  if (status === 401 || status === 403) return "PERMISSION_DENIED";
  if (status === 404) return "NOT_FOUND";
  if (status >= 500) return "UNAVAILABLE";
  return "UNKNOWN";
};

const fetchJSON = async (ctx, app, path, { method = "POST", body } = {}) => {
  const bindings = mergedBindings(ctx);
  const baseUrl = requireBaseUrl(bindings);
  const token = requireToken(bindings);
  const url = `${baseUrl}${PREFIXES[app]}${path}`;
  const headers = {
    Accept: "application/json",
    "Content-Type": "application/json",
    ...(bindings.headers || {}),
    Authorization: `Bearer ${token}`,
  };
  const init = {
    method,
    headers,
    timeoutMs: resolveTimeoutMs(ctx),
    ...buildTlsOptions(bindings),
  };
  if (body !== undefined) init.body = stringifyJson(body);

  let response;
  let rawBody = "";
  const skipTlsVerify = shouldSkipTlsVerify(bindings);
  const processEnv = globalThis.process?.env;
  const hadRejectUnauthorized = Object.prototype.hasOwnProperty.call(processEnv ?? {}, "NODE_TLS_REJECT_UNAUTHORIZED");
  const previousRejectUnauthorized = processEnv?.NODE_TLS_REJECT_UNAUTHORIZED;
  try {
    if (skipTlsVerify && processEnv) processEnv.NODE_TLS_REJECT_UNAUTHORIZED = "0";
    response = await globalThis.fetch(url, init);
    rawBody = await response.text();
  } catch (err) {
    throw errorWithCode("UNAVAILABLE", "request to Qingteng HIDS failed", {
      http_status: 0,
      reason: err?.cause?.message || err?.message || "network_error",
      raw_body: rawBody,
    });
  } finally {
    if (skipTlsVerify && processEnv) {
      if (hadRejectUnauthorized) {
        processEnv.NODE_TLS_REJECT_UNAUTHORIZED = previousRejectUnauthorized;
      } else {
        delete processEnv.NODE_TLS_REJECT_UNAUTHORIZED;
      }
    }
  }

  const parsed = parseJsonSafe(rawBody || "null");
  if (!parsed.ok) {
    throw errorWithCode("UNKNOWN", "Qingteng HIDS returned non-JSON response", {
      http_status: response.status,
      reason: "invalid_json",
      raw_body: rawBody,
    });
  }
  if (!response.ok) {
    throw errorWithCode(classifyHttpStatus(response.status), "Qingteng HIDS returned HTTP error", {
      http_status: response.status,
      reason: "http_status_not_ok",
      raw_body: rawBody,
      raw_json: parsed.value,
    });
  }
  return { httpStatus: response.status, rawBody, json: parsed.value, url, init };
};

const requestPage = (req, fallbackSize = DEFAULT_PAGE_SIZE) => {
  const page = req.page ?? {};
  const pageNum = toInt(firstDefined(page.page, req.page_number, req.pageNumber, req.page), 0);
  const size = toInt(firstDefined(page.size, req.size), fallbackSize);
  const sort = toArray(firstDefined(page.sort, req.sort));
  return { page: pageNum, size: size > 0 ? size : fallbackSize, sort };
};

const mergeRawQuery = (query = {}) => {
  const out = {};
  if (query.raw_query_json || query.rawQueryJson) {
    const parsed = parseJsonSafe(query.raw_query_json || query.rawQueryJson);
    if (!parsed.ok || typeof parsed.value !== "object" || parsed.value === null || Array.isArray(parsed.value)) {
      throw errorWithCode("INVALID_ARGUMENT", "raw_query_json must be a JSON object");
    }
    Object.assign(out, parsed.value);
  }
  Object.assign(out, fromStruct(query.raw_query || query.rawQuery));
  return out;
};

const assignString = (out, key, value) => {
  const raw = trimString(value);
  if (raw) out[key] = raw;
};

const assignArray = (out, key, value) => {
  const arr = toArray(value);
  if (arr.length > 0) out[key] = arr;
};

const assignInt64 = (out, key, value) => {
  const raw = Number(value);
  if (Number.isFinite(raw) && raw !== 0) out[key] = Math.trunc(raw);
};

const hostQueryBody = (query = {}) => {
  const out = mergeRawQuery(query);
  assignString(out, "name_like", query.name_like ?? query.nameLike);
  assignString(out, "ip_like", query.ip_like ?? query.ipLike);
  assignArray(out, "ids", query.ids);
  assignString(out, "agent_id", query.agent_id ?? query.agentId);
  assignArray(out, "agent_ids", query.agent_ids ?? query.agentIds);
  assignArray(out, "agent_status", query.agent_status ?? query.agentStatus);
  assignArray(out, "group_ids", query.group_ids ?? query.groupIds);
  assignArray(out, "tag_ids", query.tag_ids ?? query.tagIds);
  assignArray(out, "os_types", query.os_types ?? query.osTypes);
  assignArray(out, "host_type", query.host_type ?? query.hostType);
  assignString(out, "kernel_version", query.kernel_version ?? query.kernelVersion);
  return out;
};

const agentQueryBody = (query = {}) => {
  const out = mergeRawQuery(query);
  assignString(out, "agent_id", query.agent_id ?? query.agentId);
  assignArray(out, "agent_ids", query.agent_ids ?? query.agentIds);
  assignArray(out, "status", query.status);
  assignString(out, "hostname", query.hostname);
  assignString(out, "ip", query.ip);
  assignArray(out, "version", query.version);
  assignArray(out, "run_mode", query.run_mode ?? query.runMode);
  assignArray(out, "run_level", query.run_level ?? query.runLevel);
  assignArray(out, "os_types", query.os_types ?? query.osTypes);
  assignArray(out, "os_arches", query.os_arches ?? query.osArches);
  assignString(out, "host_type", query.host_type ?? query.hostType);
  return out;
};

const detectionQueryBody = (query = {}) => {
  const out = mergeRawQuery(query);
  assignInt64(out, "start_time", query.start_time ?? query.startTime);
  assignInt64(out, "end_time", query.end_time ?? query.endTime);
  assignArray(out, "severities", query.severities);
  assignArray(out, "statuses", query.statuses);
  assignArray(out, "detection_types", query.detection_types ?? query.detectionTypes);
  assignString(out, "detection_title", query.detection_title ?? query.detectionTitle);
  assignArray(out, "tactics", query.tactics);
  assignArray(out, "techniques", query.techniques);
  assignArray(out, "element_types", query.element_types ?? query.elementTypes);
  assignString(out, "agent_id", query.agent_id ?? query.agentId);
  assignString(out, "host_ip", query.host_ip ?? query.hostIp);
  assignString(out, "hostname", query.hostname);
  assignArray(out, "group_ids", query.group_ids ?? query.groupIds);
  assignArray(out, "os_types", query.os_types ?? query.osTypes);
  assignString(out, "container_id", query.container_id ?? query.containerId);
  assignString(out, "container_name", query.container_name ?? query.containerName);
  assignString(out, "cluster_name", query.cluster_name ?? query.clusterName);
  assignString(out, "pod_name", query.pod_name ?? query.podName);
  assignString(out, "namespace", query.namespace);
  assignString(out, "detection_code", query.detection_code ?? query.detectionCode);
  assignString(out, "rule_id", query.rule_id ?? query.ruleId);
  assignString(out, "keyword", query.keyword);
  assignArray(out, "detection_ids", query.detection_ids ?? query.detectionIds);
  assignArray(out, "tag_ids", query.tag_ids ?? query.tagIds);
  assignArray(out, "detection_type_codes", query.detection_type_codes ?? query.detectionTypeCodes);
  return out;
};

const responseQueryBody = (query = {}) => {
  const out = mergeRawQuery(query);
  assignArray(out, "operation_methods", query.operation_methods ?? query.operationMethods);
  assignArray(out, "operation_types", query.operation_types ?? query.operationTypes);
  assignArray(out, "operation_statuses", query.operation_statuses ?? query.operationStatuses);
  assignString(out, "element_type", query.element_type ?? query.elementType);
  assignString(out, "host_ip", query.host_ip ?? query.hostIp);
  assignString(out, "hostname", query.hostname);
  assignArray(out, "group_ids", query.group_ids ?? query.groupIds);
  assignString(out, "operator", query.operator);
  assignInt64(out, "start_time", query.start_time ?? query.startTime);
  assignInt64(out, "end_time", query.end_time ?? query.endTime);
  assignArray(out, "element_ids", query.element_ids ?? query.elementIds);
  assignString(out, "detection_code", query.detection_code ?? query.detectionCode);
  assignString(out, "source", query.source);
  return out;
};

const baselineQueryBody = (query = {}) => {
  const out = mergeRawQuery(query);
  assignString(out, "name_like", query.name_like ?? query.nameLike);
  assignArray(out, "category_ids", query.category_ids ?? query.categoryIds);
  assignString(out, "platform_like", query.platform_like ?? query.platformLike);
  assignString(out, "app_name_like", query.app_name_like ?? query.appNameLike);
  if (query.is_builtin_set || query.isBuiltinSet) out.is_builtin = toBool(query.is_builtin ?? query.isBuiltin);
  return out;
};

const baselineTaskQueryBody = (query = {}) => {
  const out = mergeRawQuery(query);
  assignArray(out, "baseline_id", query.baseline_id ?? query.baselineId);
  assignString(out, "ip_like", query.ip_like ?? query.ipLike);
  assignString(out, "host_name_like", query.host_name_like ?? query.hostNameLike);
  assignString(out, "agent_id_like", query.agent_id_like ?? query.agentIdLike);
  assignString(out, "name_like", query.name_like ?? query.nameLike);
  assignArray(out, "category_ids", query.category_ids ?? query.categoryIds);
  return out;
};

const baselineResultQueryBody = (query = {}) => {
  const out = mergeRawQuery(query);
  assignArray(out, "check_ids", query.check_ids ?? query.checkIds);
  assignArray(out, "agent_ids", query.agent_ids ?? query.agentIds);
  assignArray(out, "code", query.code);
  assignArray(out, "flag", query.flag);
  return out;
};

const requestBody = (req, query, fallbackSize = DEFAULT_PAGE_SIZE) => ({
  ...requestPage(req, fallbackSize),
  query,
});

const rawItem = (item) => toValue(item ?? {});
const objectOrEmpty = (value) => value && typeof value === "object" && !Array.isArray(value) ? value : {};
const strings = (value) => toArray(value).map((item) => String(item));

const mapHost = (item = {}) => {
  const obj = objectOrEmpty(item);
  const group = objectOrEmpty(obj.group);
  const os = objectOrEmpty(obj.os);
  return {
    id: String(obj.id || ""),
    name: String(obj.name || ""),
    main_ip: String(obj.main_ip || ""),
    agent_id: String(obj.agent_id || ""),
    agent_status: String(obj.agent_status || ""),
    os_type: String(os.type || ""),
    os_arch: String(os.arch || ""),
    os_dist: String(os.dist || ""),
    os_version: String(os.version || ""),
    kernel_version: String(os.kernel_version || ""),
    group_id: String(group.id || ""),
    group_name: String(group.name || obj.group_relation_name || ""),
    location: String(obj.location || ""),
    charger_name: String(obj.charger_name || ""),
    charger_email: String(obj.charger_email || ""),
    internal_ips: strings(obj.internal_ips),
    external_ips: strings(obj.external_ips),
    first_seen: String(obj.first_seen || ""),
    last_seen: String(obj.last_seen || ""),
    last_online_at: String(obj.last_online_at || ""),
    last_offline_at: String(obj.last_offline_at || ""),
    agent_run_mode: String(obj.agent_run_mode || ""),
    agent_version: String(obj.agent_version || ""),
    host_type: String(obj.host_type || ""),
    run_level: String(obj.run_level || ""),
    client_ip: String(obj.client_ip || ""),
    raw_json: rawItem(obj),
  };
};

const mapAgent = (item = {}) => {
  const obj = objectOrEmpty(item);
  return {
    agent_id: String(obj.agent_id || ""),
    state: String(obj.state || obj.status || ""),
    run_mode: String(obj.run_mode || ""),
    hostname: String(obj.hostname || ""),
    ip: String(obj.ip || ""),
    version: String(obj.version || ""),
    run_level: String(obj.run_level || ""),
    log_level: String(obj.log_level || ""),
    created_at: String(obj.created_at || ""),
    last_online_at: String(obj.last_online_at || ""),
    last_offline_at: String(obj.last_offline_at || ""),
    last_offline_reason: String(obj.last_offline_reason || ""),
    driver_state: String(obj.driver_state || ""),
    driver_run_state: String(obj.driver_run_state || ""),
    os_type: String(obj.os_type || ""),
    os_dist: String(obj.os_dist || ""),
    os_version: String(obj.os_version || ""),
    os_arch: String(obj.os_arch || ""),
    mo_id: String(obj.mo_id || ""),
    connection_type: String(obj.connection_type || ""),
    connection_host: String(obj.connection_host || ""),
    proxy_ip: String(obj.proxy_ip || ""),
    license_status: String(obj.license_status || ""),
    host_type: String(obj.host_type || ""),
    raw_json: rawItem(obj),
  };
};

const mapDetection = (item = {}) => {
  const obj = objectOrEmpty(item);
  const base = objectOrEmpty(obj.base_info);
  const detail = objectOrEmpty(obj.detail_info);
  const response = objectOrEmpty(detail.detection_response_info);
  return {
    detection_id: String(base.detection_id || obj.detection_id || ""),
    detection_code: String(base.detection_code || obj.detection_code || ""),
    severity: String(base.severity || ""),
    status: String(base.status || ""),
    detection_type: String(base.detection_type || ""),
    detection_type_code: String(base.detection_type_code || ""),
    detection_title: String(base.detection_title || ""),
    detection_time: String(base.detection_time || ""),
    last_detection_time: String(base.last_detection_time || ""),
    host_ip: String(base.host_ip || ""),
    hostname: String(base.hostname || ""),
    agent_id: String(base.agent_id || ""),
    group_name: String(base.group_name || ""),
    container_id: String(base.container_id || ""),
    container_name: String(base.container_name || ""),
    cluster_id: String(base.cluster_id || ""),
    cluster_name: String(base.cluster_name || ""),
    namespace: String(base.namespace || ""),
    dup_count: toInt(base.dup_count, 0),
    handle_suggestion: String(detail.handle_suggestion || ""),
    action_desc: String(detail.action_desc || ""),
    operation_process_element_id: String(response.operation_process_element_id || ""),
    operation_file_element_id: String(response.operation_file_element_id || ""),
    raw_json: rawItem(obj),
  };
};

const mapResponseResult = (item = {}) => {
  const obj = objectOrEmpty(item);
  return {
    result_id: String(obj.result_id || obj.history_id || ""),
    element_id: String(obj.element_id || ""),
    element_type: String(obj.element_type || ""),
    agent_id: String(obj.agent_id || ""),
    host_id: String(obj.host_id || ""),
    host_ip: String(obj.host_ip || ""),
    hostname: String(obj.hostname || ""),
    group_name: String(obj.group_name || ""),
    operation_method: String(obj.operation_method || ""),
    operation_type: String(obj.operation_type || ""),
    operation_status: String(obj.operation_status || ""),
    operator: String(obj.operator || ""),
    reason: String(obj.reason || ""),
    error: String(obj.error || ""),
    create_time: String(obj.create_time || ""),
    detection_code: String(obj.detection_code || ""),
    detection_id: String(obj.detection_id || ""),
    source: String(obj.source || ""),
    raw_json: rawItem(obj),
  };
};

const mapBaseline = (item = {}) => {
  const obj = objectOrEmpty(item);
  return {
    uuid: String(obj.uuid || ""),
    name: String(obj.name || ""),
    category_id: String(obj.category_id || ""),
    category: String(obj.category || ""),
    cpu_arch: String(obj.cpu_arch || ""),
    active: Boolean(obj.active),
    created_at: String(obj.created_at || ""),
    updated_at: String(obj.updated_at || ""),
    check_item_ids: strings(obj.check_item_ids),
    raw_json: rawItem(obj),
  };
};

const mapBaselineTask = (item = {}) => {
  const obj = objectOrEmpty(item);
  return {
    task_id: String(obj.task_id || ""),
    name: String(obj.name || ""),
    baseline_name: strings(obj.baseline_name),
    passed: Number(obj.passed || 0),
    last_executed_at: String(obj.last_executed_at || ""),
    next_executed_at: String(obj.next_executed_at || ""),
    created_at: String(obj.created_at || ""),
    is_executing: Boolean(obj.is_executing),
    cron: String(obj.cron || ""),
    editable: Boolean(obj.editable),
    raw_json: rawItem(obj),
  };
};

const mapBaselineTaskStatus = (item = {}) => {
  const obj = objectOrEmpty(item);
  return {
    task_id: String(obj.task_id || ""),
    is_executing: Boolean(obj.is_executing),
    last_executed_at: String(obj.last_executed_at || ""),
    passed: Number(obj.passed || 0),
    next_executed_at: String(obj.next_executed_at || ""),
    task_status: String(obj.task_status || ""),
    task_status_description_key: String(obj.task_status_description_key || ""),
    last_execute_record_id: String(obj.last_execute_record_id || ""),
    raw_json: rawItem(obj),
  };
};

const mapBaselineTaskResult = (item = {}) => {
  const obj = objectOrEmpty(item);
  return {
    uuid: String(obj.uuid || ""),
    task_id: String(obj.task_id || ""),
    baseline_id: String(obj.baseline_id || ""),
    execute_record_id: String(obj.execute_record_id || ""),
    agent_id: String(obj.agent_id || ""),
    check_id: String(obj.check_id || ""),
    code: toInt(obj.code, 0),
    flag: toInt(obj.flag, 0),
    error: String(obj.error || ""),
    data: String(obj.data || ""),
    check_object_id: String(obj.check_object_id || ""),
    created_at: String(obj.created_at || ""),
    raw_json: rawItem(obj),
  };
};

const requireID = (name, value) => {
  const id = trimString(value);
  if (!id) throw errorWithCode("INVALID_ARGUMENT", `${name} is required`);
  return id;
};

const handleListHosts = async (ctx) => {
  const { req } = resolveCallContext(ctx);
  const query = hostQueryBody(req.query ?? {});
  const res = await fetchJSON(ctx, "asset", "/v1/hosts/list", { body: requestBody(req, query) });
  return {
    hosts: toArray(res.json?.data).map(mapHost),
    raw: rawEnvelope(res.httpStatus, res.rawBody, res.json),
  };
};

const handleGetHost = async (ctx) => {
  const { req } = resolveCallContext(ctx);
  const id = requireID("id", req.id);
  const res = await fetchJSON(ctx, "asset", joinUrl("", "/v1/hosts", id), { method: "GET" });
  return { host: mapHost(res.json), raw: rawEnvelope(res.httpStatus, res.rawBody, res.json) };
};

const handleCountHosts = async (ctx) => {
  const { req } = resolveCallContext(ctx);
  const res = await fetchJSON(ctx, "asset", "/v1/hosts/count", { body: { query: hostQueryBody(req.query ?? {}) } });
  return { total: toInt(res.json?.total, 0), raw: rawEnvelope(res.httpStatus, res.rawBody, res.json) };
};

const handleListAgents = async (ctx) => {
  const { req } = resolveCallContext(ctx);
  const body = requestBody(req, agentQueryBody(req.query ?? {}), 100);
  const selectFields = toArray(req.select_fields ?? req.selectFields);
  if (selectFields.length > 0) body.select_fields = selectFields;
  const res = await fetchJSON(ctx, "agent", "/v1/host-agent/agents/list", { body });
  return { agents: toArray(res.json?.data).map(mapAgent), raw: rawEnvelope(res.httpStatus, res.rawBody, res.json) };
};

const handleCountAgents = async (ctx) => {
  const { req } = resolveCallContext(ctx);
  const res = await fetchJSON(ctx, "agent", "/v1/host-agent/agents/count", { body: { query: agentQueryBody(req.query ?? {}) } });
  return { total: toInt(res.json?.total, 0), raw: rawEnvelope(res.httpStatus, res.rawBody, res.json) };
};

const handleListDetections = async (ctx) => {
  const { req } = resolveCallContext(ctx);
  const body = requestBody(req, detectionQueryBody(req.query ?? {}));
  body.show_detail = toBool(req.show_detail ?? req.showDetail);
  const res = await fetchJSON(ctx, "ids", "/v1/detections", { body });
  return {
    total: toInt(res.json?.total, 0),
    detections: toArray(res.json?.detections).map(mapDetection),
    raw: rawEnvelope(res.httpStatus, res.rawBody, res.json),
  };
};

const handleGetDetection = async (ctx) => {
  const { req } = resolveCallContext(ctx);
  const detectionID = trimString(req.detection_id ?? req.detectionId);
  const detectionCode = trimString(req.detection_code ?? req.detectionCode);
  if (!detectionID && !detectionCode) throw errorWithCode("INVALID_ARGUMENT", "detection_id or detection_code is required");
  const query = {};
  if (detectionID) query.detection_ids = [detectionID];
  if (detectionCode) query.detection_code = detectionCode;
  const body = { page: 0, size: 1, sort: ["-last_detection_time"], show_detail: true, query };
  const res = await fetchJSON(ctx, "ids", "/v1/detections", { body });
  const first = toArray(res.json?.detections)[0];
  if (!first) throw errorWithCode("NOT_FOUND", "detection not found", { http_status: res.httpStatus, raw_json: res.json });
  return { detection: mapDetection(first), raw: rawEnvelope(res.httpStatus, res.rawBody, res.json) };
};

const handleListResponseResults = async (ctx) => {
  const { req } = resolveCallContext(ctx);
  const res = await fetchJSON(ctx, "ids", "/v1/elements/operation/results", { body: requestBody(req, responseQueryBody(req.query ?? {})) });
  return { total: toInt(res.json?.total, 0), results: toArray(res.json?.data).map(mapResponseResult), raw: rawEnvelope(res.httpStatus, res.rawBody, res.json) };
};

const handleListResponseHistory = async (ctx) => {
  const { req } = resolveCallContext(ctx);
  const res = await fetchJSON(ctx, "ids", "/v1/elements/operation/history", { body: requestBody(req, responseQueryBody(req.query ?? {})) });
  return { total: toInt(res.json?.total, 0), history: toArray(res.json?.data).map(mapResponseResult), raw: rawEnvelope(res.httpStatus, res.rawBody, res.json) };
};

const handleGetElementOperationInfos = async (ctx) => {
  const { req } = resolveCallContext(ctx);
  const body = {
    element_ids: toArray(req.element_ids ?? req.elementIds),
    element_type: trimString(req.element_type ?? req.elementType),
    detection_code: trimString(req.detection_code ?? req.detectionCode),
    show_detail: toBool(req.show_detail ?? req.showDetail),
  };
  const res = await fetchJSON(ctx, "ids", "/v1/elements/operation/element-infos", { body });
  return { total: toInt(res.json?.total, 0), infos: toArray(res.json?.data).map(mapResponseResult), raw: rawEnvelope(res.httpStatus, res.rawBody, res.json) };
};

const handleListBaselines = async (ctx) => {
  const { req } = resolveCallContext(ctx);
  const res = await fetchJSON(ctx, "baseline", "/v1/baselines/list", { body: requestBody(req, baselineQueryBody(req.query ?? {})) });
  return { total: toInt(res.json?.total, 0), baselines: toArray(res.json?.data).map(mapBaseline), raw: rawEnvelope(res.httpStatus, res.rawBody, res.json) };
};

const handleGetBaseline = async (ctx) => {
  const { req } = resolveCallContext(ctx);
  const id = requireID("baseline_id", req.baseline_id ?? req.baselineId);
  const res = await fetchJSON(ctx, "baseline", joinUrl("", "/v1/baselines", id), { method: "GET" });
  return { baseline: mapBaseline(res.json), raw: rawEnvelope(res.httpStatus, res.rawBody, res.json) };
};

const handleListBaselineTasks = async (ctx) => {
  const { req } = resolveCallContext(ctx);
  const res = await fetchJSON(ctx, "baseline", "/v1/tasks/list", { body: requestBody(req, baselineTaskQueryBody(req.query ?? {})) });
  return { tasks: toArray(res.json?.baseline_task).map(mapBaselineTask), raw: rawEnvelope(res.httpStatus, res.rawBody, res.json) };
};

const handleGetBaselineTaskStatus = async (ctx) => {
  const { req } = resolveCallContext(ctx);
  const id = requireID("task_id", req.task_id ?? req.taskId);
  const res = await fetchJSON(ctx, "baseline", joinUrl("", "/v1/tasks", id, "status"), { method: "GET" });
  return { statuses: toArray(res.json?.task_status).map(mapBaselineTaskStatus), raw: rawEnvelope(res.httpStatus, res.rawBody, res.json) };
};

const handleListBaselineTaskResults = async (ctx) => {
  const { req } = resolveCallContext(ctx);
  const taskID = requireID("task_id", req.task_id ?? req.taskId);
  const baselineID = requireID("baseline_id", req.baseline_id ?? req.baselineId);
  const res = await fetchJSON(ctx, "baseline", joinUrl("", "/v1/tasks", taskID, "results", baselineID, "list"), {
    body: requestBody(req, baselineResultQueryBody(req.query ?? {})),
  });
  return { results: toArray(res.json?.results).map(mapBaselineTaskResult), raw: rawEnvelope(res.httpStatus, res.rawBody, res.json) };
};

export const handlers = {
  [METHOD_LIST_HOSTS]: handleListHosts,
  [METHOD_GET_HOST]: handleGetHost,
  [METHOD_COUNT_HOSTS]: handleCountHosts,
  [METHOD_LIST_AGENTS]: handleListAgents,
  [METHOD_COUNT_AGENTS]: handleCountAgents,
  [METHOD_LIST_DETECTIONS]: handleListDetections,
  [METHOD_GET_DETECTION]: handleGetDetection,
  [METHOD_LIST_RESPONSE_RESULTS]: handleListResponseResults,
  [METHOD_LIST_RESPONSE_HISTORY]: handleListResponseHistory,
  [METHOD_GET_ELEMENT_OPERATION_INFOS]: handleGetElementOperationInfos,
  [METHOD_LIST_BASELINES]: handleListBaselines,
  [METHOD_GET_BASELINE]: handleGetBaseline,
  [METHOD_LIST_BASELINE_TASKS]: handleListBaselineTasks,
  [METHOD_GET_BASELINE_TASK_STATUS]: handleGetBaselineTaskStatus,
  [METHOD_LIST_BASELINE_TASK_RESULTS]: handleListBaselineTaskResults,
};

export const rpcdef = (ctx) => {
  const resolved = resolveCallContext(ctx);
  return {
    [PATH_LIST_HOSTS]: () => handleListHosts(resolved),
    [PATH_GET_HOST]: () => handleGetHost(resolved),
    [PATH_COUNT_HOSTS]: () => handleCountHosts(resolved),
    [PATH_LIST_AGENTS]: () => handleListAgents(resolved),
    [PATH_COUNT_AGENTS]: () => handleCountAgents(resolved),
    [PATH_LIST_DETECTIONS]: () => handleListDetections(resolved),
    [PATH_GET_DETECTION]: () => handleGetDetection(resolved),
    [PATH_LIST_RESPONSE_RESULTS]: () => handleListResponseResults(resolved),
    [PATH_LIST_RESPONSE_HISTORY]: () => handleListResponseHistory(resolved),
    [PATH_GET_ELEMENT_OPERATION_INFOS]: () => handleGetElementOperationInfos(resolved),
    [PATH_LIST_BASELINES]: () => handleListBaselines(resolved),
    [PATH_GET_BASELINE]: () => handleGetBaseline(resolved),
    [PATH_LIST_BASELINE_TASKS]: () => handleListBaselineTasks(resolved),
    [PATH_GET_BASELINE_TASK_STATUS]: () => handleGetBaselineTaskStatus(resolved),
    [PATH_LIST_BASELINE_TASK_RESULTS]: () => handleListBaselineTaskResults(resolved),
  };
};

export const _test = {
  agentQueryBody,
  baselineQueryBody,
  baselineResultQueryBody,
  baselineTaskQueryBody,
  buildTlsOptions,
  classifyHttpStatus,
  detectionQueryBody,
  fetchJSON,
  fromStruct,
  fromValue,
  hostQueryBody,
  joinUrl,
  mapAgent,
  mapBaseline,
  mapBaselineTask,
  mapBaselineTaskResult,
  mapBaselineTaskStatus,
  mapDetection,
  mapHost,
  mapResponseResult,
  mergeRawQuery,
  normalizeBaseUrl,
  parseJsonSafe,
  rawEnvelope,
  requestBody,
  requestPage,
  resolveBaseUrl,
  resolveCallContext,
  resolveTimeoutMs,
  responseQueryBody,
  stringifyJson,
  toValue,
};

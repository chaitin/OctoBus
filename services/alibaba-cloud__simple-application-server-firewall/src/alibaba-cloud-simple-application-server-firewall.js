import AlibabaCloudSWAS from '@alicloud/swas-open20200601';
import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';

const Client = AlibabaCloudSWAS.default ?? AlibabaCloudSWAS;

export const METHOD_CREATE_FIREWALL_RULE = 'AlibabaCloud_SWAS_Firewall.SimpleApplicationServerFirewallService/CreateFirewallRule';
export const METHOD_CREATE_FIREWALL_RULES = 'AlibabaCloud_SWAS_Firewall.SimpleApplicationServerFirewallService/CreateFirewallRules';
export const METHOD_LIST_FIREWALL_RULES = 'AlibabaCloud_SWAS_Firewall.SimpleApplicationServerFirewallService/ListFirewallRules';
export const METHOD_MODIFY_FIREWALL_RULE = 'AlibabaCloud_SWAS_Firewall.SimpleApplicationServerFirewallService/ModifyFirewallRule';
export const METHOD_DELETE_FIREWALL_RULE = 'AlibabaCloud_SWAS_Firewall.SimpleApplicationServerFirewallService/DeleteFirewallRule';
export const METHOD_DELETE_FIREWALL_RULES = 'AlibabaCloud_SWAS_Firewall.SimpleApplicationServerFirewallService/DeleteFirewallRules';
export const METHOD_ENABLE_FIREWALL_RULE = 'AlibabaCloud_SWAS_Firewall.SimpleApplicationServerFirewallService/EnableFirewallRule';
export const METHOD_DISABLE_FIREWALL_RULE = 'AlibabaCloud_SWAS_Firewall.SimpleApplicationServerFirewallService/DisableFirewallRule';

export const CREATE_FIREWALL_RULE_PATH = `/${METHOD_CREATE_FIREWALL_RULE}`;
export const CREATE_FIREWALL_RULES_PATH = `/${METHOD_CREATE_FIREWALL_RULES}`;
export const LIST_FIREWALL_RULES_PATH = `/${METHOD_LIST_FIREWALL_RULES}`;
export const MODIFY_FIREWALL_RULE_PATH = `/${METHOD_MODIFY_FIREWALL_RULE}`;
export const DELETE_FIREWALL_RULE_PATH = `/${METHOD_DELETE_FIREWALL_RULE}`;
export const DELETE_FIREWALL_RULES_PATH = `/${METHOD_DELETE_FIREWALL_RULES}`;
export const ENABLE_FIREWALL_RULE_PATH = `/${METHOD_ENABLE_FIREWALL_RULE}`;
export const DISABLE_FIREWALL_RULE_PATH = `/${METHOD_DISABLE_FIREWALL_RULE}`;

export const DEFAULT_TIMEOUT_MS = 10_000;

const grpcCodeFor = (code) => ({
  INVALID_ARGUMENT: grpcStatus.INVALID_ARGUMENT,
  PERMISSION_DENIED: grpcStatus.PERMISSION_DENIED,
  FAILED_PRECONDITION: grpcStatus.FAILED_PRECONDITION,
  DEADLINE_EXCEEDED: grpcStatus.DEADLINE_EXCEEDED,
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
  if (value === undefined || value === null) return '';
  if (typeof value === 'object' && value !== null && hasOwn(value, 'value')) return unwrapScalar(value.value);
  return String(value);
};

const trimString = (value) => unwrapScalar(value).trim();

const compactObject = (obj) => {
  const out = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined && value !== null && value !== '') out[key] = value;
  }
  return out;
};

const toInt = (value, fallback = 0) => {
  const num = Number(value);
  if (!Number.isFinite(num) || Number.isNaN(num)) return fallback;
  return Math.trunc(num);
};

const toPositiveInt = (value, field, fallback = 0) => {
  if (value === undefined || value === null || value === '') return fallback;
  const num = Number(value);
  if (!Number.isInteger(num) || num <= 0) throw errorWithCode('INVALID_ARGUMENT', `${field} must be a positive integer`);
  return num;
};

const toValue = (value) => {
  if (value === undefined) return undefined;
  if (value === null) return { nullValue: 'NULL_VALUE' };
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'number') return Number.isFinite(value) ? { numberValue: value } : { stringValue: String(value) };
  if (typeof value === 'boolean') return { boolValue: value };
  if (Array.isArray(value)) return { listValue: { values: value.map((item) => toValue(item)).filter((item) => item !== undefined) } };
  if (typeof value === 'object') {
    const fields = {};
    for (const [key, item] of Object.entries(value)) {
      const mapped = toValue(item);
      if (mapped !== undefined) fields[key] = mapped;
    }
    return { structValue: { fields } };
  }
  return { stringValue: String(value) };
};

const rawBody = (response) => response?.body ?? {};

const normalizeRuleProtocol = (value) => {
  const protocol = trimString(value).toUpperCase();
  if (!['TCP', 'UDP', 'TCP+UDP', 'ICMP'].includes(protocol)) {
    throw errorWithCode('INVALID_ARGUMENT', 'rule_protocol must be TCP, UDP, TCP+UDP, or ICMP');
  }
  return protocol;
};

const requirePort = (value, protocol) => {
  const port = trimString(value);
  if (!port) throw errorWithCode('INVALID_ARGUMENT', 'port is required');
  if (protocol === 'ICMP') {
    if (port !== '-1/-1' && port !== '-1') throw errorWithCode('INVALID_ARGUMENT', 'ICMP firewall rule port must be -1/-1');
    return '-1/-1';
  }
  const match = port.match(/^(\d+)(?:\/(\d+))?$/);
  if (!match) throw errorWithCode('INVALID_ARGUMENT', 'port must be a number or start/end range');
  const start = Number(match[1]);
  const end = Number(match[2] ?? match[1]);
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start || end > 65535) {
    throw errorWithCode('INVALID_ARGUMENT', 'port must be between 1 and 65535');
  }
  return match[2] ? `${start}/${end}` : String(start);
};

const requireNonEmpty = (value, field) => {
  const out = trimString(value);
  if (!out) throw errorWithCode('INVALID_ARGUMENT', `${field} is required`);
  return out;
};

const optionalString = (value) => {
  const out = trimString(value);
  return out || undefined;
};

const mergeBindings = (ctx = {}) => ({
  ...(ctx.config ?? {}),
  ...(ctx.secret ?? {}),
  ...(ctx.bindings ?? {}),
});

const resolveContext = (ctx = {}) => ({
  ...ctx,
  req: ctx.req ?? ctx.request ?? {},
  bindings: mergeBindings(ctx),
});

const resolveRegionId = (ctx, req) => optionalString(firstDefined(req.region_id, req.regionId, ctx.bindings.regionId, ctx.bindings.region_id));

const resolveInstanceId = (ctx, req) => optionalString(firstDefined(req.instance_id, req.instanceId, ctx.bindings.instanceId, ctx.bindings.instance_id));

const requireRegionId = (ctx, req) => requireNonEmpty(resolveRegionId(ctx, req), 'region_id');

const requireInstanceId = (ctx, req) => requireNonEmpty(resolveInstanceId(ctx, req), 'instance_id');

const resolveTimeoutMs = (ctx) => {
  const raw = Number(firstDefined(ctx.limits?.timeoutMs, ctx.bindings.timeoutMs, ctx.bindings.timeout_ms, DEFAULT_TIMEOUT_MS));
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TIMEOUT_MS;
};

const resolveCredentials = (ctx) => {
  const accessKeyId = optionalString(firstDefined(ctx.bindings.accessKeyId, ctx.bindings.access_key_id, ctx.bindings.ak));
  const accessKeySecret = optionalString(firstDefined(ctx.bindings.accessKeySecret, ctx.bindings.access_key_secret, ctx.bindings.sk));
  const securityToken = optionalString(firstDefined(ctx.bindings.securityToken, ctx.bindings.security_token));
  if (!accessKeyId) throw errorWithCode('INVALID_ARGUMENT', 'accessKeyId is required in secret');
  if (!accessKeySecret) throw errorWithCode('INVALID_ARGUMENT', 'accessKeySecret is required in secret');
  return compactObject({ accessKeyId, accessKeySecret, securityToken });
};

export const createClient = (ctx) => {
  const credentials = resolveCredentials(ctx);
  const regionId = optionalString(firstDefined(ctx.bindings.regionId, ctx.bindings.region_id));
  const endpoint = optionalString(ctx.bindings.endpoint) || (regionId ? `swas.${regionId}.aliyuncs.com` : undefined);
  return new Client(compactObject({ ...credentials, endpoint, regionId }));
};

const runtimeOptions = (ctx) => {
  const timeout = resolveTimeoutMs(ctx);
  return {
    readTimeout: timeout,
    connectTimeout: timeout,
  };
};

const classifyAlibabaError = (err) => {
  const status = Number(err?.statusCode ?? err?.code);
  const code = String(err?.code ?? err?.name ?? '');
  if (status === 401 || status === 403 || /Forbidden|Unauthorized|AccessDenied/i.test(code)) return 'PERMISSION_DENIED';
  if (status === 400 || /Invalid|Missing|Unsupported|NotFound|Conflict|Quota/i.test(code)) return 'FAILED_PRECONDITION';
  if (status === 408 || /Timeout/i.test(code)) return 'DEADLINE_EXCEEDED';
  if (status >= 500) return 'UNAVAILABLE';
  return 'UNKNOWN';
};

const safeAlibabaMessage = (method, err) => {
  const code = err?.code ? `${err.code}: ` : '';
  const message = err?.description || err?.message || `${method} failed`;
  if (typeof message !== 'string') return `${code}${method} failed`;
  return `${code}${message.replace(/https?:\/\/\S+/g, '[REDACTED_URL]')}`;
};

const requestClassName = (method) => {
  const base = method.replace(/WithOptions$/, '');
  return `${base.charAt(0).toUpperCase()}${base.slice(1)}Request`;
};

const makeSDKRequest = (method, request) => {
  const RequestClass = AlibabaCloudSWAS[requestClassName(method)] ?? AlibabaCloudSWAS.default?.[requestClassName(method)];
  if (!RequestClass) return request;
  return new RequestClass(request);
};

const callAlibaba = async (ctx, method, request) => {
  const client = typeof ctx.clientFactory === 'function' ? ctx.clientFactory(ctx) : createClient(ctx);
  try {
    return await client[method](makeSDKRequest(method, request), runtimeOptions(ctx));
  } catch (err) {
    throw errorWithCode(classifyAlibabaError(err), safeAlibabaMessage(method, err), {
      aliyun_code: err?.code,
      request_id: err?.requestId ?? err?.data?.RequestId,
      status_code: err?.statusCode,
    });
  }
};

const requestScope = (ctx, req) => ({
  regionId: requireRegionId(ctx, req),
  instanceId: requireInstanceId(ctx, req),
});

const normalizeRuleInput = (input, field = 'firewall_rules') => {
  const protocol = normalizeRuleProtocol(firstDefined(input.rule_protocol, input.ruleProtocol));
  const port = requirePort(firstDefined(input.port, input.port_rule, input.portRule), protocol);
  const sourceCidrIp = optionalString(firstDefined(input.source_cidr_ip, input.sourceCidrIp));
  const remark = optionalString(input.remark);
  return compactObject({
    ruleProtocol: protocol,
    port,
    sourceCidrIp,
    remark,
  });
};

const normalizeTags = (tags) => {
  if (!Array.isArray(tags)) return undefined;
  return tags
    .map((tag) => compactObject({ key: optionalString(firstDefined(tag.key, tag.Key)), value: optionalString(firstDefined(tag.value, tag.Value)) }))
    .filter((tag) => tag.key);
};

const ruleIdFromRequest = (req) => requireNonEmpty(firstDefined(req.rule_id, req.ruleId, req.firewall_rule_id, req.firewallRuleId), 'rule_id');

const normalizeFirewallRule = (rule) => {
  const id = trimString(firstDefined(rule?.firewallRuleId, rule?.FirewallRuleId, rule?.firewallId, rule?.FirewallId, rule?.ruleId, rule?.RuleId));
  return {
    firewall_rule_id: id,
    rule_id: id,
    firewall_id: trimString(firstDefined(rule?.firewallId, rule?.FirewallId)),
    rule_protocol: trimString(firstDefined(rule?.ruleProtocol, rule?.RuleProtocol)),
    port: trimString(firstDefined(rule?.port, rule?.Port)),
    source_cidr_ip: trimString(firstDefined(rule?.sourceCidrIp, rule?.SourceCidrIp)),
    remark: trimString(firstDefined(rule?.remark, rule?.Remark)),
    status: trimString(firstDefined(rule?.status, rule?.Status)),
    policy: trimString(firstDefined(rule?.policy, rule?.Policy)),
    tags: normalizeTags(firstDefined(rule?.tags, rule?.Tags)) ?? [],
    raw_json: undefined,
  };
};

const baseResponse = (response) => {
  const body = rawBody(response);
  return {
    success: true,
    request_id: trimString(firstDefined(body.requestId, body.RequestId)),
    raw_json: undefined,
  };
};

const createFirewallRule = async (ctx) => {
  const c = resolveContext(ctx);
  const req = c.req;
  const rule = normalizeRuleInput(req);
  const request = compactObject({
    ...requestScope(c, req),
    firewallRules: [rule],
    clientToken: optionalString(firstDefined(req.client_token, req.clientToken)),
  });
  const response = await callAlibaba(c, 'createFirewallRulesWithOptions', request);
  const body = rawBody(response);
  const ids = Array.isArray(body.firewallRuleIds) ? body.firewallRuleIds : [];
  return {
    ...baseResponse(response),
    firewall_rule_id: trimString(firstDefined(ids[0], body.firewallId, body.firewallRuleId)),
    firewall_rule_ids: ids.map(String),
  };
};

const createFirewallRules = async (ctx) => {
  const c = resolveContext(ctx);
  const req = c.req;
  const rules = Array.isArray(firstDefined(req.firewall_rules, req.firewallRules)) ? firstDefined(req.firewall_rules, req.firewallRules) : [];
  if (rules.length === 0) throw errorWithCode('INVALID_ARGUMENT', 'firewall_rules must contain at least one rule');
  const request = compactObject({
    ...requestScope(c, req),
    firewallRules: rules.map((rule) => normalizeRuleInput(rule, 'firewall_rules')),
    clientToken: optionalString(firstDefined(req.client_token, req.clientToken)),
    tag: normalizeTags(req.tags ?? req.tag),
  });
  const response = await callAlibaba(c, 'createFirewallRulesWithOptions', request);
  const ids = Array.isArray(rawBody(response).firewallRuleIds) ? rawBody(response).firewallRuleIds : [];
  return {
    ...baseResponse(response),
    firewall_rule_ids: ids.map(String),
  };
};

const listFirewallRules = async (ctx) => {
  const c = resolveContext(ctx);
  const req = c.req;
  const request = compactObject({
    ...requestScope(c, req),
    firewallRuleId: optionalString(firstDefined(req.firewall_rule_id, req.firewallRuleId, req.rule_id, req.ruleId)),
    pageNumber: toPositiveInt(firstDefined(req.page_number, req.pageNumber), 'page_number', 1),
    pageSize: toPositiveInt(firstDefined(req.page_size, req.pageSize), 'page_size', undefined),
    tag: normalizeTags(req.tags ?? req.tag),
  });
  const response = await callAlibaba(c, 'listFirewallRulesWithOptions', request);
  const body = rawBody(response);
  return {
    ...baseResponse(response),
    page_number: toInt(firstDefined(body.pageNumber, body.PageNumber)),
    page_size: toInt(firstDefined(body.pageSize, body.PageSize)),
    total_count: toInt(firstDefined(body.totalCount, body.TotalCount)),
    firewall_rules: (Array.isArray(body.firewallRules) ? body.firewallRules : []).map(normalizeFirewallRule),
  };
};

const modifyFirewallRule = async (ctx) => {
  const c = resolveContext(ctx);
  const req = c.req;
  const protocol = normalizeRuleProtocol(firstDefined(req.rule_protocol, req.ruleProtocol));
  const request = compactObject({
    ...requestScope(c, req),
    ruleId: ruleIdFromRequest(req),
    ruleProtocol: protocol,
    port: requirePort(firstDefined(req.port, req.port_rule, req.portRule), protocol),
    sourceCidrIp: optionalString(firstDefined(req.source_cidr_ip, req.sourceCidrIp)),
    remark: optionalString(req.remark),
    clientToken: optionalString(firstDefined(req.client_token, req.clientToken)),
  });
  const response = await callAlibaba(c, 'modifyFirewallRuleWithOptions', request);
  return baseResponse(response);
};

const deleteFirewallRule = async (ctx) => {
  const c = resolveContext(ctx);
  const req = c.req;
  const request = compactObject({
    ...requestScope(c, req),
    ruleId: ruleIdFromRequest(req),
    clientToken: optionalString(firstDefined(req.client_token, req.clientToken)),
  });
  const response = await callAlibaba(c, 'deleteFirewallRuleWithOptions', request);
  return baseResponse(response);
};

const deleteFirewallRules = async (ctx) => {
  const c = resolveContext(ctx);
  const req = c.req;
  const ruleIds = firstDefined(req.rule_ids, req.ruleIds, req.firewall_rule_ids, req.firewallRuleIds);
  if (!Array.isArray(ruleIds) || ruleIds.length === 0) throw errorWithCode('INVALID_ARGUMENT', 'rule_ids must contain at least one rule ID');
  const request = compactObject({
    ...requestScope(c, req),
    ruleIds: ruleIds.map((id) => requireNonEmpty(id, 'rule_ids')),
    clientToken: optionalString(firstDefined(req.client_token, req.clientToken)),
  });
  const response = await callAlibaba(c, 'deleteFirewallRulesWithOptions', request);
  return baseResponse(response);
};

const enableFirewallRule = async (ctx) => {
  const c = resolveContext(ctx);
  const req = c.req;
  const request = compactObject({
    ...requestScope(c, req),
    ruleId: ruleIdFromRequest(req),
    sourceCidrIp: optionalString(firstDefined(req.source_cidr_ip, req.sourceCidrIp)),
    remark: optionalString(req.remark),
    clientToken: optionalString(firstDefined(req.client_token, req.clientToken)),
  });
  const response = await callAlibaba(c, 'enableFirewallRuleWithOptions', request);
  return baseResponse(response);
};

const disableFirewallRule = async (ctx) => {
  const c = resolveContext(ctx);
  const req = c.req;
  const request = compactObject({
    ...requestScope(c, req),
    ruleId: ruleIdFromRequest(req),
    remark: optionalString(req.remark),
    clientToken: optionalString(firstDefined(req.client_token, req.clientToken)),
  });
  const response = await callAlibaba(c, 'disableFirewallRuleWithOptions', request);
  return baseResponse(response);
};

export const handlers = {
  [METHOD_CREATE_FIREWALL_RULE]: createFirewallRule,
  [METHOD_CREATE_FIREWALL_RULES]: createFirewallRules,
  [METHOD_LIST_FIREWALL_RULES]: listFirewallRules,
  [METHOD_MODIFY_FIREWALL_RULE]: modifyFirewallRule,
  [METHOD_DELETE_FIREWALL_RULE]: deleteFirewallRule,
  [METHOD_DELETE_FIREWALL_RULES]: deleteFirewallRules,
  [METHOD_ENABLE_FIREWALL_RULE]: enableFirewallRule,
  [METHOD_DISABLE_FIREWALL_RULE]: disableFirewallRule,
};

export const rpcdef = (ctx = {}) => ({
  [CREATE_FIREWALL_RULE_PATH]: () => createFirewallRule(ctx),
  [CREATE_FIREWALL_RULES_PATH]: () => createFirewallRules(ctx),
  [LIST_FIREWALL_RULES_PATH]: () => listFirewallRules(ctx),
  [MODIFY_FIREWALL_RULE_PATH]: () => modifyFirewallRule(ctx),
  [DELETE_FIREWALL_RULE_PATH]: () => deleteFirewallRule(ctx),
  [DELETE_FIREWALL_RULES_PATH]: () => deleteFirewallRules(ctx),
  [ENABLE_FIREWALL_RULE_PATH]: () => enableFirewallRule(ctx),
  [DISABLE_FIREWALL_RULE_PATH]: () => disableFirewallRule(ctx),
});

export const _test = {
  classifyAlibabaError,
  compactObject,
  normalizeFirewallRule,
  normalizeRuleInput,
  normalizeRuleProtocol,
  requirePort,
  resolveTimeoutMs,
  safeAlibabaMessage,
  toInt,
  toPositiveInt,
  toValue,
};

import { createHash } from 'node:crypto';

import {
  GrpcError,
  createTlsDispatcher,
  grpcCodeFor,
  normalizeTimeoutMs,
} from '@chaitin-ai/octobus-sdk';

// Keep every capability under the original public Feishu Service FQN. The
// package is one Service; capsets select which methods an Instance exposes.
const PREFIX = 'Feishu_GroupRobot.Feishu_GroupRobot';
export const OPEN_API_METHODS = {
  CHECK_CONNECTIVITY: `${PREFIX}/CheckConnectivity`,
  GET_APPROVAL_DEFINITION: `${PREFIX}/GetApprovalDefinition`,
  LIST_APPROVAL_INSTANCE_CODES: `${PREFIX}/ListApprovalInstanceCodes`,
  GET_APPROVAL_INSTANCE: `${PREFIX}/GetApprovalInstance`,
  CREATE_APPROVAL_INSTANCE: `${PREFIX}/CreateApprovalInstance`,
  CANCEL_APPROVAL_INSTANCE: `${PREFIX}/CancelApprovalInstance`,
  SEND_APPROVAL_BOT_MESSAGE: `${PREFIX}/SendApprovalBotMessage`,
  GET_USER: `${PREFIX}/GetUser`,
  GET_DEPARTMENT: `${PREFIX}/GetDepartment`,
};

const DEFAULT_BASE_URL = 'https://open.feishu.cn';
const DEFAULT_TIMEOUT_MS = 5_000;
const TOKEN_REFRESH_SKEW_SECONDS = 180;
const tokenCache = new Map();
const insecureTlsDispatcher = createTlsDispatcher(true);
const USER_ID_TYPES = ['open_id', 'union_id', 'user_id'];
const LOCALES = [
  'zh-CN',
  'en-US',
  'ja-JP',
  'zh-HK',
  'zh-TW',
  'de-DE',
  'es-ES',
  'fr-FR',
  'id-ID',
  'it-IT',
  'ko-KR',
  'pt-BR',
  'th-TH',
  'vi-VN',
  'ms-MY',
  'ru-RU',
];

const errorWithCode = (code, message) => {
  const error = new GrpcError(grpcCodeFor(code), message);
  error.legacyCode = code;
  return error;
};

const sanitizeUpstreamMessage = (value) => asString(value)
  .replace(/(tenant_access_token|app_secret|authorization|token)\s*[:=]\s*[^\s,;]+/gi, '$1=***')
  .slice(0, 240);

const isTimeoutError = (cause) => cause?.name === 'TimeoutError'
  || cause?.name === 'AbortError'
  || cause?.cause?.name === 'TimeoutError'
  || cause?.code === 'ABORT_ERR';

const asString = (value) => String(value ?? '').trim();
const tokenCacheKey = (settings) => {
  const secretFingerprint = createHash('sha256').update(settings.appSecret).digest('hex');
  return `${settings.baseUrl}\u0000${settings.appId}\u0000${secretFingerprint}`;
};
const requiredString = (value, field, maxLength = 512) => {
  const text = asString(value);
  if (!text) throw errorWithCode('INVALID_ARGUMENT', `${field} is required`);
  if (text.length > maxLength) {
    throw errorWithCode('INVALID_ARGUMENT', `${field} exceeds ${maxLength} characters`);
  }
  return text;
};

const enumValue = (value, field, allowed, fallback) => {
  const text = asString(value) || fallback;
  if (!allowed.includes(text)) {
    throw errorWithCode('INVALID_ARGUMENT', `${field} must be one of ${allowed.join(', ')}`);
  }
  return text;
};

const optionalEnumValue = (value, field, allowed) => {
  const text = asString(value);
  return text ? enumValue(text, field, allowed, text) : undefined;
};

const operationId = (request) => requiredString(
  request.operation_id ?? request.operationId,
  'operation_id',
  64,
);

const normalizeBaseUrl = (value, allowInsecureHttp) => {
  let url;
  try {
    url = new URL(asString(value) || DEFAULT_BASE_URL);
  } catch {
    throw errorWithCode('INVALID_ARGUMENT', 'baseUrl must be a valid URL');
  }
  if (url.protocol !== 'https:' && !(allowInsecureHttp && url.protocol === 'http:')) {
    throw errorWithCode(
      'INVALID_ARGUMENT',
      'baseUrl must use HTTPS; HTTP is allowed only for a controlled mock',
    );
  }
  url.pathname = url.pathname.replace(/\/+$/, '');
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/$/, '');
};

const resolveSettings = (ctx = {}) => ({
  baseUrl: normalizeBaseUrl(
    ctx.config?.baseUrl ?? ctx.bindings?.baseUrl,
    (ctx.config?.allowInsecureHttp ?? ctx.bindings?.allowInsecureHttp) === true,
  ),
  timeoutMs: normalizeTimeoutMs(
    ctx.config?.timeoutMs ?? ctx.bindings?.timeoutMs ?? ctx.limits?.timeoutMs,
    DEFAULT_TIMEOUT_MS,
  ),
  headers: (ctx.config?.headers ?? ctx.bindings?.headers) ?? {},
  dispatcher: (ctx.config?.skipTlsVerify
    ?? ctx.config?.tlsInsecureSkipVerify
    ?? ctx.config?.insecureSkipVerify
    ?? ctx.bindings?.skipTlsVerify
    ?? ctx.bindings?.tlsInsecureSkipVerify
    ?? ctx.bindings?.insecureSkipVerify) === true
    ? insecureTlsDispatcher
    : undefined,
  appId: requiredString(ctx.secret?.appId, 'appId'),
  appSecret: requiredString(ctx.secret?.appSecret, 'appSecret'),
  fetchImpl: ctx.fetchImpl ?? globalThis.fetch,
});

const mapErrorCode = (status, upstreamCode) => {
  const code = Number(upstreamCode);
  if (status === 401 || [99991663, 99991668, 99991671].includes(code)) return 'UNAUTHENTICATED';
  if (status === 403 || [40004, 40014, 99991661, 99991672].includes(code)) return 'PERMISSION_DENIED';
  if (status === 429 || [99991400, 230020].includes(code)) return 'RESOURCE_EXHAUSTED';
  if (status === 404 || [1390002, 1390003, 40015].includes(code)) return 'NOT_FOUND';
  if ([1390001].includes(code)) return 'INVALID_ARGUMENT';
  if ([1395001].includes(code)) return 'UNAVAILABLE';
  if (status >= 400 && status < 500) return 'FAILED_PRECONDITION';
  if (status >= 500) return 'UNAVAILABLE';
  return 'UNKNOWN';
};

const parseResponse = async (response) => {
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw errorWithCode(
      response.ok ? 'UNKNOWN' : mapErrorCode(response.status),
      `Feishu returned a non-JSON response with HTTP ${response.status}`,
    );
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw errorWithCode(
      response.ok ? 'UNKNOWN' : mapErrorCode(response.status),
      `Feishu returned an invalid JSON response with HTTP ${response.status}`,
    );
  }
  const hasCode = Object.prototype.hasOwnProperty.call(payload, 'code');
  const upstreamCode = hasCode ? Number(payload.code) : Number.NaN;
  if (response.ok && (!hasCode || !Number.isFinite(upstreamCode))) {
    throw errorWithCode('UNKNOWN', 'Feishu response is missing a numeric code');
  }
  if (!response.ok || !Number.isFinite(upstreamCode) || upstreamCode !== 0) {
    const message = sanitizeUpstreamMessage(payload?.msg ?? payload?.message)
      || `Feishu request failed with HTTP ${response.status}`;
    throw errorWithCode(mapErrorCode(response.status, upstreamCode), message);
  }
  return payload;
};

const fetchOnce = async (settings, path, options, mutation) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), settings.timeoutMs);
  try {
    return await settings.fetchImpl(`${settings.baseUrl}${path}`, {
      ...options,
      dispatcher: settings.dispatcher,
      signal: controller.signal,
    });
  } catch (cause) {
    const timedOut = isTimeoutError(cause);
    const reason = timedOut ? 'request timed out' : 'network request failed';
    const error = errorWithCode(
      timedOut ? 'DEADLINE_EXCEEDED' : 'UNAVAILABLE',
      mutation ? `${reason}; mutation result may be ambiguous` : reason,
    );
    error.ambiguous = mutation;
    throw error;
  } finally {
    clearTimeout(timer);
  }
};

const getTenantToken = async (settings) => {
  const cacheKey = tokenCacheKey(settings);
  const cached = tokenCache.get(cacheKey);
  if (cached?.refreshAt > Date.now()) return cached;
  const response = await fetchOnce(settings, '/open-apis/auth/v3/tenant_access_token/internal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ app_id: settings.appId, app_secret: settings.appSecret }),
  }, false);
  const payload = await parseResponse(response);
  const token = requiredString(payload.tenant_access_token, 'upstream tenant_access_token');
  const expire = Number(payload.expire);
  if (!Number.isFinite(expire) || expire <= 0) {
    throw errorWithCode('UNKNOWN', 'Feishu token response is incomplete');
  }
  const now = Date.now();
  const entry = {
    token,
    expiresIn: expire,
    expiresAt: now + expire * 1000,
    refreshAt: now + Math.max(1, expire - TOKEN_REFRESH_SKEW_SECONDS) * 1000,
  };
  tokenCache.set(cacheKey, entry);
  return entry;
};

const callOpenApi = async (settings, method, path, options = {}) => {
  const token = await getTenantToken(settings);
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value !== undefined && value !== null && value !== '') query.set(key, String(value));
  }
  const requestPath = query.size ? `${path}?${query}` : path;
  const response = await fetchOnce(settings, requestPath, {
    method,
    headers: {
      ...(settings.headers && typeof settings.headers === 'object' ? settings.headers : {}),
      Authorization: `Bearer ${token.token}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  }, options.mutation === true);
  try {
    return (await parseResponse(response)).data ?? {};
  } catch (error) {
    if (error.legacyCode === 'UNAUTHENTICATED') {
      tokenCache.delete(tokenCacheKey(settings));
    }
    if (options.mutation === true && ['UNAVAILABLE', 'DEADLINE_EXCEEDED'].includes(error.legacyCode)) {
      error.ambiguous = true;
      if (!error.message.includes('ambiguous')) {
        error.message = `${error.message}; mutation result may be ambiguous`;
      }
    }
    throw error;
  }
};

const exactlyOneUser = (userId, openId, prefix) => {
  const user = asString(userId);
  const open = asString(openId);
  if (!user && !open) {
    throw errorWithCode(
      'INVALID_ARGUMENT',
      `at least one of ${prefix}_user_id or ${prefix}_open_id is required`,
    );
  }
  return { userId: user, openId: open };
};

const positiveInteger = (value, field) => {
  const number = typeof value === 'bigint' ? Number(value) : Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw errorWithCode('INVALID_ARGUMENT', `${field} must be a positive integer`);
  }
  return number;
};

const formJson = (value) => {
  const text = requiredString(value, 'form_json', 100_000);
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw errorWithCode('INVALID_ARGUMENT', 'form_json must be valid JSON');
  }
  if (!Array.isArray(parsed)) {
    throw errorWithCode('INVALID_ARGUMENT', 'form_json must encode an array');
  }
  return JSON.stringify(parsed);
};

const nodes = (value, field) => {
  const rawNodes = Array.isArray(value) ? value : [];
  if (rawNodes.length > 20) {
    throw errorWithCode('INVALID_ARGUMENT', `${field} must contain at most 20 nodes`);
  }
  const seen = new Set();
  return rawNodes.map((node) => {
    const key = requiredString(node.key, `${field}.key`, 128);
    if (seen.has(key)) throw errorWithCode('INVALID_ARGUMENT', `${field} contains duplicate key ${key}`);
    seen.add(key);
    const rawUsers = node.user_ids ?? node.userIds;
    if (!Array.isArray(rawUsers) || rawUsers.length < 1 || rawUsers.length > 20) {
      throw errorWithCode('INVALID_ARGUMENT', `${field}.${key}.user_ids must contain 1 to 20 users`);
    }
    return {
      key,
      value: [...new Set(rawUsers.map((user) => requiredString(user, `${field}.user_ids`, 128)))],
    };
  });
};

export const buildListQuery = (request = {}) => {
  const start = positiveInteger(request.start_time_ms ?? request.startTimeMs, 'start_time_ms');
  const end = positiveInteger(request.end_time_ms ?? request.endTimeMs, 'end_time_ms');
  if (end <= start) throw errorWithCode('INVALID_ARGUMENT', 'end_time_ms must be greater than start_time_ms');
  if (end - start > 10 * 60 * 60 * 1000) {
    throw errorWithCode('INVALID_ARGUMENT', 'instance list window must not exceed ten hours');
  }
  const query = {
    approval_code: requiredString(request.approval_code ?? request.approvalCode, 'approval_code'),
    start_time: String(start),
    end_time: String(end),
  };
  const pageSize = request.page_size ?? request.pageSize;
  if (pageSize !== undefined && pageSize !== null && asString(pageSize)) {
    const normalizedPageSize = positiveInteger(pageSize, 'page_size');
    if (normalizedPageSize > 100) {
      throw errorWithCode('INVALID_ARGUMENT', 'page_size must be between 1 and 100');
    }
    query.page_size = String(normalizedPageSize);
  }
  const pageToken = asString(request.page_token ?? request.pageToken);
  if (pageToken) query.page_token = requiredString(pageToken, 'page_token', 4096);
  return query;
};

export const buildCreateBody = (request = {}) => {
  const identity = exactlyOneUser(request.user_id ?? request.userId, request.open_id ?? request.openId, 'submitter');
  const body = {
    approval_code: requiredString(request.approval_code ?? request.approvalCode, 'approval_code'),
    form: formJson(request.form_json ?? request.formJson),
    uuid: operationId(request),
    node_approver_user_id_list: nodes(request.node_approvers ?? request.nodeApprovers, 'node_approvers'),
    node_cc_user_id_list: nodes(request.node_cc_users ?? request.nodeCcUsers, 'node_cc_users'),
  };
  if (identity.userId) body.user_id = identity.userId;
  if (identity.openId) body.open_id = identity.openId;
  const departmentId = asString(request.department_id ?? request.departmentId);
  if (departmentId) body.department_id = departmentId;
  if (request.cancel_bot_notification ?? request.cancelBotNotification) body.cancel_bot_notification = '7';
  return body;
};

export const buildBotBody = (request = {}) => {
  const identity = exactlyOneUser(
    request.recipient_user_id ?? request.recipientUserId,
    request.recipient_open_id ?? request.recipientOpenId,
    'recipient',
  );
  const detailUrl = requiredString(request.detail_url ?? request.detailUrl, 'detail_url', 2048);
  let url;
  try {
    url = new URL(detailUrl);
  } catch {
    throw errorWithCode('INVALID_ARGUMENT', 'detail_url must be a valid HTTP(S) URL');
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw errorWithCode('INVALID_ARGUMENT', 'detail_url must be a valid HTTP(S) URL');
  }
  const locale = enumValue(request.locale, 'locale', ['zh-CN', 'en-US', 'ja-JP'], 'zh-CN');
  const body = {
    template_id: '1021',
    uuid: operationId(request),
    custom_title: '@i18n@title',
    custom_content: '@i18n@content',
    actions: [{
      action_name: '@i18n@detail',
      url: detailUrl,
      android_url: detailUrl,
      ios_url: detailUrl,
      pc_url: detailUrl,
    }],
    i18n_resources: [{
      locale,
      is_default: true,
      texts: {
        '@i18n@title': requiredString(request.title, 'title', 200),
        '@i18n@content': requiredString(request.content, 'content', 8000),
        '@i18n@detail': locale === 'zh-CN' ? '查看详情' : 'View details',
      },
    }],
  };
  if (identity.userId) body.user_id = identity.userId;
  if (identity.openId) body.open_id = identity.openId;
  return body;
};

// Keep the structured Feishu payload under the same Service contract.
const data = (value) => ({ data: value ?? {} });
const wrap = (handler) => async (ctx = {}) => handler(resolveSettings(ctx), ctx.req ?? ctx.request ?? {});

export const handlers = {
  [OPEN_API_METHODS.CHECK_CONNECTIVITY]: wrap(async (settings) => {
    const token = await getTenantToken(settings);
    return {
      reachable: true,
      message: 'Feishu credentials accepted',
      token_expires_in_seconds: Math.max(0, Math.ceil((token.expiresAt - Date.now()) / 1000)),
    };
  }),
  [OPEN_API_METHODS.GET_APPROVAL_DEFINITION]: wrap(async (settings, request) => data(await callOpenApi(
    settings,
    'GET',
    `/open-apis/approval/v4/approvals/${encodeURIComponent(requiredString(request.approval_code ?? request.approvalCode, 'approval_code'))}`,
  ))),
  [OPEN_API_METHODS.LIST_APPROVAL_INSTANCE_CODES]: wrap(async (settings, request) => data(await callOpenApi(
    settings,
    'GET',
    '/open-apis/approval/v4/instances',
    { query: buildListQuery(request) },
  ))),
  [OPEN_API_METHODS.GET_APPROVAL_INSTANCE]: wrap(async (settings, request) => data(await callOpenApi(
    settings,
    'GET',
    `/open-apis/approval/v4/instances/${encodeURIComponent(requiredString(request.instance_code ?? request.instanceCode, 'instance_code'))}`,
    { query: {
      user_id: asString(request.user_id ?? request.userId),
      user_id_type: enumValue(request.user_id_type ?? request.userIdType, 'user_id_type', ['open_id', 'union_id', 'user_id'], 'open_id'),
      locale: optionalEnumValue(request.locale, 'locale', LOCALES),
      nested_mutable_group: (request.nested_mutable_group ?? request.nestedMutableGroup) === true
        ? true
        : undefined,
    } },
  ))),
  [OPEN_API_METHODS.CREATE_APPROVAL_INSTANCE]: wrap(async (settings, request) => {
    const body = buildCreateBody(request);
    const data = await callOpenApi(settings, 'POST', '/open-apis/approval/v4/instances', {
      body,
      mutation: true,
    });
    return {
      instance_code: requiredString(data.instance_code, 'upstream instance_code'),
      operation_id: body.uuid,
    };
  }),
  [OPEN_API_METHODS.CANCEL_APPROVAL_INSTANCE]: wrap(async (settings, request) => {
    const id = operationId(request);
    await callOpenApi(settings, 'POST', '/open-apis/approval/v4/instances/cancel', {
      query: {
        user_id_type: enumValue(request.user_id_type ?? request.userIdType, 'user_id_type', USER_ID_TYPES, 'open_id'),
      },
      body: {
        approval_code: requiredString(request.approval_code ?? request.approvalCode, 'approval_code'),
        instance_code: requiredString(request.instance_code ?? request.instanceCode, 'instance_code'),
        user_id: requiredString(request.user_id ?? request.userId, 'user_id'),
      },
      mutation: true,
    });
    return { submitted: true, operation_id: id };
  }),
  [OPEN_API_METHODS.SEND_APPROVAL_BOT_MESSAGE]: wrap(async (settings, request) => {
    const body = buildBotBody(request);
    const data = await callOpenApi(settings, 'POST', '/open-apis/approval/v1/message/send', {
      body,
      mutation: true,
    });
    return {
      message_id: requiredString(data.message_id, 'upstream message_id'),
      operation_id: body.uuid,
    };
  }),
  [OPEN_API_METHODS.GET_USER]: wrap(async (settings, request) => data(await callOpenApi(
    settings,
    'GET',
    `/open-apis/contact/v3/users/${encodeURIComponent(requiredString(request.user_id ?? request.userId, 'user_id'))}`,
    { query: {
      department_id_type: enumValue(request.department_id_type ?? request.departmentIdType, 'department_id_type', ['department_id', 'open_department_id'], 'open_department_id'),
      user_id_type: enumValue(request.user_id_type ?? request.userIdType, 'user_id_type', USER_ID_TYPES, 'open_id'),
    } },
  ))),
  [OPEN_API_METHODS.GET_DEPARTMENT]: wrap(async (settings, request) => data(await callOpenApi(
    settings,
    'GET',
    `/open-apis/contact/v3/departments/${encodeURIComponent(requiredString(request.department_id ?? request.departmentId, 'department_id'))}`,
    { query: {
      department_id_type: enumValue(request.department_id_type ?? request.departmentIdType, 'department_id_type', ['department_id', 'open_department_id'], 'open_department_id'),
      user_id_type: enumValue(request.user_id_type ?? request.userIdType, 'user_id_type', USER_ID_TYPES, 'open_id'),
    } },
  ))),
};

export const _test = {
  buildBotBody,
  buildCreateBody,
  buildListQuery,
  mapErrorCode,
  normalizeBaseUrl,
  parseResponse,
  resolveSettings,
  tokenCacheKey,
  tokenCache,
  isTimeoutError,
  sanitizeUpstreamMessage,
};

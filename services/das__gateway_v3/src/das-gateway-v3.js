import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';

export const DEFAULT_TIMEOUT_MS = 2000;
export const BLOCK_IP_PATH = '/DAS_Gateway_V3.DAS_Gateway_V3/BlockIP';
export const UNBLOCK_IP_PATH = '/DAS_Gateway_V3.DAS_Gateway_V3/UnblockIP';
export const METHOD_BLOCK_IP_FULL = 'DAS_Gateway_V3.DAS_Gateway_V3/BlockIP';
export const METHOD_UNBLOCK_IP_FULL = 'DAS_Gateway_V3.DAS_Gateway_V3/UnblockIP';
let insecureDispatcherPromise;

const grpcCodeFor = (code) => ({
  FAILED_PRECONDITION: grpcStatus.FAILED_PRECONDITION,
  INTERNAL: grpcStatus.INTERNAL,
  INVALID_ARGUMENT: grpcStatus.INVALID_ARGUMENT,
  UNAVAILABLE: grpcStatus.UNAVAILABLE,
  UNKNOWN: grpcStatus.UNKNOWN,
})[code] ?? grpcStatus.UNKNOWN;

const errorWithCode = (code, message, details = {}) => {
  const err = new GrpcError(grpcCodeFor(code), `${code}: ${message}`);
  err.legacyCode = code;
  err.details = details;
  return err;
};

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj ?? {}, key);

const unwrapValue = (value) => {
  if (value && typeof value === 'object' && hasOwn(value, 'value')) {
    return value.value;
  }
  return value;
};

const trimString = (value) => String(unwrapValue(value) ?? '').trim();

const firstDefined = (...values) => values.find((value) => value !== undefined && value !== null);

const stripTrailingSlash = (value) => trimString(value).replace(/\/$/, '');

const normalizeTimeoutMs = (value) => {
  const num = Number(unwrapValue(value));
  return Number.isFinite(num) && num > 0 ? num : DEFAULT_TIMEOUT_MS;
};

const createTlsDispatcher = async (skipTlsVerify) => {
  if (!skipTlsVerify) return undefined;
  insecureDispatcherPromise ??= import('undici').then(({ Agent }) => new Agent({
    connect: { rejectUnauthorized: false },
  }));
  return insecureDispatcherPromise;
};

const fetchWithTimeout = async (url, init = {}, options = {}) => {
  const timeoutMs = normalizeTimeoutMs(options.timeoutMs);
  const controller = new AbortController();
  const parentSignal = init.signal;
  const abortFromParent = () => controller.abort(parentSignal.reason);
  if (parentSignal) {
    if (parentSignal.aborted) {
      controller.abort(parentSignal.reason);
    } else if (typeof parentSignal.addEventListener === 'function') {
      parentSignal.addEventListener('abort', abortFromParent, { once: true });
    }
  }
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const dispatcher = await createTlsDispatcher(options.skipTlsVerify);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
      ...(dispatcher ? { dispatcher } : {}),
    });
  } finally {
    clearTimeout(timer);
    if (parentSignal && typeof parentSignal.removeEventListener === 'function') {
      parentSignal.removeEventListener('abort', abortFromParent);
    }
  }
};

const mergedBindings = (ctx = {}) => ({
  ...(ctx?.config ?? {}),
  ...(ctx?.secret ?? {}),
  ...(ctx?.bindings ?? {}),
});

const resolveCallContext = (ctx = {}) => ({
  bindings: mergedBindings(ctx),
  limits: ctx.limits ?? {},
  meta: ctx.meta ?? {},
  req: ctx.req ?? ctx.request ?? {},
});

const getConfig = (ctx = {}) => {
  const bindings = mergedBindings(ctx);
  const host = stripTrailingSlash(firstDefined(bindings.host, bindings.endpoint, bindings.baseUrl, bindings.base_url));
  const user = trimString(firstDefined(bindings.user, bindings.username));
  const password = trimString(firstDefined(bindings.password, bindings.pass));
  const timeoutMs = normalizeTimeoutMs(firstDefined(bindings.timeoutMs, bindings.timeout_ms, ctx.limits?.timeoutMs));

  if (!host) throw errorWithCode('FAILED_PRECONDITION', '配置缺失: host (管理地址) 未配置');
  if (!user) throw errorWithCode('FAILED_PRECONDITION', '配置缺失: user (账号) 未配置');
  if (!password) throw errorWithCode('FAILED_PRECONDITION', '配置缺失: password (密码) 未配置');

  return {
    host,
    user,
    password,
    timeoutMs,
  };
};

const base64Encode = (value, options = {}) => {
  for (let i = 0; i < value.length; i += 1) {
    if (value.charCodeAt(i) > 0xff) {
      throw new Error("'base64Encode' failed: The string to be encoded contains characters outside of the Latin1 range.");
    }
  }
  if (!options.forceFallback && typeof Buffer !== 'undefined') {
    return Buffer.from(value, 'latin1').toString('base64');
  }

  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let output = '';
  for (let block = 0, charCode, i = 0, map = chars; value.charAt(i | 0) || (map = '=', i % 1); output += map.charAt(63 & (block >> (8 - (i % 1) * 8)))) {
    charCode = value.charCodeAt((i += 3 / 4));
    if (charCode > 0xff) {
      throw new Error("'base64Encode' failed: The string to be encoded contains characters outside of the Latin1 range.");
    }
    block = (block << 8) | charCode;
  }
  return output;
};

const getAuthHeader = (config) => `Basic ${base64Encode(`${config.user}:${config.password}`)}`;

const logFlow = (ctx, action, details) => {
  const meta = ctx.meta || {};
  const inst = meta.instance_id || meta.instanceId || 'unknown';
  const reqId = meta.request_id || meta.requestId || 'unknown';
  const prefix = `[DAS_Gateway_V3][${action}][inst=${inst} req=${reqId}]`;
  try {
    console.log(`${prefix} ${JSON.stringify(details)}`);
  } catch {
    console.log(`${prefix} ${details}`);
  }
};

const normalizeIpList = (value) => {
  const raw = unwrapValue(value);
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => trimString(item)).filter(Boolean);
};

const parseResponseText = async (res, context) => {
  const text = await res.text();
  try {
    return {
      text,
      json: JSON.parse(text),
    };
  } catch {
    if (res.ok) {
      return {
        text,
        json: null,
      };
    }
    throw errorWithCode('UNKNOWN', `设备返回非预期格式: ${text}`, {
      http_status_code: res.status,
      http_response_body: text,
      ...context,
    });
  }
};

const fetchDevice = async (url, init, options, errorContext) => {
  try {
    return await fetchWithTimeout(url, init, options);
  } catch (err) {
    throw errorWithCode('UNAVAILABLE', `连接设备失败: ${err.message}`, errorContext);
  }
};

const responsePayload = (res, text) => ({
  http_status_code: res.status,
  http_response_body: text,
});

const blockIpForContext = (ctx) => async (request = {}) => {
  let config;
  try {
    config = getConfig(ctx);
  } catch (err) {
    logFlow(ctx, 'BlockIP.ConfigError', { message: err.message });
    throw err;
  }

  const ips = normalizeIpList(request.ips);
  if (ips.length === 0) {
    throw errorWithCode('INVALID_ARGUMENT', '待封禁 IP 列表不能为空');
  }

  const body = {
    blist_entry: ips.map((ip) => ({
      blist: ip,
      age: '-1',
      reason: 'API Block-IP',
      enable: '1',
    })),
  };
  const url = `${config.host}/api/v3/Objects/Blacklist`;
  const res = await fetchDevice(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: getAuthHeader(config),
    },
    body: JSON.stringify(body),
  }, { timeoutMs: config.timeoutMs, skipTlsVerify: true }, { ips, operation: 'BlockIP' });
  const { text, json } = await parseResponseText(res, { ips, operation: 'BlockIP' });
  const isAlreadyExists = json && typeof json.msg === 'string' && json.msg.includes('已存在');

  if (res.ok || isAlreadyExists) {
    logFlow(ctx, 'BlockIP', {
      blist_entry: body.blist_entry,
      status: res.status,
      already_exists: isAlreadyExists,
      msg: json?.msg,
    });
    return responsePayload(res, text);
  }

  const details = {
    http_status_code: res.status,
    http_response_body: text,
    ips,
    operation: 'BlockIP',
  };
  logFlow(ctx, 'BlockIP.Error', details);
  throw errorWithCode('INTERNAL', `设备调用失败: ${json?.msg || text}`, details);
};

const unblockIpForContext = (ctx) => async (request = {}) => {
  let config;
  try {
    config = getConfig(ctx);
  } catch (err) {
    logFlow(ctx, 'UnblockIP.ConfigError', { message: err.message });
    throw err;
  }

  const ip = trimString(request.ip);
  if (!ip) {
    throw errorWithCode('INVALID_ARGUMENT', '待解封 IP 不能为空');
  }

  const url = `${config.host}/api/v3/Objects/Blacklist/blist/${encodeURIComponent(ip)}`;
  const res = await fetchDevice(url, {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
      Authorization: getAuthHeader(config),
    },
    body: '{}',
  }, { timeoutMs: config.timeoutMs, skipTlsVerify: true }, { ip, operation: 'UnblockIP' });
  const { text, json } = await parseResponseText(res, { ip, operation: 'UnblockIP' });
  const code = json && json.code;

  if ((json === null && res.ok) || code === 1 || code === 404 || res.status === 404) {
    logFlow(ctx, 'UnblockIP', {
      ip,
      status: res.status,
      code,
      msg: json?.msg,
    });
    return responsePayload(res, text);
  }

  const details = {
    http_status_code: res.status,
    http_response_body: text,
    ip,
    operation: 'UnblockIP',
  };
  logFlow(ctx, 'UnblockIP.Error', details);
  throw errorWithCode('INTERNAL', `设备调用失败: ${json?.msg || text}`, details);
};

const wrapLegacyHandler = (ctx, path) => {
  const callCtx = resolveCallContext(ctx);
  if (path === BLOCK_IP_PATH) {
    return blockIpForContext(callCtx);
  }
  if (path === UNBLOCK_IP_PATH) {
    return unblockIpForContext(callCtx);
  }
  throw errorWithCode('UNKNOWN', `unsupported method: ${path}`);
};

export function rpcdef(ctx = {}) {
  return {
    [BLOCK_IP_PATH]: wrapLegacyHandler(ctx, BLOCK_IP_PATH),
    [UNBLOCK_IP_PATH]: wrapLegacyHandler(ctx, UNBLOCK_IP_PATH),
  };
}

export const handlers = {
  [METHOD_BLOCK_IP_FULL]: (ctx) => wrapLegacyHandler(ctx, BLOCK_IP_PATH)(ctx?.req ?? ctx?.request ?? {}),
  [METHOD_UNBLOCK_IP_FULL]: (ctx) => wrapLegacyHandler(ctx, UNBLOCK_IP_PATH)(ctx?.req ?? ctx?.request ?? {}),
};

export const _test = {
  base64Encode,
  blockIpForContext,
  createTlsDispatcher,
  errorWithCode,
  fetchWithTimeout,
  fetchDevice,
  getAuthHeader,
  getConfig,
  logFlow,
  mergedBindings,
  normalizeIpList,
  normalizeTimeoutMs,
  parseResponseText,
  resolveCallContext,
  stripTrailingSlash,
  trimString,
  unblockIpForContext,
  unwrapValue,
  wrapLegacyHandler,
};

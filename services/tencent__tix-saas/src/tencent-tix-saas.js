import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';

export const METHOD_QUERY_IOC_PATH = '/Tencent_TIX_SaaS.Tencent_TIX_SaaS/QueryIOC';
export const METHOD_GET_FILE_INFO_PATH = '/Tencent_TIX_SaaS.Tencent_TIX_SaaS/GetFileInfo';
export const METHOD_GET_IP_INGRESS_INFO_PATH = '/Tencent_TIX_SaaS.Tencent_TIX_SaaS/GetIPIngressInfo';

export const METHOD_QUERY_IOC_FULL = 'Tencent_TIX_SaaS.Tencent_TIX_SaaS/QueryIOC';
export const METHOD_GET_FILE_INFO_FULL = 'Tencent_TIX_SaaS.Tencent_TIX_SaaS/GetFileInfo';
export const METHOD_GET_IP_INGRESS_INFO_FULL = 'Tencent_TIX_SaaS.Tencent_TIX_SaaS/GetIPIngressInfo';

export const DEFAULT_ENDPOINT = 'https://xti.qq.com/api/v3/ti';
export const DEFAULT_VERSION = '3.0';
export const DEFAULT_LANG = 'zh';
export const DEFAULT_TIMEOUT_MS = 30000;

const ACTIONS = {
  queryIOC: 'TiInfo',
  getFileInfo: 'FileInfo',
  getIPIngressInfo: 'IpIngressInfo',
};

const grpcCodeFor = (code) => ({
  FAILED_PRECONDITION: grpcStatus.FAILED_PRECONDITION,
  INVALID_ARGUMENT: grpcStatus.INVALID_ARGUMENT,
  PERMISSION_DENIED: grpcStatus.PERMISSION_DENIED,
  RESOURCE_EXHAUSTED: grpcStatus.RESOURCE_EXHAUSTED ?? grpcStatus.FAILED_PRECONDITION,
  UNAUTHENTICATED: grpcStatus.UNAUTHENTICATED,
  UNAVAILABLE: grpcStatus.UNAVAILABLE,
  UNKNOWN: grpcStatus.UNKNOWN,
})[code] ?? grpcStatus.UNKNOWN;

const errorWithCode = (code, message) => {
  const err = new GrpcError(grpcCodeFor(code), String(message ?? ''));
  err.legacyCode = code;
  return err;
};

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj ?? {}, key);

const firstDefined = (...values) => values.find((value) => value !== undefined && value !== null);

const unwrapScalar = (value) => {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'object' && value !== null && hasOwn(value, 'value')) return unwrapScalar(value.value);
  return value;
};

const toTrimmedString = (value) => {
  const raw = unwrapScalar(value);
  if (raw === undefined || raw === null) return '';
  return String(raw).trim();
};

const normalizeEndpoint = (value) => {
  const raw = toTrimmedString(value);
  if (!raw) return DEFAULT_ENDPOINT;
  if (!/^https?:\/\//i.test(raw)) return '';
  return raw.replace(/\/+$/, '');
};

const mergedBindings = (ctx = {}) => ({
  ...(ctx.config ?? {}),
  ...(ctx.secret ?? {}),
  ...(ctx.bindings ?? {}),
});

const resolveCallContext = (ctx = {}) => ({
  ...ctx,
  bindings: mergedBindings(ctx),
  limits: ctx.limits ?? {},
  meta: ctx.meta ?? {},
  req: ctx.req ?? ctx.request ?? {},
});

const isSdkCallContext = (value) => (
  value != null
  && typeof value === 'object'
  && (
    hasOwn(value, 'request')
    || hasOwn(value, 'config')
    || hasOwn(value, 'secret')
    || hasOwn(value, 'metadata')
    || hasOwn(value, 'method')
    || hasOwn(value, 'packageDir')
  )
);

const resolveHandlerArgs = (reqOrCtx = {}, maybeCtx) => {
  if (maybeCtx !== undefined) {
    return { req: reqOrCtx ?? {}, ctx: maybeCtx ?? {} };
  }
  if (isSdkCallContext(reqOrCtx)) {
    return { req: reqOrCtx.request ?? reqOrCtx.req ?? {}, ctx: reqOrCtx };
  }
  return { req: reqOrCtx ?? {}, ctx: {} };
};

const resolveEndpoint = (bindings = {}) => normalizeEndpoint(firstDefined(
  bindings.endpoint,
  bindings.baseUrl,
  bindings.host,
  DEFAULT_ENDPOINT,
));

const resolveAppKey = (bindings = {}) => toTrimmedString(firstDefined(
  bindings.appKey,
  bindings.app_key,
  bindings.c_appkey,
));

const resolveTimeoutMs = (ctx = {}) => {
  const raw = Number(firstDefined(ctx.limits?.timeoutMs, ctx.bindings?.timeoutMs, DEFAULT_TIMEOUT_MS));
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TIMEOUT_MS;
};

const resolveVersion = (bindings = {}) => toTrimmedString(bindings.version) || DEFAULT_VERSION;

const normalizeLang = (req = {}, bindings = {}) => {
  const lang = toTrimmedString(firstDefined(req.lang, bindings.lang, DEFAULT_LANG));
  return lang === 'en' ? 'en' : DEFAULT_LANG;
};

const tlsSkipRequested = (bindings = {}) => (
  Boolean(bindings.skipTlsVerify || bindings.tlsInsecureSkipVerify || bindings.insecureSkipVerify)
);

const assertSupportedTlsConfig = (bindings = {}) => {
  if (!tlsSkipRequested(bindings)) return;
  throw errorWithCode(
    'INVALID_ARGUMENT',
    'skipTlsVerify is not supported by this service; use a trusted TLS certificate for the Tencent TIX endpoint',
  );
};

const makeTimeoutSignal = (timeoutMs) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  return { signal: controller.signal, clear: () => clearTimeout(timeoutId) };
};

const requireEndpoint = (ctx = {}) => {
  const endpoint = resolveEndpoint(ctx.bindings || {});
  if (!endpoint) throw errorWithCode('INVALID_ARGUMENT', 'endpoint must be a valid http(s) URL');
  return endpoint;
};

const requireAppKey = (ctx = {}) => {
  const appKey = resolveAppKey(ctx.bindings || {});
  if (!appKey) throw errorWithCode('INVALID_ARGUMENT', 'appKey is required in secret');
  return appKey;
};

const requireKey = (req = {}, label = 'key') => {
  const key = toTrimmedString(firstDefined(req.key, req.resource, req[label]));
  if (!key) throw errorWithCode('INVALID_ARGUMENT', `${label} is required`);
  return key;
};

const optionalString = (req = {}, field) => {
  const value = toTrimmedString(req[field]);
  return value ? value : undefined;
};

const normalizeOption = (req = {}) => {
  const raw = unwrapScalar(req.option);
  if (raw === undefined || raw === null || raw === '') return 0;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) throw errorWithCode('INVALID_ARGUMENT', 'option must be a non-negative integer');
  return value;
};

const inferFileHashType = (key) => {
  const normalized = String(key || '').trim().toLowerCase();
  if (/^[a-f0-9]{32}$/.test(normalized)) return 'md5';
  if (/^[a-f0-9]{40}$/.test(normalized)) return 'sha1';
  if (/^[a-f0-9]{64}$/.test(normalized)) return 'sha256';
  return '';
};

const normalizeFileHashType = (req = {}, key) => {
  const explicit = toTrimmedString(req.type).toLowerCase();
  const hashType = explicit || inferFileHashType(key);
  if (!['md5', 'sha1', 'sha256'].includes(hashType)) {
    throw errorWithCode('INVALID_ARGUMENT', 'type must be md5, sha1, or sha256');
  }
  return hashType;
};

const tryParseJson = (text) => {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
};

const toValue = (value) => {
  if (value === undefined || value === null) return { nullValue: 'NULL_VALUE' };
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'boolean') return { boolValue: value };
  if (typeof value === 'number') return Number.isFinite(value) ? { numberValue: value } : { stringValue: String(value) };
  if (Array.isArray(value)) {
    return {
      listValue: {
        values: value.map((item) => toValue(item)),
      },
    };
  }
  if (typeof value === 'object') {
    const fields = {};
    for (const [key, innerValue] of Object.entries(value)) {
      fields[key] = toValue(innerValue);
    }
    return { structValue: { fields } };
  }
  return { stringValue: String(value) };
};

const throwStructuredError = (code, message, options = {}) => {
  const payload = {
    code,
    message,
    http_status: Number(options.httpStatus ?? 0),
    raw_body: String(options.rawBody ?? ''),
  };
  if (options.reason) payload.reason = String(options.reason);
  if (options.rawJson !== undefined) payload.raw_json = options.rawJson;
  if (options.returnCode !== undefined) payload.return_code = options.returnCode;
  if (options.returnMsg !== undefined) payload.return_msg = options.returnMsg;
  throw errorWithCode(code, JSON.stringify(payload));
};

const mapHttpStatusToGrpcCode = (status) => {
  if (status === 401) return 'UNAUTHENTICATED';
  if (status === 403) return 'PERMISSION_DENIED';
  if (status >= 400 && status < 500) return 'FAILED_PRECONDITION';
  if (status >= 500) return 'UNAVAILABLE';
  return 'UNAVAILABLE';
};

const mapReturnCodeToGrpcCode = (returnCode) => {
  if (returnCode === 1003) return 'UNAUTHENTICATED';
  if (returnCode === 1004 || returnCode === 1005) return 'RESOURCE_EXHAUSTED';
  if (returnCode === 1006 || returnCode === 1101 || returnCode === 1102 || returnCode === 1103 || returnCode === 1107 || returnCode === 1110) return 'UNAVAILABLE';
  if (returnCode === 1001 || returnCode === 1002 || returnCode === 1100 || returnCode === 1108) return 'INVALID_ARGUMENT';
  return 'FAILED_PRECONDITION';
};

const fetchUpstream = async (body, ctx = {}) => {
  const endpoint = requireEndpoint(ctx);
  const bindings = ctx.bindings || {};
  assertSupportedTlsConfig(bindings);
  const headers = {
    'content-type': 'application/json',
    ...(bindings.headers ?? {}),
  };
  const timeout = makeTimeoutSignal(resolveTimeoutMs(ctx));
  let res;
  try {
    res = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: timeout.signal,
    });
  } catch (err) {
    throwStructuredError('UNAVAILABLE', 'tencent tix upstream request failed', {
      httpStatus: 0,
      rawBody: '',
      reason: err?.cause?.message || err?.message || 'fetch failed',
    });
  } finally {
    timeout.clear();
  }

  const httpStatus = Number(res?.status || 0);
  let rawBody;
  try {
    rawBody = await res.text();
  } catch (err) {
    throwStructuredError('UNAVAILABLE', 'tencent tix upstream response read failed', {
      httpStatus,
      rawBody: '',
      reason: err?.message || 'response read failed',
    });
  }
  return { httpStatus, rawBody: String(rawBody ?? '') };
};

const assertTixSuccess = ({ httpStatus, rawBody }, parsed) => {
  if (httpStatus !== 200) {
    const code = mapHttpStatusToGrpcCode(httpStatus);
    throwStructuredError(code, 'tencent tix upstream http failure', {
      httpStatus,
      rawBody,
      rawJson: parsed.ok ? parsed.value : undefined,
      reason: `upstream http ${httpStatus}`,
    });
  }

  if (!parsed.ok) {
    throwStructuredError('UNKNOWN', 'tencent tix response is not valid JSON', {
      httpStatus,
      rawBody,
      reason: 'response is not valid JSON',
    });
  }

  const returnCode = Number(firstDefined(parsed.value?.return_code, parsed.value?.returnCode));
  const returnMsg = toTrimmedString(firstDefined(parsed.value?.return_msg, parsed.value?.returnMsg));
  if (!Number.isFinite(returnCode)) {
    throwStructuredError('UNKNOWN', 'tencent tix return_code missing', {
      httpStatus,
      rawBody,
      rawJson: parsed.value,
      reason: 'return_code missing',
    });
  }

  if (returnCode !== 0 && returnCode !== 1 && returnCode !== 1000) {
    const code = mapReturnCodeToGrpcCode(returnCode);
    throwStructuredError(code, 'tencent tix upstream business failure', {
      httpStatus,
      rawBody,
      rawJson: parsed.value,
      returnCode,
      returnMsg,
      reason: `return_code ${returnCode}`,
    });
  }

  return { json: parsed.value, returnCode, returnMsg, noData: returnCode === 1 };
};

const parseTixResponse = (result) => {
  const trimmed = result.rawBody.trim();
  const parsed = trimmed ? tryParseJson(trimmed) : { ok: false };
  const ok = assertTixSuccess(result, parsed);
  return {
    http_status: result.httpStatus,
    return_code: ok.returnCode,
    return_msg: ok.returnMsg,
    raw_body: result.rawBody,
    raw_json: toValue(ok.json),
    no_data: ok.noData,
  };
};

const baseBody = (action, req = {}, ctx = {}, options = {}) => {
  const body = {
    c_version: resolveVersion(ctx.bindings || {}),
    c_action: action,
    c_appkey: requireAppKey(ctx),
  };
  if (options.includeLang !== false) {
    body.c_lang = normalizeLang(req, ctx.bindings || {});
  }
  return body;
};

const querySimple = async (action, req = {}, ctx = {}, fixedType) => {
  const callCtx = resolveCallContext(ctx);
  const key = requireKey(req);
  const type = fixedType ?? optionalString(req, 'type');
  const body = {
    ...baseBody(action, req, callCtx),
    key,
    option: normalizeOption(req),
  };
  if (type) body.type = type;
  return parseTixResponse(await fetchUpstream(body, callCtx));
};

const handleQueryIOC = (req = {}, ctx = {}) => querySimple(ACTIONS.queryIOC, req, ctx, optionalString(req, 'type'));
const handleGetIPIngressInfo = (req = {}, ctx = {}) => querySimple(ACTIONS.getIPIngressInfo, req, ctx, 'ip');

const handleGetFileInfo = async (req = {}, ctx = {}) => {
  const callCtx = resolveCallContext(ctx);
  const key = requireKey(req);
  const body = {
    ...baseBody(ACTIONS.getFileInfo, req, callCtx, { includeLang: false }),
    type: normalizeFileHashType(req, key),
    key,
    option: normalizeOption(req),
  };
  return parseTixResponse(await fetchUpstream(body, callCtx));
};

export function rpcdef(ctx = {}) {
  const callCtx = resolveCallContext(ctx);
  return {
    [METHOD_QUERY_IOC_PATH]: async (req) => handleQueryIOC(req ?? callCtx.req ?? {}, callCtx),
    [METHOD_GET_IP_INGRESS_INFO_PATH]: async (req) => handleGetIPIngressInfo(req ?? callCtx.req ?? {}, callCtx),
    [METHOD_GET_FILE_INFO_PATH]: async (req) => handleGetFileInfo(req ?? callCtx.req ?? {}, callCtx),
  };
}

export const handlers = {
  [METHOD_QUERY_IOC_FULL]: (reqOrCtx, maybeCtx) => {
    const call = resolveHandlerArgs(reqOrCtx, maybeCtx);
    return handleQueryIOC(call.req, call.ctx);
  },
  [METHOD_GET_IP_INGRESS_INFO_FULL]: (reqOrCtx, maybeCtx) => {
    const call = resolveHandlerArgs(reqOrCtx, maybeCtx);
    return handleGetIPIngressInfo(call.req, call.ctx);
  },
  [METHOD_GET_FILE_INFO_FULL]: (reqOrCtx, maybeCtx) => {
    const call = resolveHandlerArgs(reqOrCtx, maybeCtx);
    return handleGetFileInfo(call.req, call.ctx);
  },
};

export const _test = {
  ACTIONS,
  assertTixSuccess,
  baseBody,
  assertSupportedTlsConfig,
  errorWithCode,
  fetchUpstream,
  firstDefined,
  grpcCodeFor,
  handleGetFileInfo,
  handleGetIPIngressInfo,
  handleQueryIOC,
  hasOwn,
  inferFileHashType,
  isSdkCallContext,
  mapHttpStatusToGrpcCode,
  mapReturnCodeToGrpcCode,
  mergedBindings,
  normalizeEndpoint,
  normalizeFileHashType,
  normalizeLang,
  normalizeOption,
  optionalString,
  parseTixResponse,
  requireAppKey,
  requireEndpoint,
  requireKey,
  resolveAppKey,
  resolveCallContext,
  resolveEndpoint,
  resolveHandlerArgs,
  resolveTimeoutMs,
  resolveVersion,
  throwStructuredError,
  toTrimmedString,
  toValue,
  tryParseJson,
  unwrapScalar,
};

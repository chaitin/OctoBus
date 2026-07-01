import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';
import { Agent } from 'undici';

export const METHOD_SEND_TEXT_PATH = '/Tencent_QYWeiXin_GroupRobot.Tencent_QYWeiXin_GroupRobot/SendText';
export const METHOD_SEND_TEXT_FULL = 'Tencent_QYWeiXin_GroupRobot.Tencent_QYWeiXin_GroupRobot/SendText';
export const DEFAULT_TIMEOUT_MS = 5000;

const grpcCodeFor = (code) => ({
  FAILED_PRECONDITION: grpcStatus.FAILED_PRECONDITION,
  INVALID_ARGUMENT: grpcStatus.INVALID_ARGUMENT,
  PERMISSION_DENIED: grpcStatus.PERMISSION_DENIED,
  UNAVAILABLE: grpcStatus.UNAVAILABLE,
  UNKNOWN: grpcStatus.UNKNOWN,
})[code] ?? grpcStatus.UNKNOWN;

const errorWithCode = (code, message) => {
  const err = new GrpcError(grpcCodeFor(code), `${code}: ${message}`);
  err.legacyCode = code;
  return err;
};

const upstreamError = (code, message, details = {}) => {
  const payload = {
    code,
    message,
    http_status_code: Number.isFinite(Number(details.httpStatusCode)) ? Number(details.httpStatusCode) : 0,
    http_body: '',
    http_body_length: typeof details.httpBody === 'string' ? details.httpBody.length : 0,
    reason: String(details.reason || '').trim(),
  };
  if (Number.isFinite(Number(details.errcode))) payload.errcode = Number(details.errcode);
  if (typeof details.errmsg === 'string' && details.errmsg.trim()) payload.errmsg = details.errmsg;

  const err = new GrpcError(grpcCodeFor(code), JSON.stringify(payload));
  err.legacyCode = code;
  err.httpStatusCode = payload.http_status_code;
  err.httpBody = payload.http_body;
  err.reason = payload.reason;
  if (payload.errcode !== undefined) err.errcode = payload.errcode;
  if (payload.errmsg !== undefined) err.errmsg = payload.errmsg;
  return err;
};

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj ?? {}, key);

const unwrapScalar = (value) => {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'object' && value !== null && hasOwn(value, 'value')) return unwrapScalar(value.value);
  return value;
};

const pickFirst = (source = {}, keys = []) => {
  for (const key of keys) {
    if (hasOwn(source, key)) return unwrapScalar(source[key]);
  }
  return undefined;
};

const toTrimmedString = (value) => {
  const raw = unwrapScalar(value);
  if (raw === undefined || raw === null) return '';
  return String(raw).trim();
};

const requireString = (value, fieldName) => {
  const raw = toTrimmedString(value);
  if (!raw) throw errorWithCode('INVALID_ARGUMENT', `${fieldName} is required`);
  return raw;
};

const mergedBindings = (ctx = {}) => ({
  ...(ctx.config ?? {}),
  ...(ctx.bindings ?? {}),
  ...(ctx.secret ?? {}),
});

const resolveWebhook = (ctx = {}) => {
  const keys = ['webhook', 'webhook_url', 'webhookUrl', 'url'];
  return pickFirst(ctx.secret || {}, keys)
    ?? pickFirst(ctx.config || {}, keys)
    ?? pickFirst(ctx.bindings || {}, keys);
};

const resolveCallContext = (ctx = {}) => ({
  ...ctx,
  bindings: mergedBindings(ctx),
  limits: ctx.limits ?? {},
  meta: ctx.meta ?? {},
  req: ctx.request ?? ctx.req ?? {},
});

const requestFromContext = (ctx = {}) => ctx.request ?? ctx.req ?? {};

const optionalUint32 = (value) => {
  const raw = unwrapScalar(value);
  if (raw === undefined || raw === null || raw === '') return undefined;
  const num = Number(raw);
  if (!Number.isFinite(num) || num <= 0) return undefined;
  return Math.trunc(num);
};

const resolveTimeoutMs = (ctx = {}) => {
  const bindings = ctx.bindings || {};
  return optionalUint32(ctx.limits?.timeoutMs) ?? optionalUint32(bindings.timeoutMs) ?? DEFAULT_TIMEOUT_MS;
};

const toBoolean = (value) => {
  const raw = unwrapScalar(value);
  if (typeof raw === 'boolean') return raw;
  if (typeof raw === 'number') return Number.isFinite(raw) && raw !== 0;
  if (typeof raw === 'string') {
    const text = raw.trim().toLowerCase();
    if (['1', 'true', 'yes', 'y', 'on'].includes(text)) return true;
    if (['0', 'false', 'no', 'n', 'off', ''].includes(text)) return false;
  }
  return false;
};

const buildTlsOptions = (bindings = {}) => {
  if (!toBoolean(bindings.skipTlsVerify) && !toBoolean(bindings.tlsInsecureSkipVerify) && !toBoolean(bindings.insecureSkipVerify)) return {};
  return { dispatcher: insecureTlsDispatcher };
};

const insecureTlsDispatcher = new Agent({ connect: { rejectUnauthorized: false } });

const makeTimeoutSignal = (timeoutMs) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  return { signal: controller.signal, clear: () => clearTimeout(timeoutId) };
};

const buildHeaders = (ctx = {}) => {
  const bindings = ctx.bindings || {};
  return {
    ...(bindings.headers && typeof bindings.headers === 'object' ? bindings.headers : {}),
    'content-type': 'application/json',
    accept: 'application/json, */*;q=0.8',
  };
};

const requireWebhook = (value) => {
  const raw = requireString(value, 'webhook');
  if (!/^https:\/\//i.test(raw)) throw errorWithCode('INVALID_ARGUMENT', 'webhook must be a valid https URL');
  return raw;
};

const splitMentionedMobiles = (value) => {
  const raw = toTrimmedString(value);
  if (!raw) return [];
  return raw.split(',').map((item) => item.trim()).filter((item) => item);
};

const tryParseWecomBody = (bodyText) => {
  if (typeof bodyText !== 'string') return { ok: false };
  const trimmed = bodyText.trim();
  if (!trimmed) return { ok: false };
  try {
    const parsed = JSON.parse(trimmed);
    const errcode = Number(parsed?.errcode);
    const hasErrcode = Number.isFinite(errcode);
    const errmsg = typeof parsed?.errmsg === 'string' ? parsed.errmsg : '';
    return { ok: true, parsed, hasErrcode, errcode: hasErrcode ? errcode : 0, errmsg };
  } catch {
    return { ok: false };
  }
};

const mapHttpStatusToCode = (status) => {
  if (status === 401 || status === 403) return 'PERMISSION_DENIED';
  if (status >= 400 && status < 500) return 'FAILED_PRECONDITION';
  if (status >= 500) return 'UNAVAILABLE';
  return 'UNKNOWN';
};

const fetchWecom = async (ctx, webhook, payload) => {
  const timeout = makeTimeoutSignal(resolveTimeoutMs(ctx));
  let response;
  try {
    response = await fetch(webhook, {
      method: 'POST',
      signal: timeout.signal,
      headers: buildHeaders(ctx),
      body: JSON.stringify(payload),
      ...buildTlsOptions(ctx.bindings || {}),
    });
  } catch (err) {
    throw upstreamError('UNAVAILABLE', 'wecom webhook request failed', {
      httpStatusCode: 0,
      httpBody: '',
      reason: err?.cause?.message || err?.message || 'fetch failed',
    });
  } finally {
    timeout.clear();
  }

  let bodyText;
  try {
    bodyText = await response.text();
  } catch (err) {
    throw upstreamError('UNAVAILABLE', 'wecom webhook response read failed', {
      httpStatusCode: Number(response.status),
      httpBody: '',
      reason: err?.message || 'read response failed',
    });
  }

  return {
    status: Number(response.status),
    ok: Boolean(response.ok),
    bodyText: String(bodyText ?? ''),
  };
};

const buildWecomPayload = (message, mentionedMobiles) => {
  const text = { content: message };
  if (mentionedMobiles.length > 0) text.mentioned_mobile_list = mentionedMobiles;
  else text.mentioned_list = [];
  return { msgtype: 'text', text };
};

const handleSendText = async (req = {}, ctx = {}) => {
  const callCtx = resolveCallContext(ctx);
  const webhook = requireWebhook(resolveWebhook(callCtx));
  const message = requireString(pickFirst(req, ['message']), 'message');
  const mentionedMobiles = splitMentionedMobiles(pickFirst(req, ['mentioned_mobiles', 'mentionedMobiles']));
  const payload = buildWecomPayload(message, mentionedMobiles);
  const upstream = await fetchWecom(callCtx, webhook, payload);
  const bodyInfo = tryParseWecomBody(upstream.bodyText);

  if (!upstream.ok) {
    throw upstreamError(mapHttpStatusToCode(upstream.status), 'wecom webhook http error', {
      httpStatusCode: upstream.status,
      httpBody: upstream.bodyText,
      errcode: bodyInfo.ok && bodyInfo.hasErrcode ? bodyInfo.errcode : undefined,
      errmsg: bodyInfo.ok && bodyInfo.errmsg ? bodyInfo.errmsg : undefined,
      reason: 'http status is not 2xx',
    });
  }

  if (!bodyInfo.ok || !bodyInfo.hasErrcode) {
    throw upstreamError('UNKNOWN', 'wecom webhook invalid response body', {
      httpStatusCode: upstream.status,
      httpBody: upstream.bodyText,
      reason: 'missing errcode in json body',
    });
  }

  if (bodyInfo.errcode !== 0) {
    throw upstreamError('FAILED_PRECONDITION', 'wecom webhook business failure', {
      httpStatusCode: upstream.status,
      httpBody: upstream.bodyText,
      errcode: bodyInfo.errcode,
      errmsg: bodyInfo.errmsg,
      reason: 'errcode != 0',
    });
  }

  return {
    http_status_code: upstream.status,
    http_body: '',
    errcode: bodyInfo.errcode,
    errmsg: bodyInfo.errmsg,
  };
};

export function rpcdef(ctx = {}) {
  const callCtx = resolveCallContext(ctx);
  return {
    [METHOD_SEND_TEXT_PATH]: async (req) => handleSendText(req ?? callCtx.req ?? {}, callCtx),
  };
}

export const handlers = {
  [METHOD_SEND_TEXT_FULL]: (ctx = {}) => handleSendText(requestFromContext(ctx), ctx),
};

export const _test = {
  buildHeaders,
  buildTlsOptions,
  buildWecomPayload,
  errorWithCode,
  fetchWecom,
  grpcCodeFor,
  handleSendText,
  hasOwn,
  insecureTlsDispatcher,
  makeTimeoutSignal,
  mapHttpStatusToCode,
  mergedBindings,
  optionalUint32,
  pickFirst,
  requireString,
  requireWebhook,
  resolveCallContext,
  resolveWebhook,
  resolveTimeoutMs,
  splitMentionedMobiles,
  toBoolean,
  toTrimmedString,
  tryParseWecomBody,
  unwrapScalar,
  upstreamError,
};

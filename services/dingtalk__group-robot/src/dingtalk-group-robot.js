import crypto from 'node:crypto';

import { GrpcError, grpcCodeFor, normalizeTimeoutMs } from '@chaitin-ai/octobus-sdk';

export const METHOD_SEND_TEXT_PATH = '/DingDing_GroupRobot.DingDing_GroupRobot/SendTextMessage';
export const METHOD_SEND_TEXT_FULL = 'DingDing_GroupRobot.DingDing_GroupRobot/SendTextMessage';
export const DEFAULT_TIMEOUT_MS = 5000;

const JSON_HEADERS = {
  'Content-Type': 'application/json',
};

const errorWithCode = (code, message) => {
  const err = new GrpcError(grpcCodeFor(code), message);
  err.legacyCode = code;
  return err;
};

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj ?? {}, key);
const firstDefined = (...vals) => vals.find((val) => val !== undefined && val !== null);

const coerceString = (value) => {
  if (value === undefined || value === null) return '';
  if (typeof value === 'object' && value !== null && hasOwn(value, 'value')) {
    return coerceString(value.value);
  }
  return String(value);
};

const toBoolean = (candidate) => {
  if (typeof candidate === 'boolean') return candidate;
  if (typeof candidate === 'number') {
    if (Number.isNaN(candidate)) return false;
    return candidate !== 0;
  }
  if (typeof candidate === 'string') {
    const value = candidate.trim().toLowerCase();
    if (['1', 'true', 'yes', 'y', 'on'].includes(value)) return true;
    if (['0', 'false', 'no', 'n', 'off'].includes(value)) return false;
  }
  if (candidate && typeof candidate === 'object' && hasOwn(candidate, 'value')) {
    return toBoolean(candidate.value);
  }
  return false;
};

const readRepeatedStrings = (candidate) => {
  if (candidate === undefined || candidate === null) return [];
  if (Array.isArray(candidate)) return candidate.map(coerceString).map((s) => s.trim()).filter(Boolean);
  if (typeof candidate === 'object' && Array.isArray(candidate.values)) {
    return candidate.values.map(coerceString).map((s) => s.trim()).filter(Boolean);
  }
  if (typeof candidate === 'string') {
    return candidate.split(',').map((s) => s.trim()).filter(Boolean);
  }
  return [];
};

const resolveBindingString = (bindings, keys) => {
  for (const key of keys) {
    if (hasOwn(bindings, key)) {
      const asString = coerceString(bindings[key]).trim();
      if (asString) return asString;
    }
  }
  return '';
};

const mergedBindings = (ctx = {}) => ({
  ...(ctx?.config ?? {}),
  ...(ctx?.bindings ?? {}),
  ...(ctx?.secret ?? {}),
});

const resolveWebhookUrl = (ctx = {}) => {
  const keys = ['webhook_url', 'webhookUrl', 'webhook', 'url'];
  return resolveBindingString(ctx.secret || {}, keys)
    || resolveBindingString(ctx.config || {}, keys)
    || resolveBindingString(ctx.bindings || {}, keys);
};

const resolveSigningSecret = (ctx = {}) => {
  const keys = ['secret', 'dingding_secret'];
  return resolveBindingString(ctx.secret || {}, keys)
    || resolveBindingString(ctx.config || {}, keys)
    || resolveBindingString(ctx.bindings || {}, keys);
};

const resolveCallContext = (ctx = {}) => ({
  ...ctx,
  bindings: mergedBindings(ctx),
  limits: ctx.limits ?? {},
  meta: ctx.meta ?? {},
  req: ctx.req ?? ctx.request ?? {},
});

const resolveTimeoutMs = (ctx) => {
  const bindings = mergedBindings(ctx);
  return normalizeTimeoutMs(firstDefined(bindings.timeoutMs, bindings.timeout_ms, ctx?.limits?.timeoutMs), DEFAULT_TIMEOUT_MS);
};

const tlsSkipRequested = (bindings = {}) => (
  toBoolean(firstDefined(bindings.skipTlsVerify, bindings.tlsInsecureSkipVerify, bindings.insecureSkipVerify))
);

const assertSupportedTlsConfig = (bindings = {}) => {
  if (!tlsSkipRequested(bindings)) return;
  throw errorWithCode('INVALID_ARGUMENT', 'skipTlsVerify is not supported by this service');
};

const makeTimeoutSignal = (timeoutMs) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  return { signal: controller.signal, clear: () => clearTimeout(timeoutId) };
};

const encodeUtf8 = (value) => new TextEncoder().encode(String(value ?? ''));

const toBase64 = (bytes) => Buffer.from(bytes).toString('base64');

const urlEncode = (str) => encodeURIComponent(str);

const hmacSha256 = (key, message) => crypto.createHmac('sha256', key).update(message).digest();

const generateSign = (secret, timestamp) => {
  const stringToSign = `${timestamp}\n${secret}`;
  const hmac = hmacSha256(secret, stringToSign);
  return urlEncode(toBase64(hmac));
};

const createLogger = (meta = {}) => (phase, details) => {
  const instanceId = meta.instance_id || meta.instanceId;
  const requestId = meta.request_id || meta.requestId;
  const prefixParts = ['DingDing_GroupRobot', phase];
  if (instanceId) prefixParts.push(`inst=${instanceId}`);
  if (requestId) prefixParts.push(`req=${requestId}`);
  const prefix = `[${prefixParts.join(' ')}]`;
  try {
    console.log(prefix, JSON.stringify(details));
  } catch {
    console.log(prefix, details);
  }
};

const buildDingDingPayload = (sendMsg, isAtAll, atMobiles, atUserIds) => ({
  msgtype: 'text',
  text: {
    content: sendMsg,
  },
  at: {
    atMobiles: atMobiles || [],
    atUserIds: atUserIds || [],
    isAtAll,
  },
});

const redactWebhookUrl = (url) => String(url)
  .replace(/access_token=[^&]+/, 'access_token=***')
  .replace(/sign=[^&]+/, 'sign=***');

const buildSignedWebhookUrl = (webhookUrl, secret, now = Date.now) => {
  if (!secret) return webhookUrl;
  const timestamp = String(Math.floor(now()));
  const sign = generateSign(secret, timestamp);
  const separator = webhookUrl.includes('?') ? '&' : '?';
  return `${webhookUrl}${separator}timestamp=${timestamp}&sign=${sign}`;
};

const sendToDingTalk = async (config, log) => {
  const { webhookUrl, secret, payload, timeoutMs, now, bindings } = config;
  assertSupportedTlsConfig(bindings);
  const fullUrl = buildSignedWebhookUrl(webhookUrl, secret, now);
  const bodyString = JSON.stringify(payload);
  const timeout = makeTimeoutSignal(timeoutMs);

  log('request', {
    url: redactWebhookUrl(fullUrl),
    hasSign: Boolean(secret),
    msgType: payload.msgtype,
    isAtAll: payload.at.isAtAll,
    atMobilesCount: payload.at.atMobiles.length,
    atUserIdsCount: payload.at.atUserIds.length,
  });

  let res;
  try {
    res = await fetch(fullUrl, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: bodyString,
      signal: timeout.signal,
    });
  } catch (err) {
    const reason = err?.cause?.message || err?.message || 'fetch failed';
    log('failure', { reason, stage: 'network' });
    return {
      httpStatus: 0,
      httpBody: '',
      error: errorWithCode('UNAVAILABLE', reason),
    };
  } finally {
    timeout.clear();
  }

  const httpStatus = Number(res.status || 0);
  let httpBody;
  try {
    httpBody = String((await res.text()) ?? '');
  } catch (err) {
    const reason = err?.message || 'read response failed';
    log('failure', { reason, stage: 'read', httpStatus });
    return {
      httpStatus,
      httpBody: '',
      error: errorWithCode('UNAVAILABLE', reason),
    };
  }
  log('response', {
    httpStatus,
    httpBodyLength: httpBody.length,
  });

  return {
    httpStatus,
    httpBody,
    error: null,
  };
};

const handleSendTextMessage = async (req, ctx) => {
  const callCtx = resolveCallContext(ctx);
  const log = createLogger(callCtx.meta);

  const webhookUrl = resolveWebhookUrl(callCtx);
  if (!webhookUrl) {
    throw errorWithCode('INVALID_ARGUMENT', 'webhook_url is required in instance secret');
  }
  if (!/^https?:\/\//i.test(webhookUrl)) {
    throw errorWithCode('INVALID_ARGUMENT', 'webhook_url must be a valid HTTP/HTTPS URL');
  }

  const secret = resolveSigningSecret(callCtx);
  const sendMsg = coerceString(firstDefined(req?.send_msg, req?.sendMsg, req?.send_message, req?.sendMessage));
  if (!sendMsg.trim()) {
    throw errorWithCode('INVALID_ARGUMENT', 'send_msg is required and must not be empty');
  }

  const isAtAll = toBoolean(firstDefined(req?.is_groupsendall, req?.isGroupSendAll, req?.is_at_all, req?.isAtAll));
  const atMobiles = readRepeatedStrings(firstDefined(req?.send_PeoplePhone, req?.sendPeoplePhone, req?.at_mobiles, req?.atMobiles));
  const atUserIds = readRepeatedStrings(firstDefined(req?.send_DingDingID, req?.sendDingDingID, req?.at_user_ids, req?.atUserIds));
  const payload = buildDingDingPayload(sendMsg, isAtAll, atMobiles, atUserIds);

  const result = await sendToDingTalk(
    {
      webhookUrl,
      secret,
      payload,
      timeoutMs: resolveTimeoutMs(callCtx),
      bindings: callCtx.bindings,
    },
    log,
  );

  const isSuccess = result.httpStatus >= 200 && result.httpStatus < 300;
  if (!isSuccess || result.error) {
    const errorCode = result.error?.legacyCode || result.error?.code || 'INTERNAL';
    const errorMessage = result.error?.message || `HTTP ${result.httpStatus}`;
    const err = errorWithCode(errorCode, errorMessage);
    err.httpStatus = result.httpStatus;
    err.httpBody = '';
    err.httpBodyLength = String(result.httpBody ?? '').length;
    throw err;
  }

  return {
    http_status: result.httpStatus,
    http_body: '',
  };
};

const registerHandlers = (ctx = {}) => {
  const callCtx = resolveCallContext(ctx);
  return {
    [METHOD_SEND_TEXT_PATH]: (req = callCtx.req) => handleSendTextMessage(req ?? {}, callCtx),
  };
};

export function rpcdef(ctx = {}) {
  return registerHandlers(ctx);
}

const callSdkHandler = (ctx, path) => registerHandlers(ctx)[path](ctx?.req ?? ctx?.request ?? {});

export const handlers = {
  [METHOD_SEND_TEXT_FULL]: (ctx) => callSdkHandler(ctx, METHOD_SEND_TEXT_PATH),
};

rpcdef.__test__ = {
  assertSupportedTlsConfig,
  buildDingDingPayload,
  buildSignedWebhookUrl,
  coerceString,
  createLogger,
  encodeUtf8,
  errorWithCode,
  firstDefined,
  generateSign,
  hasOwn,
  handleSendTextMessage,
  hmacSha256,
  makeTimeoutSignal,
  mergedBindings,
  readRepeatedStrings,
  redactWebhookUrl,
  registerHandlers,
  resolveBindingString,
  resolveCallContext,
  resolveSigningSecret,
  resolveTimeoutMs,
  resolveWebhookUrl,
  sendToDingTalk,
  tlsSkipRequested,
  toBase64,
  toBoolean,
  urlEncode,
};

export const _test = rpcdef.__test__;

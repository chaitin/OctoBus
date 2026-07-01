import { GrpcError, grpcCodeFor, normalizeTimeoutMs } from '@chaitin-ai/octobus-sdk';

export const METHOD_SEND_TEXT_PATH = '/Slack_GroupRobot.Slack_GroupRobot/SendTextMessage';
export const METHOD_SEND_TEXT_FULL = 'Slack_GroupRobot.Slack_GroupRobot/SendTextMessage';
export const DEFAULT_TIMEOUT_MS = 5000;

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

const normalizeWebhook = (url) => {
  const trimmed = String(url || '').trim();
  if (!trimmed) return '';
  if (!/^https:\/\/hooks\.slack\.com\/services\//i.test(trimmed)) return '';
  return trimmed;
};

const resolveBindingString = (bindings, keys) => {
  for (const key of keys) {
    if (hasOwn(bindings, key)) {
      const value = coerceString(bindings[key]).trim();
      if (value) return value;
    }
  }
  return '';
};

const mergedBindings = (ctx = {}) => ({
  ...(ctx?.config ?? {}),
  ...(ctx?.bindings ?? {}),
  ...(ctx?.secret ?? {}),
});

const resolveWebhook = (ctx = {}) => {
  const keys = ['webhook', 'webhook_url', 'webhookUrl', 'url'];
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

const toBoolean = (candidate) => {
  if (typeof candidate === 'boolean') return candidate;
  if (typeof candidate === 'number') return Number.isFinite(candidate) && candidate !== 0;
  if (typeof candidate === 'string') {
    const normalized = candidate.trim().toLowerCase();
    if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'n', 'off', ''].includes(normalized)) return false;
  }
  if (candidate && typeof candidate === 'object' && hasOwn(candidate, 'value')) return toBoolean(candidate.value);
  return false;
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

const redactWebhook = (url) => String(url).replace(/\/services\/[^/?#]+\/[^/?#]+\/[^/?#]+/, '/services/***/***/***');

const createLogger = (meta = {}) => (action, details) => {
  const inst = meta.instance_id || meta.instanceId;
  const reqId = meta.request_id || meta.requestId;
  const trace = [];
  if (inst) trace.push(`inst=${inst}`);
  if (reqId) trace.push(`req=${reqId}`);
  const prefix = `[Slack_GroupRobot][${action}]${trace.length ? `[${trace.join(' ')}]` : ''}`;
  try {
    console.log(prefix, JSON.stringify(details));
  } catch {
    console.log(prefix, details);
  }
};

const buildPayload = (message) => ({ text: message });

const sendToSlack = async (ctx, webhook, payload, log) => {
  assertSupportedTlsConfig(ctx.bindings || {});
  const timeout = makeTimeoutSignal(resolveTimeoutMs(ctx));
  log('SendTextMessage:start', {
    webhook: redactWebhook(webhook),
    messageLength: payload.text.length,
  });

  let res;
  try {
    res = await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: timeout.signal,
    });
  } catch (err) {
    const reason = err?.cause?.message || err?.message || 'fetch failed';
    log('SendTextMessage:failure', { reason, stage: 'network' });
    const error = errorWithCode('UNAVAILABLE', reason);
    error.httpStatus = 0;
    error.httpBody = '';
    throw error;
  } finally {
    timeout.clear();
  }

  const httpStatus = Number(res.status || 0);
  let httpBody;
  try {
    httpBody = String((await res.text()) ?? '');
  } catch (err) {
    const reason = err?.message || 'read response failed';
    log('SendTextMessage:failure', { reason, stage: 'read', httpStatus });
    const error = errorWithCode('UNAVAILABLE', reason);
    error.httpStatus = httpStatus;
    error.httpBody = '';
    error.httpBodyLength = 0;
    throw error;
  }
  log('SendTextMessage:response', {
    httpStatus,
    httpBodyLength: httpBody.length,
  });

  if (httpStatus !== 200) {
    const err = errorWithCode('UNAVAILABLE', `upstream http ${httpStatus}`);
    err.httpStatus = httpStatus;
    err.httpBody = '';
    err.httpBodyLength = httpBody.length;
    throw err;
  }

  return {
    http_status: httpStatus,
    http_body: '',
  };
};

const handleSendTextMessage = async (req, ctx) => {
  const callCtx = resolveCallContext(ctx);
  const webhook = normalizeWebhook(resolveWebhook(callCtx));
  if (!webhook) {
    throw errorWithCode('INVALID_ARGUMENT', 'webhook is required in instance secret (https://hooks.slack.com/services/T.../B.../xxxx)');
  }

  const message = coerceString(firstDefined(req?.message, req?.send_msg, req?.sendMsg, req?.text)).trim();
  if (!message) {
    throw errorWithCode('INVALID_ARGUMENT', 'message is required');
  }

  return sendToSlack(callCtx, webhook, buildPayload(message), createLogger(callCtx.meta));
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
  buildPayload,
  coerceString,
  createLogger,
  errorWithCode,
  firstDefined,
  handleSendTextMessage,
  hasOwn,
  makeTimeoutSignal,
  mergedBindings,
  normalizeWebhook,
  redactWebhook,
  registerHandlers,
  resolveBindingString,
  resolveCallContext,
  resolveTimeoutMs,
  resolveWebhook,
  sendToSlack,
  tlsSkipRequested,
  toBoolean,
};

export const _test = rpcdef.__test__;

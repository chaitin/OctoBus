import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';

export const METHOD_SEND_TEXT_PATH = '/Slack_GroupRobot.Slack_GroupRobot/SendTextMessage';
export const METHOD_SEND_TEXT_FULL = 'Slack_GroupRobot.Slack_GroupRobot/SendTextMessage';
export const DEFAULT_TIMEOUT_MS = 5000;

const grpcCodeFor = (code) => ({
  INVALID_ARGUMENT: grpcStatus.INVALID_ARGUMENT,
  UNAVAILABLE: grpcStatus.UNAVAILABLE,
})[code] ?? grpcStatus.UNKNOWN;

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
  ...(ctx?.secret ?? {}),
  ...(ctx?.bindings ?? {}),
});

const resolveCallContext = (ctx = {}) => ({
  ...ctx,
  bindings: mergedBindings(ctx),
  limits: ctx.limits ?? {},
  meta: ctx.meta ?? {},
  req: ctx.req ?? ctx.request ?? {},
});

const resolveTimeoutMs = (ctx) => {
  const bindings = mergedBindings(ctx);
  const raw = Number(firstDefined(bindings.timeoutMs, bindings.timeout_ms, ctx?.limits?.timeoutMs, DEFAULT_TIMEOUT_MS));
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TIMEOUT_MS;
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
      timeoutMs: resolveTimeoutMs(ctx),
    });
  } catch (err) {
    const reason = err?.cause?.message || err?.message || 'fetch failed';
    log('SendTextMessage:failure', { reason, stage: 'network' });
    const error = errorWithCode('UNAVAILABLE', reason);
    error.httpStatus = 0;
    error.httpBody = '';
    throw error;
  }

  const httpStatus = Number(res.status || 0);
  const httpBody = String((await res.text()) ?? '');
  log('SendTextMessage:response', {
    httpStatus,
    httpBodyLength: httpBody.length,
  });

  if (httpStatus !== 200) {
    const err = errorWithCode('UNAVAILABLE', `upstream http ${httpStatus}: ${httpBody}`);
    err.httpStatus = httpStatus;
    err.httpBody = httpBody;
    throw err;
  }

  return {
    http_status: httpStatus,
    http_body: httpBody,
  };
};

const handleSendTextMessage = async (req, ctx) => {
  const callCtx = resolveCallContext(ctx);
  const webhook = normalizeWebhook(resolveBindingString(callCtx.bindings, ['webhook', 'webhook_url', 'webhookUrl', 'url']));
  if (!webhook) {
    throw errorWithCode('INVALID_ARGUMENT', 'webhook is required (https://hooks.slack.com/services/T.../B.../xxxx)');
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
  buildPayload,
  coerceString,
  createLogger,
  errorWithCode,
  firstDefined,
  handleSendTextMessage,
  hasOwn,
  mergedBindings,
  normalizeWebhook,
  redactWebhook,
  registerHandlers,
  resolveBindingString,
  resolveCallContext,
  resolveTimeoutMs,
  sendToSlack,
};

export const _test = rpcdef.__test__;

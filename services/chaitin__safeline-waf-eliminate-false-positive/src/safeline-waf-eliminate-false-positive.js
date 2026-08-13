import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';

export const DEFAULT_TIMEOUT_MS = 1500;
export const LOCAL_METHOD = '/safeline.eliminate.EliminateService/EliminateFalsePositive';
export const METHOD_ELIMINATE_FALSE_POSITIVE_FULL = 'safeline.eliminate.EliminateService/EliminateFalsePositive';

const grpcCodeFor = (code) => ({
  INVALID_ARGUMENT: grpcStatus.INVALID_ARGUMENT,
  FAILED_PRECONDITION: grpcStatus.FAILED_PRECONDITION,
})[code] ?? grpcStatus.UNKNOWN;

const errorWithCode = (code, message) => {
  const err = new GrpcError(grpcCodeFor(code), `${code}: ${message}`);
  err.legacyCode = code;
  return err;
};

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj ?? {}, key);

const unwrapValue = (val) => {
  if (val && typeof val === 'object' && hasOwn(val, 'value')) {
    return val.value;
  }
  return val;
};

const trimString = (val) => String(unwrapValue(val) ?? '').trim();

const requireNonEmptyString = (value, field) => {
  const text = trimString(value);
  if (!text) {
    throw errorWithCode('INVALID_ARGUMENT', `${field} is required`);
  }
  return text;
};

const requireBoolean = (value, field) => {
  const normalized = unwrapValue(value);
  if (typeof normalized !== 'boolean') {
    throw errorWithCode('INVALID_ARGUMENT', `${field} must be a boolean`);
  }
  return normalized;
};

const firstDefined = (...vals) => vals.find((val) => val !== undefined && val !== null);

const mergedBindings = (ctx = {}) => ({
  ...(ctx?.config ?? {}),
  ...(ctx?.secret ?? {}),
  ...(ctx?.bindings ?? {}),
});

const resolveCallContext = (ctx = {}) => {
  const bindings = mergedBindings(ctx);
  const request = ctx.request ?? ctx.req ?? {};
  const target = firstDefined(request.target, request.upstream_target, bindings.target, bindings.upstreamTarget, bindings.upstream_target);
  const method = firstDefined(request.method, request.upstream_method, bindings.method, bindings.upstreamMethod, bindings.upstream_method);
  const timeoutMs = firstDefined(ctx.limits?.timeoutMs, request.timeoutMs, request.timeout_ms, bindings.timeoutMs, bindings.timeout_ms);
  const req = { ...request };
  if (target !== undefined && target !== null) {
    req.target = target;
  }
  if (method !== undefined && method !== null) {
    req.method = method;
  }
  const limits = { ...(ctx.limits ?? {}) };
  if (timeoutMs !== undefined && timeoutMs !== null) {
    limits.timeoutMs = timeoutMs;
  }
  return {
    req,
    limits,
    ...(hasOwn(ctx, 'proxy') ? { proxy: ctx.proxy } : {}),
    ...(hasOwn(ctx, 'toGrpc') ? { toGrpc: ctx.toGrpc } : {}),
  };
};

const normalizeUpstreamMethod = (raw) => {
  const method = requireNonEmptyString(raw, 'method');
  return method.startsWith('/') ? method : `/${method}`;
};

const normalizeTarget = (raw) => requireNonEmptyString(raw, 'target');

const normalizeEventId = (raw) => requireNonEmptyString(raw, 'event_id');

const normalizeIsGlobal = (raw) => requireBoolean(raw, 'is_global');

const normalizeTimeoutMs = (raw) => {
  const timeout = Number(unwrapValue(raw));
  return Number.isFinite(timeout) && timeout > 0 ? timeout : DEFAULT_TIMEOUT_MS;
};

const getProxyToGrpc = (ctx = {}) => {
  const proxy = ctx.proxy;
  const toGrpc = proxy?.toGrpc ?? ctx.toGrpc;
  if (typeof toGrpc !== 'function') {
    throw errorWithCode('FAILED_PRECONDITION', 'ctx.proxy.toGrpc is required');
  }
  return proxy && proxy.toGrpc === toGrpc ? toGrpc.bind(proxy) : toGrpc.bind(ctx);
};

const isValidationMode = (ctx) => {
  const req = ctx?.req || {};
  const keys = ['target', 'method', 'event_id', 'is_global'];
  return !keys.some((key) => hasOwn(req, key));
};

const buildProxyAction = (ctx) => {
  const req = ctx.req || {};
  const toGrpc = getProxyToGrpc(ctx);

  if (isValidationMode(ctx)) {
    return toGrpc({
      target: '0.0.0.0:0',
      fullMethod: LOCAL_METHOD,
      request: { event_id: '', is_global: false },
      timeoutMs: DEFAULT_TIMEOUT_MS,
    });
  }

  const target = normalizeTarget(req.target);
  const upstreamMethod = normalizeUpstreamMethod(req.method);
  const eventId = normalizeEventId(req.event_id);
  const isGlobal = normalizeIsGlobal(req.is_global);
  const timeoutMs = normalizeTimeoutMs(ctx.limits?.timeoutMs);

  return toGrpc({
    target,
    fullMethod: upstreamMethod,
    request: {
      event_id: eventId,
      is_global: isGlobal,
    },
    timeoutMs,
  });
};

export function rpcdef(ctx = {}) {
  const callCtx = resolveCallContext(ctx);
  return {
    [LOCAL_METHOD]: buildProxyAction(callCtx),
  };
}

const eliminateFalsePositiveHandler = (ctx = {}) => rpcdef(ctx)[LOCAL_METHOD];

export const handlers = {
  [METHOD_ELIMINATE_FALSE_POSITIVE_FULL]: eliminateFalsePositiveHandler,
};

export const _test = {
  buildProxyAction,
  errorWithCode,
  getProxyToGrpc,
  isValidationMode,
  mergedBindings,
  normalizeTimeoutMs,
  resolveCallContext,
  unwrapValue,
};

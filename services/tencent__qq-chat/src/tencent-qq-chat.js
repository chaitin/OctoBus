import fs from "node:fs";
import { GrpcError, grpcStatus } from "@chaitin-ai/octobus-sdk";

export const METHOD_GET_ACCESS_TOKEN_PATH = "/Tencent_QQ_Chat.Tencent_QQ_Chat/GetAccessToken";
export const METHOD_START_GATEWAY_PATH = "/Tencent_QQ_Chat.Tencent_QQ_Chat/StartGateway";
export const METHOD_STOP_GATEWAY_PATH = "/Tencent_QQ_Chat.Tencent_QQ_Chat/StopGateway";
export const METHOD_GET_GATEWAY_STATUS_PATH = "/Tencent_QQ_Chat.Tencent_QQ_Chat/GetGatewayStatus";
export const METHOD_POLL_MESSAGES_PATH = "/Tencent_QQ_Chat.Tencent_QQ_Chat/PollMessages";
export const METHOD_ACK_MESSAGE_PATH = "/Tencent_QQ_Chat.Tencent_QQ_Chat/AckMessage";
export const METHOD_SEND_C2C_MESSAGE_PATH = "/Tencent_QQ_Chat.Tencent_QQ_Chat/SendC2CMessage";
export const METHOD_SEND_GROUP_MESSAGE_PATH = "/Tencent_QQ_Chat.Tencent_QQ_Chat/SendGroupMessage";
export const METHOD_NORMALIZE_EVENT_PATH = "/Tencent_QQ_Chat.Tencent_QQ_Chat/NormalizeEvent";

export const METHOD_GET_ACCESS_TOKEN_FULL = "Tencent_QQ_Chat.Tencent_QQ_Chat/GetAccessToken";
export const METHOD_START_GATEWAY_FULL = "Tencent_QQ_Chat.Tencent_QQ_Chat/StartGateway";
export const METHOD_STOP_GATEWAY_FULL = "Tencent_QQ_Chat.Tencent_QQ_Chat/StopGateway";
export const METHOD_GET_GATEWAY_STATUS_FULL = "Tencent_QQ_Chat.Tencent_QQ_Chat/GetGatewayStatus";
export const METHOD_POLL_MESSAGES_FULL = "Tencent_QQ_Chat.Tencent_QQ_Chat/PollMessages";
export const METHOD_ACK_MESSAGE_FULL = "Tencent_QQ_Chat.Tencent_QQ_Chat/AckMessage";
export const METHOD_SEND_C2C_MESSAGE_FULL = "Tencent_QQ_Chat.Tencent_QQ_Chat/SendC2CMessage";
export const METHOD_SEND_GROUP_MESSAGE_FULL = "Tencent_QQ_Chat.Tencent_QQ_Chat/SendGroupMessage";
export const METHOD_NORMALIZE_EVENT_FULL = "Tencent_QQ_Chat.Tencent_QQ_Chat/NormalizeEvent";

export const DEFAULT_API_BASE_URL = "https://api.sgroup.qq.com";
export const DEFAULT_TOKEN_URL = "https://bots.qq.com/app/getAppAccessToken";
export const DEFAULT_TIMEOUT_MS = 5000;
export const DEFAULT_GATEWAY_INTENTS = 1 << 25;
export const DEFAULT_GATEWAY_RECONNECT_MS = 5000;
export const DEFAULT_MAX_BUFFERED_MESSAGES = 1000;

const tokenCache = new Map();

const gatewayState = {
  running: false,
  ready: false,
  state: "stopped",
  sessionId: "",
  gatewayUrl: "",
  lastEventType: "",
  lastError: "",
  startedAt: "",
  lastEventAt: "",
  lastHeartbeatAckAt: "",
  queue: [],
  droppedMessages: 0,
  reconnectCount: 0,
  intents: DEFAULT_GATEWAY_INTENTS,
  seq: null,
  ws: null,
  heartbeatTimer: null,
  reconnectTimer: null,
  awaitingHeartbeatAck: false,
  ctx: null,
  localMessageSeq: 0,
  connectionId: 0,
};

const grpcCodeFor = (code) => ({
  FAILED_PRECONDITION: grpcStatus.FAILED_PRECONDITION,
  INVALID_ARGUMENT: grpcStatus.INVALID_ARGUMENT,
  PERMISSION_DENIED: grpcStatus.PERMISSION_DENIED,
  UNAUTHENTICATED: grpcStatus.UNAUTHENTICATED,
  UNAVAILABLE: grpcStatus.UNAVAILABLE,
  UNKNOWN: grpcStatus.UNKNOWN,
})[code] ?? grpcStatus.UNKNOWN;

const errorWithCode = (code, message) => {
  const err = new GrpcError(grpcCodeFor(code), message);
  err.legacyCode = code;
  return err;
};

const upstreamError = (code, message, details = {}) => {
  const err = errorWithCode(code, message);
  err.httpStatus = Number.isFinite(Number(details.httpStatus)) ? Number(details.httpStatus) : 0;
  err.httpBody = typeof details.httpBody === "string" ? details.httpBody : "";
  err.responseCode = Number.isFinite(Number(details.responseCode)) ? Number(details.responseCode) : undefined;
  err.responseMessage = typeof details.responseMessage === "string" ? details.responseMessage : "";
  return err;
};

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj ?? {}, key);

const unwrapScalar = (value) => {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "object" && value !== null && hasOwn(value, "value")) return unwrapScalar(value.value);
  return value;
};

const firstDefined = (...values) => values.find((value) => value !== undefined && value !== null);

const toTrimmedString = (value) => {
  const raw = unwrapScalar(value);
  if (raw === undefined || raw === null) return "";
  return String(raw).trim();
};

const toBoolean = (value) => {
  const raw = unwrapScalar(value);
  if (typeof raw === "boolean") return raw;
  if (typeof raw === "number") return Number.isFinite(raw) && raw !== 0;
  if (typeof raw === "string") {
    const text = raw.trim().toLowerCase();
    if (["1", "true", "yes", "y", "on"].includes(text)) return true;
    if (["0", "false", "no", "n", "off", ""].includes(text)) return false;
  }
  return false;
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

const optionalUint32 = (value) => {
  const raw = unwrapScalar(value);
  if (raw === undefined || raw === null || raw === "") return undefined;
  const num = Number(raw);
  if (!Number.isFinite(num) || num <= 0) return undefined;
  return Math.trunc(num);
};

const resolveTimeoutMs = (ctx = {}) => {
  const bindings = ctx.bindings || mergedBindings(ctx);
  return optionalUint32(ctx.limits?.timeoutMs) ?? optionalUint32(bindings.timeoutMs) ?? optionalUint32(bindings.timeout_ms) ?? DEFAULT_TIMEOUT_MS;
};

const createTimeoutSignal = (timeoutMs) => {
  if (typeof globalThis.AbortSignal?.timeout === "function") return globalThis.AbortSignal.timeout(timeoutMs);
  const controller = new globalThis.AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();
  return controller.signal;
};

const fetchWithTimeout = (url, init = {}, timeoutMs = DEFAULT_TIMEOUT_MS) => fetch(url, {
  ...init,
  signal: init.signal ?? createTimeoutSignal(timeoutMs),
});

const optionalIntWithDefault = (value, fallback, minimum = 0) => {
  const parsed = optionalUint32(value);
  if (parsed === undefined || parsed < minimum) return fallback;
  return parsed;
};

const resolveGatewayIntents = (bindings = {}) => optionalIntWithDefault(firstDefined(bindings.gatewayIntents, bindings.gateway_intents), DEFAULT_GATEWAY_INTENTS, 1);
const resolveGatewayShardIndex = (bindings = {}) => optionalIntWithDefault(firstDefined(bindings.gatewayShardIndex, bindings.gateway_shard_index), 0, 0);
const resolveGatewayShardCount = (bindings = {}) => optionalIntWithDefault(firstDefined(bindings.gatewayShardCount, bindings.gateway_shard_count), 1, 1);
const resolveMaxBufferedMessages = (bindings = {}) => optionalIntWithDefault(firstDefined(bindings.maxBufferedMessages, bindings.max_buffered_messages), DEFAULT_MAX_BUFFERED_MESSAGES, 1);
const resolveGatewayReconnectMs = (bindings = {}) => optionalIntWithDefault(firstDefined(bindings.gatewayReconnectMs, bindings.gateway_reconnect_ms), DEFAULT_GATEWAY_RECONNECT_MS, 100);
const resolveAutoStartGateway = (bindings = {}) => toBoolean(firstDefined(bindings.autoStartGateway, bindings.auto_start_gateway));

const requireString = (value, fieldName) => {
  const text = toTrimmedString(value);
  if (!text) throw errorWithCode("INVALID_ARGUMENT", `${fieldName} is required`);
  return text;
};

const optionalInt32 = (value) => {
  const raw = unwrapScalar(value);
  if (raw === undefined || raw === null || raw === "") return undefined;
  const num = Number(raw);
  if (!Number.isFinite(num)) return undefined;
  return Math.trunc(num);
};

const normalizeBaseUrl = (value, fallback, fieldName) => {
  const raw = toTrimmedString(value) || fallback;
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw errorWithCode("INVALID_ARGUMENT", `${fieldName} must be a valid HTTP/HTTPS URL`);
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw errorWithCode("INVALID_ARGUMENT", `${fieldName} must be a valid HTTP/HTTPS URL`);
  }
  parsed.pathname = parsed.pathname.replace(/\/+$/, "");
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString().replace(/\/$/, "");
};

const resolveApiBaseUrl = (bindings = {}) => normalizeBaseUrl(firstDefined(bindings.baseUrl, bindings.base_url), DEFAULT_API_BASE_URL, "baseUrl");
const resolveTokenUrl = (bindings = {}) => normalizeBaseUrl(firstDefined(bindings.tokenUrl, bindings.token_url), DEFAULT_TOKEN_URL, "tokenUrl");
const resolveAppId = (bindings = {}) => toTrimmedString(firstDefined(bindings.appId, bindings.app_id));
const resolveAppSecret = (bindings = {}) => toTrimmedString(firstDefined(bindings.appSecret, bindings.app_secret, bindings.clientSecret, bindings.client_secret));
const resolveConfiguredAccessToken = (bindings = {}) => toTrimmedString(firstDefined(bindings.accessToken, bindings.access_token));

const parseJsonBody = (bodyText, label = "response") => {
  const text = String(bodyText ?? "");
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw upstreamError("UNKNOWN", `qq bot ${label} body is not valid JSON`, { httpBody: text });
  }
};

const mapHttpStatusToCode = (status) => {
  if (status === 401) return "UNAUTHENTICATED";
  if (status === 403) return "PERMISSION_DENIED";
  if (status === 429) return "UNAVAILABLE";
  if (status >= 400 && status < 500) return "FAILED_PRECONDITION";
  if (status >= 500) return "UNAVAILABLE";
  return "UNKNOWN";
};

const mapErrorBodyToCode = (body = {}) => {
  const code = Number(body.code ?? body.errcode);
  if (code === 0 || !Number.isFinite(code)) return "UNKNOWN";
  if ([401, 11263].includes(code)) return "UNAUTHENTICATED";
  if ([403, 11264].includes(code)) return "PERMISSION_DENIED";
  if (code === 22009 || code === 429) return "UNAVAILABLE";
  return "FAILED_PRECONDITION";
};

const tokenCacheKey = (tokenUrl, appId, appSecret) => `${tokenUrl}\n${appId}\n${appSecret}`;

const readTokenCache = (key, nowMs = Date.now()) => {
  const cached = tokenCache.get(key);
  if (!cached || !cached.accessToken) return "";
  if (cached.expiresAtMs <= nowMs + 60_000) return "";
  return cached.accessToken;
};

const writeTokenCache = (key, accessToken, expiresIn, nowMs = Date.now()) => {
  const ttlMs = Math.max(0, Number(expiresIn || 0) * 1000);
  tokenCache.set(key, {
    accessToken,
    expiresAtMs: nowMs + ttlMs,
    expiresIn: Number(expiresIn || 0),
  });
};

const deleteTokenCache = (ctx = {}) => {
  const bindings = resolveCallContext(ctx).bindings || {};
  const appId = resolveAppId(bindings);
  const appSecret = resolveAppSecret(bindings);
  if (!appId || !appSecret) return;
  tokenCache.delete(tokenCacheKey(resolveTokenUrl(bindings), appId, appSecret));
};

const fetchAppAccessToken = async (ctx = {}, forceRefresh = false) => {
  const callCtx = resolveCallContext(ctx);
  const bindings = callCtx.bindings || {};
  const configured = resolveConfiguredAccessToken(bindings);
  if (configured && !forceRefresh) {
    return {
      success: true,
      http_status: 0,
      access_token: configured,
      expires_in: 0,
      http_body: "",
    };
  }

  const appId = requireString(resolveAppId(bindings), "appId");
  const appSecret = requireString(resolveAppSecret(bindings), "appSecret");
  const tokenUrl = resolveTokenUrl(bindings);
  const cacheKey = tokenCacheKey(tokenUrl, appId, appSecret);
  const cachedToken = forceRefresh ? "" : readTokenCache(cacheKey);
  if (cachedToken) {
    return {
      success: true,
      http_status: 0,
      access_token: cachedToken,
      expires_in: 0,
      http_body: "",
    };
  }

  let response;
  try {
    response = await fetchWithTimeout(tokenUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, */*;q=0.8",
      },
      body: JSON.stringify({ appId, clientSecret: appSecret }),
    }, resolveTimeoutMs(callCtx));
  } catch (err) {
    throw upstreamError("UNAVAILABLE", "qq bot access token request failed", {
      httpStatus: 0,
      responseMessage: err?.cause?.message || err?.message || "fetch failed",
    });
  }

  const httpStatus = Number(response.status || 0);
  const httpBody = String((await response.text()) ?? "");
  const body = parseJsonBody(httpBody, "access token response");
  if (httpStatus < 200 || httpStatus >= 300) {
    throw upstreamError(mapHttpStatusToCode(httpStatus), `qq bot token http ${httpStatus}`, {
      httpStatus,
      httpBody,
      responseCode: body.code ?? body.errcode,
      responseMessage: body.message ?? body.errmsg,
    });
  }

  const accessToken = requireString(body.access_token, "access_token");
  const expiresIn = optionalInt32(body.expires_in) ?? 0;
  writeTokenCache(cacheKey, accessToken, expiresIn);
  return {
    success: true,
    http_status: httpStatus,
    access_token: accessToken,
    expires_in: expiresIn,
    http_body: httpBody,
  };
};

const resolveAccessToken = async (ctx = {}) => {
  const callCtx = resolveCallContext(ctx);
  const configured = resolveConfiguredAccessToken(callCtx.bindings || {});
  if (configured) return configured;
  return (await fetchAppAccessToken(callCtx, false)).access_token;
};

const gatewayStatus = () => ({
  running: gatewayState.running,
  ready: gatewayState.ready,
  state: gatewayState.state,
  session_id: gatewayState.sessionId,
  gateway_url: gatewayState.gatewayUrl,
  last_event_type: gatewayState.lastEventType,
  last_error: gatewayState.lastError,
  started_at: gatewayState.startedAt,
  last_event_at: gatewayState.lastEventAt,
  last_heartbeat_ack_at: gatewayState.lastHeartbeatAckAt,
  queue_size: gatewayState.queue.length,
  dropped_messages: gatewayState.droppedMessages,
  reconnect_count: gatewayState.reconnectCount,
  intents: gatewayState.intents,
});

const clearGatewayTimers = () => {
  if (gatewayState.heartbeatTimer) clearInterval(gatewayState.heartbeatTimer);
  if (gatewayState.reconnectTimer) clearTimeout(gatewayState.reconnectTimer);
  gatewayState.heartbeatTimer = null;
  gatewayState.reconnectTimer = null;
};

const closeGatewaySocket = () => {
  const ws = gatewayState.ws;
  gatewayState.ws = null;
  clearGatewayTimers();
  if (!ws) return;
  try {
    ws.__octobusIntentionalClose = true;
    ws.close();
  } catch {
    // Ignore best-effort close errors.
  }
};

const gatewayReceiveTargets = new Set([
  "C2C_MESSAGE_CREATE",
  "GROUP_AT_MESSAGE_CREATE",
  "GROUP_MESSAGE_CREATE",
  "DIRECT_MESSAGE_CREATE",
  "AT_MESSAGE_CREATE",
  "MESSAGE_CREATE",
]);

const enqueueGatewayMessage = async (payload) => {
  const event = await handleNormalizeEvent({ payload_json: JSON.stringify(payload) });
  if (!event.is_message) return;
  const maxBuffered = resolveMaxBufferedMessages(gatewayState.ctx?.bindings || {});
  gatewayState.localMessageSeq += 1;
  gatewayState.queue.push({
    local_id: String(gatewayState.localMessageSeq),
    received_at: new Date().toISOString(),
    event,
  });
  while (gatewayState.queue.length > maxBuffered) {
    gatewayState.queue.shift();
    gatewayState.droppedMessages += 1;
  }
};

const fetchGatewayInfo = async (ctx = {}, accessToken) => {
  const baseUrl = resolveApiBaseUrl(resolveCallContext(ctx).bindings || {});
  let response;
  try {
    response = await fetchWithTimeout(buildApiUrl(baseUrl, "gateway/bot"), {
      method: "GET",
      headers: {
        authorization: `QQBot ${accessToken}`,
        accept: "application/json, */*;q=0.8",
      },
    }, resolveTimeoutMs(ctx));
  } catch (err) {
    throw upstreamError("UNAVAILABLE", "qq bot gateway request failed", {
      responseMessage: err?.cause?.message || err?.message || "fetch failed",
    });
  }
  const httpStatus = Number(response.status || 0);
  const httpBody = String((await response.text()) ?? "");
  const body = parseJsonBody(httpBody, "gateway response");
  if (httpStatus < 200 || httpStatus >= 300 || !body.url) {
    throw upstreamError(mapHttpStatusToCode(httpStatus), `qq bot gateway http ${httpStatus}`, {
      httpStatus,
      httpBody,
      responseCode: body.code ?? body.errcode,
      responseMessage: body.message ?? body.errmsg,
    });
  }
  return body;
};

const scheduleGatewayReconnect = () => {
  if (!gatewayState.running || gatewayState.reconnectTimer) return;
  const delayMs = resolveGatewayReconnectMs(gatewayState.ctx?.bindings || {});
  gatewayState.state = "reconnecting";
  gatewayState.reconnectTimer = setTimeout(() => {
    gatewayState.reconnectTimer = null;
    gatewayState.reconnectCount += 1;
    connectGateway().catch((err) => {
      gatewayState.lastError = err?.message || String(err);
      scheduleGatewayReconnect();
    });
  }, delayMs);
};

const identifyGateway = (accessToken) => {
  const bindings = gatewayState.ctx?.bindings || {};
  const shardIndex = resolveGatewayShardIndex(bindings);
  const shardCount = resolveGatewayShardCount(bindings);
  gatewayState.ws?.send(JSON.stringify({
    op: 2,
    d: {
      token: `QQBot ${accessToken}`,
      intents: gatewayState.intents,
      shard: [shardIndex, shardCount],
      properties: {},
    },
  }));
};

const resumeGateway = (accessToken) => {
  gatewayState.ws?.send(JSON.stringify({
    op: 6,
    d: {
      token: `QQBot ${accessToken}`,
      session_id: gatewayState.sessionId,
      seq: gatewayState.seq,
    },
  }));
};

const sendHeartbeat = () => {
  if (!gatewayState.ws || gatewayState.ws.readyState !== WebSocket.OPEN) return;
  if (gatewayState.awaitingHeartbeatAck) {
    gatewayState.lastError = "gateway heartbeat acknowledgement timed out";
    closeGatewaySocket();
    scheduleGatewayReconnect();
    return;
  }
  gatewayState.ws.send(JSON.stringify({ op: 1, d: gatewayState.seq }));
  gatewayState.awaitingHeartbeatAck = true;
};

const handleGatewayPayload = async (payload, accessToken) => {
  if (payload.s !== undefined && payload.s !== null) gatewayState.seq = payload.s;
  if (payload.t) gatewayState.lastEventType = String(payload.t);

  if (payload.op === 10) {
    const interval = Number(payload.d?.heartbeat_interval || 45_000);
    if (gatewayState.heartbeatTimer) clearInterval(gatewayState.heartbeatTimer);
    gatewayState.heartbeatTimer = setInterval(sendHeartbeat, interval);
    gatewayState.awaitingHeartbeatAck = false;
    if (gatewayState.sessionId && gatewayState.seq !== null) resumeGateway(accessToken);
    else identifyGateway(accessToken);
    return;
  }
  if (payload.op === 11) {
    gatewayState.awaitingHeartbeatAck = false;
    gatewayState.lastHeartbeatAckAt = new Date().toISOString();
    return;
  }
  if (payload.op === 7 || payload.op === 9) {
    gatewayState.lastError = payload.op === 7 ? "gateway requested reconnect" : "gateway invalid session";
    if (payload.op === 9) {
      gatewayState.sessionId = "";
      gatewayState.seq = null;
    }
    closeGatewaySocket();
    scheduleGatewayReconnect();
    return;
  }
  if (payload.op !== 0) return;

  gatewayState.lastEventAt = new Date().toISOString();
  if (payload.t === "READY") {
    gatewayState.ready = true;
    gatewayState.state = "ready";
    gatewayState.sessionId = toTrimmedString(payload.d?.session_id);
    return;
  }
  if (gatewayReceiveTargets.has(String(payload.t))) {
    await enqueueGatewayMessage(payload);
  }
};

const connectGateway = async () => {
  if (!gatewayState.running || !gatewayState.ctx) return;
  const connectionId = gatewayState.connectionId + 1;
  gatewayState.connectionId = connectionId;
  gatewayState.state = "connecting";
  gatewayState.ready = false;
  gatewayState.lastError = "";
  gatewayState.awaitingHeartbeatAck = false;
  clearGatewayTimers();
  closeGatewaySocket();

  const accessToken = await resolveAccessToken(gatewayState.ctx);
  const gatewayInfo = await fetchGatewayInfo(gatewayState.ctx, accessToken);
  gatewayState.gatewayUrl = toTrimmedString(gatewayInfo.url);

  const WebSocketCtor = globalThis.WebSocket;
  if (typeof WebSocketCtor !== "function") {
    throw errorWithCode("FAILED_PRECONDITION", "global WebSocket is not available in this Node.js runtime");
  }

  const ws = new WebSocketCtor(gatewayState.gatewayUrl);
  gatewayState.ws = ws;

  ws.addEventListener("open", () => {
    if (gatewayState.ws !== ws || gatewayState.connectionId !== connectionId) return;
    gatewayState.state = "open";
  });
  ws.addEventListener("message", (event) => {
    Promise.resolve()
      .then(async () => {
        if (gatewayState.ws !== ws || gatewayState.connectionId !== connectionId) return;
        const payload = JSON.parse(String(event.data));
        await handleGatewayPayload(payload, accessToken);
      })
      .catch((err) => {
        gatewayState.lastError = err?.message || String(err);
      });
  });
  ws.addEventListener("error", (event) => {
    if (gatewayState.ws !== ws || gatewayState.connectionId !== connectionId) return;
    gatewayState.lastError = event?.message || "gateway websocket error";
  });
  ws.addEventListener("close", () => {
    const intentional = ws.__octobusIntentionalClose === true;
    if (gatewayState.ws !== ws || gatewayState.connectionId !== connectionId) return;
    gatewayState.ws = null;
    gatewayState.ready = false;
    clearGatewayTimers();
    if (intentional) {
      if (!gatewayState.running) gatewayState.state = "stopped";
      return;
    }
    if (gatewayState.running) scheduleGatewayReconnect();
    else gatewayState.state = "stopped";
  });
};

const startGateway = async (ctx = {}, forceRestart = false) => {
  const callCtx = resolveCallContext(ctx);
  if (gatewayState.running && !forceRestart) return gatewayStatus();
  await stopGateway();
  gatewayState.running = true;
  gatewayState.ready = false;
  gatewayState.state = "starting";
  gatewayState.startedAt = new Date().toISOString();
  gatewayState.ctx = callCtx;
  gatewayState.intents = resolveGatewayIntents(callCtx.bindings || {});
  gatewayState.seq = null;
  try {
    await connectGateway();
  } catch (err) {
    gatewayState.lastError = err?.message || String(err);
    gatewayState.state = "reconnecting";
    scheduleGatewayReconnect();
  }
  return gatewayStatus();
};

const stopGateway = async () => {
  gatewayState.running = false;
  gatewayState.ready = false;
  gatewayState.state = "stopped";
  gatewayState.awaitingHeartbeatAck = false;
  clearGatewayTimers();
  closeGatewaySocket();
  return gatewayStatus();
};

const pollMessages = (req = {}) => {
  const maxMessages = optionalIntWithDefault(firstDefined(req.max_messages, req.maxMessages), 10, 1);
  const messages = gatewayState.queue.slice(0, maxMessages);
  if (toBoolean(req.ack)) {
    gatewayState.queue.splice(0, messages.length);
  }
  return {
    messages,
    queue_size: gatewayState.queue.length,
  };
};

const ackMessage = (req = {}) => {
  if (toBoolean(req.all)) {
    const acked = gatewayState.queue.length;
    gatewayState.queue = [];
    return { acked, queue_size: 0 };
  }
  const rawIds = firstDefined(req.local_id, req.localId);
  const ids = Array.isArray(rawIds) ? rawIds.map(toTrimmedString).filter(Boolean) : [];
  const idSet = new Set(ids);
  const before = gatewayState.queue.length;
  gatewayState.queue = gatewayState.queue.filter((message) => !idSet.has(message.local_id));
  return {
    acked: before - gatewayState.queue.length,
    queue_size: gatewayState.queue.length,
  };
};

const buildJsonObject = (jsonText, fieldName) => {
  const text = toTrimmedString(jsonText);
  if (!text) return undefined;
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error(`${fieldName} must be a JSON object`);
    }
    return parsed;
  } catch (err) {
    throw errorWithCode("INVALID_ARGUMENT", err?.message || `${fieldName} must be valid JSON`);
  }
};

const addJsonObject = (payload, fieldName, jsonText) => {
  const parsed = buildJsonObject(jsonText, `${fieldName}_json`);
  if (parsed !== undefined) payload[fieldName] = parsed;
};

const buildMessagePayload = (req = {}, options = {}) => {
  const msgType = optionalInt32(firstDefined(req.msg_type, req.msgType)) ?? 0;
  const payload = { msg_type: msgType };
  const content = toTrimmedString(req.content);
  if (content) payload.content = content;
  if (msgType === 0 && !content) throw errorWithCode("INVALID_ARGUMENT", "content is required for text messages");

  addJsonObject(payload, "markdown", firstDefined(req.markdown_json, req.markdownJson));
  addJsonObject(payload, "keyboard", firstDefined(req.keyboard_json, req.keyboardJson));
  addJsonObject(payload, "ark", firstDefined(req.ark_json, req.arkJson));
  addJsonObject(payload, "media", firstDefined(req.media_json, req.mediaJson));
  addJsonObject(payload, "message_reference", firstDefined(req.message_reference_json, req.messageReferenceJson));

  const eventId = toTrimmedString(firstDefined(req.event_id, req.eventId));
  const msgId = toTrimmedString(firstDefined(req.msg_id, req.msgId));
  const msgSeq = optionalInt32(firstDefined(req.msg_seq, req.msgSeq));
  if (eventId) payload.event_id = eventId;
  if (msgId) payload.msg_id = msgId;
  if (msgSeq !== undefined) payload.msg_seq = msgSeq;
  if (options.allowWakeup && toBoolean(firstDefined(req.is_wakeup, req.isWakeup))) payload.is_wakeup = true;
  return payload;
};

const buildApiUrl = (baseUrl, path) => new URL(path, `${baseUrl}/`).toString();

const callOpenApi = async (ctx = {}, path, payload = {}, retried = false) => {
  const callCtx = resolveCallContext(ctx);
  const baseUrl = resolveApiBaseUrl(callCtx.bindings || {});
  const accessToken = await resolveAccessToken(callCtx);
  const url = buildApiUrl(baseUrl, path.replace(/^\/+/, ""));

  let response;
  try {
    response = await fetchWithTimeout(url, {
      method: "POST",
      headers: {
        authorization: `QQBot ${accessToken}`,
        "content-type": "application/json",
        accept: "application/json, */*;q=0.8",
      },
      body: JSON.stringify(payload),
    }, resolveTimeoutMs(callCtx));
  } catch (err) {
    throw upstreamError("UNAVAILABLE", "qq bot openapi request failed", {
      httpStatus: 0,
      responseMessage: err?.cause?.message || err?.message || "fetch failed",
    });
  }

  const httpStatus = Number(response.status || 0);
  const httpBody = String((await response.text()) ?? "");
  const body = parseJsonBody(httpBody, "openapi response");
  if (httpStatus === 401 && !retried && !resolveConfiguredAccessToken(callCtx.bindings || {})) {
    deleteTokenCache(callCtx);
    await fetchAppAccessToken(callCtx, true);
    return callOpenApi(callCtx, path, payload, true);
  }
  if (httpStatus < 200 || httpStatus >= 300) {
    throw upstreamError(mapHttpStatusToCode(httpStatus), `qq bot openapi http ${httpStatus}`, {
      httpStatus,
      httpBody,
      responseCode: body.code ?? body.errcode,
      responseMessage: body.message ?? body.errmsg,
    });
  }
  if (body.code !== undefined && Number(body.code) !== 0) {
    throw upstreamError(mapErrorBodyToCode(body), "qq bot openapi business failure", {
      httpStatus,
      httpBody,
      responseCode: body.code,
      responseMessage: body.message,
    });
  }
  return { httpStatus, httpBody, body };
};

const buildSendMessageResponse = ({ httpStatus, httpBody, body }) => ({
  success: true,
  http_status: httpStatus,
  id: toTrimmedString(body.id),
  timestamp: toTrimmedString(body.timestamp),
  http_body: httpBody,
});

const handleGetAccessToken = async (req = {}, ctx = {}) => fetchAppAccessToken(ctx, toBoolean(firstDefined(req.force_refresh, req.forceRefresh)));

const handleStartGateway = async (req = {}, ctx = {}) => startGateway(ctx, toBoolean(firstDefined(req.force_restart, req.forceRestart)));
const handleStopGateway = async () => stopGateway();
const handleGetGatewayStatus = async () => gatewayStatus();
const handlePollMessages = async (req = {}) => pollMessages(req);
const handleAckMessage = async (req = {}) => ackMessage(req);

const handleSendC2CMessage = async (req = {}, ctx = {}) => {
  const openid = requireString(firstDefined(req.openid, req.openId), "openid");
  const payload = buildMessagePayload(req, { allowWakeup: true });
  return buildSendMessageResponse(await callOpenApi(ctx, `/v2/users/${encodeURIComponent(openid)}/messages`, payload));
};

const handleSendGroupMessage = async (req = {}, ctx = {}) => {
  const groupOpenid = requireString(firstDefined(req.group_openid, req.groupOpenid), "group_openid");
  const payload = buildMessagePayload(req, { allowWakeup: false });
  return buildSendMessageResponse(await callOpenApi(ctx, `/v2/groups/${encodeURIComponent(groupOpenid)}/messages`, payload));
};

const parsePayload = (req = {}) => {
  const candidate = firstDefined(req.payload_json, req.payloadJson, req.payload);
  if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) return candidate;
  const text = toTrimmedString(candidate);
  if (!text) throw errorWithCode("INVALID_ARGUMENT", "payload_json is required");
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("payload_json must be a JSON object");
    }
    return parsed;
  } catch (err) {
    throw errorWithCode("INVALID_ARGUMENT", err?.message || "payload_json must be valid JSON");
  }
};

const stringifyId = (value) => {
  const raw = unwrapScalar(value);
  if (raw === undefined || raw === null || raw === "") return "";
  if (typeof raw === "number" && Number.isFinite(raw)) return String(Math.trunc(raw));
  return String(raw);
};

const eventData = (payload = {}) => {
  if (payload.d && typeof payload.d === "object" && !Array.isArray(payload.d)) return payload.d;
  return payload;
};

const handleNormalizeEvent = async (req = {}) => {
  const payload = parsePayload(req);
  const data = eventData(payload);
  const author = data.author && typeof data.author === "object" ? data.author : {};
  const eventType = stringifyId(payload.t ?? data.t);
  const openid = stringifyId(author.user_openid ?? author.member_openid ?? author.id ?? data.openid);
  const groupOpenid = stringifyId(data.group_openid);
  const channelId = stringifyId(data.channel_id);
  const guildId = stringifyId(data.guild_id);
  const messageTypes = new Set(["C2C_MESSAGE_CREATE", "GROUP_AT_MESSAGE_CREATE", "GROUP_MESSAGE_CREATE", "DIRECT_MESSAGE_CREATE", "AT_MESSAGE_CREATE", "MESSAGE_CREATE"]);

  return {
    is_message: messageTypes.has(eventType) || Boolean(data.content && (openid || groupOpenid || channelId)),
    is_c2c: eventType === "C2C_MESSAGE_CREATE" || Boolean(openid && !groupOpenid && !channelId),
    is_group: eventType === "GROUP_AT_MESSAGE_CREATE" || eventType === "GROUP_MESSAGE_CREATE" || Boolean(groupOpenid),
    is_channel: eventType === "DIRECT_MESSAGE_CREATE" || eventType === "AT_MESSAGE_CREATE" || eventType === "MESSAGE_CREATE" || Boolean(channelId || guildId),
    event_id: stringifyId(payload.id),
    op: optionalInt32(payload.op) ?? 0,
    event_type: eventType,
    seq: stringifyId(payload.s ?? data.seq),
    message_id: stringifyId(data.id),
    content: stringifyId(data.content),
    timestamp: stringifyId(data.timestamp),
    openid,
    group_openid: groupOpenid,
    channel_id: channelId,
    guild_id: guildId,
    author_json: JSON.stringify(author),
    attachments_json: JSON.stringify(Array.isArray(data.attachments) ? data.attachments : []),
    data_json: JSON.stringify(data),
    payload_json: JSON.stringify(payload),
  };
};

const registerHandlers = (ctx = {}) => {
  const callCtx = resolveCallContext(ctx);
  return {
    [METHOD_GET_ACCESS_TOKEN_PATH]: (req = callCtx.req) => handleGetAccessToken(req ?? {}, callCtx),
    [METHOD_START_GATEWAY_PATH]: (req = callCtx.req) => handleStartGateway(req ?? {}, callCtx),
    [METHOD_STOP_GATEWAY_PATH]: () => handleStopGateway(),
    [METHOD_GET_GATEWAY_STATUS_PATH]: () => handleGetGatewayStatus(),
    [METHOD_POLL_MESSAGES_PATH]: (req = callCtx.req) => handlePollMessages(req ?? {}),
    [METHOD_ACK_MESSAGE_PATH]: (req = callCtx.req) => handleAckMessage(req ?? {}),
    [METHOD_SEND_C2C_MESSAGE_PATH]: (req = callCtx.req) => handleSendC2CMessage(req ?? {}, callCtx),
    [METHOD_SEND_GROUP_MESSAGE_PATH]: (req = callCtx.req) => handleSendGroupMessage(req ?? {}, callCtx),
    [METHOD_NORMALIZE_EVENT_PATH]: (req = callCtx.req) => handleNormalizeEvent(req ?? {}, callCtx),
  };
};

export function rpcdef(ctx = {}) {
  return registerHandlers(ctx);
}

const callSdkHandler = (ctx, path) => registerHandlers(ctx)[path](ctx?.request ?? ctx?.req ?? {});

export const handlers = {
  [METHOD_GET_ACCESS_TOKEN_FULL]: (ctx) => callSdkHandler(ctx, METHOD_GET_ACCESS_TOKEN_PATH),
  [METHOD_START_GATEWAY_FULL]: (ctx) => callSdkHandler(ctx, METHOD_START_GATEWAY_PATH),
  [METHOD_STOP_GATEWAY_FULL]: (ctx) => callSdkHandler(ctx, METHOD_STOP_GATEWAY_PATH),
  [METHOD_GET_GATEWAY_STATUS_FULL]: (ctx) => callSdkHandler(ctx, METHOD_GET_GATEWAY_STATUS_PATH),
  [METHOD_POLL_MESSAGES_FULL]: (ctx) => callSdkHandler(ctx, METHOD_POLL_MESSAGES_PATH),
  [METHOD_ACK_MESSAGE_FULL]: (ctx) => callSdkHandler(ctx, METHOD_ACK_MESSAGE_PATH),
  [METHOD_SEND_C2C_MESSAGE_FULL]: (ctx) => callSdkHandler(ctx, METHOD_SEND_C2C_MESSAGE_PATH),
  [METHOD_SEND_GROUP_MESSAGE_FULL]: (ctx) => callSdkHandler(ctx, METHOD_SEND_GROUP_MESSAGE_PATH),
  [METHOD_NORMALIZE_EVENT_FULL]: (ctx) => callSdkHandler(ctx, METHOD_NORMALIZE_EVENT_PATH),
};

const parseRuntimeJsonArg = (argv, name) => {
  const index = argv.indexOf(name);
  if (index >= 0 && argv[index + 1]) return JSON.parse(argv[index + 1]);
  const prefix = `${name}=`;
  const inline = argv.find((arg) => arg.startsWith(prefix));
  if (inline) return JSON.parse(inline.slice(prefix.length));
  return undefined;
};

const parseRuntimeFileArg = (argv, name) => {
  const index = argv.indexOf(name);
  if (index >= 0 && argv[index + 1]) return JSON.parse(fs.readFileSync(argv[index + 1], "utf8"));
  const prefix = `${name}=`;
  const inline = argv.find((arg) => arg.startsWith(prefix));
  if (inline) return JSON.parse(fs.readFileSync(inline.slice(prefix.length), "utf8"));
  return undefined;
};

const readRuntimeObject = (argv, fileArg, jsonArg) => parseRuntimeJsonArg(argv, jsonArg) ?? parseRuntimeFileArg(argv, fileArg) ?? {};

export async function maybeAutoStartGatewayFromCli(argv = process.argv.slice(2)) {
  if (argv[0] !== "--runtime" || !["serve", "dev"].includes(argv[1])) return false;
  const config = readRuntimeObject(argv, "--config", "--config-json");
  if (!resolveAutoStartGateway(config)) return false;
  const secret = readRuntimeObject(argv, "--secret", "--secret-json");
  await startGateway({ config, secret }, true);
  return true;
}

export const _test = {
  buildApiUrl,
  buildJsonObject,
  buildMessagePayload,
  buildSendMessageResponse,
  callOpenApi,
  clearGatewayTimers,
  closeGatewaySocket,
  connectGateway,
  deleteTokenCache,
  errorWithCode,
  enqueueGatewayMessage,
  eventData,
  fetchGatewayInfo,
  fetchAppAccessToken,
  firstDefined,
  gatewayState,
  gatewayStatus,
  grpcCodeFor,
  handleAckMessage,
  handleGetAccessToken,
  handleGetGatewayStatus,
  handleGatewayPayload,
  handleNormalizeEvent,
  handlePollMessages,
  handleSendC2CMessage,
  handleSendGroupMessage,
  handleStartGateway,
  handleStopGateway,
  hasOwn,
  maybeAutoStartGatewayFromCli,
  mapErrorBodyToCode,
  mapHttpStatusToCode,
  mergedBindings,
  normalizeBaseUrl,
  optionalInt32,
  optionalIntWithDefault,
  optionalUint32,
  parseRuntimeFileArg,
  parseRuntimeJsonArg,
  parseJsonBody,
  parsePayload,
  pollMessages,
  readTokenCache,
  registerHandlers,
  resumeGateway,
  requireString,
  resolveAccessToken,
  resolveApiBaseUrl,
  resolveAppId,
  resolveAppSecret,
  resolveCallContext,
  resolveConfiguredAccessToken,
  resolveAutoStartGateway,
  resolveGatewayIntents,
  resolveGatewayReconnectMs,
  resolveGatewayShardCount,
  resolveGatewayShardIndex,
  resolveMaxBufferedMessages,
  resolveTimeoutMs,
  resolveTokenUrl,
  startGateway,
  sendHeartbeat,
  stopGateway,
  stringifyId,
  toBoolean,
  tokenCache,
  tokenCacheKey,
  toTrimmedString,
  unwrapScalar,
  upstreamError,
  writeTokenCache,
};

import fs from "node:fs";
import { randomBytes, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { GrpcError, grpcStatus } from "@chaitin-ai/octobus-sdk";

const require = createRequire(import.meta.url);
const qrcodeTerminal = require("qrcode-terminal");

export const METHOD_START_LOGIN_PATH = "/Tencent_WeixinPersonal.Tencent_WeixinPersonal/StartLogin";
export const METHOD_WAIT_LOGIN_PATH = "/Tencent_WeixinPersonal.Tencent_WeixinPersonal/WaitLogin";
export const METHOD_FETCH_UPDATES_PATH = "/Tencent_WeixinPersonal.Tencent_WeixinPersonal/FetchUpdates";
export const METHOD_START_RECEIVER_PATH = "/Tencent_WeixinPersonal.Tencent_WeixinPersonal/StartReceiver";
export const METHOD_STOP_RECEIVER_PATH = "/Tencent_WeixinPersonal.Tencent_WeixinPersonal/StopReceiver";
export const METHOD_GET_RECEIVER_STATUS_PATH = "/Tencent_WeixinPersonal.Tencent_WeixinPersonal/GetReceiverStatus";
export const METHOD_POLL_MESSAGES_PATH = "/Tencent_WeixinPersonal.Tencent_WeixinPersonal/PollMessages";
export const METHOD_ACK_MESSAGE_PATH = "/Tencent_WeixinPersonal.Tencent_WeixinPersonal/AckMessage";
export const METHOD_SEND_TEXT_PATH = "/Tencent_WeixinPersonal.Tencent_WeixinPersonal/SendText";
export const METHOD_NORMALIZE_MESSAGE_PATH = "/Tencent_WeixinPersonal.Tencent_WeixinPersonal/NormalizeMessage";

export const METHOD_START_LOGIN_FULL = "Tencent_WeixinPersonal.Tencent_WeixinPersonal/StartLogin";
export const METHOD_WAIT_LOGIN_FULL = "Tencent_WeixinPersonal.Tencent_WeixinPersonal/WaitLogin";
export const METHOD_FETCH_UPDATES_FULL = "Tencent_WeixinPersonal.Tencent_WeixinPersonal/FetchUpdates";
export const METHOD_START_RECEIVER_FULL = "Tencent_WeixinPersonal.Tencent_WeixinPersonal/StartReceiver";
export const METHOD_STOP_RECEIVER_FULL = "Tencent_WeixinPersonal.Tencent_WeixinPersonal/StopReceiver";
export const METHOD_GET_RECEIVER_STATUS_FULL = "Tencent_WeixinPersonal.Tencent_WeixinPersonal/GetReceiverStatus";
export const METHOD_POLL_MESSAGES_FULL = "Tencent_WeixinPersonal.Tencent_WeixinPersonal/PollMessages";
export const METHOD_ACK_MESSAGE_FULL = "Tencent_WeixinPersonal.Tencent_WeixinPersonal/AckMessage";
export const METHOD_SEND_TEXT_FULL = "Tencent_WeixinPersonal.Tencent_WeixinPersonal/SendText";
export const METHOD_NORMALIZE_MESSAGE_FULL = "Tencent_WeixinPersonal.Tencent_WeixinPersonal/NormalizeMessage";

export const DEFAULT_ILINK_BASE_URL = "https://ilinkai.weixin.qq.com";
export const DEFAULT_BOT_TYPE = "3";
export const DEFAULT_TIMEOUT_MS = 15000;
export const DEFAULT_LONG_POLL_TIMEOUT_MS = 35000;
export const DEFAULT_LOGIN_WAIT_TIMEOUT_MS = 480000;
export const DEFAULT_LOGIN_SESSION_TTL_MS = 10 * 60 * 1000;
export const DEFAULT_MAX_LOGIN_SESSIONS = 32;
export const DEFAULT_MAX_BUFFERED_MESSAGES = 1000;
export const DEFAULT_RECEIVER_RETRY_MS = 2000;
export const DEFAULT_BOT_AGENT = "OctoBus/0.1.0";
export const CHANNEL_VERSION = "2.4.6";
export const ILINK_APP_ID = "bot";
export const ILINK_APP_CLIENT_VERSION = (2 << 16) | (4 << 8) | 6;
export const EP_GET_BOT_QR = "ilink/bot/get_bot_qrcode";
export const EP_GET_QR_STATUS = "ilink/bot/get_qrcode_status";
export const EP_GET_UPDATES = "ilink/bot/getupdates";
export const EP_SEND_MESSAGE = "ilink/bot/sendmessage";

// OctoBus starts one long-running Node.js process per service instance, so this
// runtime state is shared by requests to the same instance but not across instances.
const loginSessions = new Map();

const runtimeCredentials = {
  connected: false,
  accountId: "",
  userId: "",
  baseUrl: "",
  token: "",
  connectedAt: "",
};

const autoLoginState = {
  running: false,
  state: "stopped",
  sessionKey: "",
  lastStatus: "",
  lastError: "",
  startedAt: "",
  connectedAt: "",
  promise: null,
};

const receiverState = {
  running: false,
  ready: false,
  state: "stopped",
  accountId: "",
  baseUrl: "",
  token: "",
  cursor: "",
  lastError: "",
  startedAt: "",
  lastPollAt: "",
  lastMessageAt: "",
  queue: [],
  droppedMessages: 0,
  pollCount: 0,
  timer: null,
  abortController: null,
  ctx: null,
  localMessageSeq: 0,
};

/* node:coverage disable */
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
  err.ret = Number.isFinite(Number(details.ret)) ? Number(details.ret) : undefined;
  err.errcode = Number.isFinite(Number(details.errcode)) ? Number(details.errcode) : undefined;
  err.errmsg = typeof details.errmsg === "string" ? details.errmsg : "";
  err.reason = typeof details.reason === "string" ? details.reason : "";
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

const optionalInt32 = (value) => {
  const raw = unwrapScalar(value);
  if (raw === undefined || raw === null || raw === "") return undefined;
  const num = Number(raw);
  if (!Number.isFinite(num)) return undefined;
  return Math.trunc(num);
};

const optionalUint32 = (value) => {
  const num = optionalInt32(value);
  if (num === undefined || num <= 0) return undefined;
  return num;
};

const optionalIntWithDefault = (value, fallback, minimum = 0) => {
  const parsed = optionalUint32(value);
  if (parsed === undefined || parsed < minimum) return fallback;
  return parsed;
};

const requireString = (value, fieldName) => {
  const text = toTrimmedString(value);
  if (!text) throw errorWithCode("INVALID_ARGUMENT", `${fieldName} is required`);
  return text;
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

const resolveLoginBaseUrl = (bindings = {}) => normalizeBaseUrl(
  firstDefined(bindings.loginBaseUrl, bindings.login_base_url),
  DEFAULT_ILINK_BASE_URL,
  "loginBaseUrl",
);

const resolveBaseUrl = (bindings = {}) => normalizeBaseUrl(
  firstDefined(bindings.baseUrl, bindings.base_url),
  DEFAULT_ILINK_BASE_URL,
  "baseUrl",
);

const resolveTimeoutMs = (ctx = {}) => {
  const bindings = ctx.bindings || mergedBindings(ctx);
  return optionalUint32(ctx.limits?.timeoutMs) ?? optionalUint32(firstDefined(bindings.timeoutMs, bindings.timeout_ms)) ?? DEFAULT_TIMEOUT_MS;
};

const resolveLongPollTimeoutMs = (ctx = {}, req = {}) => {
  const bindings = ctx.bindings || mergedBindings(ctx);
  return optionalUint32(firstDefined(req.timeout_ms, req.timeoutMs, bindings.longPollTimeoutMs, bindings.long_poll_timeout_ms)) ?? DEFAULT_LONG_POLL_TIMEOUT_MS;
};

const resolveBotType = (bindings = {}, req = {}) => toTrimmedString(firstDefined(req.bot_type, req.botType, bindings.botType, bindings.bot_type)) || DEFAULT_BOT_TYPE;
const resolveBotAgent = (bindings = {}) => toTrimmedString(firstDefined(bindings.botAgent, bindings.bot_agent)) || DEFAULT_BOT_AGENT;
const resolveRouteTag = (bindings = {}) => toTrimmedString(firstDefined(bindings.routeTag, bindings.route_tag));
const resolvePrintQrCode = (bindings = {}) => {
  const value = firstDefined(bindings.printQrCode, bindings.print_qr_code);
  return value === undefined || value === null ? true : toBoolean(value);
};
const resolveToken = (bindings = {}) => toTrimmedString(firstDefined(bindings.token, bindings.accessToken, bindings.access_token));
const resolveAccountId = (bindings = {}, req = {}) => toTrimmedString(firstDefined(req.account_id, req.accountId, bindings.accountId, bindings.account_id));
const resolveMaxBufferedMessages = (bindings = {}) => optionalIntWithDefault(firstDefined(bindings.maxBufferedMessages, bindings.max_buffered_messages), DEFAULT_MAX_BUFFERED_MESSAGES, 1);
const resolveReceiverRetryMs = (bindings = {}) => optionalIntWithDefault(firstDefined(bindings.receiverRetryMs, bindings.receiver_retry_ms), DEFAULT_RECEIVER_RETRY_MS, 100);
const resolveAutoStartReceiver = (bindings = {}) => toBoolean(firstDefined(bindings.autoStartReceiver, bindings.auto_start_receiver));
const resolveAutoStartLogin = (bindings = {}) => {
  const value = firstDefined(bindings.autoStartLogin, bindings.auto_start_login);
  return value === undefined || value === null ? true : toBoolean(value);
};
const resolveAutoStartReceiverAfterLogin = (bindings = {}) => {
  const value = firstDefined(bindings.autoStartReceiverAfterLogin, bindings.auto_start_receiver_after_login);
  return value === undefined || value === null ? true : toBoolean(value);
};
const resolveLoginWaitTimeoutMs = (bindings = {}) => optionalUint32(firstDefined(bindings.loginWaitTimeoutMs, bindings.login_wait_timeout_ms)) ?? DEFAULT_LOGIN_WAIT_TIMEOUT_MS;
const resolveAutoLoginRetryMs = (bindings = {}) => optionalIntWithDefault(firstDefined(bindings.autoLoginRetryMs, bindings.auto_login_retry_ms), 3000, 100);

const buildUrl = (baseUrl, endpoint) => new URL(endpoint.replace(/^\/+/, ""), `${baseUrl}/`).toString();

const randomWechatUin = () => {
  const value = randomBytes(4).readUInt32BE(0);
  return Buffer.from(String(value), "utf-8").toString("base64");
};

const buildBaseInfo = (bindings = {}) => ({
  channel_version: CHANNEL_VERSION,
  bot_agent: resolveBotAgent(bindings),
});

const buildTerminalQrCode = (value) => {
  const data = toTrimmedString(value);
  if (!data) return "";
  let rendered = "";
  qrcodeTerminal.generate(data, { small: true }, (code) => {
    rendered = String(code || "");
  });
  return rendered;
};

const printLoginQrCode = (login) => {
  const data = toTrimmedString(login.qrcodeUrl || login.qrcode);
  if (!data) return;
  console.log("[Tencent_WeixinPersonal][StartLogin] scan this QR code with Weixin:");
  console.log(data);
  const terminalQr = buildTerminalQrCode(data);
  if (terminalQr) console.log(terminalQr);
};

const rememberRuntimeCredentials = (loginResult = {}) => {
  const token = toTrimmedString(loginResult.token);
  if (!token) return;
  runtimeCredentials.connected = true;
  runtimeCredentials.accountId = toTrimmedString(loginResult.account_id ?? loginResult.accountId);
  runtimeCredentials.userId = toTrimmedString(loginResult.user_id ?? loginResult.userId);
  runtimeCredentials.baseUrl = normalizeBaseUrl(
    firstDefined(loginResult.base_url, loginResult.baseUrl),
    DEFAULT_ILINK_BASE_URL,
    "baseUrl",
  );
  runtimeCredentials.token = token;
  runtimeCredentials.connectedAt = new Date().toISOString();
};

const buildHeaders = (bindings = {}, token = "", body = "") => {
  const headers = {
    "Content-Type": "application/json",
    AuthorizationType: "ilink_bot_token",
    "X-WECHAT-UIN": randomWechatUin(),
    "iLink-App-Id": ILINK_APP_ID,
    "iLink-App-ClientVersion": String(ILINK_APP_CLIENT_VERSION),
  };
  const routeTag = resolveRouteTag(bindings);
  if (routeTag) headers.SKRouteTag = routeTag;
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body) headers["Content-Length"] = String(Buffer.byteLength(body));
  return headers;
};

const mapHttpStatusToCode = (status) => {
  if (status === 401) return "UNAUTHENTICATED";
  if (status === 403) return "PERMISSION_DENIED";
  if (status === 429) return "UNAVAILABLE";
  if (status >= 400 && status < 500) return "FAILED_PRECONDITION";
  if (status >= 500) return "UNAVAILABLE";
  return "UNKNOWN";
};

const mapBusinessCodeToGrpcCode = (ret, errcode) => {
  const parsedRet = Number(ret);
  const parsedErrcode = Number(errcode);
  const code = Number.isFinite(parsedErrcode) && parsedErrcode !== 0 ? parsedErrcode : parsedRet;
  if (code === 0 || !Number.isFinite(code)) return "UNKNOWN";
  if (code === 401) return "UNAUTHENTICATED";
  if (code === 403) return "PERMISSION_DENIED";
  if (code === -2 || code === 429) return "UNAVAILABLE";
  return "FAILED_PRECONDITION";
};
/* node:coverage enable */

const parseJsonBody = (bodyText, label = "response") => {
  const text = String(bodyText ?? "");
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw upstreamError("UNKNOWN", `weixin ${label} body is not valid JSON`, { httpBody: text, reason: "invalid json" });
  }
};

/* node:coverage disable */
const fetchWithTimeout = async (url, init = {}, timeoutMs = DEFAULT_TIMEOUT_MS) => {
  const controller = new AbortController();
  const timer = timeoutMs > 0 ? setTimeout(() => controller.abort(), timeoutMs) : null;
  const externalSignal = init.signal;
  const onExternalAbort = () => controller.abort();
  if (externalSignal?.aborted) {
    controller.abort();
  } else if (externalSignal) {
    externalSignal.addEventListener("abort", onExternalAbort, { once: true });
  }
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } catch (err) {
    if (err?.name === "AbortError") throw err;
    throw err;
  } finally {
    if (timer) clearTimeout(timer);
    if (externalSignal) externalSignal.removeEventListener("abort", onExternalAbort);
  }
};

const readResponseText = async (response) => {
  try {
    return String((await response.text()) ?? "");
  } catch (err) {
    throw upstreamError("UNAVAILABLE", "weixin response read failed", {
      httpStatus: Number(response.status || 0),
      reason: err?.message || "read response failed",
    });
  }
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const apiGet = async (ctx = {}, baseUrl, endpoint, options = {}) => {
  const callCtx = resolveCallContext(ctx);
  const timeoutMs = optionalUint32(options.timeoutMs) ?? resolveTimeoutMs(callCtx);
  const url = buildUrl(baseUrl, endpoint);
  let response;
  try {
    response = await fetchWithTimeout(url, {
      method: "GET",
      headers: {
        "iLink-App-Id": ILINK_APP_ID,
        "iLink-App-ClientVersion": String(ILINK_APP_CLIENT_VERSION),
        ...(resolveRouteTag(callCtx.bindings || {}) ? { SKRouteTag: resolveRouteTag(callCtx.bindings || {}) } : {}),
      },
      signal: options.signal,
    }, timeoutMs);
  } catch (err) {
    throw upstreamError("UNAVAILABLE", "weixin ilink GET request failed", {
      httpStatus: 0,
      reason: err?.name === "AbortError" ? "request timeout" : (err?.cause?.message || err?.message || "fetch failed"),
    });
  }

  const httpStatus = Number(response.status || 0);
  const httpBody = await readResponseText(response);
  const body = parseJsonBody(httpBody, "GET response");
  if (httpStatus < 200 || httpStatus >= 300) {
    throw upstreamError(mapHttpStatusToCode(httpStatus), `weixin ilink http ${httpStatus}`, {
      httpStatus,
      httpBody,
      ret: body.ret,
      errcode: body.errcode,
      errmsg: body.errmsg,
      reason: "http status is not 2xx",
    });
  }
  return { httpStatus, httpBody, body };
};

const apiPost = async (ctx = {}, baseUrl, endpoint, payload = {}, options = {}) => {
  const callCtx = resolveCallContext(ctx);
  const timeoutMs = optionalUint32(options.timeoutMs) ?? resolveTimeoutMs(callCtx);
  const token = toTrimmedString(options.token);
  const bodyText = JSON.stringify(payload);
  const url = buildUrl(baseUrl, endpoint);
  let response;
  try {
    response = await fetchWithTimeout(url, {
      method: "POST",
      headers: buildHeaders(callCtx.bindings || {}, token, bodyText),
      body: bodyText,
      signal: options.signal,
    }, timeoutMs);
  } catch (err) {
    throw upstreamError("UNAVAILABLE", "weixin ilink POST request failed", {
      httpStatus: 0,
      reason: err?.name === "AbortError" ? "request timeout" : (err?.cause?.message || err?.message || "fetch failed"),
    });
  }

  const httpStatus = Number(response.status || 0);
  const httpBody = await readResponseText(response);
  const body = parseJsonBody(httpBody, "POST response");
  if (httpStatus < 200 || httpStatus >= 300) {
    throw upstreamError(mapHttpStatusToCode(httpStatus), `weixin ilink http ${httpStatus}`, {
      httpStatus,
      httpBody,
      ret: body.ret,
      errcode: body.errcode,
      errmsg: body.errmsg,
      reason: "http status is not 2xx",
    });
  }
  return { httpStatus, httpBody, body };
};
/* node:coverage enable */

const assertBusinessOk = (body = {}, httpStatus = 0, httpBody = "") => {
  const ret = optionalInt32(body.ret) ?? 0;
  const errcode = optionalInt32(body.errcode) ?? 0;
  const errmsg = toTrimmedString(body.errmsg);
  if (ret !== 0 || errcode !== 0) {
    throw upstreamError(mapBusinessCodeToGrpcCode(ret, errcode), "weixin ilink business failure", {
      httpStatus,
      httpBody,
      ret,
      errcode,
      errmsg,
      reason: "ret or errcode is non-zero",
    });
  }
  return { ret, errcode, errmsg };
};

const pruneLoginSessions = (now = Date.now()) => {
  for (const [key, session] of loginSessions) {
    const startedAt = Number(session?.startedAt || 0);
    if (!startedAt || now - startedAt > DEFAULT_LOGIN_SESSION_TTL_MS) {
      loginSessions.delete(key);
    }
  }
  while (loginSessions.size > DEFAULT_MAX_LOGIN_SESSIONS) {
    const oldestKey = loginSessions.keys().next().value;
    if (!oldestKey) break;
    loginSessions.delete(oldestKey);
  }
};

const startLogin = async (req = {}, ctx = {}) => {
  pruneLoginSessions();
  const callCtx = resolveCallContext(ctx);
  const bindings = callCtx.bindings || {};
  const botType = resolveBotType(bindings, req);
  const sessionKey = toTrimmedString(firstDefined(req.session_key, req.sessionKey)) || randomUUID();
  const existing = loginSessions.get(sessionKey);
  if (existing && !toBoolean(firstDefined(req.force_refresh, req.forceRefresh))) {
    const qrcodeTerminalText = buildTerminalQrCode(existing.qrcodeUrl || existing.qrcode);
    if (resolvePrintQrCode(bindings)) printLoginQrCode(existing);
    return {
      session_key: sessionKey,
      qrcode: existing.qrcode,
      qrcode_url: existing.qrcodeUrl,
      message: "二维码已创建，请用手机微信扫描。",
      http_status: existing.httpStatus || 0,
      http_body: existing.httpBody || "",
      qrcode_terminal: qrcodeTerminalText,
    };
  }

  const loginBaseUrl = resolveLoginBaseUrl(bindings);
  const localTokenList = resolveToken(bindings) ? [resolveToken(bindings)] : [];
  const result = await apiPost(callCtx, loginBaseUrl, `${EP_GET_BOT_QR}?bot_type=${encodeURIComponent(botType)}`, {
    local_token_list: localTokenList,
  });
  const qrcode = requireString(result.body.qrcode, "qrcode");
  const qrcodeUrl = toTrimmedString(result.body.qrcode_img_content);
  loginSessions.set(sessionKey, {
    sessionKey,
    qrcode,
    qrcodeUrl,
    startedAt: Date.now(),
    currentBaseUrl: loginBaseUrl,
    botType,
    httpStatus: result.httpStatus,
    httpBody: result.httpBody,
  });
  const qrcodeTerminalText = buildTerminalQrCode(qrcodeUrl || qrcode);
  if (resolvePrintQrCode(bindings)) {
    printLoginQrCode({ qrcode, qrcodeUrl });
  }

  return {
    session_key: sessionKey,
    qrcode,
    qrcode_url: qrcodeUrl,
    message: "用手机微信扫描二维码，并在手机上确认登录。",
    http_status: result.httpStatus,
    http_body: result.httpBody,
    qrcode_terminal: qrcodeTerminalText,
  };
};

const pollLoginStatus = async (session, ctx = {}, verifyCode = "") => {
  let endpoint = `${EP_GET_QR_STATUS}?qrcode=${encodeURIComponent(session.qrcode)}`;
  if (verifyCode) endpoint += `&verify_code=${encodeURIComponent(verifyCode)}`;
  const result = await apiGet(ctx, session.currentBaseUrl || DEFAULT_ILINK_BASE_URL, endpoint, { timeoutMs: DEFAULT_LONG_POLL_TIMEOUT_MS });
  const status = toTrimmedString(result.body.status) || "wait";
  session.status = status;
  session.httpStatus = result.httpStatus;
  session.httpBody = result.httpBody;
  if (status === "scaned_but_redirect" && result.body.redirect_host) {
    session.currentBaseUrl = `https://${toTrimmedString(result.body.redirect_host)}`;
  }
  return { ...result, status };
};

const waitLogin = async (req = {}, ctx = {}) => {
  pruneLoginSessions();
  const sessionKey = requireString(firstDefined(req.session_key, req.sessionKey), "session_key");
  const session = loginSessions.get(sessionKey);
  if (!session) throw errorWithCode("FAILED_PRECONDITION", "login session not found; call StartLogin first");
  const timeoutMs = optionalUint32(firstDefined(req.timeout_ms, req.timeoutMs)) ?? DEFAULT_LOGIN_WAIT_TIMEOUT_MS;
  const verifyCode = toTrimmedString(firstDefined(req.verify_code, req.verifyCode));
  const deadline = Date.now() + Math.max(timeoutMs, 1);
  let last = {
    status: session.status || "wait",
    httpStatus: session.httpStatus || 0,
    httpBody: session.httpBody || "",
    body: {},
  };

  while (Date.now() <= deadline) {
    last = await pollLoginStatus(session, ctx, verifyCode);
    if (last.status === "confirmed") {
      const accountId = requireString(last.body.ilink_bot_id, "ilink_bot_id");
      const token = requireString(last.body.bot_token, "bot_token");
      const baseUrl = toTrimmedString(last.body.baseurl) || DEFAULT_ILINK_BASE_URL;
      const userId = toTrimmedString(last.body.ilink_user_id);
      loginSessions.delete(sessionKey);
      const loginResult = {
        connected: true,
        already_connected: false,
        account_id: accountId,
        user_id: userId,
        base_url: baseUrl,
        token,
        status: last.status,
        message: "微信连接成功。",
        http_status: last.httpStatus,
        http_body: last.httpBody,
      };
      rememberRuntimeCredentials(loginResult);
      return loginResult;
    }
    if (last.status === "binded_redirect") {
      loginSessions.delete(sessionKey);
      return {
        connected: false,
        already_connected: true,
        account_id: "",
        user_id: "",
        base_url: "",
        token: "",
        status: last.status,
        message: "此微信账号已连接过该 iLink bot。",
        http_status: last.httpStatus,
        http_body: last.httpBody,
      };
    }
    if (["expired", "verify_code_blocked"].includes(last.status)) {
      loginSessions.delete(sessionKey);
      return {
        connected: false,
        already_connected: false,
        account_id: "",
        user_id: "",
        base_url: "",
        token: "",
        status: last.status,
        message: last.status === "expired" ? "二维码已过期，请重新开始登录。" : "验证码多次错误，请重新开始登录。",
        http_status: last.httpStatus,
        http_body: last.httpBody,
      };
    }
    if (Date.now() + 1000 > deadline) break;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  return {
    connected: false,
    already_connected: false,
    account_id: "",
    user_id: "",
    base_url: "",
    token: "",
    status: last.status,
    message: last.status === "need_verifycode" ? "需要输入手机微信显示的验证码。" : "等待扫码或确认超时。",
    http_status: last.httpStatus,
    http_body: last.httpBody,
  };
};

const normalizeMessageObject = (message = {}, localId = "") => {
  const items = Array.isArray(message.item_list) ? message.item_list : [];
  const text = items
    .map((item) => toTrimmedString(item?.text_item?.text ?? item?.voice_item?.text))
    .filter(Boolean)
    .join("\n");
  return {
    local_id: localId,
    seq: Number(message.seq || 0),
    message_id: Number(message.message_id || 0),
    from_user_id: toTrimmedString(message.from_user_id),
    to_user_id: toTrimmedString(message.to_user_id),
    client_id: toTrimmedString(message.client_id),
    session_id: toTrimmedString(message.session_id),
    group_id: toTrimmedString(message.group_id),
    message_type: optionalInt32(message.message_type) ?? 0,
    message_state: optionalInt32(message.message_state) ?? 0,
    create_time_ms: Number(message.create_time_ms || 0),
    update_time_ms: Number(message.update_time_ms || 0),
    context_token: toTrimmedString(message.context_token),
    run_id: toTrimmedString(message.run_id),
    text,
    raw_json: JSON.stringify(message),
  };
};

const normalizeRawMessage = (req = {}) => {
  const candidate = firstDefined(req.raw_json, req.rawJson, req.message, req.payload);
  if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) return normalizeMessageObject(candidate);
  const text = requireString(candidate, "raw_json");
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("raw_json must be a JSON object");
    return normalizeMessageObject(parsed);
  } catch (err) {
    throw errorWithCode("INVALID_ARGUMENT", err?.message || "raw_json must be valid JSON");
  }
};

const resolveAccountCredentials = (ctx = {}, req = {}) => {
  const callCtx = resolveCallContext(ctx);
  const bindings = callCtx.bindings || {};
  const boundBaseUrl = firstDefined(req.base_url, req.baseUrl, bindings.baseUrl, bindings.base_url);
  return {
    callCtx,
    accountId: resolveAccountId(bindings, req) || runtimeCredentials.accountId,
    token: requireString(resolveToken(bindings) || runtimeCredentials.token, "token"),
    baseUrl: normalizeBaseUrl(boundBaseUrl, runtimeCredentials.baseUrl || DEFAULT_ILINK_BASE_URL, "baseUrl"),
  };
};

const fetchUpdates = async (req = {}, ctx = {}, options = {}) => {
  const { callCtx, accountId, token, baseUrl } = resolveAccountCredentials(ctx, req);
  const cursor = toTrimmedString(firstDefined(req.cursor, req.get_updates_buf, req.getUpdatesBuf));
  const result = await apiPost(callCtx, baseUrl, EP_GET_UPDATES, {
    get_updates_buf: cursor,
    base_info: buildBaseInfo(callCtx.bindings || {}),
  }, {
    token,
    timeoutMs: resolveLongPollTimeoutMs(callCtx, req),
    signal: options.signal,
  });
  const ok = assertBusinessOk(result.body, result.httpStatus, result.httpBody);
  const messages = (Array.isArray(result.body.msgs) ? result.body.msgs : []).map((message, index) => {
    const normalized = normalizeMessageObject(message);
    normalized.local_id = `${accountId || "weixin"}:${message.message_id ?? message.seq ?? index}`;
    return normalized;
  });
  return {
    ret: ok.ret,
    errcode: ok.errcode,
    errmsg: ok.errmsg,
    cursor: toTrimmedString(result.body.get_updates_buf ?? result.body.sync_buf ?? cursor),
    longpolling_timeout_ms: optionalInt32(result.body.longpolling_timeout_ms) ?? 0,
    messages,
    http_status: result.httpStatus,
    http_body: result.httpBody,
  };
};

const generateClientId = () => `octobus-weixin-${Date.now().toString(36)}-${randomBytes(4).toString("hex")}`;

const buildTextMessagePayload = (req = {}, clientId) => {
  const message = {
    from_user_id: "",
    to_user_id: requireString(firstDefined(req.to_user_id, req.toUserId, req.to), "to_user_id"),
    client_id: clientId,
    message_type: 2,
    message_state: 2,
    item_list: [{
      type: 1,
      text_item: {
        text: requireString(firstDefined(req.message, req.text, req.content), "message"),
      },
    }],
  };
  const contextToken = toTrimmedString(firstDefined(req.context_token, req.contextToken));
  const runId = toTrimmedString(firstDefined(req.run_id, req.runId));
  if (contextToken) message.context_token = contextToken;
  if (runId) message.run_id = runId;
  return {
    msg: message,
  };
};

const sendText = async (req = {}, ctx = {}) => {
  const { callCtx, token, baseUrl } = resolveAccountCredentials(ctx, req);
  const clientId = toTrimmedString(firstDefined(req.client_id, req.clientId)) || generateClientId();
  const payload = {
    ...buildTextMessagePayload(req, clientId),
    base_info: buildBaseInfo(callCtx.bindings || {}),
  };
  const result = await apiPost(callCtx, baseUrl, EP_SEND_MESSAGE, payload, {
    token,
    timeoutMs: resolveTimeoutMs(callCtx),
  });
  const ok = assertBusinessOk(result.body, result.httpStatus, result.httpBody);
  return {
    success: true,
    ret: ok.ret,
    errcode: ok.errcode,
    errmsg: ok.errmsg,
    client_id: clientId,
    http_status: result.httpStatus,
    http_body: result.httpBody,
  };
};

const receiverStatus = () => ({
  running: receiverState.running,
  ready: receiverState.ready,
  state: receiverState.state,
  account_id: receiverState.accountId,
  base_url: receiverState.baseUrl,
  cursor: receiverState.cursor,
  last_error: receiverState.lastError,
  started_at: receiverState.startedAt,
  last_poll_at: receiverState.lastPollAt,
  last_message_at: receiverState.lastMessageAt,
  queue_size: receiverState.queue.length,
  dropped_messages: receiverState.droppedMessages,
  poll_count: receiverState.pollCount,
});

const clearReceiverTimer = () => {
  if (receiverState.timer) clearTimeout(receiverState.timer);
  receiverState.timer = null;
};

/* node:coverage disable */
const scheduleReceiverTick = (delayMs = 0) => {
  if (!receiverState.running) return;
  clearReceiverTimer();
  receiverState.timer = setTimeout(() => {
    receiverState.timer = null;
    receiverTick().catch((err) => {
      receiverState.lastError = err?.message || String(err);
      if (receiverState.running) scheduleReceiverTick(resolveReceiverRetryMs(receiverState.ctx?.bindings || {}));
    });
  }, delayMs);
};
/* node:coverage enable */

const enqueueReceivedMessages = (messages = []) => {
  const maxBuffered = resolveMaxBufferedMessages(receiverState.ctx?.bindings || {});
  for (const message of messages) {
    receiverState.localMessageSeq += 1;
    const localId = String(receiverState.localMessageSeq);
    receiverState.queue.push({
      local_id: localId,
      received_at: new Date().toISOString(),
      message: {
        ...message,
        local_id: localId,
      },
    });
    receiverState.lastMessageAt = new Date().toISOString();
  }
  while (receiverState.queue.length > maxBuffered) {
    receiverState.queue.shift();
    receiverState.droppedMessages += 1;
  }
};

const receiverTick = async () => {
  if (!receiverState.running || !receiverState.ctx) return receiverStatus();
  receiverState.state = "polling";
  receiverState.ready = true;
  receiverState.abortController = new AbortController();
  try {
    const result = await fetchUpdates({
      cursor: receiverState.cursor,
      account_id: receiverState.accountId,
    }, receiverState.ctx, { signal: receiverState.abortController.signal });
    receiverState.pollCount += 1;
    receiverState.cursor = result.cursor;
    receiverState.lastPollAt = new Date().toISOString();
    receiverState.lastError = "";
    enqueueReceivedMessages(result.messages);
    receiverState.state = "ready";
  } catch (err) {
    receiverState.lastError = err?.message || String(err);
    receiverState.state = "error";
    throw err;
  } finally {
    receiverState.abortController = null;
  }
  if (receiverState.running) scheduleReceiverTick(0);
  return receiverStatus();
};

const startReceiver = async (req = {}, ctx = {}) => {
  const callCtx = resolveCallContext(ctx);
  if (receiverState.running && !toBoolean(firstDefined(req.force_restart, req.forceRestart))) return receiverStatus();
  await stopReceiver();
  const token = requireString(resolveToken(callCtx.bindings || {}) || runtimeCredentials.token, "token");
  const accountId = resolveAccountId(callCtx.bindings || {}, req) || runtimeCredentials.accountId;
  receiverState.running = true;
  receiverState.ready = false;
  receiverState.state = "starting";
  receiverState.accountId = accountId;
  receiverState.baseUrl = normalizeBaseUrl(
    firstDefined(callCtx.bindings?.baseUrl, callCtx.bindings?.base_url),
    runtimeCredentials.baseUrl || DEFAULT_ILINK_BASE_URL,
    "baseUrl",
  );
  receiverState.token = token;
  receiverState.cursor = toTrimmedString(firstDefined(req.cursor, req.get_updates_buf, req.getUpdatesBuf));
  receiverState.startedAt = new Date().toISOString();
  receiverState.lastError = "";
  receiverState.ctx = callCtx;
  scheduleReceiverTick(0);
  return receiverStatus();
};

/* node:coverage disable */
const stopReceiver = async () => {
  receiverState.running = false;
  receiverState.ready = false;
  receiverState.state = "stopped";
  clearReceiverTimer();
  if (receiverState.abortController) {
    try {
      receiverState.abortController.abort();
    } catch {
      // best-effort abort
    }
  }
  receiverState.abortController = null;
  return receiverStatus();
};
/* node:coverage enable */

const pollMessages = (req = {}) => {
  const maxMessages = optionalIntWithDefault(firstDefined(req.max_messages, req.maxMessages), 10, 1);
  const messages = receiverState.queue.slice(0, maxMessages);
  if (toBoolean(req.ack)) receiverState.queue.splice(0, messages.length);
  return {
    messages,
    queue_size: receiverState.queue.length,
  };
};

const ackMessage = (req = {}) => {
  if (toBoolean(req.all)) {
    const acked = receiverState.queue.length;
    receiverState.queue = [];
    return { acked, queue_size: 0 };
  }
  const rawIds = firstDefined(req.local_id, req.localId);
  const ids = Array.isArray(rawIds) ? rawIds.map(toTrimmedString).filter(Boolean) : [];
  const idSet = new Set(ids);
  const before = receiverState.queue.length;
  receiverState.queue = receiverState.queue.filter((message) => !idSet.has(message.local_id));
  return {
    acked: before - receiverState.queue.length,
    queue_size: receiverState.queue.length,
  };
};

const handleStartLogin = async (req = {}, ctx = {}) => startLogin(req, ctx);
const handleWaitLogin = async (req = {}, ctx = {}) => waitLogin(req, ctx);
const handleFetchUpdates = async (req = {}, ctx = {}) => fetchUpdates(req, ctx);
const handleStartReceiver = async (req = {}, ctx = {}) => startReceiver(req, ctx);
const handleStopReceiver = async () => stopReceiver();
const handleGetReceiverStatus = async () => receiverStatus();
const handlePollMessages = async (req = {}) => pollMessages(req);
const handleAckMessage = async (req = {}) => ackMessage(req);
const handleSendText = async (req = {}, ctx = {}) => sendText(req, ctx);
const handleNormalizeMessage = async (req = {}) => normalizeRawMessage(req);

const registerHandlers = (ctx = {}) => {
  const callCtx = resolveCallContext(ctx);
  return {
    [METHOD_START_LOGIN_PATH]: (req = callCtx.req) => handleStartLogin(req ?? {}, callCtx),
    [METHOD_WAIT_LOGIN_PATH]: (req = callCtx.req) => handleWaitLogin(req ?? {}, callCtx),
    [METHOD_FETCH_UPDATES_PATH]: (req = callCtx.req) => handleFetchUpdates(req ?? {}, callCtx),
    [METHOD_START_RECEIVER_PATH]: (req = callCtx.req) => handleStartReceiver(req ?? {}, callCtx),
    [METHOD_STOP_RECEIVER_PATH]: () => handleStopReceiver(),
    [METHOD_GET_RECEIVER_STATUS_PATH]: () => handleGetReceiverStatus(),
    [METHOD_POLL_MESSAGES_PATH]: (req = callCtx.req) => handlePollMessages(req ?? {}),
    [METHOD_ACK_MESSAGE_PATH]: (req = callCtx.req) => handleAckMessage(req ?? {}),
    [METHOD_SEND_TEXT_PATH]: (req = callCtx.req) => handleSendText(req ?? {}, callCtx),
    [METHOD_NORMALIZE_MESSAGE_PATH]: (req = callCtx.req) => handleNormalizeMessage(req ?? {}),
  };
};

export function rpcdef(ctx = {}) {
  return registerHandlers(ctx);
}

const callSdkHandler = (ctx, path) => registerHandlers(ctx)[path](ctx?.request ?? ctx?.req ?? {});

export const handlers = {
  [METHOD_START_LOGIN_FULL]: (ctx) => callSdkHandler(ctx, METHOD_START_LOGIN_PATH),
  [METHOD_WAIT_LOGIN_FULL]: (ctx) => callSdkHandler(ctx, METHOD_WAIT_LOGIN_PATH),
  [METHOD_FETCH_UPDATES_FULL]: (ctx) => callSdkHandler(ctx, METHOD_FETCH_UPDATES_PATH),
  [METHOD_START_RECEIVER_FULL]: (ctx) => callSdkHandler(ctx, METHOD_START_RECEIVER_PATH),
  [METHOD_STOP_RECEIVER_FULL]: (ctx) => callSdkHandler(ctx, METHOD_STOP_RECEIVER_PATH),
  [METHOD_GET_RECEIVER_STATUS_FULL]: (ctx) => callSdkHandler(ctx, METHOD_GET_RECEIVER_STATUS_PATH),
  [METHOD_POLL_MESSAGES_FULL]: (ctx) => callSdkHandler(ctx, METHOD_POLL_MESSAGES_PATH),
  [METHOD_ACK_MESSAGE_FULL]: (ctx) => callSdkHandler(ctx, METHOD_ACK_MESSAGE_PATH),
  [METHOD_SEND_TEXT_FULL]: (ctx) => callSdkHandler(ctx, METHOD_SEND_TEXT_PATH),
  [METHOD_NORMALIZE_MESSAGE_FULL]: (ctx) => callSdkHandler(ctx, METHOD_NORMALIZE_MESSAGE_PATH),
};

/* node:coverage disable */
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

const hasExplicitAutoStartLogin = (config = {}, secret = {}) => (
  hasOwn(config, "autoStartLogin")
  || hasOwn(config, "auto_start_login")
  || hasOwn(secret, "autoStartLogin")
  || hasOwn(secret, "auto_start_login")
);

const autoLoginLoop = async (ctx = {}) => {
  const callCtx = resolveCallContext(ctx);
  const bindings = callCtx.bindings || {};
  autoLoginState.running = true;
  autoLoginState.state = "starting";
  autoLoginState.startedAt = new Date().toISOString();
  autoLoginState.connectedAt = "";
  autoLoginState.lastError = "";
  autoLoginState.lastStatus = "";

  while (autoLoginState.running && !runtimeCredentials.connected) {
    try {
      autoLoginState.state = "requesting_qr";
      const login = await startLogin({
        session_key: "auto-start",
        force_refresh: true,
      }, callCtx);
      autoLoginState.sessionKey = login.session_key;
      autoLoginState.state = "waiting_scan";
      console.log("[Tencent_WeixinPersonal][AutoLogin] waiting for Weixin QR scan confirmation.");
      const result = await waitLogin({
        session_key: login.session_key,
        timeout_ms: resolveLoginWaitTimeoutMs(bindings),
      }, callCtx);
      autoLoginState.lastStatus = result.status;
      if (result.connected) {
        autoLoginState.state = "connected";
        autoLoginState.connectedAt = runtimeCredentials.connectedAt;
        console.log(`[Tencent_WeixinPersonal][AutoLogin] connected as ${result.account_id}.`);
        if (resolveAutoStartReceiverAfterLogin(bindings)) {
          await startReceiver({ force_restart: true }, callCtx);
          console.log("[Tencent_WeixinPersonal][AutoLogin] receiver started.");
        }
        autoLoginState.running = false;
        return;
      }
      console.log(`[Tencent_WeixinPersonal][AutoLogin] login not connected: ${result.status || "unknown"} ${result.message || ""}`.trim());
    } catch (err) {
      autoLoginState.lastError = err?.message || String(err);
      autoLoginState.state = "error";
      console.error(`[Tencent_WeixinPersonal][AutoLogin] ${autoLoginState.lastError}`);
    }

    if (!autoLoginState.running || runtimeCredentials.connected) break;
    autoLoginState.state = "retry_wait";
    await sleep(resolveAutoLoginRetryMs(bindings));
  }

  if (!runtimeCredentials.connected) autoLoginState.state = "stopped";
  autoLoginState.running = false;
};

export function startAutoLogin(ctx = {}) {
  if (autoLoginState.running) return false;
  autoLoginState.promise = autoLoginLoop(ctx).catch((err) => {
    autoLoginState.running = false;
    autoLoginState.state = "error";
    autoLoginState.lastError = err?.message || String(err);
    console.error(`[Tencent_WeixinPersonal][AutoLogin] ${autoLoginState.lastError}`);
  });
  return true;
}

export async function stopAutoLogin() {
  autoLoginState.running = false;
  if (autoLoginState.promise) {
    try {
      await autoLoginState.promise;
    } catch {
      // background loop already records the error
    }
  }
  autoLoginState.promise = null;
  if (autoLoginState.state !== "connected") autoLoginState.state = "stopped";
  return { ...autoLoginState };
}

export async function maybeAutoStartLoginFromCli(argv = process.argv.slice(2)) {
  if (argv[0] !== "--runtime" || !["serve", "dev"].includes(argv[1])) return false;
  const config = readRuntimeObject(argv, "--config", "--config-json");
  const secret = readRuntimeObject(argv, "--secret", "--secret-json");
  const bindings = { ...config, ...secret };
  if (!resolveAutoStartLogin(bindings)) return false;
  if (resolveToken(bindings) && !hasExplicitAutoStartLogin(config, secret)) return false;
  return startAutoLogin({ config, secret });
}

export async function maybeAutoStartReceiverFromCli(argv = process.argv.slice(2)) {
  if (argv[0] !== "--runtime" || !["serve", "dev"].includes(argv[1])) return false;
  const config = readRuntimeObject(argv, "--config", "--config-json");
  if (!resolveAutoStartReceiver(config)) return false;
  const secret = readRuntimeObject(argv, "--secret", "--secret-json");
  const bindings = { ...config, ...secret };
  if (resolveAutoStartLogin(bindings) && !resolveToken(bindings)) return false;
  if (!resolveToken(bindings) && !runtimeCredentials.token) return false;
  await startReceiver({}, { config, secret });
  return true;
}
/* node:coverage enable */

export const _test = {
  EP_GET_BOT_QR,
  EP_GET_QR_STATUS,
  EP_GET_UPDATES,
  EP_SEND_MESSAGE,
  DEFAULT_LOGIN_SESSION_TTL_MS,
  DEFAULT_MAX_LOGIN_SESSIONS,
  ackMessage,
  apiGet,
  apiPost,
  assertBusinessOk,
  buildBaseInfo,
  buildHeaders,
  buildTerminalQrCode,
  buildTextMessagePayload,
  buildUrl,
  enqueueReceivedMessages,
  errorWithCode,
  fetchUpdates,
  fetchWithTimeout,
  firstDefined,
  grpcCodeFor,
  handleAckMessage,
  handleFetchUpdates,
  handleGetReceiverStatus,
  handleNormalizeMessage,
  handlePollMessages,
  handleSendText,
  handleStartLogin,
  handleStartReceiver,
  handleStopReceiver,
  handleWaitLogin,
  hasOwn,
  loginSessions,
  mapBusinessCodeToGrpcCode,
  mapHttpStatusToCode,
  maybeAutoStartLoginFromCli,
  maybeAutoStartReceiverFromCli,
  mergedBindings,
  normalizeBaseUrl,
  normalizeMessageObject,
  optionalInt32,
  optionalIntWithDefault,
  optionalUint32,
  parseJsonBody,
  pollLoginStatus,
  pollMessages,
  pruneLoginSessions,
  randomWechatUin,
  receiverState,
  receiverStatus,
  receiverTick,
  registerHandlers,
  requireString,
  resolveAccountCredentials,
  resolveAccountId,
  resolveAutoLoginRetryMs,
  resolveAutoStartLogin,
  resolveAutoStartReceiver,
  resolveAutoStartReceiverAfterLogin,
  resolveBaseUrl,
  resolveBotAgent,
  resolveBotType,
  resolveCallContext,
  resolveLoginBaseUrl,
  resolveLoginWaitTimeoutMs,
  resolveLongPollTimeoutMs,
  resolveMaxBufferedMessages,
  resolvePrintQrCode,
  resolveReceiverRetryMs,
  resolveRouteTag,
  resolveTimeoutMs,
  resolveToken,
  runtimeCredentials,
  autoLoginState,
  sendText,
  startAutoLogin,
  startLogin,
  startReceiver,
  stopAutoLogin,
  stopReceiver,
  toBoolean,
  toTrimmedString,
  unwrapScalar,
  upstreamError,
};

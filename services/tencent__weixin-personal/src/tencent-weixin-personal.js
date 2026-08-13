import { randomBytes, randomUUID } from "node:crypto";
import { GrpcError, grpcStatus } from "@chaitin-ai/octobus-sdk";

export const DEFAULT_ILINK_BASE_URL = "https://ilinkai.weixin.qq.com";
export const DEFAULT_TIMEOUT_MS = 15000;
export const DEFAULT_LONG_POLL_TIMEOUT_MS = 35000;
export const DEFAULT_LOGIN_WAIT_TIMEOUT_MS = 480000;
export const DEFAULT_LOGIN_SESSION_TTL_MS = 10 * 60 * 1000;
export const DEFAULT_MAX_LOGIN_SESSIONS = 32;
export const EP_GET_BOT_QR = "ilink/bot/get_bot_qrcode";
export const EP_GET_QR_STATUS = "ilink/bot/get_qrcode_status";
export const EP_GET_UPDATES = "ilink/bot/getupdates";
export const EP_SEND_MESSAGE = "ilink/bot/sendmessage";

const ILINK_APP_ID = "bot";
const ILINK_APP_CLIENT_VERSION = (2 << 16) | (4 << 8) | 6;
const CHANNEL_VERSION = "2.4.6";

// OctoBus runs one long-running child process per instance. This state is
// therefore instance-local. It deliberately contains only short-lived login
// sessions and the credential obtained by this instance's most recent login.
const state = {
  loginSessions: new Map(),
  credential: null,
};

const codeFor = (name) => grpcStatus[name] ?? grpcStatus.UNKNOWN;
const fail = (name, message) => new GrpcError(codeFor(name), message);
const scalar = (value) => (
  value && typeof value === "object" && Object.prototype.hasOwnProperty.call(value, "value")
    ? scalar(value.value)
    : value
);
const text = (value) => String(scalar(value) ?? "").trim();
const first = (...values) => values.find((value) => value !== undefined && value !== null);
const bindingsFor = (ctx = {}) => ({ ...(ctx.config ?? {}), ...(ctx.secret ?? {}), ...(ctx.bindings ?? {}) });
const required = (value, name) => {
  const result = text(value);
  if (!result) throw fail("INVALID_ARGUMENT", `${name} is required`);
  return result;
};
const positiveInt = (value, fallback) => {
  const number = Number(scalar(value));
  return Number.isFinite(number) && number > 0 ? Math.trunc(number) : fallback;
};

const normalizeBaseUrl = (value, fallback = DEFAULT_ILINK_BASE_URL) => {
  let url;
  try {
    url = new URL(text(value) || fallback);
  } catch {
    throw fail("INVALID_ARGUMENT", "baseUrl must be a valid HTTP/HTTPS URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw fail("INVALID_ARGUMENT", "baseUrl must be a valid HTTP/HTTPS URL");
  }
  url.search = "";
  url.hash = "";
  url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString().replace(/\/$/, "");
};

const resolveBaseUrl = (bindings, login = false) => normalizeBaseUrl(first(
  login ? bindings.loginBaseUrl : bindings.baseUrl,
  login ? bindings.login_base_url : bindings.base_url,
), DEFAULT_ILINK_BASE_URL);
const resolveToken = (bindings) => text(first(bindings.token, bindings.accessToken, bindings.access_token));
const resolveTimeout = (bindings, longPoll = false) => positiveInt(first(
  longPoll ? bindings.longPollTimeoutMs : bindings.timeoutMs,
  longPoll ? bindings.long_poll_timeout_ms : bindings.timeout_ms,
), longPoll ? DEFAULT_LONG_POLL_TIMEOUT_MS : DEFAULT_TIMEOUT_MS);

const randomWechatUin = () => Buffer.from(String(randomBytes(4).readUInt32BE(0))).toString("base64");
const headers = (bindings, token = "", body = "") => ({
  "Content-Type": "application/json",
  AuthorizationType: "ilink_bot_token",
  "X-WECHAT-UIN": randomWechatUin(),
  "iLink-App-Id": ILINK_APP_ID,
  "iLink-App-ClientVersion": String(ILINK_APP_CLIENT_VERSION),
  ...(text(first(bindings.routeTag, bindings.route_tag)) ? { SKRouteTag: text(first(bindings.routeTag, bindings.route_tag)) } : {}),
  ...(token ? { Authorization: `Bearer ${token}` } : {}),
});

const requestJSON = async (url, init, timeoutMs) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const raw = await response.text();
    let body;
    try {
      body = raw.trim() ? JSON.parse(raw) : {};
    } catch {
      throw fail("UNKNOWN", "iLink response is not valid JSON");
    }
    if (!response.ok) throw fail(response.status === 401 ? "UNAUTHENTICATED" : "UNAVAILABLE", `iLink HTTP ${response.status}`);
    const ret = Number(body.ret ?? 0);
    const errcode = Number(body.errcode ?? 0);
    if (ret !== 0 || errcode !== 0) throw fail(errcode === 401 ? "UNAUTHENTICATED" : "FAILED_PRECONDITION", text(body.errmsg) || `iLink error ${errcode || ret}`);
    return { body, status: response.status, raw };
  } catch (error) {
    if (error instanceof GrpcError) throw error;
    const detail = error?.cause?.message ?? error?.message ?? error;
    throw fail("UNAVAILABLE", error?.name === "AbortError" ? "iLink request timed out" : `iLink request failed: ${detail}`);
  } finally {
    clearTimeout(timer);
  }
};

const post = (baseUrl, endpoint, payload, bindings, token = "", timeout = resolveTimeout(bindings)) => {
  const body = JSON.stringify(payload);
  return requestJSON(new URL(endpoint, `${baseUrl}/`), { method: "POST", headers: headers(bindings, token, body), body }, timeout);
};
const get = (baseUrl, endpoint, bindings, timeout = resolveTimeout(bindings, true)) => requestJSON(
  new URL(endpoint, `${baseUrl}/`),
  { method: "GET", headers: headers(bindings) },
  timeout,
);

const pruneSessions = (now = Date.now()) => {
  for (const [key, session] of state.loginSessions) {
    if (now - session.createdAt > DEFAULT_LOGIN_SESSION_TTL_MS) state.loginSessions.delete(key);
  }
  while (state.loginSessions.size >= DEFAULT_MAX_LOGIN_SESSIONS) {
    state.loginSessions.delete(state.loginSessions.keys().next().value);
  }
};

const startLogin = async (req, ctx) => {
  pruneSessions();
  const bindings = bindingsFor(ctx);
  const sessionKey = randomUUID();
  const baseUrl = resolveBaseUrl(bindings, true);
  const botType = text(first(req.bot_type, req.botType, bindings.botType, bindings.bot_type)) || "3";
  const knownToken = resolveToken(bindings);
  const result = await post(baseUrl, `${EP_GET_BOT_QR}?bot_type=${encodeURIComponent(botType)}`, {
    local_token_list: knownToken ? [knownToken] : [],
  }, bindings);
  const qrcode = required(result.body.qrcode, "qrcode");
  state.loginSessions.set(sessionKey, { qrcode, baseUrl, createdAt: Date.now() });
  return {
    session_key: sessionKey,
    qrcode,
    qrcode_url: text(result.body.qrcode_img_content),
    expires_in_seconds: Math.floor(DEFAULT_LOGIN_SESSION_TTL_MS / 1000),
  };
};

const waitLogin = async (req, ctx) => {
  pruneSessions();
  const bindings = bindingsFor(ctx);
  const sessionKey = required(first(req.session_key, req.sessionKey), "session_key");
  const session = state.loginSessions.get(sessionKey);
  if (!session) throw fail("FAILED_PRECONDITION", "login session not found or expired");
  const deadline = Date.now() + positiveInt(first(req.timeout_ms, req.timeoutMs), DEFAULT_LOGIN_WAIT_TIMEOUT_MS);
  let status = "wait";
  while (Date.now() <= deadline) {
    const verify = text(first(req.verify_code, req.verifyCode));
    const suffix = verify ? `&verify_code=${encodeURIComponent(verify)}` : "";
    const result = await get(session.baseUrl, `${EP_GET_QR_STATUS}?qrcode=${encodeURIComponent(session.qrcode)}${suffix}`, bindings);
    status = text(result.body.status) || "wait";
    if (status === "scaned_but_redirect" && result.body.redirect_host) {
      session.baseUrl = normalizeBaseUrl(`https://${text(result.body.redirect_host)}`);
    } else if (status === "confirmed") {
      state.loginSessions.delete(sessionKey);
      state.credential = {
        token: required(result.body.bot_token, "bot_token"),
        accountId: required(result.body.ilink_bot_id, "ilink_bot_id"),
        baseUrl: normalizeBaseUrl(result.body.baseurl, DEFAULT_ILINK_BASE_URL),
      };
      return { connected: true, account_id: state.credential.accountId, status };
    } else if (["expired", "verify_code_blocked", "binded_redirect"].includes(status)) {
      state.loginSessions.delete(sessionKey);
      return { connected: false, status };
    }
    if (Date.now() + 1000 > deadline) break;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return { connected: false, status };
};

const credentials = (ctx) => {
  const bindings = bindingsFor(ctx);
  return {
    bindings,
    token: required(resolveToken(bindings) || state.credential?.token, "token"),
    accountId: text(first(bindings.accountId, bindings.account_id)) || state.credential?.accountId || "",
    baseUrl: first(bindings.baseUrl, bindings.base_url)
      ? resolveBaseUrl(bindings)
      : (state.credential?.baseUrl || DEFAULT_ILINK_BASE_URL),
  };
};

const normalizeMessage = (message = {}, index = 0, accountId = "weixin") => ({
  local_id: `${accountId}:${message.message_id ?? message.seq ?? index}`,
  message_id: Number(message.message_id ?? 0),
  from_user_id: text(message.from_user_id),
  to_user_id: text(message.to_user_id),
  context_token: text(message.context_token),
  text: (Array.isArray(message.item_list) ? message.item_list : [])
    .map((item) => text(item?.text_item?.text ?? item?.voice_item?.text)).filter(Boolean).join("\n"),
  raw_json: JSON.stringify(message),
});

const fetchUpdates = async (req, ctx) => {
  const { bindings, token, baseUrl, accountId } = credentials(ctx);
  const cursor = text(first(req.cursor, req.get_updates_buf, req.getUpdatesBuf));
  const result = await post(baseUrl, EP_GET_UPDATES, {
    get_updates_buf: cursor,
    base_info: { channel_version: CHANNEL_VERSION, bot_agent: text(first(bindings.botAgent, bindings.bot_agent)) || "OctoBus/0.1.0" },
  }, bindings, token, positiveInt(first(req.timeout_ms, req.timeoutMs), resolveTimeout(bindings, true)));
  return {
    cursor: text(first(result.body.get_updates_buf, result.body.sync_buf, cursor)),
    messages: (Array.isArray(result.body.msgs) ? result.body.msgs : []).map((message, index) => normalizeMessage(message, index, accountId)),
  };
};

const sendText = async (req, ctx) => {
  const { bindings, token, baseUrl } = credentials(ctx);
  const clientId = text(first(req.client_id, req.clientId)) || `octobus-${randomUUID()}`;
  await post(baseUrl, EP_SEND_MESSAGE, {
    msg: {
      from_user_id: "",
      to_user_id: required(first(req.to_user_id, req.toUserId), "to_user_id"),
      client_id: clientId,
      message_type: 2,
      message_state: 2,
      item_list: [{ type: 1, text_item: { text: required(first(req.message, req.text), "message") } }],
      ...(text(first(req.context_token, req.contextToken)) ? { context_token: text(first(req.context_token, req.contextToken)) } : {}),
    },
    base_info: { channel_version: CHANNEL_VERSION, bot_agent: text(first(bindings.botAgent, bindings.bot_agent)) || "OctoBus/0.1.0" },
  }, bindings, token);
  return { success: true, client_id: clientId };
};

const paths = {
  StartLogin: "/Tencent_WeixinPersonal.Tencent_WeixinPersonal/StartLogin",
  WaitLogin: "/Tencent_WeixinPersonal.Tencent_WeixinPersonal/WaitLogin",
  FetchUpdates: "/Tencent_WeixinPersonal.Tencent_WeixinPersonal/FetchUpdates",
  SendText: "/Tencent_WeixinPersonal.Tencent_WeixinPersonal/SendText",
};
const implementation = { StartLogin: startLogin, WaitLogin: waitLogin, FetchUpdates: fetchUpdates, SendText: sendText };
export const handlers = Object.fromEntries(Object.entries(implementation).map(([name, handler]) => [
  `Tencent_WeixinPersonal.Tencent_WeixinPersonal/${name}`,
  (ctx = {}) => handler(ctx.request ?? ctx.req ?? {}, ctx),
]));
export const rpcdef = (ctx = {}) => Object.fromEntries(Object.entries(implementation).map(([name, handler]) => [
  paths[name],
  (req = {}) => handler(req, ctx),
]));

export const _test = { state, pruneSessions, normalizeBaseUrl, normalizeMessage, startLogin, waitLogin, fetchUpdates, sendText, requestJSON };

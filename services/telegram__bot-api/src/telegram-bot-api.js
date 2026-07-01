import { GrpcError, grpcStatus } from "@chaitin-ai/octobus-sdk";
import { spawn } from "node:child_process";

export const METHOD_GET_ME_PATH = "/Telegram_Bot_API.Telegram_Bot_API/GetMe";
export const METHOD_SEND_MESSAGE_PATH = "/Telegram_Bot_API.Telegram_Bot_API/SendMessage";
export const METHOD_GET_ME_FULL = "Telegram_Bot_API.Telegram_Bot_API/GetMe";
export const METHOD_SEND_MESSAGE_FULL = "Telegram_Bot_API.Telegram_Bot_API/SendMessage";

export const DEFAULT_BASE_URL = "https://api.telegram.org";
export const DEFAULT_TIMEOUT_MS = 5000;

const JSON_HEADERS = {
  "Content-Type": "application/json",
};

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

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj ?? {}, key);
const firstDefined = (...values) => values.find((value) => value !== undefined && value !== null);
const firstNonEmptyString = (...values) => {
  for (const value of values) {
    const text = toTrimmedString(value);
    if (text) return text;
  }
  return "";
};

const unwrapScalar = (value) => {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "object" && value !== null && hasOwn(value, "value")) return unwrapScalar(value.value);
  return value;
};

const toTrimmedString = (value) => {
  const raw = unwrapScalar(value);
  if (raw === undefined || raw === null) return "";
  return String(raw).trim();
};

const optionalString = (value) => {
  const text = toTrimmedString(value);
  return text || undefined;
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

const optionalPositiveInt = (value) => {
  const raw = unwrapScalar(value);
  if (raw === undefined || raw === null || raw === "") return undefined;
  const num = Number(raw);
  if (!Number.isFinite(num) || num <= 0) return undefined;
  return Math.trunc(num);
};

const normalizeBaseUrl = (value) => {
  const text = toTrimmedString(value) || DEFAULT_BASE_URL;
  if (!/^https?:\/\//i.test(text)) return "";
  return text.replace(/\/+$/, "");
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

const pickString = (obj, keys) => {
  for (const key of keys) {
    if (!hasOwn(obj, key)) continue;
    const value = toTrimmedString(obj[key]);
    if (value) return value;
  }
  return "";
};

const resolveBaseUrl = (bindings = {}) => {
  const baseUrl = normalizeBaseUrl(firstDefined(bindings.base_url, bindings.baseUrl, bindings.host, DEFAULT_BASE_URL));
  if (!baseUrl) throw errorWithCode("INVALID_ARGUMENT", "base_url must be a valid HTTP/HTTPS URL");
  return baseUrl;
};

const resolveBotToken = (bindings = {}) => {
  const token = pickString(bindings, ["bot_token", "botToken", "token"]);
  if (!token) throw errorWithCode("INVALID_ARGUMENT", "bot_token is required in secret");
  return token;
};

const resolveTimeoutMs = (ctx = {}) => firstDefined(
  optionalPositiveInt(ctx.bindings?.timeoutMs),
  optionalPositiveInt(ctx.bindings?.timeout_ms),
  optionalPositiveInt(ctx.limits?.timeoutMs),
  DEFAULT_TIMEOUT_MS,
);

const resolveProxyUrl = (bindings = {}) => optionalString(firstDefined(bindings.proxy_url, bindings.proxyUrl));

const telegramUrl = (baseUrl, botToken, method) => `${baseUrl}/bot${botToken}/${method}`;

const redactTelegramUrl = (url) => String(url).replace(/\/bot[^/]+\//, "/bot******/");

const toValue = (value) => {
  const raw = unwrapScalar(value);
  if (raw === undefined || raw === null) return { nullValue: "NULL_VALUE" };
  if (typeof raw === "string") return { stringValue: raw };
  if (typeof raw === "number") return { numberValue: raw };
  if (typeof raw === "boolean") return { boolValue: raw };
  if (Array.isArray(raw)) return { listValue: { values: raw.map((item) => toValue(item)) } };
  if (typeof raw === "object") return { structValue: toStruct(raw) };
  return { stringValue: String(raw) };
};

const toStruct = (obj) => {
  const fields = {};
  for (const [key, value] of Object.entries(obj || {})) fields[key] = toValue(value);
  return { fields };
};

const parseJsonObject = (text) => {
  if (!String(text || "").trim()) return {};
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
};

const normalizeResponse = (httpStatus, rawBody) => {
  const bodyJson = parseJsonObject(rawBody);
  return {
    http_status: Number(httpStatus) || 0,
    raw_body: String(rawBody ?? ""),
    body_json: toStruct(bodyJson),
    ok: bodyJson.ok === true,
  };
};

const createLogger = (ctx = {}) => (phase, details) => {
  const meta = ctx.meta || {};
  const labels = ["Telegram_Bot_API", phase];
  if (meta.instance_id || meta.instanceId) labels.push(`inst=${meta.instance_id || meta.instanceId}`);
  if (meta.request_id || meta.requestId) labels.push(`req=${meta.request_id || meta.requestId}`);
  try {
    console.log(`[${labels.join(" ")}]`, JSON.stringify(details));
  } catch {
    console.log(`[${labels.join(" ")}]`, details);
  }
};

const mapHttpStatusToCode = (status) => {
  if (status === 401 || status === 403) return "PERMISSION_DENIED";
  if (status >= 400 && status < 500) return "FAILED_PRECONDITION";
  return "UNAVAILABLE";
};

const curlFetch = async (url, init = {}, options = {}) => {
  const timeoutMs = Number(options.timeoutMs) || DEFAULT_TIMEOUT_MS;
  const args = [
    "-sS",
    "-w",
    "\n%{http_code}",
    "--connect-timeout",
    String(Math.max(1, Math.ceil(timeoutMs / 1000))),
    "--max-time",
    String(Math.max(1, Math.ceil(timeoutMs / 1000))),
  ];

  if (options.proxyUrl) args.push("--proxy", options.proxyUrl);
  args.push("-X", init.method || "GET");
  for (const [key, value] of Object.entries(init.headers || {})) args.push("-H", `${key}: ${value}`);
  if (init.body !== undefined && init.body !== null) args.push("-d", String(init.body));
  args.push(url);

  const child = spawn("curl", args, { stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });

  const exitCode = await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", resolve);
  });
  if (exitCode !== 0) throw new Error(stderr.trim() || `curl exited with ${exitCode}`);

  const marker = stdout.lastIndexOf("\n");
  if (marker < 0) return { status: 0, text: async () => stdout };
  const body = stdout.slice(0, marker);
  const status = Number(stdout.slice(marker + 1).trim()) || 0;
  return { status, text: async () => body };
};

const fetchTelegram = async (ctx, methodName, init) => {
  const bindings = ctx.bindings || {};
  const baseUrl = resolveBaseUrl(bindings);
  const botToken = resolveBotToken(bindings);
  const timeoutMs = resolveTimeoutMs(ctx);
  const proxyUrl = resolveProxyUrl(bindings);
  const url = telegramUrl(baseUrl, botToken, methodName);
  const log = createLogger(ctx);

  log("request", {
    method: init.method || "GET",
    url: redactTelegramUrl(url),
    bodyLength: init.body ? String(init.body).length : 0,
    proxy: proxyUrl ? "configured" : "none",
  });

  let res;
  try {
    res = proxyUrl
      ? await curlFetch(url, init, { timeoutMs, proxyUrl })
      : await fetch(url, {
        timeoutMs,
        ...init,
      });
  } catch (err) {
    const reason = err?.cause?.message || err?.message || "fetch failed";
    throw errorWithCode("UNAVAILABLE", reason);
  }

  let rawBody;
  try {
    rawBody = await res.text();
  } catch (err) {
    throw errorWithCode("UNKNOWN", err?.message || "response body read failed");
  }

  const httpStatus = Number(res.status || 0);
  log("response", {
    httpStatus,
    bodyLength: String(rawBody ?? "").length,
  });

  const normalized = normalizeResponse(httpStatus, rawBody);
  if (httpStatus < 200 || httpStatus >= 300) {
    const err = errorWithCode(mapHttpStatusToCode(httpStatus), `Telegram API HTTP ${httpStatus}: ${rawBody}`);
    err.httpStatus = httpStatus;
    err.rawBody = String(rawBody ?? "");
    throw err;
  }
  return normalized;
};

const buildSendMessagePayload = (req = {}, bindings = {}) => {
  const chatId = firstNonEmptyString(req.chat_id, req.chatId, bindings.chat_id, bindings.chatId);
  if (!chatId) throw errorWithCode("INVALID_ARGUMENT", "chat_id is required in request or config");

  const text = firstNonEmptyString(req.text, req.message, req.send_msg, req.sendMsg);
  if (!text) throw errorWithCode("INVALID_ARGUMENT", "text is required and must not be empty");

  const payload = {
    chat_id: chatId,
    text,
  };

  const parseMode = firstNonEmptyString(req.parse_mode, req.parseMode, bindings.parse_mode, bindings.parseMode);
  if (parseMode) payload.parse_mode = parseMode;

  const disablePreview = firstDefined(req.disable_web_page_preview, req.disableWebPagePreview, bindings.disable_web_page_preview, bindings.disableWebPagePreview);
  if (disablePreview !== undefined && disablePreview !== null) payload.disable_web_page_preview = toBoolean(disablePreview);

  const disableNotification = firstDefined(req.disable_notification, req.disableNotification);
  if (disableNotification !== undefined && disableNotification !== null) payload.disable_notification = toBoolean(disableNotification);

  const replyTo = optionalPositiveInt(firstDefined(req.reply_to_message_id, req.replyToMessageId));
  if (replyTo) payload.reply_to_message_id = replyTo;

  return payload;
};

const handleGetMe = async (req = {}, ctx = {}) => {
  const callCtx = resolveCallContext(ctx);
  return fetchTelegram(callCtx, "getMe", {
    method: "GET",
  });
};

const handleSendMessage = async (req = {}, ctx = {}) => {
  const callCtx = resolveCallContext(ctx);
  const payload = buildSendMessagePayload(req, callCtx.bindings || {});
  return fetchTelegram(callCtx, "sendMessage", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(payload),
  });
};

const registerHandlers = (ctx = {}) => {
  const callCtx = resolveCallContext(ctx);
  return {
    [METHOD_GET_ME_PATH]: (req = callCtx.req) => handleGetMe(req ?? {}, callCtx),
    [METHOD_SEND_MESSAGE_PATH]: (req = callCtx.req) => handleSendMessage(req ?? {}, callCtx),
  };
};

export function rpcdef(ctx = {}) {
  return registerHandlers(ctx);
}

const callSdkHandler = (ctx = {}, path) => registerHandlers(ctx)[path](ctx.req ?? ctx.request ?? {});

export const handlers = {
  [METHOD_GET_ME_FULL]: (reqOrCtx, ctx) => (
    ctx === undefined
      ? callSdkHandler(reqOrCtx ?? {}, METHOD_GET_ME_PATH)
      : handleGetMe(reqOrCtx ?? {}, ctx)
  ),
  [METHOD_SEND_MESSAGE_FULL]: (reqOrCtx, ctx) => (
    ctx === undefined
      ? callSdkHandler(reqOrCtx ?? {}, METHOD_SEND_MESSAGE_PATH)
      : handleSendMessage(reqOrCtx ?? {}, ctx)
  ),
};

export const _test = {
  buildSendMessagePayload,
  errorWithCode,
  fetchTelegram,
  firstDefined,
  firstNonEmptyString,
  grpcCodeFor,
  hasOwn,
  mapHttpStatusToCode,
  mergedBindings,
  normalizeBaseUrl,
  normalizeResponse,
  optionalPositiveInt,
  parseJsonObject,
  pickString,
  redactTelegramUrl,
  resolveBaseUrl,
  resolveBotToken,
  resolveCallContext,
  resolveProxyUrl,
  resolveTimeoutMs,
  telegramUrl,
  toBoolean,
  toStruct,
  toTrimmedString,
  toValue,
  unwrapScalar,
};

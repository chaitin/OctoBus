import { createHmac } from "node:crypto";
import { Agent, fetch } from "undici";

const DEFAULT_TIMEOUT_MS = 10000;
const MAX_BODY_BYTES = 1024 * 1024;
let insecureDispatcher;

export class HermesClientError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "HermesClientError";
    this.code = code;
    this.details = details;
  }
}

export function normalizeBaseUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) throw new HermesClientError("INVALID_ARGUMENT", "config.baseUrl is required");
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new HermesClientError("INVALID_ARGUMENT", "config.baseUrl must be a valid URL");
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new HermesClientError("INVALID_ARGUMENT", "config.baseUrl must use http or https");
  }
  parsed.pathname = parsed.pathname.replace(/\/+$/, "");
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString().replace(/\/$/, "");
}

export function normalizePath(path) {
  const raw = String(path || "").trim();
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.includes("://")) {
    throw new HermesClientError("INVALID_ARGUMENT", "path must be an absolute local path such as /webhook");
  }
  if (raw.includes("..")) {
    throw new HermesClientError("INVALID_ARGUMENT", "path must not contain '..'");
  }
  return raw;
}

export function assertAllowedPath(path, allowedPaths) {
  const allowed = Array.isArray(allowedPaths)
    ? allowedPaths.filter((item) => String(item || "").trim()).map(normalizePath)
    : [];
  if (allowed.length === 0) {
    throw new HermesClientError("INVALID_ARGUMENT", "config.allowedPaths must contain at least one path");
  }
  const matched = allowed.some((allowedPath) => {
    if (allowedPath.endsWith("*")) {
      const prefix = allowedPath.slice(0, -1);
      return prefix.length > 1 && path.startsWith(prefix);
    }
    return allowedPath === path;
  });
  if (!matched) {
    throw new HermesClientError("PERMISSION_DENIED", `path ${path} is not in config.allowedPaths`);
  }
}

export function timeoutMs(config, requested = 0) {
  const raw = Number(requested || config?.timeoutMs || DEFAULT_TIMEOUT_MS);
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_TIMEOUT_MS;
  return Math.max(1000, Math.min(raw, 120000));
}

export function parsePayloadJson(payloadJson) {
  const raw = String(payloadJson || "").trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new HermesClientError("INVALID_ARGUMENT", `payloadJson must be valid JSON: ${error.message}`);
  }
}

export function redactHeaders(headers, secret) {
  const authName = String(secret?.authHeaderName || "").toLowerCase();
  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => {
      const lower = key.toLowerCase();
      if (lower === "authorization" || lower === authName || lower === "x-webhook-signature") return [key, "******"];
      return [key, value];
    }),
  );
}

function truncateBody(body) {
  if (body.length <= MAX_BODY_BYTES) return body;
  return `${body.slice(0, MAX_BODY_BYTES)}\n... truncated ${body.length - MAX_BODY_BYTES} bytes ...`;
}

function headersObject(headers) {
  return Object.fromEntries([...headers.entries()].map(([key, value]) => [key, value]));
}

function buildEvidence({ method, url, requestHeaders, requestBody, statusCode, statusText, responseHeaders, responseBody }) {
  const requestHeaderText = Object.entries(requestHeaders)
    .map(([key, value]) => `${key}: ${value}`)
    .join("\n");
  const responseHeaderText = Object.entries(responseHeaders)
    .map(([key, value]) => `${key}: ${value}`)
    .join("\n");
  return [
    "# Request",
    `${method} ${url}`,
    requestHeaderText,
    "",
    requestBody || "<empty>",
    "",
    "# Response",
    `HTTP/1.1 ${statusCode} ${statusText || ""}`.trim(),
    responseHeaderText,
    "",
    responseBody || "<empty>",
  ].join("\n");
}

function buildFetchOptions({ method, headers, requestBody, signal, skipTlsVerify }) {
  const options = {
    method,
    headers,
    body: requestBody || undefined,
    signal,
  };
  if (skipTlsVerify) {
    insecureDispatcher ??= new Agent({
      connect: {
        rejectUnauthorized: false,
      },
    });
    options.dispatcher = insecureDispatcher;
  }
  return options;
}

export async function callHermes({ config = {}, secret = {}, method, path, body, headers = {}, timeout }) {
  const baseUrl = normalizeBaseUrl(config.baseUrl);
  const finalPath = normalizePath(path);
  assertAllowedPath(finalPath, [config.healthPath, config.defaultPath, ...(config.allowedPaths || [])]);

  const url = `${baseUrl}${finalPath}`;
  const requestBody = body === undefined ? "" : JSON.stringify(body);
  const finalHeaders = {
    "Accept": "application/json, text/plain, */*",
    "User-Agent": String(config.userAgent || "octobus-hermes-gateway/0.1.0"),
    ...headers,
  };
  if (requestBody) finalHeaders["Content-Type"] = finalHeaders["Content-Type"] || "application/json";
  if (secret.authHeaderName && secret.authHeaderValue) {
    finalHeaders[String(secret.authHeaderName)] = String(secret.authHeaderValue);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs(config, timeout));
  timer.unref?.();

  let response;
  let responseBody = "";
  try {
    response = await fetch(url, buildFetchOptions({
      method,
      headers: finalHeaders,
      requestBody,
      signal: controller.signal,
      skipTlsVerify: Boolean(config.skipTlsVerify && baseUrl.startsWith("https://")),
    }));
    responseBody = truncateBody(await response.text());
  } catch (error) {
    const code = error?.name === "AbortError" ? "DEADLINE_EXCEEDED" : "UNAVAILABLE";
    throw new HermesClientError(code, error.message || "Hermes request failed");
  } finally {
    clearTimeout(timer);
  }

  const redactedRequestHeaders = redactHeaders(finalHeaders, secret);
  const responseHeaders = headersObject(response.headers);
  const result = {
    ok: response.ok,
    statusCode: response.status,
    statusText: response.statusText,
    requestMethod: method,
    requestUrl: url,
    requestHeadersJson: JSON.stringify(redactedRequestHeaders, null, 2),
    requestBody,
    responseHeadersJson: JSON.stringify(responseHeaders, null, 2),
    responseBody,
    evidence: buildEvidence({
      method,
      url,
      requestHeaders: redactedRequestHeaders,
      requestBody,
      statusCode: response.status,
      statusText: response.statusText,
      responseHeaders,
      responseBody,
    }),
  };

  if (response.status === 401) throw new HermesClientError("UNAUTHENTICATED", responseBody || "Hermes authentication failed", result);
  if (response.status === 403) throw new HermesClientError("PERMISSION_DENIED", responseBody || "Hermes permission denied", result);
  if (response.status >= 500) throw new HermesClientError("UNAVAILABLE", responseBody || "Hermes upstream error", result);
  return result;
}

export async function healthCheck(ctx) {
  const config = ctx?.config || {};
  return callHermes({
    config,
    secret: ctx?.secret || {},
    method: "GET",
    path: config.healthPath || "/health",
    timeout: ctx?.request?.timeoutMs,
  });
}

function resolveWebhookHmacSecret(request, secret) {
  const secretName = String(request.hmacSecretName || "").trim();
  if (secretName) {
    const secrets = secret?.webhookHmacSecrets || {};
    const value = typeof secrets === "object" && secrets !== null ? secrets[secretName] : "";
    if (!value) {
      throw new HermesClientError("FAILED_PRECONDITION", `webhook HMAC secret '${secretName}' is not configured`);
    }
    return String(value);
  }
  return request.hmacSecret ? String(request.hmacSecret) : "";
}

export async function sendWebhook(ctx) {
  const request = ctx?.request || {};
  const config = ctx?.config || {};
  const secret = ctx?.secret || {};
  const headers = { ...(request.headers || {}) };
  if (request.idempotencyKey) headers["Idempotency-Key"] = String(request.idempotencyKey);
  if (request.correlationId) headers["X-Correlation-ID"] = String(request.correlationId);
  const body = parsePayloadJson(request.payloadJson);
  const hmacSecret = resolveWebhookHmacSecret(request, secret);
  if (hmacSecret && !headers["X-Webhook-Signature"]) {
    const rawBody = JSON.stringify(body);
    headers["X-Webhook-Signature"] = createHmac("sha256", hmacSecret).update(rawBody).digest("hex");
  }
  return callHermes({
    config,
    secret,
    method: "POST",
    path: request.path || config.defaultPath || "/webhook",
    body,
    headers,
    timeout: request.timeoutMs,
  });
}

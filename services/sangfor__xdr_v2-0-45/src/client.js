import {
  GrpcError,
  grpcInvalidArgumentError,
  grpcNotFoundError,
  grpcPermissionDeniedError,
  grpcStatus,
  grpcUnauthenticatedError,
  grpcUnavailableError,
} from "@chaitin-ai/octobus-sdk";

import { decodeAuthCode, signRequest } from "./signer.js";

const DEFAULT_TIMEOUT_MS = 15000;
let insecureDispatcherPromise;

const failedPrecondition = (message) => new GrpcError(grpcStatus.FAILED_PRECONDITION, message);
const unknownError = (message) => new GrpcError(grpcStatus.UNKNOWN, message);

const resolveBaseUrl = (config) => {
  const raw = typeof config?.baseUrl === "string" ? config.baseUrl.trim() : "";
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw grpcInvalidArgumentError("config.baseUrl must be an absolute HTTP(S) URL");
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    throw grpcInvalidArgumentError("config.baseUrl must use HTTP or HTTPS");
  }
  return url.toString().replace(/\/+$/, "");
};

const resolveTimeout = (config) => {
  const timeout = Number(config?.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  if (!Number.isInteger(timeout) || timeout <= 0 || timeout > 300000) {
    throw grpcInvalidArgumentError("config.timeoutMs must be an integer from 1 to 300000");
  }
  return timeout;
};

const resolveCredentials = (secret) => {
  const authCode = typeof secret?.authCode === "string" ? secret.authCode.trim() : "";
  if (authCode) {
    try {
      return decodeAuthCode(authCode);
    } catch (error) {
      throw grpcInvalidArgumentError(`secret.authCode is invalid: ${error.message}`);
    }
  }
  const accessKey = typeof secret?.accessKey === "string" ? secret.accessKey.trim() : "";
  const secretKey = typeof secret?.secretKey === "string" ? secret.secretKey.trim() : "";
  if (!accessKey || !secretKey) {
    throw grpcUnauthenticatedError("configure secret.authCode or both secret.accessKey and secret.secretKey");
  }
  return { accessKey, secretKey };
};

const safeUpstreamMessage = (json, status) => {
  const message = typeof json?.message === "string" ? json.message.trim() : "";
  return message ? `upstream HTTP ${status}: ${message.slice(0, 300)}` : `upstream HTTP ${status}`;
};

const mapHttpError = (status, json) => {
  const message = safeUpstreamMessage(json, status);
  if (status === 401) return grpcUnauthenticatedError(message);
  if (status === 403) return grpcPermissionDeniedError(message);
  if (status === 404) return grpcNotFoundError(message);
  if (status === 429 || status >= 500) return grpcUnavailableError(message);
  return failedPrecondition(message);
};

const parseJson = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    throw unknownError("upstream returned invalid JSON");
  }
};

const ensureBusinessSuccess = (json) => {
  if (json == null || typeof json !== "object") {
    throw unknownError("upstream returned an empty JSON response");
  }
  const code = json.code;
  if (code === undefined || code === null || code === "" || code === 0 || code === "0" || code === "Success" || code === "success") {
    return json;
  }
  const message = typeof json.message === "string" && json.message.trim()
    ? json.message.trim().slice(0, 300)
    : "XDR business request failed";
  throw failedPrecondition(`upstream code ${String(code)}: ${message}`);
};

const defaultFetch = async (url, init, skipTlsVerify) => {
  const { Agent, fetch } = await import("undici");
  if (!skipTlsVerify) return fetch(url, init);
  insecureDispatcherPromise ??= Promise.resolve(new Agent({
    connect: {
      rejectUnauthorized: false,
    },
  }));
  return fetch(url, {
    ...init,
    dispatcher: await insecureDispatcherPromise,
  });
};

export function createXdrClient(ctx = {}, options = {}) {
  const config = ctx.config ?? {};
  const secret = ctx.secret ?? {};
  const baseUrl = resolveBaseUrl(config);
  const timeoutMs = resolveTimeout(config);
  const credentials = resolveCredentials(secret);
  const configuredHeaders = config.headers && typeof config.headers === "object" && !Array.isArray(config.headers)
    ? config.headers
    : {};
  const now = options.now ?? (() => new Date());
  const fetchImpl = options.fetchImpl;

  const request = async (method, path, bodyObject) => {
    const url = `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
    const body = bodyObject === undefined ? "" : JSON.stringify(bodyObject);
    const initialHeaders = {
      ...configuredHeaders,
      "content-type": "application/json",
    };
    const signed = signRequest({
      method,
      url,
      headers: initialHeaders,
      body,
      ...credentials,
      now: now(),
    });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try {
      const init = {
        method,
        headers: signed.headers,
        signal: controller.signal,
      };
      if (bodyObject !== undefined) init.body = body;
      response = fetchImpl
        ? await fetchImpl(url, init)
        : await defaultFetch(url, init, config.skipTlsVerify === true);
    } catch (error) {
      throw grpcUnavailableError(error?.name === "AbortError" ? "upstream request timed out" : "upstream network request failed");
    } finally {
      clearTimeout(timer);
    }

    const text = await response.text();
    if (!text.trim()) throw unknownError("upstream returned an empty response");
    const json = parseJson(text);
    if (!response.ok) throw mapHttpError(response.status, json);
    return ensureBusinessSuccess(json);
  };

  return {
    get: (path) => request("GET", path),
    post: (path, body = {}) => request("POST", path, body),
  };
}

export const _test = {
  ensureBusinessSuccess,
  mapHttpError,
  resolveBaseUrl,
  resolveCredentials,
};

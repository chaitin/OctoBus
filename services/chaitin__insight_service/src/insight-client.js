import { Agent, fetch } from "undici";

export const DEFAULT_RPC_PATH = "/pedestal/rpc";
export const DEFAULT_TIMEOUT_MS = 10000;

export class InsightClientError extends Error {
  constructor(message, options = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = "InsightClientError";
    this.code = options.code ?? "UPSTREAM_ERROR";
    this.httpStatus = options.httpStatus;
    this.rpcCode = options.rpcCode;
    this.businessCode = options.businessCode;
  }
}

export const normalizeBaseUrl = (value) => {
  const raw = String(value ?? "").trim();
  if (!raw) throw new InsightClientError("baseUrl is required", { code: "INVALID_ARGUMENT" });

  let parsed;
  try {
    parsed = new URL(raw);
  } catch (cause) {
    throw new InsightClientError("baseUrl must be a valid HTTP(S) URL", {
      code: "INVALID_ARGUMENT",
      cause,
    });
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new InsightClientError("baseUrl must use HTTP or HTTPS", { code: "INVALID_ARGUMENT" });
  }

  parsed.hash = "";
  parsed.search = "";
  parsed.pathname = parsed.pathname.replace(/\/+$/, "") || "/";
  return parsed.toString().replace(/\/$/, "");
};

export const normalizeRpcPath = (value) => {
  const raw = String(value ?? DEFAULT_RPC_PATH).trim();
  if (!raw) return DEFAULT_RPC_PATH;
  return raw.startsWith("/") ? raw : `/${raw}`;
};

export const normalizeTimeoutMs = (value) => {
  const parsed = Number(value ?? DEFAULT_TIMEOUT_MS);
  if (!Number.isFinite(parsed)) return DEFAULT_TIMEOUT_MS;
  return Math.min(120000, Math.max(1000, Math.floor(parsed)));
};

export const toJsonSafe = (value) => {
  if (typeof value === "bigint") {
    return value <= BigInt(Number.MAX_SAFE_INTEGER) && value >= BigInt(Number.MIN_SAFE_INTEGER)
      ? Number(value)
      : value.toString();
  }
  if (Array.isArray(value)) return value.map(toJsonSafe);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, toJsonSafe(item)]));
  }
  return value;
};

const errorMessage = (payload, fallback) => payload?.error?.message
  || payload?.msg
  || payload?.message
  || fallback;

const errorCodeForHttpStatus = (status) => {
  if (status === 401) return "UNAUTHENTICATED";
  if (status === 403) return "PERMISSION_DENIED";
  if (status === 404) return "NOT_FOUND";
  if (status === 429) return "RESOURCE_EXHAUSTED";
  return "UNAVAILABLE";
};

const errorCodeForRpcCode = (code) => {
  if (code === -32600 || code === -32602) return "INVALID_ARGUMENT";
  if (code === -32601) return "NOT_FOUND";
  return "UPSTREAM_ERROR";
};

const errorCodeForBusinessCode = (code) => {
  if (code === 400 || code === 422) return "INVALID_ARGUMENT";
  if (code === 401) return "UNAUTHENTICATED";
  if (code === 403) return "PERMISSION_DENIED";
  if (code === 404) return "NOT_FOUND";
  if (code === 409 || code === 412) return "FAILED_PRECONDITION";
  if (code === 413 || code === 429) return "RESOURCE_EXHAUSTED";
  if (code === 408 || (code >= 500 && code <= 599)) return "UNAVAILABLE";
  return "UPSTREAM_ERROR";
};

export class InsightClient {
  constructor(options = {}) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl);
    this.rpcPath = normalizeRpcPath(options.rpcPath);
    this.token = String(options.token ?? "").trim();
    this.timeoutMs = normalizeTimeoutMs(options.timeoutMs);
    this.sendJwtCookie = options.sendJwtCookie !== false;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.dispatcher = options.skipTlsVerify
      ? new Agent({ connect: { rejectUnauthorized: false } })
      : undefined;
    this.nextId = 0;

    if (!this.token) {
      throw new InsightClientError("token is required", { code: "UNAUTHENTICATED" });
    }
  }

  async close() {
    await this.dispatcher?.close();
  }

  buildUrl(path, query = {}) {
    const normalizedPath = String(path ?? "").trim();
    if (!normalizedPath.startsWith("/")) {
      throw new InsightClientError("Insight request path must start with /", {
        code: "INVALID_ARGUMENT",
      });
    }
    const url = new URL(`${this.baseUrl}${normalizedPath}`);
    for (const [key, rawValue] of Object.entries(query ?? {})) {
      if (rawValue === undefined || rawValue === null || rawValue === "") continue;
      url.searchParams.set(key, String(toJsonSafe(rawValue)));
    }
    return url;
  }

  buildHeaders(hasBody) {
    const headers = {
      accept: "application/json",
      authorization: `Bearer ${this.token}`,
    };
    if (this.sendJwtCookie) headers.cookie = `jwt=${this.token}`;
    if (hasBody) headers["content-type"] = "application/json";
    return headers;
  }

  async request(method, path, options = {}) {
    const hasBody = options.body !== undefined;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(this.buildUrl(path, options.query), {
        method: String(method ?? "GET").toUpperCase(),
        headers: this.buildHeaders(hasBody),
        ...(hasBody ? { body: JSON.stringify(toJsonSafe(options.body)) } : {}),
        signal: controller.signal,
        ...(this.dispatcher ? { dispatcher: this.dispatcher } : {}),
      });

      let payload;
      try {
        const text = await response.text();
        payload = text ? JSON.parse(text) : {};
      } catch (cause) {
        throw new InsightClientError(
          controller.signal.aborted ? `Insight request timed out after ${this.timeoutMs}ms` : "Insight returned a non-JSON response",
          { code: controller.signal.aborted ? "UNAVAILABLE" : "UPSTREAM_ERROR", httpStatus: response.status, cause },
        );
      }

      if (!response.ok) {
        throw new InsightClientError(errorMessage(payload, `Insight HTTP ${response.status}`), {
          code: errorCodeForHttpStatus(response.status),
          httpStatus: response.status,
        });
      }
      return payload;
    } catch (cause) {
      if (cause instanceof InsightClientError) throw cause;
      throw new InsightClientError(
        controller.signal.aborted ? `Insight request timed out after ${this.timeoutMs}ms` : cause?.message || "Insight request failed",
        { code: "UNAVAILABLE", cause },
      );
    } finally {
      clearTimeout(timer);
    }
  }

  async callRpc(method, params = {}) {
    const rpcMethod = String(method ?? "").trim();
    if (!rpcMethod) {
      throw new InsightClientError("JSON-RPC method is required", { code: "INVALID_ARGUMENT" });
    }

    const id = String(this.nextId++);
    const payload = await this.request("POST", this.rpcPath, {
      body: { jsonrpc: "2.0", id, method: rpcMethod, params },
    });
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new InsightClientError("Insight returned an invalid JSON-RPC response");
    }
    if (payload.jsonrpc !== "2.0" || !Object.hasOwn(payload, "id") || String(payload.id) !== id) {
      throw new InsightClientError("Insight returned an invalid JSON-RPC envelope");
    }
    const hasResult = Object.hasOwn(payload, "result");
    const hasError = Object.hasOwn(payload, "error");
    if (hasResult === hasError) {
      throw new InsightClientError("Insight JSON-RPC response must contain exactly one of result or error");
    }
    if (hasError) {
      throw new InsightClientError(payload.error?.message || "Insight JSON-RPC request failed", {
        code: errorCodeForRpcCode(payload.error?.code),
        rpcCode: payload.error?.code,
      });
    }
    return payload.result;
  }

  async callRest(method, path, options = {}) {
    const payload = await this.request(method, path, options);
    const businessCode = Number(payload?.code);
    if (payload && typeof payload === "object" && Object.hasOwn(payload, "code")
      && Number.isFinite(businessCode) && businessCode !== 0) {
      throw new InsightClientError(errorMessage(payload, `Insight business error ${businessCode}`), {
        code: errorCodeForBusinessCode(businessCode),
        businessCode,
      });
    }
    return payload;
  }
}

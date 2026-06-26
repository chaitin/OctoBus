/**
 * 深信服 XDR API 客户端工厂
 */

import { createSign } from "./sangfor-sign.js";
import { GrpcError, grpcStatus } from "@chaitin-ai/octobus-sdk";

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj ?? {}, key);

const firstDefined = (...values) => values.find((v) => v !== undefined && v !== null);

const unwrapString = (value) => {
  if (value === undefined || value === null) return "";
  if (typeof value === "object" && value !== null && hasOwn(value, "value")) return unwrapString(value.value);
  return String(value);
};

export const resolveBaseUrl = (config = {}) => {
  const raw = firstDefined(
    unwrapString(config.xdrBaseUrl),
    unwrapString(config.endpoint),
    unwrapString(config.restBaseUrl),
    unwrapString(config.baseUrl),
  ).trim().replace(/\/+$/, "");
  if (!raw) throw new Error("xdrBaseUrl/endpoint is required in config");
  return raw;
};

export const resolveAccessKey = (secret = {}) => {
  const ak = unwrapString(firstDefined(secret.accessKey, secret.ak)).trim();
  if (!ak) throw new Error("accessKey is required in secret");
  return ak;
};

export const resolveSecretKey = (secret = {}) => {
  const sk = unwrapString(firstDefined(secret.secretKey, secret.sk)).trim();
  if (!sk) throw new Error("secretKey is required in secret");
  return sk;
};

const upstreamError = (code, message, details = {}) => {
  const payload = {
    code,
    message,
    http_status: Number.isFinite(Number(details.httpStatus)) ? Number(details.httpStatus) : 0,
    raw_body: typeof details.rawBody === "string" ? details.rawBody : "",
    reason: String(details.reason || "").trim(),
  };
  const err = new GrpcError(
    code === "PERMISSION_DENIED" ? grpcStatus.PERMISSION_DENIED :
    code === "INVALID_ARGUMENT" ? grpcStatus.INVALID_ARGUMENT :
    code === "UNAVAILABLE" ? grpcStatus.UNAVAILABLE :
    grpcStatus.UNKNOWN,
    JSON.stringify(payload),
  );
  err.httpStatus = payload.http_status;
  err.rawBody = payload.raw_body;
  err.reason = payload.reason;
  return err;
};

const mapHttpStatusToCode = (status) => {
  if (status === 401 || status === 403) return "PERMISSION_DENIED";
  if (status >= 400 && status < 500) return "INVALID_ARGUMENT";
  return "UNAVAILABLE";
};

export async function signedRequest({ config, secret, method, path, body }) {
  const baseUrl = resolveBaseUrl(config);
  const ak = resolveAccessKey(secret);
  const sk = resolveSecretKey(secret);

  const url = new URL(path, baseUrl);
  const uri = url.pathname;
  const queryString = url.search ? url.search.slice(1) : "";
  const host = url.host;
  const payload = body ? JSON.stringify(body) : "";

  const signHeaders = createSign({ ak, sk, method: method.toUpperCase(), uri, queryString, host, payload, headers: {} });

  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json",
    ...signHeaders,
  };

  const fetchOptions = { method: method.toUpperCase(), headers };
  if (body && method.toUpperCase() !== "GET") {
    fetchOptions.body = payload;
  }

  let res;
  try {
    res = await fetch(url.toString(), fetchOptions);
  } catch (err) {
    throw upstreamError("UNAVAILABLE", "XDR upstream request failed", {
      httpStatus: 0,
      rawBody: "",
      reason: err?.cause?.message || err?.message || "fetch failed",
    });
  }

  let text;
  try {
    text = await res.text();
  } catch (err) {
    throw upstreamError("UNAVAILABLE", "XDR upstream response body read failed", {
      httpStatus: res.status,
      rawBody: "",
      reason: err?.message || "response body read failed",
    });
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { _raw: text };
  }

  if (!res.ok) {
    throw upstreamError(mapHttpStatusToCode(res.status), `XDR API error: ${res.status}`, {
      httpStatus: res.status,
      rawBody: text,
      reason: JSON.stringify(data),
    });
  }

  return { data, httpStatus: res.status };
}

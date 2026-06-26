/**
 * 深信服 XDR OpenAPI AK/SK 签名工具 (HMAC-SHA256)
 * 从 Go SDK (aksk/v3) 移植到 Node.js
 */

import crypto from "node:crypto";

const ALGORITHM = "HMAC-SHA256";
const SIGN_EXPIRED_SEC = 10 * 60;

function hexEncode(buf) {
  return buf.toString("hex").toUpperCase();
}

function sha256(data) {
  return crypto.createHash("sha256").update(data).digest();
}

function hmacSha256(key, data) {
  return crypto.createHmac("sha256", key).update(data).digest();
}

function sortQueryStr(queryString) {
  if (!queryString) return "";
  const params = new URLSearchParams(queryString);
  const entries = [];
  for (const [key, value] of params.entries()) {
    entries.push(`${key}=${value}`);
  }
  entries.sort();
  return entries.join("&");
}

function sortHeaders(headerObj) {
  return Object.keys(headerObj).sort((a, b) => a.localeCompare(b));
}

function sortPayload(payload) {
  return Buffer.from(
    payload.replace(/\s/g, "").split("").sort().join("")
  );
}

function formatSignDate(date) {
  const y = date.getUTCFullYear();
  const M = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  const h = String(date.getUTCHours()).padStart(2, "0");
  const m = String(date.getUTCMinutes()).padStart(2, "0");
  const s = String(date.getUTCSeconds()).padStart(2, "0");
  return `${y}${M}${d}T${h}${m}${s}Z`;
}

/**
 * 为 HTTP 请求生成 AK/SK 签名
 */
export function createSign({ ak, sk, method, uri, queryString, host, payload, headers }) {
  const headerMap = { ...(headers || {}) };

  headerMap["sdk-content-type"] = "application/json";
  headerMap["sdk-host"] = host;
  if (!headerMap["sign-date"]) {
    headerMap["sign-date"] = formatSignDate(new Date());
  }

  const sortedHeaderKeys = sortHeaders(headerMap);
  const signedHeaders = sortedHeaderKeys.join(";");

  const canonicalLines = [];
  canonicalLines.push(method.toUpperCase());
  canonicalLines.push(uri.endsWith("/") ? uri : uri + "/");
  canonicalLines.push(sortQueryStr(queryString || ""));
  for (const key of sortedHeaderKeys) {
    canonicalLines.push(`${key}:${headerMap[key]}`);
  }
  canonicalLines.push(signedHeaders);

  const payloadBytes = sortPayload(payload || "");
  const payloadHash = sha256(payloadBytes);
  canonicalLines.push(hexEncode(payloadHash));

  const canonicalReq = canonicalLines.join("\n");
  const canonicalReqHash = sha256(canonicalReq);

  const hmacInput = `${ALGORITHM}\n${headerMap["sign-date"]}\n${hexEncode(canonicalReqHash)}`;
  const signature = hexEncode(hmacSha256(sk, hmacInput));

  const authorization = [
    `algorithm=${ALGORITHM}`,
    `Access=${ak}`,
    `SignedHeaders=${signedHeaders}`,
    `Signature=${signature}`,
  ].join(", ");

  return {
    Authorization: authorization,
    "sdk-content-type": headerMap["sdk-content-type"],
    "sdk-host": headerMap["sdk-host"],
    "sign-date": headerMap["sign-date"],
  };
}

export function isSignExpired(signedHeaders) {
  const signDate = signedHeaders["sign-date"];
  if (!signDate) return true;
  const year = parseInt(signDate.slice(0, 4), 10);
  const month = parseInt(signDate.slice(4, 6), 10) - 1;
  const day = parseInt(signDate.slice(6, 8), 10);
  const hour = parseInt(signDate.slice(9, 11), 10);
  const min = parseInt(signDate.slice(11, 13), 10);
  const sec = parseInt(signDate.slice(13, 15), 10);
  const signTime = Date.UTC(year, month, day, hour, min, sec);
  const now = Date.now();
  return Math.abs(now - signTime) / 1000 >= SIGN_EXPIRED_SEC;
}

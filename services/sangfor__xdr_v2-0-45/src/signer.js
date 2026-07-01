import { createDecipheriv, createHash, createHmac } from "node:crypto";

const AUTH_CODE_PARTS = 14;
const AUTH_ALGORITHM = "HMAC-SHA256";

const sha256Hex = (value) => createHash("sha256").update(value).digest("hex").toUpperCase();

const formatSignDate = (date = new Date()) => date
  .toISOString()
  .replace(/[-:]/g, "")
  .replace(/\.\d{3}Z$/, "Z");

const canonicalUri = (pathname) => {
  let encoded = encodeURIComponent(pathname || "/").replaceAll("%2F", "/");
  if (!encoded.endsWith("/")) encoded += "/";
  return encoded;
};

const formEncode = (value) => encodeURIComponent(value)
  .replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)
  .replaceAll("%20", "+");

const canonicalQuery = (url) => {
  const entries = [...url.searchParams.entries()].sort(([leftKey, leftValue], [rightKey, rightValue]) => (
    leftKey === rightKey ? leftValue.localeCompare(rightValue) : leftKey.localeCompare(rightKey)
  ));
  return entries
    .map(([key, value]) => formEncode(`${key}=${value}`)
      .replaceAll("%2F", "/")
      .replaceAll("%3D", "="))
    .join("&");
};

const canonicalPayloadHash = (body) => {
  const bytes = [...Buffer.from(body ?? "", "utf8")]
    .filter((value) => value !== 0x20)
    .sort((left, right) => {
      const signedLeft = left > 127 ? left - 256 : left;
      const signedRight = right > 127 ? right - 256 : right;
      return signedLeft - signedRight;
    });
  return sha256Hex(Buffer.from(bytes));
};

const normalizeHeaders = (headers, url, signDate) => {
  const normalized = {};
  for (const [key, value] of Object.entries(headers ?? {})) {
    if (key.toLowerCase() === "authorization") {
      throw new TypeError("request headers must not contain Authorization before signing");
    }
    normalized[key] = String(value);
  }
  const contentTypeEntry = Object.entries(normalized).find(([key]) => key.toLowerCase() === "content-type");
  normalized["sdk-content-type"] = contentTypeEntry?.[1] || "application/json";
  normalized["sdk-host"] = url.host;
  if (!Object.keys(normalized).some((key) => key.toLowerCase() === "sign-date")) {
    normalized["sign-date"] = signDate;
  }
  return normalized;
};

const canonicalHeaders = (headers) => {
  const entries = Object.entries(headers).sort(([left], [right]) => (
    left.toLowerCase().localeCompare(right.toLowerCase())
  ));
  return {
    text: entries.map(([key, value]) => `${key}:${value}\n`).join(""),
    names: entries.map(([key]) => key).join(";"),
  };
};

const decryptAuthCodeField = (ciphertext, key) => {
  if (!/^[0-9a-f]+$/i.test(ciphertext) || ciphertext.length % 32 !== 0) {
    throw new TypeError("authCode contains invalid encrypted credential data");
  }
  const decipher = createDecipheriv("aes-256-cbc", key, Buffer.alloc(16));
  decipher.setAutoPadding(false);
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, "hex")),
    decipher.final(),
  ]).toString("utf8").trim();
};

export function decodeAuthCode(authCode) {
  if (typeof authCode !== "string" || authCode.length === 0 || !/^[0-9a-f]+$/i.test(authCode)) {
    throw new TypeError("authCode must be a non-empty hexadecimal string");
  }
  let parts;
  try {
    parts = Buffer.from(authCode, "hex").toString("utf8").split("|");
  } catch {
    throw new TypeError("authCode hex decoding failed");
  }
  if (parts.length !== AUTH_CODE_PARTS) {
    throw new TypeError(`authCode must contain ${AUTH_CODE_PARTS} fields`);
  }
  const key = createHash("sha256")
    .update([parts[0], parts[1], parts[2], parts[3], parts[4], parts[5], parts[6], parts[11]].join("+"))
    .digest();
  const accessKey = decryptAuthCodeField(parts[9], key);
  const secretKey = decryptAuthCodeField(parts[10], key);
  if (!accessKey || !secretKey) {
    throw new TypeError("authCode decoded to empty credentials");
  }
  return { accessKey, secretKey };
}

export function signRequest({
  method,
  url: rawUrl,
  headers = {},
  body = "",
  accessKey,
  secretKey,
  now = new Date(),
}) {
  if (!method || !rawUrl) throw new TypeError("method and url are required");
  if (!accessKey || !secretKey) throw new TypeError("accessKey and secretKey are required");

  const url = new URL(rawUrl);
  const requestedSignDate = Object.entries(headers).find(([key]) => key.toLowerCase() === "sign-date")?.[1];
  const signDate = requestedSignDate || formatSignDate(now);
  const signedHeaders = normalizeHeaders(headers, url, signDate);
  const canonicalHeader = canonicalHeaders(signedHeaders);
  const canonicalRequest = [
    String(method).toUpperCase(),
    canonicalUri(url.pathname),
    canonicalQuery(url),
    canonicalHeader.text + canonicalHeader.names,
    canonicalPayloadHash(body),
  ].join("\n");
  const hashedCanonicalRequest = sha256Hex(Buffer.from(canonicalRequest, "utf8"));
  const stringToSign = `${AUTH_ALGORITHM}\n${signDate}\n${hashedCanonicalRequest}`;
  const signature = createHmac("sha256", secretKey).update(stringToSign).digest("hex").toUpperCase();
  const authorization = `algorithm=${AUTH_ALGORITHM}, Access=${accessKey}, SignedHeaders=${canonicalHeader.names}, Signature=${signature}`;

  return {
    headers: {
      ...signedHeaders,
      Authorization: authorization,
    },
    canonicalRequest,
    stringToSign,
    signature,
  };
}

export const _test = {
  canonicalPayloadHash,
  canonicalQuery,
  canonicalUri,
  formatSignDate,
};

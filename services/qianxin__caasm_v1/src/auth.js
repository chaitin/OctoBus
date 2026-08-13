import crypto from "node:crypto";

/**
 * Build a CAASM HMAC-SHA256 signature and auth-credentials header value.
 *
 * CAASM Zeus auth scheme (from API docs §3):
 *   signString = "appKey:{appKey}&nonce:{nonce}&timestamp:{timestamp}"
 *   signature  = HMAC-SHA256(signString, appSecret) → hex
 *   header     = "appKey=...,nonce=...,timestamp=...,version=1.0.0,signature=..."
 *
 * @param {string} appKey
 * @param {string} appSecret
 * @returns {{ header: string, nonce: string, timestamp: number }}
 */
export function buildAuthHeader(appKey, appSecret) {
  const nonce = String(crypto.randomInt(100000, 1000000));
  const timestamp = Math.floor(Date.now() / 1000);

  const signString = `appKey:${appKey}&nonce:${nonce}&timestamp:${timestamp}`;
  const signature = crypto
    .createHmac("sha256", appSecret)
    .update(signString)
    .digest("hex");

  const header = `appKey=${appKey},nonce=${nonce},timestamp=${timestamp},version=1.0.0,signature=${signature}`;

  return { header, nonce, timestamp };
}

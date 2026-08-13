import https from "node:https";
import http from "node:http";

import { grpcUnavailableError, grpcUnauthenticatedError, grpcInvalidArgumentError } from "@chaitin-ai/octobus-sdk";

/**
 * Create a minimal POST-only HTTP/HTTPS client for CAASM.
 *
 * Uses Node built-in https.request / http.request because Node 20's native
 * fetch does not allow per-request TLS overrides. All requests are POST+JSON.
 *
 * @param {object} config  - resolved instance config
 * @param {object} secret  - resolved instance secret
 * @returns {function}  - async (path, body) => parsed JSON response
 */
export function createClient(config, secret) {
  const baseUrl = String(config.baseUrl ?? "").replace(/\/+$/, "");
  if (!baseUrl) {
    throw grpcUnauthenticatedError("config.baseUrl is required");
  }

  const appKey = String(secret.appKey ?? "");
  const appSecret = String(secret.appSecret ?? "");
  if (!appKey || !appSecret) {
    throw grpcUnauthenticatedError("secret.appKey and secret.appSecret are required");
  }

  const timeoutMs = Number(config.timeoutMs) || 30000;
  const insecureTls = config.insecureTls === true;
  const pathPrefix = String(config.pathPrefix ?? "/caasm/v1/biz-service").replace(/\/+$/, "");

  // Parse host:port and protocol from baseUrl
  let urlObj;
  try {
    urlObj = new URL(baseUrl);
  } catch {
    throw grpcInvalidArgumentError(`config.baseUrl is not a valid URL: ${baseUrl}`);
  }
  const hostname = urlObj.hostname;
  const isHttps = urlObj.protocol === "https:";
  const port = urlObj.port ? Number(urlObj.port) : (isHttps ? 443 : 80);
  const request = isHttps ? https.request : http.request;

  // ---- auth header builder (lazy import) ----
  let buildAuthHeader;
  async function loadAuth() {
    if (!buildAuthHeader) {
      ({ buildAuthHeader } = await import("./auth.js"));
    }
  }

  /**
   * POST JSON to CAASM and return parsed response.
   * @param {string} path - API path, e.g. "/api/entity/dev"
   * @param {object} body - request body
   * @returns {Promise<object>} parsed JSON body
   */
  async function call(path, body) {
    await loadAuth();
    const { header: credentials } = buildAuthHeader(appKey, appSecret);

    const reqPath = `${pathPrefix}${path}`;
    const payload = JSON.stringify(body);

    return new Promise((resolve, reject) => {
      const req = request({
        hostname,
        port,
        path: reqPath,
        method: "POST",
        rejectUnauthorized: !insecureTls,
        timeout: timeoutMs,
        headers: {
          "content-type": "application/json",
          "auth-credentials": credentials,
          "content-length": Buffer.byteLength(payload),
        },
      }, (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("error", (err) => {
          reject(grpcUnavailableError(`CAASM response stream error: ${err.message}`));
        });
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");

          if (res.statusCode === 401 || res.statusCode === 403) {
            reject(grpcUnauthenticatedError(`CAASM auth rejected (HTTP ${res.statusCode})`));
            return;
          }

          if (res.statusCode >= 500) {
            reject(grpcUnavailableError(`CAASM upstream error (HTTP ${res.statusCode})`));
            return;
          }

          if (!res.statusCode || res.statusCode >= 400) {
            reject(grpcUnavailableError(`CAASM HTTP ${res.statusCode}`));
            return;
          }

          try {
            resolve(JSON.parse(text));
          } catch {
            reject(grpcUnavailableError(`CAASM returned non-JSON (HTTP ${res.statusCode})`));
          }
        });
      });

      req.on("error", (err) => {
        reject(grpcUnavailableError(`CAASM request failed: ${err.message}`));
      });

      req.on("timeout", () => {
        req.destroy();
        reject(grpcUnavailableError(`CAASM request timed out after ${timeoutMs}ms: ${path}`));
      });

      req.write(payload);
      req.end();
    });
  }

  return call;
}

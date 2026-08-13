import { GrpcError, grpcStatus } from "@chaitin-ai/octobus-sdk";

const DEFAULT_BASE_URL = "https://api.first.org/data/v1/epss";
const DEFAULT_TIMEOUT_MS = 30000;

function timeoutMs(config) {
  const value = Number(config?.timeoutMs);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_TIMEOUT_MS;
}

async function httpGetJson(baseUrl, cveIds, timeout) {
  const url = new URL(baseUrl || DEFAULT_BASE_URL);
  url.searchParams.set("cve", cveIds.join(","));
  url.searchParams.set("limit", String(cveIds.length));

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  let response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new GrpcError(grpcStatus.DEADLINE_EXCEEDED, `EPSS API request timed out after ${timeout}ms`);
    }
    const message = error instanceof Error ? error.message : "network failure";
    throw new GrpcError(grpcStatus.UNAVAILABLE, `EPSS API unreachable: ${message}`);
  } finally {
    clearTimeout(timeoutId);
  }

  let body;
  try {
    body = await response.text();
  } catch (error) {
    const message = error instanceof Error ? error.message : "read failure";
    throw new GrpcError(grpcStatus.UNAVAILABLE, `EPSS API response body read failed: ${message}`);
  }

  if (response.status >= 500) {
    throw new GrpcError(grpcStatus.UNAVAILABLE, `EPSS API HTTP ${response.status}: temporarily unavailable`);
  }
  if (response.status >= 400) {
    throw new GrpcError(grpcStatus.INVALID_ARGUMENT, `EPSS API HTTP ${response.status}: ${body.substring(0, 200)}`);
  }
  try {
    return body ? JSON.parse(body) : {};
  } catch {
    throw new GrpcError(grpcStatus.UNAVAILABLE, `EPSS API returned non-JSON (HTTP ${response.status})`);
  }
}

export async function getScores(config, cveIds) {
  if (cveIds == null) return { data: [] };
  if (!Array.isArray(cveIds)) {
    throw new GrpcError(grpcStatus.INVALID_ARGUMENT, "cveIds must be an array");
  }
  if (cveIds.length === 0) return { data: [] };
  for (const id of cveIds) {
    if (typeof id !== "string") {
      throw new GrpcError(grpcStatus.INVALID_ARGUMENT, "each cveId must be a string");
    }
  }
  const data = await httpGetJson(config?.epssBaseUrl || DEFAULT_BASE_URL, cveIds, timeoutMs(config));
  return {
    data: (data.data || []).map((entry) => ({
      cveId: entry.cve || "",
      epss: parseFloat(entry.epss) || 0,
      percentile: parseFloat(entry.percentile) || 0,
      date: entry.date || "",
    })),
  };
}

export const handlers = {
  "first.epss.v1.EpssService/GetScores": (ctx) => getScores(ctx.config, ctx.request?.cveIds || []),
};

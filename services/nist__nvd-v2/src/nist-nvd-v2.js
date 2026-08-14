import { GrpcError, grpcStatus } from "@chaitin-ai/octobus-sdk";

const DEFAULT_BASE_URL = "https://services.nvd.nist.gov/rest/json/cves/2.0";
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 120_000;
const MAX_RESULTS_PER_PAGE = 50;
const MAX_RESPONSE_BYTES = 10 << 20;
const RETRYABLE_ATTEMPTS = 2;

function grpcError(code, message) {
  return new GrpcError(code, message);
}

function isGrpcError(error) {
  return error instanceof GrpcError;
}

function timeoutMs(value) {
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_TIMEOUT_MS;
  return Math.min(Math.floor(value), MAX_TIMEOUT_MS);
}

function nvdBaseUrl(config = {}) {
  const raw = String(config.nvdBaseUrl || DEFAULT_BASE_URL).trim();
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw grpcError(grpcStatus.INVALID_ARGUMENT, "nvdBaseUrl must be a valid URL");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw grpcError(grpcStatus.INVALID_ARGUMENT, "nvdBaseUrl must use http or https");
  }
  return url;
}

function appendQuery(baseUrl, parameters) {
  const url = new URL(baseUrl);
  for (const [name, value] of Object.entries(parameters)) {
    if (value !== undefined && value !== "") url.searchParams.set(name, String(value));
  }
  return url;
}

function mapHttpError(status, body) {
  if (status === 401 || status === 403) {
    return grpcError(grpcStatus.PERMISSION_DENIED, `NVD API HTTP ${status}: invalid or expired API key`);
  }
  if (status === 429 || status >= 500) {
    return grpcError(grpcStatus.UNAVAILABLE, `NVD API HTTP ${status}: rate-limited or temporarily unavailable`);
  }
  return grpcError(grpcStatus.INVALID_ARGUMENT, `NVD API HTTP ${status}: ${body.slice(0, 200)}`);
}

function isRetryableStatus(status) {
  return status === 429 || status >= 500;
}

async function responseText(response, controller) {
  const declaredLength = Number(response.headers?.get?.("content-length") || 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
    controller.abort();
    throw grpcError(grpcStatus.UNAVAILABLE, `NVD API response exceeds ${MAX_RESPONSE_BYTES} bytes`);
  }
  if (!response.body?.getReader) {
    const body = await response.text();
    if (Buffer.byteLength(body) > MAX_RESPONSE_BYTES) {
      throw grpcError(grpcStatus.UNAVAILABLE, `NVD API response exceeds ${MAX_RESPONSE_BYTES} bytes`);
    }
    return body;
  }

  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) {
        controller.abort();
        throw grpcError(grpcStatus.UNAVAILABLE, `NVD API response exceeds ${MAX_RESPONSE_BYTES} bytes`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

async function httpGetJson(url, headers, configuredTimeoutMs) {
  const requestTimeoutMs = timeoutMs(configuredTimeoutMs);
  for (let attempt = 1; attempt <= RETRYABLE_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), requestTimeoutMs);
    try {
      const response = await fetch(url, {
        method: "GET",
        headers,
        signal: controller.signal,
        redirect: "error",
      });
      const body = await responseText(response, controller);
      if (!response.ok) {
        const error = mapHttpError(response.status, body);
        if (attempt < RETRYABLE_ATTEMPTS && isRetryableStatus(response.status)) continue;
        throw error;
      }
      try {
        return JSON.parse(body);
      } catch {
        throw grpcError(grpcStatus.UNAVAILABLE, `NVD API returned non-JSON (HTTP ${response.status})`);
      }
    } catch (error) {
      if (isGrpcError(error)) throw error;
      if (attempt < RETRYABLE_ATTEMPTS) continue;
      if (error?.name === "AbortError") {
        throw grpcError(grpcStatus.UNAVAILABLE, `NVD API timeout after ${requestTimeoutMs}ms`);
      }
      throw grpcError(grpcStatus.UNAVAILABLE, "NVD API unreachable");
    } finally {
      clearTimeout(timer);
    }
  }
  throw grpcError(grpcStatus.UNAVAILABLE, "NVD API unavailable");
}

function severity(metric) {
  const data = metric?.cvssData || {};
  if (data.baseSeverity) return data.baseSeverity;
  const score = Number(data.baseScore);
  if (score >= 9) return "CRITICAL";
  if (score >= 7) return "HIGH";
  if (score >= 4) return "MEDIUM";
  if (score > 0) return "LOW";
  return "";
}

function affectedVersion(match, literalVersion) {
  const start = match.versionStartIncluding ? `>= ${match.versionStartIncluding}`
    : match.versionStartExcluding ? `> ${match.versionStartExcluding}` : "";
  const end = match.versionEndIncluding ? `<= ${match.versionEndIncluding}`
    : match.versionEndExcluding ? `< ${match.versionEndExcluding}` : "";
  return [start, end].filter(Boolean).join(" ") || literalVersion || "*";
}

export function extractCveDetails(vulnerability) {
  const cve = vulnerability?.cve || vulnerability;
  if (!cve) return {};
  const englishDescription = (cve.descriptions || []).find((item) => item.lang === "en") || {};
  const metrics = cve.metrics || {};
  const v31 = (metrics.cvssMetricV31 || [])[0]?.cvssData || {};
  const v30 = (metrics.cvssMetricV30 || [])[0]?.cvssData || {};
  const v2 = (metrics.cvssMetricV2 || [])[0]?.cvssData || {};
  const cweIds = (cve.weaknesses || []).flatMap((weakness) =>
    (weakness.description || []).map((description) => description.value).filter((value) => /^CWE-\d+$/i.test(value)));
  const affectedProducts = (cve.configurations || []).flatMap((configuration) =>
    (configuration.nodes || []).flatMap((node) => (node.cpeMatch || []).map((match) => {
      const parts = String(match.criteria || "").split(":");
      return {
        vendor: parts[3] || "",
        product: parts[4] || "",
        version: affectedVersion(match, parts[5]),
      };
    })));
  return {
    cveId: cve.id || "",
    description: englishDescription.value || "",
    cvssV31Score: Number(v31.baseScore) || 0,
    cvssV31Vector: v31.vectorString || "",
    cvssV30Score: Number(v30.baseScore) || 0,
    cvssV2Score: Number(v2.baseScore) || 0,
    severity: severity((metrics.cvssMetricV31 || [])[0]) || severity((metrics.cvssMetricV30 || [])[0]) || severity((metrics.cvssMetricV2 || [])[0]),
    publishedDate: cve.published || "",
    lastModifiedDate: cve.lastModified || "",
    cweIds,
    references: (cve.references || []).map((reference) => ({ url: reference.url || "", source: reference.source || "", tags: reference.tags || [] })),
    affectedProducts,
  };
}

function validCveId(value) {
  return typeof value === "string" && /^CVE-\d{4}-\d{4,}$/i.test(value.trim());
}

export async function lookupCve(config, secret, cveId) {
  if (!validCveId(cveId)) {
    throw grpcError(grpcStatus.INVALID_ARGUMENT, "cveId must have the form CVE-YYYY-NNNN");
  }
  const headers = { Accept: "application/json", "User-Agent": "OctoBus-NVD/0.1" };
  if (secret?.nvdApiKey) headers.apiKey = String(secret.nvdApiKey);
  const url = appendQuery(nvdBaseUrl(config), { cveId: cveId.trim().toUpperCase() });
  const data = await httpGetJson(url, headers, config?.timeoutMs);
  const vulnerabilities = data.vulnerabilities || [];
  if (vulnerabilities.length === 0) {
    throw grpcError(grpcStatus.NOT_FOUND, `CVE ${cveId} not found in NVD`);
  }
  return extractCveDetails(vulnerabilities[0]);
}

export async function searchCves(config, secret, request = {}) {
  if (request.keyword !== undefined && typeof request.keyword !== "string") {
    throw grpcError(grpcStatus.INVALID_ARGUMENT, "keyword must be a string");
  }
  const requestedSeverity = String(request.severity || "").trim().toUpperCase();
  if (requestedSeverity && !["LOW", "MEDIUM", "HIGH", "CRITICAL"].includes(requestedSeverity)) {
    throw grpcError(grpcStatus.INVALID_ARGUMENT, "severity must be LOW, MEDIUM, HIGH, or CRITICAL");
  }
  const skip = request.skip || 0;
  const limit = request.limit || 20;
  if (!Number.isInteger(skip) || skip < 0 || !Number.isInteger(limit) || limit < 1) {
    throw grpcError(grpcStatus.INVALID_ARGUMENT, "skip must be non-negative and limit must be positive integers");
  }
  const headers = { Accept: "application/json", "User-Agent": "OctoBus-NVD/0.1" };
  if (secret?.nvdApiKey) headers.apiKey = String(secret.nvdApiKey);
  const url = appendQuery(nvdBaseUrl(config), {
    resultsPerPage: Math.min(limit, MAX_RESULTS_PER_PAGE),
    startIndex: skip,
    keywordSearch: request.keyword,
    cvssV3Severity: requestedSeverity,
    pubStartDate: request.pubStartDate,
    pubEndDate: request.pubEndDate,
  });
  const data = await httpGetJson(url, headers, config?.timeoutMs);
  const vulnerabilities = Array.isArray(data.vulnerabilities) ? data.vulnerabilities : [];
  return { total: Math.min(Number(data.totalResults) || vulnerabilities.length, 2_147_483_647), data: vulnerabilities.map(extractCveDetails) };
}

export const handlers = {
  "nist.nvd.v2.NvdService/LookupCve": (ctx) => lookupCve(ctx.config, ctx.secret, ctx.request?.cveId),
  "nist.nvd.v2.NvdService/SearchCves": (ctx) => searchCves(ctx.config, ctx.secret, ctx.request),
};

export const _test = { appendQuery, httpGetJson, mapHttpError, nvdBaseUrl, severity, timeoutMs };

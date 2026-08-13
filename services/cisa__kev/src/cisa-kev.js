import { GrpcError, grpcStatus } from "@chaitin-ai/octobus-sdk";

const DEFAULT_PRIMARY = "https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json";
const DEFAULT_FALLBACK = "https://raw.githubusercontent.com/cisagov/kev-data/main/data/known_exploited_vulnerabilities.json";

async function httpGetJson(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs || 30000);
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller.signal,
      redirect: "follow",
    });
    const body = await res.text();
    if (res.status >= 500) throw new GrpcError(grpcStatus.UNAVAILABLE, `KEV API HTTP ${res.status}`);
    if (res.status >= 400) throw new GrpcError(grpcStatus.INVALID_ARGUMENT, `KEV API HTTP ${res.status}`);
    try {
      return JSON.parse(body);
    } catch {
      throw new GrpcError(grpcStatus.UNAVAILABLE, "KEV API returned non-JSON");
    }
  } catch (e) {
    if (e instanceof GrpcError) throw e;
    if (e?.name === "AbortError") {
      throw new GrpcError(grpcStatus.UNAVAILABLE, `KEV API timeout after ${timeoutMs || 30000}ms`);
    }
    throw new GrpcError(grpcStatus.UNAVAILABLE, `KEV API unreachable: ${e.message}`);
  } finally {
    clearTimeout(timer);
  }
}

let _cache = null;
let _cacheTime = 0;
let _cacheKey = "";

async function fetchCatalog(config) {
  const now = Date.now();
  const ttl = config?.kevCacheTtlMs ?? 3600000;
  const primary = config?.kevPrimaryUrl || DEFAULT_PRIMARY;
  const fallback = config?.kevFallbackUrl || DEFAULT_FALLBACK;
  const cacheKey = `${primary}\n${fallback}`;
  if (_cache && _cacheKey === cacheKey && ttl > 0 && (now - _cacheTime) < ttl) return _cache;
  let lastError = null;
  for (const url of [primary, fallback]) {
    try {
      const data = await httpGetJson(url, config?.timeoutMs);
      _cache = data.vulnerabilities || [];
      _cacheTime = now;
      _cacheKey = cacheKey;
      return _cache;
    } catch (e) {
      lastError = e;
    }
  }
  throw new GrpcError(
    grpcStatus.UNAVAILABLE,
    lastError?.message || "KEV catalog unavailable from both primary and fallback sources",
  );
}

export async function checkCve(config, cveId) {
  if (!cveId || typeof cveId !== "string") {
    throw new GrpcError(grpcStatus.INVALID_ARGUMENT, "cveId is required and must be a string");
  }
  const upper = cveId.toUpperCase();
  const catalog = await fetchCatalog(config);
  const entry = catalog.find((item) => item?.cveID?.toUpperCase() === upper);
  if (!entry || !entry.cveID) return { inKev: false };
  return {
    inKev: true,
    entry: {
      cveId: entry.cveID || "",
      vendorProject: entry.vendorProject || "",
      product: entry.product || "",
      vulnerabilityName: entry.vulnerabilityName || "",
      dateAdded: entry.dateAdded || "",
      shortDescription: entry.shortDescription || "",
      requiredAction: entry.requiredAction || "",
      dueDate: entry.dueDate || "",
      knownRansomwareCampaignUse: entry.knownRansomwareCampaignUse || "",
      notes: entry.notes || "",
    },
  };
}

export const handlers = {
  "cisa.kev.KevService/Check": (ctx) => checkCve(ctx.config, ctx.request.cveId),
};

export const _test = {
  httpGetJson,
  fetchCatalog,
  resetCache() {
    _cache = null;
    _cacheTime = 0;
    _cacheKey = "";
  },
};

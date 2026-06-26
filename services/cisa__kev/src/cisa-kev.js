import { execSync } from "node:child_process";
import { GrpcError, grpcStatus } from "@chaitin-ai/octobus-sdk";

const DEFAULT_PRIMARY = "https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json";
const DEFAULT_FALLBACK = "https://raw.githubusercontent.com/cisagov/kev-data/main/data/known_exploited_vulnerabilities.json";

function httpGetJson(url, timeoutMs) {
  const cmd = `curl -s -w '\\n%{http_code}' -X GET '${url}' --max-time ${Math.ceil((timeoutMs || 30000) / 1000)}`;
  let raw;
  try { raw = execSync(cmd, { timeout: timeoutMs || 30000, encoding: "utf8", maxBuffer: 10 << 20 }); }
  catch (e) { throw new GrpcError(grpcStatus.UNAVAILABLE, `KEV API unreachable: ${e.message}`); }
  const lines = raw.trim().split("\n");
  const sc = parseInt(lines[lines.length - 1] || "0", 10);
  const body = lines.slice(0, -1).join("\n");
  if (sc >= 500) throw new GrpcError(grpcStatus.UNAVAILABLE, `KEV API HTTP ${sc}`);
  if (sc >= 400) throw new GrpcError(grpcStatus.INVALID_ARGUMENT, `KEV API HTTP ${sc}`);
  try { return JSON.parse(body); }
  catch (e) { throw new GrpcError(grpcStatus.UNAVAILABLE, `KEV API returned non-JSON`); }
}

let _cache = null;
let _cacheTime = 0;

function fetchCatalog(config) {
  const now = Date.now();
  const ttl = config?.kevCacheTtlMs ?? 3600000;
  if (_cache && ttl > 0 && (now - _cacheTime) < ttl) return _cache;
  const primary = config?.kevPrimaryUrl || DEFAULT_PRIMARY;
  const fallback = config?.kevFallbackUrl || DEFAULT_FALLBACK;
  for (const url of [primary, fallback]) {
    try {
      const data = httpGetJson(url, config?.timeoutMs);
      _cache = data.vulnerabilities || [];
      _cacheTime = now;
      return _cache;
    } catch (e) { continue; }
  }
  _cache = [];
  _cacheTime = now;
  return _cache;
}

export function checkCve(config, cveId) {
  if (!cveId || typeof cveId !== "string") throw new GrpcError(grpcStatus.INVALID_ARGUMENT, "cveId is required and must be a string");
  const upper = cveId.toUpperCase();
  const catalog = fetchCatalog(config);
  const e = (catalog || []).find(x => x?.cveID?.toUpperCase() === upper);
  if (!e || !e.cveID) return { inKev: false };
  return {
    inKev: true,
    entry: { cveId: e.cveID || "", vendorProject: e.vendorProject || "", product: e.product || "", vulnerabilityName: e.vulnerabilityName || "", dateAdded: e.dateAdded || "", shortDescription: e.shortDescription || "", requiredAction: e.requiredAction || "", dueDate: e.dueDate || "", knownRansomwareCampaignUse: e.knownRansomwareCampaignUse || "", notes: e.notes || "" },
  };
}

export const handlers = {
  "cisa.kev.KevService/Check": (ctx) => checkCve(ctx.config, ctx.request.cveId),
};

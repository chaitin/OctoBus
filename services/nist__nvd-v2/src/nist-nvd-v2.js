import { execSync } from "node:child_process";
import { GrpcError, grpcStatus } from "@chaitin-ai/octobus-sdk";

const DEFAULT_BASE_URL = "https://services.nvd.nist.gov/rest/json/cves/2.0";

function httpGetJson(url, headers, timeoutMs) {
  const hdr = Object.entries(headers || {}).map(([k, v]) => `-H '${k}: ${v}'`).join(" ");
  const cmd = `curl -s -w '\\n%{http_code}' -X GET '${url}' ${hdr} --max-time ${Math.ceil((timeoutMs || 30000) / 1000)}`;
  let raw;
  try { raw = execSync(cmd, { timeout: timeoutMs || 30000, encoding: "utf8", maxBuffer: 10 << 20 }); }
  catch (e) { throw new GrpcError(grpcStatus.UNAVAILABLE, `NVD API unreachable: ${e.message}`); }
  const lines = raw.trim().split("\n");
  const sc = parseInt(lines[lines.length - 1] || "0", 10);
  const body = lines.slice(0, -1).join("\n");
  if (sc === 401 || sc === 403) {
    throw new GrpcError(grpcStatus.PERMISSION_DENIED, `NVD API HTTP ${sc}: invalid or expired API key`);
  }
  if (sc >= 500 || sc === 429) {
    throw new GrpcError(grpcStatus.UNAVAILABLE, `NVD API HTTP ${sc}: rate-limited or temporarily unavailable`);
  }
  if (sc >= 400) {
    throw new GrpcError(grpcStatus.INVALID_ARGUMENT, `NVD API HTTP ${sc}: ${body.substring(0, 200)}`);
  }
  try { return JSON.parse(body); }
  catch (e) { throw new GrpcError(grpcStatus.UNAVAILABLE, `NVD API returned non-JSON (HTTP ${sc})`); }
}

function extractCveDetails(vuln) {
  const cve = vuln?.cve || vuln;
  if (!cve) return {};
  const en = (cve.descriptions || []).find(d => d.lang === "en") || {};
  const m = cve.metrics || {};
  const v31 = (m.cvssMetricV31 || [])[0]?.cvssData || {};
  const v30 = (m.cvssMetricV30 || [])[0]?.cvssData || {};
  const v2 = (m.cvssMetricV2 || [])[0]?.cvssData || {};
  const s = v31.baseScore || 0;
  let sev = "";
  if (s >= 9) sev = "CRITICAL"; else if (s >= 7) sev = "HIGH"; else if (s >= 4) sev = "MEDIUM"; else if (s > 0) sev = "LOW";
  const cweIds = [];
  for (const w of (cve.weaknesses || [])) for (const d of (w.description || [])) if (d.value) cweIds.push(d.value);
  const refs = (cve.references || []).map(r => ({ url: r.url || "", source: r.source || "", tags: r.tags || [] }));
  const prods = [];
  for (const cfg of (cve.configurations || []))
    for (const n of (cfg.nodes || []))
      for (const m of (n.cpeMatch || [])) {
        const p = (m.criteria || "").split(":");
        if (p.length >= 5) prods.push({ vendor: p[3] || "", product: p[4] || "", version: m.versionEndExcluding || m.versionStartIncluding || p[5] || "*" });
      }
  return { cveId: cve.id || "", description: en.value || "", cvssV31Score: s, cvssV31Vector: v31.vectorString || "", cvssV30Score: v30.baseScore || 0, cvssV2Score: v2.baseScore || 0, severity: sev, publishedDate: cve.published || "", lastModifiedDate: cve.lastModified || "", cweIds, references: refs, affectedProducts: prods };
}

export function lookupCve(config, secret, cveId) {
  if (!cveId || typeof cveId !== "string") throw new GrpcError(grpcStatus.INVALID_ARGUMENT, "cveId is required and must be a string");
  const baseUrl = config?.nvdBaseUrl || DEFAULT_BASE_URL;
  const headers = { Accept: "application/json", "User-Agent": "OctoBus-NVD/0.1" };
  if (secret?.nvdApiKey) headers.apiKey = secret.nvdApiKey;
  const data = httpGetJson(`${baseUrl}?cveId=${encodeURIComponent(cveId)}`, headers, config?.timeoutMs);
  const vulns = data.vulnerabilities || [];
  if (vulns.length === 0) throw new GrpcError(grpcStatus.INVALID_ARGUMENT, `CVE ${cveId} not found in NVD`);
  return extractCveDetails(vulns[0]);
}

export function searchCves(config, secret, req) {
  if (req.keyword !== undefined && typeof req.keyword !== "string") throw new GrpcError(grpcStatus.INVALID_ARGUMENT, "keyword must be a string");
  const baseUrl = config?.nvdBaseUrl || DEFAULT_BASE_URL;
  const headers = { Accept: "application/json", "User-Agent": "OctoBus-NVD/0.1" };
  if (secret?.nvdApiKey) headers.apiKey = secret.nvdApiKey;
  const params = [];
  params.push(`resultsPerPage=${Math.min(req.limit || 20, 50)}`);
  params.push(`startIndex=${req.skip || 0}`);
  if (req.keyword) params.push(`keywordSearch=${encodeURIComponent(req.keyword)}`);
  if (req.severity) params.push(`cvssV3Severity=${req.severity.toUpperCase()}`);
  if (req.pubStartDate) params.push(`pubStartDate=${encodeURIComponent(req.pubStartDate)}`);
  if (req.pubEndDate) params.push(`pubEndDate=${encodeURIComponent(req.pubEndDate)}`);
  const data = httpGetJson(`${baseUrl}?${params.join("&")}`, headers, config?.timeoutMs);
  const vulns = data.vulnerabilities || [];
  return { total: data.totalResults || vulns.length, data: vulns.map(v => extractCveDetails(v)) };
}

export const handlers = {
  "nist.nvd.v2.NvdService/LookupCve": (ctx) => lookupCve(ctx.config, ctx.secret, ctx.request.cveId),
  "nist.nvd.v2.NvdService/SearchCves": (ctx) => searchCves(ctx.config, ctx.secret, ctx.request),
};

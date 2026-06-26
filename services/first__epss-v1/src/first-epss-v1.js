import { execSync } from "node:child_process";
import { GrpcError, grpcStatus } from "@chaitin-ai/octobus-sdk";

const DEFAULT_BASE_URL = "https://api.first.org/data/v1/epss";

function httpGetJson(url, timeoutMs) {
  const cmd = `curl -s -w '\\n%{http_code}' -X GET '${url}' --max-time ${Math.ceil((timeoutMs || 30000) / 1000)}`;
  let raw;
  try { raw = execSync(cmd, { timeout: timeoutMs || 30000, encoding: "utf8", maxBuffer: 10 << 20 }); }
  catch (e) { throw new GrpcError(grpcStatus.UNAVAILABLE, `EPSS API unreachable: ${e.message}`); }
  const lines = raw.trim().split("\n");
  const sc = parseInt(lines[lines.length - 1] || "0", 10);
  const body = lines.slice(0, -1).join("\n");
  if (sc >= 500) throw new GrpcError(grpcStatus.UNAVAILABLE, `EPSS API HTTP ${sc}: temporarily unavailable`);
  if (sc >= 400) throw new GrpcError(grpcStatus.INVALID_ARGUMENT, `EPSS API HTTP ${sc}: ${body.substring(0, 200)}`);
  try { return JSON.parse(body); }
  catch (e) { throw new GrpcError(grpcStatus.UNAVAILABLE, `EPSS API returned non-JSON (HTTP ${sc})`); }
}

export function getScores(config, cveIds) {
  if (!Array.isArray(cveIds) || cveIds.length === 0) return { data: [] };
  for (const id of cveIds) if (typeof id !== "string") throw new GrpcError(grpcStatus.INVALID_ARGUMENT, "each cveId must be a string");
  const baseUrl = config?.epssBaseUrl || DEFAULT_BASE_URL;
  const param = cveIds.join(",");
  const data = httpGetJson(`${baseUrl}?cve=${encodeURIComponent(param)}&limit=${cveIds.length}`, config?.timeoutMs);
  return { data: (data.data || []).map(e => ({ cveId: e.cve || "", epss: parseFloat(e.epss) || 0, percentile: parseFloat(e.percentile) || 0, date: e.date || "" })) };
}

export const handlers = {
  "first.epss.v1.EpssService/GetScores": (ctx) => getScores(ctx.config, ctx.request.cveIds || []),
};

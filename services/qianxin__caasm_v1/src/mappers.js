import { grpcInvalidArgumentError } from "@chaitin-ai/octobus-sdk";

/**
 * Build the upstream request body from the proto PageRequest.
 *
 * The CAASM API expects:
 *   { offset, limit, filter?, login_name? }
 *
 * @param {object} request - decoded proto PageRequest
 * @param {object} options
 * @param {number} options.defaultLimit - fallback when request.limit is 0
 * @param {number} options.maxLimit - clamp limit to this maximum
 * @returns {{ offset: number, limit: number, filter?: object, login_name?: string }}
 */
export function buildRequestBody(request, { defaultLimit = 10, maxLimit = 100 } = {}) {
  let offset = Number(request.offset) || 0;
  let limit = Number(request.limit) || defaultLimit;

  if (limit > maxLimit) limit = maxLimit;
  if (limit < 1) limit = defaultLimit;
  if (offset < 0) offset = 0;

  const body = { offset, limit };

  // Filter is now a plain JSON string — parse it
  if (request.filter && typeof request.filter === "string" && request.filter.trim()) {
    let parsed;
    try {
      parsed = JSON.parse(request.filter);
    } catch {
      throw grpcInvalidArgumentError("filter must be valid JSON");
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw grpcInvalidArgumentError("filter must be a JSON object");
    }
    body.filter = parsed;
  }

  if (request.loginName) {
    body.login_name = request.loginName;
  }

  return body;
}

/**
 * Build the CAASM API path for a given entity type.
 *
 * Maps logical names to the known CAASM API paths.
 */
export const API_PATHS = {
  // Asset
  dev: "/api/entity/dev",
  software: "/api/entity/software",
  service: "/api/entity/service",
  component: "/api/entity/component",
  website: "/api/entity/website",

  // Vulnerability
  vulnSys: "/api/entity/vuln_sys",
  weakpwdSys: "/api/entity/weakpwd_sys",
  vulnWeb: "/api/entity/vuln_web",
  weakpwdWeb: "/api/entity/weakpwd_web",

  // Admin
  user: "/api/system/user/list",
  org: "/api/system/org/list",
  role: "/api/system/role/list",
};

/** Table-specific max limits */
export const MAX_LIMITS = {
  default: 100,
  largeTable: 10, // service (15M+), component (19M+), software (5M+) — keep very small
};

/**
 * Build proto PageResponse — return the CAASM JSON as a string field.
 *
 * Applies client-side slicing because some CAASM endpoints (user/list,
 * org/list) ignore offset/limit and return all records. The total field
 * always reflects the real upstream total.
 *
 * @param {object} raw - the parsed JSON from CAASM: { items: [...], total: N }
 * @param {{ offset: number, limit: number }} page - the requested page params
 * @returns {{ json: string }}
 */
export function buildPageResponse(raw, { offset = 0, limit = 100 } = {}) {
  const allItems = raw.items || [];
  const total = Number(raw.total) || 0;

  // Client-side slice
  const start = Math.max(0, offset);
  const end = start + Math.max(1, limit);
  const sliced = allItems.slice(start, end);

  return {
    json: JSON.stringify({ items: sliced, total }),
  };
}

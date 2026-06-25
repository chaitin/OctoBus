// F5 AWAF iControl REST proxy
// Bindings: host (required), port (default 443), verify_ssl (default false)
// Secret:   username, password
// Auth:     Login → token → BlockIP/UnblockIP → Logout

import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';

const DEFAULT_TIMEOUT_MS = 30_000;

// ── Path constants ────────────────────────────────────────────────────────────

const LOGIN_PATH        = '/f5.awaf.v1.F5AWAF/Login';
const BLOCK_IP_PATH     = '/f5.awaf.v1.F5AWAF/BlockIP';
const UNBLOCK_PATH      = '/f5.awaf.v1.F5AWAF/UnblockIP';
const ALLOW_IP_PATH     = '/f5.awaf.v1.F5AWAF/AllowIP';
const SET_MODE_PATH     = '/f5.awaf.v1.F5AWAF/SetEnforcementMode';
const LIST_POLICIES_PATH = '/f5.awaf.v1.F5AWAF/ListPolicies';
const LOGOUT_PATH       = '/f5.awaf.v1.F5AWAF/Logout';

export const METHOD_LOGIN        = 'f5.awaf.v1.F5AWAF/Login';
export const METHOD_BLOCK_IP     = 'f5.awaf.v1.F5AWAF/BlockIP';
export const METHOD_UNBLOCK      = 'f5.awaf.v1.F5AWAF/UnblockIP';
export const METHOD_ALLOW_IP     = 'f5.awaf.v1.F5AWAF/AllowIP';
export const METHOD_SET_MODE     = 'f5.awaf.v1.F5AWAF/SetEnforcementMode';
export const METHOD_LIST_POLICIES = 'f5.awaf.v1.F5AWAF/ListPolicies';
export const METHOD_LOGOUT       = 'f5.awaf.v1.F5AWAF/Logout';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Merge instance config + secret + per-request bindings overrides */
const mergedBindings = (ctx = {}) => ({
  ...(ctx.config ?? {}),
  ...(ctx.secret ?? {}),
  ...(ctx.bindings ?? {}),
});

/**
 * Build a fetch wrapper.
 * When verify_ssl=false, use undici Agent to skip TLS validation (Node 18+).
 */
const makeFetcher = (skipTlsVerify) => {
  if (!skipTlsVerify) return (url, opts) => globalThis.fetch(url, opts);
  return async (url, opts = {}) => {
    try {
      const { Agent } = await import('undici');
      const dispatcher = new Agent({ connect: { rejectUnauthorized: false } });
      return await globalThis.fetch(url, { ...opts, dispatcher });
    } catch {
      // undici not available — fall back (will fail on self-signed certs)
      return globalThis.fetch(url, opts);
    }
  };
};

/**
 * Map HTTP status to gRPC error and throw.
 *   401 / 403  → PERMISSION_DENIED
 *   other 4xx  → FAILED_PRECONDITION
 *   5xx / net  → UNAVAILABLE
 */
const throwForStatus = (status, bodyText, action) => {
  let preview = '';
  try { preview = JSON.parse(bodyText)?.message ?? bodyText.slice(0, 120); } catch { preview = bodyText.slice(0, 120); }
  const detail = `${action}: HTTP ${status}${preview ? ` — ${preview}` : ''}`;

  if (status === 401 || status === 403) throw new GrpcError(grpcStatus.PERMISSION_DENIED, detail);
  if (status >= 400 && status < 500)   throw new GrpcError(grpcStatus.FAILED_PRECONDITION, detail);
  throw new GrpcError(grpcStatus.UNAVAILABLE, detail);
};

/**
 * F5 iControl REST request.
 *
 * @param {Function}  doFetch  - fetch implementation (mockable)
 * @param {'GET'|'POST'|'PATCH'|'DELETE'} method
 * @param {string}    url      - full URL
 * @param {{token?: string, body?: object, timeoutMs?: number}} opts
 * @returns {Promise<{status: number, data: object, text: string}>}
 */
const f5Fetch = async (doFetch, method, url, opts = {}) => {
  const { token, body, timeoutMs = DEFAULT_TIMEOUT_MS } = opts;
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { 'X-F5-Auth-Token': token } : {}),
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res;
  try {
    res = await doFetch(url, {
      method,
      headers,
      body: body != null ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new GrpcError(grpcStatus.DEADLINE_EXCEEDED, `F5 request timed out: ${method} ${url}`);
    }
    throw new GrpcError(grpcStatus.UNAVAILABLE, `F5 network error: ${err.message}`);
  } finally {
    clearTimeout(timer);
  }

  const text = await res.text();
  let data = {};
  try { if (text) data = JSON.parse(text); } catch { /* non-JSON body */ }
  return { status: res.status, data, text };
};

// ── Handler implementations ───────────────────────────────────────────────────

async function doLogin(req, bindings, baseUrl, doFetch, timeoutMs) {
  const { username, password } = bindings;
  if (!username) throw new GrpcError(grpcStatus.INVALID_ARGUMENT, 'secret.username is required');
  if (!password) throw new GrpcError(grpcStatus.INVALID_ARGUMENT, 'secret.password is required');

  const r = await f5Fetch(doFetch, 'POST', `${baseUrl}/mgmt/shared/authn/login`, {
    body: { username, password, loginProviderName: 'tmos' },
    timeoutMs,
  });

  if (r.status !== 200) throwForStatus(r.status, r.text, 'Login');

  const tokenObj = r.data?.token;
  if (!tokenObj?.token) {
    throw new GrpcError(grpcStatus.INTERNAL, 'Login response missing token field');
  }

  return {
    code: 0,
    message: 'Login successful',
    token: tokenObj.token,
    token_id: tokenObj.name ?? tokenObj.token,
  };
}

async function findPolicyId(policyName, token, baseUrl, doFetch, timeoutMs) {
  const url = `${baseUrl}/mgmt/tm/asm/policies?$filter=name+eq+${encodeURIComponent(policyName)}&$select=id,name`;
  const r = await f5Fetch(doFetch, 'GET', url, { token, timeoutMs });

  if (r.status !== 200) throwForStatus(r.status, r.text, `FindPolicy(${policyName})`);

  const items = r.data?.items ?? [];
  if (items.length === 0) {
    throw new GrpcError(grpcStatus.NOT_FOUND, `ASM policy not found: "${policyName}"`);
  }
  return items[0].id;
}

async function listIpExceptions(policyId, token, baseUrl, doFetch, timeoutMs) {
  const url = `${baseUrl}/mgmt/tm/asm/policies/${policyId}/ip-exceptions?$select=id,ipAddress,blockRequests`;
  const r = await f5Fetch(doFetch, 'GET', url, { token, timeoutMs });
  if (r.status !== 200) throwForStatus(r.status, r.text, 'ListIpExceptions');
  return r.data?.items ?? [];
}

async function applyPolicy(policyId, token, baseUrl, doFetch, timeoutMs) {
  try {
    await f5Fetch(doFetch, 'POST', `${baseUrl}/mgmt/tm/asm/tasks/apply-policy`, {
      token,
      timeoutMs,
      body: { policyReference: { link: `https://localhost/mgmt/tm/asm/policies/${policyId}` } },
    });
  } catch { /* best-effort */ }
}

async function doBlockIP(req, bindings, baseUrl, doFetch, timeoutMs) {
  const { token, addresses = [], policy_name, description } = req;
  if (!token) throw new GrpcError(grpcStatus.INVALID_ARGUMENT, 'token is required');
  if (!addresses.length) throw new GrpcError(grpcStatus.INVALID_ARGUMENT, 'addresses must not be empty');

  const policyName = policy_name || bindings.default_policy_name;
  if (!policyName) {
    throw new GrpcError(grpcStatus.INVALID_ARGUMENT, 'policy_name is required (or set config.default_policy_name)');
  }

  const policyId = await findPolicyId(policyName, token, baseUrl, doFetch, timeoutMs);
  const existing = await listIpExceptions(policyId, token, baseUrl, doFetch, timeoutMs);
  const existingMap = new Map(existing.map((e) => [e.ipAddress, e]));

  const blocked = [], failed = [];

  for (const address of addresses) {
    try {
      const exc = existingMap.get(address);
      if (exc) {
        // Already exists → PATCH to ensure blockRequests=always
        const r = await f5Fetch(doFetch, 'PATCH',
          `${baseUrl}/mgmt/tm/asm/policies/${policyId}/ip-exceptions/${exc.id}`,
          { token, timeoutMs, body: { blockRequests: 'always' } });
        r.status === 200 ? blocked.push(address) : failed.push(address);
      } else {
        const r = await f5Fetch(doFetch, 'POST',
          `${baseUrl}/mgmt/tm/asm/policies/${policyId}/ip-exceptions`,
          {
            token, timeoutMs,
            body: {
              ipAddress: address,
              blockRequests: 'always',
              description: description || 'Blocked by OctoBus f5__awaf',
            },
          });
        (r.status === 200 || r.status === 201) ? blocked.push(address) : failed.push(address);
      }
    } catch {
      failed.push(address);
    }
  }

  if (blocked.length > 0) await applyPolicy(policyId, token, baseUrl, doFetch, timeoutMs);

  return {
    code: failed.length === 0 ? 0 : 1,
    message: failed.length === 0
      ? `Blocked ${blocked.length} IP(s) in policy "${policyName}"`
      : `Blocked ${blocked.length}, failed ${failed.length} in policy "${policyName}"`,
    blocked,
    failed,
  };
}

async function doUnblockIP(req, bindings, baseUrl, doFetch, timeoutMs) {
  const { token, addresses = [], policy_name } = req;
  if (!token) throw new GrpcError(grpcStatus.INVALID_ARGUMENT, 'token is required');
  if (!addresses.length) throw new GrpcError(grpcStatus.INVALID_ARGUMENT, 'addresses must not be empty');

  const policyName = policy_name || bindings.default_policy_name;
  if (!policyName) {
    throw new GrpcError(grpcStatus.INVALID_ARGUMENT, 'policy_name is required (or set config.default_policy_name)');
  }

  const policyId = await findPolicyId(policyName, token, baseUrl, doFetch, timeoutMs);
  const existing = await listIpExceptions(policyId, token, baseUrl, doFetch, timeoutMs);
  const existingMap = new Map(existing.map((e) => [e.ipAddress, e]));

  const unblocked = [], failed = [];

  for (const address of addresses) {
    const exc = existingMap.get(address);
    if (!exc) { unblocked.push(address); continue; } // idempotent

    try {
      const r = await f5Fetch(doFetch, 'DELETE',
        `${baseUrl}/mgmt/tm/asm/policies/${policyId}/ip-exceptions/${exc.id}`,
        { token, timeoutMs });
      (r.status === 200 || r.status === 204) ? unblocked.push(address) : failed.push(address);
    } catch {
      failed.push(address);
    }
  }

  if (unblocked.length > 0) await applyPolicy(policyId, token, baseUrl, doFetch, timeoutMs);

  return {
    code: failed.length === 0 ? 0 : 1,
    message: failed.length === 0
      ? `Unblocked ${unblocked.length} IP(s) in policy "${policyName}"`
      : `Unblocked ${unblocked.length}, failed ${failed.length} in policy "${policyName}"`,
    unblocked,
    failed,
  };
}

async function doAllowIP(req, bindings, baseUrl, doFetch, timeoutMs) {
  const { token, addresses = [], policy_name, description } = req;
  if (!token) throw new GrpcError(grpcStatus.INVALID_ARGUMENT, 'token is required');
  if (!addresses.length) throw new GrpcError(grpcStatus.INVALID_ARGUMENT, 'addresses must not be empty');

  const policyName = policy_name || bindings.default_policy_name;
  if (!policyName) {
    throw new GrpcError(grpcStatus.INVALID_ARGUMENT, 'policy_name is required (or set config.default_policy_name)');
  }

  const policyId = await findPolicyId(policyName, token, baseUrl, doFetch, timeoutMs);
  const existing = await listIpExceptions(policyId, token, baseUrl, doFetch, timeoutMs);
  const existingMap = new Map(existing.map((e) => [e.ipAddress, e]));

  const allowed = [], failed = [];

  for (const address of addresses) {
    try {
      const exc = existingMap.get(address);
      if (exc) {
        const r = await f5Fetch(doFetch, 'PATCH',
          `${baseUrl}/mgmt/tm/asm/policies/${policyId}/ip-exceptions/${exc.id}`,
          { token, timeoutMs, body: { blockRequests: 'never' } });
        r.status === 200 ? allowed.push(address) : failed.push(address);
      } else {
        const r = await f5Fetch(doFetch, 'POST',
          `${baseUrl}/mgmt/tm/asm/policies/${policyId}/ip-exceptions`,
          {
            token, timeoutMs,
            body: {
              ipAddress: address,
              blockRequests: 'never',
              description: description || 'Allowed by OctoBus f5__awaf',
            },
          });
        (r.status === 200 || r.status === 201) ? allowed.push(address) : failed.push(address);
      }
    } catch {
      failed.push(address);
    }
  }

  if (allowed.length > 0) await applyPolicy(policyId, token, baseUrl, doFetch, timeoutMs);

  return {
    code: failed.length === 0 ? 0 : 1,
    message: failed.length === 0
      ? `Allowed ${allowed.length} IP(s) in policy "${policyName}"`
      : `Allowed ${allowed.length}, failed ${failed.length} in policy "${policyName}"`,
    allowed,
    failed,
  };
}

const VALID_MODES = new Set(['blocking', 'transparent']);

async function doSetEnforcementMode(req, bindings, baseUrl, doFetch, timeoutMs) {
  const { token, policy_name, mode } = req;
  if (!token) throw new GrpcError(grpcStatus.INVALID_ARGUMENT, 'token is required');
  if (!mode || !VALID_MODES.has(mode)) {
    throw new GrpcError(grpcStatus.INVALID_ARGUMENT, 'mode must be "blocking" or "transparent"');
  }

  const policyName = policy_name || bindings.default_policy_name;
  if (!policyName) {
    throw new GrpcError(grpcStatus.INVALID_ARGUMENT, 'policy_name is required (or set config.default_policy_name)');
  }

  const policyId = await findPolicyId(policyName, token, baseUrl, doFetch, timeoutMs);

  const r = await f5Fetch(doFetch, 'PATCH',
    `${baseUrl}/mgmt/tm/asm/policies/${policyId}`,
    { token, timeoutMs, body: { enforcementMode: mode } });

  if (r.status !== 200) throwForStatus(r.status, r.text, 'SetEnforcementMode');

  await applyPolicy(policyId, token, baseUrl, doFetch, timeoutMs);

  return {
    code: 0,
    message: `Policy "${policyName}" enforcement mode set to "${mode}"`,
    policy_name: policyName,
    mode,
  };
}

async function doListPolicies(req, _bindings, baseUrl, doFetch, timeoutMs) {
  const { token } = req;
  if (!token) throw new GrpcError(grpcStatus.INVALID_ARGUMENT, 'token is required');

  const url = `${baseUrl}/mgmt/tm/asm/policies?$select=id,name,enforcementMode,active`;
  const r = await f5Fetch(doFetch, 'GET', url, { token, timeoutMs });

  if (r.status !== 200) throwForStatus(r.status, r.text, 'ListPolicies');

  const policies = (r.data?.items ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    enforcement_mode: p.enforcementMode ?? 'blocking',
    active: p.active ?? false,
  }));

  return {
    code: 0,
    message: `Found ${policies.length} policy(ies)`,
    policies,
  };
}

async function doLogout(req, _bindings, baseUrl, doFetch, timeoutMs) {
  const { token } = req;
  if (!token) throw new GrpcError(grpcStatus.INVALID_ARGUMENT, 'token is required');

  const r = await f5Fetch(doFetch, 'DELETE',
    `${baseUrl}/mgmt/shared/authz/tokens/${token}`,
    { token, timeoutMs });

  // 404 = already expired, still counts as success
  if (r.status === 200 || r.status === 204 || r.status === 404) {
    return { code: 0, message: 'Logout successful' };
  }
  throwForStatus(r.status, r.text, 'Logout');
}

// ── rpcdef (primary export) ───────────────────────────────────────────────────

/**
 * Returns a map of path → async handler, all bound to the given context.
 * ctx.req holds the decoded request message.
 *
 * @param {object} ctx  OctoBus HandlerContext
 */
export function rpcdef(ctx) {
  const bindings = mergedBindings(ctx);
  const host = bindings.host;
  if (!host) throw new GrpcError(grpcStatus.INVALID_ARGUMENT, 'config.host is required');

  const port = bindings.port ?? 443;
  const baseUrl = `https://${host}:${port}`;
  const skipTlsVerify = !(bindings.verify_ssl ?? false); // schema default: false → skip
  const timeoutMs = ctx.limits?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const doFetch = makeFetcher(skipTlsVerify);
  const req = ctx.req ?? {};

  return {
    [LOGIN_PATH]:         () => doLogin(req, bindings, baseUrl, doFetch, timeoutMs),
    [BLOCK_IP_PATH]:      () => doBlockIP(req, bindings, baseUrl, doFetch, timeoutMs),
    [UNBLOCK_PATH]:       () => doUnblockIP(req, bindings, baseUrl, doFetch, timeoutMs),
    [ALLOW_IP_PATH]:      () => doAllowIP(req, bindings, baseUrl, doFetch, timeoutMs),
    [SET_MODE_PATH]:      () => doSetEnforcementMode(req, bindings, baseUrl, doFetch, timeoutMs),
    [LIST_POLICIES_PATH]: () => doListPolicies(req, bindings, baseUrl, doFetch, timeoutMs),
    [LOGOUT_PATH]:        () => doLogout(req, bindings, baseUrl, doFetch, timeoutMs),
  };
}

// ── SDK handlers (for defineService) ─────────────────────────────────────────

export const handlers = {
  [METHOD_LOGIN]:          (ctx) => rpcdef(ctx)[LOGIN_PATH](),
  [METHOD_BLOCK_IP]:       (ctx) => rpcdef(ctx)[BLOCK_IP_PATH](),
  [METHOD_UNBLOCK]:        (ctx) => rpcdef(ctx)[UNBLOCK_PATH](),
  [METHOD_ALLOW_IP]:       (ctx) => rpcdef(ctx)[ALLOW_IP_PATH](),
  [METHOD_SET_MODE]:       (ctx) => rpcdef(ctx)[SET_MODE_PATH](),
  [METHOD_LIST_POLICIES]:  (ctx) => rpcdef(ctx)[LIST_POLICIES_PATH](),
  [METHOD_LOGOUT]:         (ctx) => rpcdef(ctx)[LOGOUT_PATH](),
};

// ── Internal test exports ─────────────────────────────────────────────────────

export const _test = {
  mergedBindings,
  makeFetcher,
  f5Fetch,
  findPolicyId,
  listIpExceptions,
  applyPolicy,
  throwForStatus,
};

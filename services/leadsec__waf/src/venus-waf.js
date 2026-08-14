import { createHash } from "node:crypto";
import http from "node:http";
import https from "node:https";

import { GrpcError, grpcStatus } from "@chaitin-ai/octobus-sdk";

const DEFAULT_TIMEOUT_MS = 5000;

const HEALTH_CHECK_PATH = "/Venus_WAF.Venus_WAF/HealthCheck";
const LIST_BLACKLISTS_PATH = "/Venus_WAF.Venus_WAF/ListBlacklists";
const LIST_ACCESS_OPTIONS_PATH = "/Venus_WAF.Venus_WAF/ListAccessOptions";
const CREATE_ADDRESS_OBJECT_PATH = "/Venus_WAF.Venus_WAF/CreateAddressObject";
const BLOCK_IP_PATH = "/Venus_WAF.Venus_WAF/BlockIP";
const DELETE_BLOCKED_IP_PATH = "/Venus_WAF.Venus_WAF/DeleteBlockedIP";
const CREATE_BLACKLIST_PATH = "/Venus_WAF.Venus_WAF/CreateBlacklist";
const UPDATE_BLACKLIST_PATH = "/Venus_WAF.Venus_WAF/UpdateBlacklist";
const SET_BLACKLIST_ENABLED_PATH = "/Venus_WAF.Venus_WAF/SetBlacklistEnabled";
const DELETE_BLACKLIST_PATH = "/Venus_WAF.Venus_WAF/DeleteBlacklist";
const SET_BLACKLIST_PRIORITY_PATH = "/Venus_WAF.Venus_WAF/SetBlacklistPriority";
const LIST_WHITELISTS_PATH = "/Venus_WAF.Venus_WAF/ListWhitelists";
const ALLOW_IP_PATH = "/Venus_WAF.Venus_WAF/AllowIP";
const DELETE_ALLOWED_IP_PATH = "/Venus_WAF.Venus_WAF/DeleteAllowedIP";
const CREATE_WHITELIST_PATH = "/Venus_WAF.Venus_WAF/CreateWhitelist";
const UPDATE_WHITELIST_PATH = "/Venus_WAF.Venus_WAF/UpdateWhitelist";
const SET_WHITELIST_ENABLED_PATH = "/Venus_WAF.Venus_WAF/SetWhitelistEnabled";
const DELETE_WHITELIST_PATH = "/Venus_WAF.Venus_WAF/DeleteWhitelist";
const SET_WHITELIST_PRIORITY_PATH = "/Venus_WAF.Venus_WAF/SetWhitelistPriority";

const grpcCodeFor = (code) => ({
  INVALID_ARGUMENT: grpcStatus.INVALID_ARGUMENT,
  UNAUTHENTICATED: grpcStatus.UNAUTHENTICATED,
  PERMISSION_DENIED: grpcStatus.PERMISSION_DENIED,
  FAILED_PRECONDITION: grpcStatus.FAILED_PRECONDITION,
  UNAVAILABLE: grpcStatus.UNAVAILABLE,
})[code] ?? grpcStatus.UNKNOWN;

const errorWithCode = (code, message) => {
  const err = new GrpcError(grpcCodeFor(code), `${code}: ${message}`);
  err.legacyCode = code;
  return err;
};

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj ?? {}, key);

const firstDefined = (...vals) => vals.find((v) => v !== undefined && v !== null);

const mergedBindings = (ctx = {}) => ({
  ...(ctx?.config ?? {}),
  ...(ctx?.secret ?? {}),
  ...(ctx?.bindings ?? {}),
});

const normalizeBaseUrl = (url) => {
  const base = String(url || "").trim();
  try {
    const parsed = new URL(base);
    if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) {
      return null;
    }
    parsed.pathname = parsed.pathname.replace(/\/+$/, "");
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
};

const unwrapString = (value) => {
  if (value === undefined || value === null) return "";
  if (typeof value === "object" && value !== null && "value" in value) {
    return String(value.value ?? "");
  }
  return String(value);
};

const unwrapInt = (value, fallback = 0) => {
  const raw = typeof value === "object" && value !== null && "value" in value ? value.value : value;
  if (raw === undefined || raw === null || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || Number.isNaN(n)) return fallback;
  return n;
};

const requireAnyNonEmptyString = (obj, keys) => {
  for (const key of keys) {
    const value = unwrapString(obj?.[key]);
    if (value.trim()) return value;
  }
  throw errorWithCode("INVALID_ARGUMENT", `${keys[0]} is required`);
};

const requireNonEmptyString = (obj, key) => requireAnyNonEmptyString(obj, [key]);

const firstField = (obj, keys) => {
  for (const key of keys) {
    if (hasOwn(obj, key)) {
      return obj[key];
    }
  }
  return undefined;
};

const sha256Hex = (value) => createHash("sha256").update(String(value)).digest("hex");

const isIPv4 = (value) => {
  const parts = String(value || "").trim().split(".");
  if (parts.length !== 4) return false;
  return parts.every((part) => /^\d+$/.test(part) && Number(part) >= 0 && Number(part) <= 255);
};

const requireIPv4 = (req = {}) => {
  const ip = requireAnyNonEmptyString(req, ["ip", "src_ip", "srcIp"]);
  if (!isIPv4(ip)) throw errorWithCode("INVALID_ARGUMENT", `ip must be a valid IPv4 address: ${ip}`);
  return ip;
};

const ruleNameForIP = (prefix, ip) => `${prefix}_${ip.replaceAll(".", "_")}`;
const addressObjectNameForIP = (ip) => `octobus_addr_${ip.replaceAll(".", "_")}`;

const normalizeRule = (rule = {}) => ({
  name: rule.name ?? "",
  if_in: rule.if_in ?? "",
  src_addrobj: rule.src_addrobj ?? "",
  dst_addrobj: rule.dst_addrobj ?? "",
  dst_servobj: rule.dst_servobj ?? "",
  log: unwrapInt(rule.log),
  log_level: unwrapInt(rule.log_level),
  enable: unwrapInt(rule.enable),
  week_day: rule.week_day ?? "",
  day_enable_time: rule.day_enable_time ?? "",
  set_periodic: unwrapInt(rule.set_periodic),
});

const buildRulePayload = (req = {}) => {
  const name = requireAnyNonEmptyString(req, ["name"]);
  const ifIn = requireAnyNonEmptyString(req, ["if_in", "ifIn"]);
  const srcAddrObj = requireAnyNonEmptyString(req, ["src_addrobj", "srcAddrobj", "srcAddrObj"]);
  const dstAddrObj = requireAnyNonEmptyString(req, ["dst_addrobj", "dstAddrobj", "dstAddrObj"]);
  const dstServObj = requireAnyNonEmptyString(req, ["dst_servobj", "dstServobj", "dstServObj"]);

  return {
    name,
    if_in: ifIn,
    src_addrobj: srcAddrObj,
    dst_addrobj: dstAddrObj,
    dst_servobj: dstServObj,
    log: unwrapInt(firstField(req, ["log", "Log"]), 1),
    log_level: unwrapInt(firstField(req, ["log_level", "logLevel", "LogLevel"]), 6),
    enable: unwrapInt(firstField(req, ["enable", "Enable"]), 1),
    week_day: unwrapString(firstField(req, ["week_day", "weekDay", "WeekDay"])) || "7,",
    day_enable_time: unwrapString(firstField(req, ["day_enable_time", "dayEnableTime", "DayEnableTime"])) || "0-24",
    set_periodic: unwrapInt(firstField(req, ["set_periodic", "setPeriodic", "SetPeriodic"]), 1),
  };
};

const normalizeAccessOptions = (json = {}) => {
  const data = json?.data && typeof json.data === "object" ? json.data : {};
  const addrList = Array.isArray(data.addr?.obj) ? data.addr.obj : [];
  const addressObjects = addrList.map((obj = {}) => {
    const items = Array.isArray(obj.item) ? obj.item : [];
    return {
      name: String(obj.name ?? ""),
      hosts: items.map((item) => item?.host).filter(Boolean).map(String),
      networks: items.map((item) => item?.net).filter(Boolean).map(String),
      ranges: items
        .filter((item) => item?.range1 || item?.range2)
        .map((item) => `${item.range1 || ""}-${item.range2 || ""}`),
    };
  });
  return {
    interfaces: Array.isArray(data.if_in) ? data.if_in.map(String) : [],
    address_objects: addressObjects,
    service_objects: Array.isArray(data.servobj) ? data.servobj.map(String) : [],
    code: unwrapInt(json.code),
    message: String(json.msg ?? ""),
  };
};

const findAddressObjectForIP = (options, ip) =>
  options.address_objects.find((obj) => obj.hosts.includes(ip) || obj.networks.includes(`${ip}/32`));

const firstAvailable = (values, fallback, label) => {
  if (values.includes(fallback)) return fallback;
  if (values.length > 0) return values[0];
  throw errorWithCode("FAILED_PRECONDITION", `${label} has no available options`);
};

const addressObjectRequestFromIP = (req = {}, options = {}) => {
  const ip = requireIPv4(req);
  return {
    ip,
    name: unwrapString(firstField(req, [
      "address_object_name",
      "addressObjectName",
      "addressObjName",
      ...(options.allowName ? ["name"] : []),
    ])) ||
      addressObjectNameForIP(ip),
    desc: unwrapString(firstField(req, ["desc", "description"])),
  };
};

const buildAddressObjectPayload = (req = {}, options = {}) => {
  const { ip, name, desc } = addressObjectRequestFromIP(req, options);
  return {
    name,
    desc,
    item: [{
      type: 0,
      host: ip,
      net: "",
      range1: "",
      range2: "",
    }],
  };
};

const buildRuleFromIP = (req = {}, options, kind, sourceObjectName = "") => {
  const ip = requireIPv4(req);
  const explicitSource = unwrapString(firstField(req, ["src_addrobj", "srcAddrobj", "srcAddrObj"])).trim();
  const sourceObject = explicitSource
    ? { name: explicitSource }
    : (sourceObjectName ? { name: sourceObjectName } : findAddressObjectForIP(options, ip));
  if (!sourceObject?.name) {
    throw errorWithCode(
      "FAILED_PRECONDITION",
      `no address object contains ${ip}; create an address object first or pass src_addrobj explicitly`,
    );
  }
  const prefix = kind === "blacklist" ? "octobus_block" : "octobus_allow";
  return buildRulePayload({
    ...req,
    name: unwrapString(firstField(req, ["name", "Name"])) || ruleNameForIP(prefix, ip),
    if_in: unwrapString(firstField(req, ["if_in", "ifIn"])) || firstAvailable(options.interfaces, "any", "if_in"),
    src_addrobj: sourceObject.name,
    dst_addrobj: unwrapString(firstField(req, ["dst_addrobj", "dstAddrobj", "dstAddrObj"])) || "any",
    dst_servobj: unwrapString(firstField(req, ["dst_servobj", "dstServobj", "dstServObj"])) ||
      firstAvailable(options.service_objects, "any", "dst_servobj"),
    log: 1,
    log_level: 6,
    enable: 1,
    week_day: "7,",
    day_enable_time: "0-24",
    set_periodic: 1,
  });
};

const parseCookieHeader = (headers) => {
  const raw = headers?.get?.("set-cookie");
  if (!raw) return "";
  const cookies = String(raw)
    .split(/,(?=[^;,]+=)/)
    .map((item) => item.split(";")[0].trim())
    .filter(Boolean);
  return cookies.join("; ");
};

const redactedBodySummary = (text = "") => String(text)
  .replace(/(authorization|token|cookie|password)\s*[:=]\s*["']?[^"'\s;&<>]+/gi, "$1=<redacted>")
  .slice(0, 200);

const readJson = async (res) => {
  const text = await res.text();
  if (!res.ok) {
    const summary = redactedBodySummary(text);
    if (res.status === 401) throw errorWithCode("UNAUTHENTICATED", `upstream http ${res.status}: ${summary}`);
    if (res.status === 403) throw errorWithCode("PERMISSION_DENIED", `upstream http ${res.status}: ${summary}`);
    if (res.status >= 400 && res.status < 500) {
      throw errorWithCode("FAILED_PRECONDITION", `upstream http ${res.status}: ${summary}`);
    }
    throw errorWithCode("UNAVAILABLE", `upstream http ${res.status}: ${summary}`);
  }
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch (error) {
    throw errorWithCode("UNAVAILABLE", `upstream returned invalid JSON: ${error.message}`);
  }
};

const requestWithNode = (url, init = {}, options = {}) => new Promise((resolve, reject) => {
  const parsed = new URL(url);
  const transport = parsed.protocol === "https:" ? https : http;
  const headers = init.headers ?? {};
  const req = transport.request({
    method: init.method || "GET",
    protocol: parsed.protocol,
    hostname: parsed.hostname,
    port: parsed.port,
    path: `${parsed.pathname}${parsed.search}`,
    headers,
    timeout: options.timeoutMs,
    rejectUnauthorized: !options.insecureSkipTlsVerify,
  }, (res) => {
    const chunks = [];
    res.on("data", (chunk) => chunks.push(chunk));
    res.on("error", reject);
    res.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      resolve({
        ok: res.statusCode >= 200 && res.statusCode < 300,
        status: res.statusCode,
        headers: {
          get: (name) => {
            const value = res.headers[String(name).toLowerCase()];
            if (Array.isArray(value)) return value.join(", ");
            return value ?? "";
          },
        },
        text: async () => body,
      });
    });
  });
  req.on("timeout", () => {
    req.destroy(new Error(`request timeout after ${options.timeoutMs}ms`));
  });
  req.on("error", reject);
  if (init.body !== undefined) req.write(init.body);
  req.end();
});

const isAuthExpired = (json) => {
  const code = Number(json?.code);
  const msg = String(json?.msg ?? "").toLowerCase();
  return code === 401 || code === 403 || msg.includes("token") || msg.includes("authorization") || msg.includes("session");
};

const assertBusinessOk = (json) => {
  const code = Number(json?.code);
  if (code !== 0) {
    const msg = json?.msg == null ? "upstream business error" : String(json.msg);
    if (code === 266) throw errorWithCode("UNAUTHENTICATED", msg);
    throw errorWithCode("FAILED_PRECONDITION", `upstream code ${json?.code}: ${msg}`);
  }
};

export function rpcdef(ctx) {
  const bindings = mergedBindings(ctx);
  const baseUrl = normalizeBaseUrl(bindings.baseUrl || bindings.base_url || bindings.restBaseUrl || bindings.rest_base_url || bindings.endpoint);
  const username = unwrapString(bindings.username);
  const password = unwrapString(bindings.password);
  const timeoutMs = unwrapInt(firstDefined(bindings.timeoutMs, bindings.timeout_ms, ctx?.limits?.timeoutMs), DEFAULT_TIMEOUT_MS);
  const insecureSkipTlsVerify = Boolean(firstDefined(
    bindings.insecureSkipTlsVerify,
    bindings.insecure_skip_tls_verify,
    bindings.skipTlsVerify,
    bindings.skip_tls_verify,
  ));

  let auth = null;

  const requireConfig = () => {
    if (!baseUrl) throw errorWithCode("INVALID_ARGUMENT", "baseUrl is required and must be http(s)");
    if (!username.trim()) throw errorWithCode("INVALID_ARGUMENT", "username is required");
    if (!password) throw errorWithCode("INVALID_ARGUMENT", "password is required");
    if (timeoutMs < 1 || timeoutMs > 120000) {
      throw errorWithCode("INVALID_ARGUMENT", "timeoutMs must be between 1 and 120000");
    }
  };

  const fetchWaf = async (path, init = {}) => {
    const url = `${baseUrl}${path}`;
    try {
      if (insecureSkipTlsVerify) {
        return await requestWithNode(url, init, { timeoutMs, insecureSkipTlsVerify });
      }
      return await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      throw errorWithCode("UNAVAILABLE", error?.cause?.message || error?.message || "fetch failed");
    }
  };

  const login = async () => {
    requireConfig();
    const res = await fetchWaf("/api/mgr/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username, password: sha256Hex(password) }),
    });
    const json = await readJson(res);
    assertBusinessOk(json);
    const authorization = json?.data?.authorization;
    if (!authorization) {
      throw errorWithCode("UNAUTHENTICATED", "login response missing data.authorization");
    }
    auth = {
      authorization,
      cookie: parseCookieHeader(res.headers),
    };
    return auth;
  };

  const request = async (path, init = {}, retry = true) => {
    requireConfig();
    if (!auth) await login();
    const headers = {
      ...(init.headers ?? {}),
      Authorization: auth.authorization,
    };
    if (auth.cookie) headers.Cookie = auth.cookie;
    const res = await fetchWaf(path, { ...init, headers });
    if (retry && (res.status === 401 || res.status === 403)) {
      auth = null;
      await login();
      return request(path, init, false);
    }
    const json = await readJson(res);
    if (retry && isAuthExpired(json)) {
      auth = null;
      await login();
      return request(path, init, false);
    }
    assertBusinessOk(json);
    return json;
  };

  const listRules = async (kind) => {
    const path = kind === "blacklist" ? "/blacklist" : "/whitelist";
    const json = await request(path, { method: "GET" });
    const data = json?.data && typeof json.data === "object" ? json.data : {};
    // The whitelist API also returns its list under data.blacklist.
    const list = Array.isArray(data.blacklist) ? data.blacklist : [];
    return {
      global_priority_enabled: unwrapInt(data.enable),
      rules: list.map(normalizeRule),
      code: unwrapInt(json.code),
      message: String(json.msg ?? ""),
    };
  };

  const getAccessOptions = async () => {
    const json = await request("/blacklist/add", { method: "GET" });
    return normalizeAccessOptions(json);
  };

  const createAddressObject = async (req = {}, options = {}) => {
    const payload = buildAddressObjectPayload(req, options);
    const json = await request("/addressobject/addAddrObj", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    return {
      ok: true,
      code: unwrapInt(json.code),
      message: String(json.msg ?? ""),
    };
  };

  const ensureRuleExists = async (kind, name) => {
    const listed = await listRules(kind);
    if (!listed.rules.some((rule) => rule.name === name)) {
      throw errorWithCode(
        "FAILED_PRECONDITION",
        `${kind} rule ${name} was accepted by upstream but was not found after create; check if_in/address/service object values`,
      );
    }
  };

  const mutateRule = async (path, payload, verify = null) => {
    const json = await request(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (verify) await ensureRuleExists(verify.kind, verify.name);
    return {
      ok: true,
      code: unwrapInt(json.code),
      message: String(json.msg ?? ""),
    };
  };

  const createRule = async (kind, req = {}) => {
    const payload = buildRulePayload(req);
    return mutateRule(`/${kind}/add_submit`, payload, { kind, name: payload.name });
  };

  const createRuleFromIP = async (kind, req = {}) => {
    let options = await getAccessOptions();
    const ip = requireIPv4(req);
    let sourceObject = findAddressObjectForIP(options, ip);
    const explicitSource = unwrapString(firstField(req, ["src_addrobj", "srcAddrobj", "srcAddrObj"])).trim();
    if (!sourceObject && !explicitSource) {
      await createAddressObject(req);
      options = await getAccessOptions();
      sourceObject = findAddressObjectForIP(options, ip) ?? { name: buildAddressObjectPayload(req).name };
    }
    const payload = buildRuleFromIP(req, options, kind, sourceObject?.name);
    return mutateRule(`/${kind}/add_submit`, payload, { kind, name: payload.name });
  };

  const setEnabled = async (kind, req = {}) => {
    const name = requireNonEmptyString(req, "name");
    const enable = unwrapInt(firstField(req, ["enable", "Enable"]));
    if (enable !== 0 && enable !== 1) {
      throw errorWithCode("INVALID_ARGUMENT", "enable must be 0 or 1");
    }
    const mode = kind === "blacklist" ? 2 : 1;
    return mutateRule(`/${kind}/enableItem`, { mode, name, enable });
  };

  const deleteRule = async (kind, req = {}) => {
    const name = requireNonEmptyString(req, "name");
    return mutateRule(`/${kind}/delete`, { name });
  };

  const setPriority = async (kind, req = {}) => {
    const priority = unwrapInt(firstField(req, ["priority", "Priority"]));
    if (priority !== 0 && priority !== 1) {
      throw errorWithCode("INVALID_ARGUMENT", "priority must be 0 or 1");
    }
    return mutateRule(`/${kind}/setpriority`, { priority });
  };

  return {
    [HEALTH_CHECK_PATH]: async () => {
      const authResult = await login();
      return {
        ok: Boolean(authResult.authorization),
        code: 0,
        message: "success",
      };
    },
    [LIST_BLACKLISTS_PATH]: async () => listRules("blacklist"),
    [LIST_ACCESS_OPTIONS_PATH]: async () => getAccessOptions(),
    [CREATE_ADDRESS_OBJECT_PATH]: async () => createAddressObject(ctx.req, { allowName: true }),
    [BLOCK_IP_PATH]: async () => createRuleFromIP("blacklist", ctx.req),
    [DELETE_BLOCKED_IP_PATH]: async () => deleteRule("blacklist", ctx.req),
    [CREATE_BLACKLIST_PATH]: async () => createRule("blacklist", ctx.req),
    [UPDATE_BLACKLIST_PATH]: async () => mutateRule("/blacklist/edit_submit", buildRulePayload(ctx.req)),
    [SET_BLACKLIST_ENABLED_PATH]: async () => setEnabled("blacklist", ctx.req),
    [DELETE_BLACKLIST_PATH]: async () => deleteRule("blacklist", ctx.req),
    [SET_BLACKLIST_PRIORITY_PATH]: async () => setPriority("blacklist", ctx.req),
    [LIST_WHITELISTS_PATH]: async () => listRules("whitelist"),
    [ALLOW_IP_PATH]: async () => createRuleFromIP("whitelist", ctx.req),
    [DELETE_ALLOWED_IP_PATH]: async () => deleteRule("whitelist", ctx.req),
    [CREATE_WHITELIST_PATH]: async () => createRule("whitelist", ctx.req),
    [UPDATE_WHITELIST_PATH]: async () => mutateRule("/whitelist/edit_submit", buildRulePayload(ctx.req)),
    [SET_WHITELIST_ENABLED_PATH]: async () => setEnabled("whitelist", ctx.req),
    [DELETE_WHITELIST_PATH]: async () => deleteRule("whitelist", ctx.req),
    [SET_WHITELIST_PRIORITY_PATH]: async () => setPriority("whitelist", ctx.req),
  };
}

const mergeCtx = (baseCtx = {}, innerCtx = {}) => ({
  config: { ...(baseCtx.config ?? {}), ...(innerCtx.config ?? {}) },
  secret: { ...(baseCtx.secret ?? {}), ...(innerCtx.secret ?? {}) },
  bindings: { ...(baseCtx.bindings ?? {}), ...(innerCtx.bindings ?? {}) },
  limits: { ...(baseCtx.limits ?? {}), ...(innerCtx.limits ?? {}) },
  meta: { ...(baseCtx.meta ?? {}), ...(innerCtx.meta ?? {}) },
  metadata: { ...(baseCtx.metadata ?? {}), ...(innerCtx.metadata ?? {}) },
  getMetadata: innerCtx.getMetadata ?? baseCtx.getMetadata,
});

export const resolveCallContext = (baseCtx = {}, reqOrCtx, maybeInnerCtx) => {
  if (maybeInnerCtx !== undefined) {
    return { req: reqOrCtx ?? {}, ctx: mergeCtx(baseCtx, maybeInnerCtx) };
  }
  const innerCtx = reqOrCtx ?? {};
  return {
    req: innerCtx.request ?? innerCtx.req ?? {},
    ctx: mergeCtx(baseCtx, innerCtx),
  };
};

const wrapLegacyHandler = (baseCtx, methodPath) => async (reqOrCtx, maybeInnerCtx) => {
  const call = resolveCallContext(baseCtx, reqOrCtx, maybeInnerCtx);
  const legacyCtx = {
    ...call.ctx,
    req: call.req,
  };
  return rpcdef(legacyCtx)[methodPath]();
};

const registerHandlers = (ctx = {}) => ({
  [HEALTH_CHECK_PATH]: wrapLegacyHandler(ctx, HEALTH_CHECK_PATH),
  [LIST_BLACKLISTS_PATH]: wrapLegacyHandler(ctx, LIST_BLACKLISTS_PATH),
  [LIST_ACCESS_OPTIONS_PATH]: wrapLegacyHandler(ctx, LIST_ACCESS_OPTIONS_PATH),
  [CREATE_ADDRESS_OBJECT_PATH]: wrapLegacyHandler(ctx, CREATE_ADDRESS_OBJECT_PATH),
  [BLOCK_IP_PATH]: wrapLegacyHandler(ctx, BLOCK_IP_PATH),
  [DELETE_BLOCKED_IP_PATH]: wrapLegacyHandler(ctx, DELETE_BLOCKED_IP_PATH),
  [CREATE_BLACKLIST_PATH]: wrapLegacyHandler(ctx, CREATE_BLACKLIST_PATH),
  [UPDATE_BLACKLIST_PATH]: wrapLegacyHandler(ctx, UPDATE_BLACKLIST_PATH),
  [SET_BLACKLIST_ENABLED_PATH]: wrapLegacyHandler(ctx, SET_BLACKLIST_ENABLED_PATH),
  [DELETE_BLACKLIST_PATH]: wrapLegacyHandler(ctx, DELETE_BLACKLIST_PATH),
  [SET_BLACKLIST_PRIORITY_PATH]: wrapLegacyHandler(ctx, SET_BLACKLIST_PRIORITY_PATH),
  [LIST_WHITELISTS_PATH]: wrapLegacyHandler(ctx, LIST_WHITELISTS_PATH),
  [ALLOW_IP_PATH]: wrapLegacyHandler(ctx, ALLOW_IP_PATH),
  [DELETE_ALLOWED_IP_PATH]: wrapLegacyHandler(ctx, DELETE_ALLOWED_IP_PATH),
  [CREATE_WHITELIST_PATH]: wrapLegacyHandler(ctx, CREATE_WHITELIST_PATH),
  [UPDATE_WHITELIST_PATH]: wrapLegacyHandler(ctx, UPDATE_WHITELIST_PATH),
  [SET_WHITELIST_ENABLED_PATH]: wrapLegacyHandler(ctx, SET_WHITELIST_ENABLED_PATH),
  [DELETE_WHITELIST_PATH]: wrapLegacyHandler(ctx, DELETE_WHITELIST_PATH),
  [SET_WHITELIST_PRIORITY_PATH]: wrapLegacyHandler(ctx, SET_WHITELIST_PRIORITY_PATH),
});

export const METHOD_HEALTH_CHECK_FULL = "Venus_WAF.Venus_WAF/HealthCheck";
export const METHOD_LIST_BLACKLISTS_FULL = "Venus_WAF.Venus_WAF/ListBlacklists";
export const METHOD_LIST_ACCESS_OPTIONS_FULL = "Venus_WAF.Venus_WAF/ListAccessOptions";
export const METHOD_CREATE_ADDRESS_OBJECT_FULL = "Venus_WAF.Venus_WAF/CreateAddressObject";
export const METHOD_BLOCK_IP_FULL = "Venus_WAF.Venus_WAF/BlockIP";
export const METHOD_DELETE_BLOCKED_IP_FULL = "Venus_WAF.Venus_WAF/DeleteBlockedIP";
export const METHOD_CREATE_BLACKLIST_FULL = "Venus_WAF.Venus_WAF/CreateBlacklist";
export const METHOD_UPDATE_BLACKLIST_FULL = "Venus_WAF.Venus_WAF/UpdateBlacklist";
export const METHOD_SET_BLACKLIST_ENABLED_FULL = "Venus_WAF.Venus_WAF/SetBlacklistEnabled";
export const METHOD_DELETE_BLACKLIST_FULL = "Venus_WAF.Venus_WAF/DeleteBlacklist";
export const METHOD_SET_BLACKLIST_PRIORITY_FULL = "Venus_WAF.Venus_WAF/SetBlacklistPriority";
export const METHOD_LIST_WHITELISTS_FULL = "Venus_WAF.Venus_WAF/ListWhitelists";
export const METHOD_ALLOW_IP_FULL = "Venus_WAF.Venus_WAF/AllowIP";
export const METHOD_DELETE_ALLOWED_IP_FULL = "Venus_WAF.Venus_WAF/DeleteAllowedIP";
export const METHOD_CREATE_WHITELIST_FULL = "Venus_WAF.Venus_WAF/CreateWhitelist";
export const METHOD_UPDATE_WHITELIST_FULL = "Venus_WAF.Venus_WAF/UpdateWhitelist";
export const METHOD_SET_WHITELIST_ENABLED_FULL = "Venus_WAF.Venus_WAF/SetWhitelistEnabled";
export const METHOD_DELETE_WHITELIST_FULL = "Venus_WAF.Venus_WAF/DeleteWhitelist";
export const METHOD_SET_WHITELIST_PRIORITY_FULL = "Venus_WAF.Venus_WAF/SetWhitelistPriority";

const sdkHandlers = registerHandlers({});

export const handlers = {
  [METHOD_HEALTH_CHECK_FULL]: (ctx) => sdkHandlers[HEALTH_CHECK_PATH](ctx),
  [METHOD_LIST_BLACKLISTS_FULL]: (ctx) => sdkHandlers[LIST_BLACKLISTS_PATH](ctx),
  [METHOD_LIST_ACCESS_OPTIONS_FULL]: (ctx) => sdkHandlers[LIST_ACCESS_OPTIONS_PATH](ctx),
  [METHOD_CREATE_ADDRESS_OBJECT_FULL]: (ctx) => sdkHandlers[CREATE_ADDRESS_OBJECT_PATH](ctx),
  [METHOD_BLOCK_IP_FULL]: (ctx) => sdkHandlers[BLOCK_IP_PATH](ctx),
  [METHOD_DELETE_BLOCKED_IP_FULL]: (ctx) => sdkHandlers[DELETE_BLOCKED_IP_PATH](ctx),
  [METHOD_CREATE_BLACKLIST_FULL]: (ctx) => sdkHandlers[CREATE_BLACKLIST_PATH](ctx),
  [METHOD_UPDATE_BLACKLIST_FULL]: (ctx) => sdkHandlers[UPDATE_BLACKLIST_PATH](ctx),
  [METHOD_SET_BLACKLIST_ENABLED_FULL]: (ctx) => sdkHandlers[SET_BLACKLIST_ENABLED_PATH](ctx),
  [METHOD_DELETE_BLACKLIST_FULL]: (ctx) => sdkHandlers[DELETE_BLACKLIST_PATH](ctx),
  [METHOD_SET_BLACKLIST_PRIORITY_FULL]: (ctx) => sdkHandlers[SET_BLACKLIST_PRIORITY_PATH](ctx),
  [METHOD_LIST_WHITELISTS_FULL]: (ctx) => sdkHandlers[LIST_WHITELISTS_PATH](ctx),
  [METHOD_ALLOW_IP_FULL]: (ctx) => sdkHandlers[ALLOW_IP_PATH](ctx),
  [METHOD_DELETE_ALLOWED_IP_FULL]: (ctx) => sdkHandlers[DELETE_ALLOWED_IP_PATH](ctx),
  [METHOD_CREATE_WHITELIST_FULL]: (ctx) => sdkHandlers[CREATE_WHITELIST_PATH](ctx),
  [METHOD_UPDATE_WHITELIST_FULL]: (ctx) => sdkHandlers[UPDATE_WHITELIST_PATH](ctx),
  [METHOD_SET_WHITELIST_ENABLED_FULL]: (ctx) => sdkHandlers[SET_WHITELIST_ENABLED_PATH](ctx),
  [METHOD_DELETE_WHITELIST_FULL]: (ctx) => sdkHandlers[DELETE_WHITELIST_PATH](ctx),
  [METHOD_SET_WHITELIST_PRIORITY_FULL]: (ctx) => sdkHandlers[SET_WHITELIST_PRIORITY_PATH](ctx),
};

export const _test = {
  buildRulePayload,
  buildAddressObjectPayload,
  buildRuleFromIP,
  errorWithCode,
  findAddressObjectForIP,
  firstField,
  mergedBindings,
  normalizeAccessOptions,
  normalizeRule,
  registerHandlers,
  resolveCallContext,
  sha256Hex,
};

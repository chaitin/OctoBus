import { createHash } from "node:crypto";
import http from "node:http";
import https from "node:https";

import { GrpcError, grpcStatus } from "@chaitin-ai/octobus-sdk";

const DEFAULT_TIMEOUT_MS = 10000;
const DEFAULT_API_PREFIX = "/api/v3";
const DEFAULT_AUTH_TOKEN = "CMCC_NFV";
const DEFAULT_DEVICE_TYPE = "api";

const HEALTH_CHECK_PATH = "/Venus_MAF.Venus_MAF/HealthCheck";
const CREATE_SITE_PATH = "/Venus_MAF.Venus_MAF/CreateSite";
const DELETE_SITE_PATH = "/Venus_MAF.Venus_MAF/DeleteSite";
const LIST_SITES_PATH = "/Venus_MAF.Venus_MAF/ListSites";
const UPLOAD_SENSITIVE_WORDS_PATH = "/Venus_MAF.Venus_MAF/UploadCustomSensitiveWords";

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

const firstField = (obj, keys) => {
  for (const key of keys) {
    if (hasOwn(obj, key)) return obj[key];
  }
  return undefined;
};

const objectOrDefault = (value, fallback) => (
  value && typeof value === "object" && !Array.isArray(value) ? value : fallback
);

const requireAnyNonEmptyString = (obj, keys) => {
  for (const key of keys) {
    const value = unwrapString(obj?.[key]);
    if (value.trim()) return value;
  }
  throw errorWithCode("INVALID_ARGUMENT", `${keys[0]} is required`);
};

const sha256Hex = (value) => createHash("sha256").update(String(value)).digest("hex");

const normalizeOrigin = (url) => {
  const raw = String(url || "").trim();
  if (!/^https?:\/\//i.test(raw)) return null;
  try {
    const parsed = new URL(raw);
    return parsed.origin;
  } catch {
    return null;
  }
};

const normalizePrefix = (prefix) => {
  const raw = unwrapString(prefix).trim() || DEFAULT_API_PREFIX;
  return `/${raw.replace(/^\/+|\/+$/g, "")}`;
};

const redactedBodySummary = (text = "") => String(text)
  .replace(/(authorization|token|cookie|password)\s*[:=]\s*["']?[^"'\s;&<>]+/gi, "$1=<redacted>")
  .slice(0, 200);

const readJsonOrString = async (res) => {
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
  } catch {
    return text;
  }
};

const statusOk = (json) => {
  if (typeof json === "string") return json.toLowerCase().includes("success") || json.trim().length > 0;
  if (json && typeof json === "object" && "code" in json) return Number(json.code) === 0;
  return true;
};

const statusMessage = (json) => {
  if (typeof json === "string") return json;
  if (json && typeof json === "object") return String(json.msg ?? json.message ?? "success");
  return "success";
};

const statusCode = (json) => {
  if (json && typeof json === "object" && "code" in json) return unwrapInt(json.code);
  return 0;
};

const assertBusinessOk = (json) => {
  if (!statusOk(json)) {
    throw errorWithCode("FAILED_PRECONDITION", `upstream business error: ${statusMessage(json)}`);
  }
};

const requestWithNode = (url, init = {}, options = {}) => new Promise((resolve, reject) => {
  const parsed = new URL(url);
  const transport = parsed.protocol === "https:" ? https : http;
  const headers = init.headers ?? {};
  const body = init.body;
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
      const text = Buffer.concat(chunks).toString("utf8");
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
        text: async () => text,
      });
    });
  });
  req.on("timeout", () => req.destroy(new Error(`request timeout after ${options.timeoutMs}ms`)));
  req.on("error", reject);
  if (body !== undefined) req.write(body);
  req.end();
});

const buildSitePayload = (req = {}) => {
  const upstream = req.upstream ?? req.Upstream ?? {};
  const serverAddr = Array.isArray(upstream.server_addr)
    ? upstream.server_addr
    : Array.isArray(upstream.serverAddr)
      ? upstream.serverAddr
      : [];
  const servers = serverAddr.map((server = {}) => ({
    ip: requireAnyNonEmptyString(server, ["ip"]),
    port: unwrapInt(server.port, 0),
    weight: unwrapInt(server.weight, 100),
  }));
  if (servers.some((server) => server.port < 1 || server.port > 65535)) {
    throw errorWithCode("INVALID_ARGUMENT", "upstream server port must be 1-65535");
  }

  const port = unwrapInt(req.port, 0);
  if (port < 1 || port > 65535) throw errorWithCode("INVALID_ARGUMENT", "port must be 1-65535");
  if (servers.length === 0) throw errorWithCode("INVALID_ARGUMENT", "upstream.server_addr is required");

  const serverName = Array.isArray(req.server_name) ? req.server_name : Array.isArray(req.serverName) ? req.serverName : [];
  if (serverName.length === 0) throw errorWithCode("INVALID_ARGUMENT", "server_name is required");

  const ssl = objectOrDefault(req.ssl, {});
  const clientIpSetting = Array.isArray(req.client_ip_setting)
    ? req.client_ip_setting
    : Array.isArray(req.clientIpSetting)
      ? req.clientIpSetting
      : [
          { type: "http_header", header_name: "X-Forwarded-For", index: 1, ignore_ip: [] },
          { type: "network", header_name: "", index: 0, ignore_ip: null },
        ];
  const upstreamHealthCheck = objectOrDefault(firstField(upstream, ["health_check", "healthCheck"]), {});

  return {
    name: requireAnyNonEmptyString(req, ["name"]),
    description: unwrapString(req.description),
    enable: unwrapInt(req.enable, 1),
    http_type: unwrapString(firstField(req, ["http_type", "httpType"])) || "http",
    ip: requireAnyNonEmptyString(req, ["ip"]),
    ip_version: unwrapInt(firstField(req, ["ip_version", "ipVersion"]), 0),
    ip_type: unwrapInt(firstField(req, ["ip_type", "ipType"]), 4),
    port,
    server_name: serverName.map(String),
    net_mode: unwrapInt(firstField(req, ["net_mode", "netMode"]), 2),
    safe_mode: unwrapInt(firstField(req, ["safe_mode", "safeMode"]), 1),
    upstream: {
      redirect: unwrapInt(upstream.redirect, 2),
      redirect_url: unwrapString(firstField(upstream, ["redirect_url", "redirectUrl"])),
      http_type: unwrapString(firstField(upstream, ["http_type", "httpType"])) || "http",
      load_balance_algo: unwrapString(firstField(upstream, ["load_balance_algo", "loadBalanceAlgo"])) || "round_robin",
      gm: unwrapInt(upstream.gm, 2),
      health_check: {
        enable: unwrapInt(upstreamHealthCheck.enable, 2),
        interval: unwrapInt(upstreamHealthCheck.interval, 5000),
        timeout: unwrapInt(upstreamHealthCheck.timeout, 1000),
        fall_count: unwrapInt(firstField(upstreamHealthCheck, ["fall_count", "fallCount"]), 5),
        rise_count: unwrapInt(firstField(upstreamHealthCheck, ["rise_count", "riseCount"]), 2),
        default_down: Boolean(firstField(upstreamHealthCheck, ["default_down", "defaultDown"]) ?? false),
        port: unwrapInt(upstreamHealthCheck.port, 0),
        type: unwrapString(upstreamHealthCheck.type) || "tcp",
        check_http_send: unwrapString(firstField(upstreamHealthCheck, ["check_http_send", "checkHttpSend"])),
        check_http_expect_alive: firstField(upstreamHealthCheck, ["check_http_expect_alive", "checkHttpExpectAlive"]) ?? null,
      },
      server_addr: servers,
    },
    ssl: {
      http2: unwrapInt(ssl.http2, 0),
      cryptos: Array.isArray(ssl.cryptos) ? ssl.cryptos : [],
      ssl_version_type: unwrapString(firstField(ssl, ["ssl_version_type", "sslVersionType"])) || "1+",
      ssl_version: Array.isArray(firstField(ssl, ["ssl_version", "sslVersion"]))
        ? firstField(ssl, ["ssl_version", "sslVersion"]).map(String)
        : ["TLSv1", "TLSv1.1", "TLSv1.2", "TLSv1.3"],
      ssl_id: unwrapInt(firstField(ssl, ["ssl_id", "sslId"]), 0),
      ssl_name: unwrapString(firstField(ssl, ["ssl_name", "sslName"])),
      cert_path: unwrapString(firstField(ssl, ["cert_path", "certPath"])),
      key_path: unwrapString(firstField(ssl, ["key_path", "keyPath"])),
      gm: unwrapInt(ssl.gm, 2),
      only_gm: unwrapInt(firstField(ssl, ["only_gm", "onlyGm"]), 0),
      gm_ssl_id: unwrapInt(firstField(ssl, ["gm_ssl_id", "gmSslId"]), 0),
      gm_ssl_name: unwrapString(firstField(ssl, ["gm_ssl_name", "gmSslName"])),
      gm_cryptos: Array.isArray(firstField(ssl, ["gm_cryptos", "gmCryptos"])) ? firstField(ssl, ["gm_cryptos", "gmCryptos"]) : [],
      enc_cert_path: unwrapString(firstField(ssl, ["enc_cert_path", "encCertPath"])),
      enc_key_path: unwrapString(firstField(ssl, ["enc_key_path", "encKeyPath"])),
      sig_cert_path: unwrapString(firstField(ssl, ["sig_cert_path", "sigCertPath"])),
      sig_key_path: unwrapString(firstField(ssl, ["sig_key_path", "sigKeyPath"])),
    },
    client_ip_setting: clientIpSetting,
    block_setting: objectOrDefault(firstField(req, ["block_setting", "blockSetting"]), {
      http_status: 403,
      redirect_url: "",
      error_page_text: "Forbidden, TraceID: {::trace_id::}",
      file_name: "",
      block_time: 60,
    }),
    ngx_attr: objectOrDefault(firstField(req, ["ngx_attr", "ngxAttr"]), {
      xff_add: "$http_x_forwarded_for",
      server_attr: {
        client_body_buffer_size: 512,
        client_body_timeout: 300,
        client_detect_body_size: 8,
        client_header_buffer_size: 64,
        client_header_timeout: 60,
        client_max_body_size: 500,
        gzip: 2,
        ignore_invalid_headers: 2,
        keepalive_timeout: 300,
        large_client_header_buffers_num: 4,
        large_client_header_buffers_size: 8,
        proxy_buffering: 1,
        proxy_connect_timeout: 60,
        proxy_detect_body_size: 8,
        proxy_read_timeout: 300,
        proxy_send_timeout: 300,
        proxy_ssl_name: "$http_host",
        underscores_in_headers: 1,
      },
      location_attr: {},
      upstream_attr: {
        keepalive: 4000,
        keepalive_enable: 1,
        upstream_keepalive_timeout: 60,
      },
      proxy_header_list: [],
      resp_header_list: [],
      custom_req_header: { key: "", value: "" },
    }),
    ext_attr: objectOrDefault(firstField(req, ["ext_attr", "extAttr"]), {
      access_log: false,
      encode: {
        enable: true,
        layer: 2,
        multipart: false,
        json: false,
        xml: false,
        url: true,
        base64: false,
        unicode: false,
        backslash: false,
        utf7: false,
        hex16: false,
        html: false,
        chunk: false,
        gzip: false,
        deflatep: false,
        postform: false,
      },
    }),
    template_algo_id: unwrapInt(firstField(req, ["template_algo_id", "templateAlgoId"]), 1),
    template_algo_name: unwrapString(firstField(req, ["template_algo_name", "templateAlgoName"])),
    template_rule_id: unwrapInt(firstField(req, ["template_rule_id", "templateRuleId"]), 50001),
    template_rule_name: unwrapString(firstField(req, ["template_rule_name", "templateRuleName"])),
    template_custom_rule_id: unwrapInt(firstField(req, ["template_custom_rule_id", "templateCustomRuleId"]), 0),
    template_custom_rule_name: unwrapString(firstField(req, ["template_custom_rule_name", "templateCustomRuleName"])),
    template_acl_id: unwrapInt(firstField(req, ["template_acl_id", "templateAclId"]), 0),
    template_acl_name: unwrapString(firstField(req, ["template_acl_name", "templateAclName"])),
    template_dos_id: unwrapInt(firstField(req, ["template_dos_id", "templateDosId"]), 0),
    template_dos_name: unwrapString(firstField(req, ["template_dos_name", "templateDosName"])),
    template_api_id: unwrapInt(firstField(req, ["template_api_id", "templateApiId"]), 0),
    template_api_name: unwrapString(firstField(req, ["template_api_name", "templateApiName"])),
    template_bot_id: unwrapInt(firstField(req, ["template_bot_id", "templateBotId"]), 1),
    template_bot_name: unwrapString(firstField(req, ["template_bot_name", "templateBotName"])),
    template_llm_id: unwrapInt(firstField(req, ["template_llm_id", "templateLlmId"]), 20),
    template_llm_name: unwrapString(firstField(req, ["template_llm_name", "templateLlmName"])),
  };
};

const normalizeSite = (site = {}) => ({
  id: unwrapInt(site.id),
  name: String(site.name ?? ""),
  ip: String(site.ip ?? ""),
  port: unwrapInt(site.port),
  http_type: String(site.http_type ?? site.httpType ?? ""),
  enable: unwrapInt(site.enable),
  server_name: Array.isArray(site.server_name) ? site.server_name.map(String) : [],
});

const buildMultipart = ({ fieldName, filename, content }) => {
  const boundary = `----octobus-maf-${Date.now().toString(16)}`;
  const safeFilename = String(filename).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/[\r\n]/g, "_");
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\n`),
    Buffer.from(`Content-Disposition: form-data; name="${fieldName}"; filename="${safeFilename}"\r\n`),
    Buffer.from("Content-Type: text/plain\r\n\r\n"),
    Buffer.from(String(content), "utf8"),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return {
    contentType: `multipart/form-data; boundary=${boundary}`,
    body,
  };
};

export function rpcdef(ctx) {
  const bindings = mergedBindings(ctx);
  const origin = normalizeOrigin(bindings.baseUrl || bindings.base_url || bindings.endpoint);
  const apiPrefix = normalizePrefix(bindings.apiPrefix || bindings.api_prefix);
  const username = unwrapString(bindings.username);
  const password = unwrapString(bindings.password);
  const authToken = unwrapString(bindings.authToken || bindings.auth_token) || DEFAULT_AUTH_TOKEN;
  const deviceType = unwrapString(bindings.deviceType || bindings.device_type) || DEFAULT_DEVICE_TYPE;
  const timeoutMs = unwrapInt(firstDefined(bindings.timeoutMs, bindings.timeout_ms, ctx?.limits?.timeoutMs), DEFAULT_TIMEOUT_MS);
  const insecureSkipTlsVerify = Boolean(firstDefined(
    bindings.insecureSkipTlsVerify,
    bindings.insecure_skip_tls_verify,
    bindings.skipTlsVerify,
    bindings.skip_tls_verify,
  ));

  let authorization = "";

  const requireConfig = () => {
    if (!origin) throw errorWithCode("INVALID_ARGUMENT", "baseUrl is required and must be http(s)");
    if (!username.trim()) throw errorWithCode("INVALID_ARGUMENT", "username is required");
    if (!password) throw errorWithCode("INVALID_ARGUMENT", "password is required");
  };

  const fetchMaf = async (path, init = {}) => {
    const url = `${origin}${apiPrefix}${path}`;
    try {
      if (insecureSkipTlsVerify) {
        return await requestWithNode(url, init, { timeoutMs, insecureSkipTlsVerify });
      }
      return await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    } catch (error) {
      throw errorWithCode("UNAVAILABLE", error?.cause?.message || error?.message || "fetch failed");
    }
  };

  const login = async () => {
    requireConfig();
    const res = await fetchMaf("/login", {
      method: "POST",
      headers: {
        "Device-Type": deviceType || "CSO",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ username, password: sha256Hex(password) }),
    });
    const json = await readJsonOrString(res);
    assertBusinessOk(json);
    authorization = json?.data?.authorization || "";
    if (!authorization) throw errorWithCode("UNAUTHENTICATED", "login response missing data.authorization");
    return authorization;
  };

  const request = async (path, init = {}, options = {}) => {
    requireConfig();
    if (!authorization) await login();
    const headers = {
      ...(init.headers ?? {}),
      Authorization: authorization,
      "Device-Type": deviceType,
      "auth-token": authToken,
    };
    const res = await fetchMaf(path, { ...init, headers });
    const json = await readJsonOrString(res);
    if (options.assertBusinessOk !== false) assertBusinessOk(json);
    return json;
  };

  const listSites = async (req = {}) => {
    const page = unwrapInt(req.page, 1) || 1;
    const pageSize = unwrapInt(firstField(req, ["page_size", "pageSize"]), 10) || 10;
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    const name = unwrapString(req.name).trim();
    if (name) params.set("name", name);
    const json = await request(`/protect/vs/find?${params.toString()}`, { method: "GET" });
    const data = json?.data && typeof json.data === "object" ? json.data : {};
    const list = Array.isArray(data.list) ? data.list : Array.isArray(json) ? json : [];
    return {
      sites: list.map(normalizeSite),
      total: unwrapInt(data.total, list.length),
      page: unwrapInt(data.page, page),
      page_size: unwrapInt(data.pageSize, pageSize),
      code: statusCode(json),
      message: statusMessage(json),
    };
  };

  const createSite = async (req = {}) => {
    const payload = buildSitePayload(req);
    const json = await request("/protect/vs/add", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }, { assertBusinessOk: false });
    const listed = await listSites({ name: payload.name, page: 1, page_size: 10 });
    if (!listed.sites.some((site) => site.name === payload.name)) {
      assertBusinessOk(json);
      throw errorWithCode("FAILED_PRECONDITION", `site ${payload.name} was accepted but not found after create`);
    }
    const message = statusOk(json)
      ? statusMessage(json)
      : `created and verified; upstream returned: ${statusMessage(json)}`;
    return { ok: true, code: statusCode(json), message };
  };

  const deleteSite = async (req = {}) => {
    const name = requireAnyNonEmptyString(req, ["name"]);
    let id = unwrapInt(req.id);
    if (!id) {
      const listed = await listSites({ name, page: 1, page_size: 20 });
      const found = listed.sites.find((site) => site.name === name);
      if (!found) throw errorWithCode("FAILED_PRECONDITION", `site ${name} not found`);
      id = found.id;
    }
    const json = await request("/protect/vs/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify([{ id, name }]),
    }, { assertBusinessOk: false });
    const listedAfterDelete = await listSites({ name, page: 1, page_size: 20 });
    if (listedAfterDelete.sites.some((site) => site.id === id || site.name === name)) {
      assertBusinessOk(json);
      throw errorWithCode("FAILED_PRECONDITION", `site ${name} still exists after delete`);
    }
    const message = statusOk(json)
      ? statusMessage(json)
      : `deleted and verified; upstream returned: ${statusMessage(json)}`;
    return { ok: true, code: statusCode(json), message };
  };

  const uploadCustomSensitiveWords = async (req = {}) => {
    const filename = unwrapString(req.filename).trim() || "octobus-sensitive-words.txt";
    const content = requireAnyNonEmptyString(req, ["content"]);
    const multipart = buildMultipart({ fieldName: "file", filename, content });
    const json = await request("/protect/tmpl/llm/customize/file", {
      method: "POST",
      headers: { "Content-Type": multipart.contentType },
      body: multipart.body,
    });
    const message = statusMessage(json);
    return {
      ok: true,
      code: statusCode(json),
      message,
      file_name: typeof json === "string" ? json : String(json?.data?.file_name ?? json?.file_name ?? message),
      origin_file_name: filename,
    };
  };

  return {
    [HEALTH_CHECK_PATH]: async () => ({ ok: Boolean(await login()), code: 0, message: "success" }),
    [CREATE_SITE_PATH]: async () => createSite(ctx.req),
    [DELETE_SITE_PATH]: async () => deleteSite(ctx.req),
    [LIST_SITES_PATH]: async () => listSites(ctx.req),
    [UPLOAD_SENSITIVE_WORDS_PATH]: async () => uploadCustomSensitiveWords(ctx.req),
  };
}

const mergeCtx = (baseCtx = {}, innerCtx = {}) => ({
  config: { ...(baseCtx.config ?? {}), ...(innerCtx.config ?? {}) },
  secret: { ...(baseCtx.secret ?? {}), ...(innerCtx.secret ?? {}) },
  bindings: { ...(baseCtx.bindings ?? {}), ...(innerCtx.bindings ?? {}) },
  limits: { ...(baseCtx.limits ?? {}), ...(innerCtx.limits ?? {}) },
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
  return rpcdef({ ...call.ctx, req: call.req })[methodPath]();
};

const registerHandlers = (ctx = {}) => ({
  [HEALTH_CHECK_PATH]: wrapLegacyHandler(ctx, HEALTH_CHECK_PATH),
  [CREATE_SITE_PATH]: wrapLegacyHandler(ctx, CREATE_SITE_PATH),
  [DELETE_SITE_PATH]: wrapLegacyHandler(ctx, DELETE_SITE_PATH),
  [LIST_SITES_PATH]: wrapLegacyHandler(ctx, LIST_SITES_PATH),
  [UPLOAD_SENSITIVE_WORDS_PATH]: wrapLegacyHandler(ctx, UPLOAD_SENSITIVE_WORDS_PATH),
});

export const METHOD_HEALTH_CHECK_FULL = "Venus_MAF.Venus_MAF/HealthCheck";
export const METHOD_CREATE_SITE_FULL = "Venus_MAF.Venus_MAF/CreateSite";
export const METHOD_DELETE_SITE_FULL = "Venus_MAF.Venus_MAF/DeleteSite";
export const METHOD_LIST_SITES_FULL = "Venus_MAF.Venus_MAF/ListSites";
export const METHOD_UPLOAD_SENSITIVE_WORDS_FULL = "Venus_MAF.Venus_MAF/UploadCustomSensitiveWords";

const sdkHandlers = registerHandlers({});

export const handlers = {
  [METHOD_HEALTH_CHECK_FULL]: (ctx) => sdkHandlers[HEALTH_CHECK_PATH](ctx),
  [METHOD_CREATE_SITE_FULL]: (ctx) => sdkHandlers[CREATE_SITE_PATH](ctx),
  [METHOD_DELETE_SITE_FULL]: (ctx) => sdkHandlers[DELETE_SITE_PATH](ctx),
  [METHOD_LIST_SITES_FULL]: (ctx) => sdkHandlers[LIST_SITES_PATH](ctx),
  [METHOD_UPLOAD_SENSITIVE_WORDS_FULL]: (ctx) => sdkHandlers[UPLOAD_SENSITIVE_WORDS_PATH](ctx),
};

export const _test = {
  buildSitePayload,
  buildMultipart,
  normalizeOrigin,
  normalizePrefix,
  sha256Hex,
};

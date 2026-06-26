import crypto from "node:crypto";
import https from "node:https";

const SERVICE_NAME = "tencent__lighthouse-firewall";
const API_SERVICE = "lighthouse";
const API_VERSION = "2020-03-24";
const DEFAULT_ENDPOINT = "https://lighthouse.tencentcloudapi.com";
const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_PROTOCOL = "TCP";
const DEFAULT_PORT = "ALL";
const DEFAULT_DESCRIPTION = "octobus-block-ip";

const ACTIONS = {
  listFirewallRules: "DescribeFirewallRules",
  createFirewallRules: "CreateFirewallRules",
  deleteFirewallRules: "DeleteFirewallRules",
  modifyFirewallRules: "ModifyFirewallRules",
  applyFirewallTemplate: "ApplyFirewallTemplate",
};

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj || {}, key);
const firstDefined = (...values) => values.find((value) => value !== undefined && value !== null);
const toTrimmedString = (value) => (value === undefined || value === null ? "" : String(value).trim());

const errorWithCode = (code, message, details) => {
  const err = new Error(message);
  err.code = code;
  if (details !== undefined) err.details = details;
  return err;
};

const parseOptionalNumber = (value) => {
  if (value === undefined || value === null || value === 0) return undefined;
  const num = Number(value);
  if (!Number.isInteger(num) || num < 0) return undefined;
  return num;
};


const normalizeArgs = (req = {}, ctx = {}) => {
  if (req && typeof req === "object" && hasOwn(req, "request")) {
    return { req: req.request || {}, ctx: req };
  }
  if (req && typeof req === "object" && hasOwn(req, "req")) {
    return { req: req.req || {}, ctx: req };
  }
  return { req: req || {}, ctx: ctx || {} };
};

const getConfig = (ctx = {}) => ctx.config || ctx.bindings || {};
const getSecret = (ctx = {}) => ctx.secret || ctx.secrets || {};

const resolveRegion = (req, ctx) => {
  const region = toTrimmedString(firstDefined(req.region, getConfig(ctx).region));
  if (!region) throw errorWithCode("FAILED_PRECONDITION", "region is required");
  return region;
};

const resolveCredential = (req, ctx) => {
  const credential = req.credential || {};
  const secret = getSecret(ctx);
  const secretId = toTrimmedString(firstDefined(credential.secret_id, credential.secretId, req.secret_id, req.secretId, secret.secretId, secret.secret_id));
  const secretKey = toTrimmedString(firstDefined(credential.secret_key, credential.secretKey, req.secret_key, req.secretKey, secret.secretKey, secret.secret_key));
  const token = toTrimmedString(firstDefined(credential.token, req.token, secret.token));
  if (!secretId) throw errorWithCode("FAILED_PRECONDITION", "secretId is required");
  if (!secretKey) throw errorWithCode("FAILED_PRECONDITION", "secretKey is required");
  return { secretId, secretKey, token };
};

const camelize = (key) => key.replace(/_([a-z])/g, (_, char) => char.toUpperCase());

const readField = (req, key) => firstDefined(req[key], req[camelize(key)]);

const requireString = (req, key) => {
  const value = toTrimmedString(readField(req, key));
  if (!value) throw errorWithCode("INVALID_ARGUMENT", `${key} is required`);
  return value;
};

const requireArray = (req, key) => {
  const value = readField(req, key);
  if (!Array.isArray(value) || value.length === 0) {
    throw errorWithCode("INVALID_ARGUMENT", `${key} must be a non-empty array`);
  }
  return value;
};

const normalizeRuleInput = (rule, index = 0) => {
  if (!rule || typeof rule !== "object") {
    throw errorWithCode("INVALID_ARGUMENT", `rules[${index}] must be an object`);
  }
  const protocol = toTrimmedString(firstDefined(rule.protocol, rule.Protocol));
  const port = toTrimmedString(firstDefined(rule.port, rule.Port));
  const cidrBlock = toTrimmedString(firstDefined(rule.cidr_block, rule.cidrBlock, rule.CidrBlock));
  const action = toTrimmedString(firstDefined(rule.action, rule.Action));
  if (!protocol) throw errorWithCode("INVALID_ARGUMENT", `rules[${index}].protocol is required`);
  if (!port) throw errorWithCode("INVALID_ARGUMENT", `rules[${index}].port is required`);
  if (!cidrBlock) throw errorWithCode("INVALID_ARGUMENT", `rules[${index}].cidr_block is required`);
  if (!action) throw errorWithCode("INVALID_ARGUMENT", `rules[${index}].action is required`);
  const output = {
    Protocol: protocol,
    Port: port,
    CidrBlock: cidrBlock,
    Action: action.toUpperCase(),
  };
  const description = toTrimmedString(firstDefined(rule.firewall_rule_description, rule.firewallRuleDescription, rule.FirewallRuleDescription));
  if (description) output.FirewallRuleDescription = description;
  return output;
};

const toProtoRuleInput = (rule) => ({
  protocol: rule.Protocol || "",
  port: rule.Port || "",
  cidr_block: rule.CidrBlock || "",
  action: rule.Action || "",
  firewall_rule_description: rule.FirewallRuleDescription || "",
});

const buildBlockRules = (req, action) => {
  const sourceIps = requireArray(req, "source_ips").map((ip, index) => {
    const value = toTrimmedString(ip);
    if (!value) throw errorWithCode("INVALID_ARGUMENT", `source_ips[${index}] must be non-empty`);
    return value;
  });
  const protocol = toTrimmedString(readField(req, "protocol")) || DEFAULT_PROTOCOL;
  const port = toTrimmedString(readField(req, "port")) || DEFAULT_PORT;
  const description = toTrimmedString(readField(req, "firewall_rule_description")) || DEFAULT_DESCRIPTION;
  return sourceIps.map((cidrBlock) => ({
    Protocol: protocol,
    Port: port,
    CidrBlock: cidrBlock,
    Action: action,
    FirewallRuleDescription: description,
  }));
};

const normalizeListRequest = (req) => {
  const body = { InstanceId: requireString(req, "instance_id") };
  const offset = parseOptionalNumber(readField(req, "offset"));
  const limit = parseOptionalNumber(readField(req, "limit"));
  if (offset !== undefined) body.Offset = offset;
  if (limit !== undefined) body.Limit = limit;
  return body;
};

const normalizeWriteRequest = (req) => ({
  InstanceId: requireString(req, "instance_id"),
  FirewallRules: requireArray(req, "rules").map(normalizeRuleInput),
});

const normalizeModifyRequest = (req) => ({
  InstanceId: requireString(req, "instance_id"),
  FirewallRules: requireArray(req, "rules").map((pair, index) => {
    if (!pair || typeof pair !== "object") throw errorWithCode("INVALID_ARGUMENT", `rules[${index}] must be an object`);
    return {
      FirewallRule: normalizeRuleInput(pair.firewall_rule || pair.firewallRule || pair.FirewallRule, index),
      NewFirewallRule: normalizeRuleInput(pair.new_firewall_rule || pair.newFirewallRule || pair.NewFirewallRule, index),
    };
  }),
});

const normalizeApplyTemplateRequest = (req) => ({
  TemplateId: requireString(req, "template_id"),
  InstanceIds: requireArray(req, "instance_ids").map((id, index) => {
    const value = toTrimmedString(id);
    if (!value) throw errorWithCode("INVALID_ARGUMENT", `instance_ids[${index}] must be non-empty`);
    return value;
  }),
});

const sha256Hex = (value) => crypto.createHash("sha256").update(value, "utf8").digest("hex");
const hmac = (key, value, encoding) => crypto.createHmac("sha256", key).update(value, "utf8").digest(encoding);

const formatDate = (timestamp) => new Date(timestamp * 1000).toISOString().slice(0, 10);

const signRequest = ({ endpoint, action, region, body, credential, timestamp }) => {
  const url = new URL(endpoint);
  const host = url.host;
  const payload = JSON.stringify(body || {});
  const hashedPayload = sha256Hex(payload);
  const canonicalHeaders = `content-type:application/json; charset=utf-8\nhost:${host}\nx-tc-action:${action.toLowerCase()}\n`;
  const signedHeaders = "content-type;host;x-tc-action";
  const canonicalRequest = ["POST", url.pathname || "/", "", canonicalHeaders, signedHeaders, hashedPayload].join("\n");
  const date = formatDate(timestamp);
  const credentialScope = `${date}/${API_SERVICE}/tc3_request`;
  const stringToSign = ["TC3-HMAC-SHA256", String(timestamp), credentialScope, sha256Hex(canonicalRequest)].join("\n");
  const secretDate = hmac(`TC3${credential.secretKey}`, date);
  const secretService = hmac(secretDate, API_SERVICE);
  const secretSigning = hmac(secretService, "tc3_request");
  const signature = hmac(secretSigning, stringToSign, "hex");
  const authorization = `TC3-HMAC-SHA256 Credential=${credential.secretId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  const headers = {
    Authorization: authorization,
    "Content-Type": "application/json; charset=utf-8",
    Host: host,
    "X-TC-Action": action,
    "X-TC-Version": API_VERSION,
    "X-TC-Region": region,
    "X-TC-Timestamp": String(timestamp),
  };
  if (credential.token) headers["X-TC-Token"] = credential.token;
  return { payload, headers };
};

const mapTencentError = (err) => {
  const code = String(err?.Code || err?.code || "");
  const message = String(err?.Message || err?.message || code || "Tencent Cloud API error");
  if (code.startsWith("AuthFailure") || code.startsWith("UnauthorizedOperation")) {
    return errorWithCode("PERMISSION_DENIED", message, { tencent_code: code });
  }
  if (code.startsWith("InvalidParameter") || code.startsWith("MissingParameter") || code.startsWith("UnsupportedOperation")) {
    return errorWithCode("INVALID_ARGUMENT", message, { tencent_code: code });
  }
  if (code.startsWith("ResourceNotFound") || code.startsWith("FailedOperation")) {
    return errorWithCode("FAILED_PRECONDITION", message, { tencent_code: code });
  }
  if (code.startsWith("InternalError") || code.startsWith("RequestLimitExceeded")) {
    return errorWithCode("UNAVAILABLE", message, { tencent_code: code });
  }
  return errorWithCode("UNKNOWN", message, { tencent_code: code });
};

const callTencent = async (ctx, req, action, body) => {
  const config = getConfig(ctx);
  const endpoint = toTrimmedString(config.endpoint) || DEFAULT_ENDPOINT;
  const region = resolveRegion(req, ctx);
  const credential = resolveCredential(req, ctx);
  const timeoutMs = Number(config.timeoutMs || DEFAULT_TIMEOUT_MS);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs > 0 ? timeoutMs : DEFAULT_TIMEOUT_MS);
  const agent = endpoint.startsWith("https:") && config.skipTlsVerify === true ? new https.Agent({ rejectUnauthorized: false }) : undefined;
  const { payload, headers } = signRequest({ endpoint, action, region, body, credential, timestamp: Math.floor(Date.now() / 1000) });
  try {
    const response = await fetch(endpoint, { method: "POST", headers, body: payload, signal: controller.signal, agent });
    const text = await response.text();
    let parsed;
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch {
      throw errorWithCode("UNKNOWN", "Tencent Cloud returned non-JSON response");
    }
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) throw errorWithCode("PERMISSION_DENIED", `Tencent Cloud HTTP ${response.status}`);
      if (response.status >= 500) throw errorWithCode("UNAVAILABLE", `Tencent Cloud HTTP ${response.status}`);
      throw errorWithCode("FAILED_PRECONDITION", `Tencent Cloud HTTP ${response.status}`);
    }
    const apiResponse = parsed.Response || parsed.response || parsed;
    if (apiResponse.Error || apiResponse.error) throw mapTencentError(apiResponse.Error || apiResponse.error);
    return apiResponse;
  } catch (err) {
    if (err.name === "AbortError") throw errorWithCode("UNAVAILABLE", "Tencent Cloud API request timed out");
    if (err.code) throw err;
    throw errorWithCode("UNAVAILABLE", err.message || "Tencent Cloud API request failed");
  } finally {
    clearTimeout(timer);
  }
};

const mapFirewallRule = (rule = {}) => ({
  app_type: String(rule.AppType || rule.appType || ""),
  protocol: String(rule.Protocol || rule.protocol || ""),
  port: String(rule.Port || rule.port || ""),
  cidr_block: String(rule.CidrBlock || rule.cidrBlock || ""),
  action: String(rule.Action || rule.action || ""),
  firewall_rule_description: String(rule.FirewallRuleDescription || rule.firewallRuleDescription || ""),
  raw_json: JSON.stringify(rule),
});

const methodHandlers = {
  async ListFirewallRules(input = {}, callCtx = {}) {
    const { req, ctx } = normalizeArgs(input, callCtx);
    const response = await callTencent(ctx, req, ACTIONS.listFirewallRules, normalizeListRequest(req));
    return {
      total_count: Number(response.TotalCount || 0),
      rules: Array.isArray(response.FirewallRuleSet) ? response.FirewallRuleSet.map(mapFirewallRule) : [],
      request_id: String(response.RequestId || ""),
      raw_json: JSON.stringify(response),
    };
  },

  async CreateFirewallRules(input = {}, callCtx = {}) {
    const { req, ctx } = normalizeArgs(input, callCtx);
    const response = await callTencent(ctx, req, ACTIONS.createFirewallRules, normalizeWriteRequest(req));
    return { request_id: String(response.RequestId || ""), raw_json: JSON.stringify(response) };
  },

  async DeleteFirewallRules(input = {}, callCtx = {}) {
    const { req, ctx } = normalizeArgs(input, callCtx);
    const response = await callTencent(ctx, req, ACTIONS.deleteFirewallRules, normalizeWriteRequest(req));
    return { request_id: String(response.RequestId || ""), raw_json: JSON.stringify(response) };
  },

  async ModifyFirewallRules(input = {}, callCtx = {}) {
    const { req, ctx } = normalizeArgs(input, callCtx);
    const response = await callTencent(ctx, req, ACTIONS.modifyFirewallRules, normalizeModifyRequest(req));
    return { request_id: String(response.RequestId || ""), raw_json: JSON.stringify(response) };
  },

  async ApplyFirewallTemplate(input = {}, callCtx = {}) {
    const { req, ctx } = normalizeArgs(input, callCtx);
    const response = await callTencent(ctx, req, ACTIONS.applyFirewallTemplate, normalizeApplyTemplateRequest(req));
    return { request_id: String(response.RequestId || ""), raw_json: JSON.stringify(response) };
  },

  async BlockIP(input = {}, callCtx = {}) {
    const { req, ctx } = normalizeArgs(input, callCtx);
    const rules = buildBlockRules(req, "DROP");
    const response = await callTencent(ctx, req, ACTIONS.createFirewallRules, {
      InstanceId: requireString(req, "instance_id"),
      FirewallRules: rules,
    });
    return { created_rules: rules.map(toProtoRuleInput), request_id: String(response.RequestId || ""), raw_json: JSON.stringify(response) };
  },

  async UnblockIP(input = {}, callCtx = {}) {
    const { req, ctx } = normalizeArgs(input, callCtx);
    const rules = buildBlockRules(req, "DROP");
    const response = await callTencent(ctx, req, ACTIONS.deleteFirewallRules, {
      InstanceId: requireString(req, "instance_id"),
      FirewallRules: rules,
    });
    return { deleted_rules: rules.map(toProtoRuleInput), request_id: String(response.RequestId || ""), raw_json: JSON.stringify(response) };
  },
};


const SERVICE_FULL_NAME = "Tencent_Lighthouse_FIREWALL.Tencent_Lighthouse_FIREWALL";

export const handlers = Object.fromEntries(
  Object.entries(methodHandlers).flatMap(([name, handler]) => [
    [name, handler],
    [`/${SERVICE_FULL_NAME}/${name}`, handler],
    [`${SERVICE_FULL_NAME}/${name}`, handler],
  ]),
);

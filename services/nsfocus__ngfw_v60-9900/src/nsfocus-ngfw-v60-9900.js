import crypto from "node:crypto";

import { GrpcError, grpcStatus } from "@chaitin-ai/octobus-sdk";
import { Client as SSHClient } from "ssh2";

export const METHOD_GET_SYSTEM_STATUS = "nsfocus.ngfw.v60_9900.NSFOCUSNGFWService/GetSystemStatus";
export const METHOD_LIST_SECURITY_LOGS = "nsfocus.ngfw.v60_9900.NSFOCUSNGFWService/ListSecurityLogs";
export const METHOD_LIST_SECURITY_POLICIES = "nsfocus.ngfw.v60_9900.NSFOCUSNGFWService/ListSecurityPolicies";
export const METHOD_LIST_SECURITY_POLICY_ADDRESS_OBJECTS = "nsfocus.ngfw.v60_9900.NSFOCUSNGFWService/ListSecurityPolicyAddressObjects";
export const METHOD_CREATE_NODE_OBJECT = "nsfocus.ngfw.v60_9900.NSFOCUSNGFWService/CreateNodeObject";
export const METHOD_DELETE_NODE_OBJECT = "nsfocus.ngfw.v60_9900.NSFOCUSNGFWService/DeleteNodeObject";
export const METHOD_BLOCK_IP = "nsfocus.ngfw.v60_9900.NSFOCUSNGFWService/BlockIP";
export const METHOD_UNBLOCK_IP = "nsfocus.ngfw.v60_9900.NSFOCUSNGFWService/UnblockIP";
export const METHOD_CREATE_IPV6_ADDRESS_GROUP = "nsfocus.ngfw.v60_9900.NSFOCUSNGFWService/CreateIPv6AddressGroup";
export const METHOD_DELETE_IPV6_ADDRESS_GROUP = "nsfocus.ngfw.v60_9900.NSFOCUSNGFWService/DeleteIPv6AddressGroup";
export const METHOD_ADD_IPV6_TO_GROUP = "nsfocus.ngfw.v60_9900.NSFOCUSNGFWService/AddIPv6ToGroup";
export const METHOD_REMOVE_IPV6_FROM_GROUP = "nsfocus.ngfw.v60_9900.NSFOCUSNGFWService/RemoveIPv6FromGroup";

const DEFAULT_TIMEOUT_MS = 20000;
const NETCONF_EOM = "]]>]]>";
const MAX_BLOCK_IPS = 10;

const grpcCodeFor = (code) => ({
  INVALID_ARGUMENT: grpcStatus.INVALID_ARGUMENT,
  UNAUTHENTICATED: grpcStatus.UNAUTHENTICATED,
  PERMISSION_DENIED: grpcStatus.PERMISSION_DENIED,
  NOT_FOUND: grpcStatus.NOT_FOUND,
  UNAVAILABLE: grpcStatus.UNAVAILABLE,
  UNKNOWN: grpcStatus.UNKNOWN,
})[code] ?? grpcStatus.UNKNOWN;

const errorWithCode = (code, message) => {
  const err = new GrpcError(grpcCodeFor(code), `${code}: ${message}`);
  err.legacyCode = code;
  return err;
};

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj ?? {}, key);
const firstDefined = (...values) => values.find((value) => value !== undefined && value !== null);

const coerceString = (value) => {
  if (value === undefined || value === null) return "";
  if (typeof value === "object" && hasOwn(value, "value")) return coerceString(value.value);
  return String(value);
};

const mergedBindings = (ctx = {}) => ({
  ...(ctx.config ?? {}),
  ...(ctx.secret ?? {}),
  ...(ctx.bindings ?? {}),
});

const resolveCallContext = (ctx = {}) => ({
  req: ctx.request ?? ctx.req ?? {},
  bindings: mergedBindings(ctx),
});

const normalizeList = (value) => {
  if (value === undefined || value === null) return [];
  if (Array.isArray(value)) return value;
  if (typeof value === "object" && hasOwn(value, "values")) return normalizeList(value.values);
  const text = coerceString(value).trim();
  if (!text) return [];
  return text.split(",").map((item) => item.trim()).filter(Boolean);
};

const toValue = (val) => {
  if (val === undefined || val === null) return { nullValue: "NULL_VALUE" };
  if (typeof val === "string") return { stringValue: val };
  if (typeof val === "number") return { numberValue: val };
  if (typeof val === "boolean") return { boolValue: val };
  if (Array.isArray(val)) return { listValue: { values: val.map((item) => toValue(item)) } };
  if (typeof val === "object") {
    const fields = {};
    for (const [key, value] of Object.entries(val)) fields[key] = toValue(value);
    return { structValue: { fields } };
  }
  return { stringValue: String(val) };
};

const toStruct = (val) => {
  if (!val || typeof val !== "object" || Array.isArray(val)) return { fields: {} };
  return toValue(val).structValue ?? { fields: {} };
};

const normalizeNetconfHost = (value) => coerceString(value).trim().replace(/^https?:\/\//i, "").replace(/\/.*$/, "");

const escapeXml = (value) => coerceString(value)
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;")
  .replace(/'/g, "&apos;");

const extractTag = (xml, tag) => {
  const match = coerceString(xml).match(new RegExp(`<${tag}(?:\\s[^>/]*)?>([\\s\\S]*?)</${tag}>`));
  return match ? match[1].replace(/<[^>]+>/g, "").trim() : "";
};

const extractBlocks = (xml, tag) => {
  const blocks = [];
  const re = new RegExp(`<${tag}(?:\\s[^>/]*)?>([\\s\\S]*?)</${tag}>`, "g");
  let match;
  while ((match = re.exec(coerceString(xml)))) blocks.push(match[0]);
  return blocks;
};

const firstTag = (xml, tags) => {
  for (const tag of tags) {
    const value = extractTag(xml, tag);
    if (value) return value;
  }
  return "";
};

const blockToStruct = (xml, fields) => {
  const item = {};
  for (const [key, tags] of Object.entries(fields)) item[key] = firstTag(xml, Array.isArray(tags) ? tags : [tags]);
  item.raw_xml = coerceString(xml);
  return toStruct(item);
};

const ipObjectId = (ip) => {
  const digits = coerceString(ip).replace(/\D/g, "");
  return (digits.length <= 9 ? digits : digits.slice(-9)) || crypto.createHash("md5").update(coerceString(ip)).digest("hex").slice(0, 9);
};

const ipv6ObjectId = (ip) => crypto.createHash("md5").update(coerceString(ip)).digest("hex").slice(0, 9);

const okMutation = (raw, name = "") => ({
  status: /<ok\b/i.test(coerceString(raw)) ? "success" : "",
  err_msg: /<ok\b/i.test(coerceString(raw)) ? "" : "NETCONF reply did not include ok",
  err_code: /<ok\b/i.test(coerceString(raw)) ? 0 : 1,
  id: "",
  name,
  raw: toValue({ xml: coerceString(raw) }),
});

class NSFOCUSNetconfClient {
  constructor(bindings) {
    this.host = normalizeNetconfHost(firstDefined(bindings.host, bindings.endpoint, bindings.baseUrl));
    if (!this.host) throw errorWithCode("INVALID_ARGUMENT", "host is required");
    this.port = Number(firstDefined(bindings.port, bindings.netconfPort, bindings.netconf_port, 830)) || 830;
    this.username = coerceString(firstDefined(bindings.username, bindings.user)).trim();
    this.password = coerceString(bindings.password);
    if (!this.username) throw errorWithCode("UNAUTHENTICATED", "secret.username is required");
    if (!this.password) throw errorWithCode("UNAUTHENTICATED", "secret.password is required");
    this.timeoutMs = Number(firstDefined(bindings.timeoutMs, bindings.timeout_ms, DEFAULT_TIMEOUT_MS)) || DEFAULT_TIMEOUT_MS;
  }

  rpc(body) {
    const hello = `<?xml version="1.0" encoding="UTF-8"?><hello xmlns="urn:ietf:params:xml:ns:netconf:base:1.0"><capabilities><capability>urn:ietf:params:netconf:base:1.0</capability></capabilities></hello>${NETCONF_EOM}`;
    return `${hello}${body}${NETCONF_EOM}`;
  }

  async request(body) {
    return new Promise((resolve, reject) => {
      const conn = new SSHClient();
      let streamRef;
      let data = "";
      let settled = false;
      const done = (err, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try { streamRef?.end(); } catch {}
        conn.end();
        if (err) reject(err);
        else resolve(value);
      };
      const timer = setTimeout(() => done(errorWithCode("UNAVAILABLE", "NETCONF request timed out")), this.timeoutMs);
      conn.on("ready", () => {
        conn.subsys("netconf", (err, stream) => {
          if (err) return done(errorWithCode("UNAVAILABLE", err.message || "failed to open netconf subsystem"));
          streamRef = stream;
          stream.setEncoding("utf8");
          stream.on("data", (chunk) => {
            data += chunk;
            if (data.includes("</rpc-reply>") && data.includes(NETCONF_EOM)) done(null, data);
          });
          stream.on("error", (streamErr) => done(errorWithCode("UNAVAILABLE", streamErr.message || "NETCONF stream error")));
          stream.write(this.rpc(body));
        });
      });
      conn.on("error", (err) => done(errorWithCode("UNAVAILABLE", err.message || "NETCONF connection error")));
      conn.connect({
        host: this.host,
        port: this.port,
        username: this.username,
        password: this.password,
        readyTimeout: this.timeoutMs,
        algorithms: {
          serverHostKey: ["ssh-rsa", "rsa-sha2-512", "rsa-sha2-256"],
        },
      });
    });
  }

  getDevice() {
    return this.request("<rpc message-id=\"101\" xmlns=\"urn:ietf:params:xml:ns:netconf:base:1.0\"><get><filter type=\"subtree\"><top xmlns=\"http://www.nsfocus.com.cn/netconf/data:1.0\"><Device/></top></filter></get></rpc>");
  }

  getSubtree(featureXml, messageId = "101") {
    return this.request(`<rpc message-id=\"${messageId}\" xmlns=\"urn:ietf:params:xml:ns:netconf:base:1.0\"><get><filter type=\"subtree\"><top xmlns=\"http://www.nsfocus.com.cn/netconf/data:1.0\">${featureXml}</top></filter></get></rpc>`);
  }

  editConfig(config, messageId = "201") {
    return this.request(`<rpc message-id=\"${messageId}\" xmlns=\"urn:ietf:params:xml:ns:netconf:base:1.0\"><edit-config><target><running/></target>${config}</edit-config></rpc>`);
  }
}

const buildNetconfClient = (ctx) => new NSFOCUSNetconfClient(resolveCallContext(ctx).bindings);

const requireString = (req, keys, label) => {
  for (const key of keys) {
    if (!hasOwn(req, key)) continue;
    const value = coerceString(req[key]).trim();
    if (value) return value;
  }
  throw errorWithCode("INVALID_ARGUMENT", `${label} is required`);
};

const optionalString = (req, keys, fallback = "") => {
  for (const key of keys) {
    if (!hasOwn(req, key)) continue;
    const value = coerceString(req[key]).trim();
    if (value) return value;
  }
  return fallback;
};

const groupConfig = (name, operation = "create") => `<config xmlns=\"urn:ietf:params:xml:ns:netconf:base:1.0\" xmlns:web=\"urn:ietf:params:xml:ns:netconf:base:1.0\"><top xmlns=\"http://www.nsfocus.com.cn/netconf/config:1.0\" web:operation=\"${operation === "remove" ? "replace" : "create"}\"><OMS><IPv4Groups${operation === "remove" ? " web:operation=\"remove\"" : ""}><Group><Name>${escapeXml(name)}</Name>${operation === "remove" ? "" : `<Description>octobus address group ${escapeXml(name)}</Description>`}</Group></IPv4Groups></OMS></top></config>`;

const ipConfig = (groupName, ip, operation = "create") => `<config xmlns=\"urn:ietf:params:xml:ns:netconf:base:1.0\" xmlns:web=\"urn:ietf:params:xml:ns:netconf:base:1.0\"><top xmlns=\"http://www.nsfocus.com.cn/netconf/config:1.0\" web:operation=\"replace\"><OMS><IPv4Objs web:operation=\"${operation}\"><Obj><Group>${escapeXml(groupName)}</Group><ID>${ipObjectId(ip)}</ID>${operation === "remove" ? "" : `<Type>3</Type><HostIPv4Address>${escapeXml(ip)}</HostIPv4Address>`}</Obj></IPv4Objs></OMS></top></config>`;

const ipv6GroupConfig = (name, operation = "create") => `<config xmlns=\"urn:ietf:params:xml:ns:netconf:base:1.0\" xmlns:web=\"urn:ietf:params:xml:ns:netconf:base:1.0\"><top xmlns=\"http://www.nsfocus.com.cn/netconf/config:1.0\" web:operation=\"${operation === "remove" ? "replace" : "create"}\"><OMS><IPv6Groups${operation === "remove" ? " web:operation=\"remove\"" : ""}><Group><Name>${escapeXml(name)}</Name>${operation === "remove" ? "" : `<Description>octobus ipv6 address group ${escapeXml(name)}</Description>`}</Group></IPv6Groups></OMS></top></config>`;

const ipv6Config = (groupName, ip, operation = "create") => `<config xmlns=\"urn:ietf:params:xml:ns:netconf:base:1.0\" xmlns:web=\"urn:ietf:params:xml:ns:netconf:base:1.0\"><top xmlns=\"http://www.nsfocus.com.cn/netconf/config:1.0\" web:operation=\"replace\"><OMS><IPv6Objs web:operation=\"${operation}\"><Obj><Group>${escapeXml(groupName)}</Group><ID>${ipv6ObjectId(ip)}</ID>${operation === "remove" ? "" : `<Type>3</Type><HostIPv6Address>${escapeXml(ip)}</HostIPv6Address>`}</Obj></IPv6Objs></OMS></top></config>`;

const getSystemStatus = async (ctx) => {
  const xml = await buildNetconfClient(ctx).getDevice();
  return {
    product_ver: extractTag(xml, "SoftwareVersion") || extractTag(xml, "SystemSoftwareVersion") || extractTag(xml, "HostDescription") || extractTag(xml, "SoftwareRev"),
    engine: "netconf",
    device_hash: "",
    device_type: extractTag(xml, "DeviceModel") || extractTag(xml, "Model") || extractTag(xml, "DeviceType") || extractTag(xml, "HostName"),
    license: "",
    cpu_usage: Number(extractTag(xml, "CPUUsage")) || 0,
    mem_usage: Number(extractTag(xml, "MemoryUsage")) || 0,
    raw: toStruct({ xml }),
  };
};

const listSecurityLogs = async (ctx) => {
  const xml = await buildNetconfClient(ctx).getSubtree("<Syslog><Logs/></Syslog>", "301");
  const logs = extractBlocks(xml, "Log").map((block) => blockToStruct(block, {
    index: "Index",
    time: "Time",
    group: "Group",
    digest: "Digest",
    severity: "Severity",
    content: "Content",
  }));
  return { logs, raw: toStruct({ xml }) };
};

const normalizeIpVersion = (value) => {
  const text = coerceString(value).trim().toLowerCase();
  if (["6", "ipv6", "v6"].includes(text)) return "6";
  return "4";
};

const listSecurityPolicies = async (ctx) => {
  const { req } = resolveCallContext(ctx);
  const ipVersion = normalizeIpVersion(firstDefined(req.ip_version, req.ipVersion));
  const table = ipVersion === "6" ? "IPv6Rules" : "IPv4Rules";
  const xml = await buildNetconfClient(ctx).getSubtree(`<SecurityPolicies><${table}/></SecurityPolicies>`, ipVersion === "6" ? "312" : "311");
  const policies = extractBlocks(xml, "Rule").map((block) => blockToStruct(block, {
    id: "ID",
    name: "RuleName",
    action: "Action",
    vrf: "VRF",
    time_range: "TimeRange",
    time_range_state: "TimeRangeState",
    enable: "Enable",
    log: "Log",
    counting: "Counting",
    comment: "Comment",
    count: "Count",
    byte: "Byte",
    profile: "Profile",
    rule_group_name: "RuleGroupName",
  }));
  return { policies, raw: toStruct({ ip_version: ipVersion, xml }) };
};

const maybeFilterRuleId = (items, ruleId) => {
  if (!ruleId) return items;
  return items.filter((item) => item.fields?.rule_id?.stringValue === ruleId);
};

const parseAddressObjectBlocks = (xml, direction, rowTag) => extractBlocks(xml, rowTag).map((block) => {
  const item = {
    rule_id: extractTag(block, "ID"),
    seq_num: extractTag(block, "SeqNum"),
    is_increment: extractTag(block, "IsIncrement"),
    name: extractTag(block, "NameItem"),
    direction,
    raw_xml: block,
  };
  return toStruct(item);
});

const listSecurityPolicyAddressObjects = async (ctx) => {
  const { req } = resolveCallContext(ctx);
  const ipVersion = normalizeIpVersion(firstDefined(req.ip_version, req.ipVersion));
  const srcTable = ipVersion === "6" ? "IPv6SrcAddr" : "IPv4SrcAddr";
  const destTable = ipVersion === "6" ? "IPv6DestAddr" : "IPv4DestAddr";
  const client = buildNetconfClient(ctx);
  const srcXml = await client.getSubtree(`<SecurityPolicies><${srcTable}/></SecurityPolicies>`, ipVersion === "6" ? "322" : "321");
  const destXml = await client.getSubtree(`<SecurityPolicies><${destTable}/></SecurityPolicies>`, ipVersion === "6" ? "324" : "323");
  const ruleId = coerceString(firstDefined(req.rule_id, req.ruleId)).trim();
  const objects = maybeFilterRuleId([
    ...parseAddressObjectBlocks(srcXml, "source", "SrcAddr"),
    ...parseAddressObjectBlocks(destXml, "destination", "DestAddr"),
  ], ruleId);
  return { objects, raw: toStruct({ ip_version: ipVersion, src_xml: srcXml, dest_xml: destXml }) };
};

const createNodeObject = async (ctx) => {
  const { req } = resolveCallContext(ctx);
  const name = requireString(req, ["name", "group", "book_name", "bookName"], "name");
  return okMutation(await buildNetconfClient(ctx).editConfig(groupConfig(name), "201"), name);
};

const deleteNodeObject = async (ctx) => {
  const { req } = resolveCallContext(ctx);
  const name = requireString(req, ["id", "name", "group", "book_name", "bookName"], "id");
  return okMutation(await buildNetconfClient(ctx).editConfig(groupConfig(name, "remove"), "202"), name);
};

const blockIP = async (ctx) => {
  const { req } = resolveCallContext(ctx);
  const ips = normalizeList(firstDefined(req.ips, req.ip)).map((ip) => coerceString(ip).trim()).filter(Boolean);
  if (ips.length === 0) throw errorWithCode("INVALID_ARGUMENT", "ips is required");
  if (ips.length > MAX_BLOCK_IPS) throw errorWithCode("INVALID_ARGUMENT", `ips supports at most ${MAX_BLOCK_IPS} items`);
  const groupName = optionalString(req, ["policy_name", "policyName", "group", "book_name", "bookName"], "octobus_block_1");
  const client = buildNetconfClient(ctx);
  const groupResult = okMutation(await client.editConfig(groupConfig(groupName), "210"), groupName);
  const nodeResults = [];
  for (const ip of ips) {
    nodeResults.push(okMutation(await client.editConfig(ipConfig(groupName, ip), "211"), ip));
  }
  return { node_results: nodeResults, policy_result: groupResult };
};

const unblockIP = async (ctx) => {
  const { req } = resolveCallContext(ctx);
  const groupName = requireString(req, ["policy_id", "policyId", "group", "book_name", "bookName"], "policy_id");
  const ips = normalizeList(firstDefined(req.node_ids, req.nodeIds, req.ips, req.ip)).map((ip) => coerceString(ip).trim()).filter(Boolean);
  if (ips.length === 0) throw errorWithCode("INVALID_ARGUMENT", "node_ids/ips is required");
  const client = buildNetconfClient(ctx);
  const nodeResults = [];
  for (const ip of ips) {
    nodeResults.push(okMutation(await client.editConfig(ipConfig(groupName, ip, "remove"), "220"), ip));
  }
  return { policy_result: okMutation("<ok/>", groupName), node_results: nodeResults };
};

const createIPv6AddressGroup = async (ctx) => {
  const { req } = resolveCallContext(ctx);
  const name = requireString(req, ["name", "group", "book_name", "bookName"], "name");
  return okMutation(await buildNetconfClient(ctx).editConfig(ipv6GroupConfig(name), "401"), name);
};

const deleteIPv6AddressGroup = async (ctx) => {
  const { req } = resolveCallContext(ctx);
  const name = requireString(req, ["id", "name", "group", "book_name", "bookName"], "id");
  return okMutation(await buildNetconfClient(ctx).editConfig(ipv6GroupConfig(name, "remove"), "402"), name);
};

const addIPv6ToGroup = async (ctx) => {
  const { req } = resolveCallContext(ctx);
  const groupName = requireString(req, ["group", "policy_name", "policyName", "book_name", "bookName"], "group");
  const ips = normalizeList(firstDefined(req.ips, req.ip)).map((ip) => coerceString(ip).trim()).filter(Boolean);
  if (ips.length === 0) throw errorWithCode("INVALID_ARGUMENT", "ips is required");
  if (ips.length > MAX_BLOCK_IPS) throw errorWithCode("INVALID_ARGUMENT", `ips supports at most ${MAX_BLOCK_IPS} items`);
  const client = buildNetconfClient(ctx);
  const groupResult = okMutation(await client.editConfig(ipv6GroupConfig(groupName), "410"), groupName);
  const nodeResults = [];
  for (const ip of ips) nodeResults.push(okMutation(await client.editConfig(ipv6Config(groupName, ip), "411"), ip));
  return { node_results: nodeResults, policy_result: groupResult };
};

const removeIPv6FromGroup = async (ctx) => {
  const { req } = resolveCallContext(ctx);
  const groupName = requireString(req, ["group", "policy_id", "policyId", "book_name", "bookName"], "group");
  const ips = normalizeList(firstDefined(req.ips, req.ip, req.node_ids, req.nodeIds)).map((ip) => coerceString(ip).trim()).filter(Boolean);
  if (ips.length === 0) throw errorWithCode("INVALID_ARGUMENT", "ips is required");
  const client = buildNetconfClient(ctx);
  const nodeResults = [];
  for (const ip of ips) nodeResults.push(okMutation(await client.editConfig(ipv6Config(groupName, ip, "remove"), "420"), ip));
  return { policy_result: okMutation("<ok/>", groupName), node_results: nodeResults };
};

export const handlers = {
  [METHOD_GET_SYSTEM_STATUS]: getSystemStatus,
  [METHOD_LIST_SECURITY_LOGS]: listSecurityLogs,
  [METHOD_LIST_SECURITY_POLICIES]: listSecurityPolicies,
  [METHOD_LIST_SECURITY_POLICY_ADDRESS_OBJECTS]: listSecurityPolicyAddressObjects,
  [METHOD_CREATE_NODE_OBJECT]: createNodeObject,
  [METHOD_DELETE_NODE_OBJECT]: deleteNodeObject,
  [METHOD_BLOCK_IP]: blockIP,
  [METHOD_UNBLOCK_IP]: unblockIP,
  [METHOD_CREATE_IPV6_ADDRESS_GROUP]: createIPv6AddressGroup,
  [METHOD_DELETE_IPV6_ADDRESS_GROUP]: deleteIPv6AddressGroup,
  [METHOD_ADD_IPV6_TO_GROUP]: addIPv6ToGroup,
  [METHOD_REMOVE_IPV6_FROM_GROUP]: removeIPv6FromGroup,
};

export const _test = {
  NSFOCUSNetconfClient,
  errorWithCode,
  escapeXml,
  extractTag,
  extractBlocks,
  ipv6Config,
  ipv6GroupConfig,
  ipv6ObjectId,
  groupConfig,
  ipConfig,
  ipObjectId,
  okMutation,
  toStruct,
  toValue,
};

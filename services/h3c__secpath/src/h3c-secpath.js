import { GrpcError, grpcStatus } from "@chaitin-ai/octobus-sdk";
import { Agent, fetch as undiciFetch } from "undici";

const SERVICE = "H3C_SECPATH.H3C_SECPATH";
const method = (name) => `${SERVICE}/${name}`;
export const METHODS = Object.freeze({
  GetDeviceBase: method("GetDeviceBase"), GetSecurityZones: method("GetSecurityZones"),
  GetZonePairs: method("GetZonePairs"), GetIPv4SecurityPolicies: method("GetIPv4SecurityPolicies"),
  GetIPv4ObjectGroups: method("GetIPv4ObjectGroups"), GetServiceGroups: method("GetServiceGroups"),
  GetSessions: method("GetSessions"), GetInterfaces: method("GetInterfaces"),
  GetACLGroups: method("GetACLGroups"), GetNATStaticMappings: method("GetNATStaticMappings"),
});

const API_PATHS = Object.freeze({
  GetDeviceBase: "/restconf/data/comware-device:Device/Base",
  GetSecurityZones: "/restconf/data/comware-securityzone:SecurityZone/Zones",
  GetZonePairs: "/restconf/data/comware-securityzone:SecurityZone/ZonePairs",
  GetIPv4SecurityPolicies: "/restconf/data/comware-securitypolicies:SecurityPolicies/IPv4Rules",
  GetIPv4ObjectGroups: "/restconf/data/comware-oms:OMS/IPv4Groups",
  GetServiceGroups: "/restconf/data/comware-oms:OMS/ServGroups",
  GetSessions: "/restconf/data/comware-session:SESSION/Sessions",
  GetInterfaces: "/restconf/data/comware-ifmgr:Ifmgr/Interfaces",
  GetACLGroups: "/restconf/data/comware-acl:ACL/Groups",
  GetNATStaticMappings: "/restconf/data/comware-nat:NAT/Static/StaticMappings",
});

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 1024 * 1024;
let insecureDispatcher;
const own = (obj, key) => Object.prototype.hasOwnProperty.call(obj ?? {}, key);
const unwrap = (value) => value && typeof value === "object" && own(value, "value") ? value.value : value;
const fail = (code, message) => new GrpcError(grpcStatus[code] ?? grpcStatus.UNKNOWN, message);
const trim = (value) => String(unwrap(value) ?? "").trim();
const asBool = (value, fallback = false) => {
  const raw = unwrap(value);
  if (raw === undefined || raw === null || raw === "") return fallback;
  if (typeof raw === "boolean") return raw;
  if (typeof raw === "number") return raw !== 0;
  if (["true", "1", "yes", "on"].includes(trim(raw).toLowerCase())) return true;
  if (["false", "0", "no", "off"].includes(trim(raw).toLowerCase())) return false;
  return fallback;
};
const asInt = (value, fallback) => {
  const parsed = Number(unwrap(value));
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
};
const normalizeBaseUrl = (value) => {
  try {
    const url = new URL(trim(value));
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) return "";
    return url.toString().replace(/\/+$/, "");
  } catch { return ""; }
};
const redact = (value) => String(value ?? "")
  .replace(/(authorization|password|token|cookie)(["'\s:=]+)[^\s,"'}]+/gi, "$1$2[REDACTED]")
  .slice(0, 512);

const toValue = (value) => {
  if (value === undefined || value === null) return { nullValue: "NULL_VALUE" };
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "number") return { numberValue: value };
  if (typeof value === "boolean") return { boolValue: value };
  if (Array.isArray(value)) return { listValue: { values: value.map(toValue) } };
  if (typeof value === "object") return { structValue: { fields: Object.fromEntries(Object.entries(value).map(([k, v]) => [k, toValue(v)])) } };
  return { stringValue: String(value) };
};
const extractList = (value) => {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object") return [];
  for (const nested of Object.values(value)) {
    const found = extractList(nested);
    if (found.length || Array.isArray(nested)) return found;
  }
  return [];
};
const extractDevice = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const values = Object.values(value);
  if (values.some((item) => item === null || typeof item !== "object")) return value;
  const nested = values.find((item) => item && typeof item === "object" && !Array.isArray(item));
  return nested ? extractDevice(nested) : value;
};
const readBoundedText = async (response) => {
  const length = Number(response.headers?.get?.("content-length"));
  if (Number.isFinite(length) && length > MAX_RESPONSE_BYTES) throw fail("UNAVAILABLE", "upstream response exceeded size limit");
  if (!response.body?.getReader) {
    const text = await response.text();
    if (Buffer.byteLength(text) > MAX_RESPONSE_BYTES) throw fail("UNAVAILABLE", "upstream response exceeded size limit");
    return text;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0; let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_RESPONSE_BYTES) { await reader.cancel(); throw fail("UNAVAILABLE", "upstream response exceeded size limit"); }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
};

const createContext = (runtime = {}) => {
  const config = runtime.config ?? {};
  const secret = runtime.secret ?? {};
  const bindings = { ...config, ...secret, ...(runtime.bindings ?? {}) };
  const baseUrl = [bindings.host, bindings.baseUrl, bindings.restBaseUrl].map(normalizeBaseUrl).find(Boolean) ?? "";
  if (!baseUrl) throw fail("INVALID_ARGUMENT", "config.host must be an http(s) URL without credentials, query, or fragment");
  const username = trim(bindings.username ?? bindings.user);
  const password = trim(bindings.password);
  if (!username) throw fail("INVALID_ARGUMENT", "secret.username is required");
  if (!password) throw fail("INVALID_ARGUMENT", "secret.password is required");
  const timeoutMs = Math.max(1, asInt(runtime.limits?.timeoutMs ?? bindings.timeoutMs, DEFAULT_TIMEOUT_MS));
  if (asBool(bindings.skipTlsVerify)) insecureDispatcher ??= new Agent({ connect: { rejectUnauthorized: false } });
  return { baseUrl, timeoutMs, authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`, dispatcher: asBool(bindings.skipTlsVerify) ? insecureDispatcher : undefined };
};

const queryFor = (name, request) => {
  const query = new URLSearchParams();
  const candidates = {
    GetIPv4SecurityPolicies: [["page_size", request.pageSize ?? request.page_size], ["rule_name", request.ruleName ?? request.rule_name]],
    GetIPv4ObjectGroups: [["group_name", request.groupName ?? request.group_name]],
    GetServiceGroups: [["group_name", request.groupName ?? request.group_name]],
    GetSessions: [["maxCount", request.maxCount ?? request.max_count]],
    GetInterfaces: [["if_name", request.ifName ?? request.if_name]],
    GetACLGroups: [["group_name", request.groupName ?? request.group_name]],
    GetNATStaticMappings: [["page_size", request.pageSize ?? request.page_size]],
  }[name] ?? [];
  for (const [key, raw] of candidates) { const value = unwrap(raw); if (value !== undefined && value !== null && value !== "") query.set(key, String(value)); }
  return query.size ? `?${query}` : "";
};

const requestUpstream = async (ctx, name, request) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ctx.timeoutMs);
  try {
    const response = await undiciFetch(`${ctx.baseUrl}${API_PATHS[name]}${queryFor(name, request)}`, {
      method: "GET", headers: { Authorization: ctx.authorization, Accept: "application/yang-data+json, application/json" },
      signal: controller.signal, dispatcher: ctx.dispatcher, redirect: "error",
    });
    const raw = await readBoundedText(response);
    if (response.status === 401 || response.status === 403) throw fail("PERMISSION_DENIED", `upstream HTTP ${response.status}`);
    if (response.status === 404) return null;
    if (!response.ok) {
      const detail = redact(raw);
      if (response.status >= 400 && response.status < 500) throw fail("FAILED_PRECONDITION", `upstream HTTP ${response.status}: ${detail}`);
      throw fail("UNAVAILABLE", `upstream HTTP ${response.status}: ${detail}`);
    }
    if (!raw.trim()) throw fail("UNKNOWN", "upstream returned an empty response");
    try { return JSON.parse(raw); } catch { throw fail("UNKNOWN", "upstream response is not valid JSON"); }
  } catch (error) {
    if (error instanceof GrpcError) throw error;
    if (error?.name === "AbortError") throw fail("UNAVAILABLE", `upstream timeout after ${ctx.timeoutMs}ms`);
    throw fail("UNAVAILABLE", redact(error?.message || "upstream request failed"));
  } finally { clearTimeout(timer); }
};

const handler = (name) => async (runtime = {}) => {
  const ctx = createContext(runtime);
  const json = await requestUpstream(ctx, name, runtime.request ?? runtime.req ?? {});
  if (name === "GetDeviceBase") return { info: toValue(json === null ? {} : extractDevice(json)) };
  const items = json === null ? [] : extractList(json);
  return { items: items.map(toValue), count: items.length };
};

export const handlers = Object.fromEntries(Object.keys(METHODS).map((name) => [METHODS[name], handler(name)]));
export const _test = { asBool, asInt, normalizeBaseUrl, redact, toValue, extractList, extractDevice, readBoundedText, createContext, queryFor, API_PATHS, MAX_RESPONSE_BYTES };

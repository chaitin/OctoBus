import RPCClient from "@alicloud/pop-core";
import { GrpcError, grpcStatus } from "@chaitin-ai/octobus-sdk";

// ── 错误映射 ──
function mapAliError(err) {
  // 已是 GrpcError（如参数校验），直接透传
  if (err instanceof GrpcError) return err;
  const code = (err.code || "").toString();
  const msg = err.message || "Alibaba Cloud API error";
  if (code.includes("InvalidAccessKeyId") || code.includes("SignatureDoesNotMatch"))
    return new GrpcError(grpcStatus.UNAUTHENTICATED, msg);
  if (code.includes("Forbidden") || code.includes("NoPermission"))
    return new GrpcError(grpcStatus.PERMISSION_DENIED, msg);
  if (code.includes("InvalidParameter") || code.includes("MissingParameter"))
    return new GrpcError(grpcStatus.INVALID_ARGUMENT, msg);
  if (code.includes("Throttling") || code.includes("LimitExceeded"))
    return new GrpcError(grpcStatus.RESOURCE_EXHAUSTED, msg);
  return new GrpcError(grpcStatus.UNAVAILABLE, msg);
}

// ── 包装器：自动映射阿里云 SDK 异常 ──
function withErrorMapping(fn) {
  return async function(call) {
    try {
      return await fn(call);
    } catch (e) {
      throw mapAliError(e);
    }
  };
}

// ── 构建 RPCClient ──
function buildClient(config, secret) {
  return new RPCClient({
    accessKeyId: secret.accessKeyId,
    accessKeySecret: secret.accessKeySecret,
    endpoint: config.endpoint || "https://wafopenapi.cn-hangzhou.aliyuncs.com",
    apiVersion: "2021-10-01",
    opts: { timeout: config.timeoutMs || 10000 },
  });
}

// ── 按场景获取模板 ──
const sceneTemplateCache = {};
async function getTemplateForScene(client, config, defenseScene) {
  const cacheKey = (config.instanceId || "") + ":" + defenseScene;
  if (sceneTemplateCache[cacheKey]) return sceneTemplateCache[cacheKey];
  const result = await client.request("DescribeDefenseTemplates", {
    InstanceId: config.instanceId,
    RegionId: config.regionId || "cn-hangzhou",
    DefenseScene: defenseScene,
    PageNumber: 1, PageSize: 5,
  });
  const templates = result?.Templates || result?.DefenseTemplates || [];
  if (!templates.length) throw new GrpcError(grpcStatus.FAILED_PRECONDITION, `no template for scene: ${defenseScene}`);
  sceneTemplateCache[cacheKey] = String(templates[0].TemplateId);
  return sceneTemplateCache[cacheKey];
}

// ── 原生 HTTPS（绕过 SDK Filter 编码问题） ──
import https from "https";
import crypto from "crypto";

function nativeApiCall(config, action, params, secret) {
  return new Promise((resolve, reject) => {
    const all = Object.assign({
      AccessKeyId: secret.accessKeyId,
      Action: action,
      Format: "JSON",
      SignatureMethod: "HMAC-SHA1",
      SignatureNonce: crypto.randomUUID(),
      SignatureVersion: "1.0",
      Timestamp: new Date().toISOString().replace(/\.\d{3}Z/, "Z"),
      Version: "2021-10-01",
    }, params);
    const sorted = Object.keys(all).sort();
    const query = sorted.map(k => encodeURIComponent(k) + "=" + encodeURIComponent(String(all[k]))).join("&");
    const signStr = "GET&" + encodeURIComponent("/") + "&" + encodeURIComponent(query);
    const sig = crypto.createHmac("sha1", secret.accessKeySecret + "&").update(signStr).digest("base64");
    const hostname = config.endpoint
      ? new URL(config.endpoint).hostname
      : "wafopenapi.cn-hangzhou.aliyuncs.com";
    const url = "https://" + hostname + "/?" + query + "&Signature=" + encodeURIComponent(sig);
    https.get(url, res => {
      let body = "";
      res.on("data", chunk => body += chunk);
      res.on("end", () => {
        let data;
        try { data = JSON.parse(body); }
        catch (e) { return reject(new Error("JSON parse: " + body.substring(0, 200))); }
        // 阿里云 API 错误返回在响应体中
        if (data.Code) return reject(new Error(data.Code + ": " + (data.Message || "")));
        resolve(data);
      });
    }).on("error", reject);
  });
}

function parseRulesJson(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "string") {
    try {
      const p = JSON.parse(raw);
      return Array.isArray(p) ? p : [p];
    } catch { return []; }
  }
  return [raw];
}

// ═══════════════════════════════════════════
// Handlers — 每个函数独立导出
// ═══════════════════════════════════════════

async function BlockIP(call) {
  if (!call.request.ips || call.request.ips.length === 0)
    throw new GrpcError(grpcStatus.INVALID_ARGUMENT, "ips is required");
  const client = buildClient(call.config, call.secret);
  const templateId = call.request.templateId || await getTemplateForScene(client, call.config, "ip_blacklist");
  const action = call.request.action || "block";
  if (!["block", "monitor"].includes(action))
    throw new GrpcError(grpcStatus.INVALID_ARGUMENT, `invalid action: ${action}`);
  const result = await client.request("CreateDefenseRule", {
    InstanceId: call.config.instanceId,
    RegionId: call.config.regionId || "cn-hangzhou",
    TemplateId: templateId,
    DefenseScene: "ip_blacklist",
    Rules: JSON.stringify([{ name: call.request.ruleName || "octobus-block", remoteAddr: call.request.ips, action, status: 1 }]),
  }, { method: "POST" });
  return { ruleId: result?.RuleIds?.toString() || result?.RuleId?.toString() || "" };
}

async function DescribeResources(call) {
  const client = buildClient(call.config, call.secret);
  const result = await client.request("DescribeDefenseResources", {
    InstanceId: call.config.instanceId,
    RegionId: call.config.regionId || "cn-hangzhou",
    PageNumber: call.request.pageNumber || 1,
    PageSize: Math.min(call.request.pageSize || 20, 100),
  });
  const rawResources = result?.Resources || [];
  return {
    resources: rawResources.map(r => ({
      resource: r.Resource || "", pattern: r.Pattern || "", product: r.Product || "",
      status: r.ResourceStatus || "", instanceId: r.Detail?.instanceId || "",
      port: r.Detail?.port || 0, protocol: r.Detail?.protocol || "",
    })),
    total: result?.TotalCount || rawResources.length,
  };
}

async function DescribeRules(call) {
  const client = buildClient(call.config, call.secret);
  const scene = call.request.defenseScene || "ip_blacklist";
  const templateId = call.request.templateId || await getTemplateForScene(client, call.config, scene);
  const query = JSON.stringify({ templateId: Number(templateId), scene });
  const result = await client.request("DescribeDefenseRules", {
    InstanceId: call.config.instanceId, RegionId: call.config.regionId || "cn-hangzhou",
    Query: query,
    PageNumber: call.request.pageNumber || 1,
    PageSize: Math.min(call.request.pageSize || 20, 100),
  });
  const rawRules = result?.Rules || [];
  return {
    rules: rawRules.map(r => {
      const p = parseRulesJson(r.Config);
      const f = p[0] || {};
      return {
        ruleId: String(r.RuleId||""), name: f.name||"", defenseScene: r.DefenseScene||"",
        action: f.action||"", status: f.status??0, rulesJson: JSON.stringify(p),
      };
    }),
    total: result?.TotalCount || rawRules.length,
  };
}

async function UnblockIP(call) {
  if (!call.request.ruleId) throw new GrpcError(grpcStatus.INVALID_ARGUMENT, "rule_id required");
  if (!call.request.ips || call.request.ips.length === 0) throw new GrpcError(grpcStatus.INVALID_ARGUMENT, "ips required");
  const client = buildClient(call.config, call.secret);
  const templateId = call.request.templateId || await getTemplateForScene(client, call.config, "ip_blacklist");
  const rule = await client.request("DescribeDefenseRule", {
    InstanceId: call.config.instanceId, RegionId: call.config.regionId || "cn-hangzhou",
    TemplateId: templateId, RuleId: call.request.ruleId,
  });
  const currentRules = parseRulesJson(rule?.Rule?.Config);
  if (currentRules.length === 0) throw new GrpcError(grpcStatus.NOT_FOUND, "rule not found");
  const ipsToRemove = new Set(call.request.ips);
  const updated = currentRules.map(r => ({ id: Number(call.request.ruleId), ...r, remoteAddr: (r.remoteAddr || []).filter(ip => !ipsToRemove.has(ip)) }));
  const hasAnyIp = updated.some(r => (r.remoteAddr || []).length > 0);
  if (!hasAnyIp) {
    // 所有 IP 都被移除了，直接删规则
    await client.request("DeleteDefenseRule", {
      InstanceId: call.config.instanceId, RegionId: call.config.regionId || "cn-hangzhou",
      TemplateId: templateId, RuleIds: String(call.request.ruleId),
    }, { method: "POST" });
  } else {
    await client.request("ModifyDefenseRule", {
      InstanceId: call.config.instanceId, RegionId: call.config.regionId || "cn-hangzhou",
      TemplateId: templateId, DefenseScene: "ip_blacklist",
      Rules: JSON.stringify(updated),
    }, { method: "POST" });
  }
  return { success: true };
}

async function DescribeIPBlacklist(call) {
  const client = buildClient(call.config, call.secret);
  const templateId = call.request.templateId || await getTemplateForScene(client, call.config, "ip_blacklist");
  const query = JSON.stringify({ templateId: Number(templateId), scene: "ip_blacklist" });
  const result = await client.request("DescribeDefenseRules", {
    InstanceId: call.config.instanceId, RegionId: call.config.regionId || "cn-hangzhou",
    Query: query,
    PageNumber: call.request.pageNumber || 1, PageSize: Math.min(call.request.pageSize || 20, 100),
  });
  const rawRules = result?.Rules || [];
  return {
    rules: rawRules.map(r => {
      const p = parseRulesJson(r.Config);
      const f = p[0] || {};
      return { ruleId: String(r.RuleId||""), name: f.name||"", ips: f.remoteAddr||[], action: f.action||"", status: f.status??1 };
    }),
    total: result?.TotalCount || rawRules.length,
  };
}

async function AddIPWhitelist(call) {
  if (!call.request.ips || call.request.ips.length === 0) throw new GrpcError(grpcStatus.INVALID_ARGUMENT, "ips required");
  const client = buildClient(call.config, call.secret);
  const templateId = call.request.templateId || await getTemplateForScene(client, call.config, "whitelist");
  const tags = call.request.tags && call.request.tags.length > 0 ? call.request.tags : ["waf"];
  const result = await client.request("CreateDefenseRule", {
    InstanceId: call.config.instanceId, RegionId: call.config.regionId || "cn-hangzhou",
    TemplateId: templateId, DefenseScene: "whitelist",
    Rules: JSON.stringify([{
      name: call.request.ruleName || "octobus-whitelist", status: 1,
      conditions: call.request.ips.map(ip => ({ key: "IP", opValue: "eq", values: ip })), tags,
    }]),
  }, { method: "POST" });
  return { ruleId: result?.RuleIds?.toString() || result?.RuleId?.toString() || "" };
}

async function CreateACLRule(call) {
  if (!call.request.ruleName) throw new GrpcError(grpcStatus.INVALID_ARGUMENT, "rule_name required");
  if (!call.request.conditions || call.request.conditions.length === 0) throw new GrpcError(grpcStatus.INVALID_ARGUMENT, "conditions required");
  if (call.request.conditions.length > 5) throw new GrpcError(grpcStatus.INVALID_ARGUMENT, "maximum 5 conditions");
  const action = call.request.action || "block";
  if (!["block", "monitor", "js", "captcha", "captcha_strict"].includes(action))
    throw new GrpcError(grpcStatus.INVALID_ARGUMENT, `invalid action: ${action}`);
  const client = buildClient(call.config, call.secret);
  const templateId = call.request.templateId || await getTemplateForScene(client, call.config, "custom_acl");
  const result = await client.request("CreateDefenseRule", {
    InstanceId: call.config.instanceId, RegionId: call.config.regionId || "cn-hangzhou",
    TemplateId: templateId, DefenseScene: "custom_acl",
    Rules: JSON.stringify([{
      name: call.request.ruleName, action,
      conditions: call.request.conditions.map(c => {
        const cond = { key: c.key, opValue: c.opValue, values: c.values };
        if (c.subKey) cond.subKey = c.subKey;
        return cond;
      }),
      ccStatus: 0, status: call.request.status ?? 1,
    }]),
  }, { method: "POST" });
  return { ruleId: result?.RuleIds?.toString() || result?.RuleId?.toString() || "" };
}

async function DeleteRule(call) {
  if (!call.request.ruleId) throw new GrpcError(grpcStatus.INVALID_ARGUMENT, "rule_id required");
  const client = buildClient(call.config, call.secret);
  const scene = call.request.defenseScene || "ip_blacklist";
  const templateId = call.request.templateId || await getTemplateForScene(client, call.config, scene);
  await client.request("DeleteDefenseRule", {
    InstanceId: call.config.instanceId, RegionId: call.config.regionId || "cn-hangzhou",
    TemplateId: templateId, RuleIds: String(call.request.ruleId),
  }, { method: "POST" });
  return { success: true };
}

async function DescribeRule(call) {
  if (!call.request.ruleId) throw new GrpcError(grpcStatus.INVALID_ARGUMENT, "rule_id required");
  const client = buildClient(call.config, call.secret);
  const templateId = call.request.templateId || await getTemplateForScene(client, call.config, "ip_blacklist");
  const result = await client.request("DescribeDefenseRule", {
    InstanceId: call.config.instanceId, RegionId: call.config.regionId || "cn-hangzhou",
    TemplateId: templateId, RuleId: call.request.ruleId,
  });
  const rule = result?.Rule || {};
  const parsed = parseRulesJson(rule.Config);
  const firstRule = parsed[0] || {};
  return {
    ruleId: String(rule.RuleId||""), name: firstRule.name||"", defenseScene: rule.DefenseScene||"",
    action: firstRule.action||"", status: firstRule.status??0, rulesJson: JSON.stringify(parsed),
  };
}

async function DescribeSecurityTopNMetric(call) {
  if (!call.request.startTime || !call.request.endTime)
    throw new GrpcError(grpcStatus.INVALID_ARGUMENT, "start_time and end_time required");
  if (call.request.limit && (call.request.limit < 1 || call.request.limit > 10))
    throw new GrpcError(grpcStatus.INVALID_ARGUMENT, "limit must be 1-10");
  const client = buildClient(call.config, call.secret);
  // Filter 是 JSON 对象，包含 DateRange 和可选的 Conditions
  const filter = JSON.stringify({
    DateRange: { StartDate: Number(call.request.startTime), EndDate: Number(call.request.endTime) },
  });
  const result = await client.request("DescribeSecurityEventTopNMetric", {
    InstanceId: call.config.instanceId,
    RegionId: call.config.regionId || "cn-hangzhou",
    StartTime: call.request.startTime,
    EndTime: call.request.endTime,
    Metric: call.request.metric || "real_client_ip",
    Limit: call.request.limit || 5,
    Filter: filter,
  });
  const rawItems = result?.SecurityEventTopNValues || [];
  return {
    items: rawItems.map(i => ({ name: String(i.Name || ""), value: Number(i.Value || 0) })),
  };
}

// ═══════════════════════════════════════════
// 导出 — 使用函数引用模式（和 safeline-waf 一致）
// ═══════════════════════════════════════════
export const handlers = {
  "Aliyun_Waf3.Waf3/BlockIP": withErrorMapping(BlockIP),
  "Aliyun_Waf3.Waf3/UnblockIP": withErrorMapping(UnblockIP),
  "Aliyun_Waf3.Waf3/DescribeIPBlacklist": withErrorMapping(DescribeIPBlacklist),
  "Aliyun_Waf3.Waf3/AddIPWhitelist": withErrorMapping(AddIPWhitelist),
  "Aliyun_Waf3.Waf3/CreateACLRule": withErrorMapping(CreateACLRule),
  "Aliyun_Waf3.Waf3/DeleteRule": withErrorMapping(DeleteRule),
  "Aliyun_Waf3.Waf3/DescribeRule": withErrorMapping(DescribeRule),
  "Aliyun_Waf3.Waf3/DescribeRules": withErrorMapping(DescribeRules),
  "Aliyun_Waf3.Waf3/DescribeSecurityTopNMetric": withErrorMapping(DescribeSecurityTopNMetric),
  "Aliyun_Waf3.Waf3/DescribeResources": withErrorMapping(DescribeResources),
  // 短名别名，给测试用
  BlockIP: withErrorMapping(BlockIP),
  UnblockIP: withErrorMapping(UnblockIP),
  DescribeIPBlacklist: withErrorMapping(DescribeIPBlacklist),
  AddIPWhitelist: withErrorMapping(AddIPWhitelist),
  CreateACLRule: withErrorMapping(CreateACLRule),
  DeleteRule: withErrorMapping(DeleteRule),
  DescribeRule: withErrorMapping(DescribeRule),
  DescribeRules: withErrorMapping(DescribeRules),
  DescribeSecurityTopNMetric: withErrorMapping(DescribeSecurityTopNMetric),
  DescribeResources: withErrorMapping(DescribeResources),
};

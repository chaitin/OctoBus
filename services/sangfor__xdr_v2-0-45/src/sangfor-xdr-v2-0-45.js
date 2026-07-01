import { grpcInvalidArgumentError } from "@chaitin-ai/octobus-sdk";

import { createXdrClient } from "./client.js";

const SERVICE = "sangfor.xdr.v2_0_45.SangforXdrService";

export const METHOD_SEARCH_INCIDENTS = `${SERVICE}/SearchIncidents`;
export const METHOD_GET_INCIDENT_CONTEXT = `${SERVICE}/GetIncidentContext`;
export const METHOD_SEARCH_ALERTS = `${SERVICE}/SearchAlerts`;
export const METHOD_GET_ALERT_CONTEXT = `${SERVICE}/GetAlertContext`;
export const METHOD_SEARCH_ASSETS = `${SERVICE}/SearchAssets`;
export const METHOD_SEARCH_RISK_HOSTS = `${SERVICE}/SearchRiskHosts`;
export const METHOD_SEARCH_VULNERABILITIES = `${SERVICE}/SearchVulnerabilities`;

const SEARCH_INCIDENTS_PATH = "/api/xdr/v1/incidents/list";
const SEARCH_ALERTS_PATH = "/api/xdr/v1/alerts/list";
const SEARCH_ASSETS_PATH = "/api/xdr/v1/assets/list";
const SEARCH_RISK_HOSTS_PATH = "/api/xdr/v1/riskassets/list";
const SEARCH_VULNERABILITIES_PATH = "/api/xdr/v1/vuls/risk/list";

const own = (object, key) => Object.prototype.hasOwnProperty.call(object ?? {}, key);

const resolveInvocation = (requestOrContext, maybeContext) => {
  if (maybeContext !== undefined) {
    return {
      request: requestOrContext ?? {},
      context: maybeContext ?? {},
    };
  }
  if (own(requestOrContext, "request")) {
    return {
      request: requestOrContext.request ?? {},
      context: requestOrContext,
    };
  }
  return {
    request: requestOrContext ?? {},
    context: {},
  };
};

const first = (request, ...keys) => {
  for (const key of keys) {
    if (own(request, key)) return request[key];
  }
  return undefined;
};

const meaningful = (value) => {
  if (value === undefined || value === null || value === "") return false;
  if (typeof value === "number" && value === 0) return false;
  if (typeof value === "bigint" && value === 0n) return false;
  if (Array.isArray(value) && value.length === 0) return false;
  return true;
};

const jsonValue = (value) => {
  if (typeof value === "bigint") {
    const number = Number(value);
    return Number.isSafeInteger(number) ? number : value.toString();
  }
  if (Array.isArray(value)) return value.map(jsonValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, jsonValue(item)]));
  }
  return value;
};

const extraFilters = (request) => {
  const value = first(request, "extra_filters", "extraFilters");
  return value && typeof value === "object" && !Array.isArray(value) ? jsonValue(value) : {};
};

const mapRequest = (request, mappings) => {
  const body = extraFilters(request);
  for (const [vendorName, ...aliases] of mappings) {
    const value = first(request, ...aliases);
    if (meaningful(value)) body[vendorName] = jsonValue(value);
  }
  return body;
};

const searchResponse = (json) => {
  const data = json?.data ?? null;
  return {
    code: json?.code == null ? "" : String(json.code),
    message: typeof json?.message === "string" ? json.message : "",
    total: Number(data?.total ?? 0),
    page: Number(data?.page ?? 0),
    page_size: Number(data?.pageSize ?? 0),
    data,
    raw_json: undefined,
  };
};

const requireUuid = (request) => {
  const uuid = typeof request?.uuid === "string" ? request.uuid.trim() : "";
  if (!uuid) throw grpcInvalidArgumentError("uuid is required");
  return encodeURIComponent(uuid);
};

const contextData = (json) => json?.data ?? json;

const contextResponse = (json) => ({
  code: json?.code == null ? "" : String(json.code),
  message: typeof json?.message === "string" ? json.message : "",
  data: contextData(json),
  raw_json: undefined,
});

const incidentMappings = [
  ["startTimestamp", "start_timestamp", "startTimestamp"],
  ["endTimestamp", "end_timestamp", "endTimestamp"],
  ["timeField", "time_field", "timeField"],
  ["page", "page"],
  ["pageSize", "page_size", "pageSize"],
  ["sort", "sort"],
  ["uuIds", "uuids", "uuIds"],
  ["dealStatus", "deal_status", "dealStatus"],
  ["severities", "severities"],
  ["platformHostBranchIds", "platform_host_branch_ids", "platformHostBranchIds"],
  ["riskTags", "risk_tags", "riskTags"],
  ["gptResults", "gpt_results", "gptResults"],
  ["dataSources", "data_sources", "dataSources"],
  ["platformIds", "platform_ids", "platformIds"],
];

const alertMappings = [
  ["uuIds", "uuids", "uuIds"],
  ["page", "page"],
  ["pageSize", "page_size", "pageSize"],
  ["startTimestamp", "start_timestamp", "startTimestamp"],
  ["endTimestamp", "end_timestamp", "endTimestamp"],
  ["timeField", "time_field", "timeField"],
  ["sortField", "sort_field", "sortField"],
  ["sortOrder", "sort_order", "sortOrder"],
  ["alertDealStatus", "alert_deal_status", "alertDealStatus"],
  ["severities", "severities"],
  ["productType", "product_types", "productType"],
  ["accessDirections", "access_directions", "accessDirections"],
  ["platformHostBranchIds", "platform_host_branch_ids", "platformHostBranchIds"],
  ["threatDefines", "threat_defines", "threatDefines"],
  ["srcIps", "source_ips", "srcIps"],
  ["dstIps", "destination_ips", "destinationIps", "dstIps"],
  ["platformIds", "platform_ids", "platformIds"],
];

const assetMappings = [
  ["page", "page"],
  ["pageSize", "page_size", "pageSize"],
  ["ip", "ip"],
  ["assetId", "asset_id", "assetId"],
  ["hostName", "host_name", "hostName"],
  ["name", "name"],
  ["assetIds", "asset_ids", "assetIds"],
  ["branchIds", "branch_ids", "branchIds"],
  ["businessIds", "business_ids", "businessIds"],
  ["tags", "tags"],
  ["sourceDevice", "source_device", "sourceDevice"],
  ["orderCol", "order_column", "orderCol"],
  ["orderType", "order_type", "orderType"],
];

const riskHostMappings = [
  ["hostAssetIds", "host_asset_ids", "hostAssetIds"],
  ["hostBranchIds", "host_branch_ids", "hostBranchIds"],
  ["page", "page"],
  ["pageSize", "page_size", "pageSize"],
  ["startTimestamp", "start_timestamp", "startTimestamp"],
  ["endTimestamp", "end_timestamp", "endTimestamp"],
  ["sort", "sort"],
];

const vulnerabilityMappings = [
  ["startTimestamp", "start_timestamp", "startTimestamp"],
  ["endTimestamp", "end_timestamp", "endTimestamp"],
  ["timeField", "time_field", "timeField"],
  ["pageSize", "page_size", "pageSize"],
  ["lastId", "last_id", "lastId"],
  ["dataType", "data_type", "dataType"],
  ["name", "name"],
  ["assetIp", "asset_ip", "assetIp"],
  ["attackTypes", "attack_types", "attackTypes"],
  ["scanTypes", "scan_types", "scanTypes"],
  ["threatTags", "threat_tags", "threatTags"],
  ["assetBranchIds", "asset_branch_ids", "assetBranchIds"],
  ["riskLevels", "risk_levels", "riskLevels"],
  ["sort", "sort"],
];

const searchHandler = (clientFactory, path, mappings) => async (requestOrContext = {}, maybeContext) => {
  const { request, context } = resolveInvocation(requestOrContext, maybeContext);
  const client = clientFactory(context);
  return searchResponse(await client.post(path, mapRequest(request, mappings)));
};

export function createHandlers(clientFactory = createXdrClient) {
  const getAlertContext = async (requestOrContext = {}, maybeContext) => {
    const { request, context } = resolveInvocation(requestOrContext, maybeContext);
    const uuid = requireUuid(request);
    const client = clientFactory(context);
    return contextResponse(await client.get(`/api/xdr/v1/alerts/${uuid}/proof`));
  };

  const getIncidentContext = async (requestOrContext = {}, maybeContext) => {
    const { request, context } = resolveInvocation(requestOrContext, maybeContext);
    const uuid = requireUuid(request);
    const client = clientFactory(context);
    const selectors = [
      ["processes", "include_processes", "includeProcesses", "process"],
      ["files", "include_files", "includeFiles", "file"],
      ["hosts", "include_hosts", "includeHosts", "host"],
      ["external_ips", "include_external_ips", "includeExternalIps", "ip"],
      ["internal_ips", "include_internal_ips", "includeInternalIps", "innerip"],
      ["dns", "include_dns", "includeDns", "dns"],
    ];
    const hasSelection = selectors.some(([, snake, camel]) => first(request, snake, camel) === true);
    const lookups = [
      ["proof", `/api/xdr/v1/incidents/${uuid}/proof`],
      ...selectors
        .filter(([, snake, camel]) => !hasSelection || first(request, snake, camel) === true)
        .map(([responseKey, , , endpoint]) => [
          responseKey,
          `/api/xdr/v1/incidents/${uuid}/entities/${endpoint}`,
        ]),
    ];
    const results = await Promise.all(lookups.map(async ([key, path]) => [
      key,
      contextData(await client.get(path)),
    ]));
    return Object.fromEntries(results);
  };

  return {
    [METHOD_SEARCH_INCIDENTS]: searchHandler(clientFactory, SEARCH_INCIDENTS_PATH, incidentMappings),
    [METHOD_GET_INCIDENT_CONTEXT]: getIncidentContext,
    [METHOD_SEARCH_ALERTS]: searchHandler(clientFactory, SEARCH_ALERTS_PATH, alertMappings),
    [METHOD_GET_ALERT_CONTEXT]: getAlertContext,
    [METHOD_SEARCH_ASSETS]: searchHandler(clientFactory, SEARCH_ASSETS_PATH, assetMappings),
    [METHOD_SEARCH_RISK_HOSTS]: searchHandler(clientFactory, SEARCH_RISK_HOSTS_PATH, riskHostMappings),
    [METHOD_SEARCH_VULNERABILITIES]: searchHandler(clientFactory, SEARCH_VULNERABILITIES_PATH, vulnerabilityMappings),
  };
}

export const handlers = createHandlers();

export const _test = {
  extraFilters,
  first,
  meaningful,
  jsonValue,
  mapRequest,
  contextData,
  contextResponse,
  requireUuid,
  resolveInvocation,
  searchResponse,
};

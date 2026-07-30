import { toJson } from "@bufbuild/protobuf";
import { StructSchema } from "@bufbuild/protobuf/wkt";
import { GrpcError, grpcStatus } from "@chaitin-ai/octobus-sdk";

import { InsightClient, InsightClientError } from "./insight-client.js";

export const METHODS = {
  HEALTH_CHECK: "chaitin.insight.v1.InsightService/HealthCheck",
  LIST_TASKS: "chaitin.insight.v1.InsightService/ListTasks",
  START_TASK: "chaitin.insight.v1.InsightService/StartTask",
  STOP_TASK: "chaitin.insight.v1.InsightService/StopTask",
  GET_TASK_STATUS: "chaitin.insight.v1.InsightService/GetTaskStatus",
  LIST_IP_ASSETS: "chaitin.insight.v1.InsightService/ListIpAssets",
  LIST_WEB_ASSETS: "chaitin.insight.v1.InsightService/ListWebAssets",
  LIST_SOFTWARE_ASSETS: "chaitin.insight.v1.InsightService/ListSoftwareAssets",
  LIST_ASSET_TAGS: "chaitin.insight.v1.InsightService/ListAssetTags",
  LIST_ASSET_BUSINESSES: "chaitin.insight.v1.InsightService/ListAssetBusinesses",
  LIST_IP_VULNERABILITIES: "chaitin.insight.v1.InsightService/ListIpVulnerabilities",
  LIST_WEB_VULNERABILITIES: "chaitin.insight.v1.InsightService/ListWebVulnerabilities",
  LIST_TASK_RESULTS: "chaitin.insight.v1.InsightService/ListTaskResults",
  COMPARE_TASK_RESULTS: "chaitin.insight.v1.InsightService/CompareTaskResults",
  GET_ASSET_SNAPSHOT: "chaitin.insight.v1.InsightService/GetAssetSnapshot",
  LIST_ORDERS: "chaitin.insight.v1.InsightService/ListOrders",
  GET_LICENSE: "chaitin.insight.v1.InsightService/GetLicense",
  GET_MACHINE_ID: "chaitin.insight.v1.InsightService/GetMachineId",
};

export const RPC_METHODS = {
  LIST_TASKS: "ScanTaskService.SearchTaskList",
  LIST_IP_ASSETS: "AssetMgrService.IpAssetList",
  LIST_WEB_ASSETS: "AssetMgrService.WebsiteAssetList",
  LIST_SOFTWARE_ASSETS: "AssetMgrService.SoftwareAssetOverviewList",
  LIST_ASSET_TAGS: "AssetMgrService.AssetTagList",
  LIST_ASSET_BUSINESSES: "AssetMgrService.AssetBusinessList",
  LIST_IP_VULNERABILITIES: "ScanVulnIpService.SearchScanVulnIpList",
  LIST_WEB_VULNERABILITIES: "ScanVulnIpService.SearchScanVulnWebList",
};

export const REST_PATHS = {
  START_TASK: "/exposure/api/task/reexecute",
  STOP_TASK: "/exposure/api/task/stop",
  TASK_STATUS: "/exposure/api/task/execution",
  TASK_RESULTS: "/exposure/api/result",
  COMPARE_RESULTS: "/exposure/api/result/comparison",
  ASSET_SNAPSHOT: "/exposure/api/snapshot/asset",
  ORDERS: "/workflow/api/orders/all",
  LICENSE: "/mgt/api/license",
  MACHINE_ID: "/mgt/api/noauth/machine_id",
};

const STATUS_BY_ERROR_CODE = {
  INVALID_ARGUMENT: grpcStatus.INVALID_ARGUMENT,
  UNAUTHENTICATED: grpcStatus.UNAUTHENTICATED,
  PERMISSION_DENIED: grpcStatus.PERMISSION_DENIED,
  NOT_FOUND: grpcStatus.NOT_FOUND,
  RESOURCE_EXHAUSTED: grpcStatus.RESOURCE_EXHAUSTED,
  FAILED_PRECONDITION: grpcStatus.FAILED_PRECONDITION,
  UNAVAILABLE: grpcStatus.UNAVAILABLE,
  UPSTREAM_ERROR: grpcStatus.UNKNOWN,
};

export const resolveSettings = (ctx = {}) => {
  const bindings = {
    ...(ctx.config ?? {}),
    ...(ctx.bindings ?? {}),
    ...(ctx.secret ?? {}),
  };
  return {
    baseUrl: bindings.baseUrl ?? bindings.insightBaseUrl,
    rpcPath: bindings.rpcPath ?? bindings.insightRpcPath,
    token: bindings.token ?? bindings.insightToken,
    timeoutMs: bindings.timeoutMs,
    skipTlsVerify: bindings.skipTlsVerify === true,
    sendJwtCookie: bindings.sendJwtCookie !== false,
    fetchImpl: ctx.fetchImpl,
  };
};

export const toGrpcError = (error) => {
  if (error instanceof GrpcError) return error;
  if (error instanceof InsightClientError) {
    return new GrpcError(
      STATUS_BY_ERROR_CODE[error.code] ?? grpcStatus.UNKNOWN,
      error.message,
    );
  }
  return new GrpcError(grpcStatus.UNKNOWN, error?.message || "Insight request failed");
};

export const toPlainObject = (value) => {
  if (!value) return {};
  if (value.$typeName === "google.protobuf.Struct") return toJson(StructSchema, value);
  if (typeof value === "object" && !Array.isArray(value)) return value;
  return {};
};

const boundedInteger = (value, fallback, max = 1000) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(max, Math.floor(parsed));
};

const nonNegativeInteger = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.floor(parsed);
};

const requiredString = (value, field) => {
  const normalized = String(value ?? "").trim();
  if (!normalized) throw new GrpcError(grpcStatus.INVALID_ARGUMENT, `${field} is required`);
  return normalized;
};

export const buildPagedParams = (request = {}) => ({
  count: boundedInteger(request.count, 20),
  offset: nonNegativeInteger(request.offset),
});

export const buildAssetParams = (request = {}) => ({
  ...buildPagedParams(request),
  filter: toPlainObject(request.filter),
});

export const buildVulnerabilityParams = (request = {}) => {
  const params = toPlainObject(request.params);
  return {
    ...params,
    ...buildPagedParams(request),
    rel_asset: params.rel_asset ?? true,
  };
};

export const buildListOrdersQuery = (request = {}) => ({
  page: boundedInteger(request.page, 1, 1000000),
  size: boundedInteger(request.size, 20),
  name: String(request.name ?? "").trim() || undefined,
  status: Number(request.status) > 0 ? Math.floor(Number(request.status)) : undefined,
  is_timeout: (request.is_timeout ?? request.isTimeout) === undefined
    ? undefined
    : Boolean(request.is_timeout ?? request.isTimeout),
});

const withClient = async (ctx, action) => {
  let client;
  try {
    client = new InsightClient(resolveSettings(ctx));
    return await action(client);
  } catch (error) {
    throw toGrpcError(error);
  } finally {
    await client?.close();
  }
};

const rpcHandler = (method, buildParams) => async (ctx = {}) => withClient(ctx, async (client) => ({
  result: await client.callRpc(method, buildParams(ctx.request ?? {})),
}));

const restHandler = (httpMethod, path, buildOptions = () => ({})) => async (ctx = {}) => withClient(
  ctx,
  async (client) => ({
    result: await client.callRest(httpMethod, path, buildOptions(ctx.request ?? {})),
  }),
);

export const healthCheck = async (ctx = {}) => {
  let client;
  try {
    client = new InsightClient(resolveSettings(ctx));
    await client.callRpc(RPC_METHODS.LIST_SOFTWARE_ASSETS, {
      count: 1,
      offset: 0,
      filter: {},
    });
    return { reachable: true, message: "Insight API is reachable" };
  } catch (error) {
    return { reachable: false, message: error?.message || "Insight API is unavailable" };
  } finally {
    await client?.close();
  }
};

export const listTasks = rpcHandler(RPC_METHODS.LIST_TASKS, buildPagedParams);
export const listIpAssets = rpcHandler(RPC_METHODS.LIST_IP_ASSETS, buildAssetParams);
export const listWebAssets = rpcHandler(RPC_METHODS.LIST_WEB_ASSETS, buildAssetParams);
export const listSoftwareAssets = rpcHandler(RPC_METHODS.LIST_SOFTWARE_ASSETS, buildAssetParams);
export const listAssetTags = rpcHandler(RPC_METHODS.LIST_ASSET_TAGS, buildAssetParams);
export const listAssetBusinesses = rpcHandler(RPC_METHODS.LIST_ASSET_BUSINESSES, buildAssetParams);
export const listIpVulnerabilities = rpcHandler(
  RPC_METHODS.LIST_IP_VULNERABILITIES,
  buildVulnerabilityParams,
);
export const listWebVulnerabilities = rpcHandler(
  RPC_METHODS.LIST_WEB_VULNERABILITIES,
  buildVulnerabilityParams,
);

export const startTask = restHandler("POST", REST_PATHS.START_TASK, (request) => ({
  body: { id: requiredString(request.id, "id") },
}));
export const stopTask = restHandler("POST", REST_PATHS.STOP_TASK, (request) => ({
  body: { id: requiredString(request.id, "id") },
}));
export const getTaskStatus = restHandler("GET", REST_PATHS.TASK_STATUS, (request) => ({
  query: {
    id: requiredString(request.execution_id ?? request.executionId, "execution_id"),
  },
}));
export const listTaskResults = restHandler("GET", REST_PATHS.TASK_RESULTS, (request) => ({
  query: { task_id: String(request.task_id ?? request.taskId ?? "").trim() || undefined },
}));
export const compareTaskResults = restHandler("GET", REST_PATHS.COMPARE_RESULTS, (request) => ({
  query: {
    exec_id: requiredString(request.execution_id ?? request.executionId, "execution_id"),
  },
}));
export const getAssetSnapshot = restHandler("GET", REST_PATHS.ASSET_SNAPSHOT);
export const listOrders = restHandler("GET", REST_PATHS.ORDERS, (request) => ({
  query: buildListOrdersQuery(request),
}));
export const getLicense = restHandler("GET", REST_PATHS.LICENSE);
export const getMachineId = restHandler("GET", REST_PATHS.MACHINE_ID);

export const handlers = {
  [METHODS.HEALTH_CHECK]: healthCheck,
  [METHODS.LIST_TASKS]: listTasks,
  [METHODS.START_TASK]: startTask,
  [METHODS.STOP_TASK]: stopTask,
  [METHODS.GET_TASK_STATUS]: getTaskStatus,
  [METHODS.LIST_IP_ASSETS]: listIpAssets,
  [METHODS.LIST_WEB_ASSETS]: listWebAssets,
  [METHODS.LIST_SOFTWARE_ASSETS]: listSoftwareAssets,
  [METHODS.LIST_ASSET_TAGS]: listAssetTags,
  [METHODS.LIST_ASSET_BUSINESSES]: listAssetBusinesses,
  [METHODS.LIST_IP_VULNERABILITIES]: listIpVulnerabilities,
  [METHODS.LIST_WEB_VULNERABILITIES]: listWebVulnerabilities,
  [METHODS.LIST_TASK_RESULTS]: listTaskResults,
  [METHODS.COMPARE_TASK_RESULTS]: compareTaskResults,
  [METHODS.GET_ASSET_SNAPSHOT]: getAssetSnapshot,
  [METHODS.LIST_ORDERS]: listOrders,
  [METHODS.GET_LICENSE]: getLicense,
  [METHODS.GET_MACHINE_ID]: getMachineId,
};

const grpcStatus = Object.freeze({
  INVALID_ARGUMENT: 3,
  NOT_FOUND: 5,
  ALREADY_EXISTS: 6,
  RESOURCE_EXHAUSTED: 8,
  FAILED_PRECONDITION: 9,
  DEADLINE_EXCEEDED: 4,
  UNAVAILABLE: 14,
  PERMISSION_DENIED: 7,
  UNAUTHENTICATED: 16,
});

const endpoints = Object.freeze({
  listClusters: '/cluster/cluster_list',
  getClusterInfo: '/cluster/cluster_info',
  listClusterVulnEvents: '/cluster_vuln/vuln_event_list',
  getClusterVulnEvent: '/cluster_vuln/vuln_event_info',
  listMicroserviceVulnEvents: '/cluster_microservice/vuln_event_list',
  getMicroserviceVulnEvent: '/cluster_microservice/vuln_event_info',
});

class CloudWalkerError extends Error {
  constructor(message, { code, details, httpStatus } = {}) {
    super(message);
    this.name = 'CloudWalkerError';
    this.code = code ?? grpcStatus.UNAVAILABLE;
    this.details = details ?? message;
    this.httpStatus = httpStatus;
  }
}

const toCamelKey = (key) => key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());

const toCamelCase = (value) => {
  if (Array.isArray(value)) {
    return value.map((item) => toCamelCase(item));
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [toCamelKey(key), toCamelCase(item)]),
  );
};

const normalizeCluster = (clusterData) => {
  if (!clusterData) {
    return {};
  }
  const camelData = toCamelCase(clusterData);

  return {
    clusterId: String(camelData.id || ''),
    clusterName: camelData.name || '',
    status: camelData.status === undefined || camelData.status === null ? '' : String(camelData.status),
    riskLevel: '',
    createdAt: String(camelData.createdAt || ''),
    updatedAt: String(camelData.updatedAt || ''),
    // Extended fields
    apiVersion: camelData.apiVersion || '',
    masterIps: camelData.masterIps || [],
    moduleStatus: camelData.moduleStatus || [],
    clusterType: camelData.clusterType || 0,
    reachable: camelData.reachable || 0,
    integrationStatus: camelData.integrationStatus || 0,
  };
};

const normalizeVulnEvent = (vulnData) => {
  if (!vulnData) {
    return {};
  }
  const camelData = toCamelCase(vulnData);

  return {
    eventId: String(camelData.id || ''),
    clusterId: String(camelData.clusterId || ''),
    microserviceId: camelData.serviceUid || '',
    microserviceName: camelData.serviceName || '',
    level: camelData.risk === undefined || camelData.risk === null ? '' : String(camelData.risk),
    status: camelData.manageStatus === undefined || camelData.manageStatus === null ? '' : String(camelData.manageStatus),
    title: camelData.name || '',
    cve: camelData.cve || '',
    cnvd: camelData.cnvd || '',
    cnnvd: camelData.cnnvd || '',
    packageName: '',
    packageVersion: String(camelData.packageVersion || ''),
    fixedVersion: String(camelData.fixedVersion || ''),
    imageName: '',
    discoveredAt: String(camelData.discoveryTime || camelData.firstDiscoveryTime || ''),
    updatedAt: String(camelData.lastDiscoveryTime || camelData.discoveryTime || ''),
    // Extended fields
    nodeName: camelData.nodeName || '',
    clusterName: camelData.clusterName || '',
    risk: camelData.risk || 0,
    originalRisk: camelData.originalRisk || 0,
    customRisk: camelData.customRisk || 0,
    characteristic: camelData.characteristic || [],
    serviceUid: camelData.serviceUid || '',
    serviceType: camelData.serviceType || '',
    description: camelData.description || '',
    solution: camelData.solution || '',
    manageStatus: camelData.manageStatus || 0,
    nodeExist: camelData.nodeExist || false,
    firstDiscoveryTime: String(camelData.firstDiscoveryTime || ''),
    lastDiscoveryTime: String(camelData.lastDiscoveryTime || ''),
  };
};

const buildPaginationQuery = ({ pageSize, pageToken } = {}) => {
  const query = new URLSearchParams();

  if (Number.isInteger(pageSize) && pageSize > 0) {
    query.set('page_size', String(pageSize));
  }

  if (pageToken) {
    query.set('offset', String(pageToken));
  }

  return query;
};

const appendScalarQuery = (query, entries) => {
  for (const [key, value] of entries) {
    if (value === undefined || value === null) {
      continue;
    }
    if (typeof value === 'string' && value.trim() === '') {
      continue;
    }
    // Skip numeric zero values — they are proto3 defaults and not meaningful filter parameters
    if (typeof value === 'number' && value === 0) {
      continue;
    }
    query.set(key, String(value));
  }

  return query;
};

const appendRepeatedQuery = (query, key, values) => {
  if (!Array.isArray(values) || values.length === 0) {
    return query;
  }

  for (const value of values) {
    if (value === undefined || value === null) {
      continue;
    }
    if (typeof value === 'string' && value.trim() === '') {
      continue;
    }
    query.append(key, String(value));
  }

  return query;
};

const hasMeaningfulValue = (value) => {
  if (value === undefined || value === null) {
    return false;
  }
  if (typeof value === 'string') {
    return value.trim() !== '';
  }
  if (Array.isArray(value)) {
    return value.some((item) => hasMeaningfulValue(item));
  }
  return true;
};

const isHtmlResponseError = (error) => (
  error instanceof CloudWalkerError
  && error.httpStatus === 200
  && typeof error.details === 'string'
  && error.details.toLowerCase().includes('<!doctype html>')
);

const isNetworkError = (error) => (
  error instanceof CloudWalkerError
  && error.httpStatus === undefined
);

const normalizeComparableString = (value) => String(value || '').trim();

const collectFilteredItems = async ({
  request = {},
  fetchPage,
  matchesItem,
  scanPageSize = 50,
  maxPages = 10,
}) => {
  const targetCount = Number.isInteger(request.pageSize) && request.pageSize > 0 ? request.pageSize : scanPageSize;
  const pageSize = Math.max(targetCount, scanPageSize);
  let pageToken = request.pageToken || '';
  let lastNextPageToken = '';
  const matched = [];

  for (let page = 0; page < maxPages && matched.length < targetCount; page += 1) {
    const result = await fetchPage({ pageSize, pageToken });
    const items = result.items || [];
    lastNextPageToken = result.nextPageToken || '';

    if (items.length === 0) {
      break;
    }

    for (const item of items) {
      if (await matchesItem(item)) {
        matched.push(item);
        if (matched.length >= targetCount) {
          break;
        }
      }
    }

    if (!lastNextPageToken) {
      break;
    }

    pageToken = lastNextPageToken;
  }

  return {
    items: matched.slice(0, targetCount),
    nextPageToken: lastNextPageToken || '',
  };
};

const buildListClustersQuery = (request = {}) => {
  const query = buildPaginationQuery(request);
  return appendScalarQuery(query, [
    ['name', request.name],
    ['status', request.status],
  ]);
};

const buildListClusterVulnEventsQuery = ({ clusterId, pageSize, pageToken, cve, name, cnvd, cnnvd, nodeName, clusterName, orderBy, risk, state, characteristic, order } = {}) => {
  const query = buildPaginationQuery({ pageSize, pageToken });

  appendScalarQuery(query, [
    ['cluster_id', clusterId],
    ['cve', cve],
    ['name', name],
    ['cnvd', cnvd],
    ['cnnvd', cnnvd],
    ['node_name', nodeName],
    ['cluster_name', clusterName],
    ['order_by', orderBy],
    ['order', order],
  ]);

  appendRepeatedQuery(query, 'risk', risk);
  appendRepeatedQuery(query, 'state', state);
  appendRepeatedQuery(query, 'characteristic', characteristic);

  return query;
};

const buildListMicroserviceVulnEventsQuery = ({ pageSize, pageToken, serviceName, serviceType, clusterName, name, cve, cnvd, cnnvd, orderBy, characteristic, risk, state, order } = {}) => {
  const query = buildPaginationQuery({ pageSize, pageToken });

  appendScalarQuery(query, [
    ['service_name', serviceName],
    ['service_type', serviceType],
    ['cluster_name', clusterName],
    ['name', name],
    ['cve', cve],
    ['cnvd', cnvd],
    ['cnnvd', cnnvd],
    ['order_by', orderBy],
    ['order', order],
  ]);

  appendRepeatedQuery(query, 'characteristic', characteristic);
  appendRepeatedQuery(query, 'risk', risk);
  appendRepeatedQuery(query, 'state', state);

  return query;
};

const enrichVulnEventsWithDetails = async (events, detailCache, loadDetail) => {
  const enriched = [];

  for (const event of events) {
    if (!detailCache.has(event.eventId)) {
      detailCache.set(event.eventId, normalizeVulnEvent(await loadDetail(event.eventId)));
    }
    const detail = detailCache.get(event.eventId);
    enriched.push(detail ? { ...detail, ...event, cnvd: detail.cnvd || event.cnvd || '', cnnvd: detail.cnnvd || event.cnnvd || '' } : event);
  }

  return enriched;
};

const normalizeListPayload = (payload, collectionKey) => {
  const camelPayload = toCamelCase(payload);

  // CloudWalker API returns {data: {data: [...]}} format
  const candidate = camelPayload?.data?.data || camelPayload.items || camelPayload[collectionKey];
  const rawItems = Array.isArray(candidate) ? candidate : [];

  // Normalize each item based on collection type
  let items;
  if (collectionKey === 'clusters') {
    items = rawItems.map(normalizeCluster);
  } else if (collectionKey === 'vulnEvents') {
    items = rawItems.map(normalizeVulnEvent);
  } else {
    items = rawItems;
  }

  return {
    [collectionKey]: items,
    nextPageToken: camelPayload.nextPageToken ?? '',
  };
};

const readPayload = async (response) => {
  const text = await response.text();

  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
};

const isJsonContentType = (contentType) => {
  if (!contentType) {
    return false;
  }

  return contentType.includes('application/json') || contentType.includes('+json');
};

const buildHttpError = (status, payload) => {
  const message = payload?.message || payload?.error || `CloudWalker upstream returned HTTP ${status}`;
  let code = grpcStatus.UNAVAILABLE;

  if (status === 400) {
    code = grpcStatus.INVALID_ARGUMENT;
  } else if (status === 401) {
    code = grpcStatus.UNAUTHENTICATED;
  } else if (status === 403) {
    code = grpcStatus.PERMISSION_DENIED;
  } else if (status === 404) {
    code = grpcStatus.NOT_FOUND;
  } else if (status === 409) {
    code = grpcStatus.ALREADY_EXISTS;
  } else if (status === 429) {
    code = grpcStatus.RESOURCE_EXHAUSTED;
  } else if (status === 412) {
    code = grpcStatus.FAILED_PRECONDITION;
  } else if (status === 504) {
    code = grpcStatus.DEADLINE_EXCEEDED;
  }

  return new CloudWalkerError(message, {
    code,
    details: message,
    httpStatus: status,
  });
};

export class CloudWalkerClient {
  constructor({ baseUrl, token, cookie = '', referer = '', fetchImpl }) {
    this.baseUrl = String(baseUrl || '').replace(/\/$/, '');
    this.token = token;
    this.cookie = cookie;
    this.referer = referer;
    // Use provided fetchImpl or fall back to global fetch
    // Note: In some environments, global fetch may have issues with HTTPS
    this.fetchImpl = fetchImpl || fetch;
  }

  async get(path, query) {
    const url = new URL(`${this.baseUrl}${path}`);
    if (query && query.toString()) {
      url.search = query.toString();
    }

    const headers = {
      accept: 'application/json, text/plain, */*',
      authorization: `Bearer ${this.token}`,
      token: this.token,
      'x-auth-token': this.token,
      'x-requested-with': 'XMLHttpRequest',
    };

    if (this.cookie) {
      headers.cookie = this.cookie;
    }

    if (this.referer) {
      headers.referer = this.referer;
    }

    let response;
    try {
      response = await this.fetchImpl(url, {
        method: 'GET',
        headers,
      });
    } catch (networkError) {
      throw new CloudWalkerError(networkError.message || 'CloudWalker upstream unreachable', {
        code: grpcStatus.UNAVAILABLE,
        details: networkError.message || 'Network error',
        httpStatus: undefined,
      });
    }

    const payload = await readPayload(response);
    if (!response.ok) {
      throw buildHttpError(response.status, payload);
    }

    const contentType = response.headers.get('content-type') || '';
    if (!isJsonContentType(contentType)) {
      throw new CloudWalkerError('CloudWalker upstream returned non-JSON content', {
        code: grpcStatus.UNAVAILABLE,
        details: payload?.message || `Unexpected content-type: ${contentType || 'unknown'}`,
        httpStatus: response.status,
      });
    }

    return payload ?? {};
  }

  async listClusters(request) {
    try {
      return normalizeListPayload(await this.get(endpoints.listClusters, buildListClustersQuery(request)), 'clusters');
    } catch (error) {
      if (isNetworkError(error) || !isHtmlResponseError(error) || (!hasMeaningfulValue(request?.name) && !hasMeaningfulValue(request?.status))) {
        throw error;
      }

      const fallback = await collectFilteredItems({
        request,
        fetchPage: async ({ pageSize, pageToken }) => {
          const payload = await this.get(endpoints.listClusters, buildPaginationQuery({ pageSize, pageToken }));
          const response = normalizeListPayload(payload, 'clusters');
          return {
            items: response.clusters,
            nextPageToken: response.nextPageToken,
          };
        },
        matchesItem: async (cluster) => {
          if (hasMeaningfulValue(request.name) && normalizeComparableString(cluster.clusterName) !== normalizeComparableString(request.name)) {
            return false;
          }
          if (hasMeaningfulValue(request.status) && String(cluster.status) !== String(request.status)) {
            return false;
          }
          return true;
        },
      });

      return {
        clusters: fallback.items,
        nextPageToken: fallback.nextPageToken,
      };
    }
  }

  async getClusterInfo({ clusterId }) {
    const query = new URLSearchParams();
    query.set('cluster_id', clusterId);
    const response = await this.get(endpoints.getClusterInfo, query);

    // CloudWalker API returns {data: {data: {cluster_info: {...}}}} format
    const clusterInfo = response?.data?.data?.cluster_info || response?.clusterInfo || response;

    return normalizeCluster(clusterInfo);
  }

  async getClusterVulnEventPayload(eventId) {
    const query = new URLSearchParams();
    query.set('id', eventId);
    const response = await this.get(endpoints.getClusterVulnEvent, query);
    return response?.data || response;
  }

  async getClusterVulnEvent({ eventId }) {
    return normalizeVulnEvent(await this.getClusterVulnEventPayload(eventId));
  }

  async listClusterVulnEvents(request) {
    const requiresFallback = hasMeaningfulValue(request?.clusterName) || hasMeaningfulValue(request?.cnvd) || hasMeaningfulValue(request?.cnnvd);
    const needsDetailEnrichment = hasMeaningfulValue(request?.cnvd) || hasMeaningfulValue(request?.cnnvd);
    const detailCache = new Map();

    if (!requiresFallback) {
      return normalizeListPayload(await this.get(endpoints.listClusterVulnEvents, buildListClusterVulnEventsQuery(request)), 'vulnEvents');
    }

    let directError = null;
    try {
      const direct = await this.get(endpoints.listClusterVulnEvents, buildListClusterVulnEventsQuery(request));
      const normalized = normalizeListPayload(direct, 'vulnEvents');
      if (!hasMeaningfulValue(request?.clusterName) || normalized.vulnEvents.length > 0) {
        if (!needsDetailEnrichment) {
          return normalized;
        }
        return {
          vulnEvents: await enrichVulnEventsWithDetails(normalized.vulnEvents, detailCache, (eventId) => this.getClusterVulnEventPayload(eventId)),
          nextPageToken: normalized.nextPageToken,
        };
      }
    } catch (error) {
      directError = error;
      if (isNetworkError(error) || !(isHtmlResponseError(error) || error instanceof CloudWalkerError)) {
        throw error;
      }
    }

    const fallbackRequest = {
      ...request,
      clusterName: undefined,
      cnvd: undefined,
      cnnvd: undefined,
    };

    const fallback = await collectFilteredItems({
      request,
      fetchPage: async ({ pageSize, pageToken }) => {
        const payload = await this.get(endpoints.listClusterVulnEvents, buildListClusterVulnEventsQuery({ ...fallbackRequest, pageSize, pageToken }));
        const response = normalizeListPayload(payload, 'vulnEvents');
        return {
          items: response.vulnEvents,
          nextPageToken: response.nextPageToken,
        };
      },
      matchesItem: async (event) => {
        let detail = null;
        if (hasMeaningfulValue(request.clusterName) || hasMeaningfulValue(request.cnvd) || hasMeaningfulValue(request.cnnvd)) {
          if (!detailCache.has(event.eventId)) {
            detailCache.set(event.eventId, normalizeVulnEvent(await this.getClusterVulnEventPayload(event.eventId)));
          }
          detail = detailCache.get(event.eventId);
        }

        const candidateClusterName = detail?.clusterName || event.clusterName;
        if (hasMeaningfulValue(request.clusterName) && normalizeComparableString(candidateClusterName) !== normalizeComparableString(request.clusterName)) {
          return false;
        }

        if (hasMeaningfulValue(request.cnvd) && normalizeComparableString(detail?.cnvd) !== normalizeComparableString(request.cnvd)) {
          return false;
        }
        if (hasMeaningfulValue(request.cnnvd) && normalizeComparableString(detail?.cnnvd) !== normalizeComparableString(request.cnnvd)) {
          return false;
        }

        return true;
      },
    });

    if (fallback.items.length > 0 || directError) {
      return {
        vulnEvents: await enrichVulnEventsWithDetails(fallback.items, detailCache, (eventId) => this.getClusterVulnEventPayload(eventId)),
        nextPageToken: fallback.nextPageToken,
      };
    }

    return {
      vulnEvents: fallback.items,
      nextPageToken: fallback.nextPageToken,
    };
  }

  async getMicroserviceVulnEventPayload(eventId) {
    const query = new URLSearchParams();
    query.set('id', eventId);
    const response = await this.get(endpoints.getMicroserviceVulnEvent, query);
    return response?.data || response;
  }

  async getMicroserviceVulnEvent({ eventId }) {
    return normalizeVulnEvent(await this.getMicroserviceVulnEventPayload(eventId));
  }

  async listMicroserviceVulnEvents(request) {
    const requiresFallback = hasMeaningfulValue(request?.clusterName) || hasMeaningfulValue(request?.cnvd) || hasMeaningfulValue(request?.cnnvd);
    const needsDetailEnrichment = hasMeaningfulValue(request?.cnvd) || hasMeaningfulValue(request?.cnnvd);
    const detailCache = new Map();

    if (!requiresFallback) {
      return normalizeListPayload(await this.get(endpoints.listMicroserviceVulnEvents, buildListMicroserviceVulnEventsQuery(request)), 'vulnEvents');
    }

    let directError = null;
    try {
      const direct = await this.get(endpoints.listMicroserviceVulnEvents, buildListMicroserviceVulnEventsQuery(request));
      const normalized = normalizeListPayload(direct, 'vulnEvents');
      if (!hasMeaningfulValue(request?.clusterName) || normalized.vulnEvents.length > 0) {
        if (!needsDetailEnrichment) {
          return normalized;
        }
        return {
          vulnEvents: await enrichVulnEventsWithDetails(normalized.vulnEvents, detailCache, (eventId) => this.getMicroserviceVulnEventPayload(eventId)),
          nextPageToken: normalized.nextPageToken,
        };
      }
    } catch (error) {
      directError = error;
      if (isNetworkError(error) || !(isHtmlResponseError(error) || error instanceof CloudWalkerError)) {
        throw error;
      }
    }

    const fallbackRequest = {
      ...request,
      clusterName: undefined,
      cnvd: undefined,
      cnnvd: undefined,
    };

    const fallback = await collectFilteredItems({
      request,
      fetchPage: async ({ pageSize, pageToken }) => {
        const payload = await this.get(endpoints.listMicroserviceVulnEvents, buildListMicroserviceVulnEventsQuery({ ...fallbackRequest, pageSize, pageToken }));
        const response = normalizeListPayload(payload, 'vulnEvents');
        return {
          items: response.vulnEvents,
          nextPageToken: response.nextPageToken,
        };
      },
      matchesItem: async (event) => {
        let detail = null;
        if (hasMeaningfulValue(request.clusterName) || hasMeaningfulValue(request.cnvd) || hasMeaningfulValue(request.cnnvd)) {
          if (!detailCache.has(event.eventId)) {
            detailCache.set(event.eventId, normalizeVulnEvent(await this.getMicroserviceVulnEventPayload(event.eventId)));
          }
          detail = detailCache.get(event.eventId);
        }

        const candidateClusterName = detail?.clusterName || event.clusterName;
        if (hasMeaningfulValue(request.clusterName) && normalizeComparableString(candidateClusterName) !== normalizeComparableString(request.clusterName)) {
          return false;
        }

        if (hasMeaningfulValue(request.cnvd) && normalizeComparableString(detail?.cnvd) !== normalizeComparableString(request.cnvd)) {
          return false;
        }
        if (hasMeaningfulValue(request.cnnvd) && normalizeComparableString(detail?.cnnvd) !== normalizeComparableString(request.cnnvd)) {
          return false;
        }

        return true;
      },
    });

    if (fallback.items.length > 0 || directError) {
      return {
        vulnEvents: await enrichVulnEventsWithDetails(fallback.items, detailCache, (eventId) => this.getMicroserviceVulnEventPayload(eventId)),
        nextPageToken: fallback.nextPageToken,
      };
    }

    return {
      vulnEvents: fallback.items,
      nextPageToken: fallback.nextPageToken,
    };
  }
}

export const createClient = (options) => new CloudWalkerClient(options);
export { CloudWalkerError, grpcStatus, toCamelCase, collectFilteredItems };

// --- SDK handler conventions ---

const METHOD_LIST_CLUSTERS_PATH = '/Chaitin_CloudWalker.Chaitin_CloudWalker/ListClusters';
const METHOD_GET_CLUSTER_INFO_PATH = '/Chaitin_CloudWalker.Chaitin_CloudWalker/GetClusterInfo';
const METHOD_LIST_CLUSTER_VULN_EVENTS_PATH = '/Chaitin_CloudWalker.Chaitin_CloudWalker/ListClusterVulnEvents';
const METHOD_GET_CLUSTER_VULN_EVENT_PATH = '/Chaitin_CloudWalker.Chaitin_CloudWalker/GetClusterVulnEvent';
const METHOD_LIST_MICROSERVICE_VULN_EVENTS_PATH = '/Chaitin_CloudWalker.Chaitin_CloudWalker/ListMicroserviceVulnEvents';
const METHOD_GET_MICROSERVICE_VULN_EVENT_PATH = '/Chaitin_CloudWalker.Chaitin_CloudWalker/GetMicroserviceVulnEvent';

const METHOD_LIST_CLUSTERS_FULL = 'Chaitin_CloudWalker.Chaitin_CloudWalker/ListClusters';
const METHOD_GET_CLUSTER_INFO_FULL = 'Chaitin_CloudWalker.Chaitin_CloudWalker/GetClusterInfo';
const METHOD_LIST_CLUSTER_VULN_EVENTS_FULL = 'Chaitin_CloudWalker.Chaitin_CloudWalker/ListClusterVulnEvents';
const METHOD_GET_CLUSTER_VULN_EVENT_FULL = 'Chaitin_CloudWalker.Chaitin_CloudWalker/GetClusterVulnEvent';
const METHOD_LIST_MICROSERVICE_VULN_EVENTS_FULL = 'Chaitin_CloudWalker.Chaitin_CloudWalker/ListMicroserviceVulnEvents';
const METHOD_GET_MICROSERVICE_VULN_EVENT_FULL = 'Chaitin_CloudWalker.Chaitin_CloudWalker/GetMicroserviceVulnEvent';

const mergedBindings = (ctx = {}) => ({
  ...(ctx.config ?? {}),
  ...(ctx.secret ?? {}),
  ...(ctx.bindings ?? {}),
});

const resolveCallContext = (ctx = {}) => ({
  ...ctx,
  bindings: mergedBindings(ctx),
  limits: ctx.limits ?? {},
  meta: ctx.meta ?? {},
  req: ctx.request ?? ctx.req ?? {},
});

const resolveBaseUrl = (bindings) =>
  bindings.baseUrl || bindings.base_url || bindings.host || 'http://127.0.0.1:18080';

const resolveToken = (bindings) =>
  bindings.token || bindings.accessToken || bindings.access_token || '';

const resolveCookie = (bindings) =>
  bindings.cookie || '';

const resolveReferer = (bindings) =>
  bindings.referer || '';

const buildClientOptions = (ctx = {}) => {
  const callCtx = resolveCallContext(ctx);
  const bindings = callCtx.bindings;
  return {
    baseUrl: resolveBaseUrl(bindings),
    token: resolveToken(bindings),
    cookie: resolveCookie(bindings),
    referer: resolveReferer(bindings),
  };
};

const handleListClusters = async (req, callCtx) => {
  const client = createClient(buildClientOptions(callCtx));
  return client.listClusters(req);
};

const handleGetClusterInfo = async (req, callCtx) => {
  const client = createClient(buildClientOptions(callCtx));
  return client.getClusterInfo(req);
};

const handleListClusterVulnEvents = async (req, callCtx) => {
  const client = createClient(buildClientOptions(callCtx));
  return client.listClusterVulnEvents(req);
};

const handleGetClusterVulnEvent = async (req, callCtx) => {
  const client = createClient(buildClientOptions(callCtx));
  return client.getClusterVulnEvent(req);
};

const handleListMicroserviceVulnEvents = async (req, callCtx) => {
  const client = createClient(buildClientOptions(callCtx));
  return client.listMicroserviceVulnEvents(req);
};

const handleGetMicroserviceVulnEvent = async (req, callCtx) => {
  const client = createClient(buildClientOptions(callCtx));
  return client.getMicroserviceVulnEvent(req);
};

const registerHandlers = (ctx = {}) => {
  const callCtx = resolveCallContext(ctx);
  return {
    [METHOD_LIST_CLUSTERS_PATH]: (req = callCtx.req) => handleListClusters(req ?? {}, callCtx),
    [METHOD_GET_CLUSTER_INFO_PATH]: (req = callCtx.req) => handleGetClusterInfo(req ?? {}, callCtx),
    [METHOD_LIST_CLUSTER_VULN_EVENTS_PATH]: (req = callCtx.req) => handleListClusterVulnEvents(req ?? {}, callCtx),
    [METHOD_GET_CLUSTER_VULN_EVENT_PATH]: (req = callCtx.req) => handleGetClusterVulnEvent(req ?? {}, callCtx),
    [METHOD_LIST_MICROSERVICE_VULN_EVENTS_PATH]: (req = callCtx.req) => handleListMicroserviceVulnEvents(req ?? {}, callCtx),
    [METHOD_GET_MICROSERVICE_VULN_EVENT_PATH]: (req = callCtx.req) => handleGetMicroserviceVulnEvent(req ?? {}, callCtx),
  };
};

export function rpcdef(ctx = {}) {
  return registerHandlers(ctx);
}

const callSdkHandler = (ctx, path) => registerHandlers(ctx)[path](ctx?.request ?? ctx?.req ?? {});

export const handlers = {
  [METHOD_LIST_CLUSTERS_FULL]: (ctx) => callSdkHandler(ctx, METHOD_LIST_CLUSTERS_PATH),
  [METHOD_GET_CLUSTER_INFO_FULL]: (ctx) => callSdkHandler(ctx, METHOD_GET_CLUSTER_INFO_PATH),
  [METHOD_LIST_CLUSTER_VULN_EVENTS_FULL]: (ctx) => callSdkHandler(ctx, METHOD_LIST_CLUSTER_VULN_EVENTS_PATH),
  [METHOD_GET_CLUSTER_VULN_EVENT_FULL]: (ctx) => callSdkHandler(ctx, METHOD_GET_CLUSTER_VULN_EVENT_PATH),
  [METHOD_LIST_MICROSERVICE_VULN_EVENTS_FULL]: (ctx) => callSdkHandler(ctx, METHOD_LIST_MICROSERVICE_VULN_EVENTS_PATH),
  [METHOD_GET_MICROSERVICE_VULN_EVENT_FULL]: (ctx) => callSdkHandler(ctx, METHOD_GET_MICROSERVICE_VULN_EVENT_PATH),
};

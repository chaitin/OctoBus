const grpcStatus = Object.freeze({
  NOT_FOUND: 5,
  UNAUTHENTICATED: 16,
  UNAVAILABLE: 14,
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
  const camelData = toCamelCase(clusterData);

  return {
    clusterId: String(camelData.id || ''),
    clusterName: camelData.name || '',
    status: String(camelData.status || ''),
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
  const camelData = toCamelCase(vulnData);

  return {
    eventId: String(camelData.id || ''),
    clusterId: String(camelData.clusterId || ''),
    microserviceId: camelData.serviceUid || '',
    microserviceName: camelData.serviceName || '',
    level: String(camelData.risk || ''),
    status: String(camelData.manageStatus || ''),
    title: camelData.name || '',
    cve: camelData.cve || '',
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

  if (pageSize) {
    query.set('page_size', String(pageSize));
  }

  if (pageToken) {
    query.set('offset', pageToken);
  }

  return query;
};

const normalizeListPayload = (payload, collectionKey) => {
  const camelPayload = toCamelCase(payload);

  // CloudWalker API returns {data: {data: [...]}} format
  const rawItems = camelPayload?.data?.data || camelPayload.items || camelPayload[collectionKey] || [];

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

  if (status === 401) {
    code = grpcStatus.UNAUTHENTICATED;
  } else if (status === 404) {
    code = grpcStatus.NOT_FOUND;
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

    const response = await this.fetchImpl(url, {
      method: 'GET',
      headers,
    });

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
    return normalizeListPayload(await this.get(endpoints.listClusters, buildPaginationQuery(request)), 'clusters');
  }

  async getClusterInfo({ clusterId }) {
    const query = new URLSearchParams();
    query.set('cluster_id', clusterId);
    const response = await this.get(endpoints.getClusterInfo, query);

    // CloudWalker API returns {data: {data: {cluster_info: {...}}}} format
    const clusterInfo = response?.data?.data?.cluster_info || response?.clusterInfo || response;

    return normalizeCluster(clusterInfo);
  }

  async listClusterVulnEvents({ clusterId, ...request }) {
    const query = buildPaginationQuery(request);
    if (clusterId) {
      query.set('cluster_id', clusterId);
    }
    return normalizeListPayload(await this.get(endpoints.listClusterVulnEvents, query), 'vulnEvents');
  }

  async getClusterVulnEvent({ eventId }) {
    const query = new URLSearchParams();
    query.set('id', eventId);
    const response = await this.get(endpoints.getClusterVulnEvent, query);

    // CloudWalker API returns {data: {...}} format
    const vulnEventData = response?.data || response;

    return normalizeVulnEvent(vulnEventData);
  }

  async listMicroserviceVulnEvents(request) {
    return normalizeListPayload(await this.get(endpoints.listMicroserviceVulnEvents, buildPaginationQuery(request)), 'vulnEvents');
  }

  async getMicroserviceVulnEvent({ eventId }) {
    const query = new URLSearchParams();
    query.set('id', eventId);
    const response = await this.get(endpoints.getMicroserviceVulnEvent, query);

    // CloudWalker API returns {data: {...}} format
    const vulnEventData = response?.data || response;

    return normalizeVulnEvent(vulnEventData);
  }
}

export const createClient = (options) => new CloudWalkerClient(options);
export { CloudWalkerError, grpcStatus, toCamelCase };

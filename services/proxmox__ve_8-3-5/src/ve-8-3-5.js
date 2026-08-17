import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';
import { Agent } from 'undici';

export const METHOD_LIST_NODES_PATH = '/Proxmox_VE_8_3_5.Proxmox_VE_8_3_5/ListNodes';
export const METHOD_LIST_QEMU_VMS_PATH = '/Proxmox_VE_8_3_5.Proxmox_VE_8_3_5/ListQemuVMs';
export const METHOD_GET_QEMU_VM_CONFIG_PATH = '/Proxmox_VE_8_3_5.Proxmox_VE_8_3_5/GetQemuVMConfig';
export const METHOD_LIST_LXCS_PATH = '/Proxmox_VE_8_3_5.Proxmox_VE_8_3_5/ListLXCs';
export const METHOD_LIST_STORAGE_PATH = '/Proxmox_VE_8_3_5.Proxmox_VE_8_3_5/ListStorage';
export const METHOD_GET_NODE_STATUS_PATH = '/Proxmox_VE_8_3_5.Proxmox_VE_8_3_5/GetNodeStatus';

export const METHOD_LIST_NODES_FULL = 'Proxmox_VE_8_3_5.Proxmox_VE_8_3_5/ListNodes';
export const METHOD_LIST_QEMU_VMS_FULL = 'Proxmox_VE_8_3_5.Proxmox_VE_8_3_5/ListQemuVMs';
export const METHOD_GET_QEMU_VM_CONFIG_FULL = 'Proxmox_VE_8_3_5.Proxmox_VE_8_3_5/GetQemuVMConfig';
export const METHOD_LIST_LXCS_FULL = 'Proxmox_VE_8_3_5.Proxmox_VE_8_3_5/ListLXCs';
export const METHOD_LIST_STORAGE_FULL = 'Proxmox_VE_8_3_5.Proxmox_VE_8_3_5/ListStorage';
export const METHOD_GET_NODE_STATUS_FULL = 'Proxmox_VE_8_3_5.Proxmox_VE_8_3_5/GetNodeStatus';

export const DEFAULT_TIMEOUT_MS = 5000;
export const MAX_TIMEOUT_MS = 60_000;
export const MAX_RESPONSE_BYTES = 1024 * 1024;
export const API_PREFIX = '/api2/json';
export const NODE_NAME_RE = /^[A-Za-z0-9_.-]{1,64}$/;
export const VMID_MAX = 9_999_999_999;

const METHOD_PATHS = {
  LIST_NODES: METHOD_LIST_NODES_PATH,
  LIST_QEMU_VMS: METHOD_LIST_QEMU_VMS_PATH,
  GET_QEMU_VM_CONFIG: METHOD_GET_QEMU_VM_CONFIG_PATH,
  LIST_LXCS: METHOD_LIST_LXCS_PATH,
  LIST_STORAGE: METHOD_LIST_STORAGE_PATH,
  GET_NODE_STATUS: METHOD_GET_NODE_STATUS_PATH,
};

const grpcCodeFor = (code) => ({
  FAILED_PRECONDITION: grpcStatus.FAILED_PRECONDITION,
  INVALID_ARGUMENT: grpcStatus.INVALID_ARGUMENT,
  PERMISSION_DENIED: grpcStatus.PERMISSION_DENIED,
  UNAVAILABLE: grpcStatus.UNAVAILABLE,
  UNKNOWN: grpcStatus.UNKNOWN,
})[code] ?? grpcStatus.UNKNOWN;

const engineError = (code, message) => {
  const err = new GrpcError(grpcCodeFor(code), `${code}: ${message}`);
  err.legacyCode = code;
  return err;
};

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj ?? {}, key);

const unwrapScalar = (value) => {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'object' && hasOwn(value, 'value')) return unwrapScalar(value.value);
  return value;
};

const pickString = (value) => {
  const raw = unwrapScalar(value);
  if (raw === undefined || raw === null) return '';
  return String(raw).trim();
};

const pickFirstString = (values = []) => {
  for (const value of values) {
    const str = pickString(value);
    if (str) return str;
  }
  return '';
};

const pickInt = (value) => {
  const raw = unwrapScalar(value);
  if (raw === undefined || raw === null || raw === '') return 0;
  const num = Number(raw);
  if (!Number.isFinite(num)) return 0;
  return Math.trunc(num);
};

const pickLong = (value) => {
  const raw = unwrapScalar(value);
  if (raw === undefined || raw === null || raw === '') return 0;
  const num = Number(raw);
  if (!Number.isFinite(num)) return 0;
  return Math.trunc(num);
};

const pickDouble = (value) => {
  const raw = unwrapScalar(value);
  if (raw === undefined || raw === null || raw === '') return 0;
  const num = Number(raw);
  return Number.isFinite(num) ? num : 0;
};

const pickBoolean = (value) => {
  const raw = unwrapScalar(value);
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw === 'boolean') return raw;
  if (typeof raw === 'number') return Number.isNaN(raw) ? undefined : raw !== 0;
  if (typeof raw === 'string') {
    const normalized = raw.trim().toLowerCase();
    if (['true', '1', 'yes', 'y', 'on'].includes(normalized)) return true;
    if (['false', '0', 'no', 'n', 'off', ''].includes(normalized)) return false;
  }
  return undefined;
};

const pickFirstBoolean = (values = []) => {
  for (const value of values) {
    const bool = pickBoolean(value);
    if (bool !== undefined) return bool;
  }
  return undefined;
};

const HEADER_NAME_RE = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const FORBIDDEN_HEADERS = new Set([
  'authorization', 'cookie', 'host', 'connection', 'content-length',
  'proxy-authorization', 'transfer-encoding',
]);

const sanitizeHeaders = (headers) => {
  const raw = unwrapScalar(headers);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  return Object.fromEntries(Object.entries(raw).flatMap(([key, value]) => {
    const name = String(key).trim();
    const headerValue = String(unwrapScalar(value) ?? '');
    if (!HEADER_NAME_RE.test(name) || FORBIDDEN_HEADERS.has(name.toLowerCase()) || /[\r\n]/.test(headerValue)) return [];
    return [[name, headerValue]];
  }));
};

const normalizeBaseUrl = (raw) => {
  const value = pickString(raw);
  if (!value) return '';
  try {
    const parsed = new URL(value.replace(/\/+$/, ''));
    if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname || parsed.username || parsed.password || parsed.search || parsed.hash || !['', '/'].includes(parsed.pathname)) return '';
    return parsed.origin;
  } catch {
    return '';
  }
};

const isValidNodeName = (name) => NODE_NAME_RE.test(String(name ?? '').trim());

const isValidVmid = (value) => {
  const num = Number(unwrapScalar(value));
  return Number.isInteger(num) && num > 0 && num <= VMID_MAX;
};

const resolveCallContext = (ctx = {}) => ({
  ...ctx,
  bindings: {
    ...(ctx.config ?? {}),
    ...(ctx.secret ?? {}),
    ...(ctx.bindings ?? {}),
  },
  limits: ctx.limits ?? {},
  meta: ctx.meta ?? {},
  req: ctx.req ?? ctx.request ?? {},
});

const resolveBaseUrl = (bindings = {}, options = {}) => {
  const candidate = pickFirstString([
    bindings.baseUrl,
    bindings.base_url,
    bindings.host,
    bindings.restBaseUrl,
    bindings.url,
  ]);
  const normalized = normalizeBaseUrl(candidate);
  if (!normalized) {
    throw engineError('INVALID_ARGUMENT', 'bindings.baseUrl is required (e.g. https://pve.example.com:8006)');
  }
  const allowInsecure = pickFirstBoolean([bindings.allowInsecureHttp, bindings.allow_insecure_http, bindings.allowHttp]) === true;
  const isHttps = /^https:\/\//i.test(normalized);
  const isLoopbackHttp = /^http:\/\/(?:localhost|127(?:\.\d{1,3}){3}|\[::1\])(?::\d+)?$/i.test(normalized);
  if (!isHttps && !isLoopbackHttp && !allowInsecure && !options.allowHttp) {
    throw engineError('INVALID_ARGUMENT', 'bindings.baseUrl must use https (set allowInsecureHttp to allow http)');
  }
  return normalized;
};

const resolveToken = (bindings = {}) => {
  const tokenId = pickFirstString([bindings.tokenId, bindings.token_id]);
  const tokenSecret = pickFirstString([bindings.tokenSecret, bindings.token_secret]);
  if (!tokenId) {
    throw engineError('INVALID_ARGUMENT', 'secret.tokenId is required (format USER@REALM!TOKENID)');
  }
  if (!tokenSecret) {
    throw engineError('INVALID_ARGUMENT', 'secret.tokenSecret is required');
  }
  if (!/^[^=\r\n!]+![^=\r\n!]+$/.test(tokenId)) {
    throw engineError('INVALID_ARGUMENT', 'secret.tokenId must be in the form USER@REALM!TOKENID');
  }
  if (/[\r\n]/.test(tokenSecret)) throw engineError('INVALID_ARGUMENT', 'secret.tokenSecret contains an invalid character');
  return { tokenId, tokenSecret };
};

const buildAuthHeader = (token) => {
  if (!token?.tokenId || !token?.tokenSecret) {
    throw engineError('INVALID_ARGUMENT', 'token is missing tokenId or tokenSecret');
  }
  return `PVEAPIToken=${token.tokenId}=${token.tokenSecret}`;
};

const resolveTimeoutMs = (ctx = {}, fallback = DEFAULT_TIMEOUT_MS) => {
  const raw = Number(unwrapScalar(ctx.limits?.timeoutMs ?? ctx.bindings?.timeoutMs ?? ctx.bindings?.timeout_ms ?? ctx.bindings?.timeout ?? fallback));
  if (!Number.isFinite(raw) || raw <= 0) return fallback;
  return Math.min(Math.trunc(raw), MAX_TIMEOUT_MS);
};

const shouldSkipTls = (bindings = {}) => {
  const value = pickFirstBoolean([
    bindings.skipTlsVerify,
    bindings.tlsInsecureSkipVerify,
    bindings.insecureSkipVerify,
    bindings.tls_skip_verify,
  ]);
  return value === true;
};

const buildTlsDispatcher = (bindings = {}) => shouldSkipTls(bindings)
  ? new Agent({ connect: { rejectUnauthorized: false } })
  : undefined;

const buildHeaders = (bindings = {}, authHeader) => ({
  ...sanitizeHeaders(bindings.headers),
  Accept: 'application/json',
  Authorization: authHeader,
});

const buildLogPrefix = (meta = {}, action) => {
  const trace = [];
  if (meta.instance_id || meta.instanceId) trace.push(`inst=${meta.instance_id || meta.instanceId}`);
  if (meta.request_id || meta.requestId) trace.push(`req=${meta.request_id || meta.requestId}`);
  return `[Proxmox_VE_8_3_5][${action}]${trace.length ? `[${trace.join(' ')}]` : ''}`;
};

const logFlow = (ctx = {}, action, details) => {
  const prefix = buildLogPrefix(ctx.meta || {}, action);
  try {
    console.log(prefix, JSON.stringify(details));
  } catch {
    console.log(prefix, details);
  }
};

const readResponseText = async (response) => {
  const declaredLength = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
    throw engineError('UNAVAILABLE', 'upstream response exceeds the maximum allowed size');
  }
  if (!response.body?.getReader) {
    const text = await response.text();
    if (Buffer.byteLength(String(text), 'utf8') > MAX_RESPONSE_BYTES) {
      throw engineError('UNAVAILABLE', 'upstream response exceeds the maximum allowed size');
    }
    return text;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let byteLength = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw engineError('UNAVAILABLE', 'upstream response exceeds the maximum allowed size');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock?.();
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
};

const encodePath = (value) => encodeURIComponent(String(unwrapScalar(value) ?? ''));

const buildUrl = (baseUrl, segments = [], query = {}) => {
  const prefix = API_PREFIX;
  const cleanSegments = segments.filter((segment) => segment !== undefined && segment !== null && segment !== '');
  const path = cleanSegments.length === 0
    ? prefix
    : `${prefix}/${cleanSegments.map(encodePath).join('/')}`;
  const base = String(baseUrl || '').replace(/\/+$/, '');
  const queryEntries = Object.entries(query || {})
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
  const queryString = queryEntries.length ? `?${queryEntries.join('&')}` : '';
  return `${base}${path}${queryString}`;
};

const mapHttpStatus = (status) => {
  if (status === 401 || status === 403) return 'PERMISSION_DENIED';
  if (status >= 400 && status < 500) return 'FAILED_PRECONDITION';
  return 'UNAVAILABLE';
};

const parseJsonBody = (text) => {
  if (!text || !String(text).trim()) {
    throw engineError('UNKNOWN', 'response body is empty');
  }
  try {
    return JSON.parse(text);
  } catch {
    throw engineError('UNKNOWN', 'response is not valid JSON');
  }
};

const proxmoxRequest = async (ctx, segments, { method = 'GET', query, allowHttp = false } = {}) => {
  const callCtx = resolveCallContext(ctx);
  const bindings = callCtx.bindings || {};
  const baseUrl = resolveBaseUrl(bindings, { allowHttp });
  const token = resolveToken(bindings);
  const authHeader = buildAuthHeader(token);
  const timeoutMs = resolveTimeoutMs(callCtx);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const dispatcher = buildTlsDispatcher(bindings);
  const url = buildUrl(baseUrl, segments, query);
  logFlow(callCtx, 'request', { method, url, segments });

  try {
    const response = await fetch(url, {
      method,
      headers: buildHeaders(bindings, authHeader),
      signal: controller.signal,
      redirect: 'error',
      ...(dispatcher ? { dispatcher } : {}),
    });
    const text = await readResponseText(response);
    const httpStatus = Number(response.status || 0);
    logFlow(callCtx, 'fetch:response', { url, httpStatus, bodyLength: Buffer.byteLength(text, 'utf8') });

    if (!response.ok) {
      throw engineError(mapHttpStatus(httpStatus), `upstream http ${httpStatus}`);
    }
    return { httpStatus, text, json: parseJsonBody(text) };
  } catch (err) {
    if (err instanceof GrpcError) throw err;
    const reason = controller.signal.aborted ? 'timeout' : 'request failed';
    logFlow(callCtx, 'fetch:error', { url, error: reason });
    throw engineError('UNAVAILABLE', `upstream ${reason}`);
  } finally {
    clearTimeout(timer);
    if (dispatcher) await dispatcher.close();
  }
};

const requireNodeName = (req = {}, bindings = {}, methodLabel) => {
  const fromReq = pickFirstString([req.node, req.nodeName, req.name]);
  const node = fromReq || pickFirstString([bindings.defaultNode, bindings.default_node, bindings.node]);
  if (!node) {
    throw engineError('INVALID_ARGUMENT', `${methodLabel}: node is required (request.node or bindings.defaultNode)`);
  }
  if (!isValidNodeName(node)) {
    throw engineError('INVALID_ARGUMENT', `${methodLabel}: node name "${node}" is not a valid Proxmox node name`);
  }
  return node;
};

const requireVmid = (req = {}, methodLabel) => {
  const raw = unwrapScalar(req.vmid ?? req.vmId ?? req.VMID);
  if (raw === undefined || raw === null || raw === '') {
    throw engineError('INVALID_ARGUMENT', `${methodLabel}: vmid is required`);
  }
  const num = Number(raw);
  if (!Number.isInteger(num) || num <= 0 || num > VMID_MAX) {
    throw engineError('INVALID_ARGUMENT', `${methodLabel}: vmid must be a positive integer`);
  }
  return num;
};

const resolveVmidString = (value) => {
  const raw = unwrapScalar(value);
  if (raw === undefined || raw === null || raw === '') return 0;
  const num = Number(raw);
  if (!Number.isInteger(num) || num <= 0) return 0;
  return num;
};

const valueOrZeroLong = (value) => {
  const raw = unwrapScalar(value);
  if (raw === undefined || raw === null || raw === '') return 0;
  const num = Number(raw);
  if (!Number.isFinite(num)) return 0;
  return Math.trunc(num);
};

const valueOrZeroDouble = (value) => {
  const raw = unwrapScalar(value);
  if (raw === undefined || raw === null || raw === '') return 0;
  const num = Number(raw);
  return Number.isFinite(num) ? num : 0;
};

const wrapRawBody = (text) => String(text ?? '');

const asJsonValue = (value) => value === undefined ? null : value;

const buildNodeInfo = (entry) => {
  const raw = entry && typeof entry === 'object' ? entry : {};
  return {
    node: pickString(raw.node ?? raw.name),
    status: pickString(raw.status),
    cpu_usage: pickDouble(raw.cpu ?? raw.cpu_usage),
    cpu_count: pickLong(raw.cpu_count ?? raw.maxcpu ?? raw.cpus),
    max_cpu: pickLong(raw.maxcpu ?? raw.cpu_count ?? raw.cpus),
    mem_total: pickLong(raw.maxmem ?? raw.memory_total),
    mem_used: pickLong(raw.mem ?? raw.memory_used),
    disk_total: pickLong(raw.maxdisk ?? raw.disk_total),
    disk_used: pickLong(raw.disk ?? raw.disk_used),
    uptime: pickLong(raw.uptime),
    level: pickString(raw.level),
    ip: pickString(raw.ip ?? raw.ip_address ?? raw.addr),
    maxmem: pickLong(raw.maxmem),
    maxdisk: pickLong(raw.maxdisk),
    raw: asJsonValue(raw),
    ssl_fingerprint: pickString(raw.ssl_fingerprint),
  };
};

const buildQemuVMInfo = (entry) => {
  const raw = entry && typeof entry === 'object' ? entry : {};
  return {
    vmid: resolveVmidString(raw.vmid),
    name: pickString(raw.name),
    status: pickString(raw.status),
    cpus: valueOrZeroLong(raw.cpus),
    maxmem: valueOrZeroLong(raw.maxmem),
    mem: valueOrZeroLong(raw.mem),
    disk: valueOrZeroLong(raw.disk),
    maxdisk: valueOrZeroLong(raw.maxdisk),
    uptime: valueOrZeroLong(raw.uptime),
    node: pickString(raw.node),
    template: pickString(raw.template),
    raw: asJsonValue(raw),
    cpu: valueOrZeroDouble(raw.cpu),
    disk_read: valueOrZeroLong(raw.diskread),
    disk_write: valueOrZeroLong(raw.diskwrite),
    memhost: valueOrZeroLong(raw.memhost),
    net_in: valueOrZeroLong(raw.netin),
    net_out: valueOrZeroLong(raw.netout),
    pid: valueOrZeroLong(raw.pid),
    qmpstatus: pickString(raw.qmpstatus),
    running_machine: pickString(raw['running-machine']),
    running_qemu: pickString(raw['running-qemu']),
    serial: valueOrZeroLong(raw.serial),
    lock_status: pickString(raw.lock),
    tags: pickString(raw.tags),
    pressure_cpu_full: valueOrZeroDouble(raw.pressurecpufull),
    pressure_cpu_some: valueOrZeroDouble(raw.pressurecpusome),
    pressure_io_full: valueOrZeroDouble(raw.pressureiofull),
    pressure_io_some: valueOrZeroDouble(raw.pressureiosome),
    pressure_memory_full: valueOrZeroDouble(raw.pressurememoryfull),
    pressure_memory_some: valueOrZeroDouble(raw.pressurememorysome),
  };
};

const buildLXCInfo = (entry) => {
  const raw = entry && typeof entry === 'object' ? entry : {};
  return {
    vmid: resolveVmidString(raw.vmid),
    name: pickString(raw.name),
    status: pickString(raw.status),
    cpus: valueOrZeroLong(raw.cpus),
    maxmem: valueOrZeroLong(raw.maxmem),
    mem: valueOrZeroLong(raw.mem),
    disk: valueOrZeroLong(raw.disk),
    maxdisk: valueOrZeroLong(raw.maxdisk),
    uptime: valueOrZeroLong(raw.uptime),
    node: pickString(raw.node),
    template: pickString(raw.template),
    raw: asJsonValue(raw),
    cpu: valueOrZeroDouble(raw.cpu),
    disk_read: valueOrZeroLong(raw.diskread),
    disk_write: valueOrZeroLong(raw.diskwrite),
    max_swap: valueOrZeroLong(raw.maxswap),
    net_in: valueOrZeroLong(raw.netin),
    net_out: valueOrZeroLong(raw.netout),
    lock_status: pickString(raw.lock),
    tags: pickString(raw.tags),
    pressure_cpu_full: valueOrZeroDouble(raw.pressurecpufull),
    pressure_cpu_some: valueOrZeroDouble(raw.pressurecpusome),
    pressure_io_full: valueOrZeroDouble(raw.pressureiofull),
    pressure_io_some: valueOrZeroDouble(raw.pressureiosome),
    pressure_memory_full: valueOrZeroDouble(raw.pressurememoryfull),
    pressure_memory_some: valueOrZeroDouble(raw.pressurememorysome),
  };
};

const buildStorageInfo = (entry) => {
  const raw = entry && typeof entry === 'object' ? entry : {};
  const formats = unwrapScalar(raw.formats);
  let formatsJson = '';
  if (formats !== undefined && formats !== null && formats !== '') {
    try { formatsJson = typeof formats === 'string' ? formats : JSON.stringify(formats); }
    catch { formatsJson = ''; }
  }
  return {
    storage: pickString(raw.storage ?? raw.name),
    type: pickString(raw.type),
    total: valueOrZeroLong(raw.total),
    used: valueOrZeroLong(raw.used),
    avail: valueOrZeroLong(raw.avail),
    used_fraction: valueOrZeroDouble(raw.used_fraction ?? (raw.total ? Number(raw.used) / Number(raw.total) : 0)),
    content: pickString(raw.content),
    active: pickString(raw.active),
    enabled: pickString(raw.enabled),
    shared: pickBoolean(raw.shared) ?? false,
    raw: asJsonValue(raw),
    formats_json: formatsJson,
    select_existing: pickBoolean(raw.select_existing) ?? false,
  };
};

const buildNodeStatus = (raw, node) => {
  const data = raw && typeof raw === 'object' ? raw : {};
  const loadavg = Array.isArray(data.loadavg) ? data.loadavg : [];
  const cpuinfo = data.cpuinfo && typeof data.cpuinfo === 'object' ? data.cpuinfo : null;
  const bootInfo = data['boot-info'] && typeof data['boot-info'] === 'object' ? data['boot-info'] : null;
  const currentKernel = data['current-kernel'] && typeof data['current-kernel'] === 'object' ? data['current-kernel'] : null;
  const memory = data.memory && typeof data.memory === 'object' ? data.memory : null;
  const rootfs = data.rootfs && typeof data.rootfs === 'object' ? data.rootfs : null;
  const ksm = data.ksm && typeof data.ksm === 'object' ? data.ksm : null;
  return {
    node: pickString(data.node) || node,
    status: pickString(data.status),
    uptime: valueOrZeroLong(data.uptime),
    load_average_1m: valueOrZeroDouble(loadavg[0]),
    load_average_5m: valueOrZeroDouble(loadavg[1]),
    load_average_15m: valueOrZeroDouble(loadavg[2]),
    cpu_count: valueOrZeroLong(data.cpu_count ?? cpuinfo?.cpus),
    cpu_usage: valueOrZeroDouble(data.cpu ?? data.cpu_usage),
    memory_total: valueOrZeroLong(memory?.total),
    memory_used: valueOrZeroLong(memory?.used),
    memory_free: valueOrZeroLong(memory?.free),
    swap_total: valueOrZeroLong(data.swap?.total),
    swap_used: valueOrZeroLong(data.swap?.used),
    swap_free: valueOrZeroLong(data.swap?.free),
    kernel_version: pickString(data.kversion ?? data.kernel),
    pve_version: pickString(data.pveversion),
    cpuinfo: asJsonValue(cpuinfo),
    boot_info_mode: pickString(bootInfo?.mode),
    boot_info_secureboot: pickBoolean(bootInfo?.secureboot) ?? false,
    current_kernel_sysname: pickString(currentKernel?.sysname),
    current_kernel_release: pickString(currentKernel?.release),
    current_kernel_version: pickString(currentKernel?.version),
    current_kernel_machine: pickString(currentKernel?.machine),
    memory_available: valueOrZeroLong(memory?.available),
    rootfs_total: valueOrZeroLong(rootfs?.total),
    rootfs_used: valueOrZeroLong(rootfs?.used),
    rootfs_free: valueOrZeroLong(rootfs?.free),
    rootfs_available: valueOrZeroLong(rootfs?.avail),
    idle: valueOrZeroLong(data.idle),
    ksm_shared: valueOrZeroLong(ksm?.shared),
    wait: valueOrZeroDouble(data.wait),
  };
};

const buildQemuVMConfig = (raw, node, vmid) => {
  const data = raw && typeof raw === 'object' ? raw : {};
  return {
    vmid: resolveVmidString(data.vmid) || vmid,
    node: pickString(data.node) || node,
    name: pickString(data.name),
    memory: valueOrZeroLong(data.memory),
    cores: valueOrZeroLong(data.cores),
    sockets: valueOrZeroLong(data.sockets),
    ostype: pickString(data.ostype),
    scsihw: pickString(data.scsihw),
    boot: pickString(data.boot),
    raw_config: asJsonValue(data),
    description: pickString(data.description),
    tags: pickString(data.tags),
    template: pickBoolean(data.template) ?? false,
    onboot: pickBoolean(data.onboot) ?? false,
    autostart: pickBoolean(data.autostart) ?? false,
    cpu: pickString(data.cpu),
    cpulimit: valueOrZeroDouble(data.cpulimit),
    cpuunits: valueOrZeroLong(data.cpuunits),
    bios: pickString(data.bios),
    machine: pickString(data.machine),
    arch: pickString(data.arch),
    agent: pickBoolean(data.agent) ?? false,
    hugepages: pickString(data.hugepages),
    keephugepages: pickBoolean(data.keephugepages) ?? false,
    vmgenid: pickString(data.vmgenid),
    protection: pickBoolean(data.protection) ?? false,
    lock_status: pickString(data.lock),
    balloon: valueOrZeroLong(data.balloon),
    digest: pickString(data.digest),
    hotplug: pickString(data.hotplug),
    keyboard: pickString(data.keyboard),
    kvm: pickBoolean(data.kvm) ?? false,
  };
};

const extractData = (payload) => {
  if (payload === null || payload === undefined) return null;
  if (Array.isArray(payload)) return payload;
  if (typeof payload === 'object' && hasOwn(payload, 'data')) return payload.data;
  return payload;
};

const arrayOrEmpty = (value) => Array.isArray(value) ? value : [];

const handleListNodes = async (req = {}, ctx = {}) => {
  const callCtx = resolveCallContext(ctx);
  const { httpStatus, text, json } = await proxmoxRequest(callCtx, ['nodes'], { method: 'GET' });
  const data = extractData(json);
  const nodes = arrayOrEmpty(data).map(buildNodeInfo);
  return {
    http_status: httpStatus,
    raw_body: wrapRawBody(text),
    raw_json: asJsonValue(json),
    nodes,
  };
};

const handleListQemuVMs = async (req = {}, ctx = {}) => {
  const callCtx = resolveCallContext(ctx);
  const node = requireNodeName(req, callCtx.bindings || {}, 'ListQemuVMs');
  const { httpStatus, text, json } = await proxmoxRequest(callCtx, ['nodes', node, 'qemu'], { method: 'GET' });
  const data = extractData(json);
  const vms = arrayOrEmpty(data).map(buildQemuVMInfo);
  return {
    http_status: httpStatus,
    raw_body: wrapRawBody(text),
    raw_json: asJsonValue(json),
    vms,
  };
};

const handleGetQemuVMConfig = async (req = {}, ctx = {}) => {
  const callCtx = resolveCallContext(ctx);
  const node = requireNodeName(req, callCtx.bindings || {}, 'GetQemuVMConfig');
  const vmid = requireVmid(req, 'GetQemuVMConfig');
  const { httpStatus, text, json } = await proxmoxRequest(callCtx, ['nodes', node, 'qemu', vmid, 'config'], { method: 'GET' });
  const data = extractData(json);
  return {
    http_status: httpStatus,
    raw_body: wrapRawBody(text),
    raw_json: asJsonValue(json),
    ...buildQemuVMConfig(data, node, vmid),
  };
};

const handleListLXCs = async (req = {}, ctx = {}) => {
  const callCtx = resolveCallContext(ctx);
  const node = requireNodeName(req, callCtx.bindings || {}, 'ListLXCs');
  const { httpStatus, text, json } = await proxmoxRequest(callCtx, ['nodes', node, 'lxc'], { method: 'GET' });
  const data = extractData(json);
  const containers = arrayOrEmpty(data).map(buildLXCInfo);
  return {
    http_status: httpStatus,
    raw_body: wrapRawBody(text),
    raw_json: asJsonValue(json),
    containers,
  };
};

const handleListStorage = async (req = {}, ctx = {}) => {
  const callCtx = resolveCallContext(ctx);
  const node = requireNodeName(req, callCtx.bindings || {}, 'ListStorage');
  const { httpStatus, text, json } = await proxmoxRequest(callCtx, ['nodes', node, 'storage'], { method: 'GET' });
  const data = extractData(json);
  const storages = arrayOrEmpty(data).map(buildStorageInfo);
  return {
    http_status: httpStatus,
    raw_body: wrapRawBody(text),
    raw_json: asJsonValue(json),
    storages,
  };
};

const handleGetNodeStatus = async (req = {}, ctx = {}) => {
  const callCtx = resolveCallContext(ctx);
  const node = requireNodeName(req, callCtx.bindings || {}, 'GetNodeStatus');
  const { httpStatus, text, json } = await proxmoxRequest(callCtx, ['nodes', node, 'status'], { method: 'GET' });
  const data = extractData(json);
  return {
    http_status: httpStatus,
    raw_body: wrapRawBody(text),
    raw_json: asJsonValue(json),
    ...buildNodeStatus(data, node),
  };
};

export function rpcdef(ctx = {}) {
  const callCtx = resolveCallContext(ctx);
  return {
    [METHOD_LIST_NODES_PATH]: async (req) => handleListNodes(req ?? callCtx.req ?? {}, callCtx),
    [METHOD_LIST_QEMU_VMS_PATH]: async (req) => handleListQemuVMs(req ?? callCtx.req ?? {}, callCtx),
    [METHOD_GET_QEMU_VM_CONFIG_PATH]: async (req) => handleGetQemuVMConfig(req ?? callCtx.req ?? {}, callCtx),
    [METHOD_LIST_LXCS_PATH]: async (req) => handleListLXCs(req ?? callCtx.req ?? {}, callCtx),
    [METHOD_LIST_STORAGE_PATH]: async (req) => handleListStorage(req ?? callCtx.req ?? {}, callCtx),
    [METHOD_GET_NODE_STATUS_PATH]: async (req) => handleGetNodeStatus(req ?? callCtx.req ?? {}, callCtx),
  };
}

export const handlers = {
  [METHOD_LIST_NODES_FULL]: function listNodes(context) {
    context ??= {};
    return handleListNodes(arguments[1] ? arguments[0] : context.req ?? {}, arguments[1] ?? context);
  },
  [METHOD_LIST_QEMU_VMS_FULL]: function listQemuVMs(context) {
    context ??= {};
    return handleListQemuVMs(arguments[1] ? arguments[0] : context.req ?? {}, arguments[1] ?? context);
  },
  [METHOD_GET_QEMU_VM_CONFIG_FULL]: function getQemuVMConfig(context) {
    context ??= {};
    return handleGetQemuVMConfig(arguments[1] ? arguments[0] : context.req ?? {}, arguments[1] ?? context);
  },
  [METHOD_LIST_LXCS_FULL]: function listLXCs(context) {
    context ??= {};
    return handleListLXCs(arguments[1] ? arguments[0] : context.req ?? {}, arguments[1] ?? context);
  },
  [METHOD_LIST_STORAGE_FULL]: function listStorage(context) {
    context ??= {};
    return handleListStorage(arguments[1] ? arguments[0] : context.req ?? {}, arguments[1] ?? context);
  },
  [METHOD_GET_NODE_STATUS_FULL]: function getNodeStatus(context) {
    context ??= {};
    return handleGetNodeStatus(arguments[1] ? arguments[0] : context.req ?? {}, arguments[1] ?? context);
  },
};

export const _test = {
  API_PREFIX,
  DEFAULT_TIMEOUT_MS,
  MAX_RESPONSE_BYTES,
  MAX_TIMEOUT_MS,
  METHOD_PATHS,
  VMID_MAX,
  NODE_NAME_RE,
  arrayOrEmpty,
  asJsonValue,
  buildAuthHeader,
  buildHeaders,
  buildLXCInfo,
  buildLogPrefix,
  buildNodeInfo,
  buildNodeStatus,
  buildQemuVMConfig,
  buildQemuVMInfo,
  buildStorageInfo,
  buildTlsDispatcher,
  buildUrl,
  engineError,
  extractData,
  grpcCodeFor,
  handleGetNodeStatus,
  handleGetQemuVMConfig,
  handleListLXCs,
  handleListNodes,
  handleListQemuVMs,
  handleListStorage,
  hasOwn,
  isValidNodeName,
  isValidVmid,
  logFlow,
  mapHttpStatus,
  normalizeBaseUrl,
  parseJsonBody,
  pickBoolean,
  pickDouble,
  pickFirstBoolean,
  pickFirstString,
  pickInt,
  pickLong,
  pickString,
  proxmoxRequest,
  requireNodeName,
  requireVmid,
  resolveBaseUrl,
  resolveCallContext,
  resolveTimeoutMs,
  resolveToken,
  readResponseText,
  resolveVmidString,
  sanitizeHeaders,
  shouldSkipTls,
  unwrapScalar,
  valueOrZeroDouble,
  valueOrZeroLong,
  wrapRawBody,
};

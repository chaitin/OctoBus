import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';

export const SERVICE_FULL_NAME = 'aliyun.cloudfw.v1.AliyunCloudFWService';

export const METHOD_LIST_ASSETS_FULL = `${SERVICE_FULL_NAME}/ListAssets`;
export const METHOD_LIST_ADDRESS_BOOKS_FULL = `${SERVICE_FULL_NAME}/ListAddressBooks`;
export const METHOD_CREATE_ADDRESS_BOOK_FULL = `${SERVICE_FULL_NAME}/CreateAddressBook`;
export const METHOD_DELETE_ADDRESS_BOOK_FULL = `${SERVICE_FULL_NAME}/DeleteAddressBook`;
export const METHOD_LIST_INTERNET_CONTROL_POLICIES_FULL = `${SERVICE_FULL_NAME}/ListInternetControlPolicies`;
export const METHOD_CREATE_INTERNET_CONTROL_POLICY_FULL = `${SERVICE_FULL_NAME}/CreateInternetControlPolicy`;
export const METHOD_UPDATE_INTERNET_CONTROL_POLICY_FULL = `${SERVICE_FULL_NAME}/UpdateInternetControlPolicy`;
export const METHOD_DELETE_INTERNET_CONTROL_POLICY_FULL = `${SERVICE_FULL_NAME}/DeleteInternetControlPolicy`;
export const METHOD_LIST_VPC_FIREWALLS_FULL = `${SERVICE_FULL_NAME}/ListVpcFirewalls`;
export const METHOD_LIST_VPC_CONTROL_POLICIES_FULL = `${SERVICE_FULL_NAME}/ListVpcControlPolicies`;
export const METHOD_CREATE_VPC_CONTROL_POLICY_FULL = `${SERVICE_FULL_NAME}/CreateVpcControlPolicy`;
export const METHOD_UPDATE_VPC_CONTROL_POLICY_FULL = `${SERVICE_FULL_NAME}/UpdateVpcControlPolicy`;
export const METHOD_DELETE_VPC_CONTROL_POLICY_FULL = `${SERVICE_FULL_NAME}/DeleteVpcControlPolicy`;
export const METHOD_LIST_NAT_CONTROL_POLICIES_FULL = `${SERVICE_FULL_NAME}/ListNatControlPolicies`;
export const METHOD_CREATE_NAT_CONTROL_POLICY_FULL = `${SERVICE_FULL_NAME}/CreateNatControlPolicy`;
export const METHOD_UPDATE_NAT_CONTROL_POLICY_FULL = `${SERVICE_FULL_NAME}/UpdateNatControlPolicy`;
export const METHOD_DELETE_NAT_CONTROL_POLICY_FULL = `${SERVICE_FULL_NAME}/DeleteNatControlPolicy`;

const DEFAULT_PROTOCOL = 'HTTPS';

const COMMON_FILTER_FIELDS = [
  'aclAction',
  'aclUuid',
  'currentPage',
  'description',
  'destination',
  'direction',
  'ipVersion',
  'lang',
  'pageSize',
  'proto',
  'release',
  'repeatType',
  'source',
];

const POLICY_MUTATION_FIELDS = [
  'aclAction',
  'aclUuid',
  'applicationName',
  'applicationNameList',
  'description',
  'destPort',
  'destPortGroup',
  'destPortType',
  'destination',
  'destinationType',
  'direction',
  'domainResolveType',
  'endTime',
  'ipVersion',
  'lang',
  'memberUid',
  'natGatewayId',
  'newOrder',
  'proto',
  'release',
  'repeatDays',
  'repeatEndTime',
  'repeatStartTime',
  'repeatType',
  'source',
  'sourceIp',
  'sourceType',
  'startTime',
  'vpcFirewallId',
];

export const operationSpecs = [
  {
    fullMethod: METHOD_LIST_ASSETS_FULL,
    sdkMethod: 'describeAssetList',
    requestClass: 'DescribeAssetListRequest',
    fields: [
      'currentPage',
      'ipVersion',
      'lang',
      'memberUid',
      'newResourceTag',
      'outStatistic',
      'pageSize',
      'regionNo',
      'resourceType',
      'searchItem',
      'sensitiveStatus',
      'sgStatus',
      'status',
      'type',
      'userType',
    ],
  },
  {
    fullMethod: METHOD_LIST_ADDRESS_BOOKS_FULL,
    sdkMethod: 'describeAddressBook',
    requestClass: 'DescribeAddressBookRequest',
    fields: ['containPort', 'currentPage', 'groupType', 'groupUuid', 'lang', 'pageSize', 'query'],
  },
  {
    fullMethod: METHOD_CREATE_ADDRESS_BOOK_FULL,
    sdkMethod: 'addAddressBook',
    requestClass: 'AddAddressBookRequest',
    fields: [
      'ackClusterConnectorId',
      'ackLabels',
      'ackNamespaces',
      'addressList',
      'autoAddTagEcs',
      'description',
      'groupName',
      'groupType',
      'lang',
      'sourceIp',
      'tagList',
      'tagRelation',
    ],
    nestedFields: {
      ackLabels: ['key', 'value'],
      tagList: ['tagKey', 'tagValue'],
    },
  },
  {
    fullMethod: METHOD_DELETE_ADDRESS_BOOK_FULL,
    sdkMethod: 'deleteAddressBook',
    requestClass: 'DeleteAddressBookRequest',
    fields: ['groupUuid', 'lang', 'sourceIp'],
  },
  {
    fullMethod: METHOD_LIST_INTERNET_CONTROL_POLICIES_FULL,
    sdkMethod: 'describeControlPolicy',
    requestClass: 'DescribeControlPolicyRequest',
    fields: COMMON_FILTER_FIELDS,
  },
  {
    fullMethod: METHOD_CREATE_INTERNET_CONTROL_POLICY_FULL,
    sdkMethod: 'addControlPolicy',
    requestClass: 'AddControlPolicyRequest',
    fields: POLICY_MUTATION_FIELDS,
  },
  {
    fullMethod: METHOD_UPDATE_INTERNET_CONTROL_POLICY_FULL,
    sdkMethod: 'modifyControlPolicy',
    requestClass: 'ModifyControlPolicyRequest',
    fields: POLICY_MUTATION_FIELDS,
  },
  {
    fullMethod: METHOD_DELETE_INTERNET_CONTROL_POLICY_FULL,
    sdkMethod: 'deleteControlPolicy',
    requestClass: 'DeleteControlPolicyRequest',
    fields: ['aclUuid', 'direction', 'lang', 'sourceIp'],
  },
  {
    fullMethod: METHOD_LIST_VPC_FIREWALLS_FULL,
    sdkMethod: 'describeVpcFirewallCenList',
    requestClass: 'DescribeVpcFirewallCenListRequest',
    fields: [
      'cenId',
      'currentPage',
      'firewallSwitchStatus',
      'lang',
      'memberUid',
      'networkInstanceId',
      'ownerId',
      'pageSize',
      'regionNo',
      'routeMode',
      'transitRouterType',
      'vpcFirewallId',
      'vpcFirewallName',
    ],
  },
  {
    fullMethod: METHOD_LIST_VPC_CONTROL_POLICIES_FULL,
    sdkMethod: 'describeVpcFirewallControlPolicy',
    requestClass: 'DescribeVpcFirewallControlPolicyRequest',
    fields: [...COMMON_FILTER_FIELDS.filter((field) => field !== 'direction' && field !== 'ipVersion'), 'memberUid', 'vpcFirewallId'],
  },
  {
    fullMethod: METHOD_CREATE_VPC_CONTROL_POLICY_FULL,
    sdkMethod: 'createVpcFirewallControlPolicy',
    requestClass: 'CreateVpcFirewallControlPolicyRequest',
    fields: POLICY_MUTATION_FIELDS,
  },
  {
    fullMethod: METHOD_UPDATE_VPC_CONTROL_POLICY_FULL,
    sdkMethod: 'modifyVpcFirewallControlPolicy',
    requestClass: 'ModifyVpcFirewallControlPolicyRequest',
    fields: POLICY_MUTATION_FIELDS,
  },
  {
    fullMethod: METHOD_DELETE_VPC_CONTROL_POLICY_FULL,
    sdkMethod: 'deleteVpcFirewallControlPolicy',
    requestClass: 'DeleteVpcFirewallControlPolicyRequest',
    fields: ['aclUuid', 'lang', 'vpcFirewallId'],
  },
  {
    fullMethod: METHOD_LIST_NAT_CONTROL_POLICIES_FULL,
    sdkMethod: 'describeNatFirewallControlPolicy',
    requestClass: 'DescribeNatFirewallControlPolicyRequest',
    fields: [...COMMON_FILTER_FIELDS.filter((field) => field !== 'ipVersion'), 'natGatewayId'],
  },
  {
    fullMethod: METHOD_CREATE_NAT_CONTROL_POLICY_FULL,
    sdkMethod: 'createNatFirewallControlPolicy',
    requestClass: 'CreateNatFirewallControlPolicyRequest',
    fields: POLICY_MUTATION_FIELDS,
  },
  {
    fullMethod: METHOD_UPDATE_NAT_CONTROL_POLICY_FULL,
    sdkMethod: 'modifyNatFirewallControlPolicy',
    requestClass: 'ModifyNatFirewallControlPolicyRequest',
    fields: POLICY_MUTATION_FIELDS,
  },
  {
    fullMethod: METHOD_DELETE_NAT_CONTROL_POLICY_FULL,
    sdkMethod: 'deleteNatFirewallControlPolicy',
    requestClass: 'DeleteNatFirewallControlPolicyRequest',
    fields: ['aclUuid', 'direction', 'lang', 'natGatewayId'],
  },
];

const operationByMethod = new Map(operationSpecs.map((spec) => [spec.fullMethod, spec]));

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj ?? {}, key);

const snakeCase = (value) => String(value).replace(/[A-Z]/g, (match) => `_${match.toLowerCase()}`);

const unwrapScalar = (value) => {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'object' && value !== null && hasOwn(value, 'value')) return unwrapScalar(value.value);
  return value;
};

const firstPresent = (obj, camelName) => {
  const snakeName = snakeCase(camelName);
  if (hasOwn(obj, camelName)) return obj[camelName];
  if (hasOwn(obj, snakeName)) return obj[snakeName];
  return undefined;
};

const toTrimmedString = (value) => {
  const raw = unwrapScalar(value);
  if (raw === undefined || raw === null) return '';
  return String(raw).trim();
};

const toPositiveInteger = (value) => {
  const raw = unwrapScalar(value);
  if (raw === undefined || raw === null || raw === '') return undefined;
  const num = Number(raw);
  return Number.isFinite(num) && num > 0 ? Math.trunc(num) : undefined;
};

const normalizeObjectFields = (value, fields) => {
  if (value === undefined || value === null || typeof value !== 'object') return value;
  const out = {};
  for (const field of fields) {
    const raw = firstPresent(value, field);
    if (raw !== undefined && raw !== null) out[field] = unwrapScalar(raw);
  }
  return out;
};

export const normalizeRequest = (request = {}, spec) => {
  const out = {};
  for (const field of spec.fields) {
    const raw = firstPresent(request, field);
    if (raw === undefined || raw === null) continue;
    const nestedFields = spec.nestedFields?.[field];
    if (nestedFields && Array.isArray(raw)) {
      out[field] = raw.map((item) => normalizeObjectFields(item, nestedFields));
      continue;
    }
    out[field] = unwrapScalar(raw);
  }
  return out;
};

const requireConfigString = (config, name) => {
  const value = toTrimmedString(config?.[name]);
  if (!value) throw new GrpcError(grpcStatus.INVALID_ARGUMENT, `config.${name} is required`);
  return value;
};

const requireSecretString = (secret, name) => {
  const value = toTrimmedString(secret?.[name]);
  if (!value) throw new GrpcError(grpcStatus.UNAUTHENTICATED, `secret.${name} is required`);
  return value;
};

export const buildClientConfig = (config = {}, secret = {}) => {
  const clientConfig = {
    endpoint: requireConfigString(config, 'endpoint'),
    regionId: requireConfigString(config, 'regionId'),
    type: 'access_key',
    accessKeyId: requireSecretString(secret, 'accessKeyId'),
    accessKeySecret: requireSecretString(secret, 'accessKeySecret'),
    protocol: toTrimmedString(config.protocol) || DEFAULT_PROTOCOL,
  };
  const securityToken = toTrimmedString(secret.securityToken);
  if (securityToken) clientConfig.securityToken = securityToken;
  const connectTimeout = toPositiveInteger(config.connectTimeout ?? config.connect_timeout ?? config.timeoutMs ?? config.timeout_ms);
  if (connectTimeout !== undefined) clientConfig.connectTimeout = connectTimeout;
  const readTimeout = toPositiveInteger(config.readTimeout ?? config.read_timeout ?? config.timeoutMs ?? config.timeout_ms);
  if (readTimeout !== undefined) clientConfig.readTimeout = readTimeout;
  return clientConfig;
};

const loadOfficialSdk = async () => import('@alicloud/cloudfw20171207');

const sdkExport = (sdk, name) => sdk?.[name] ?? sdk?.default?.[name];

const sdkClientClass = (sdk) => sdk?.default?.default ?? sdk?.default ?? sdk?.Client ?? sdk;

const toPlain = (value, seen = new WeakSet()) => {
  if (value === undefined || value === null) return value;
  if (typeof value !== 'object') return value;
  if (typeof value.toMap === 'function') return toPlain(value.toMap(), seen);
  if (seen.has(value)) return '[Circular]';
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => toPlain(item, seen));
  const out = {};
  for (const [key, inner] of Object.entries(value)) {
    if (typeof inner !== 'function') out[key] = toPlain(inner, seen);
  }
  return out;
};

const toValue = (value) => {
  if (value === undefined || value === null) return { nullValue: 'NULL_VALUE' };
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'number') return Number.isFinite(value) ? { numberValue: value } : { stringValue: String(value) };
  if (typeof value === 'boolean') return { boolValue: value };
  if (Array.isArray(value)) {
    return { listValue: { values: value.map((item) => toValue(item)) } };
  }
  if (typeof value === 'object') {
    const fields = {};
    for (const [key, inner] of Object.entries(value)) {
      fields[key] = toValue(inner);
    }
    return { structValue: { fields } };
  }
  return { stringValue: String(value) };
};

const requestIdFrom = (body = {}, response = {}) => {
  const headers = response?.headers ?? response?.Header ?? {};
  return toTrimmedString(
    body?.requestId
      ?? body?.RequestId
      ?? headers['x-acs-request-id']
      ?? headers['x-acs-requestid']
      ?? response?.requestId
      ?? response?.RequestId,
  );
};

const formatResponse = (response) => {
  const plainResponse = toPlain(response);
  const body = plainResponse?.body ?? plainResponse?.Body ?? plainResponse ?? {};
  return {
    request_id: requestIdFrom(body, plainResponse),
    body: toValue(body),
    raw_json: JSON.stringify(plainResponse ?? {}),
  };
};

const errorMessage = (err) => {
  const parts = [
    err?.code,
    err?.name,
    err?.message,
    err?.data?.Code,
    err?.data?.Message,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(': ') : 'aliyun cloudfw sdk request failed';
};

const mapSdkError = (err) => {
  if (err instanceof GrpcError) return err;
  const status = Number(err?.statusCode ?? err?.status ?? err?.codeStatus ?? 0);
  const codeText = String(err?.code ?? err?.name ?? '');
  const message = errorMessage(err);
  if (status === 401 || /InvalidAccessKeyId|Signature|Unauthorized|Unauthenticated/i.test(codeText)) {
    return new GrpcError(grpcStatus.UNAUTHENTICATED, message);
  }
  if (status === 403 || /Forbidden|Permission|NoPermission|AccessDenied/i.test(codeText)) {
    return new GrpcError(grpcStatus.PERMISSION_DENIED, message);
  }
  if (status === 400 || /InvalidParameter|MissingParameter|Validation/i.test(codeText)) {
    return new GrpcError(grpcStatus.INVALID_ARGUMENT, message);
  }
  if (status === 404 || /NotFound/i.test(codeText)) {
    return new GrpcError(grpcStatus.NOT_FOUND, message);
  }
  if (status === 429 || status >= 500 || /Throttl|Timeout|Unavailable|ECONN|ENOTFOUND|ETIMEDOUT/i.test(codeText) || /timeout|network/i.test(message)) {
    return new GrpcError(grpcStatus.UNAVAILABLE, message);
  }
  return new GrpcError(grpcStatus.UNKNOWN, message);
};

export const callOperation = async (spec, request = {}, ctx = {}, options = {}) => {
  const sdk = await (options.loadSdk ?? loadOfficialSdk)();
  const Client = options.Client ?? sdkClientClass(sdk);
  const RequestClass = options.RequestClass ?? sdkExport(sdk, spec.requestClass);
  if (typeof Client !== 'function') {
    throw new GrpcError(grpcStatus.INTERNAL, 'failed to load aliyun cloudfw sdk client');
  }
  if (typeof RequestClass !== 'function') {
    throw new GrpcError(grpcStatus.INTERNAL, `failed to load aliyun cloudfw sdk request ${spec.requestClass}`);
  }

  const client = new Client(buildClientConfig(ctx.config ?? {}, ctx.secret ?? {}));
  const payload = normalizeRequest(request ?? {}, spec);
  if (payload.lang === undefined && ctx.config?.lang !== undefined) {
    payload.lang = unwrapScalar(ctx.config.lang);
  }
  const sdkRequest = new RequestClass(payload);
  try {
    const response = await client[spec.sdkMethod](sdkRequest);
    return formatResponse(response);
  } catch (err) {
    throw mapSdkError(err);
  }
};

export const createHandlers = (options = {}) => Object.fromEntries(
  operationSpecs.map((spec) => [
    spec.fullMethod,
    (request, ctx = {}) => callOperation(spec, request, ctx, options),
  ]),
);

export const createRuntime = (options = {}) => ({
  handlers: createHandlers(options),
});

export const handlers = createHandlers();

export const rpcdef = (ctx = {}, options = {}) => Object.fromEntries(
  operationSpecs.map((spec) => [
    `/${spec.fullMethod}`,
    (request) => callOperation(spec, request ?? ctx.req ?? ctx.request ?? {}, ctx, options),
  ]),
);

export const _test = {
  buildClientConfig,
  callOperation,
  formatResponse,
  mapSdkError,
  normalizeRequest,
  operationByMethod,
  operationSpecs,
  toPlain,
  toValue,
};

import assert from 'node:assert/strict';
import test from 'node:test';

import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';

import {
  METHOD_CREATE_ADDRESS_BOOK_FULL,
  METHOD_DELETE_INTERNET_CONTROL_POLICY_FULL,
  METHOD_LIST_ADDRESS_BOOKS_FULL,
  METHOD_LIST_ASSETS_FULL,
  METHOD_LIST_NAT_CONTROL_POLICIES_FULL,
  METHOD_LIST_VPC_CONTROL_POLICIES_FULL,
  createHandlers,
  createRuntime,
  rpcdef,
  _test,
} from '../src/aliyun-cloudfw.js';
import { service } from '../src/service.js';

class FakeRequest {
  constructor(map = {}) {
    Object.assign(this, map);
    this.map = map;
  }
}

class FakeCloudfwClient {
  constructor(config) {
    FakeCloudfwClient.instances.push(this);
    this.config = config;
    this.calls = [];
  }

  async describeAssetList(request) {
    return this.record('describeAssetList', request, {
      body: { RequestId: 'req-assets', Items: [{ publicIp: '203.0.113.10' }] },
    });
  }

  async describeAddressBook(request) {
    return this.record('describeAddressBook', request, {
      body: { RequestId: 'req-address-books', AddressBooks: [{ GroupUuid: 'grp-1' }] },
    });
  }

  async addAddressBook(request) {
    return this.record('addAddressBook', request, {
      body: { RequestId: 'req-add-book', GroupUuid: 'grp-created' },
    });
  }

  async deleteControlPolicy(request) {
    return this.record('deleteControlPolicy', request, {
      body: { RequestId: 'req-delete-policy', Success: true },
    });
  }

  async describeVpcFirewallControlPolicy(request) {
    return this.record('describeVpcFirewallControlPolicy', request, {
      body: { RequestId: 'req-vpc-policy', TotalCount: 1 },
    });
  }

  async describeNatFirewallControlPolicy(request) {
    return this.record('describeNatFirewallControlPolicy', request, {
      body: { RequestId: 'req-nat-policy', TotalCount: 2 },
    });
  }

  record(method, request, response) {
    this.calls.push({ method, request });
    return response;
  }
}

FakeCloudfwClient.instances = [];

const fakeSdk = {
  default: FakeCloudfwClient,
  DescribeAssetListRequest: FakeRequest,
  DescribeAddressBookRequest: FakeRequest,
  AddAddressBookRequest: FakeRequest,
  DeleteControlPolicyRequest: FakeRequest,
  DescribeVpcFirewallControlPolicyRequest: FakeRequest,
  DescribeNatFirewallControlPolicyRequest: FakeRequest,
};

const buildCtx = (overrides = {}) => ({
  config: {
    endpoint: 'cloudfw.cn-hangzhou.aliyuncs.com',
    regionId: 'cn-hangzhou',
    lang: 'zh',
    connectTimeout: 3000,
    readTimeout: 5000,
    ...(overrides.config || {}),
  },
  secret: {
    accessKeyId: 'ak-id',
    accessKeySecret: 'ak-secret',
    ...(overrides.secret || {}),
  },
});

const buildHandlers = (sdk = fakeSdk) => createHandlers({
  loadSdk: async () => sdk,
});

const expectGrpcError = async (fn, code, messagePattern) => {
  let caught;
  try {
    await fn();
  } catch (err) {
    caught = err;
  }
  assert.ok(caught, 'expected function to reject');
  assert.ok(caught instanceof GrpcError);
  assert.equal(caught.code, code);
  if (messagePattern) assert.match(caught.message, messagePattern);
};

test.beforeEach(() => {
  FakeCloudfwClient.instances = [];
});

test('service exports all CloudFW handlers', () => {
  assert.equal(typeof service, 'object');
  const handlers = buildHandlers();
  assert.equal(typeof handlers[METHOD_LIST_ASSETS_FULL], 'function');
  assert.equal(typeof handlers[METHOD_LIST_ADDRESS_BOOKS_FULL], 'function');
  assert.equal(typeof handlers[METHOD_CREATE_ADDRESS_BOOK_FULL], 'function');
  assert.equal(typeof handlers[METHOD_DELETE_INTERNET_CONTROL_POLICY_FULL], 'function');
  assert.equal(typeof handlers[METHOD_LIST_VPC_CONTROL_POLICIES_FULL], 'function');
  assert.equal(typeof handlers[METHOD_LIST_NAT_CONTROL_POLICIES_FULL], 'function');
});

test('validates CloudFW config and credentials before SDK calls', async () => {
  const handlers = buildHandlers();

  await expectGrpcError(
    () => handlers[METHOD_LIST_ASSETS_FULL]({}, buildCtx({ config: { endpoint: '' } })),
    grpcStatus.INVALID_ARGUMENT,
    /endpoint/,
  );
  await expectGrpcError(
    () => handlers[METHOD_LIST_ASSETS_FULL]({}, buildCtx({ config: { regionId: '' } })),
    grpcStatus.INVALID_ARGUMENT,
    /regionId/,
  );
  await expectGrpcError(
    () => handlers[METHOD_LIST_ASSETS_FULL]({}, buildCtx({ secret: { accessKeyId: '' } })),
    grpcStatus.UNAUTHENTICATED,
    /accessKeyId/,
  );
  await expectGrpcError(
    () => handlers[METHOD_LIST_ASSETS_FULL]({}, buildCtx({ secret: { accessKeySecret: '' } })),
    grpcStatus.UNAUTHENTICATED,
    /accessKeySecret/,
  );
  assert.equal(FakeCloudfwClient.instances.length, 0);
});

test('maps proto-shaped asset query to official SDK request and returns raw body', async () => {
  const handlers = buildHandlers();
  const result = await handlers[METHOD_LIST_ASSETS_FULL]({
    current_page: '1',
    page_size: '20',
    region_no: 'cn-hangzhou',
    search_item: '203.0.113.10',
  }, buildCtx());

  const client = FakeCloudfwClient.instances[0];
  assert.deepEqual(client.config, {
    endpoint: 'cloudfw.cn-hangzhou.aliyuncs.com',
    regionId: 'cn-hangzhou',
    type: 'access_key',
    accessKeyId: 'ak-id',
    accessKeySecret: 'ak-secret',
    protocol: 'HTTPS',
    connectTimeout: 3000,
    readTimeout: 5000,
  });
  assert.equal(client.calls[0].method, 'describeAssetList');
  assert.deepEqual(client.calls[0].request.map, {
    currentPage: '1',
    pageSize: '20',
    regionNo: 'cn-hangzhou',
    searchItem: '203.0.113.10',
    lang: 'zh',
  });
  assert.equal(result.request_id, 'req-assets');
  assert.match(result.raw_json, /203\.0\.113\.10/);
  assert.deepEqual(result.body.structValue.fields.RequestId, { stringValue: 'req-assets' });
});

test('supports address book create payload aliases and array fields', async () => {
  const handlers = buildHandlers();
  const result = await handlers[METHOD_CREATE_ADDRESS_BOOK_FULL]({
    group_name: 'octobus-ci-test',
    groupType: 'ip',
    address_list: '198.51.100.10/32 test',
    description: 'temporary',
    tag_list: [{ tag_key: 'env', tag_value: 'test' }],
  }, buildCtx());

  const call = FakeCloudfwClient.instances[0].calls[0];
  assert.equal(call.method, 'addAddressBook');
  assert.deepEqual(call.request.map, {
    groupName: 'octobus-ci-test',
    groupType: 'ip',
    addressList: '198.51.100.10/32 test',
    description: 'temporary',
    tagList: [{ tagKey: 'env', tagValue: 'test' }],
    lang: 'zh',
  });
  assert.equal(result.request_id, 'req-add-book');
});

test('lists address books with camelCase request fields and default language fallback', async () => {
  const handlers = buildHandlers();
  const result = await handlers[METHOD_LIST_ADDRESS_BOOKS_FULL]({
    currentPage: '1',
    groupUuid: 'grp-1',
    query: 'octobus',
  }, buildCtx());

  const call = FakeCloudfwClient.instances[0].calls[0];
  assert.equal(call.method, 'describeAddressBook');
  assert.deepEqual(call.request.map, {
    currentPage: '1',
    groupUuid: 'grp-1',
    query: 'octobus',
    lang: 'zh',
  });
  assert.equal(result.request_id, 'req-address-books');
});

test('maps internet policy delete and VPC/NAT list requests to dedicated SDK methods', async () => {
  const handlers = buildHandlers();

  await handlers[METHOD_DELETE_INTERNET_CONTROL_POLICY_FULL]({
    acl_uuid: 'acl-1',
    direction: 'in',
  }, buildCtx());
  await handlers[METHOD_LIST_VPC_CONTROL_POLICIES_FULL]({
    vpc_firewall_id: 'vfw-1',
    current_page: '1',
    page_size: '10',
  }, buildCtx());
  await handlers[METHOD_LIST_NAT_CONTROL_POLICIES_FULL]({
    nat_gateway_id: 'ngw-1',
    direction: 'out',
  }, buildCtx());

  assert.deepEqual(FakeCloudfwClient.instances.map((client) => client.calls[0].method), [
    'deleteControlPolicy',
    'describeVpcFirewallControlPolicy',
    'describeNatFirewallControlPolicy',
  ]);
  assert.deepEqual(FakeCloudfwClient.instances[0].calls[0].request.map, {
    aclUuid: 'acl-1',
    direction: 'in',
    lang: 'zh',
  });
  assert.deepEqual(FakeCloudfwClient.instances[1].calls[0].request.map, {
    vpcFirewallId: 'vfw-1',
    currentPage: '1',
    pageSize: '10',
    lang: 'zh',
  });
  assert.deepEqual(FakeCloudfwClient.instances[2].calls[0].request.map, {
    natGatewayId: 'ngw-1',
    direction: 'out',
    lang: 'zh',
  });
});

test('maps SDK errors to stable gRPC errors', async () => {
  class FailingClient extends FakeCloudfwClient {
    async describeAssetList() {
      const err = new Error('Forbidden.RAM: denied');
      err.statusCode = 403;
      err.code = 'Forbidden.RAM';
      throw err;
    }
  }

  const handlers = buildHandlers({ ...fakeSdk, default: FailingClient });
  await expectGrpcError(
    () => handlers[METHOD_LIST_ASSETS_FULL]({}, buildCtx()),
    grpcStatus.PERMISSION_DENIED,
    /Forbidden\.RAM/,
  );
});

test('maps SDK auth, validation, missing, transient, and unknown failures', () => {
  assert.equal(_test.mapSdkError(Object.assign(new Error('bad ak'), { statusCode: 401 })).code, grpcStatus.UNAUTHENTICATED);
  assert.equal(_test.mapSdkError(Object.assign(new Error('bad request'), { statusCode: 400 })).code, grpcStatus.INVALID_ARGUMENT);
  assert.equal(_test.mapSdkError(Object.assign(new Error('missing'), { statusCode: 404 })).code, grpcStatus.NOT_FOUND);
  assert.equal(_test.mapSdkError(Object.assign(new Error('busy'), { statusCode: 429 })).code, grpcStatus.UNAVAILABLE);
  assert.equal(_test.mapSdkError(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })).code, grpcStatus.UNAVAILABLE);
  assert.equal(_test.mapSdkError(Object.assign(new Error('invalid'), { code: 'InvalidParameter.Bad' })).code, grpcStatus.INVALID_ARGUMENT);
  assert.equal(_test.mapSdkError(Object.assign(new Error('absent'), { code: 'ResourceNotFound' })).code, grpcStatus.NOT_FOUND);
  assert.equal(_test.mapSdkError(Object.assign(new Error('mystery'), { code: 'SomethingElse' })).code, grpcStatus.UNKNOWN);

  const grpcError = new GrpcError(grpcStatus.INVALID_ARGUMENT, 'already mapped');
  assert.equal(_test.mapSdkError(grpcError), grpcError);
});

test('reports SDK loading failures as internal errors', async () => {
  const spec = _test.operationSpecs.find((item) => item.fullMethod === METHOD_LIST_ASSETS_FULL);
  await expectGrpcError(
    () => _test.callOperation(spec, {}, buildCtx(), { loadSdk: async () => ({}) }),
    grpcStatus.INTERNAL,
    /client/,
  );
  await expectGrpcError(
    () => _test.callOperation(spec, {}, buildCtx(), { loadSdk: async () => ({ default: FakeCloudfwClient }) }),
    grpcStatus.INTERNAL,
    /request/,
  );
});

test('supports explicit SDK classes and optional client config fields', async () => {
  const spec = _test.operationSpecs.find((item) => item.fullMethod === METHOD_LIST_ASSETS_FULL);
  const result = await _test.callOperation(spec, { currentPage: '1' }, buildCtx({
    config: {
      protocol: 'HTTP',
      connectTimeout: undefined,
      readTimeout: undefined,
      timeoutMs: '2500',
    },
    secret: { securityToken: 'sts-token' },
  }), {
    loadSdk: async () => ({}),
    Client: FakeCloudfwClient,
    RequestClass: FakeRequest,
  });

  assert.equal(result.request_id, 'req-assets');
  assert.deepEqual(FakeCloudfwClient.instances[0].config, {
    endpoint: 'cloudfw.cn-hangzhou.aliyuncs.com',
    regionId: 'cn-hangzhou',
    type: 'access_key',
    accessKeyId: 'ak-id',
    accessKeySecret: 'ak-secret',
    securityToken: 'sts-token',
    protocol: 'HTTP',
    connectTimeout: 2500,
    readTimeout: 2500,
  });
});

test('formats CloudFW responses from Body, headers, toMap, arrays, and fallback scalars', () => {
  const circular = {};
  circular.self = circular;
  const mapped = {
    toMap: () => ({
      Body: {
        Message: 'ok',
        Values: [1, 'two', false, null],
        Circular: circular,
        Extra: Symbol.for('x'),
      },
      Header: { 'x-acs-request-id': 'req-header' },
      skipMe: () => 'ignored',
    }),
  };

  const result = _test.formatResponse(mapped);
  assert.equal(result.request_id, 'req-header');
  assert.deepEqual(result.body.structValue.fields.Message, { stringValue: 'ok' });
  assert.deepEqual(result.body.structValue.fields.Values.listValue.values[0], { numberValue: 1 });
  assert.deepEqual(result.body.structValue.fields.Values.listValue.values[2], { boolValue: false });
  assert.deepEqual(result.body.structValue.fields.Values.listValue.values[3], { nullValue: 'NULL_VALUE' });
  assert.deepEqual(result.body.structValue.fields.Extra, { stringValue: 'Symbol(x)' });
  assert.match(result.raw_json, /req-header/);
});

test('formats response request IDs from lower-case body, alternate header, and response fields', () => {
  assert.equal(_test.formatResponse({ body: { requestId: 'req-body' } }).request_id, 'req-body');
  assert.equal(_test.formatResponse({ body: {}, headers: { 'x-acs-requestid': 'req-alt-header' } }).request_id, 'req-alt-header');
  assert.equal(_test.formatResponse({ body: {}, requestId: 'req-response' }).request_id, 'req-response');
  assert.equal(_test.formatResponse({ requestId: 'req-no-body' }).request_id, 'req-no-body');
  assert.equal(_test.formatResponse(null).request_id, '');
});

test('rpcdef uses explicit request, ctx.req, and ctx.request fallbacks', async () => {
  const ctx = buildCtx({ config: { lang: undefined } });
  ctx.req = { current_page: '2' };
  const defs = rpcdef(ctx, { loadSdk: async () => fakeSdk });

  await defs[`/${METHOD_LIST_ASSETS_FULL}`]({ current_page: '1' });
  await defs[`/${METHOD_LIST_ASSETS_FULL}`]();
  delete ctx.req;
  ctx.request = { current_page: '3' };
  await defs[`/${METHOD_LIST_ASSETS_FULL}`](null);
  delete ctx.request;
  await defs[`/${METHOD_LIST_ASSETS_FULL}`](null);

  assert.deepEqual(FakeCloudfwClient.instances.map((client) => client.calls[0].request.map), [
    { currentPage: '1' },
    { currentPage: '2' },
    { currentPage: '3' },
    {},
  ]);
});

test('runtime helper exposes operation metadata for all planned methods', () => {
  const runtime = createRuntime({ loadSdk: async () => fakeSdk });
  assert.equal(Object.keys(runtime.handlers).length, _test.operationSpecs.length);
  assert.ok(_test.operationSpecs.every((spec) => spec.fullMethod.startsWith('aliyun.cloudfw.v1.AliyunCloudFWService/')));
});

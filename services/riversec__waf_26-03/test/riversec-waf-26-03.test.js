import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';

import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';

import { RiversecClient, signRequest, buildCanonicalQueryString, EMPTY_MD5_HASH, resolveVerifySSL, buildTlsOptions } from '../src/riversec-client.js';
import {
  METHOD_PATHS,
  _test,
  handlers,
  mapAPIError,
  checkAPIResponse,
  mapSiteSummary,
} from '../src/riversec-handlers.js';
import { service } from '../src/service.js';
import { MockRuishuDevice } from './mock_upstream.js';

const originalFetch = globalThis.fetch;

const TEST_CONFIG = {
  baseUrl: 'http://127.0.0.1:20167',
  timeout: 5000,
  verifySSL: false,
  maxRetries: 0,
};

const TEST_SECRET = {
  tokenId: 'api_admin',
  tokenValue: 'test-token-value',
};

const buildCtx = (overrides = {}) => ({
  bindings: {
    baseUrl: TEST_CONFIG.baseUrl,
    ...TEST_SECRET,
    ...(overrides.bindings || {}),
  },
  config: overrides.config || {},
  secret: overrides.secret || {},
  limits: { timeoutMs: 5000, ...(overrides.limits || {}) },
  meta: { instance_id: 'inst-demo', request_id: 'req-demo', ...(overrides.meta || {}) },
  req: overrides.req || {},
});

const setFetch = (impl) => {
  globalThis.fetch = impl;
};

test.afterEach(() => {
  globalThis.fetch = originalFetch;
});

test('service exports handlers for all migrated RPC paths', () => {
  assert.equal(typeof service, 'object');
  for (const path of Object.values(METHOD_PATHS)) {
    assert.equal(typeof handlers[path], 'function', `missing handler for ${path}`);
  }
});

test('signature example from Botgate documentation', () => {
  const canonicalRequest = [
    'POST',
    '/api/v1/ip_black_list/switch',
    '',
    '1567739882',
    '93cce320-8180-4a54-b58e-62805060adae',
    'api_admin',
    '4851bc309e682b6efe3804df45cf9749',
  ].join('\n');
  const signature = crypto
    .createHmac('sha256', '0a1de493ccef089479d502d384fd8b1f')
    .update(canonicalRequest, 'utf8')
    .digest('hex');
  assert.equal(signature, '09c2d61f43acc26e0fb6da2644bd6a9a0c82f74e18f616eba059a18f4f58021b');
  assert.equal(EMPTY_MD5_HASH, 'd41d8cd98f00b204e9800998ecf8427e');
});

test('buildCanonicalQueryString sorts keys', () => {
  const qs = buildCanonicalQueryString({ banana: '1', apple: '2', zebra: '3' });
  assert.ok(qs.startsWith('apple=2'));
  assert.ok(qs.includes('banana=1'));
  assert.ok(qs.endsWith('zebra=3'));
});

test('mapAPIError maps err_no to legacy codes', () => {
  assert.equal(mapAPIError(2), 'UNAUTHENTICATED');
  assert.equal(mapAPIError(4), 'INVALID_ARGUMENT');
  assert.equal(mapAPIError(10), 'PERMISSION_DENIED');
  assert.equal(mapAPIError(999), 'FAILED_PRECONDITION');
});

test('mapSiteSummary maps protected site summary', () => {
  const result = mapSiteSummary({
    id: 'test_80',
    protocol: 'http',
    port: 80,
    type: 'domain',
    site: 'test.com',
    name: 'Test',
    protection_mode: 'intercept',
    waf_strategy: { enable: true, monitor_only: false, type: 'standard' },
  });
  assert.equal(result.id, 'test_80');
  assert.equal(result.waf_strategy.type, 'standard');
});

test('checkAPIResponse throws on business err_no', () => {
  assert.throws(
    () => checkAPIResponse({ data: { err_no: 4, err_msg: 'Argument error' } }, 200),
    (err) => err instanceof GrpcError && err.legacyCode === 'INVALID_ARGUMENT',
  );
});

test('checkAPIResponse maps HTTP 400 auth errors from response body', () => {
  assert.throws(
    () => checkAPIResponse({ data: { err_no: 3, err_msg: 'No token for tokenid in request' } }, 400),
    (err) => err instanceof GrpcError && err.legacyCode === 'UNAUTHENTICATED',
  );
});

test('resolveVerifySSL defaults to true and honors explicit false', () => {
  assert.equal(resolveVerifySSL({}), true);
  assert.equal(resolveVerifySSL({ baseUrl: 'https://example.com' }), true);
  assert.equal(resolveVerifySSL({ verifySSL: true }), true);
  assert.equal(resolveVerifySSL({ verifySSL: false }), false);
  assert.equal(resolveVerifySSL({ skipTlsVerify: true }), false);
});

test('buildTlsOptions uses fetch init flags instead of global TLS env', () => {
  assert.deepEqual(buildTlsOptions({ verifySSL: true }), {});
  assert.deepEqual(buildTlsOptions({ verifySSL: false }), {
    skipTlsVerify: true,
    tlsInsecureSkipVerify: true,
    insecureSkipVerify: true,
  });
});

test('RiversecClient does not mutate process env on construction or request', async () => {
  const previousNoProxy = process.env.NO_PROXY;
  const previousTlsReject = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  let capturedInit;

  setFetch(async (_url, init) => {
    capturedInit = init;
    return new Response(JSON.stringify({ err_no: 0, value: 'off' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });

  const client = new RiversecClient(
    { baseUrl: 'https://192.168.2.200:20167', verifySSL: false },
    { tokenId: 'api_admin', tokenValue: 'test-token-value' },
  );
  assert.equal(process.env.NO_PROXY, previousNoProxy);
  assert.equal(process.env.NODE_TLS_REJECT_UNAUTHORIZED, previousTlsReject);

  await client.getBlacklistStatus();
  assert.equal(capturedInit.insecureSkipVerify, true);
  assert.equal(process.env.NO_PROXY, previousNoProxy);
  assert.equal(process.env.NODE_TLS_REJECT_UNAUTHORIZED, previousTlsReject);
});

test('BlockIP fails when upstream reports invalid_ip', async () => {
  setFetch(async () => new Response(JSON.stringify({
    err_no: 0,
    err_msg: 'Success',
    added_number: 0,
    total_number: 1,
    invalid_ip: ['bad-ip'],
  }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

  await assert.rejects(
    () => handlers[METHOD_PATHS.blockIP](buildCtx({
      req: { ip_list: ['203.0.113.10'] },
    })),
    (err) => err instanceof GrpcError && err.legacyCode === 'FAILED_PRECONDITION',
  );
});

test('BlockIP succeeds when upstream omits added_number but item appears in blacklist', async () => {
  let getCalls = 0;
  setFetch(async (url, init) => {
    if (init.method === 'PUT') {
      return new Response(JSON.stringify({
        err_no: 0,
        err_msg: 'Success',
        total_number: 1,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    getCalls += 1;
    return new Response(JSON.stringify({
      err_no: 0,
      items: ['203.0.113.10/32'],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  });

  const result = await handlers[METHOD_PATHS.blockIP](buildCtx({
    req: { ip_list: ['203.0.113.10'] },
  }));
  assert.equal(result.success, true);
  assert.equal(result.added_number, 1);
  assert.equal(getCalls, 1);
});

test('BlockIP rejects unsupported remark and duration_seconds', async () => {
  await assert.rejects(
    () => handlers[METHOD_PATHS.blockIP](buildCtx({
      req: { ip_list: ['203.0.113.10'], remark: 'incident-001' },
    })),
    (err) => err instanceof GrpcError && err.legacyCode === 'INVALID_ARGUMENT',
  );

  await assert.rejects(
    () => handlers[METHOD_PATHS.blockIP](buildCtx({
      req: { ip_list: ['203.0.113.10'], duration_seconds: 3600 },
    })),
    (err) => err instanceof GrpcError && err.legacyCode === 'INVALID_ARGUMENT',
  );
});

test('setBlacklistStatus rejects invalid status values', async () => {
  await assert.rejects(
    () => handlers[METHOD_PATHS.setBlacklistStatus](buildCtx({ req: { status: 'enabled' } })),
    (err) => err instanceof GrpcError && err.legacyCode === 'INVALID_ARGUMENT',
  );
});

test('createProtectedSite validates required fields', async () => {
  await assert.rejects(
    () => handlers[METHOD_PATHS.createProtectedSite](buildCtx({ req: { type: 'domain' } })),
    (err) => err instanceof GrpcError && err.legacyCode === 'INVALID_ARGUMENT',
  );
});

test('createProtectedSite accepts Connect camelCase request fields', () => {
  assert.doesNotThrow(() => _test.validateCreateProtectedSiteRequest(sampleSitePayloadConnect()));
  const payload = _test.buildCreateSitePayload(sampleSitePayloadConnect());
  assert.equal(payload.protection_mode, 'monitor');
  assert.deepEqual(payload.upstream.upstream_list, [{ enable: true, ip: '10.0.0.2', port: 8080 }]);
  assert.equal(payload.upstream.load_balance, 'round_robin');
});

test('batchUpdateProtectedSites rejects empty site_list and empty config', async () => {
  await assert.rejects(
    () => handlers[METHOD_PATHS.batchUpdateProtectedSites](buildCtx({
      req: { site_list: [], config: { protection_mode: 'monitor' } },
    })),
    (err) => err instanceof GrpcError && err.legacyCode === 'INVALID_ARGUMENT',
  );

  await assert.rejects(
    () => handlers[METHOD_PATHS.batchUpdateProtectedSites](buildCtx({
      req: { site_list: ['site_80'], config: {} },
    })),
    (err) => err instanceof GrpcError && err.legacyCode === 'INVALID_ARGUMENT',
  );
});

test('batchUpdateProtectedSites rejects oversized site_list', async () => {
  await assert.rejects(
    () => handlers[METHOD_PATHS.batchUpdateProtectedSites](buildCtx({
      req: {
        site_list: Array.from({ length: 1001 }, (_, i) => `site_${i}`),
        config: { protection_mode: 'monitor' },
      },
    })),
    (err) => err instanceof GrpcError && err.legacyCode === 'INVALID_ARGUMENT',
  );
});

test('SetBlacklist and AddBlacklistItems reject invalid IP formats', async () => {
  await assert.rejects(
    () => handlers[METHOD_PATHS.setBlacklist](buildCtx({ req: { items: ['not-an-ip'] } })),
    (err) => err instanceof GrpcError && err.legacyCode === 'INVALID_ARGUMENT',
  );

  await assert.rejects(
    () => handlers[METHOD_PATHS.addBlacklistItems](buildCtx({ req: { items: ['bad-ip/24'] } })),
    (err) => err instanceof GrpcError && err.legacyCode === 'INVALID_ARGUMENT',
  );
});

test('SetBlacklist normalizes bare IPv4 to /32 CIDR', async () => {
  let capturedBody;
  setFetch(async (_url, init) => {
    capturedBody = JSON.parse(init.body);
    return new Response(JSON.stringify({ err_no: 0 }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });

  await handlers[METHOD_PATHS.setBlacklist](buildCtx({ req: { items: ['203.0.113.10'] } }));
  assert.deepEqual(capturedBody.items, ['203.0.113.10/32']);
});

test('uploadResourceFile rejects unsafe file names', async () => {
  await assert.rejects(
    () => handlers[METHOD_PATHS.uploadResourceFile](buildCtx({
      req: { file_name: '../etc/passwd', type: 'list', file_content: '127.0.0.1' },
    })),
    (err) => err instanceof GrpcError && err.legacyCode === 'INVALID_ARGUMENT',
  );

  await assert.rejects(
    () => handlers[METHOD_PATHS.uploadResourceFile](buildCtx({
      req: { file_name: 'bad name.list', type: 'list', file_content: '127.0.0.1' },
    })),
    (err) => err instanceof GrpcError && err.legacyCode === 'INVALID_ARGUMENT',
  );
});

test('GetSSOToken rejects invalid username', async () => {
  await assert.rejects(
    () => handlers[METHOD_PATHS.getSSOToken](buildCtx({ req: { username: 'admin@evil' } })),
    (err) => err instanceof GrpcError && err.legacyCode === 'INVALID_ARGUMENT',
  );
});

test('upgradeCluster rejects invalid base64 upgrade_package', async () => {
  await assert.rejects(
    () => handlers[METHOD_PATHS.upgradeCluster](buildCtx({
      req: { upgrade_package: 'not-valid-base64!!!' },
    })),
    (err) => err instanceof GrpcError && err.legacyCode === 'INVALID_ARGUMENT',
  );
});

test('shouldRemoveBlacklistItem matches normalized blacklist entries', () => {
  const removeSet = _test.buildBlacklistRemoveSet(['203.0.113.10']);
  assert.equal(_test.shouldRemoveBlacklistItem('203.0.113.10/32', removeSet), true);
  assert.equal(_test.shouldRemoveBlacklistItem('198.51.100.1/32', removeSet), false);
});

test('normalizeHostCIDR rejects IPv4 with leading zeros', () => {
  assert.throws(
    () => _test.normalizeHostCIDR('010.0.0.1'),
    (err) => err instanceof GrpcError && err.legacyCode === 'INVALID_ARGUMENT',
  );
});

test('normalizeHostCIDR rejects invalid IPv6 with too many segments', () => {
  assert.throws(
    () => _test.normalizeHostCIDR('1:2:3:4:5:6:7:8:9'),
    (err) => err instanceof GrpcError && err.legacyCode === 'INVALID_ARGUMENT',
  );
});

test('UnblockIP rejects ip_list not present in current blacklist', async () => {
  setFetch(async (url, init) => {
    if (init.method === 'GET') {
      return new Response(JSON.stringify({ err_no: 0, items: ['203.0.113.10/32'] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    throw new Error('unexpected fetch');
  });

  await assert.rejects(
    () => handlers[METHOD_PATHS.unblockIP](buildCtx({
      req: { ip_list: ['198.51.100.1'] },
    })),
    (err) => err instanceof GrpcError && err.legacyCode === 'FAILED_PRECONDITION',
  );
});

test('wrap maps upstream network failures to UNAVAILABLE', async () => {
  setFetch(async () => {
    throw new TypeError('fetch failed', { cause: new Error('connect ECONNREFUSED') });
  });

  await assert.rejects(
    () => handlers[METHOD_PATHS.getBlacklistStatus](buildCtx()),
    (err) => err instanceof GrpcError && err.code === grpcStatus.UNAVAILABLE,
  );
});

const sampleSitePayload = () => ({
  type: 'domain',
  site: 'test.example.com',
  protocol: 'http',
  port: 8080,
  protection_mode: 'intercept',
  name: 'Demo',
  upstream: {
    protocol: 'http',
    upstream_list: [{ enable: true, ip: '10.0.0.1', port: 8080 }],
    load_balance: 'round_robin',
  },
});

const sampleSitePayloadConnect = () => ({
  type: 'domain',
  site: 'connect.example.com',
  protocol: 'http',
  port: 8080,
  protectionMode: 'monitor',
  upstream: {
    protocol: 'http',
    upstreamList: [{ enable: true, ip: '10.0.0.2', port: 8080 }],
    loadBalance: 'round_robin',
  },
});

const sampleApiPayload = () => ({
  api_name: 'test-api',
  group_name: 'default',
  method: 'GET',
  port: 443,
  host: 'api.example.com',
  api_endpoint: '/v1/test',
  match_sub_path: 'false',
});

const mockCtx = (mock, req = {}) => buildCtx({
  bindings: { baseUrl: mock.baseUrl, ...TEST_SECRET },
  req,
});

test('all RPC handlers succeed against mock upstream', async () => {
  const mock = new MockRuishuDevice(0);
  await mock.start();

  try {
    const h = handlers;
    const p = METHOD_PATHS;

    // IPBlacklistService (8 RPCs)
    const blacklistStatus = await h[p.getBlacklistStatus](mockCtx(mock));
    assert.equal(blacklistStatus.status, 'off');

    await h[p.setBlacklistStatus](mockCtx(mock, { status: 'on' }));
    const enabledStatus = await h[p.getBlacklistStatus](mockCtx(mock));
    assert.equal(enabledStatus.status, 'on');

    await h[p.setBlacklist](mockCtx(mock, { items: ['10.10.114.114/32'] }));
    const blacklist = await h[p.getBlacklist](mockCtx(mock));
    assert.deepEqual(blacklist.items, ['10.10.114.114/32']);

    const added = await h[p.addBlacklistItems](mockCtx(mock, { items: ['10.10.26.0/24'] }));
    assert.equal(added.added_number, 1);

    const blocked = await h[p.blockIP](mockCtx(mock, { ip_list: ['203.0.113.10'] }));
    assert.equal(blocked.success, true);
    assert.equal(blocked.added_number, 1);

    const unblocked = await h[p.unblockIP](mockCtx(mock, { ip_list: ['203.0.113.10'] }));
    assert.equal(unblocked.success, true);

    await h[p.clearBlacklist](mockCtx(mock));
    const cleared = await h[p.getBlacklist](mockCtx(mock));
    assert.deepEqual(cleared.items, []);

    // ProtectedSiteService (6 RPCs)
    const created = await h[p.createProtectedSite](mockCtx(mock, sampleSitePayload()));
    assert.ok(created.id);

    const listed = await h[p.listProtectedSites](mockCtx(mock));
    assert.ok(listed.sites.some((site) => site.id === created.id));

    const detail = await h[p.getProtectedSite](mockCtx(mock, { id: created.id }));
    assert.equal(detail.id, created.id);
    assert.equal(detail.site, 'test.example.com');

    await h[p.updateProtectedSite](mockCtx(mock, {
      id: created.id,
      protection_mode: 'monitor',
    }));

    await h[p.batchUpdateProtectedSites](mockCtx(mock, {
      site_list: [created.id],
      config: { protection_mode: 'passthrough' },
    }));

    await h[p.deleteProtectedSite](mockCtx(mock, { id: created.id }));
    const afterDelete = await h[p.listProtectedSites](mockCtx(mock));
    assert.ok(!afterDelete.sites.some((site) => site.id === created.id));

    const createdViaConnect = await h[p.createProtectedSite](mockCtx(mock, sampleSitePayloadConnect()));
    assert.ok(createdViaConnect.id);
    await h[p.deleteProtectedSite](mockCtx(mock, { id: createdViaConnect.id }));

    // ClusterService (4 RPCs)
    const sso = await h[p.getSSOToken](mockCtx(mock, { username: 'admin' }));
    assert.match(sso.url, /^https:\/\//);

    const cluster = await h[p.getClusterInfo](mockCtx(mock));
    assert.equal(cluster.product_type, 'Botgate');
    assert.equal(cluster.nodes.length, 2);

    await h[p.upgradeCluster](mockCtx(mock, {
      upgrade_package: Buffer.from('mock-upgrade-package'),
    }));
    await h[p.rollbackCluster](mockCtx(mock));

    // ProgrammableRuleService (7 RPCs)
    const editorOff = await h[p.getEditorStatus](mockCtx(mock));
    assert.equal(editorOff.status, 'off');

    await h[p.setEditorStatus](mockCtx(mock, { status: 'on' }));
    const editorOn = await h[p.getEditorStatus](mockCtx(mock));
    assert.equal(editorOn.status, 'on');

    await h[p.updateWebRule](mockCtx(mock, { manual_rule: '// mock web rule' }));
    await h[p.updateAppRule](mockCtx(mock, { manual_rule: '// mock app rule' }));

    await h[p.setRuleStatus](mockCtx(mock, { id: 'rule-001', status: 'on' }));
    const ruleOn = await h[p.getRuleStatus](mockCtx(mock, { id: 'rule-001' }));
    assert.equal(ruleOn.status, 'on');

    await h[p.uploadResourceFile](mockCtx(mock, {
      file_name: 'demo.list',
      type: 'list',
      file_content: '127.0.0.1',
    }));

    // APIManagementService (5 RPCs)
    const emptyApis = await h[p.listAPIs](mockCtx(mock));
    assert.deepEqual(emptyApis.api_list, []);

    await h[p.addAPI](mockCtx(mock, sampleApiPayload()));
    const apis = await h[p.listAPIs](mockCtx(mock));
    assert.equal(apis.api_list.length, 1);
    const apiId = apis.api_list[0].id;

    await h[p.setAPIOnlineStatus](mockCtx(mock, { id: apiId, status: 'off' }));
    await h[p.ignoreAPI](mockCtx(mock, { api_id: apiId }));
    await h[p.deleteAPI](mockCtx(mock, { api_id: apiId }));

    const apisAfterDelete = await h[p.listAPIs](mockCtx(mock));
    assert.deepEqual(apisAfterDelete.api_list, []);
  } finally {
    await mock.stop();
  }
});

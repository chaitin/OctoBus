import assert from 'node:assert/strict';
import test from 'node:test';

import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';

import {
  RPC_DOMAIN_LIST,
  RPC_SERVICE_DETAIL,
  RPC_DOMAIN_RULE_ACT,
  RPC_DOMAIN_RULE_CONFIG,
  RPC_WAF_CONFIG,
  RPC_ACCESS_CONTROL_SWITCH,
  RPC_INSERT_ACCESS_CONTROL,
  RPC_UPDATE_ACCESS_CONTROL_SWITCH,
  RPC_RESOURCE_PACKAGES,
  RPC_IPV6_NO_SUP_LINK,
  _test,
  handlers,
} from '../src/ctyun-accessone.js';
import { service } from '../src/service.js';
import { createMockServer } from './mock_upstream.js';

const originalFetch = globalThis.fetch;
const originalLog = console.log;

const response = (status, body) => ({
  status,
  text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
});

const setFetch = (impl) => { globalThis.fetch = impl; };

const buildCtx = (overrides = {}) => ({
  config: {
    ctyun_gateway: 'accessone-global.ctapi.ctyun.cn',
    ...(overrides.config || {}),
  },
  secret: {
    ctyun_ak: 'valid_ak',
    ctyun_sk: 'valid_sk',
    ...(overrides.secret || {}),
  },
  bindings: { ...(overrides.bindings || {}) },
  limits: { timeoutMs: 10_000, ...(overrides.limits || {}) },
  meta: { instance_id: 'inst', request_id: 'req', ...(overrides.meta || {}) },
  req: overrides.req || {},
});

const expectGrpcError = async (fn, legacyCode, checker = () => {}) => {
  let caught;
  try { await fn(); } catch (err) { caught = err; }
  assert.ok(caught, 'expected function to reject');
  assert.ok(caught instanceof GrpcError);
  assert.equal(caught.legacyCode, legacyCode);
  assert.equal(caught.code, ({
    FAILED_PRECONDITION: grpcStatus.FAILED_PRECONDITION,
    INVALID_ARGUMENT: grpcStatus.INVALID_ARGUMENT,
    PERMISSION_DENIED: grpcStatus.PERMISSION_DENIED,
    UNAVAILABLE: grpcStatus.UNAVAILABLE,
    UNKNOWN: grpcStatus.UNKNOWN,
  })[legacyCode]);
  checker(caught);
};

test.afterEach(() => {
  globalThis.fetch = originalFetch;
  console.log = originalLog;
});

// ── Service structure ──
test('service exports 10 handlers', () => {
  assert.equal(typeof service, 'object');
  for (const rpc of [RPC_DOMAIN_LIST, RPC_SERVICE_DETAIL, RPC_DOMAIN_RULE_ACT,
    RPC_DOMAIN_RULE_CONFIG, RPC_WAF_CONFIG, RPC_ACCESS_CONTROL_SWITCH,
    RPC_INSERT_ACCESS_CONTROL, RPC_UPDATE_ACCESS_CONTROL_SWITCH,
    RPC_RESOURCE_PACKAGES, RPC_IPV6_NO_SUP_LINK]) {
    assert.equal(typeof handlers[rpc], 'function', `handler for ${rpc} should be a function`);
  }
});

// ── 1. QueryDomainList (GET) ──
test('QueryDomainList: success (no filters)', async () => {
  let captured;
  setFetch(async (url, init) => {
    captured = { url: String(url), init };
    return response(200, { statusCode: 100000, message: 'ok', returnObj: { total: 2, result: [] } });
  });

  const result = await handlers[RPC_DOMAIN_LIST]({}, buildCtx());
  assert.equal(result.http_status, 200);
  assert.match(captured.url, /\/ctapi\/v2\/domain\/query$/);
  assert.match(captured.init.headers['Eop-Authorization'], /^valid_ak /);
});

test('QueryDomainList: with filters', async () => {
  let captured;
  setFetch(async (url, init) => {
    captured = { url: String(url), init };
    return response(200, { statusCode: 100000, returnObj: { total: 0 } });
  });

  await handlers[RPC_DOMAIN_LIST]({
    product_code: { value: '020' },
    page: { value: 1 },
    page_size: { value: 10 },
  }, buildCtx());
  assert.match(captured.url, /page=1/);
  assert.match(captured.url, /page_size=10/);
});

test('QueryDomainList: missing AK', async () => {
  await expectGrpcError(
    () => handlers[RPC_DOMAIN_LIST]({}, buildCtx({ secret: { ctyun_ak: '', ctyun_sk: 's' } })),
    'INVALID_ARGUMENT',
    (e) => assert.match(e.message, /ctyun_ak/),
  );
});

// ── 2. QueryServiceDetail (POST) ──
test('QueryServiceDetail: success', async () => {
  let captured;
  setFetch(async (url, init) => {
    captured = { url: String(url), init };
    return response(200, { statusCode: 100000, message: 'ok', result: [] });
  });

  const result = await handlers[RPC_SERVICE_DETAIL]({ product_code: ['010'] }, buildCtx());
  assert.equal(result.http_status, 200);
  assert.match(captured.url, /sevice_detail/);
  assert.equal(JSON.parse(captured.init.body).product_code[0], '010');
});

test('QueryServiceDetail: missing product_code', async () => {
  await expectGrpcError(
    () => handlers[RPC_SERVICE_DETAIL]({ product_code: [] }, buildCtx()),
    'INVALID_ARGUMENT',
  );
});

// ── 3. QueryDomainRuleAct (POST) ──
test('QueryDomainRuleAct: success', async () => {
  setFetch(async () => response(200, { statusCode: 100000, data: { domainRuleAct: 'ON' } }));
  const result = await handlers[RPC_DOMAIN_RULE_ACT]({ domain: 'test.com', product_code: '020' }, buildCtx());
  assert.equal(result.http_status, 200);
  assert.match(result.http_body, /domainRuleAct/);
});

test('QueryDomainRuleAct: missing domain', async () => {
  await expectGrpcError(
    () => handlers[RPC_DOMAIN_RULE_ACT]({ domain: '', product_code: '020' }, buildCtx()),
    'INVALID_ARGUMENT',
  );
});

// ── 4. QueryDomainRuleConfig (POST) ──
test('QueryDomainRuleConfig: success', async () => {
  setFetch(async () => response(200, { statusCode: 100000, returnObj: { total: 918 } }));
  const result = await handlers[RPC_DOMAIN_RULE_CONFIG]({ domain: 'test.com', product_code: '020' }, buildCtx());
  assert.equal(result.http_status, 200);
  assert.match(result.http_body, /918/);
});

// ── 5. QueryWafConfig (POST) ──
test('QueryWafConfig: success', async () => {
  setFetch(async () => response(200, { statusCode: 100000, data: { webProtectAct: 'ON' } }));
  const result = await handlers[RPC_WAF_CONFIG]({ domain: 'test.com', product_code: '020' }, buildCtx());
  assert.equal(result.http_status, 200);
});

test('QueryWafConfig: missing domain', async () => {
  await expectGrpcError(
    () => handlers[RPC_WAF_CONFIG]({ domain: '', product_code: '020' }, buildCtx()),
    'INVALID_ARGUMENT',
  );
});

// ── 6. QueryAccessControlSwitch (POST) ──
test('QueryAccessControlSwitch: success', async () => {
  setFetch(async () => response(200, { code: '100000', data: { mod: 'ON' } }));
  const result = await handlers[RPC_ACCESS_CONTROL_SWITCH]({ domain: 'test.com', product_code: '020' }, buildCtx());
  assert.equal(result.http_status, 200);
  assert.match(result.http_body, /"mod":"ON"/);
});

// ── 7. QueryResourcePackages (POST) ──
test('QueryResourcePackages: success', async () => {
  setFetch(async () => response(200, { statusCode: 100000, returnObj: {} }));
  const result = await handlers[RPC_RESOURCE_PACKAGES]({}, buildCtx());
  assert.equal(result.http_status, 200);
});

// ── 8. QueryIPv6NoSupLink (POST) ──
test('QueryIPv6NoSupLink: success', async () => {
  let captured;
  setFetch(async (url, init) => {
    captured = { url: String(url), init };
    return response(200, { statusCode: 100000, message: 'success', returnObj: { noSupLinks: [] } });
  });

  const result = await handlers[RPC_IPV6_NO_SUP_LINK]({ request_id: 1502 }, buildCtx());
  assert.equal(result.http_status, 200);
  assert.match(captured.url, /getNoSupLink/);
  assert.equal(JSON.parse(captured.init.body).requestId, 1502);
});

test('QueryIPv6NoSupLink: missing requestId', async () => {
  await expectGrpcError(
    () => handlers[RPC_IPV6_NO_SUP_LINK]({}, buildCtx()),
    'INVALID_ARGUMENT',
    (e) => assert.match(e.message, /request_id/),
  );
});

test('QueryIPv6NoSupLink: invalid requestId (negative)', async () => {
  await expectGrpcError(
    () => handlers[RPC_IPV6_NO_SUP_LINK]({ request_id: -1 }, buildCtx()),
    'INVALID_ARGUMENT',
  );
});

// ── 9. InsertAccessControl (POST, 写) ──
test('InsertAccessControl: success (basic)', async () => {
  let captured;
  setFetch(async (url, init) => {
    captured = { url: String(url), init };
    return response(200, { code: '100000', data: [{ successIds: [99999] }], message: 'success' });
  });

  const result = await handlers[RPC_INSERT_ACCESS_CONTROL]({
    domains: ['test-jzb.ctcdn.cn'],
    product_code: '020',
    configs: [{ mod: 'ON', act: 'LOG', rule_name: 'hermes_test' }],
  }, buildCtx());
  assert.equal(result.http_status, 200);
  assert.match(captured.url, /accessControlInsert/);
  const body = JSON.parse(captured.init.body);
  assert.equal(body.productCode, '020');
  assert.equal(body.accessControlConfigs[0].ruleName, 'hermes_test');
});

test('InsertAccessControl: success (with publicRange)', async () => {
  let captured;
  setFetch(async (url, init) => {
    captured = { url: String(url), init };
    return response(200, { code: '100000', data: [{ successIds: [88888] }], message: 'success' });
  });

  const result = await handlers[RPC_INSERT_ACCESS_CONTROL]({
    domains: ['test-jzb.ctcdn.cn'],
    product_code: '020',
    configs: [{
      mod: 'ON',
      act: 'LOG',
      rule_name: 'with_ip_rule',
      public_range: [[{
        zone: 'IP',
        equal: 'true',
        public_content: '192.0.2.1',
      }]],
    }],
  }, buildCtx());
  assert.equal(result.http_status, 200);
  const body = JSON.parse(captured.init.body);
  assert.deepEqual(body.accessControlConfigs[0].publicRange, [[{ zone: 'IP', equal: 'true', publicContent: '192.0.2.1' }]]);
});

test('InsertAccessControl: missing domains', async () => {
  await expectGrpcError(
    () => handlers[RPC_INSERT_ACCESS_CONTROL]({ domains: [], product_code: '020', configs: [{ mod: 'ON', act: 'LOG', rule_name: 'x' }] }, buildCtx()),
    'INVALID_ARGUMENT',
    (e) => assert.match(e.message, /domains/),
  );
});

test('InsertAccessControl: missing product_code', async () => {
  await expectGrpcError(
    () => handlers[RPC_INSERT_ACCESS_CONTROL]({ domains: ['a.com'], product_code: '', configs: [{ mod: 'ON', act: 'LOG', rule_name: 'x' }] }, buildCtx()),
    'INVALID_ARGUMENT',
    (e) => assert.match(e.message, /product_code/),
  );
});

test('InsertAccessControl: missing configs', async () => {
  await expectGrpcError(
    () => handlers[RPC_INSERT_ACCESS_CONTROL]({ domains: ['a.com'], product_code: '020', configs: [] }, buildCtx()),
    'INVALID_ARGUMENT',
    (e) => assert.match(e.message, /configs/),
  );
});

test('InsertAccessControl: invalid mod (must be ON or OFF)', async () => {
  await expectGrpcError(
    () => handlers[RPC_INSERT_ACCESS_CONTROL]({ domains: ['a.com'], product_code: '020', configs: [{ mod: 'CLOSE', act: 'LOG', rule_name: 'x' }] }, buildCtx()),
    'INVALID_ARGUMENT',
    (e) => assert.match(e.message, /"ON" or "OFF"/),
  );
});

test('InsertAccessControl: domains limit exceeded', async () => {
  const manyDomains = Array.from({ length: 51 }, (_, i) => `d${i}.com`);
  await expectGrpcError(
    () => handlers[RPC_INSERT_ACCESS_CONTROL]({ domains: manyDomains, product_code: '020', configs: [{ mod: 'ON', act: 'LOG', rule_name: 'x' }] }, buildCtx()),
    'INVALID_ARGUMENT',
    (e) => assert.match(e.message, /domains limit exceeded/),
  );
});

test('InsertAccessControl: configs limit exceeded', async () => {
  const manyConfigs = Array.from({ length: 21 }, (_, i) => ({ mod: 'ON', act: 'LOG', rule_name: `rule_${i}` }));
  await expectGrpcError(
    () => handlers[RPC_INSERT_ACCESS_CONTROL]({ domains: ['a.com'], product_code: '020', configs: manyConfigs }, buildCtx()),
    'INVALID_ARGUMENT',
    (e) => assert.match(e.message, /configs limit exceeded/),
  );
});

test('InsertAccessControl: invalid public_range structure', async () => {
  // grp 既不是数组也不含 items 数组 — 应抛错而非静默降级
  await expectGrpcError(
    () => handlers[RPC_INSERT_ACCESS_CONTROL]({
      domains: ['a.com'], product_code: '020',
      configs: [{ mod: 'ON', act: 'LOG', rule_name: 'x', public_range: [{ notItems: 'wrong' }] }],
    }, buildCtx()),
    'INVALID_ARGUMENT',
    (e) => assert.match(e.message, /public_range/),
  );
});

// ── 10. UpdateAccessControlSwitch (POST, 写) ──
test('UpdateAccessControlSwitch: success ON', async () => {
  let captured;
  setFetch(async (url, init) => {
    captured = { url: String(url), init };
    return response(200, { code: '100000', data: { mod: 'ON' }, message: 'success' });
  });

  const result = await handlers[RPC_UPDATE_ACCESS_CONTROL_SWITCH]({
    domain: 'test-jzb.ctcdn.cn',
    product_code: '020',
    mod: 'ON',
  }, buildCtx());
  assert.equal(result.http_status, 200);
  assert.match(captured.url, /updateAccessControlAct/);
  assert.equal(JSON.parse(captured.init.body).mod, 'ON');
});

test('UpdateAccessControlSwitch: success CLOSE', async () => {
  let captured;
  setFetch(async (url, init) => {
    captured = { url: String(url), init };
    return response(200, { code: '100000', data: { mod: 'CLOSE' }, message: 'success' });
  });

  const result = await handlers[RPC_UPDATE_ACCESS_CONTROL_SWITCH]({
    domain: 'test-jzb.ctcdn.cn',
    product_code: '020',
    mod: 'CLOSE',
  }, buildCtx());
  assert.equal(result.http_status, 200);
  assert.equal(JSON.parse(captured.init.body).mod, 'CLOSE');
});

test('UpdateAccessControlSwitch: invalid mod', async () => {
  await expectGrpcError(
    () => handlers[RPC_UPDATE_ACCESS_CONTROL_SWITCH]({ domain: 'x.com', product_code: '020', mod: 'INVALID' }, buildCtx()),
    'INVALID_ARGUMENT',
    (e) => assert.match(e.message, /mod must be "ON" or "CLOSE"/),
  );
});

test('UpdateAccessControlSwitch: missing domain', async () => {
  await expectGrpcError(
    () => handlers[RPC_UPDATE_ACCESS_CONTROL_SWITCH]({ domain: '', product_code: '020', mod: 'ON' }, buildCtx()),
    'INVALID_ARGUMENT',
    (e) => assert.match(e.message, /domain/),
  );
});

// ── Auth error ──
test('QueryDomainRuleAct: auth error (403)', async () => {
  setFetch(async () => response(403, { code: 'AUTH_FAILED', message: 'bad auth' }));
  await expectGrpcError(
    () => handlers[RPC_DOMAIN_RULE_ACT]({ domain: 'x.com', product_code: '020' }, buildCtx()),
    'PERMISSION_DENIED',
    (e) => assert.equal(e.response.http_status, 403),
  );
});

// ── Network error ──
test('QueryDomainRuleAct: network error', async () => {
  setFetch(async () => { throw Object.assign(new Error('ECONNREFUSED'), { cause: new Error('refused') }); });
  await expectGrpcError(
    () => handlers[RPC_DOMAIN_RULE_ACT]({ domain: 'x.com', product_code: '020' }, buildCtx()),
    'UNAVAILABLE',
    (e) => assert.match(e.response.http_body, /refused/),
  );
});

// ── Missing SK ──
test('QueryWafConfig: missing SK', async () => {
  await expectGrpcError(
    () => handlers[RPC_WAF_CONFIG]({ domain: 'x.com', product_code: '020' }, buildCtx({ secret: { ctyun_ak: 'a', ctyun_sk: '' } })),
    'INVALID_ARGUMENT',
    (e) => assert.match(e.message, /ctyun_sk/),
  );
});

// ── Helper unit tests ──
test('helper functions', () => {
  assert.equal(_test.grpcCodeFor('NOPE'), grpcStatus.UNKNOWN);
  assert.equal(_test.errorWithCode('NOPE', 'bad').code, grpcStatus.UNKNOWN);
  assert.equal(_test.hasOwn(null, 'x'), false);
  assert.equal(_test.firstDefined(undefined, null, 0, 'x'), 0);
  assert.equal(_test.unwrapScalar({ value: { value: 'nested' } }), 'nested');
  assert.equal(_test.unwrapScalar(undefined), undefined);
  assert.equal(_test.toTrimmedString(null), '');
  assert.equal(_test.resolveGateway({}), 'accessone-global.ctapi.ctyun.cn');
  assert.equal(_test.resolveGateway({ ctyun_gateway: 'custom.host:443' }), 'custom.host:443');
  assert.equal(_test.resolveGateway({ gateway: 'https://gw.host/' }), 'gw.host');
  assert.equal(_test.resolveAk({}), '');
  assert.equal(_test.resolveAk({ ctyun_ak: 'my_ak' }), 'my_ak');
  assert.equal(_test.resolveAk({ ak: 'alias_ak' }), 'alias_ak');
  assert.equal(_test.resolveSk({}), '');
  assert.equal(_test.resolveSk({ ctyun_sk: 'my_sk' }), 'my_sk');
  assert.equal(_test.resolveSk({ sk: 'alias_sk' }), 'alias_sk');
  assert.equal(_test.resolveTimeoutMs(), 10000);
  assert.equal(_test.resolveTimeoutMs({ limits: { timeoutMs: 500 } }), 500);
  assert.equal(_test.resolveTimeoutMs({ limits: { timeoutMs: 'bad' } }), 10000);
  assert.deepEqual(_test.buildTlsOptions({}), {});
  assert.deepEqual(_test.buildTlsOptions({ skipTlsVerify: true }), { skipTlsVerify: true, tlsInsecureSkipVerify: true, insecureSkipVerify: true });
  assert.equal(_test.mapHttpStatusToCode(401), 'PERMISSION_DENIED');
  assert.equal(_test.mapHttpStatusToCode(403), 'PERMISSION_DENIED');
  assert.equal(_test.mapHttpStatusToCode(400), 'FAILED_PRECONDITION');
  assert.equal(_test.mapHttpStatusToCode(500), 'UNAVAILABLE');
  const err = _test.attachResponse(_test.errorWithCode('UNAVAILABLE', 'x'), 500, 'boom');
  assert.deepEqual(err.response, { http_status: 500, http_body: 'boom' });
  assert.deepEqual(_test.mergedBindings({ config: { a: 1 }, secret: { b: 2 }, bindings: { a: 3 } }), { a: 3, b: 2 });
});

// ── EOP signing ──
test('eopDateNow returns valid format', () => {
  const d = _test.eopDateNow();
  assert.match(d, /^\d{8}T\d{6}Z$/);
});

test('makeEopSignature produces valid header', () => {
  const sig = _test.makeEopSignature('ak', 'sk', '20240615T000000Z', 'req-123', '{}');
  assert.match(sig, /^ak Headers=ctyun-eop-request-id;eop-date Signature=/);
  assert.ok(sig.length > 60);
});

// ── Mock upstream integration ──
const skipIntegration = !process.env.RUN_INTEGRATION;
test('mock upstream: all 10 endpoints', { skip: skipIntegration }, async () => {
  const server = await createMockServer();
  try {
    const ctx = buildCtx({ config: { ctyun_gateway: server.url.replace(/^https?:\/\//, '') } });

    const dl = await handlers[RPC_DOMAIN_LIST]({}, ctx);
    assert.equal(dl.http_status, 200);

    const sd = await handlers[RPC_SERVICE_DETAIL]({ product_code: ['010'] }, ctx);
    assert.equal(sd.http_status, 200);

    const dra = await handlers[RPC_DOMAIN_RULE_ACT]({ domain: 'test.com', product_code: '020' }, ctx);
    assert.equal(dra.http_status, 200);

    const drc = await handlers[RPC_DOMAIN_RULE_CONFIG]({ domain: 'test.com', product_code: '020' }, ctx);
    assert.equal(drc.http_status, 200);

    const wc = await handlers[RPC_WAF_CONFIG]({ domain: 'test.com', product_code: '020' }, ctx);
    assert.equal(wc.http_status, 200);

    const acs = await handlers[RPC_ACCESS_CONTROL_SWITCH]({ domain: 'test.com', product_code: '020' }, ctx);
    assert.equal(acs.http_status, 200);

    const iac = await handlers[RPC_INSERT_ACCESS_CONTROL]({ domains: ['test.com'], product_code: '020', configs: [{ mod: 'ON', act: 'LOG', rule_name: 'mock_test' }] }, ctx);
    assert.equal(iac.http_status, 200);

    const uacs = await handlers[RPC_UPDATE_ACCESS_CONTROL_SWITCH]({ domain: 'test.com', product_code: '020', mod: 'ON' }, ctx);
    assert.equal(uacs.http_status, 200);

    const rp = await handlers[RPC_RESOURCE_PACKAGES]({}, ctx);
    assert.equal(rp.http_status, 200);

    const ipv6 = await handlers[RPC_IPV6_NO_SUP_LINK]({ request_id: 1502 }, ctx);
    assert.equal(ipv6.http_status, 200);

    assert.equal(server.requests.length, 10);
  } finally {
    await server.close();
  }
});

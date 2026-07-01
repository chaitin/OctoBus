import test from 'node:test';
import assert from 'node:assert/strict';

import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';

import {
  METHOD_LIST_ENTERPRISE_SUBJECTS_FULL,
  METHOD_BATCH_CREATE_ENTERPRISE_SUBJECTS_FULL,
  METHOD_BATCH_DELETE_ENTERPRISE_SUBJECTS_FULL,
  METHOD_LIST_KEYWORDS_FULL,
  METHOD_BATCH_CREATE_KEYWORDS_FULL,
  METHOD_LIST_SEED_DOMAINS_FULL,
  METHOD_BATCH_CREATE_SEED_DOMAINS_FULL,
  METHOD_LIST_SEED_CERTS_FULL,
  METHOD_LIST_SEED_ICONS_FULL,
  METHOD_LIST_SEED_WEB_TITLES_FULL,
  METHOD_BATCH_UPDATE_SEEDS_FULL,
  METHOD_LIST_ROOT_DOMAINS_FULL,
  METHOD_BATCH_CREATE_ROOT_DOMAINS_FULL,
  METHOD_LIST_SUBDOMAINS_FULL,
  METHOD_LIST_DNS_FULL,
  METHOD_LIST_IPS_FULL,
  METHOD_BATCH_CREATE_IPS_FULL,
  METHOD_LIST_ASSET_CERTS_FULL,
  METHOD_BATCH_UPDATE_ASSET_STATUS_FULL,
  METHOD_BATCH_DELETE_ASSETS_FULL,
  METHOD_LIST_PORTS_FULL,
  METHOD_LIST_OPEN_PORTS_FULL,
  METHOD_LIST_WEB_ENTITIES_FULL,
  METHOD_LIST_WEB_PATHS_FULL,
  METHOD_LIST_WEB_FINGERPRINTS_FULL,
  METHOD_LIST_CRAWLER_DATA_FULL,
  METHOD_LIST_VULNERABILITIES_FULL,
  METHOD_BATCH_UPDATE_VULN_STATUS_FULL,
  METHOD_LIST_HIGH_RISK_APPS_FULL,
  METHOD_GET_HIGH_RISK_APP_FINGERS_FULL,
  METHOD_LIST_HIGH_RISK_SERVICES_FULL,
  METHOD_LIST_VENDORS_FULL,
  METHOD_LIST_PRODUCTS_FULL,
  METHOD_LIST_VULN_SUBJECTS_FULL,
  METHOD_LIST_KB_VULNS_FULL,
  METHOD_LIST_MONITORING_RULES_FULL,
  METHOD_BATCH_CREATE_MONITORING_RULES_FULL,
  METHOD_LIST_GITHUB_LEAKS_FULL,
  METHOD_LIST_DISK_LEAKS_FULL,
  METHOD_LIST_DOC_LEAKS_FULL,
  METHOD_LIST_DARKNET_INTEL_FULL,
  METHOD_LIST_STOLEN_DATA_FULL,
  METHOD_LIST_EMAIL_LEAKS_FULL,
  METHOD_LIST_MOBILE_APPS_FULL,
  METHOD_LIST_SOCIAL_MEDIA_FULL,
  METHOD_LIST_TASK_SCHEDULES_FULL,
  METHOD_CREATE_TASK_SCHEDULE_FULL,
  METHOD_LIST_TASK_INSTANCES_FULL,
  METHOD_CREATE_TASK_INSTANCE_FULL,
  METHOD_LIST_SPACES_FULL,
  METHOD_LIST_TAGS_FULL,
  METHOD_LIST_BUSINESS_UNITS_FULL,
  _test,
  handlers,
  rpcdef,
} from '../src/cloudatlas.js';
import { service } from '../src/service.js';

// Path constants (not exported from source, defined here for rpcdef keys)
const LIST_ENTERPRISE_SUBJECTS_PATH           = '/CloudAtlas.CloudAtlas/ListEnterpriseSubjects';
const BATCH_CREATE_ENTERPRISE_SUBJECTS_PATH    = '/CloudAtlas.CloudAtlas/BatchCreateEnterpriseSubjects';
const BATCH_DELETE_ENTERPRISE_SUBJECTS_PATH    = '/CloudAtlas.CloudAtlas/BatchDeleteEnterpriseSubjects';
const LIST_KEYWORDS_PATH                      = '/CloudAtlas.CloudAtlas/ListKeywords';
const BATCH_CREATE_KEYWORDS_PATH              = '/CloudAtlas.CloudAtlas/BatchCreateKeywords';
const LIST_SEED_DOMAINS_PATH                  = '/CloudAtlas.CloudAtlas/ListSeedDomains';
const BATCH_CREATE_SEED_DOMAINS_PATH          = '/CloudAtlas.CloudAtlas/BatchCreateSeedDomains';
const LIST_SEED_CERTS_PATH                    = '/CloudAtlas.CloudAtlas/ListSeedCerts';
const LIST_SEED_ICONS_PATH                    = '/CloudAtlas.CloudAtlas/ListSeedIcons';
const LIST_SEED_WEB_TITLES_PATH               = '/CloudAtlas.CloudAtlas/ListSeedWebTitles';
const BATCH_UPDATE_SEEDS_PATH                 = '/CloudAtlas.CloudAtlas/BatchUpdateSeeds';
const LIST_ROOT_DOMAINS_PATH                  = '/CloudAtlas.CloudAtlas/ListRootDomains';
const BATCH_CREATE_ROOT_DOMAINS_PATH          = '/CloudAtlas.CloudAtlas/BatchCreateRootDomains';
const LIST_SUBDOMAINS_PATH                    = '/CloudAtlas.CloudAtlas/ListSubdomains';
const LIST_DNS_PATH                           = '/CloudAtlas.CloudAtlas/ListDNS';
const LIST_IPS_PATH                           = '/CloudAtlas.CloudAtlas/ListIPs';
const BATCH_CREATE_IPS_PATH                   = '/CloudAtlas.CloudAtlas/BatchCreateIPs';
const LIST_ASSET_CERTS_PATH                   = '/CloudAtlas.CloudAtlas/ListAssetCerts';
const BATCH_UPDATE_ASSET_STATUS_PATH          = '/CloudAtlas.CloudAtlas/BatchUpdateAssetStatus';
const BATCH_DELETE_ASSETS_PATH                = '/CloudAtlas.CloudAtlas/BatchDeleteAssets';
const LIST_PORTS_PATH                         = '/CloudAtlas.CloudAtlas/ListPorts';
const LIST_OPEN_PORTS_PATH                    = '/CloudAtlas.CloudAtlas/ListOpenPorts';
const LIST_WEB_ENTITIES_PATH                  = '/CloudAtlas.CloudAtlas/ListWebEntities';
const LIST_WEB_PATHS_PATH                     = '/CloudAtlas.CloudAtlas/ListWebPaths';
const LIST_WEB_FINGERPRINTS_PATH              = '/CloudAtlas.CloudAtlas/ListWebFingerprints';
const LIST_CRAWLER_DATA_PATH                  = '/CloudAtlas.CloudAtlas/ListCrawlerData';
const LIST_VULNERABILITIES_PATH               = '/CloudAtlas.CloudAtlas/ListVulnerabilities';
const BATCH_UPDATE_VULN_STATUS_PATH           = '/CloudAtlas.CloudAtlas/BatchUpdateVulnStatus';
const LIST_HIGH_RISK_APPS_PATH                = '/CloudAtlas.CloudAtlas/ListHighRiskApps';
const GET_HIGH_RISK_APP_FINGERS_PATH          = '/CloudAtlas.CloudAtlas/GetHighRiskAppFingers';
const LIST_HIGH_RISK_SERVICES_PATH            = '/CloudAtlas.CloudAtlas/ListHighRiskServices';
const LIST_VENDORS_PATH                       = '/CloudAtlas.CloudAtlas/ListVendors';
const LIST_PRODUCTS_PATH                      = '/CloudAtlas.CloudAtlas/ListProducts';
const LIST_VULN_SUBJECTS_PATH                 = '/CloudAtlas.CloudAtlas/ListVulnSubjects';
const LIST_KB_VULNS_PATH                      = '/CloudAtlas.CloudAtlas/ListKBVulns';
const LIST_MONITORING_RULES_PATH              = '/CloudAtlas.CloudAtlas/ListMonitoringRules';
const BATCH_CREATE_MONITORING_RULES_PATH      = '/CloudAtlas.CloudAtlas/BatchCreateMonitoringRules';
const LIST_GITHUB_LEAKS_PATH                  = '/CloudAtlas.CloudAtlas/ListGithubLeaks';
const LIST_DISK_LEAKS_PATH                    = '/CloudAtlas.CloudAtlas/ListDiskLeaks';
const LIST_DOC_LEAKS_PATH                     = '/CloudAtlas.CloudAtlas/ListDocLeaks';
const LIST_DARKNET_INTEL_PATH                 = '/CloudAtlas.CloudAtlas/ListDarknetIntel';
const LIST_STOLEN_DATA_PATH                   = '/CloudAtlas.CloudAtlas/ListStolenData';
const LIST_EMAIL_LEAKS_PATH                   = '/CloudAtlas.CloudAtlas/ListEmailLeaks';
const LIST_MOBILE_APPS_PATH                   = '/CloudAtlas.CloudAtlas/ListMobileApps';
const LIST_SOCIAL_MEDIA_PATH                  = '/CloudAtlas.CloudAtlas/ListSocialMedia';
const LIST_TASK_SCHEDULES_PATH                = '/CloudAtlas.CloudAtlas/ListTaskSchedules';
const CREATE_TASK_SCHEDULE_PATH               = '/CloudAtlas.CloudAtlas/CreateTaskSchedule';
const LIST_TASK_INSTANCES_PATH                = '/CloudAtlas.CloudAtlas/ListTaskInstances';
const CREATE_TASK_INSTANCE_PATH               = '/CloudAtlas.CloudAtlas/CreateTaskInstance';
const LIST_SPACES_PATH                        = '/CloudAtlas.CloudAtlas/ListSpaces';
const LIST_TAGS_PATH                          = '/CloudAtlas.CloudAtlas/ListTags';
const LIST_BUSINESS_UNITS_PATH                = '/CloudAtlas.CloudAtlas/ListBusinessUnits';

const originalFetch = globalThis.fetch;
const originalConsoleLog = console.log;

const buildCtx = (overrides = {}) => ({
  bindings: {
    baseUrl: 'https://cloudatlas.example.com',
    token: 'test-token',
    ...(overrides.bindings || {}),
  },
  config: overrides.config || {},
  secret: overrides.secret || {},
  limits: { timeoutMs: 15_000, ...(overrides.limits || {}) },
  meta: { instance_id: 'inst', request_id: 'req', ...(overrides.meta || {}) },
  req: overrides.req || {},
});

const okResponse = (body, headers = {}) => ({
  ok: true,
  status: 200,
  headers: { get: (key) => headers[key.toLowerCase()] },
  text: async () => body,
});

const responseWithStatus = (status, body, headers = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: (key) => headers[key.toLowerCase()] },
  text: async () => body,
});

const successListBody = (items, total) =>
  JSON.stringify({ code: 200, data: { items, total } });

const successMutationBody = (affectedCount, message = '') =>
  JSON.stringify({ affected_count: affectedCount, message });

test.afterEach(() => {
  globalThis.fetch = originalFetch;
  console.log = originalConsoleLog;
});

// ── _test helper unit tests ─────────────────────────────────────────────

test('_test helpers: buildQuery', () => {
  assert.equal(_test.buildQuery({}), '');
  assert.equal(_test.buildQuery({ space: 1 }), '?space=1');
  assert.equal(_test.buildQuery({ space: 1, name: 'test' }), '?space=1&name=test');
  assert.equal(_test.buildQuery({ space: undefined, name: 'foo' }), '?name=foo');
  assert.equal(_test.buildQuery({ space: null, name: '' }), '');
  assert.equal(_test.buildQuery({ name: 'a&b' }), '?name=a%26b');
});

test('_test helpers: errorWithCode and grpcCodeFor', () => {
  const err = _test.errorWithCode('INVALID_ARGUMENT', 'msg');
  assert.ok(err instanceof GrpcError);
  assert.equal(err.code, grpcStatus.INVALID_ARGUMENT);
  assert.equal(err.legacyCode, 'INVALID_ARGUMENT');
  assert.match(err.message, /INVALID_ARGUMENT: msg/);

  assert.equal(_test.grpcCodeFor('INVALID_ARGUMENT'), grpcStatus.INVALID_ARGUMENT);
  assert.equal(_test.grpcCodeFor('FAILED_PRECONDITION'), grpcStatus.FAILED_PRECONDITION);
  assert.equal(_test.grpcCodeFor('PERMISSION_DENIED'), grpcStatus.PERMISSION_DENIED);
  assert.equal(_test.grpcCodeFor('UNAVAILABLE'), grpcStatus.UNAVAILABLE);
  assert.equal(_test.grpcCodeFor('DEADLINE_EXCEEDED'), grpcStatus.DEADLINE_EXCEEDED);
  assert.equal(_test.grpcCodeFor('UNKNOWN'), grpcStatus.UNKNOWN);
  assert.equal(_test.grpcCodeFor('OTHER'), grpcStatus.UNKNOWN);
});

test('_test helpers: mergedBindings', () => {
  assert.deepEqual(_test.mergedBindings(), {});
  assert.deepEqual(_test.mergedBindings({ config: { baseUrl: 'b' }, secret: { token: 't' } }), { baseUrl: 'b', token: 't' });
  assert.deepEqual(_test.mergedBindings({ config: { a: 1 }, bindings: { a: 2 } }), { a: 2 });
});

test('_test helpers: normalizeBaseUrl', () => {
  assert.equal(_test.normalizeBaseUrl('https://example.com'), 'https://example.com');
  assert.equal(_test.normalizeBaseUrl('https://example.com/'), 'https://example.com');
  assert.equal(_test.normalizeBaseUrl('http://example.com'), 'http://example.com');
  assert.equal(_test.normalizeBaseUrl('ftp://example.com'), null);
  assert.equal(_test.normalizeBaseUrl(''), null);
  assert.equal(_test.normalizeBaseUrl(null), null);
});

test('_test helpers: normalizeListResponse', () => {
  assert.deepEqual(_test.normalizeListResponse({ code: 200, data: { items: [1, 2], total: 2 } }), [1, 2]);
  assert.deepEqual(_test.normalizeListResponse({ data: { results: [3] } }), [3]);
  assert.deepEqual(_test.normalizeListResponse({ items: [4] }), [4]);
  assert.deepEqual(_test.normalizeListResponse([5, 6]), [5, 6]);
  assert.deepEqual(_test.normalizeListResponse(null), []);
  assert.deepEqual(_test.normalizeListResponse({}), []);
});

test('_test helpers: getTotal', () => {
  assert.equal(_test.getTotal({ code: 200, data: { items: [], total: 5 } }), 5);
  assert.equal(_test.getTotal({ data: { count: 3 } }), 3);
  assert.equal(_test.getTotal({ total: 7 }), 7);
  assert.equal(_test.getTotal({ count: 9 }), 9);
  assert.equal(_test.getTotal({}), 0);
  assert.equal(_test.getTotal(null), 0);
});

test('_test helpers: parseHeaders', () => {
  assert.deepEqual(_test.parseHeaders(undefined), {});
  assert.deepEqual(_test.parseHeaders(null), {});
  assert.deepEqual(_test.parseHeaders(''), {});
  assert.deepEqual(_test.parseHeaders({ 'X-Custom': 'val' }), { 'X-Custom': 'val' });
  assert.deepEqual(_test.parseHeaders('{"X-Custom":"val"}'), { 'X-Custom': 'val' });
  assert.deepEqual(_test.parseHeaders('invalid json'), {});
  assert.deepEqual(_test.parseHeaders([1, 2]), {});
});

test('_test helpers: toBooleanStrict', () => {
  assert.equal(_test.toBooleanStrict(true), true);
  assert.equal(_test.toBooleanStrict(false), false);
  assert.equal(_test.toBooleanStrict(undefined), false);
  assert.equal(_test.toBooleanStrict(null), false);
  assert.equal(_test.toBooleanStrict('true'), true);
  assert.equal(_test.toBooleanStrict('false'), false);
  assert.equal(_test.toBooleanStrict('1'), true);
  assert.equal(_test.toBooleanStrict('0'), false);
  assert.equal(_test.toBooleanStrict(1), true);
  assert.equal(_test.toBooleanStrict(0), false);
});

test('_test helpers: toBooleanOrNull', () => {
  assert.equal(_test.toBooleanOrNull(true), true);
  assert.equal(_test.toBooleanOrNull(false), false);
  assert.equal(_test.toBooleanOrNull('true'), true);
  assert.equal(_test.toBooleanOrNull('false'), false);
  assert.equal(_test.toBooleanOrNull({ value: true }), true);
  assert.equal(_test.toBooleanOrNull(1), true);
  assert.equal(_test.toBooleanOrNull(0), false);
  assert.equal(_test.toBooleanOrNull('other'), null);
});

test('_test helpers: toQueryNumber', () => {
  assert.equal(_test.toQueryNumber(undefined), undefined);
  assert.equal(_test.toQueryNumber(null), undefined);
  assert.equal(_test.toQueryNumber(5), 5);
  assert.equal(_test.toQueryNumber(0, true), 0);
  assert.equal(_test.toQueryNumber(0), undefined);
  assert.equal(_test.toQueryNumber(-1, true), undefined);
  assert.equal(_test.toQueryNumber(1.5), undefined);
  assert.equal(_test.toQueryNumber({ value: 3 }), 3);
  assert.equal(_test.toQueryNumber('10'), 10);
});

test('_test helpers: unwrapString', () => {
  assert.equal(_test.unwrapString(undefined), '');
  assert.equal(_test.unwrapString(null), '');
  assert.equal(_test.unwrapString('hello'), 'hello');
  assert.equal(_test.unwrapString({ value: 'wrapped' }), 'wrapped');
  assert.equal(_test.unwrapString(123), '123');
  assert.equal(_test.unwrapString({ value: null }), '');
  assert.equal(_test.unwrapString({ value: 0 }), '0');
});

test('_test helpers: unwrapList', () => {
  assert.equal(_test.unwrapList(undefined), undefined);
  assert.equal(_test.unwrapList(null), undefined);
  assert.deepEqual(_test.unwrapList([1, 2]), [1, 2]);
  assert.deepEqual(_test.unwrapList({ values: [3, 4] }), [3, 4]);
  assert.equal(_test.unwrapList('scalar'), 'scalar');
});

test('_test helpers: resolveCallContext', () => {
  const baseCtx = { bindings: { baseUrl: 'b' }, secret: { token: 't' } };

  const r1 = _test.resolveCallContext(baseCtx, { request: { name: 'n' } });
  assert.deepEqual(r1.req, { name: 'n' });

  const r2 = _test.resolveCallContext(baseCtx, { req: { name: 'm' } });
  assert.deepEqual(r2.req, { name: 'm' });

  const r3 = _test.resolveCallContext(baseCtx, { name: 'x' }, { bindings: { extra: 'e' } });
  assert.deepEqual(r3.req, { name: 'x' });
  assert.equal(r3.ctx.bindings.extra, 'e');
});

// ── Validation tests ────────────────────────────────────────────────────

test('handlers reject missing token', async () => {
  await assert.rejects(
    () => rpcdef(buildCtx({ bindings: { token: '' } }))[LIST_ENTERPRISE_SUBJECTS_PATH](),
    (err) => {
      assert.ok(err instanceof GrpcError);
      assert.equal(err.code, grpcStatus.INVALID_ARGUMENT);
      assert.equal(err.legacyCode, 'INVALID_ARGUMENT');
      assert.match(err.message, /token is required/);
      return true;
    },
  );
});

test('handlers reject missing baseUrl', async () => {
  await assert.rejects(
    () => rpcdef(buildCtx({ bindings: { baseUrl: '' } }))[LIST_ENTERPRISE_SUBJECTS_PATH](),
    (err) => {
      assert.ok(err instanceof GrpcError);
      assert.equal(err.code, grpcStatus.INVALID_ARGUMENT);
      assert.match(err.message, /baseUrl is required/);
      return true;
    },
  );
});

test('handlers reject invalid baseUrl (not http/https)', async () => {
  await assert.rejects(
    () => rpcdef(buildCtx({ bindings: { baseUrl: 'ftp://bad' } }))[LIST_ENTERPRISE_SUBJECTS_PATH](),
    /baseUrl is required/,
  );
});

test('BatchCreateEnterpriseSubjects rejects missing entries', async () => {
  await assert.rejects(
    () => rpcdef(buildCtx({ req: {} }))[BATCH_CREATE_ENTERPRISE_SUBJECTS_PATH](),
    /entries must be a non-empty array/,
  );
  await assert.rejects(
    () => rpcdef(buildCtx({ req: { entries: [] } }))[BATCH_CREATE_ENTERPRISE_SUBJECTS_PATH](),
    /entries must be a non-empty array/,
  );
});

test('BatchDeleteEnterpriseSubjects rejects missing ids', async () => {
  await assert.rejects(
    () => rpcdef(buildCtx({ req: {} }))[BATCH_DELETE_ENTERPRISE_SUBJECTS_PATH](),
    /ids must be a non-empty array/,
  );
});

test('BatchUpdateSeeds rejects missing resource_type', async () => {
  await assert.rejects(
    () => rpcdef(buildCtx({ req: { ids: [1], update_type: 'switch', enable: true } }))[BATCH_UPDATE_SEEDS_PATH](),
    /resource_type is required/,
  );
});

test('BatchUpdateSeeds rejects invalid resource_type', async () => {
  await assert.rejects(
    () => rpcdef(buildCtx({ req: { resource_type: 'invalid', ids: [1], update_type: 'switch', enable: true } }))[BATCH_UPDATE_SEEDS_PATH](),
    /resource_type must be one of/,
  );
});

test('BatchUpdateSeeds normalizes email_domain and web_title', async () => {
  let captured;
  globalThis.fetch = async (url, init) => {
    captured = { url, init };
    return okResponse(successMutationBody(1));
  };

  await rpcdef(buildCtx({ req: { resource_type: 'email_domain', ids: [1], update_type: 'switch', enable: true } }))[BATCH_UPDATE_SEEDS_PATH]();
  assert.match(captured.url, /seed\/email-domain\/switch/);

  await rpcdef(buildCtx({ req: { resource_type: 'web_title', ids: [1], update_type: 'switch', enable: true } }))[BATCH_UPDATE_SEEDS_PATH]();
  assert.match(captured.url, /seed\/web-title\/switch/);
});

test('BatchUpdateSeeds rejects missing ids', async () => {
  await assert.rejects(
    () => rpcdef(buildCtx({ req: { resource_type: 'enterprise', update_type: 'switch', enable: true } }))[BATCH_UPDATE_SEEDS_PATH](),
    /ids must be a non-empty array/,
  );
});

test('BatchUpdateSeeds rejects missing update_type', async () => {
  await assert.rejects(
    () => rpcdef(buildCtx({ req: { resource_type: 'enterprise', ids: [1] } }))[BATCH_UPDATE_SEEDS_PATH](),
    /update_type is required/,
  );
});

test('BatchUpdateSeeds:switch rejects missing enable', async () => {
  await assert.rejects(
    () => rpcdef(buildCtx({ req: { resource_type: 'enterprise', ids: [1], update_type: 'switch' } }))[BATCH_UPDATE_SEEDS_PATH](),
    /enable is required for switch/,
  );
});

test('BatchUpdateSeeds:confidence rejects missing confidence', async () => {
  await assert.rejects(
    () => rpcdef(buildCtx({ req: { resource_type: 'enterprise', ids: [1], update_type: 'confidence' } }))[BATCH_UPDATE_SEEDS_PATH](),
    /confidence is required for confidence/,
  );
});

test('BatchUpdateSeeds rejects invalid update_type', async () => {
  await assert.rejects(
    () => rpcdef(buildCtx({ req: { resource_type: 'enterprise', ids: [1], update_type: 'unknown' } }))[BATCH_UPDATE_SEEDS_PATH](),
    /update_type must be "switch" or "confidence"/,
  );
});

test('BatchUpdateAssetStatus rejects missing resource_type', async () => {
  await assert.rejects(
    () => rpcdef(buildCtx({ req: { ids: [1], status: 'active' } }))[BATCH_UPDATE_ASSET_STATUS_PATH](),
    /resource_type is required/,
  );
});

test('BatchUpdateAssetStatus rejects invalid resource_type', async () => {
  await assert.rejects(
    () => rpcdef(buildCtx({ req: { resource_type: 'invalid', ids: [1], status: 'active' } }))[BATCH_UPDATE_ASSET_STATUS_PATH](),
    /resource_type must be one of/,
  );
});

test('BatchUpdateAssetStatus normalizes root_domain to root-domain', async () => {
  let captured;
  globalThis.fetch = async (url, init) => {
    captured = { url, init };
    return okResponse(successMutationBody(1));
  };

  await rpcdef(buildCtx({ req: { resource_type: 'root_domain', ids: [1], status: 'active' } }))[BATCH_UPDATE_ASSET_STATUS_PATH]();
  assert.match(captured.url, /asset\/root-domain\/status/);
});

test('BatchUpdateAssetStatus rejects missing ids', async () => {
  await assert.rejects(
    () => rpcdef(buildCtx({ req: { resource_type: 'ip', status: 'active' } }))[BATCH_UPDATE_ASSET_STATUS_PATH](),
    /ids must be a non-empty array/,
  );
});

test('BatchUpdateAssetStatus rejects missing status', async () => {
  await assert.rejects(
    () => rpcdef(buildCtx({ req: { resource_type: 'ip', ids: [1] } }))[BATCH_UPDATE_ASSET_STATUS_PATH](),
    /status is required/,
  );
});

test('BatchDeleteAssets rejects missing resource_type', async () => {
  await assert.rejects(
    () => rpcdef(buildCtx({ req: { ids: [1] } }))[BATCH_DELETE_ASSETS_PATH](),
    /resource_type is required/,
  );
});

test('BatchDeleteAssets rejects invalid resource_type', async () => {
  await assert.rejects(
    () => rpcdef(buildCtx({ req: { resource_type: 'cert', ids: [1] } }))[BATCH_DELETE_ASSETS_PATH](),
    /resource_type must be one of/,
  );
});

test('BatchDeleteAssets rejects missing ids', async () => {
  await assert.rejects(
    () => rpcdef(buildCtx({ req: { resource_type: 'ip' } }))[BATCH_DELETE_ASSETS_PATH](),
    /ids must be a non-empty array/,
  );
});

test('GetHighRiskAppFingers rejects missing pk', async () => {
  await assert.rejects(
    () => rpcdef(buildCtx({ req: {} }))[GET_HIGH_RISK_APP_FINGERS_PATH](),
    /pk is required/,
  );
});

test('GetHighRiskAppFingers rejects non-integer pk', async () => {
  await assert.rejects(
    () => rpcdef(buildCtx({ req: { pk: 'abc' } }))[GET_HIGH_RISK_APP_FINGERS_PATH](),
    /pk must be an integer/,
  );
});

test('BatchUpdateVulnStatus rejects missing ids', async () => {
  await assert.rejects(
    () => rpcdef(buildCtx({ req: {} }))[BATCH_UPDATE_VULN_STATUS_PATH](),
    /ids must be a non-empty array/,
  );
});

test('BatchUpdateVulnStatus rejects missing update_type', async () => {
  await assert.rejects(
    () => rpcdef(buildCtx({ req: { ids: [1] } }))[BATCH_UPDATE_VULN_STATUS_PATH](),
    /update_type is required/,
  );
});

test('BatchUpdateVulnStatus:status rejects missing status', async () => {
  await assert.rejects(
    () => rpcdef(buildCtx({ req: { ids: [1], update_type: 'status' } }))[BATCH_UPDATE_VULN_STATUS_PATH](),
    /status is required for status update/,
  );
});

test('BatchUpdateVulnStatus rejects invalid update_type', async () => {
  await assert.rejects(
    () => rpcdef(buildCtx({ req: { ids: [1], update_type: 'invalid' } }))[BATCH_UPDATE_VULN_STATUS_PATH](),
    /update_type must be "status" or "recheck"/,
  );
});

// ── Request forwarding tests ────────────────────────────────────────────

test('ListEnterpriseSubjects sends GET with correct URL and query', async () => {
  let captured;
  globalThis.fetch = async (url, init) => {
    captured = { url, init };
    return okResponse(successListBody([{ id: 1 }], 1));
  };

  const result = await rpcdef(buildCtx({ req: { space: 5, name: 'test', page: 1, size: 20 } }))[LIST_ENTERPRISE_SUBJECTS_PATH]();
  assert.equal(captured.init.method, 'GET');
  assert.match(captured.url, /openapi\/v1\/seed\/enterprise/);
  assert.match(captured.url, /space=5/);
  assert.match(captured.url, /name=test/);
  assert.match(captured.url, /page=1/);
  assert.match(captured.url, /size=20/);
  assert.equal(captured.init.headers.TOKEN, 'test-token');
  assert.equal(captured.init.headers['x-engine-instance'], 'inst');
  assert.equal(captured.init.headers['x-request-id'], 'req');
  assert.deepEqual(result.items, [{ id: 1 }]);
  assert.equal(result.total, 1);
});

test('ListEnterpriseSubjects omits empty/undefined query params', async () => {
  let captured;
  globalThis.fetch = async (url, init) => {
    captured = { url, init };
    return okResponse(successListBody([], 0));
  };

  await rpcdef(buildCtx({ req: {} }))[LIST_ENTERPRISE_SUBJECTS_PATH]();
  assert.doesNotMatch(captured.url, /name=/);
  assert.doesNotMatch(captured.url, /page=/);
});

test('BatchCreateEnterpriseSubjects sends POST with body', async () => {
  let captured;
  globalThis.fetch = async (url, init) => {
    captured = { url, init };
    return okResponse(successMutationBody(3));
  };

  const result = await rpcdef(buildCtx({ req: { entries: [{ name: 'a' }, { name: 'b' }], space: 1 } }))[BATCH_CREATE_ENTERPRISE_SUBJECTS_PATH]();
  assert.equal(captured.init.method, 'POST');
  assert.match(captured.url, /seed\/enterprise\/batch-create/);
  assert.equal(captured.init.headers['content-type'], 'application/json');
  const body = JSON.parse(captured.init.body);
  assert.deepEqual(body.entries, [{ name: 'a' }, { name: 'b' }]);
  assert.equal(body.space, 1);
  assert.equal(result.affected_count, 3);
  assert.equal(result.message, '');
});

test('BatchDeleteEnterpriseSubjects sends DELETE with body', async () => {
  let captured;
  globalThis.fetch = async (url, init) => {
    captured = { url, init };
    return okResponse(successMutationBody(2));
  };

  const result = await rpcdef(buildCtx({ req: { ids: [1, 2] } }))[BATCH_DELETE_ENTERPRISE_SUBJECTS_PATH]();
  assert.equal(captured.init.method, 'DELETE');
  assert.match(captured.url, /seed\/enterprise\/batch-delete/);
  assert.equal(captured.init.headers['content-type'], 'application/json');
  const body = JSON.parse(captured.init.body);
  assert.deepEqual(body.ids, [1, 2]);
  assert.equal(result.affected_count, 2);
});

test('ListKeywords sends GET to /seed/keyword', async () => {
  let captured;
  globalThis.fetch = async (url, init) => {
    captured = { url, init };
    return okResponse(successListBody([], 0));
  };

  await rpcdef(buildCtx({ req: { space: 1, type: 'domain' } }))[LIST_KEYWORDS_PATH]();
  assert.match(captured.url, /openapi\/v1\/seed\/keyword/);
  assert.match(captured.url, /type=domain/);
});

test('ListSeedDomains sends GET to /seed/domain', async () => {
  let captured;
  globalThis.fetch = async (url, init) => {
    captured = { url, init };
    return okResponse(successListBody([], 0));
  };

  await rpcdef(buildCtx({ req: { space: 1 } }))[LIST_SEED_DOMAINS_PATH]();
  assert.match(captured.url, /openapi\/v1\/seed\/domain/);
});

test('BatchCreateSeedDomains sends POST to /seed/domain/batch-create', async () => {
  let captured;
  globalThis.fetch = async (url, init) => {
    captured = { url, init };
    return okResponse(successMutationBody(1));
  };

  await rpcdef(buildCtx({ req: { entries: [{ name: 'd' }] } }))[BATCH_CREATE_SEED_DOMAINS_PATH]();
  assert.equal(captured.init.method, 'POST');
  assert.match(captured.url, /seed\/domain\/batch-create/);
});

test('ListSeedCerts sends GET to /seed/cert', async () => {
  let captured;
  globalThis.fetch = async (url, init) => {
    captured = { url, init };
    return okResponse(successListBody([], 0));
  };

  await rpcdef(buildCtx())[LIST_SEED_CERTS_PATH]();
  assert.match(captured.url, /openapi\/v1\/seed\/cert/);
});

test('ListSeedIcons sends GET to /seed/icon', async () => {
  let captured;
  globalThis.fetch = async (url, init) => {
    captured = { url, init };
    return okResponse(successListBody([], 0));
  };

  await rpcdef(buildCtx())[LIST_SEED_ICONS_PATH]();
  assert.match(captured.url, /openapi\/v1\/seed\/icon/);
});

test('ListSeedWebTitles sends GET to /seed/web-title', async () => {
  let captured;
  globalThis.fetch = async (url, init) => {
    captured = { url, init };
    return okResponse(successListBody([], 0));
  };

  await rpcdef(buildCtx())[LIST_SEED_WEB_TITLES_PATH]();
  assert.match(captured.url, /openapi\/v1\/seed\/web-title/);
});

test('BatchUpdateSeeds:switch sends POST to /seed/{type}/switch', async () => {
  let captured;
  globalThis.fetch = async (url, init) => {
    captured = { url, init };
    return okResponse(successMutationBody(5));
  };

  const result = await rpcdef(buildCtx({ req: { resource_type: 'enterprise', ids: [1, 2], update_type: 'switch', enable: true, space: 1 } }))[BATCH_UPDATE_SEEDS_PATH]();
  assert.equal(captured.init.method, 'POST');
  assert.match(captured.url, /seed\/enterprise\/switch/);
  const body = JSON.parse(captured.init.body);
  assert.deepEqual(body.ids, [1, 2]);
  assert.equal(body.enable, true);
  assert.equal(body.space, 1);
  assert.equal(result.affected_count, 5);
});

test('BatchUpdateSeeds:confidence sends POST to /seed/{type}/update-confidence', async () => {
  let captured;
  globalThis.fetch = async (url, init) => {
    captured = { url, init };
    return okResponse(successMutationBody(3));
  };

  const result = await rpcdef(buildCtx({ req: { resource_type: 'keyword', ids: [1], update_type: 'confidence', confidence: 'high' } }))[BATCH_UPDATE_SEEDS_PATH]();
  assert.match(captured.url, /seed\/keyword\/update-confidence/);
  const body = JSON.parse(captured.init.body);
  assert.equal(body.confidence, 'high');
  assert.equal(result.affected_count, 3);
});

test('BatchUpdateSeeds also accepts update-confidence as update_type alias', async () => {
  let captured;
  globalThis.fetch = async (url, init) => {
    captured = { url, init };
    return okResponse(successMutationBody(1));
  };

  await rpcdef(buildCtx({ req: { resource_type: 'domain', ids: [1], update_type: 'update-confidence', confidence: 'medium' } }))[BATCH_UPDATE_SEEDS_PATH]();
  assert.match(captured.url, /seed\/domain\/update-confidence/);
});

test('ListRootDomains sends GET to /asset/root-domain', async () => {
  let captured;
  globalThis.fetch = async (url, init) => {
    captured = { url, init };
    return okResponse(successListBody([], 0));
  };

  await rpcdef(buildCtx())[LIST_ROOT_DOMAINS_PATH]();
  assert.match(captured.url, /openapi\/v1\/asset\/root-domain/);
});

test('ListSubdomains sends GET to /asset/subdomain with hostname', async () => {
  let captured;
  globalThis.fetch = async (url, init) => {
    captured = { url, init };
    return okResponse(successListBody([], 0));
  };

  await rpcdef(buildCtx({ req: { hostname: 'sub.example.com' } }))[LIST_SUBDOMAINS_PATH]();
  assert.match(captured.url, /asset\/subdomain/);
  assert.match(captured.url, /hostname=sub\.example\.com/);
});

test('ListDNS sends GET to /asset/dns with view_mode', async () => {
  let captured;
  globalThis.fetch = async (url, init) => {
    captured = { url, init };
    return okResponse(successListBody([], 0));
  };

  await rpcdef(buildCtx({ req: { view_mode: 'detail' } }))[LIST_DNS_PATH]();
  assert.match(captured.url, /asset\/dns/);
  assert.match(captured.url, /view_mode=detail/);
});

test('ListIPs sends GET to /asset/ip with ip and hostname', async () => {
  let captured;
  globalThis.fetch = async (url, init) => {
    captured = { url, init };
    return okResponse(successListBody([], 0));
  };

  await rpcdef(buildCtx({ req: { ip: '1.2.3.4', hostname: 'h' } }))[LIST_IPS_PATH]();
  assert.match(captured.url, /asset\/ip/);
  assert.match(captured.url, /ip=1\.2\.3\.4/);
  assert.match(captured.url, /hostname=h/);
});

test('ListPorts sends GET to /attack/port with ip, port, hostname', async () => {
  let captured;
  globalThis.fetch = async (url, init) => {
    captured = { url, init };
    return okResponse(successListBody([], 0));
  };

  await rpcdef(buildCtx({ req: { ip: '1.2.3.4', port: 80, hostname: 'h' } }))[LIST_PORTS_PATH]();
  assert.match(captured.url, /attack\/port/);
  assert.match(captured.url, /port=80/);
});

test('ListOpenPorts sends GET to /attack/openport', async () => {
  let captured;
  globalThis.fetch = async (url, init) => {
    captured = { url, init };
    return okResponse(successListBody([], 0));
  };

  await rpcdef(buildCtx())[LIST_OPEN_PORTS_PATH]();
  assert.match(captured.url, /attack\/openport/);
});

test('ListWebEntities sends GET to /attack/web with url param', async () => {
  let captured;
  globalThis.fetch = async (url, init) => {
    captured = { url, init };
    return okResponse(successListBody([], 0));
  };

  await rpcdef(buildCtx({ req: { url: 'http://example.com' } }))[LIST_WEB_ENTITIES_PATH]();
  assert.match(captured.url, /attack\/web/);
  assert.match(captured.url, /url=http/);
});

test('ListWebPaths sends GET to /attack/dir', async () => {
  let captured;
  globalThis.fetch = async (url, init) => {
    captured = { url, init };
    return okResponse(successListBody([], 0));
  };

  await rpcdef(buildCtx())[LIST_WEB_PATHS_PATH]();
  assert.match(captured.url, /attack\/dir/);
});

test('ListWebFingerprints sends GET to /attack/appfinger', async () => {
  let captured;
  globalThis.fetch = async (url, init) => {
    captured = { url, init };
    return okResponse(successListBody([], 0));
  };

  await rpcdef(buildCtx())[LIST_WEB_FINGERPRINTS_PATH]();
  assert.match(captured.url, /attack\/appfinger/);
});

test('ListCrawlerData sends GET to /attack/crawler', async () => {
  let captured;
  globalThis.fetch = async (url, init) => {
    captured = { url, init };
    return okResponse(successListBody([], 0));
  };

  await rpcdef(buildCtx())[LIST_CRAWLER_DATA_PATH]();
  assert.match(captured.url, /attack\/crawler/);
});

test('ListVulnerabilities sends GET to /risk/high-risk', async () => {
  let captured;
  globalThis.fetch = async (url, init) => {
    captured = { url, init };
    return okResponse(successListBody([], 0));
  };

  await rpcdef(buildCtx())[LIST_VULNERABILITIES_PATH]();
  assert.match(captured.url, /risk\/high-risk/);
});

test('BatchUpdateVulnStatus:status sends POST to /risk/high-risk/status', async () => {
  let captured;
  globalThis.fetch = async (url, init) => {
    captured = { url, init };
    return okResponse(successMutationBody(2));
  };

  const result = await rpcdef(buildCtx({ req: { ids: [1, 2], update_type: 'status', status: 'confirmed' } }))[BATCH_UPDATE_VULN_STATUS_PATH]();
  assert.equal(captured.init.method, 'POST');
  assert.match(captured.url, /risk\/high-risk\/status/);
  const body = JSON.parse(captured.init.body);
  assert.deepEqual(body.ids, [1, 2]);
  assert.equal(body.status, 'confirmed');
  assert.equal(result.affected_count, 2);
});

test('BatchUpdateVulnStatus:recheck sends POST to /risk/high-risk/recheck', async () => {
  let captured;
  globalThis.fetch = async (url, init) => {
    captured = { url, init };
    return okResponse(successMutationBody(1));
  };

  const result = await rpcdef(buildCtx({ req: { ids: [1], update_type: 'recheck' } }))[BATCH_UPDATE_VULN_STATUS_PATH]();
  assert.match(captured.url, /risk\/high-risk\/recheck/);
  const body = JSON.parse(captured.init.body);
  assert.deepEqual(body.ids, [1]);
  assert.equal(result.affected_count, 1);
});

test('GetHighRiskAppFingers sends GET to /risk/product/{pk}/finger', async () => {
  let captured;
  globalThis.fetch = async (url, init) => {
    captured = { url, init };
    return okResponse(JSON.stringify({ id: 5, name: 'app' }));
  };

  const result = await rpcdef(buildCtx({ req: { pk: 5 } }))[GET_HIGH_RISK_APP_FINGERS_PATH]();
  assert.match(captured.url, /risk\/product\/5\/finger/);
  assert.ok(Array.isArray(result.items));
  assert.equal(result.total, result.items.length);
});

test('ListHighRiskApps sends GET to /risk/product', async () => {
  let captured;
  globalThis.fetch = async (url, init) => {
    captured = { url, init };
    return okResponse(successListBody([], 0));
  };

  await rpcdef(buildCtx())[LIST_HIGH_RISK_APPS_PATH]();
  assert.match(captured.url, /risk\/product/);
});

test('ListHighRiskServices sends GET to /risk/service', async () => {
  let captured;
  globalThis.fetch = async (url, init) => {
    captured = { url, init };
    return okResponse(successListBody([], 0));
  };

  await rpcdef(buildCtx())[LIST_HIGH_RISK_SERVICES_PATH]();
  assert.match(captured.url, /risk\/service/);
});

test('ListProducts with pk sends GET to /kb/product/{pk}', async () => {
  let captured;
  globalThis.fetch = async (url, init) => {
    captured = { url, init };
    return okResponse(JSON.stringify({ id: 10, name: 'prod' }));
  };

  const result = await rpcdef(buildCtx({ req: { pk: 10 } }))[LIST_PRODUCTS_PATH]();
  assert.match(captured.url, /kb\/product\/10/);
  assert.ok(Array.isArray(result.items));
  assert.equal(result.total, 1);
});

test('ListProducts without pk sends GET to /kb/product', async () => {
  let captured;
  globalThis.fetch = async (url, init) => {
    captured = { url, init };
    return okResponse(successListBody([], 0));
  };

  await rpcdef(buildCtx())[LIST_PRODUCTS_PATH]();
  assert.match(captured.url, /kb\/product/);
  assert.doesNotMatch(captured.url, /kb\/product\/\d+/);
});

test('ListProducts rejects non-integer pk', async () => {
  await assert.rejects(
    () => rpcdef(buildCtx({ req: { pk: 'abc' } }))[LIST_PRODUCTS_PATH](),
    /pk must be an integer/,
  );
});

test('ListKBVulns with pk sends GET to /kb/vuln/{pk}/product', async () => {
  let captured;
  globalThis.fetch = async (url, init) => {
    captured = { url, init };
    return okResponse(successListBody([], 0));
  };

  await rpcdef(buildCtx({ req: { pk: 7 } }))[LIST_KB_VULNS_PATH]();
  assert.match(captured.url, /kb\/vuln\/7\/product/);
});

test('ListKBVulns without pk sends GET to /kb/vuln', async () => {
  let captured;
  globalThis.fetch = async (url, init) => {
    captured = { url, init };
    return okResponse(successListBody([], 0));
  };

  await rpcdef(buildCtx())[LIST_KB_VULNS_PATH]();
  assert.match(captured.url, /kb\/vuln/);
  assert.doesNotMatch(captured.url, /kb\/vuln\/\d+/);
});

test('ListMonitoringRules with pk sends GET to /drps/rule/{pk}', async () => {
  let captured;
  globalThis.fetch = async (url, init) => {
    captured = { url, init };
    return okResponse(JSON.stringify({ id: 3 }));
  };

  const result = await rpcdef(buildCtx({ req: { pk: 3 } }))[LIST_MONITORING_RULES_PATH]();
  assert.match(captured.url, /drps\/rule\/3/);
  assert.ok(Array.isArray(result.items));
});

test('ListMonitoringRules without pk sends GET to /drps/rule', async () => {
  let captured;
  globalThis.fetch = async (url, init) => {
    captured = { url, init };
    return okResponse(successListBody([], 0));
  };

  await rpcdef(buildCtx())[LIST_MONITORING_RULES_PATH]();
  assert.match(captured.url, /drps\/rule/);
  assert.doesNotMatch(captured.url, /drps\/rule\/\d+/);
});

test('BatchCreateMonitoringRules sends POST to /drps/rule/batch-create', async () => {
  let captured;
  globalThis.fetch = async (url, init) => {
    captured = { url, init };
    return okResponse(successMutationBody(2));
  };

  await rpcdef(buildCtx({ req: { entries: [{ name: 'r1' }] } }))[BATCH_CREATE_MONITORING_RULES_PATH]();
  assert.match(captured.url, /drps\/rule\/batch-create/);
});

test('DRPS list handlers send GET to correct endpoints', async () => {
  const drpsPaths = [
    [LIST_GITHUB_LEAKS_PATH, 'drps/github'],
    [LIST_DISK_LEAKS_PATH, 'drps/disk'],
    [LIST_DOC_LEAKS_PATH, 'drps/doc'],
    [LIST_DARKNET_INTEL_PATH, 'drps/darknet'],
    [LIST_STOLEN_DATA_PATH, 'drps/stealer-log'],
    [LIST_EMAIL_LEAKS_PATH, 'drps/email'],
    [LIST_MOBILE_APPS_PATH, 'drps/app'],
    [LIST_SOCIAL_MEDIA_PATH, 'drps/media'],
  ];

  for (const [path, expectedSegment] of drpsPaths) {
    let captured;
    globalThis.fetch = async (url, init) => {
      captured = { url, init };
      return okResponse(successListBody([], 0));
    };

    await rpcdef(buildCtx())[path]();
    assert.match(captured.url, new RegExp(`openapi/v1/${expectedSegment}`));
  }
});

test('ListTaskSchedules with pk sends GET to /task/schedule/{pk}', async () => {
  let captured;
  globalThis.fetch = async (url, init) => {
    captured = { url, init };
    return okResponse(JSON.stringify({ id: 2 }));
  };

  const result = await rpcdef(buildCtx({ req: { pk: 2 } }))[LIST_TASK_SCHEDULES_PATH]();
  assert.match(captured.url, /task\/schedule\/2/);
  assert.ok(Array.isArray(result.items));
});

test('ListTaskSchedules without pk sends GET to /task/schedule with task_type', async () => {
  let captured;
  globalThis.fetch = async (url, init) => {
    captured = { url, init };
    return okResponse(successListBody([], 0));
  };

  await rpcdef(buildCtx({ req: { task_type: 'scan' } }))[LIST_TASK_SCHEDULES_PATH]();
  assert.match(captured.url, /task\/schedule/);
  assert.match(captured.url, /task_type=scan/);
});

test('CreateTaskSchedule sends POST to /task/schedule with body', async () => {
  let captured;
  globalThis.fetch = async (url, init) => {
    captured = { url, init };
    return okResponse(JSON.stringify({ id: 42, message: 'ok' }));
  };

  const result = await rpcdef(buildCtx({ req: { name: 'test-schedule', task_type: 'scan', config: { cron: '0 0 * * *' }, space: 1 } }))[CREATE_TASK_SCHEDULE_PATH]();
  assert.equal(captured.init.method, 'POST');
  assert.match(captured.url, /task\/schedule/);
  assert.doesNotMatch(captured.url, /batch-create/);
  assert.doesNotMatch(captured.url, /run-immediately/);
  const body = JSON.parse(captured.init.body);
  assert.equal(body.name, 'test-schedule');
  assert.equal(body.task_type, 'scan');
  assert.equal(body.cron, '0 0 * * *');
  assert.equal(body.space, 1);
  assert.equal(result.id, 42);
  assert.equal(result.message, 'ok');
});

test('CreateTaskSchedule with run_immediately triggers second POST', async () => {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    if (calls.length === 1) {
      return okResponse(JSON.stringify({ id: 10 }));
    }
    return okResponse(JSON.stringify({ code: 200 }));
  };

  const result = await rpcdef(buildCtx({ req: { name: 's', run_immediately: true } }))[CREATE_TASK_SCHEDULE_PATH]();
  assert.equal(result.id, 10);
  assert.equal(calls.length, 2);
  assert.match(calls[0].url, /task\/schedule/);
  assert.match(calls[1].url, /task\/schedule\/10\/run-immediately/);
});

test('CreateTaskSchedule: run_immediately failure is non-critical', async () => {
  let fetchCount = 0;
  console.log = () => {};

  globalThis.fetch = async (url, init) => {
    fetchCount++;
    if (fetchCount === 1) {
      return okResponse(JSON.stringify({ id: 5 }));
    }
    throw new Error('network error on run-immediately');
  };

  const result = await rpcdef(buildCtx({ req: { name: 's', run_immediately: true } }))[CREATE_TASK_SCHEDULE_PATH]();
  assert.equal(result.id, 5);
});

test('ListTaskInstances with pk sends GET to /task/session/{pk}', async () => {
  let captured;
  globalThis.fetch = async (url, init) => {
    captured = { url, init };
    return okResponse(JSON.stringify({ id: 3 }));
  };

  const result = await rpcdef(buildCtx({ req: { pk: 3 } }))[LIST_TASK_INSTANCES_PATH]();
  assert.match(captured.url, /task\/session\/3/);
  assert.ok(Array.isArray(result.items));
});

test('CreateTaskInstance sends POST to /task/session', async () => {
  let captured;
  globalThis.fetch = async (url, init) => {
    captured = { url, init };
    return okResponse(JSON.stringify({ id: 99 }));
  };

  const result = await rpcdef(buildCtx({ req: { task_type: 'scan', name: 'inst', extra: { key: 'val' } } }))[CREATE_TASK_INSTANCE_PATH]();
  assert.equal(captured.init.method, 'POST');
  assert.match(captured.url, /task\/session/);
  const body = JSON.parse(captured.init.body);
  assert.equal(body.task_type, 'scan');
  assert.equal(body.name, 'inst');
  assert.equal(body.key, 'val');
  assert.equal(result.id, 99);
});

test('ListSpaces with pk sends GET to /space/space/{pk}', async () => {
  let captured;
  globalThis.fetch = async (url, init) => {
    captured = { url, init };
    return okResponse(JSON.stringify({ id: 1 }));
  };

  const result = await rpcdef(buildCtx({ req: { pk: 1 } }))[LIST_SPACES_PATH]();
  assert.match(captured.url, /space\/space\/1/);
  assert.ok(Array.isArray(result.items));
  assert.equal(result.total, 1);
});

test('ListSpaces without pk does NOT include space query param', async () => {
  let captured;
  globalThis.fetch = async (url, init) => {
    captured = { url, init };
    return okResponse(successListBody([], 0));
  };

  await rpcdef(buildCtx({ bindings: { space: 5 } }))[LIST_SPACES_PATH]();
  assert.doesNotMatch(captured.url, /space=/);
});

test('ListTags with options sends GET to /space/tag/options', async () => {
  let captured;
  globalThis.fetch = async (url, init) => {
    captured = { url, init };
    return okResponse(successListBody([], 0));
  };

  await rpcdef(buildCtx({ req: { options: true } }))[LIST_TAGS_PATH]();
  assert.match(captured.url, /space\/tag\/options/);
});

test('ListTags without options sends GET to /space/tag', async () => {
  let captured;
  globalThis.fetch = async (url, init) => {
    captured = { url, init };
    return okResponse(successListBody([], 0));
  };

  await rpcdef(buildCtx())[LIST_TAGS_PATH]();
  assert.match(captured.url, /space\/tag/);
  assert.doesNotMatch(captured.url, /space\/tag\/options/);
});

test('ListBusinessUnits with options sends GET to /space/bu/options', async () => {
  let captured;
  globalThis.fetch = async (url, init) => {
    captured = { url, init };
    return okResponse(successListBody([], 0));
  };

  await rpcdef(buildCtx({ req: { fetch_options: true } }))[LIST_BUSINESS_UNITS_PATH]();
  assert.match(captured.url, /space\/bu\/options/);
});

test('ListBusinessUnits without options sends GET to /space/bu', async () => {
  let captured;
  globalThis.fetch = async (url, init) => {
    captured = { url, init };
    return okResponse(successListBody([], 0));
  };

  await rpcdef(buildCtx())[LIST_BUSINESS_UNITS_PATH]();
  assert.match(captured.url, /space\/bu/);
  assert.doesNotMatch(captured.url, /space\/bu\/options/);
});

// ── Response mapping tests ──────────────────────────────────────────────

test('list handler unwraps CloudAtlas {code, data} envelope', async () => {
  globalThis.fetch = async () => okResponse(JSON.stringify({
    code: 200,
    data: { items: [{ id: 1 }, { id: 2 }], total: 2 },
  }));

  const result = await rpcdef(buildCtx())[LIST_ENTERPRISE_SUBJECTS_PATH]();
  assert.deepEqual(result.items, [{ id: 1 }, { id: 2 }]);
  assert.equal(result.total, 2);
});

test('list handler handles {data: {results}} envelope', async () => {
  globalThis.fetch = async () => okResponse(JSON.stringify({
    data: { results: [{ id: 1 }], count: 1 },
  }));

  const result = await rpcdef(buildCtx())[LIST_ENTERPRISE_SUBJECTS_PATH]();
  assert.deepEqual(result.items, [{ id: 1 }]);
  assert.equal(result.total, 1);
});

test('list handler handles bare array response', async () => {
  globalThis.fetch = async () => okResponse(JSON.stringify([{ id: 1 }, { id: 2 }]));

  const result = await rpcdef(buildCtx())[LIST_ENTERPRISE_SUBJECTS_PATH]();
  assert.deepEqual(result.items, [{ id: 1 }, { id: 2 }]);
  assert.equal(result.total, 0);
});

test('list handler returns empty array for empty body', async () => {
  globalThis.fetch = async () => okResponse('');

  const result = await rpcdef(buildCtx())[LIST_ENTERPRISE_SUBJECTS_PATH]();
  assert.deepEqual(result.items, []);
  assert.equal(result.total, 0);
});

test('mutation handler returns affected_count and message', async () => {
  globalThis.fetch = async () => okResponse(JSON.stringify({
    affected_count: 5,
    message: 'success',
  }));

  const result = await rpcdef(buildCtx({ req: { entries: [{ name: 'a' }] } }))[BATCH_CREATE_ENTERPRISE_SUBJECTS_PATH]();
  assert.equal(result.affected_count, 5);
  assert.equal(result.message, 'success');
});

test('mutation handler falls back to count when affected_count missing', async () => {
  globalThis.fetch = async () => okResponse(JSON.stringify({
    count: 3,
  }));

  const result = await rpcdef(buildCtx({ req: { entries: [{ name: 'a' }] } }))[BATCH_CREATE_ENTERPRISE_SUBJECTS_PATH]();
  assert.equal(result.affected_count, 3);
  assert.equal(result.message, '');
});

test('CreateTaskSchedule returns id=0 for non-integer response id', async () => {
  globalThis.fetch = async () => okResponse(JSON.stringify({ id: 'not-a-number' }));

  const result = await rpcdef(buildCtx({ req: { name: 's' } }))[CREATE_TASK_SCHEDULE_PATH]();
  assert.equal(result.id, 0);
});

test('detail-by-pk handler wraps single object into array', async () => {
  globalThis.fetch = async () => okResponse(JSON.stringify({ id: 10, name: 'prod' }));

  const result = await rpcdef(buildCtx({ req: { pk: 10 } }))[LIST_PRODUCTS_PATH]();
  assert.ok(Array.isArray(result.items));
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].id, 10);
  assert.equal(result.total, 1);
});

test('detail-by-pk handler passes through array response', async () => {
  globalThis.fetch = async () => okResponse(JSON.stringify([{ id: 10 }]));

  const result = await rpcdef(buildCtx({ req: { pk: 10 } }))[LIST_PRODUCTS_PATH]();
  assert.ok(Array.isArray(result.items));
  assert.equal(result.items.length, 1);
});

// ── Error handling tests ────────────────────────────────────────────────

test('network failure throws UNAVAILABLE', async () => {
  globalThis.fetch = async () => { throw new Error('network down'); };

  await assert.rejects(
    () => rpcdef(buildCtx())[LIST_ENTERPRISE_SUBJECTS_PATH](),
    (err) => {
      assert.ok(err instanceof GrpcError);
      assert.equal(err.code, grpcStatus.UNAVAILABLE);
      assert.equal(err.legacyCode, 'UNAVAILABLE');
      assert.match(err.message, /network down/);
      return true;
    },
  );
});

test('HTTP 401 throws PERMISSION_DENIED', async () => {
  globalThis.fetch = async () => responseWithStatus(401, 'Unauthorized');

  await assert.rejects(
    () => rpcdef(buildCtx())[LIST_ENTERPRISE_SUBJECTS_PATH](),
    (err) => {
      assert.ok(err instanceof GrpcError);
      assert.equal(err.code, grpcStatus.PERMISSION_DENIED);
      assert.equal(err.legacyCode, 'PERMISSION_DENIED');
      return true;
    },
  );
});

test('HTTP 403 throws PERMISSION_DENIED', async () => {
  globalThis.fetch = async () => responseWithStatus(403, 'Forbidden');

  await assert.rejects(
    () => rpcdef(buildCtx())[LIST_ENTERPRISE_SUBJECTS_PATH](),
    (err) => {
      assert.equal(err.code, grpcStatus.PERMISSION_DENIED);
      return true;
    },
  );
});

test('HTTP 400 throws FAILED_PRECONDITION', async () => {
  globalThis.fetch = async () => responseWithStatus(400, 'Bad request');

  await assert.rejects(
    () => rpcdef(buildCtx())[LIST_ENTERPRISE_SUBJECTS_PATH](),
    (err) => {
      assert.equal(err.code, grpcStatus.FAILED_PRECONDITION);
      assert.equal(err.legacyCode, 'FAILED_PRECONDITION');
      return true;
    },
  );
});

test('HTTP 500 throws UNAVAILABLE', async () => {
  globalThis.fetch = async () => responseWithStatus(500, 'Internal error');

  await assert.rejects(
    () => rpcdef(buildCtx())[LIST_ENTERPRISE_SUBJECTS_PATH](),
    (err) => {
      assert.equal(err.code, grpcStatus.UNAVAILABLE);
      return true;
    },
  );
});

test('non-JSON response throws UNKNOWN', async () => {
  globalThis.fetch = async () => okResponse('not json at all', { 'content-type': 'text/plain' });

  await assert.rejects(
    () => rpcdef(buildCtx())[LIST_ENTERPRISE_SUBJECTS_PATH](),
    (err) => {
      assert.equal(err.code, grpcStatus.UNKNOWN);
      assert.equal(err.legacyCode, 'UNKNOWN');
      assert.match(err.message, /not valid JSON/);
      return true;
    },
  );
});

test('CloudAtlas business error (code != 200/0) throws FAILED_PRECONDITION', async () => {
  globalThis.fetch = async () => okResponse(JSON.stringify({ code: 400, message: 'invalid param' }), { 'content-type': 'application/json' });

  await assert.rejects(
    () => rpcdef(buildCtx())[LIST_ENTERPRISE_SUBJECTS_PATH](),
    (err) => {
      assert.equal(err.code, grpcStatus.FAILED_PRECONDITION);
      assert.equal(err.legacyCode, 'FAILED_PRECONDITION');
      assert.match(err.message, /CloudAtlas code 400/);
      return true;
    },
  );
});

test('CloudAtlas code 0 is treated as success', async () => {
  globalThis.fetch = async () => okResponse(JSON.stringify({ code: 0, data: { items: [], total: 0 } }), { 'content-type': 'application/json' });

  const result = await rpcdef(buildCtx())[LIST_ENTERPRISE_SUBJECTS_PATH]();
  assert.deepEqual(result.items, []);
  assert.equal(result.total, 0);
});

// ── skipTlsVerify test ──────────────────────────────────────────────────

test('skipTlsVerify adds tls options to fetch init', async () => {
  let captured;
  globalThis.fetch = async (url, init) => {
    captured = { url, init };
    return okResponse(successListBody([], 0));
  };

  await rpcdef(buildCtx({ bindings: { skipTlsVerify: true } }))[LIST_ENTERPRISE_SUBJECTS_PATH]();
  assert.equal(Object.hasOwn(captured.init, 'skipTlsVerify'), false);
  assert.equal(Object.hasOwn(captured.init, 'tlsInsecureSkipVerify'), false);
  assert.equal(Object.hasOwn(captured.init, 'insecureSkipVerify'), false);
  assert.ok(captured.init.dispatcher);
  assert.equal(Object.hasOwn(captured.init, 'skipTlsVerify'), false);
  assert.equal(Object.hasOwn(captured.init, 'tlsInsecureSkipVerify'), false);
  assert.equal(Object.hasOwn(captured.init, 'insecureSkipVerify'), false);
  assert.ok(captured.init.dispatcher);
});

test('no skipTlsVerify omits tls options', async () => {
  let captured;
  globalThis.fetch = async (url, init) => {
    captured = { url, init };
    return okResponse(successListBody([], 0));
  };

  await rpcdef(buildCtx())[LIST_ENTERPRISE_SUBJECTS_PATH]();
  assert.equal(captured.init.insecureSkipVerify, undefined);
});

// ── config.headers test ─────────────────────────────────────────────────

test('config.headers are merged into request headers', async () => {
  let captured;
  globalThis.fetch = async (url, init) => {
    captured = { url, init };
    return okResponse(successListBody([], 0));
  };

  await rpcdef(buildCtx({ config: { headers: { 'X-Custom': 'val' } } }))[LIST_ENTERPRISE_SUBJECTS_PATH]();
  assert.equal(captured.init.headers['X-Custom'], 'val');
  assert.equal(captured.init.headers.TOKEN, 'test-token');
});

// ── SDK handler integration tests ──────────────────────────────────────

test('SDK handler ListEnterpriseSubjects works with config+secret+request', async () => {
  globalThis.fetch = async () => okResponse(successListBody([{ id: 1 }], 1));

  const result = await handlers[METHOD_LIST_ENTERPRISE_SUBJECTS_FULL]({
    config: { baseUrl: 'https://cloudatlas.example.com' },
    secret: { token: 'sdk-token' },
    request: { space: 1 },
  });

  assert.deepEqual(result.items, [{ id: 1 }]);
  assert.equal(result.total, 1);
});

test('SDK handler BatchUpdateSeeds:switch works', async () => {
  globalThis.fetch = async () => okResponse(successMutationBody(3));

  const result = await handlers[METHOD_BATCH_UPDATE_SEEDS_FULL]({
    config: { baseUrl: 'https://cloudatlas.example.com' },
    secret: { token: 'sdk-token' },
    request: { resource_type: 'enterprise', ids: [1, 2, 3], update_type: 'switch', enable: true },
  });

  assert.equal(result.affected_count, 3);
});

test('SDK handler CreateTaskSchedule works', async () => {
  globalThis.fetch = async () => okResponse(JSON.stringify({ id: 7 }));

  const result = await handlers[METHOD_CREATE_TASK_SCHEDULE_FULL]({
    config: { baseUrl: 'https://cloudatlas.example.com' },
    secret: { token: 'sdk-token' },
    request: { name: 'test', task_type: 'scan' },
  });

  assert.equal(result.id, 7);
});

test('SDK handler GetHighRiskAppFingers works', async () => {
  globalThis.fetch = async () => okResponse(JSON.stringify({ id: 5, name: 'app' }));

  const result = await handlers[METHOD_GET_HIGH_RISK_APP_FINGERS_FULL]({
    config: { baseUrl: 'https://cloudatlas.example.com' },
    secret: { token: 'sdk-token' },
    request: { pk: 5 },
  });

  assert.ok(Array.isArray(result.items));
});

test('SDK handler rejects missing token', async () => {
  await assert.rejects(
    () => handlers[METHOD_LIST_KEYWORDS_FULL]({
      config: { baseUrl: 'https://cloudatlas.example.com' },
      secret: { token: '' },
      request: {},
    }),
    /token is required/,
  );
});

// ── Service wrapper verification ────────────────────────────────────────

test('service.handlers has same keys as handlers export', () => {
  const serviceKeys = Object.keys(service.handlers);
  const handlerKeys = Object.keys(handlers);
  assert.deepEqual(serviceKeys, handlerKeys);
  assert.equal(serviceKeys.length, 52);
});

test('service has 52 handler keys', () => {
  const keys = Object.keys(handlers);
  assert.equal(keys.length, 52);
});

// ── requestWithDefaults test ────────────────────────────────────────────

test('requestWithDefaults injects token and space from bindings', async () => {
  let captured;
  globalThis.fetch = async (url, init) => {
    captured = { url, init };
    return okResponse(successListBody([], 0));
  };

  const result = await rpcdef(buildCtx({ bindings: { space: 5 }, req: {} }))[LIST_ENTERPRISE_SUBJECTS_PATH]();
  assert.match(captured.url, /space=5/);
});

test('requestWithDefaults ignores per-request token in favor of instance secret', async () => {
  let captured;
  globalThis.fetch = async (url, init) => {
    captured = { url, init };
    return okResponse(successListBody([], 0));
  };

  await rpcdef(buildCtx({ secret: { token: 'secret-token' }, req: { token: 'request-token' } }))[LIST_ENTERPRISE_SUBJECTS_PATH]();
  assert.equal(captured.init.headers.TOKEN, 'secret-token');
});

// ── Alternative binding names test ──────────────────────────────────────

test('alternative binding names: restBaseUrl, base_url, endpoint', async () => {
  globalThis.fetch = async (url, init) => okResponse(successListBody([], 0));

  const alternatives = ['restBaseUrl', 'base_url', 'endpoint'];
  for (const alt of alternatives) {
    const result = await rpcdef(buildCtx({ bindings: { baseUrl: '', [alt]: 'https://alt.example.com' } }))[LIST_ENTERPRISE_SUBJECTS_PATH]();
    assert.deepEqual(result.items, []);
  }
});

test('alternative binding names: defaultSpace, default_space', async () => {
  let captured;
  globalThis.fetch = async (url, init) => {
    captured = { url, init };
    return okResponse(successListBody([], 0));
  };

  await rpcdef(buildCtx({ bindings: { defaultSpace: 3 }, req: {} }))[LIST_ENTERPRISE_SUBJECTS_PATH]();
  assert.match(captured.url, /space=3/);
});

// ── Catch-all edge branch tests ─────────────────────────────────────────

test('toQueryNumber handles NaN', () => {
  assert.equal(_test.toQueryNumber(NaN), undefined);
});

test('normalizeBaseUrl with whitespace', () => {
  assert.equal(_test.normalizeBaseUrl('  https://example.com  '), 'https://example.com');
});

test('resolveCallContext with empty request falls back to {}', () => {
  const r = _test.resolveCallContext({}, {});
  assert.deepEqual(r.req, {});
});

test('BatchDeleteAssets normalizes root_domain to root-domain and uses DELETE method', async () => {
  let captured;
  globalThis.fetch = async (url, init) => {
    captured = { url, init };
    return okResponse(successMutationBody(2));
  };

  await rpcdef(buildCtx({ req: { resource_type: 'root_domain', ids: [1, 2] } }))[BATCH_DELETE_ASSETS_PATH]();
  assert.equal(captured.init.method, 'DELETE');
  assert.match(captured.url, /asset\/root-domain\/batch-delete/);
});

test('ListTags accepts fetchOptions alias for options', async () => {
  let captured;
  globalThis.fetch = async (url, init) => {
    captured = { url, init };
    return okResponse(successListBody([], 0));
  };

  await rpcdef(buildCtx({ req: { fetchOptions: 'true' } }))[LIST_TAGS_PATH]();
  assert.match(captured.url, /space\/tag\/options/);
});

test('BatchCreateKeywords sends POST to /seed/keyword/batch-create', async () => {
  let captured;
  globalThis.fetch = async (url, init) => {
    captured = { url, init };
    return okResponse(successMutationBody(2));
  };

  const result = await rpcdef(buildCtx({ req: { entries: [{ name: 'kw' }] } }))[BATCH_CREATE_KEYWORDS_PATH]();
  assert.match(captured.url, /seed\/keyword\/batch-create/);
  assert.equal(result.affected_count, 2);
});

test('BatchCreateRootDomains sends POST to /asset/root-domain/batch-create', async () => {
  let captured;
  globalThis.fetch = async (url, init) => {
    captured = { url, init };
    return okResponse(successMutationBody(1));
  };

  await rpcdef(buildCtx({ req: { entries: [{ name: 'd' }] } }))[BATCH_CREATE_ROOT_DOMAINS_PATH]();
  assert.match(captured.url, /asset\/root-domain\/batch-create/);
});

test('BatchCreateIPs sends POST to /asset/ip/batch-create', async () => {
  let captured;
  globalThis.fetch = async (url, init) => {
    captured = { url, init };
    return okResponse(successMutationBody(1));
  };

  await rpcdef(buildCtx({ req: { entries: [{ address: '1.2.3.4' }] } }))[BATCH_CREATE_IPS_PATH]();
  assert.match(captured.url, /asset\/ip\/batch-create/);
});

test('rpcdef returns all 52 handler keys', () => {
  const ctx = buildCtx();
  const handlerMap = rpcdef(ctx);
  assert.equal(Object.keys(handlerMap).length, 52);
});

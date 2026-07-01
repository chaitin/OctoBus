import assert from 'node:assert/strict';
import test from 'node:test';

import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';

import {
  METHOD_PREFIX,
  _test,
  handlers,
  rpcdef,
} from '../src/ruijie-behavior-firewall-r2-3-2-t0.js';
import { service } from '../src/service.js';

const originalFetch = globalThis.fetch;
const originalDateNow = Date.now;

const response = (status, body) => ({
  status,
  text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
});

const buildCtx = (overrides = {}) => ({
  config: {
    manageBaseUrl: 'https://manage.example:9090',
    reportBaseUrl: 'https://report.example:9091',
    ...(overrides.config || {}),
  },
  secret: { signingSecret: 'secret', ...(overrides.secret || {}) },
  bindings: { ...(overrides.bindings || {}) },
  limits: { timeoutMs: 30_000, ...(overrides.limits || {}) },
  req: overrides.req || {},
});

const captureFetch = (body = { code: 0, data: [] }) => {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init, body: init.body ? JSON.parse(init.body) : undefined });
    return response(200, body);
  };
  return calls;
};

const expectGrpcError = async (fn, legacyCode) => {
  let caught;
  try { await fn(); } catch (err) { caught = err; }
  assert.ok(caught, 'expected error');
  assert.ok(caught instanceof GrpcError);
  assert.equal(caught.legacyCode, legacyCode);
  assert.equal(caught.code, ({
    FAILED_PRECONDITION: grpcStatus.FAILED_PRECONDITION,
    INVALID_ARGUMENT: grpcStatus.INVALID_ARGUMENT,
    PERMISSION_DENIED: grpcStatus.PERMISSION_DENIED,
    UNAUTHENTICATED: grpcStatus.UNAUTHENTICATED,
    UNAVAILABLE: grpcStatus.UNAVAILABLE,
    UNKNOWN: grpcStatus.UNKNOWN,
  })[legacyCode]);
  return caught;
};

test.afterEach(() => {
  globalThis.fetch = originalFetch;
  Date.now = originalDateNow;
});

test('service exports handlers for all target rpc methods', () => {
  assert.equal(typeof service, 'object');
  for (const method of [
    'ListSafePolicies', 'AddSafePolicy', 'GetSafePolicy', 'EditSafePolicy', 'InsertSafePolicy', 'MoveSafePolicy', 'SetSafePolicyStatus', 'DeleteSafePolicy', 'DeleteAllSafePolicies', 'ClearSafePolicyCounters',
    'ListSecurityProtectPolicies', 'UpsertSecurityProtectPolicy', 'GetSecurityProtectPolicy', 'MoveSecurityProtectPolicy', 'SetSecurityProtectPolicyStatus', 'DeleteSecurityProtectPolicy', 'DeleteAllSecurityProtectPolicies', 'ClearSecurityProtectPolicyCounters',
    'ListIPWhitePolicies', 'AddIPWhitePolicy', 'GetIPWhitePolicy', 'EditIPWhitePolicy', 'DeleteIPWhitePolicy', 'DeleteAllIPWhitePolicies',
    'ListURLWhitePolicies', 'AddURLWhitePolicy', 'GetURLWhitePolicy', 'EditURLWhitePolicy', 'SetURLWhitePolicyStatus', 'DeleteURLWhitePolicy', 'DeleteAllURLWhitePolicies',
    'GetDdosLogs', 'GetVirusLogs', 'GetIpsLogs', 'GetWafLogs', 'GetLockedIpLogs', 'RawManage', 'RawReport',
  ]) {
    assert.equal(typeof handlers[METHOD_PREFIX + method], 'function', method);
  }
  assert.equal(typeof rpcdef(buildCtx())['/' + METHOD_PREFIX + 'ListSafePolicies'], 'function');
});

test('signs management requests and maps ListSafePolicies opt', async () => {
  Date.now = () => 1_765_000_000_123;
  const calls = captureFetch({ code: 0, result: [{ name: 'allow' }] });
  const result = await handlers[METHOD_PREFIX + 'ListSafePolicies']({ filter: { fields: { name: { stringValue: 'x' } } } }, buildCtx());
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://manage.example:9090/api.php/inter/Inter?opt=getlistsafepolicy');
  assert.deepEqual(calls[0].body, { name: 'x' });
  assert.equal(calls[0].init.headers.HY_BZ_API_APP_ID, 'hybzapi');
  assert.equal(calls[0].init.headers.HY_BZ_API_TIMESTAMP, '1765000000');
  assert.equal(calls[0].init.headers.HY_BZ_API_SIGNATURE, _test.signBody('{"name":"x"}', '1765000000', 'secret'));
  assert.ok(calls[0].init.signal instanceof AbortSignal);
  assert.equal('timeoutMs' in calls[0].init, false);
  assert.equal(result.http_status, 200);
  assert.equal(result.code, 0);
  assert.deepEqual(result.raw_json.structValue.fields.result.listValue.values[0].structValue.fields.name, { stringValue: 'allow' });
});

test('maps report requests to reporter URL and log query body', async () => {
  const calls = captureFetch({ code: 0, list: [] });
  await handlers[METHOD_PREFIX + 'GetDdosLogs']({ from_date: '2026-06-01', to_date: '2026-06-29', pagesize: 100, pagenum: 2 }, buildCtx());
  assert.equal(calls[0].url, 'https://report.example:9091/api_reporter.php/inter/Inter?opt=getlogddos');
  assert.deepEqual(calls[0].body, { from_date: '2026-06-01', to_date: '2026-06-29', pagesize: 100, pagenum: 2 });
});

test('builds explicit key and status request bodies', async () => {
  let calls = captureFetch({ code: 0 });
  await handlers[METHOD_PREFIX + 'GetSafePolicy']({ rule_name: 'r1', policy_from: 'LAN1', policy_to: 'WAN1' }, buildCtx());
  assert.equal(calls[0].url, 'https://manage.example:9090/api.php/inter/Inter?opt=getdetailsafepolicy');
  assert.deepEqual(calls[0].body, { rule_name: 'r1', policy_from: 'LAN1', policy_to: 'WAN1' });

  calls = captureFetch({ code: 0 });
  await handlers[METHOD_PREFIX + 'SetURLWhitePolicyStatus']({ names: 'u1:1,u2:0' }, buildCtx());
  assert.equal(calls[0].url, 'https://manage.example:9090/api.php/inter/Inter?opt=editstatusurlwhitepolicy');
  assert.deepEqual(calls[0].body, { names: 'u1:1,u2:0' });
});

test('maps move request top-level fields into upstream payloads', async () => {
  let calls = captureFetch({ code: 0 });
  await handlers[METHOD_PREFIX + 'MoveSafePolicy']({
    name: 'safe-a',
    position: 'safe-b',
    target: 1,
    policy_from: 'LAN1',
    policy_to: 'WAN1',
    payload: { fields: { extra: { stringValue: 'keep' } } },
  }, buildCtx());
  assert.equal(calls[0].url, 'https://manage.example:9090/api.php/inter/Inter?opt=movesafepolicy');
  assert.deepEqual(calls[0].body, {
    extra: 'keep',
    name: 'safe-a',
    position: 'safe-b',
    target: 1,
    policy_from: 'LAN1',
    policy_to: 'WAN1',
  });

  calls = captureFetch({ code: 0 });
  await handlers[METHOD_PREFIX + 'MoveSecurityProtectPolicy']({ name: 'protect-a', position: 'protect-b', target: 0 }, buildCtx());
  assert.equal(calls[0].url, 'https://manage.example:9090/api.php/inter/Inter?opt=movesecurityprotectpolicy');
  assert.deepEqual(calls[0].body, { name: 'protect-a', position: 'protect-b', target: 0 });
});

test('RawManage and RawReport support arbitrary opt values', async () => {
  let calls = captureFetch({ code: 0 });
  await handlers[METHOD_PREFIX + 'RawManage']({ opt: 'saveconfig', payload: { fields: {} } }, buildCtx());
  assert.equal(calls[0].url, 'https://manage.example:9090/api.php/inter/Inter?opt=saveconfig');

  calls = captureFetch({ code: 0 });
  await handlers[METHOD_PREFIX + 'RawReport']({ opt: 'getlistalarm', payload: { fields: { pagesize: { numberValue: 20 } } } }, buildCtx());
  assert.equal(calls[0].url, 'https://report.example:9091/api_reporter.php/inter/Inter?opt=getlistalarm');
  assert.deepEqual(calls[0].body, { pagesize: 20 });
});

test('maps validation and upstream failures', async () => {
  await expectGrpcError(() => handlers[METHOD_PREFIX + 'GetIPWhitePolicy']({}, buildCtx()), 'INVALID_ARGUMENT');
  await expectGrpcError(() => handlers[METHOD_PREFIX + 'RawManage']({}, buildCtx()), 'INVALID_ARGUMENT');
  await expectGrpcError(() => handlers[METHOD_PREFIX + 'ListSafePolicies']({}, buildCtx({ config: { manageBaseUrl: 'bad' } })), 'FAILED_PRECONDITION');
  await expectGrpcError(() => handlers[METHOD_PREFIX + 'ListSafePolicies']({}, buildCtx({ secret: { signingSecret: '' } })), 'FAILED_PRECONDITION');

  globalThis.fetch = async () => response(403, { code: 4, msg: 'signature error' });
  await expectGrpcError(() => handlers[METHOD_PREFIX + 'ListSafePolicies']({}, buildCtx()), 'PERMISSION_DENIED');

  globalThis.fetch = async () => response(200, 'not-json');
  await expectGrpcError(() => handlers[METHOD_PREFIX + 'ListSafePolicies']({}, buildCtx()), 'UNKNOWN');

  globalThis.fetch = async () => response(200, { code: 999, msg: 'failed' });
  const err = await expectGrpcError(() => handlers[METHOD_PREFIX + 'ListSafePolicies']({}, buildCtx()), 'FAILED_PRECONDITION');
  assert.match(err.message, /upstream_code/);

  globalThis.fetch = async () => { throw Object.assign(new Error('outer'), { cause: new Error('network down') }); };
  const unavailable = await expectGrpcError(() => handlers[METHOD_PREFIX + 'ListSafePolicies']({}, buildCtx()), 'UNAVAILABLE');
  assert.match(unavailable.message, /network down/);
});

test('helper functions cover response code extraction and aliases', () => {
  assert.equal(_test.createDispatcher({ skipTlsVerify: false }), undefined);
  const dispatcher = _test.createDispatcher({ skipTlsVerify: true });
  assert.ok(dispatcher);
  assert.equal(_test.createDispatcher({ skipTlsVerify: true }), dispatcher);
  assert.equal(_test.extractCode({ errcode: '5' }), 5);
  assert.equal(_test.extractCode({}), 0);
  assert.equal(_test.extractMessage({ msg: { a: 1 } }), '{"a":1}');
  assert.equal(_test.normalizeBaseUrl(' https://a.local/// '), 'https://a.local');
  assert.deepEqual(_test.parseJsonBody(''), { ok: true, value: null });
  assert.deepEqual(_test.parseJsonBody('bad'), { ok: false });
  assert.deepEqual(_test.cleanObject({ a: 1, b: '', c: null, d: undefined }), { a: 1 });
});

import assert from 'node:assert/strict';
import test from 'node:test';

import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';

import {
  METHOD_GET_FILE_INFO_FULL,
  METHOD_GET_FILE_INFO_PATH,
  METHOD_GET_IP_INGRESS_INFO_FULL,
  METHOD_GET_IP_INGRESS_INFO_PATH,
  METHOD_QUERY_IOC_FULL,
  METHOD_QUERY_IOC_PATH,
  _test,
  handlers,
  rpcdef,
} from '../src/tencent-tix-saas.js';
import { service } from '../src/service.js';

const originalFetch = globalThis.fetch;

const response = (status, body) => ({
  status,
  text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
});

const setFetch = (impl) => {
  globalThis.fetch = impl;
};

const buildCtx = (overrides = {}) => ({
  config: {
    endpoint: 'https://xti.qq.com/api/v3/ti',
    lang: 'zh',
    ...(overrides.config || {}),
  },
  secret: {
    appKey: 'test_app_key',
    ...(overrides.secret || {}),
  },
  bindings: {
    ...(overrides.bindings || {}),
  },
  limits: { timeoutMs: 10_000, ...(overrides.limits || {}) },
  meta: { instance_id: 'inst', request_id: 'req', ...(overrides.meta || {}) },
  req: overrides.req || {},
});

const grpcMap = {
  FAILED_PRECONDITION: grpcStatus.FAILED_PRECONDITION,
  INVALID_ARGUMENT: grpcStatus.INVALID_ARGUMENT,
  PERMISSION_DENIED: grpcStatus.PERMISSION_DENIED,
  RESOURCE_EXHAUSTED: grpcStatus.RESOURCE_EXHAUSTED ?? grpcStatus.FAILED_PRECONDITION,
  UNAUTHENTICATED: grpcStatus.UNAUTHENTICATED,
  UNAVAILABLE: grpcStatus.UNAVAILABLE,
  UNKNOWN: grpcStatus.UNKNOWN,
};

const expectGrpcError = async (fn, legacyCode, checker = () => {}) => {
  let caught;
  try {
    await fn();
  } catch (err) {
    caught = err;
  }
  assert.ok(caught, 'expected function to reject');
  assert.ok(caught instanceof GrpcError);
  assert.equal(caught.legacyCode, legacyCode);
  assert.equal(caught.code, grpcMap[legacyCode]);
  checker(caught);
};

const parseStructuredError = (err) => JSON.parse(err.message);

test.afterEach(() => {
  globalThis.fetch = originalFetch;
});

test('service exports only authorized basic-query handlers and rpcdef paths', () => {
  assert.equal(typeof service, 'object');
  assert.deepEqual(Object.keys(handlers).sort(), [
    METHOD_GET_FILE_INFO_FULL,
    METHOD_GET_IP_INGRESS_INFO_FULL,
    METHOD_QUERY_IOC_FULL,
  ].sort());

  const defs = rpcdef(buildCtx());
  assert.deepEqual(Object.keys(defs).sort(), [
    METHOD_GET_FILE_INFO_PATH,
    METHOD_GET_IP_INGRESS_INFO_PATH,
    METHOD_QUERY_IOC_PATH,
  ].sort());
});

test('validates endpoint, appKey, key, option, and file hash type', async () => {
  await expectGrpcError(
    () => handlers[METHOD_QUERY_IOC_FULL]({ key: '203.0.113.50' }, buildCtx({ config: { endpoint: 'ftp://bad' } })),
    'INVALID_ARGUMENT',
    (err) => assert.match(err.message, /endpoint/),
  );
  await expectGrpcError(
    () => handlers[METHOD_QUERY_IOC_FULL]({ key: '203.0.113.50' }, buildCtx({ secret: { appKey: '' } })),
    'INVALID_ARGUMENT',
    (err) => assert.match(err.message, /appKey/),
  );
  await expectGrpcError(
    () => handlers[METHOD_QUERY_IOC_FULL]({}, buildCtx()),
    'INVALID_ARGUMENT',
    (err) => assert.match(err.message, /key is required/),
  );
  await expectGrpcError(
    () => handlers[METHOD_QUERY_IOC_FULL]({ key: '203.0.113.50', option: -1 }, buildCtx()),
    'INVALID_ARGUMENT',
    (err) => assert.match(err.message, /option/),
  );
  await expectGrpcError(
    () => handlers[METHOD_GET_FILE_INFO_FULL]({ key: 'not-a-hash' }, buildCtx()),
    'INVALID_ARGUMENT',
    (err) => assert.match(err.message, /md5, sha1, or sha256/),
  );
  await expectGrpcError(
    () => handlers[METHOD_QUERY_IOC_FULL]({ key: '203.0.113.50' }, buildCtx({ bindings: { skipTlsVerify: true } })),
    'INVALID_ARGUMENT',
    (err) => assert.match(err.message, /skipTlsVerify is not supported/),
  );
});

test('QueryIOC maps to TiInfo for compromise intelligence lookup', async () => {
  let captured;
  setFetch(async (url, init) => {
    captured = { url: String(url), init, body: JSON.parse(init.body) };
    return response(200, {
      return_code: 0,
      return_msg: 'success',
      ver: '3.0',
      data: {
        ips: {
          '45.122.138.118': {
            result: 'black',
            threat_level: 5,
            threat_type: ['APT'],
            tags: ['APT'],
            groups: ['demo-group'],
            ttps: ['T1106'],
          },
        },
      },
    });
  });

  const result = await handlers[METHOD_QUERY_IOC_FULL](
    { key: { value: ' 45.122.138.118,bellsyscdn.com ' }, lang: 'en' },
    buildCtx({ limits: { timeoutMs: 25 } }),
  );

  assert.equal(captured.url, 'https://xti.qq.com/api/v3/ti');
  assert.equal(captured.init.method, 'POST');
  assert.equal(Object.hasOwn(captured.init, 'timeoutMs'), false);
  assert.equal(Object.hasOwn(captured.init, 'skipTlsVerify'), false);
  assert.ok(captured.init.signal instanceof AbortSignal);
  assert.equal(captured.body.c_version, '3.0');
  assert.equal(captured.body.c_action, 'TiInfo');
  assert.equal(captured.body.c_appkey, 'test_app_key');
  assert.equal(captured.body.c_lang, 'en');
  assert.equal(captured.body.key, '45.122.138.118,bellsyscdn.com');
  assert.equal(captured.body.option, 0);
  assert.equal(Object.hasOwn(captured.body, 'type'), false);
  assert.equal(result.http_status, 200);
  assert.equal(result.return_code, 0);
  assert.equal(result.return_msg, 'success');
  assert.equal(result.no_data, false);
  assert.equal(result.raw_json.structValue.fields.data.structValue.fields.ips.structValue.fields['45.122.138.118'].structValue.fields.result.stringValue, 'black');
});

test('GetIPIngressInfo maps to IpIngressInfo with type ip', async () => {
  let captured;
  setFetch(async (url, init) => {
    captured = JSON.parse(init.body);
    return response(200, {
      return_code: 0,
      return_msg: 'success',
      ver: '3.0',
      data: {
        '62.76.41.46': {
          result: 'black',
          confidence: 90,
          threat_level: 4,
        },
      },
    });
  });

  const result = await handlers[METHOD_GET_IP_INGRESS_INFO_FULL]({ key: '62.76.41.46', type: 'domain' }, buildCtx());

  assert.equal(captured.c_action, 'IpIngressInfo');
  assert.equal(captured.type, 'ip');
  assert.equal(captured.key, '62.76.41.46');
  assert.equal(captured.option, 0);
  assert.equal(result.raw_json.structValue.fields.data.structValue.fields['62.76.41.46'].structValue.fields.confidence.numberValue, 90);
});

test('GetFileInfo maps to FileInfo and infers hash types', async () => {
  const calls = [];
  setFetch(async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push(body);
    return response(200, { return_code: 0, return_msg: 'success', ver: '3.0', result: 'white' });
  });

  await handlers[METHOD_GET_FILE_INFO_FULL]({ key: 'a5a4046989fa0f99c2076aec3ea0ab2a' }, buildCtx());
  await handlers[METHOD_GET_FILE_INFO_FULL]({ key: 'A'.repeat(40) }, buildCtx());
  await handlers[METHOD_GET_FILE_INFO_FULL]({ key: 'b'.repeat(64), type: 'sha256' }, buildCtx());

  assert.deepEqual(calls.map((body) => body.c_action), ['FileInfo', 'FileInfo', 'FileInfo']);
  assert.deepEqual(calls.map((body) => body.type), ['md5', 'sha1', 'sha256']);
  assert.deepEqual(calls.map((body) => Object.hasOwn(body, 'c_lang')), [false, false, false]);
});

test('SDK handlers accept single call context with request, config, and secret', async () => {
  let captured;
  setFetch(async (url, init) => {
    captured = { url: String(url), body: JSON.parse(init.body) };
    return response(200, {
      return_code: 0,
      return_msg: 'success',
      ver: '3.0',
      data: {},
    });
  });

  const result = await handlers[METHOD_QUERY_IOC_FULL]({
    request: { key: '203.0.113.60', option: { value: 1 } },
    config: { endpoint: 'https://xti.qq.com/api/v3/ti', lang: 'en' },
    secret: { appKey: 'sdk_app_key' },
  });

  assert.equal(captured.url, 'https://xti.qq.com/api/v3/ti');
  assert.equal(captured.body.c_action, 'TiInfo');
  assert.equal(captured.body.c_appkey, 'sdk_app_key');
  assert.equal(captured.body.c_lang, 'en');
  assert.equal(captured.body.key, '203.0.113.60');
  assert.equal(captured.body.option, 1);
  assert.equal(result.return_code, 0);
});

test('SDK handlers still accept legacy request and context arguments', async () => {
  let captured;
  setFetch(async (url, init) => {
    captured = JSON.parse(init.body);
    return response(200, { return_code: 0, return_msg: 'success', ver: '3.0' });
  });

  const result = await handlers[METHOD_GET_IP_INGRESS_INFO_FULL](
    { key: '203.0.113.70' },
    {
      config: { endpoint: 'https://xti.qq.com/api/v3/ti' },
      secret: { appKey: 'legacy_app_key' },
    },
  );

  assert.equal(captured.c_appkey, 'legacy_app_key');
  assert.equal(captured.c_action, 'IpIngressInfo');
  assert.equal(captured.key, '203.0.113.70');
  assert.equal(result.return_code, 0);
});

test('maps Tencent TIX business return codes', async () => {
  setFetch(async (url, init) => {
    const body = JSON.parse(init.body);
    if (body.key === 'no-data') return response(200, { return_code: 1, return_msg: 'success, no data', ver: '3.0' });
    if (body.key === 'bad-key') return response(200, { return_code: 1003, return_msg: 'Get appid of appkey error.', ver: '3.0' });
    if (body.key === 'quota') return response(200, { return_code: 1004, return_msg: 'quota exhausted', ver: '3.0' });
    if (body.key === 'daily-limit') return response(200, { return_code: 1005, return_msg: 'daily limit exceeded', ver: '3.0' });
    if (body.key === 'server-error') return response(200, { return_code: 1006, return_msg: 'internal error', ver: '3.0' });
    return response(200, { return_code: 0, return_msg: 'success', ver: '3.0' });
  });

  const noData = await handlers[METHOD_QUERY_IOC_FULL]({ key: 'no-data' }, buildCtx());
  assert.equal(noData.return_code, 1);
  assert.equal(noData.no_data, true);

  await expectGrpcError(
    () => handlers[METHOD_QUERY_IOC_FULL]({ key: 'bad-key' }, buildCtx()),
    'UNAUTHENTICATED',
    (err) => assert.equal(parseStructuredError(err).return_code, 1003),
  );
  await expectGrpcError(
    () => handlers[METHOD_QUERY_IOC_FULL]({ key: 'quota' }, buildCtx()),
    'RESOURCE_EXHAUSTED',
    (err) => assert.equal(parseStructuredError(err).return_code, 1004),
  );
  await expectGrpcError(
    () => handlers[METHOD_QUERY_IOC_FULL]({ key: 'daily-limit' }, buildCtx()),
    'RESOURCE_EXHAUSTED',
    (err) => assert.equal(parseStructuredError(err).return_code, 1005),
  );
  await expectGrpcError(
    () => handlers[METHOD_QUERY_IOC_FULL]({ key: 'server-error' }, buildCtx()),
    'UNAVAILABLE',
    (err) => assert.equal(parseStructuredError(err).return_code, 1006),
  );
});

test('maps HTTP, invalid JSON, missing return_code, and network failures', async () => {
  setFetch(async (url, init) => {
    const body = JSON.parse(init.body);
    if (body.key === 'http401') return response(401, { return_code: 1003, return_msg: 'unauthorized' });
    if (body.key === 'http403') return response(403, { return_code: 1003, return_msg: 'forbidden' });
    if (body.key === 'http500') return response(500, { return_code: 1006, return_msg: 'server error' });
    if (body.key === 'invalid-json') return response(200, 'not-json');
    if (body.key === 'missing-code') return response(200, { return_msg: 'missing code' });
    throw new Error('network down');
  });

  await expectGrpcError(() => handlers[METHOD_QUERY_IOC_FULL]({ key: 'http401' }, buildCtx()), 'UNAUTHENTICATED');
  await expectGrpcError(() => handlers[METHOD_QUERY_IOC_FULL]({ key: 'http403' }, buildCtx()), 'PERMISSION_DENIED');
  await expectGrpcError(() => handlers[METHOD_QUERY_IOC_FULL]({ key: 'http500' }, buildCtx()), 'UNAVAILABLE');
  await expectGrpcError(() => handlers[METHOD_QUERY_IOC_FULL]({ key: 'invalid-json' }, buildCtx()), 'UNKNOWN');
  await expectGrpcError(() => handlers[METHOD_QUERY_IOC_FULL]({ key: 'missing-code' }, buildCtx()), 'UNKNOWN');
  await expectGrpcError(() => handlers[METHOD_QUERY_IOC_FULL]({ key: 'network' }, buildCtx()), 'UNAVAILABLE');
});

test('applies upstream timeout through AbortController', async () => {
  setFetch(async (url, init) => new Promise((resolve, reject) => {
    assert.ok(init.signal instanceof AbortSignal);
    init.signal.addEventListener('abort', () => reject(new Error('aborted by test timeout')), { once: true });
  }));

  await expectGrpcError(
    () => handlers[METHOD_QUERY_IOC_FULL]({ key: 'timeout' }, buildCtx({ limits: { timeoutMs: 1 } })),
    'UNAVAILABLE',
    (err) => assert.match(parseStructuredError(err).reason, /aborted by test timeout/),
  );
});

test('aliases and helpers remain compatible', async () => {
  let captured;
  setFetch(async (url, init) => {
    captured = { url: String(url), body: JSON.parse(init.body) };
    return response(200, { returnCode: 1000, returnMsg: 'auth ok', ver: '3.0' });
  });

  const result = await handlers[METHOD_QUERY_IOC_FULL](
    { resource: { value: 'example.com' }, type: 'domain', lang: 'bad' },
    buildCtx({
      config: { endpoint: undefined, baseUrl: ' http://mock.local/api/v3/ti ', lang: 'en' },
      secret: { appKey: undefined, app_key: 'alias_key' },
    }),
  );

  assert.equal(captured.url, 'http://mock.local/api/v3/ti');
  assert.equal(captured.body.c_appkey, 'alias_key');
  assert.equal(captured.body.c_lang, 'zh');
  assert.equal(captured.body.type, 'domain');
  assert.equal(result.return_code, 1000);
  assert.equal(_test.inferFileHashType('a'.repeat(32)), 'md5');
  assert.equal(_test.inferFileHashType('a'.repeat(40)), 'sha1');
  assert.equal(_test.inferFileHashType('a'.repeat(64)), 'sha256');
  assert.equal(_test.inferFileHashType('zzz'), '');
});

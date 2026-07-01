import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';

import {
  METHOD_GET_FILE_REPORT_FULL,
  METHOD_GET_FILE_REPORT_PATH,
  METHOD_GET_MULTI_ENGINES_REPORT_FULL,
  METHOD_GET_MULTI_ENGINES_REPORT_PATH,
  METHOD_UPLOAD_FILE_FULL,
  METHOD_UPLOAD_FILE_PATH,
  _test,
  handlers,
  rpcdef,
} from '../src/threatbook-claudsandbox-v3.js';
import { service } from '../src/service.js';
import { createMockServer } from './mock_upstream.js';

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
    threatbook_domain: 'https://api.threatbook.cn',
    ...(overrides.config || {}),
  },
  secret: {
    threatbook_apikey: 'test_api_key',
    ...(overrides.secret || {}),
  },
  bindings: {
    ...(overrides.bindings || {}),
  },
  limits: { timeoutMs: 10_000, ...(overrides.limits || {}) },
  meta: { instance_id: 'inst', request_id: 'req', ...(overrides.meta || {}) },
  req: overrides.req || {},
});

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
  assert.equal(caught.code, ({
    FAILED_PRECONDITION: grpcStatus.FAILED_PRECONDITION,
    INVALID_ARGUMENT: grpcStatus.INVALID_ARGUMENT,
    PERMISSION_DENIED: grpcStatus.PERMISSION_DENIED,
    UNAUTHENTICATED: grpcStatus.UNAUTHENTICATED,
    UNAVAILABLE: grpcStatus.UNAVAILABLE,
    UNKNOWN: grpcStatus.UNKNOWN,
  })[legacyCode]);
  checker(caught);
};

const parseStructuredError = (err) => JSON.parse(err.message);

test.afterEach(() => {
  globalThis.fetch = originalFetch;
});

test('service exports handlers and rpcdef paths', () => {
  assert.equal(typeof service, 'object');
  assert.equal(typeof handlers[METHOD_UPLOAD_FILE_FULL], 'function');
  assert.equal(typeof handlers[METHOD_GET_FILE_REPORT_FULL], 'function');
  assert.equal(typeof handlers[METHOD_GET_MULTI_ENGINES_REPORT_FULL], 'function');
  const defs = rpcdef(buildCtx());
  assert.equal(typeof defs[METHOD_UPLOAD_FILE_PATH], 'function');
  assert.equal(typeof defs[METHOD_GET_FILE_REPORT_PATH], 'function');
  assert.equal(typeof defs[METHOD_GET_MULTI_ENGINES_REPORT_PATH], 'function');
});

test('validates required config, secret, upload input, resource, and report options', async () => {
  await expectGrpcError(
    () => handlers[METHOD_UPLOAD_FILE_FULL]({ file_bytes_base64: 'YQ==' }, buildCtx({ config: { threatbook_domain: 'ftp://bad' } })),
    'INVALID_ARGUMENT',
    (err) => assert.match(err.message, /threatbook_domain/),
  );
  await expectGrpcError(
    () => handlers[METHOD_UPLOAD_FILE_FULL]({ file_bytes_base64: 'YQ==' }, buildCtx({ secret: { threatbook_apikey: '' } })),
    'UNAUTHENTICATED',
    (err) => assert.match(err.message, /threatbook_apikey/),
  );
  await expectGrpcError(
    () => handlers[METHOD_UPLOAD_FILE_FULL]({}, buildCtx()),
    'INVALID_ARGUMENT',
    (err) => assert.match(err.message, /file_path or file_bytes_base64 or file_bytes is required/),
  );
  await expectGrpcError(
    () => handlers[METHOD_UPLOAD_FILE_FULL]({ file_bytes_base64: 'not base64' }, buildCtx()),
    'INVALID_ARGUMENT',
    (err) => assert.match(err.message, /valid base64/),
  );
  await expectGrpcError(
    () => handlers[METHOD_UPLOAD_FILE_FULL]({ file_bytes_base64: 'YQ==', run_time: -1 }, buildCtx()),
    'INVALID_ARGUMENT',
    (err) => assert.match(err.message, /run_time/),
  );
  await expectGrpcError(
    () => handlers[METHOD_GET_FILE_REPORT_FULL]({ sandbox_type: 'win7_sp1_enx86_office2013' }, buildCtx()),
    'INVALID_ARGUMENT',
    (err) => assert.match(err.message, /resource is required/),
  );
  await expectGrpcError(
    () => handlers[METHOD_GET_FILE_REPORT_FULL]({ resource: 'a'.repeat(64) }, buildCtx()),
    'INVALID_ARGUMENT',
    (err) => assert.match(err.message, /sandbox_type is required/),
  );
});

test('UploadFile sends multipart form and maps uploaded file data', async () => {
  let captured;
  setFetch(async (url, init) => {
    captured = { url: String(url), init };
    assert.equal(init.body instanceof FormData, true);
    return response(200, {
      response_code: 0,
      verbose_msg: 'OK',
      data: {
        sha256: 'a'.repeat(64),
        permalink: 'https://s.threatbook.com/report/file/example',
      },
    });
  });

  const result = await handlers[METHOD_UPLOAD_FILE_FULL](
    {
      file_bytes_base64: Buffer.from('hello file').toString('base64'),
      file_name: 'sample.bin',
      sandbox_type: 'win7_sp1_enx86_office2013',
      run_time: 60,
    },
    buildCtx({ bindings: { skipTlsVerify: true }, limits: { timeoutMs: 25 } }),
  );

  assert.equal(captured.url, 'https://api.threatbook.cn/v3/file/upload');
  assert.equal(captured.init.method, 'POST');
  assert.ok(captured.init.signal instanceof AbortSignal);
  assert.equal(captured.init.timeoutMs, undefined);
  assert.equal(captured.init.dispatcher, _test.insecureTlsDispatcher);
  assert.equal(captured.init.skipTlsVerify, undefined);
  assert.equal(captured.init.body.get('apikey'), 'test_api_key');
  assert.equal(captured.init.body.get('sandbox_type'), 'win7_sp1_enx86_office2013');
  assert.equal(captured.init.body.get('run_time'), '60');
  assert.equal(captured.init.body.get('file').name, 'sample.bin');
  assert.equal(result.http_status, 200);
  assert.equal(result.sha256, 'a'.repeat(64));
  assert.equal(result.permalink, 'https://s.threatbook.com/report/file/example');
});

test('UploadFile supports file_path input', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'octobus-claudsandbox-'));
  const filePath = path.join(tmpDir, 'sample.txt');
  await fs.writeFile(filePath, 'from disk');

  let captured;
  setFetch(async (url, init) => {
    captured = { url: String(url), init };
    return response(200, { response_code: 0, data: { sha256: 'b'.repeat(64), permalink: 'https://s.threatbook.com/report/file/disk' } });
  });

  const result = await handlers[METHOD_UPLOAD_FILE_FULL](
    { file_path: filePath, sandbox_type: 'win7_sp1_enx86_office2013' },
    buildCtx(),
  );

  assert.equal(captured.init.body.get('file').name, 'sample.txt');
  assert.equal(result.sha256, 'b'.repeat(64));
});

test('GetFileReport sends GET query and maps summary data', async () => {
  let captured;
  setFetch(async (url, init) => {
    captured = { url: String(url), init };
    return response(200, {
      response_code: 0,
      verbose_msg: 'OK',
      data: {
        summary: {
          threat_level: 'malicious',
          malware_type: 'Trojan',
          malware_family: 'CobaltStrike',
          is_whitelist: false,
          submit_time: '2019-01-22 17:36:21',
          file_name: 'sample.bin',
          file_type: 'EXEx86',
          sample_sha256: 'a'.repeat(64),
          md5: 'b'.repeat(32),
          sha1: 'c'.repeat(40),
          scenes: ['Cybercrime'],
          threat_score: 60,
          sandbox_type: 'win7_sp1_enx86_office2013',
          sandbox_type_list: ['win7_sp1_enx86_office2013'],
          multi_engines: '7/22',
        },
        permalink: 'https://s.threatbook.com/report/file/example',
      },
    });
  });

  const result = await handlers[METHOD_GET_FILE_REPORT_FULL](
    {
      sha256: 'a'.repeat(64),
      sandbox_type: 'win7_sp1_enx86_office2013',
      query_fields: ['summary', 'multiengines'],
    },
    buildCtx(),
  );

  const url = new URL(captured.url);
  assert.equal(`${url.origin}${url.pathname}`, 'https://api.threatbook.cn/v3/file/report');
  assert.equal(url.searchParams.get('apikey'), 'test_api_key');
  assert.equal(url.searchParams.get('resource'), 'a'.repeat(64));
  assert.equal(url.searchParams.get('sandbox_type'), 'win7_sp1_enx86_office2013');
  assert.deepEqual(url.searchParams.getAll('query_fields'), ['summary', 'multiengines']);
  assert.equal(captured.init.method, 'GET');
  assert.equal(result.summary.threat_level, 'malicious');
  assert.equal(result.summary.threat_score, 60);
  assert.equal(result.summary.scenes[0], 'Cybercrime');
  assert.equal(result.permalink, 'https://s.threatbook.com/report/file/example');
});

test('GetMultiEnginesReport sends GET query and maps multi-engine data', async () => {
  let captured;
  setFetch(async (url, init) => {
    captured = { url: String(url), init };
    return response(200, {
      response_code: 0,
      verbose_msg: 'OK',
      data: {
        multiengines: {
          threat_level: 'malicious',
          total: 22,
          scans: { Kaspersky: 'safe', Microsoft: 'DoS:Linux/Xorddos!rfn' },
          is_white: false,
          total2: 22,
          positives: 9,
          scan_date: '2019-01-22 13:23:55',
          malware_type: 'DoS',
          malware_family: 'Xorddos',
        },
      },
    });
  });

  const result = await handlers[METHOD_GET_MULTI_ENGINES_REPORT_FULL](
    { resource: 'a'.repeat(64) },
    buildCtx(),
  );

  const url = new URL(captured.url);
  assert.equal(`${url.origin}${url.pathname}`, 'https://api.threatbook.cn/v3/file/report/multiengines');
  assert.equal(url.searchParams.get('apikey'), 'test_api_key');
  assert.equal(url.searchParams.get('resource'), 'a'.repeat(64));
  assert.equal(captured.init.method, 'GET');
  assert.equal(result.multiengines.threat_level, 'malicious');
  assert.equal(result.multiengines.positives, 9);
  assert.deepEqual(result.multiengines.scans.structValue.fields.Microsoft, { stringValue: 'DoS:Linux/Xorddos!rfn' });
});

test('supports SDK context-only handler invocation and aliases', async () => {
  let captured;
  setFetch(async (url) => {
    captured = String(url);
    return response(200, {
      response_code: 0,
      data: { multiengines: { threat_level: 'clean', total: 1, scans: { Engine: 'safe' } } },
    });
  });

  const result = await handlers[METHOD_GET_MULTI_ENGINES_REPORT_FULL](buildCtx({
    config: { threatbook_domain: undefined, baseUrl: 'https://mock.local/' },
    secret: { threatbook_apikey: undefined, apiKey: 'alias_key' },
    req: { sha256: 'd'.repeat(64) },
  }));

  const url = new URL(captured);
  assert.equal(`${url.origin}${url.pathname}`, 'https://mock.local/v3/file/report/multiengines');
  assert.equal(url.searchParams.get('apikey'), 'alias_key');
  assert.equal(url.searchParams.get('resource'), 'd'.repeat(64));
  assert.equal(result.multiengines.threat_level, 'clean');
});

test('request fields cannot override secret and structured errors redact api key', async () => {
  let captured;
  setFetch(async (url, init) => {
    captured = { url: String(url), init };
    return response(200, {
      response_code: 1400,
      verbose_msg: 'upstream echoed test_api_key',
    });
  });

  await expectGrpcError(
    () => handlers[METHOD_UPLOAD_FILE_FULL]({
      file_bytes_base64: Buffer.from('secret check').toString('base64'),
      file_name: 'secret.bin',
      apikey: 'request_supplied_key',
      apiKey: 'request_supplied_key',
    }, buildCtx()),
    'FAILED_PRECONDITION',
    (err) => {
      assert.equal(captured.init.body.get('apikey'), 'test_api_key');
      assert.equal(captured.url, 'https://api.threatbook.cn/v3/file/upload');
      assert.doesNotMatch(err.message, /test_api_key/);
      assert.doesNotMatch(err.message, /request_supplied_key/);
      assert.equal(parseStructuredError(err).verbose_msg, 'upstream echoed <redacted>');
    },
  );
});

test('supports mock upstream round trip for all methods', async () => {
  const server = await createMockServer();
  try {
    const upload = await handlers[METHOD_UPLOAD_FILE_FULL](
      {
        file_bytes_base64: Buffer.from('mock sample').toString('base64'),
        file_name: 'mock.bin',
        sandbox_type: 'win7_sp1_enx86_office2013',
        run_time: 60,
      },
      buildCtx({ config: { threatbook_domain: undefined, baseUrl: server.url }, secret: { threatbook_apikey: undefined, apiKey: 'test_api_key' } }),
    );
    const report = await handlers[METHOD_GET_FILE_REPORT_FULL](
      { resource: upload.sha256, sandbox_type: 'win7_sp1_enx86_office2013', query_fields: ['summary', 'multiengines'] },
      buildCtx({ config: { threatbook_domain: undefined, baseUrl: server.url }, secret: { threatbook_apikey: undefined, apiKey: 'test_api_key' } }),
    );
    const multiengines = await handlers[METHOD_GET_MULTI_ENGINES_REPORT_FULL](
      { resource: upload.sha256 },
      buildCtx({ config: { threatbook_domain: undefined, baseUrl: server.url }, secret: { threatbook_apikey: undefined, apiKey: 'test_api_key' } }),
    );

    assert.equal(upload.sha256, 'a'.repeat(64));
    assert.equal(report.summary.malware_family, 'CobaltStrike');
    assert.equal(multiengines.multiengines.positives, 9);
    assert.equal(server.requests.length, 3);
    assert.equal(server.requests[0].path, '/v3/file/upload');
    assert.equal(server.requests[0].multipart.sandbox_type, 'win7_sp1_enx86_office2013');
    assert.equal(server.requests[1].path, '/v3/file/report');
    assert.deepEqual(server.requests[1].query.query_fields, 'multiengines');
    assert.equal(server.requests[2].path, '/v3/file/report/multiengines');
  } finally {
    await server.close();
  }
});

test('maps HTTP, business, JSON, response_code, network, and read failures', async () => {
  setFetch(async () => response(401, { response_code: 1100, verbose_msg: 'apikey required' }));
  await expectGrpcError(
    () => handlers[METHOD_GET_MULTI_ENGINES_REPORT_FULL]({ resource: 'a'.repeat(64) }, buildCtx()),
    'UNAUTHENTICATED',
    (err) => assert.equal(parseStructuredError(err).http_status, 401),
  );

  setFetch(async () => response(403, { response_code: 1101, verbose_msg: 'invalid apikey' }));
  await expectGrpcError(
    () => handlers[METHOD_GET_MULTI_ENGINES_REPORT_FULL]({ resource: 'a'.repeat(64) }, buildCtx()),
    'PERMISSION_DENIED',
    (err) => assert.equal(parseStructuredError(err).http_status, 403),
  );

  setFetch(async () => response(404, { response_code: 1204, verbose_msg: 'not found' }));
  await expectGrpcError(
    () => handlers[METHOD_GET_MULTI_ENGINES_REPORT_FULL]({ resource: 'a'.repeat(64) }, buildCtx()),
    'FAILED_PRECONDITION',
    (err) => assert.equal(parseStructuredError(err).reason, 'upstream http 404'),
  );

  setFetch(async () => response(429, { response_code: 1429, verbose_msg: 'rate limited' }));
  await expectGrpcError(
    () => handlers[METHOD_GET_MULTI_ENGINES_REPORT_FULL]({ resource: 'a'.repeat(64) }, buildCtx()),
    'FAILED_PRECONDITION',
    (err) => assert.equal(parseStructuredError(err).http_status, 429),
  );

  setFetch(async () => response(500, { message: 'internal' }));
  await expectGrpcError(
    () => handlers[METHOD_GET_MULTI_ENGINES_REPORT_FULL]({ resource: 'a'.repeat(64) }, buildCtx()),
    'UNAVAILABLE',
    (err) => assert.equal(parseStructuredError(err).reason, 'upstream http 500'),
  );

  setFetch(async () => response(200, { response_code: 1400, verbose_msg: 'business failed' }));
  await expectGrpcError(
    () => handlers[METHOD_GET_MULTI_ENGINES_REPORT_FULL]({ resource: 'a'.repeat(64) }, buildCtx()),
    'FAILED_PRECONDITION',
    (err) => assert.equal(parseStructuredError(err).response_code, 1400),
  );

  setFetch(async () => response(200, 'not-json'));
  await expectGrpcError(
    () => handlers[METHOD_GET_MULTI_ENGINES_REPORT_FULL]({ resource: 'a'.repeat(64) }, buildCtx()),
    'UNKNOWN',
    (err) => assert.equal(parseStructuredError(err).reason, 'response is not valid JSON'),
  );

  setFetch(async () => response(200, { verbose_msg: 'missing' }));
  await expectGrpcError(
    () => handlers[METHOD_GET_MULTI_ENGINES_REPORT_FULL]({ resource: 'a'.repeat(64) }, buildCtx()),
    'UNKNOWN',
    (err) => assert.equal(parseStructuredError(err).reason, 'response_code missing'),
  );

  setFetch(async () => {
    throw Object.assign(new Error('outer'), { cause: new Error('connection refused') });
  });
  await expectGrpcError(
    () => handlers[METHOD_GET_MULTI_ENGINES_REPORT_FULL]({ resource: 'a'.repeat(64) }, buildCtx()),
    'UNAVAILABLE',
    (err) => assert.equal(parseStructuredError(err).reason, 'connection refused'),
  );

  setFetch(async () => ({
    status: 200,
    text: async () => {
      throw new Error('read failed');
    },
  }));
  await expectGrpcError(
    () => handlers[METHOD_GET_MULTI_ENGINES_REPORT_FULL]({ resource: 'a'.repeat(64) }, buildCtx()),
    'UNAVAILABLE',
    (err) => assert.equal(parseStructuredError(err).reason, 'read failed'),
  );
});

test('all report and upload RPCs expose upstream failure paths', async () => {
  setFetch(async () => response(500, { message: 'upload down' }));
  await expectGrpcError(
    () => handlers[METHOD_UPLOAD_FILE_FULL]({ file_bytes_base64: 'YQ==' }, buildCtx()),
    'UNAVAILABLE',
    (err) => assert.equal(parseStructuredError(err).http_status, 500),
  );

  setFetch(async () => response(429, { response_code: 1429, verbose_msg: 'rate limited' }));
  await expectGrpcError(
    () => handlers[METHOD_GET_FILE_REPORT_FULL]({ resource: 'a'.repeat(64), sandbox_type: 'win7_sp1_enx86_office2013' }, buildCtx()),
    'FAILED_PRECONDITION',
    (err) => assert.equal(parseStructuredError(err).http_status, 429),
  );
});

test('helper branches are stable', () => {
  assert.equal(_test.grpcCodeFor('NOPE'), grpcStatus.UNKNOWN);
  assert.equal(_test.hasOwn(null, 'x'), false);
  assert.equal(_test.firstDefined(undefined, null, 0, 'x'), 0);
  assert.equal(_test.unwrapScalar({ value: { value: 'nested' } }), 'nested');
  assert.equal(_test.toTrimmedString(null), '');
  assert.equal(_test.normalizeBaseUrl('ftp://bad'), '');
  assert.equal(_test.normalizeBaseUrl(' https://api.local/// '), 'https://api.local');
  assert.equal(_test.resolveDomain({}), 'https://api.threatbook.cn');
  assert.equal(_test.resolveApiKey({}), '');
  assert.equal(_test.resolveTimeoutMs({ bindings: { timeoutMs: 0 } }), 1500);
  assert.equal(_test.normalizeRunTime({}), undefined);
  assert.equal(_test.normalizeQueryFields({ query_fields: [{ value: 'summary' }, 'multiengines'] }).length, 2);
  assert.deepEqual(_test.splitHandlerArgs({ resource: 'x' }).req, { resource: 'x' });
  assert.deepEqual(_test.splitHandlerArgs({ request: { resource: 'y' }, secret: {} }).req, { resource: 'y' });
});

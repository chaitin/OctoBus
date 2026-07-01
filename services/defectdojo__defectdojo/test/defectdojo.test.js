import test from 'node:test';
import assert from 'node:assert/strict';

import { grpcStatus } from '@chaitin-ai/octobus-sdk';

const listProductsPath = '/DefectDojo.DefectDojo/ListProducts';
const listEngagementsPath = '/DefectDojo.DefectDojo/ListEngagements';
const listFindingsPath = '/DefectDojo.DefectDojo/ListFindings';
const getFindingPath = '/DefectDojo.DefectDojo/GetFinding';
const importScanPath = '/DefectDojo.DefectDojo/ImportScan';
const reimportScanPath = '/DefectDojo.DefectDojo/ReimportScan';

const buildCtx = (req = {}, overrides = {}) => ({
  bindings: {
    defectdojo_base_url: 'http://localhost:8080',
    defectdojo_api_key: 'secret-token',
    headers: { 'X-Test': 'yes' },
    ...overrides.bindings,
  },
  limits: { timeoutMs: 10_000, ...overrides.limits },
  meta: { instance_id: 'inst', request_id: 'req', ...overrides.meta },
  req,
});

const loadHandler = async (path, req, overrides = {}) => {
  const { rpcdef } = await import('../src/defectdojo.js');
  const ctx = buildCtx(req, overrides);
  return rpcdef(ctx)[path];
};

const setFetch = (impl) => {
  global.fetch = async (...args) => impl(...args);
};

test('helpers normalize bindings, scalars, booleans, query strings, and headers', async () => {
  const { _test } = await import('../src/defectdojo.js');

  assert.deepEqual(_test.mergedBindings({
    config: { defectdojo_base_url: 'http://config', keep: 'config' },
    secret: { defectdojo_api_key: 'secret' },
    bindings: { defectdojo_base_url: 'http://binding' },
  }), {
    defectdojo_base_url: 'http://binding',
    keep: 'config',
    defectdojo_api_key: 'secret',
  });
  assert.equal(_test.normalizeBaseUrl('http://localhost:8080/'), 'http://localhost:8080');
  assert.equal(_test.normalizeBaseUrl('ftp://bad'), '');
  assert.equal(_test.resolveBaseUrl({ baseUrl: 'http://base' }), 'http://base');
  assert.equal(_test.resolveApiKey({ token: 'abc' }), 'abc');
  assert.equal(_test.toOptionalInt({ value: '7' }, { min: 1 }), 7);
  assert.equal(_test.toOptionalInt('0', { min: 1 }), undefined);
  assert.equal(_test.toOptionalBool({ value: 'false' }), false);
  assert.equal(_test.toOptionalBool(1), true);
  assert.equal(_test.toOptionalBool(0), false);
  assert.equal(_test.toOptionalBool(2), undefined);
  assert.equal(_test.toOptionalBool('true'), true);
  assert.equal(_test.toOptionalBool('false'), false);
  assert.equal(_test.toOptionalBool(''), undefined);
  assert.equal(_test.toOptionalBool('bad'), undefined);
  assert.deepEqual(_test.parseHeaders('{"X-A":"1"}'), { 'X-A': '1' });
  assert.deepEqual(_test.parseHeaders('{'), {});
  assert.deepEqual(_test.parseHeaders(['bad']), {});
  assert.equal(_test.encodeQueryPairs({ a: 'x y', empty: '', missing: undefined }), 'a=x%20y');
  assert.equal(_test.buildUrl('http://x/', '/api/v2/products/', { limit: 2 }), 'http://x/api/v2/products/?limit=2');
  assert.equal(_test.boolField({ value: true }), 'true');
  assert.equal(_test.boolField('0'), 'false');
  assert.equal(_test.boolField('bad'), undefined);
  assert.throws(
    () => _test.assertSupportedTlsConfig({ skipTlsVerify: true }),
    /skipTlsVerify is not supported/,
  );
  assert.throws(
    () => _test.assertSupportedTlsConfig({ tlsInsecureSkipVerify: true }),
    /skipTlsVerify is not supported/,
  );
  assert.throws(
    () => _test.assertSupportedTlsConfig({ insecureSkipVerify: true }),
    /skipTlsVerify is not supported/,
  );
  const multipart = _test.buildMultipartBody(
    { scan_type: 'ZAP Scan', active: 'true', empty: '' },
    { name: 'zap.xml', content: '<xml />', contentType: 'application/xml' },
  );
  assert.match(multipart.boundary, /^----OctoBusDefectDojo/);
  assert.match(multipart.body, /name="scan_type"\r\n\r\nZAP Scan\r\n/);
  assert.match(multipart.body, /name="active"\r\n\r\ntrue\r\n/);
  assert.doesNotMatch(multipart.body, /name="empty"/);
  assert.match(multipart.body, /name="file"; filename="zap.xml"/);
  assert.match(multipart.body, /Content-Type: application\/xml\r\n\r\n<xml \/>/);
  assert.deepEqual(_test.toValue(['x', null]), { listValue: { values: [{ stringValue: 'x' }, { nullValue: 'NULL_VALUE' }] } });
  assert.deepEqual(_test.toValue({ missing: undefined, count: Number.NaN }), {
    structValue: {
      fields: {
        missing: { nullValue: 'NULL_VALUE' },
        count: { stringValue: 'NaN' },
      },
    },
  });
  assert.deepEqual(_test.toValue(Symbol.for('dojo')), { stringValue: 'Symbol(dojo)' });
  assert.equal(_test.mapHttpStatusToGrpcCode(401), 'PERMISSION_DENIED');
  assert.equal(_test.mapHttpStatusToGrpcCode(418), 'FAILED_PRECONDITION');
  assert.equal(_test.mapHttpStatusToGrpcCode(503), 'UNAVAILABLE');
  assert.equal(_test.mapHttpStatusToGrpcCode(302), 'UNAVAILABLE');
  assert.equal(_test.grpcCodeFor('NOPE'), grpcStatus.UNKNOWN);
  assert.equal(_test.errorWithCode('NOPE', null).message, '');
  assert.equal(_test.firstDefined(undefined, null, 0, 'x'), 0);
  assert.equal(_test.hasOwn(null, 'x'), false);
  assert.deepEqual(_test.resolveHandlerArgs({ request: { limit: 1 }, config: {} }), {
    req: { limit: 1 },
    ctx: { request: { limit: 1 }, config: {} },
  });
  assert.deepEqual(_test.resolveHandlerArgs({ limit: 2 }), { req: { limit: 2 }, ctx: {} });
  assert.deepEqual(_test.resolveHandlerArgs(null, null), { req: {}, ctx: {} });
  assert.deepEqual(_test.resolveCallContext({ request: { id: 1 }, limits: null }), {
    request: { id: 1 },
    limits: {},
    bindings: {},
    meta: {},
    req: { id: 1 },
  });
  assert.equal(_test.resolveBaseUrl({ restBaseUrl: 'https://dojo.example/' }), 'https://dojo.example');
  assert.equal(_test.resolveApiKey({ apiKey: 'api-key' }), 'api-key');
  assert.equal(_test.resolveApiKey({ token: 'token-key' }), 'token-key');
  assert.equal(_test.resolveTimeoutMs({ bindings: { timeoutMs: -1 }, limits: {} }), 1500);
  assert.deepEqual(_test.commonPagingQuery({ limit: 0, offset: -1 }), { limit: undefined, offset: undefined });
  assert.deepEqual(_test.parseListResponse({ httpStatus: 200, rawBody: '{}' }), {
    http_status: 200,
    raw_body: '',
    count: 0,
    next: '',
    previous: '',
    results: [],
    raw_json: undefined,
  });
  assert.throws(
    () => _test.parseDefectDojoResponse({ httpStatus: 500, rawBody: 'upstream-secret-body' }),
    (error) => /"raw_body":""/.test(error.message) && /"raw_body_length":20/.test(error.message) && !/upstream-secret-body/.test(error.message),
  );
  assert.throws(
    () => _test.throwStructuredError('UNAVAILABLE', 'failed', { httpStatus: 500, rawBody: 'secret-body' }),
    (error) => /"raw_body":""/.test(error.message) && /"raw_body_length":11/.test(error.message) && !/secret-body/.test(error.message),
  );
  assert.deepEqual(_test.buildRequestHeaders(buildCtx().bindings ? buildCtx() : {}), {
    Accept: 'application/json',
    'X-Test': 'yes',
    Authorization: 'Token secret-token',
  });
});

test('ListProducts forwards filters and maps paginated response', async () => {
  let captured;
  setFetch(async (url, init) => {
    captured = { url, init };
    return {
      status: 200,
      text: async () => JSON.stringify({
        count: 1,
        next: null,
        previous: null,
        results: [{ id: 1, name: 'demo-product' }],
      }),
    };
  });

  const handler = await loadHandler(listProductsPath, {
    limit: { value: 50 },
    offset: { value: 10 },
    name_contains: 'demo',
  });
  const res = await handler();

  assert.equal(captured.url, 'http://localhost:8080/api/v2/products/?limit=50&offset=10&name__icontains=demo');
  assert.equal(captured.init.method, 'GET');
  assert.equal(captured.init.headers.Authorization, 'Token secret-token');
  assert.equal(captured.init.headers['X-Test'], 'yes');
  assert.equal(Object.hasOwn(captured.init, 'timeoutMs'), false);
  assert.equal(Object.hasOwn(captured.init, 'skipTlsVerify'), false);
  assert.equal(Object.hasOwn(captured.init, 'insecureSkipVerify'), false);
  assert.ok(captured.init.signal instanceof AbortSignal);
  assert.equal(res.count, 1);
  assert.equal(res.results[0].structValue.fields.name.stringValue, 'demo-product');
});

test('sdk handlers accept single call context with request, config, and secret', async () => {
  const { handlers } = await import('../src/defectdojo.js');
  let captured;
  setFetch(async (url, init) => {
    captured = { url, init };
    return {
      status: 200,
      text: async () => JSON.stringify({
        count: 1,
        results: [{ id: 1, name: 'sdk-product' }],
      }),
    };
  });

  const res = await handlers['DefectDojo.DefectDojo/ListProducts']({
    request: { limit: { value: 1 } },
    config: { defectdojo_base_url: 'http://localhost:8080' },
    secret: { defectdojo_api_key: 'sdk-token' },
  });

  assert.equal(captured.url, 'http://localhost:8080/api/v2/products/?limit=1');
  assert.equal(captured.init.headers.Authorization, 'Token sdk-token');
  assert.equal(res.results[0].structValue.fields.name.stringValue, 'sdk-product');
});

test('sdk handlers still accept legacy request and context arguments', async () => {
  const { handlers } = await import('../src/defectdojo.js');
  let capturedUrl;
  setFetch(async (url) => {
    capturedUrl = url;
    return {
      status: 200,
      text: async () => JSON.stringify({ count: 0, results: [] }),
    };
  });

  const res = await handlers['DefectDojo.DefectDojo/ListProducts'](
    { name_contains: 'legacy' },
    {
      config: { defectdojo_base_url: 'http://localhost:8080' },
      secret: { defectdojo_api_key: 'legacy-token' },
    },
  );

  assert.equal(capturedUrl, 'http://localhost:8080/api/v2/products/?name__icontains=legacy');
  assert.equal(res.count, 0);
});

test('all sdk handlers accept single call context wrappers', async () => {
  const { handlers } = await import('../src/defectdojo.js');
  const calls = [];
  setFetch(async (url, init) => {
    calls.push({ url, method: init.method });
    return {
      status: 200,
      text: async () => JSON.stringify({ count: 0, results: [], id: 1 }),
    };
  });
  const ctx = (request) => ({
    request,
    config: { defectdojo_base_url: 'http://localhost:8080' },
    secret: { defectdojo_api_key: 'sdk-token' },
  });

  await handlers['DefectDojo.DefectDojo/ListEngagements'](ctx({ product: 1 }));
  await handlers['DefectDojo.DefectDojo/ListFindings'](ctx({ active: true }));
  await handlers['DefectDojo.DefectDojo/GetFinding'](ctx({ id: 1 }));
  await handlers['DefectDojo.DefectDojo/ImportScan'](ctx({
    scan_type: 'Generic Findings Import',
    file_name: 'findings.json',
    file_content: '{}',
  }));
  await handlers['DefectDojo.DefectDojo/ReimportScan'](ctx({
    scan_type: 'Generic Findings Import',
    test: 1,
    file_name: 'findings.json',
    file_content: '{}',
  }));

  assert.deepEqual(calls.map((call) => call.method), ['GET', 'GET', 'GET', 'POST', 'POST']);
});

test('ListEngagements forwards product and status filters', async () => {
  let capturedUrl;
  setFetch(async (url) => {
    capturedUrl = url;
    return {
      status: 200,
      text: async () => JSON.stringify({ count: 0, results: [] }),
    };
  });

  const handler = await loadHandler(listEngagementsPath, {
    product: { value: 3 },
    status: 'In Progress',
    name: 'Q2 scan',
  });
  const res = await handler();

  assert.equal(capturedUrl, 'http://localhost:8080/api/v2/engagements/?product=3&name=Q2%20scan&status=In%20Progress');
  assert.equal(res.count, 0);
});

test('ListFindings forwards finding filters and accepts array response variants', async () => {
  let capturedUrl;
  setFetch(async (url) => {
    capturedUrl = url;
    return {
      status: 200,
      text: async () => JSON.stringify([{ id: 7, title: 'SQL Injection' }]),
    };
  });

  const handler = await loadHandler(listFindingsPath, {
    product: 1,
    engagement: 2,
    test: 3,
    severity: 'High',
    active: { value: true },
    verified: false,
    duplicate: '0',
    title_contains: 'SQL',
  });
  const res = await handler();

  assert.equal(capturedUrl, 'http://localhost:8080/api/v2/findings/?product=1&engagement=2&test=3&severity=High&active=true&verified=false&duplicate=false&title__icontains=SQL');
  assert.equal(res.count, 1);
  assert.equal(res.results[0].structValue.fields.title.stringValue, 'SQL Injection');
});

test('GetFinding validates id and returns object response', async () => {
  const badHandler = await loadHandler(getFindingPath, { id: 0 });
  await assert.rejects(() => badHandler(), /id must be a positive integer/);

  let capturedUrl;
  setFetch(async (url) => {
    capturedUrl = url;
    return {
      status: 200,
      text: async () => JSON.stringify({ id: 9, title: 'XSS' }),
    };
  });

  const handler = await loadHandler(getFindingPath, { id: 9 });
  const res = await handler();

  assert.equal(capturedUrl, 'http://localhost:8080/api/v2/findings/9/');
  assert.equal(res.raw_json, undefined);
});

test('ImportScan sends multipart report upload', async () => {
  let captured;
  setFetch(async (url, init) => {
    captured = { url, init };
    return {
      status: 201,
      text: async () => JSON.stringify({ test: 10, engagement: 3, findings_count: 2 }),
    };
  });

  const handler = await loadHandler(importScanPath, {
    scan_type: 'ZAP Scan',
    minimum_severity: 'Info',
    active: true,
    verified: { value: true },
    engagement: 3,
    test_title: 'OctoBus import',
    close_old_findings: false,
    background_import: false,
    file_name: 'zap.xml',
    file_content: '<OWASPZAPReport></OWASPZAPReport>',
    file_content_type: 'application/xml',
  });
  const res = await handler();

  assert.equal(captured.url, 'http://localhost:8080/api/v2/import-scan/');
  assert.equal(captured.init.method, 'POST');
  assert.equal(captured.init.headers.Authorization, 'Token secret-token');
  assert.match(captured.init.headers['content-type'], /^multipart\/form-data; boundary=----OctoBusDefectDojo/);
  assert.match(captured.init.body, /name="scan_type"\r\n\r\nZAP Scan\r\n/);
  assert.match(captured.init.body, /name="engagement"\r\n\r\n3\r\n/);
  assert.match(captured.init.body, /name="close_old_findings"\r\n\r\nfalse\r\n/);
  assert.match(captured.init.body, /name="file"; filename="zap.xml"/);
  assert.match(captured.init.body, /<OWASPZAPReport><\/OWASPZAPReport>/);
  assert.equal(res.raw_json, undefined);
});

test('ReimportScan sends multipart report upload with test selector', async () => {
  let captured;
  setFetch(async (url, init) => {
    captured = { url, init };
    return {
      status: 200,
      text: async () => JSON.stringify({ test: 11, findings_count: 1 }),
    };
  });

  const handler = await loadHandler(reimportScanPath, {
    scan_type: 'Generic Findings Import',
    minimum_severity: 'Low',
    active: true,
    verified: true,
    test: { value: 11 },
    do_not_reactivate: false,
    file_name: 'generic.json',
    file_content: '{"findings":[]}',
    file_content_type: 'application/json',
  });
  const res = await handler();

  assert.equal(captured.url, 'http://localhost:8080/api/v2/reimport-scan/');
  assert.equal(captured.init.method, 'POST');
  assert.match(captured.init.body, /name="test"\r\n\r\n11\r\n/);
  assert.match(captured.init.body, /name="do_not_reactivate"\r\n\r\nfalse\r\n/);
  assert.match(captured.init.body, /name="file"; filename="generic.json"/);
  assert.equal(res.raw_json, undefined);
});

test('ImportScan and ReimportScan validate required fields before downstream call', async () => {
  const noScanType = await loadHandler(importScanPath, {
    file_name: 'zap.xml',
    file_content: '<xml />',
  });
  await assert.rejects(() => noScanType(), /scan_type is required/);

  const noFileName = await loadHandler(importScanPath, {
    scan_type: 'ZAP Scan',
    file_content: '<xml />',
  });
  await assert.rejects(() => noFileName(), /file_name is required/);

  const noFileContent = await loadHandler(reimportScanPath, {
    scan_type: 'ZAP Scan',
    file_name: 'zap.xml',
  });
  await assert.rejects(() => noFileContent(), /file_content is required/);
});

test('errors cover missing configuration, upstream failures, HTTP errors, and invalid JSON', async () => {
  const { rpcdef } = await import('../src/defectdojo.js');
  const noBaseUrl = rpcdef({
    config: {},
    secret: { defectdojo_api_key: 'secret-token' },
  })[listProductsPath];
  await assert.rejects(() => noBaseUrl(), /defectdojo_base_url is required/);

  const noApiKey = rpcdef({
    config: { defectdojo_base_url: 'http://localhost:8080' },
    secret: {},
  })[listProductsPath];
  await assert.rejects(() => noApiKey(), /defectdojo_api_key is required/);

  setFetch(async () => {
    throw new Error('connect failed');
  });
  const unavailable = await loadHandler(listProductsPath, {});
  await assert.rejects(() => unavailable(), /defectdojo upstream request failed/);

  setFetch(async () => ({
    status: 403,
    text: async () => JSON.stringify({ detail: 'forbidden' }),
  }));
  const forbidden = await loadHandler(listProductsPath, {});
  await assert.rejects(() => forbidden(), /PERMISSION_DENIED|defectdojo upstream http failure/);

  setFetch(async () => ({
    status: 200,
    text: async () => 'not-json',
  }));
  const invalidJson = await loadHandler(listProductsPath, {});
  await assert.rejects(() => invalidJson(), /response is not valid JSON/);

  const invalidTls = await loadHandler(listProductsPath, {}, { bindings: { skipTlsVerify: true } });
  await assert.rejects(() => invalidTls(), /skipTlsVerify is not supported/);

  setFetch(async () => ({
    status: 200,
    text: async () => {
      throw new Error('read failed with secret-token');
    },
  }));
  const getReadFailure = await loadHandler(listProductsPath, {});
  await assert.rejects(
    () => getReadFailure(),
    (error) => /defectdojo upstream response read failed/.test(error.message) && !/"raw_body":"secret-token"/.test(error.message),
  );
});

test('multipart errors cover network and response read failures without raw body leaks', async () => {
  setFetch(async () => {
    throw Object.assign(new Error('connect failed with secret-token'), { cause: new Error('socket closed') });
  });
  const networkFailure = await loadHandler(importScanPath, {
    scan_type: 'Generic Findings Import',
    file_name: 'findings.json',
    file_content: '{}',
  });
  await assert.rejects(
    () => networkFailure(),
    (error) => /defectdojo upstream request failed/.test(error.message) && !/secret-token/.test(error.message),
  );

  setFetch(async () => ({
    status: 200,
    text: async () => {
      throw new Error('read failed with secret-token');
    },
  }));
  const readFailure = await loadHandler(reimportScanPath, {
    scan_type: 'Generic Findings Import',
    file_name: 'findings.json',
    file_content: '{}',
  });
  await assert.rejects(
    () => readFailure(),
    (error) => /defectdojo upstream response read failed/.test(error.message) && !/"raw_body":"secret-token"/.test(error.message),
  );
});

test('applies upstream timeout through AbortController', async () => {
  setFetch(async (url, init) => new Promise((resolve, reject) => {
    assert.ok(init.signal instanceof AbortSignal);
    init.signal.addEventListener('abort', () => reject(new Error('aborted by test timeout')), { once: true });
  }));

  const handler = await loadHandler(listProductsPath, {}, { limits: { timeoutMs: 1 } });
  await assert.rejects(() => handler(), /defectdojo upstream request failed/);
});

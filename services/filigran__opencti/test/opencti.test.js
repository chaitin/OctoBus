import test from 'node:test';
import assert from 'node:assert/strict';

const searchIndicatorsPath = '/Filigran_OPENCTI.Filigran_OPENCTI/SearchIndicators';
const searchObservablesPath = '/Filigran_OPENCTI.Filigran_OPENCTI/SearchObservables';
const searchReportsPath = '/Filigran_OPENCTI.Filigran_OPENCTI/SearchReports';
const createIndicatorPath = '/Filigran_OPENCTI.Filigran_OPENCTI/CreateIndicator';
const createObservablePath = '/Filigran_OPENCTI.Filigran_OPENCTI/CreateObservable';
const createReportPath = '/Filigran_OPENCTI.Filigran_OPENCTI/CreateReport';

const buildCtx = (req = {}, overrides = {}) => ({
  bindings: {
    endpoint: 'http://opencti.example.com:8080',
    api_token: 'test-api-token',
    ...overrides.bindings,
  },
  limits: { timeoutMs: 30000, ...overrides.limits },
  meta: { instance_id: 'inst', request_id: 'req', ...overrides.meta },
  req,
});

const setFetch = (impl) => { global.fetch = impl; };

const mockGraphQL = (data, status = 200) => {
  setFetch(async () => ({
    ok: status >= 200 && status < 300,
    status,
    headers: new Map([['content-type', 'application/json']]),
    text: async () => JSON.stringify({ data }),
  }));
};

const mockGraphQLError = (errors, status = 200) => {
  setFetch(async () => ({
    ok: status >= 200 && status < 300,
    status,
    headers: new Map([['content-type', 'application/json']]),
    text: async () => JSON.stringify({ errors }),
  }));
};

const mockHttpError = (status, body = 'Error') => {
  setFetch(async () => ({
    ok: status >= 200 && status < 300,
    status,
    headers: new Map(),
    text: async () => body,
  }));
};

// ── Internal helpers ──────────────────────────────────────

test('internal helpers work correctly', async () => {
  const { _test } = await import('../src/opencti.js');

  assert.equal(_test.toTrimmedString(undefined), '');
  assert.equal(_test.toTrimmedString({ value: ' test ' }), 'test');
  assert.equal(_test.toInt64(null), null);
  assert.equal(_test.toInt64({ value: 42 }), 42);
  assert.equal(_test.toBoolean(true), true);
  assert.equal(_test.toBoolean('true'), true);
  assert.equal(_test.firstDefined(undefined, 'a'), 'a');
});

// ── Credential resolution ─────────────────────────────────

test('resolveCredentials validates api_token', async () => {
  const { _test } = await import('../src/opencti.js');
  const c1 = _test.resolveCredentials({ api_token: 'token1' });
  assert.equal(c1.apiToken, 'token1');
  const c2 = _test.resolveCredentials({ apiToken: 'token2' });
  assert.equal(c2.apiToken, 'token2');
  assert.throws(() => _test.resolveCredentials({}), /api_token/);
});

test('resolveEndpoint validates endpoint', async () => {
  const { _test } = await import('../src/opencti.js');
  assert.equal(_test.resolveEndpoint({ endpoint: 'http://opencti.local:8080' }), 'http://opencti.local:8080');
  assert.equal(_test.resolveEndpoint({ endpoint: 'http://opencti.local:8080/' }), 'http://opencti.local:8080');
  assert.throws(() => _test.resolveEndpoint({}), /endpoint/);
});

// ── Observable type mapping ────────────────────────────────

test('OBSERVABLE_TYPE_FIELDS maps known types', async () => {
  const { _test } = await import('../src/opencti.js');
  assert.equal(_test.OBSERVABLE_TYPE_FIELDS['IPv4-Addr'], 'IPv4Addr');
  assert.equal(_test.OBSERVABLE_TYPE_FIELDS['Domain-Name'], 'DomainName');
  assert.equal(_test.OBSERVABLE_TYPE_FIELDS['Url'], 'Url');
  assert.equal(_test.OBSERVABLE_TYPE_FIELDS['File'], 'File');
  assert.equal(_test.OBSERVABLE_TYPE_FIELDS['Hostname'], 'Hostname');
});

// ── SearchIndicators ──────────────────────────────────────

test('SearchIndicators sends correct GraphQL query', async () => {
  let capturedBody;
  setFetch(async (url, init) => {
    capturedBody = JSON.parse(init.body);
    return {
      ok: true, status: 200,
      headers: new Map([['content-type', 'application/json']]),
      text: async () => JSON.stringify({ data: {
        indicators: {
          edges: [{ node: { id: '1', standard_id: 'indicator--abc', name: 'test-IOC', pattern_type: 'stix', pattern: "[ipv4-addr:value = '1.2.3.4']", valid_from: '2026-06-27T00:00:00Z', valid_until: '', indicator_types: ['malicious-activity'], description: '', x_opencti_score: '50' } }],
          pageInfo: { globalCount: 1, hasNextPage: false },
        },
      }}),
    };
  });

  const { rpcdef } = await import('../src/opencti.js');
  const ctx = buildCtx({ search: '1.2.3.4', first: { value: 10 } });
  const res = await rpcdef(ctx)[searchIndicatorsPath]();

  assert.ok(capturedBody.query.includes('indicators'));
  assert.ok(capturedBody.query.includes('search: "1.2.3.4"'));
  assert.equal(res.items.length, 1);
  assert.equal(res.items[0].name, 'test-IOC');
  assert.equal(res.total, 1);
  assert.equal(res.has_next_page, false);
});

test('SearchIndicators with indicator_types filter', async () => {
  let capturedBody;
  setFetch(async (url, init) => {
    capturedBody = JSON.parse(init.body);
    return {
      ok: true, status: 200,
      headers: new Map([['content-type', 'application/json']]),
      text: async () => JSON.stringify({ data: { indicators: { edges: [], pageInfo: { globalCount: 0, hasNextPage: false } } }}),
    };
  });

  const { rpcdef } = await import('../src/opencti.js');
  const ctx = buildCtx({ indicator_types: ['malicious-activity'], first: { value: 20 } });
  await rpcdef(ctx)[searchIndicatorsPath]();

  assert.ok(capturedBody.query.includes('indicator_types'));
  assert.ok(capturedBody.query.includes('"malicious-activity"'));
});

test('SearchIndicators with cursor pagination', async () => {
  let capturedBody;
  setFetch(async (url, init) => {
    capturedBody = JSON.parse(init.body);
    return {
      ok: true, status: 200,
      headers: new Map([['content-type', 'application/json']]),
      text: async () => JSON.stringify({ data: { indicators: { edges: [], pageInfo: { globalCount: 100, hasNextPage: true } } }}),
    };
  });

  const { rpcdef } = await import('../src/opencti.js');
  const ctx = buildCtx({ cursor: 'WyJpbmRpY2F0b3ItLTE2Yzk5YTA0Il0' });
  const res = await rpcdef(ctx)[searchIndicatorsPath]();

  assert.ok(capturedBody.query.includes('after:'));
  assert.equal(res.has_next_page, true);
});

test('SearchIndicators handles empty response', async () => {
  mockGraphQL({ indicators: { edges: [], pageInfo: { globalCount: 0, hasNextPage: false } } });
  const { rpcdef } = await import('../src/opencti.js');
  const ctx = buildCtx({});
  const res = await rpcdef(ctx)[searchIndicatorsPath]();
  assert.deepEqual(res.items, []);
  assert.equal(res.total, 0);
});

// ── SearchObservables ─────────────────────────────────────

test('SearchObservables sends correct GraphQL query', async () => {
  let capturedBody;
  setFetch(async (url, init) => {
    capturedBody = JSON.parse(init.body);
    return {
      ok: true, status: 200,
      headers: new Map([['content-type', 'application/json']]),
      text: async () => JSON.stringify({ data: {
        stixCyberObservables: {
          edges: [{ node: { id: '2', standard_id: 'ipv4-addr--abc', entity_type: 'IPv4-Addr', observable_value: '192.168.1.1' } }],
          pageInfo: { globalCount: 1, hasNextPage: false },
        },
      }}),
    };
  });

  const { rpcdef } = await import('../src/opencti.js');
  const ctx = buildCtx({ search: '192.168', first: { value: 10 } });
  const res = await rpcdef(ctx)[searchObservablesPath]();

  assert.ok(capturedBody.query.includes('stixCyberObservables'));
  assert.equal(res.items[0].observable_value, '192.168.1.1');
});

test('SearchObservables with entity_types filter', async () => {
  let capturedBody;
  setFetch(async (url, init) => {
    capturedBody = JSON.parse(init.body);
    return {
      ok: true, status: 200,
      headers: new Map([['content-type', 'application/json']]),
      text: async () => JSON.stringify({ data: { stixCyberObservables: { edges: [], pageInfo: { globalCount: 0, hasNextPage: false } } }}),
    };
  });

  const { rpcdef } = await import('../src/opencti.js');
  const ctx = buildCtx({ entity_types: ['IPv4-Addr', 'Domain-Name'] });
  await rpcdef(ctx)[searchObservablesPath]();

  assert.ok(capturedBody.query.includes('entity_type'));
});

// ── SearchReports ─────────────────────────────────────────

test('SearchReports sends correct GraphQL query', async () => {
  let capturedBody;
  setFetch(async (url, init) => {
    capturedBody = JSON.parse(init.body);
    return {
      ok: true, status: 200,
      headers: new Map([['content-type', 'application/json']]),
      text: async () => JSON.stringify({ data: {
        reports: {
          edges: [{ node: { id: '3', standard_id: 'report--abc', name: 'Threat Report', description: 'desc', published: '2026-06-27T00:00:00Z', report_types: ['threat-report'] } }],
          pageInfo: { globalCount: 1, hasNextPage: false },
        },
      }}),
    };
  });

  const { rpcdef } = await import('../src/opencti.js');
  const ctx = buildCtx({ search: 'threat', first: { value: 5 } });
  const res = await rpcdef(ctx)[searchReportsPath]();

  assert.ok(capturedBody.query.includes('reports'));
  assert.equal(res.items[0].name, 'Threat Report');
  assert.deepEqual(res.items[0].report_types, ['threat-report']);
});

// ── CreateIndicator ───────────────────────────────────────

test('CreateIndicator requires name, pattern_type, pattern, indicator_types', async () => {
  const { rpcdef } = await import('../src/opencti.js');

  // Empty req - name is required
  await assert.rejects(() => rpcdef(buildCtx())[createIndicatorPath](), /INVALID_ARGUMENT.*name/);

  // Only name - pattern_type required
  await assert.rejects(() => rpcdef(buildCtx({ name: 'test' }))[createIndicatorPath](), /INVALID_ARGUMENT.*pattern_type/);

  // Only name + pattern_type - pattern required
  await assert.rejects(() => rpcdef(buildCtx({ name: 'test', pattern_type: 'stix' }))[createIndicatorPath](), /INVALID_ARGUMENT.*pattern/);

  // Missing indicator_types
  await assert.rejects(() => rpcdef(buildCtx({ name: 'test', pattern_type: 'stix', pattern: "[ipv4-addr:value = '1.2.3.4']" }))[createIndicatorPath](), /INVALID_ARGUMENT.*indicator_types/);
});

test('CreateIndicator sends correct mutation', async () => {
  let capturedBody;
  setFetch(async (url, init) => {
    capturedBody = JSON.parse(init.body);
    return {
      ok: true, status: 200,
      headers: new Map([['content-type', 'application/json']]),
      text: async () => JSON.stringify({ data: {
        indicatorAdd: { id: '10', standard_id: 'indicator--xyz', name: 'Test-IOC', pattern_type: 'stix', pattern: "[ipv4-addr:value = '1.2.3.4']", valid_from: '2026-06-27T00:00:00Z', valid_until: '', indicator_types: ['malicious-activity'], description: '', x_opencti_score: '50' },
      }}),
    };
  });

  const { rpcdef } = await import('../src/opencti.js');
  const ctx = buildCtx({
    name: 'Test-IOC',
    pattern_type: 'stix',
    pattern: "[ipv4-addr:value = '1.2.3.4']",
    valid_from: '2026-06-27T00:00:00Z',
    indicator_types: ['malicious-activity'],
    score: { value: 50 },
  });
  const res = await rpcdef(ctx)[createIndicatorPath]();

  assert.ok(capturedBody.query.includes('indicatorAdd'));
  assert.ok(capturedBody.query.includes('name: "Test-IOC"'));
  assert.equal(res.indicator.name, 'Test-IOC');
  assert.deepEqual(res.indicator.indicator_types, ['malicious-activity']);
});

test('CreateIndicator with description and score', async () => {
  let capturedBody;
  setFetch(async (url, init) => {
    capturedBody = JSON.parse(init.body);
    return {
      ok: true, status: 200,
      headers: new Map([['content-type', 'application/json']]),
      text: async () => JSON.stringify({ data: {
        indicatorAdd: { id: '11', standard_id: 'indicator--def', name: 'IOC-002', pattern_type: 'stix', pattern: 'p', valid_from: '2026-06-27T00:00:00Z', indicator_types: ['anomaly'], description: 'test desc', x_opencti_score: '80' },
      }}),
    };
  });

  const { rpcdef } = await import('../src/opencti.js');
  const ctx = buildCtx({
    name: 'IOC-002', pattern_type: 'stix', pattern: 'p',
    valid_from: '2026-06-27T00:00:00Z', indicator_types: ['anomaly'],
    description: 'test desc', score: { value: 80 },
  });
  await rpcdef(ctx)[createIndicatorPath]();

  assert.ok(capturedBody.query.includes('description: "test desc"'));
  assert.ok(capturedBody.query.includes('x_opencti_score: 80'));
});

// ── CreateObservable ──────────────────────────────────────

test('CreateObservable requires type and value', async () => {
  const { rpcdef } = await import('../src/opencti.js');
  await assert.rejects(() => rpcdef(buildCtx())[createObservablePath](), /INVALID_ARGUMENT.*type/);
  await assert.rejects(() => rpcdef(buildCtx({ type: 'IPv4-Addr' }))[createObservablePath](), /INVALID_ARGUMENT.*value/);
});

test('CreateObservable rejects unsupported type', async () => {
  const { rpcdef } = await import('../src/opencti.js');
  await assert.rejects(() => rpcdef(buildCtx({ type: 'Unknown-Type', value: 'test' }))[createObservablePath](), /unsupported observable type/);
});

test('CreateObservable sends correct mutation for IPv4', async () => {
  let capturedBody;
  setFetch(async (url, init) => {
    capturedBody = JSON.parse(init.body);
    return {
      ok: true, status: 200,
      headers: new Map([['content-type', 'application/json']]),
      text: async () => JSON.stringify({ data: {
        stixCyberObservableAdd: { id: '20', standard_id: 'ipv4-addr--abc', entity_type: 'IPv4-Addr', observable_value: '192.168.1.100' },
      }}),
    };
  });

  const { rpcdef } = await import('../src/opencti.js');
  const ctx = buildCtx({ type: 'IPv4-Addr', value: '192.168.1.100' });
  const res = await rpcdef(ctx)[createObservablePath]();

  assert.ok(capturedBody.query.includes('stixCyberObservableAdd'));
  assert.ok(capturedBody.query.includes('type: "IPv4-Addr"'));
  assert.ok(capturedBody.query.includes('IPv4Addr'));
  assert.equal(res.observable.observable_value, '192.168.1.100');
});

test('CreateObservable sends correct mutation for Domain-Name', async () => {
  let capturedBody;
  setFetch(async (url, init) => {
    capturedBody = JSON.parse(init.body);
    return {
      ok: true, status: 200,
      headers: new Map([['content-type', 'application/json']]),
      text: async () => JSON.stringify({ data: {
        stixCyberObservableAdd: { id: '21', entity_type: 'Domain-Name', observable_value: 'evil.example.com' },
      }}),
    };
  });

  const { rpcdef } = await import('../src/opencti.js');
  const ctx = buildCtx({ type: 'Domain-Name', value: 'evil.example.com' });
  await rpcdef(ctx)[createObservablePath]();

  assert.ok(capturedBody.query.includes('DomainName'));
});

// ── CreateReport ──────────────────────────────────────────

test('CreateReport requires name and published', async () => {
  const { rpcdef } = await import('../src/opencti.js');
  await assert.rejects(() => rpcdef(buildCtx())[createReportPath](), /INVALID_ARGUMENT.*name/);
  await assert.rejects(() => rpcdef(buildCtx({ name: 'Report' }))[createReportPath](), /INVALID_ARGUMENT.*published/);
});

test('CreateReport sends correct mutation', async () => {
  let capturedBody;
  setFetch(async (url, init) => {
    capturedBody = JSON.parse(init.body);
    return {
      ok: true, status: 200,
      headers: new Map([['content-type', 'application/json']]),
      text: async () => JSON.stringify({ data: {
        reportAdd: { id: '30', standard_id: 'report--abc', name: 'Threat Report', description: 'A threat report', published: '2026-06-27T00:00:00Z', report_types: ['threat-report'] },
      }}),
    };
  });

  const { rpcdef } = await import('../src/opencti.js');
  const ctx = buildCtx({
    name: 'Threat Report',
    published: '2026-06-27T00:00:00Z',
    description: 'A threat report',
    report_types: ['threat-report'],
  });
  const res = await rpcdef(ctx)[createReportPath]();

  assert.ok(capturedBody.query.includes('reportAdd'));
  assert.equal(res.report.name, 'Threat Report');
  assert.deepEqual(res.report.report_types, ['threat-report']);
});

// ── Error mapping ─────────────────────────────────────────

test('HTTP 401 mapped to UNAUTHENTICATED', async () => {
  mockHttpError(401, 'Unauthorized');
  const { rpcdef } = await import('../src/opencti.js');
  await assert.rejects(() => rpcdef(buildCtx())[searchIndicatorsPath](), /UNAUTHENTICATED/);
});

test('HTTP 403 mapped to PERMISSION_DENIED', async () => {
  mockHttpError(403, 'Forbidden');
  const { rpcdef } = await import('../src/opencti.js');
  await assert.rejects(() => rpcdef(buildCtx())[searchIndicatorsPath](), /PERMISSION_DENIED/);
});

test('HTTP 500 mapped to UNAVAILABLE', async () => {
  mockHttpError(500, 'Internal Error');
  const { rpcdef } = await import('../src/opencti.js');
  await assert.rejects(() => rpcdef(buildCtx())[searchIndicatorsPath](), /UNAVAILABLE/);
});

test('Network error mapped to UNAVAILABLE', async () => {
  setFetch(async () => { throw new Error('connection refused'); });
  const { rpcdef } = await import('../src/opencti.js');
  await assert.rejects(() => rpcdef(buildCtx())[searchIndicatorsPath](), /UNAVAILABLE/);
});

test('Timeout mapped to UNAVAILABLE', async () => {
  setFetch(async () => { const err = new Error('timeout'); err.name = 'TimeoutError'; throw err; });
  const { rpcdef } = await import('../src/opencti.js');
  await assert.rejects(() => rpcdef(buildCtx())[searchIndicatorsPath](), /UNAVAILABLE/);
});

test('OpenCTI GraphQL validation error mapped to INVALID_ARGUMENT', async () => {
  mockGraphQLError([{ message: 'Unknown argument', extensions: { code: 'GRAPHQL_VALIDATION_FAILED' } }]);
  const { rpcdef } = await import('../src/opencti.js');
  await assert.rejects(() => rpcdef(buildCtx())[searchIndicatorsPath](), /INVALID_ARGUMENT/);
});

test('OpenCTI functional error mapped to FAILED_PRECONDITION', async () => {
  mockGraphQLError([{ message: 'Indicator format error', extensions: { code: 'FUNCTIONAL_ERROR' } }]);
  const { rpcdef } = await import('../src/opencti.js');
  // Use a valid search request so it reaches the GraphQL call
  await assert.rejects(() => rpcdef(buildCtx({ search: 'test' }))[searchIndicatorsPath](), /FAILED_PRECONDITION/);
});

test('OpenCTI resource not found mapped to FAILED_PRECONDITION', async () => {
  mockGraphQLError([{ message: 'Not found', extensions: { code: 'RESOURCE_NOT_FOUND' } }]);
  const { rpcdef } = await import('../src/opencti.js');
  await assert.rejects(() => rpcdef(buildCtx())[searchIndicatorsPath](), /FAILED_PRECONDITION/);
});

test('Empty response handled', async () => {
  setFetch(async () => ({ ok: true, status: 200, headers: new Map(), text: async () => '' }));
  const { rpcdef } = await import('../src/opencti.js');
  await assert.rejects(() => rpcdef(buildCtx())[searchIndicatorsPath](), /UNKNOWN: empty response/);
});

test('Non-JSON response handled', async () => {
  setFetch(async () => ({ ok: true, status: 200, headers: new Map(), text: async () => 'not json' }));
  const { rpcdef } = await import('../src/opencti.js');
  await assert.rejects(() => rpcdef(buildCtx())[searchIndicatorsPath](), /UNKNOWN: response is not valid JSON/);
});

// ── SDK handlers ──────────────────────────────────────────

test('SDK handlers accept single-arg (ctx) style from OctoBus SDK', async () => {
  mockGraphQL({
    indicators: {
      edges: [{ node: { id: '1', standard_id: 'indicator--abc', name: 'SDK-IOC', pattern_type: 'stix', pattern: 'p', valid_from: '2026-06-27', indicator_types: ['malicious-activity'] } }],
      pageInfo: { globalCount: 1, hasNextPage: false },
    },
  });

  const { handlers, SEARCH_INDICATORS_FULL } = await import('../src/opencti.js');
  const res = await handlers[SEARCH_INDICATORS_FULL]({
    request: { search: '8.8.8.8' },
    config: { endpoint: 'http://custom.opencti.local:8080' },
    secret: { api_token: 'sdk-token' },
  });
  assert.equal(res.items[0].name, 'SDK-IOC');
});

test('Missing credentials fails gracefully', async () => {
  const { rpcdef } = await import('../src/opencti.js');
  await assert.rejects(() => rpcdef(buildCtx({}, { bindings: { endpoint: 'http://x', api_token: '' } }))[searchIndicatorsPath](), /FAILED_PRECONDITION/);
});

// ── Review fix verification ──────────────────────────────────

test('gqlEscape escapes backslashes before quotes to prevent injection', async () => {
  const { _test } = await import('../src/opencti.js');
  // Backslash must be escaped first to avoid creating invalid escape sequences
  assert.equal(_test.gqlEscape('abc\\def'), 'abc\\\\def');
  assert.equal(_test.gqlEscape('path"C:\\Users"'), 'path\\"C:\\\\Users\\"');
  assert.equal(_test.gqlEscape('simple"quote'), 'simple\\"quote');
  assert.equal(_test.gqlEscape('both\\"chars'), 'both\\\\\\"chars');
});

test('mapIndicator maps x_opencti_score to proto field "score" (not "x_opencti_score")', async () => {
  const { _test } = await import('../src/opencti.js');
  const node = {
    id: '1', standard_id: 'indicator--test', name: 'test-IOC',
    pattern_type: 'stix', pattern: 'p', valid_from: '', valid_until: '',
    indicator_types: [], description: '', x_opencti_score: '75',
  };
  const mapped = _test.mapIndicator(node);
  assert.equal(mapped.score, '75');                    // proto field "score"
  assert.equal(mapped.x_opencti_score, undefined);    // NOT mapped as x_opencti_score
});

test('CreateObservable for File type auto-detects hash algorithm by hex length', async () => {
  let capturedBody;

  // MD5 = 32 hex chars
  setFetch(async (url, init) => {
    capturedBody = JSON.parse(init.body);
    return {
      ok: true, status: 200,
      headers: new Map([['content-type', 'application/json']]),
      text: async () => JSON.stringify({ data: {
        stixCyberObservableAdd: { id: 'f1', entity_type: 'File', observable_value: 'd41d8cd98f00b204e9800998ecf8427e' },
      }}),
    };
  });
  const { rpcdef } = await import('../src/opencti.js');
  await rpcdef(buildCtx({ type: 'File', value: 'd41d8cd98f00b204e9800998ecf8427e' }))[createObservablePath]();
  assert.ok(capturedBody.query.includes('MD5'), '32 hex chars should map to MD5');
  assert.ok(!capturedBody.query.includes('SHA256'), 'MD5 should NOT also set SHA256');

  // SHA1 = 40 hex chars
  setFetch(async (url, init) => {
    capturedBody = JSON.parse(init.body);
    return {
      ok: true, status: 200,
      headers: new Map([['content-type', 'application/json']]),
      text: async () => JSON.stringify({ data: {
        stixCyberObservableAdd: { id: 'f2', entity_type: 'File', observable_value: 'da39a3ee5e6b4b0d3255bfef95601890afd80709' },
      }}),
    };
  });
  const { rpcdef: rpcdef2 } = await import('../src/opencti.js');
  await rpcdef2(buildCtx({ type: 'File', value: 'da39a3ee5e6b4b0d3255bfef95601890afd80709' }))[createObservablePath]();
  assert.ok(capturedBody.query.includes('SHA1'), '40 hex chars should map to SHA1');

  // SHA256 = 64 hex chars
  setFetch(async (url, init) => {
    capturedBody = JSON.parse(init.body);
    return {
      ok: true, status: 200,
      headers: new Map([['content-type', 'application/json']]),
      text: async () => JSON.stringify({ data: {
        stixCyberObservableAdd: { id: 'f3', entity_type: 'File', observable_value: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' },
      }}),
    };
  });
  const { rpcdef: rpcdef3 } = await import('../src/opencti.js');
  await rpcdef3(buildCtx({ type: 'File', value: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' }))[createObservablePath]();
  assert.ok(capturedBody.query.includes('SHA256'), '64 hex chars should map to SHA256');
  assert.ok(!capturedBody.query.includes('MD5'), 'SHA256 should NOT also set MD5');

  // Non-hash value (filename) — uses simple value field, not hashes
  setFetch(async (url, init) => {
    capturedBody = JSON.parse(init.body);
    return {
      ok: true, status: 200,
      headers: new Map([['content-type', 'application/json']]),
      text: async () => JSON.stringify({ data: {
        stixCyberObservableAdd: { id: 'f4', entity_type: 'File', observable_value: 'malware.exe' },
      }}),
    };
  });
  const { rpcdef: rpcdef4 } = await import('../src/opencti.js');
  await rpcdef4(buildCtx({ type: 'File', value: 'malware.exe' }))[createObservablePath]();
  assert.ok(capturedBody.query.includes('value: "malware.exe"'), 'non-hash should use value field');
  assert.ok(!capturedBody.query.includes('hashes'), 'non-hash should NOT include hashes');
});

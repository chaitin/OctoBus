import test from 'node:test';
import assert from 'node:assert/strict';

const listAlertsPath = '/Wazuh_SIEM.Wazuh_SIEM/ListAlerts';
const getAlertSummaryPath = '/Wazuh_SIEM.Wazuh_SIEM/GetAlertSummary';
const listVulnerabilitiesPath = '/Wazuh_SIEM.Wazuh_SIEM/ListVulnerabilities';
const getVulnerabilitySummaryPath = '/Wazuh_SIEM.Wazuh_SIEM/GetVulnerabilitySummary';
const listAgentsPath = '/Wazuh_SIEM.Wazuh_SIEM/ListAgents';

const buildCtx = (req = {}, overrides = {}) => ({
  bindings: {
    endpoint: 'http://localhost:19000',
    indexerEndpoint: 'http://localhost:19200',
    ...overrides.bindings,
  },
  config: { ...overrides.config },
  secret: { ...overrides.secret },
  limits: { timeoutMs: 10_000, ...overrides.limits },
  meta: { instance_id: 'inst', request_id: 'req', ...overrides.meta },
  req,
});

const setFetch = (impl) => {
  global.fetch = impl;
};

// ─── Mock helpers ────────────────────────────────────────────────

// Mock Indexer API (Basic Auth + OpenSearch responses)
const mockIndexer = (searchHandler) => {
  const calls = { indexer: [] };

  setFetch(async (url, init) => {
    const urlString = typeof url === 'string' ? url : url.toString();

    // Indexer API — Basic Auth check
    calls.indexer.push({ url: urlString, init });

    if (searchHandler) {
      return searchHandler(urlString, init);
    }

    // Default empty OpenSearch response
    return {
      ok: true,
      status: 200,
      headers: new Map([['content-type', 'application/json']]),
      text: async () => JSON.stringify({
        hits: { hits: [], total: { value: 0, relation: 'eq' } },
        aggregations: {},
      }),
    };
  });

  return calls;
};

// Mock Indexer API that fails auth
const mockIndexerAuthFail = (status, body) => {
  setFetch(async (url, init) => ({
    ok: false,
    status,
    headers: new Map([['content-type', 'application/json']]),
    text: async () => body,
  }));
};

// Mock Manager API (JWT auth + Wazuh Manager responses)
const mockWithAuth = (token = 'test-token', apiHandler) => {
  const calls = { auth: [], api: [] };

  setFetch(async (url, init) => {
    const urlString = typeof url === 'string' ? url : url.toString();

    // Authentication endpoint
    if (urlString.includes('/security/user/authenticate')) {
      calls.auth.push({ url: urlString, init });
      return {
        ok: true,
        status: 200,
        headers: new Map([['content-type', 'application/json']]),
        text: async () => JSON.stringify({
          data: { token },
          error: 0,
          message: 'Authentication succeeded',
        }),
      };
    }
    // API endpoint
    calls.api.push({ url: urlString, init });
    if (apiHandler) {
      return apiHandler(urlString, init);
    }
    // Default empty response
    return {
      ok: true,
      status: 200,
      headers: new Map([['content-type', 'application/json']]),
      text: async () => JSON.stringify({
        data: { affected_items: [], total_affected_items: 0 },
        error: 0,
      }),
    };
  });

  return calls;
};

// Sets up a mock fetch that fails authentication with given HTTP status.
const mockAuthFail = (status, body) => {
  setFetch(async (url, init) => {
    const urlString = typeof url === 'string' ? url : url.toString();
    if (urlString.includes('/security/user/authenticate')) {
      return {
        ok: false,
        status,
        headers: new Map([['content-type', 'application/json']]),
        text: async () => body,
      };
    }
    return {
      ok: true,
      status: 200,
      headers: new Map([['content-type', 'application/json']]),
      text: async () => '{}',
    };
  });
};

// Sets up mock that authenticates OK but returns HTTP error for API call.
const mockAuthOkApiFail = (token = 'test-token', apiStatus, apiBody) => {
  setFetch(async (url, init) => {
    const urlString = typeof url === 'string' ? url : url.toString();
    if (urlString.includes('/security/user/authenticate')) {
      return {
        ok: true,
        status: 200,
        headers: new Map([['content-type', 'application/json']]),
        text: async () => JSON.stringify({ data: { token }, error: 0 }),
      };
    }
    return {
      ok: false,
      status: apiStatus,
      headers: new Map([['content-type', 'text/plain']]),
      text: async () => apiBody,
    };
  });
};

const loadHandler = async (methodPath, req, overrides = {}) => {
  const { rpcdef } = await import('../src/wazuh-siem.js');
  const ctx = buildCtx(req, overrides);
  return rpcdef(ctx)[methodPath];
};

// Default context for Manager API (JWT auth)
const defaultManagerSecretCtx = {
  bindings: { endpoint: 'http://localhost:19000' },
  secret: { username: 'wazuh', password: 'wazuh' },
};

// Default context for dual endpoint (Manager + Indexer)
const defaultDualCtx = {
  bindings: { endpoint: 'http://localhost:19000', indexerEndpoint: 'http://localhost:19200' },
  secret: { username: 'wazuh', password: 'wazuh', indexerUsername: 'admin', indexerPassword: 'admin' },
};

// ─── Internal helpers ────────────────────────────────────────

test('internal helpers normalize bindings, headers, errors, and call context', async () => {
  const { _test } = await import('../src/wazuh-siem.js');

  assert.deepEqual(_test.mergedBindings({
    config: { endpoint: 'http://config', keep: 'config' },
    secret: { username: 'wazuh', password: 'secret' },
    bindings: { endpoint: 'http://binding' },
  }), {
    endpoint: 'http://binding',
    keep: 'config',
    username: 'wazuh',
    password: 'secret',
  });

  assert.deepEqual(_test.parseHeaders(undefined), {});
  assert.deepEqual(_test.parseHeaders(''), {});
  assert.deepEqual(_test.parseHeaders('{"X-Test":"yes"}'), { 'X-Test': 'yes' });
  assert.deepEqual(_test.parseHeaders('{'), {});
  assert.equal(_test.normalizeBaseUrl('ftp://bad'), null);
  assert.equal(_test.normalizeBaseUrl('http://good'), 'http://good');
  assert.equal(_test.normalizeBaseUrl('https://good/'), 'https://good');
  assert.equal(_test.toPositiveInt({ value: '7' }), 7);
  assert.equal(_test.toPositiveInt({}), null);

  const unknown = _test.errorWithCode('SOMETHING_NEW', 'message');
  assert.equal(unknown.legacyCode, 'SOMETHING_NEW');
  assert.match(unknown.message, /SOMETHING_NEW: message/);

  assert.deepEqual(_test.resolveCallContext({ config: { a: 1 } }, { x: 1 }, { secret: { b: 2 } }), {
    req: { x: 1 },
    ctx: {
      config: { a: 1 },
      secret: { b: 2 },
      bindings: {},
      limits: {},
      meta: {},
      metadata: {},
      getMetadata: undefined,
    },
  });
});

// ─── buildAlertsOpenSearchQuery ────────────────────────────────

test('buildAlertsOpenSearchQuery constructs OpenSearch DSL from structured fields', async () => {
  const { _test } = await import('../src/wazuh-siem.js');

  // Empty request → match_all
  const emptyQuery = _test.buildAlertsOpenSearchQuery({});
  assert.deepEqual(emptyQuery, { match_all: {} });

  // With severity_min
  const severityQuery = _test.buildAlertsOpenSearchQuery({ severity_min: { value: 5 } });
  assert.deepEqual(severityQuery, { bool: { must: [{ range: { 'rule.level': { gte: 5 } } }] } });

  // With start_time and end_time
  const timeQuery = _test.buildAlertsOpenSearchQuery({ start_time: { value: 1704067200 }, end_time: { value: 1704153600 } });
  assert.equal(timeQuery.bool.must.length, 2);
  assert.deepEqual(timeQuery.bool.must[0], { range: { timestamp: { gte: new Date(1704067200 * 1000).toISOString() } } });
  assert.deepEqual(timeQuery.bool.must[1], { range: { timestamp: { lte: new Date(1704153600 * 1000).toISOString() } } });

  // With raw query string
  const rawQuery = _test.buildAlertsOpenSearchQuery({ query: 'rule.groups=authentication_failed', severity_min: { value: 5 } });
  assert.equal(rawQuery.bool.must.length, 2);
  assert.deepEqual(rawQuery.bool.must[0], { range: { 'rule.level': { gte: 5 } } });
  assert.deepEqual(rawQuery.bool.must[1], { query_string: { query: 'rule.groups=authentication_failed' } });
});

// ─── extractAffectedItems ────────────────────────────────────

test('extractAffectedItems handles Wazuh Manager API response formats', async () => {
  const { _test } = await import('../src/wazuh-siem.js');

  assert.deepEqual(_test.extractAffectedItems({
    data: { affected_items: [{ id: '1' }, { id: '2' }], total_affected_items: 2 },
  }), { items: [{ id: '1' }, { id: '2' }], total: 2 });

  assert.deepEqual(_test.extractAffectedItems({
    data: { affected_items: [], total_affected_items: 0 },
  }), { items: [], total: 0 });

  assert.deepEqual(_test.extractAffectedItems({
    data: { total_alerts: 100, level_12_plus: 10 },
  }), { items: [], total: 0, stats: { total_alerts: 100, level_12_plus: 10 } });
});

// ─── extractOpenSearchHits ────────────────────────────────────

test('extractOpenSearchHits handles OpenSearch response format', async () => {
  const { _test } = await import('../src/wazuh-siem.js');

  const osResponse = {
    hits: {
      hits: [
        { _id: 'alert-1', _source: { id: '1', timestamp: '2024-01-15T10:30:00Z', rule: { description: 'SSH brute force' } } },
        { _id: 'alert-2', _source: { id: '2', timestamp: '2024-01-15T11:00:00Z', rule: { description: 'File modification' } } },
      ],
      total: { value: 2, relation: 'eq' },
    },
  };

  const extracted = _test.extractOpenSearchHits(osResponse);
  assert.equal(extracted.items.length, 2);
  assert.equal(extracted.items[0]._id, 'alert-1');
  assert.equal(extracted.items[0].id, '1');
  assert.equal(extracted.total, 2);

  // Empty response
  assert.deepEqual(_test.extractOpenSearchHits({}), { items: [], total: 0 });
  assert.deepEqual(_test.extractOpenSearchHits({ hits: { hits: [], total: { value: 0 } } }), { items: [], total: 0 });
});

// ─── mapAlertRecord ──────────────────────────────────────────

test('mapAlertRecord maps Wazuh alert to proto AlertRecord', async () => {
  const { _test } = await import('../src/wazuh-siem.js');

  const alert = {
    id: '1',
    timestamp: '2024-01-15T10:30:00Z',
    rule: { description: 'SSH brute force', level: 10, groups: ['auth', 'sshd'], mitre: { id: ['T1110'] } },
    agent: { id: '001', name: 'web', ip: '10.0.0.1' },
    full_log: 'log line',
  };

  const mapped = _test.mapAlertRecord(alert);
  assert.equal(mapped.id, '1');
  assert.equal(mapped.timestamp, '2024-01-15T10:30:00Z');
  assert.equal(mapped.rule_description, 'SSH brute force');
  assert.equal(mapped.rule_level, 10);
  assert.equal(mapped.rule_groups, 'auth,sshd');
  assert.equal(mapped.rule_mitre_id, 'T1110');
  assert.equal(mapped.agent_id, '001');
  assert.equal(mapped.agent_name, 'web');
  assert.equal(mapped.agent_ip, '10.0.0.1');
  assert.equal(mapped.full_log, 'log line');
});

// ─── mapAgentRecord ──────────────────────────────────────────

test('mapAgentRecord maps Wazuh agent to proto AgentRecord', async () => {
  const { _test } = await import('../src/wazuh-siem.js');

  const agent = {
    id: '001', name: 'web-server', ip: '192.168.1.10', status: 'active',
    os: { name: 'Ubuntu', version: '22.04' }, version: 'Wazuh v4.9.0',
    lastKeepAlive: '2024-01-15T12:00:00Z', group: ['default', 'web'],
  };

  const mapped = _test.mapAgentRecord(agent);
  assert.equal(mapped.id, '001');
  assert.equal(mapped.name, 'web-server');
  assert.equal(mapped.ip, '192.168.1.10');
  assert.equal(mapped.status, 'active');
  assert.equal(mapped.os_name, 'Ubuntu');
  assert.equal(mapped.os_version, '22.04');
  assert.equal(mapped.wazuh_version, 'Wazuh v4.9.0');
  assert.equal(mapped.group, 'default,web');
});

// ─── mapVulnerabilityRecord ──────────────────────────────────

test('mapVulnerabilityRecord maps Wazuh vulnerability to proto VulnerabilityRecord', async () => {
  const { _test } = await import('../src/wazuh-siem.js');

  // Old format (from Manager API)
  const vulnOld = {
    cve: 'CVE-2024-0001', severity: 'Critical',
    package: { name: 'openssl', version: '1.1.1f' },
    title: 'OpenSSL Overflow', description: 'Buffer overflow',
    references: 'https://nvd.nist.gov/vuln/detail/CVE-2024-0001', type: 'Package',
  };

  const mappedOld = _test.mapVulnerabilityRecord(vulnOld);
  assert.equal(mappedOld.cve, 'CVE-2024-0001');
  assert.equal(mappedOld.severity, 'Critical');
  assert.equal(mappedOld.package_name, 'openssl');
  assert.equal(mappedOld.package_version, '1.1.1f');

  // Indexer format (with vulnerability nested object)
  const vulnNew = {
    vulnerability: {
      cve: 'CVE-2024-0002', severity: 'High',
      package: { name: 'nginx', version: '1.18' },
      title: 'Nginx Info Disclosure', description: 'Information disclosure',
      reference: 'https://nvd.nist.gov/vuln/detail/CVE-2024-0002',
      type: 'Package',
    },
  };

  const mappedNew = _test.mapVulnerabilityRecord(vulnNew);
  assert.equal(mappedNew.cve, 'CVE-2024-0002');
  assert.equal(mappedNew.severity, 'High');
  assert.equal(mappedNew.package_name, 'nginx');
  assert.equal(mappedNew.package_version, '1.18');
});

// ─── Endpoint configuration validation ──────────────────────────

test('ListAlerts requires indexerEndpoint', async () => {
  const handler = await loadHandler(listAlertsPath, {}, {
    bindings: { endpoint: 'http://localhost:19000', indexerEndpoint: '' },
  });
  await assert.rejects(() => handler(), /indexerEndpoint is required for alert/);
});

test('ListAgents requires endpoint (Manager API)', async () => {
  const handler = await loadHandler(listAgentsPath, {}, {
    bindings: { indexerEndpoint: 'http://localhost:19200', endpoint: '' },
    secret: { username: 'wazuh', password: 'wazuh' },
  });
  await assert.rejects(() => handler(), /restBaseUrl\/baseUrl\/endpoint is required for Manager API/);
});

// ─── Indexer API: ListAlerts ──────────────────────────────────

test('ListAlerts queries Indexer API with OpenSearch DSL and maps response', async () => {
  const calls = mockIndexer((url, init) => {
    // Verify it's an OpenSearch _search request
    assert.match(url, /wazuh-alerts-.*\/_search/);
    assert.equal(init.method, 'POST');
    // Verify Basic Auth
    assert.match(init.headers['Authorization'], /^Basic /);

    // Parse request body
    const body = JSON.parse(init.body);
    assert.equal(body.size, 10);
    assert.equal(body.from, 0);
    // Verify sort
    assert.deepEqual(body.sort, [{ timestamp: { order: 'desc' } }]);

    // Return OpenSearch response
    return {
      ok: true,
      status: 200,
      headers: new Map([['content-type', 'application/json']]),
      text: async () => JSON.stringify({
        hits: {
          hits: [
            {
              _id: 'alert-1',
              _source: {
                id: '1',
                timestamp: '2024-01-15T10:30:00Z',
                rule: { description: 'SSH brute force attack detected', level: 10, groups: ['authentication_failed', 'sshd'], mitre: { id: ['T1110'] } },
                agent: { id: '001', name: 'web-server', ip: '192.168.1.10' },
                full_log: 'Failed password',
              },
            },
          ],
          total: { value: 1, relation: 'eq' },
        },
      }),
    };
  });

  const handler = await loadHandler(listAlertsPath, {
    limit: { value: 10 },
    offset: { value: 0 },
    severity_min: { value: 5 },
  }, defaultDualCtx);
  const res = await handler();

  assert.equal(res.data.alerts.length, 1);
  assert.equal(res.data.alerts[0].rule_description, 'SSH brute force attack detected');
  assert.equal(res.data.alerts[0].rule_level, 10);
  assert.equal(res.data.alerts[0].rule_mitre_id, 'T1110');
  assert.equal(res.data.total, 1);

  // Verify the request was sent to Indexer
  assert.equal(calls.indexer.length, 1);
});

test('ListAlerts handles empty Indexer response', async () => {
  mockIndexer();

  const handler = await loadHandler(listAlertsPath, {}, defaultDualCtx);
  const res = await handler();

  assert.equal(res.data.alerts.length, 0);
  assert.equal(res.data.total, 0);
});

// ─── Indexer API: GetAlertSummary ──────────────────────────────────

test('GetAlertSummary uses Indexer aggregation for severity distribution', async () => {
  const calls = mockIndexer((url, init) => {
    assert.match(url, /wazuh-alerts-.*\/_search/);
    const body = JSON.parse(init.body);
    assert.equal(body.size, 0);
    assert.ok(body.aggs);
    assert.ok(body.aggs.by_level);

    return {
      ok: true,
      status: 200,
      headers: new Map([['content-type', 'application/json']]),
      text: async () => JSON.stringify({
        hits: { total: { value: 100, relation: 'eq' }, hits: [] },
        aggregations: {
          by_level: {
            buckets: [
              { key: 'level_12_plus', doc_count: 10 },
              { key: 'level_8_11', doc_count: 30 },
              { key: 'level_4_7', doc_count: 50 },
              { key: 'level_0_3', doc_count: 10 },
            ],
          },
        },
      }),
    };
  });

  const handler = await loadHandler(getAlertSummaryPath, {}, defaultDualCtx);
  const res = await handler();

  assert.equal(res.data.total_alerts, 100);
  assert.equal(res.data.level_12_plus, 10);
  assert.equal(res.data.level_8_11, 30);
  assert.equal(res.data.level_4_7, 50);
  assert.equal(res.data.level_0_3, 10);
});

// ─── Indexer API: ListVulnerabilities ──────────────────────────────

test('ListVulnerabilities validates agent_id is required', async () => {
  mockIndexer();

  const handler = await loadHandler(listVulnerabilitiesPath, {}, defaultDualCtx);
  await assert.rejects(() => handler(), /INVALID_ARGUMENT: agent_id is required/);
});

test('ListVulnerabilities queries Indexer with agent filter and maps response', async () => {
  const calls = mockIndexer((url, init) => {
    assert.match(url, /wazuh-vulnerabilities-.*\/_search/);
    const body = JSON.parse(init.body);
    assert.ok(body.query);
    assert.ok(body.query.bool.must);
    // Verify agent.id filter
    const agentFilter = body.query.bool.must.find((m) => m.term && m.term['agent.id']);
    assert.ok(agentFilter);
    assert.equal(agentFilter.term['agent.id'], '001');

    return {
      ok: true,
      status: 200,
      headers: new Map([['content-type', 'application/json']]),
      text: async () => JSON.stringify({
        hits: {
          hits: [
            {
              _id: 'vuln-1',
              _source: {
                vulnerability: {
                  cve: 'CVE-2024-0001',
                  severity: 'Critical',
                  package: { name: 'openssl', version: '1.1.1f' },
                  title: 'OpenSSL Buffer Overflow',
                  description: 'Buffer overflow',
                  reference: 'https://nvd.nist.gov/vuln/detail/CVE-2024-0001',
                  type: 'Package',
                },
                agent: { id: '001', name: 'web-server' },
              },
            },
          ],
          total: { value: 1, relation: 'eq' },
        },
      }),
    };
  });

  const handler = await loadHandler(listVulnerabilitiesPath, {
    agent_id: '001',
    limit: { value: 10 },
  }, defaultDualCtx);
  const res = await handler();

  assert.equal(res.data.vulnerabilities.length, 1);
  assert.equal(res.data.vulnerabilities[0].cve, 'CVE-2024-0001');
  assert.equal(res.data.vulnerabilities[0].severity, 'Critical');
  assert.equal(res.data.vulnerabilities[0].package_name, 'openssl');
  assert.equal(res.data.total, 1);
});

// ─── Indexer API: GetVulnerabilitySummary ──────────────────────────────

test('GetVulnerabilitySummary validates agent_id is required', async () => {
  mockIndexer();

  const handler = await loadHandler(getVulnerabilitySummaryPath, {}, defaultDualCtx);
  await assert.rejects(() => handler(), /INVALID_ARGUMENT: agent_id is required/);
});

test('GetVulnerabilitySummary uses Indexer aggregation for severity counts', async () => {
  mockIndexer((url, init) => {
    const body = JSON.parse(init.body);
    assert.equal(body.size, 0);
    assert.ok(body.query);
    assert.ok(body.aggs.by_severity);

    return {
      ok: true,
      status: 200,
      headers: new Map([['content-type', 'application/json']]),
      text: async () => JSON.stringify({
        hits: { total: { value: 50, relation: 'eq' }, hits: [] },
        aggregations: {
          by_severity: {
            buckets: [
              { key: 'Critical', doc_count: 5 },
              { key: 'High', doc_count: 10 },
              { key: 'Medium', doc_count: 20 },
              { key: 'Low', doc_count: 15 },
            ],
          },
        },
      }),
    };
  });

  const handler = await loadHandler(getVulnerabilitySummaryPath, {
    agent_id: '001',
  }, defaultDualCtx);
  const res = await handler();

  assert.equal(res.data.critical_count, 5);
  assert.equal(res.data.high_count, 10);
  assert.equal(res.data.medium_count, 20);
  assert.equal(res.data.low_count, 15);
  assert.equal(res.data.total, 50);
});

// ─── Manager API: ListAgents ──────────────────────────────────

test('ListAgents queries Manager API and maps agent data', async () => {
  mockWithAuth('test-token', () => ({
    ok: true,
    status: 200,
    headers: new Map([['content-type', 'application/json']]),
    text: async () => JSON.stringify({
      data: {
        affected_items: [
          { id: '001', name: 'web-server', ip: '192.168.1.10', status: 'active', os: { name: 'Ubuntu', version: '22.04' }, version: 'Wazuh v4.9.0', lastKeepAlive: '2024-01-15T12:00:00Z', group: ['default', 'web'] },
        ],
        total_affected_items: 1,
      },
      error: 0,
    }),
  }));

  const handler = await loadHandler(listAgentsPath, {
    status: 'active',
  }, defaultDualCtx);
  const res = await handler();

  assert.equal(res.data.agents.length, 1);
  assert.equal(res.data.agents[0].id, '001');
  assert.equal(res.data.agents[0].name, 'web-server');
  assert.equal(res.data.agents[0].os_name, 'Ubuntu');
  assert.equal(res.data.agents[0].group, 'default,web');
  assert.equal(res.data.total, 1);
});

// ─── JWT Authentication (Manager API) ──────────────────────────────

test('authenticate obtains JWT token via Basic Auth for Manager API', async () => {
  const { _test } = await import('../src/wazuh-siem.js');
  _test.clearJwtCache();

  const calls = mockWithAuth('test-jwt-token-123');

  const handler = await loadHandler(listAgentsPath, {}, defaultManagerSecretCtx);
  await handler();

  // Verify auth call used Basic Auth
  assert.equal(calls.auth.length, 1);
  assert.match(calls.auth[0].init.headers['Authorization'], /^Basic /);
  const decoded = Buffer.from(calls.auth[0].init.headers['Authorization'].slice(6), 'base64').toString();
  assert.equal(decoded, 'wazuh:wazuh');

  // Verify API call used Bearer token
  assert.equal(calls.api.length, 1);
  assert.match(calls.api[0].init.headers['Authorization'], /^Bearer test-jwt-token-123$/);
});

test('authenticate fails without credentials', async () => {
  const handler = await loadHandler(listAgentsPath, {}, {
    bindings: { endpoint: 'http://localhost:19000' },
  });
  await assert.rejects(() => handler(), /INVALID_ARGUMENT: username and password are required/);
});

test('authenticate fails with wrong credentials (HTTP 401)', async () => {
  mockAuthFail(401, JSON.stringify({ title: 'Unauthorized', detail: 'Invalid credentials' }));

  const handler = await loadHandler(listAgentsPath, {}, {
    bindings: { endpoint: 'http://localhost:19000' },
    secret: { username: 'bad', password: 'creds' },
  });
  await assert.rejects(() => handler(), /UNAUTHENTICATED: Wazuh authentication failed: invalid credentials \(401\)/);
});

// ─── HTTP error mapping ──────────────────────────────────────

test('Indexer HTTP 403 maps to PERMISSION_DENIED', async () => {
  mockIndexerAuthFail(403, 'forbidden');

  const handler = await loadHandler(listAlertsPath, {}, defaultDualCtx);
  await assert.rejects(() => handler(), /PERMISSION_DENIED: indexer-post forbidden \(403\)/);
});

test('Indexer HTTP 500 maps to UNAVAILABLE', async () => {
  mockIndexerAuthFail(500, 'internal server error');

  const handler = await loadHandler(listAlertsPath, {}, defaultDualCtx);
  await assert.rejects(() => handler(), /UNAVAILABLE: upstream http 500/);
});

test('Manager API HTTP 422 maps to FAILED_PRECONDITION', async () => {
  const { _test } = await import('../src/wazuh-siem.js');
  _test.clearJwtCache();
  mockAuthOkApiFail('test-token', 422, 'invalid request');

  const handler = await loadHandler(listAgentsPath, {}, defaultManagerSecretCtx);
  await assert.rejects(() => handler(), /FAILED_PRECONDITION: upstream http 422/);
});

test('Network failure maps to a redacted UNAVAILABLE error', async () => {
  setFetch(async () => {
    throw Object.assign(new Error('connection refused'), { cause: new Error('ECONNREFUSED') });
  });

  const handler = await loadHandler(listAlertsPath, {}, defaultDualCtx);
  await assert.rejects(() => handler(), /UNAVAILABLE: upstream request failed/);
});

test('search fields, pagination validation, and page-size bound are enforced', async () => {
  let body;
  mockIndexer(async (_url, init) => {
    body = JSON.parse(init.body);
    return { ok: true, status: 200, headers: new Map(), text: async () => '{"hits":{"hits":[],"total":{"value":0}}}' };
  });
  const alerts = await loadHandler(listAlertsPath, { search: 'ssh failure' }, defaultDualCtx);
  await alerts();
  assert.deepEqual(body.query.bool.must[0], {
    multi_match: { query: 'ssh failure', fields: ['rule.description', 'full_log', 'agent.name', 'agent.ip'] },
  });

  const vulnerabilities = await loadHandler(listVulnerabilitiesPath, {
    agent_id: '001', search: 'CVE package', query: 'vulnerability.severity:high',
  }, defaultDualCtx);
  await vulnerabilities();
  assert.equal(body.query.bool.must.length, 3);

  for (const req of [{ limit: { value: -1 } }, { offset: -2 }, { limit: 1001 }]) {
    const handler = await loadHandler(listAlertsPath, req, defaultDualCtx);
    await assert.rejects(() => handler(), /INVALID_ARGUMENT: (limit|offset) must be an integer/);
  }
});

test('Indexer credentials are mandatory and Basic Auth supports UTF-8', async () => {
  const missing = await loadHandler(listAlertsPath, {}, {
    bindings: { indexerEndpoint: 'http://localhost:19200' },
  });
  await assert.rejects(() => missing(), /indexerUsername and indexerPassword are required/);

  let authorization;
  mockIndexer(async (_url, init) => {
    authorization = init.headers.Authorization;
    return { ok: true, status: 200, headers: new Map(), text: async () => '{"hits":{"hits":[],"total":{"value":0}}}' };
  });
  const handler = await loadHandler(listAlertsPath, {}, {
    bindings: { indexerEndpoint: 'http://localhost:19200' },
    secret: { indexerUsername: '用户', indexerPassword: '密码' },
  });
  await handler();
  assert.equal(Buffer.from(authorization.slice(6), 'base64').toString('utf8'), '用户:密码');
});

test('JWT cache isolates password rotations and Manager Basic Auth supports UTF-8', async () => {
  const { _test } = await import('../src/wazuh-siem.js');
  _test.clearJwtCache();
  const authHeaders = [];
  setFetch(async (url, init) => {
    if (String(url).includes('/authenticate')) {
      authHeaders.push(init.headers.Authorization);
      return { ok: true, status: 200, headers: new Map(), text: async () => '{"data":{"token":"token"}}' };
    }
    return { ok: true, status: 200, headers: new Map(), text: async () => '{"data":{"affected_items":[]}}' };
  });
  for (const password of ['密码一', '密码二']) {
    const handler = await loadHandler(listAgentsPath, {}, {
      bindings: { endpoint: 'http://localhost:19000' }, secret: { username: '用户', password },
    });
    await handler();
  }
  assert.equal(authHeaders.length, 2);
  assert.equal(Buffer.from(authHeaders[0].slice(6), 'base64').toString('utf8'), '用户:密码一');
});

test('response reader enforces declared, buffered, and streamed size limits', async () => {
  const { _test } = await import('../src/wazuh-siem.js');
  await assert.rejects(() => _test.readResponseText({
    headers: { get: () => String(5 * 1024 * 1024) },
  }), /exceeds 4 MiB/);
  await assert.rejects(() => _test.readResponseText({
    headers: { get: () => null }, text: async () => 'x'.repeat(5 * 1024 * 1024),
  }), /exceeds 4 MiB/);
  const response = new Response('streamed');
  assert.equal(await _test.readResponseText(response), 'streamed');
});

test('invalid timeout is rejected and redirects are not followed', async () => {
  const invalid = await loadHandler(listAlertsPath, {}, {
    bindings: { indexerEndpoint: 'http://localhost:19200', timeoutMs: 0 },
    secret: { indexerUsername: 'admin', indexerPassword: 'secret' },
    limits: { timeoutMs: 0 },
  });
  // A zero binding falls through to the default; an excessive value is rejected.
  assert.equal(typeof invalid, 'function');
  const { rpcdef } = await import('../src/wazuh-siem.js');
  assert.throws(() => rpcdef({ config: { timeoutMs: 300001 } }), /timeoutMs must be an integer/);

  let redirect;
  mockIndexer(async (_url, init) => {
    redirect = init.redirect;
    return { ok: true, status: 200, headers: new Map(), text: async () => '{"hits":{"hits":[],"total":{"value":0}}}' };
  });
  const handler = await loadHandler(listAlertsPath, {}, defaultDualCtx);
  await handler();
  assert.equal(redirect, 'manual');
});

test('utility edge cases and bounded token cache are covered', async () => {
  const { _test } = await import('../src/wazuh-siem.js');
  assert.deepEqual(_test.parseHeaders({ A: 'b' }), { A: 'b' });
  assert.deepEqual(_test.parseHeaders([]), {});
  assert.deepEqual(_test.parseHeaders('[]'), {});
  assert.equal(_test.toPositiveInt(null), null);
  assert.equal(_test.toPositiveInt(-1), null);
  assert.equal(_test.toPositiveInt(1.5), null);
  assert.deepEqual(_test.toValue(true), { boolValue: true });
  assert.deepEqual(_test.toValue(['x', 2]), { listValue: { values: [{ stringValue: 'x' }, { numberValue: 2 }] } });
  assert.deepEqual(_test.toValue({ nested: null }), {
    structValue: { fields: { nested: { stringValue: '' } } },
  });
  assert.deepEqual(_test.toValue(1n), { stringValue: '1' });
  assert.throws(() => _test.paginationValue({ limit: 'bad' }, ['limit'], 10, 'limit', 1000), /INVALID_ARGUMENT/);
  assert.equal(_test.paginationValue({}, ['limit'], 10, 'limit', 1000), 10);
  _test.clearJwtCache();
  for (let index = 0; index < 130; index += 1) {
    _test.cacheToken(`cache-${index}`, { token: String(index), expiresAt: Date.now() });
  }
});

test('authentication rejects malformed success responses without leaking bodies', async () => {
  for (const [body, expected] of [
    ['not-json-secret', /authentication response is not valid JSON/],
    ['{"data":{}}', /no token returned/],
  ]) {
    const { _test } = await import('../src/wazuh-siem.js');
    _test.clearJwtCache();
    setFetch(async () => ({ ok: true, status: 200, headers: new Map(), text: async () => body }));
    const handler = await loadHandler(listAgentsPath, {}, defaultManagerSecretCtx);
    await assert.rejects(() => handler(), expected);
  }

  const { _test } = await import('../src/wazuh-siem.js');
  _test.clearJwtCache();
  mockAuthFail(429, 'rate-limit-secret');
  const handler = await loadHandler(listAgentsPath, {}, defaultManagerSecretCtx);
  await assert.rejects(() => handler(), (error) => {
    assert.match(error.message, /UNAVAILABLE.*http 429/);
    assert.doesNotMatch(error.message, /rate-limit-secret/);
    return true;
  });
});

test('stream reader cancels oversized bodies', async () => {
  const { _test } = await import('../src/wazuh-siem.js');
  let cancelled = false;
  let released = false;
  const reader = {
    read: async () => ({ done: false, value: new Uint8Array(5 * 1024 * 1024) }),
    cancel: async () => { cancelled = true; },
    releaseLock: () => { released = true; },
  };
  await assert.rejects(() => _test.readResponseText({
    headers: { get: () => null }, body: { getReader: () => reader },
  }), /exceeds 4 MiB/);
  assert.equal(cancelled, true);
  assert.equal(released, true);
});

test('mappers and response extractors tolerate sparse upstream payloads', async () => {
  const { _test } = await import('../src/wazuh-siem.js');
  assert.deepEqual(_test.extractAffectedItems(null), { items: [], total: 0 });
  assert.deepEqual(_test.extractAffectedItems({ data: [{ id: 1 }] }), { items: [{ id: 1 }], total: 1 });
  assert.deepEqual(_test.extractAffectedItems({ data: { answer: 42 } }), {
    items: [], total: 0, stats: { answer: 42 },
  });
  assert.deepEqual(_test.extractOpenSearchHits({}), { items: [], total: 0 });
  assert.deepEqual(_test.mapAlertRecord({}), {
    id: '', timestamp: '', rule_description: '', rule_level: 0, rule_groups: '', rule_mitre_id: '',
    agent_id: '', agent_name: '', agent_ip: '', full_log: '', raw: {},
  });
  assert.deepEqual(_test.mapAgentRecord({}), {
    id: '', name: '', ip: '', status: '', os_name: '', os_version: '', wazuh_version: '', last_keep_alive: '', group: '',
  });
  assert.deepEqual(_test.mapVulnerabilityRecord({}), {
    cve: '', severity: '', package_name: '', package_version: '', title: '', description: '', reference: '', type: '', raw: {},
  });
});

test('Manager retries one expired JWT and carries optional filters', async () => {
  const { _test } = await import('../src/wazuh-siem.js');
  _test.clearJwtCache();
  let authCount = 0;
  let apiCount = 0;
  let finalUrl;
  setFetch(async (url) => {
    if (String(url).includes('/authenticate')) {
      authCount += 1;
      return { ok: true, status: 200, headers: new Map(), text: async () => `{"data":{"token":"token-${authCount}"}}` };
    }
    apiCount += 1;
    finalUrl = String(url);
    if (apiCount === 1) return { ok: false, status: 401, headers: new Map(), text: async () => 'expired-secret' };
    return { ok: true, status: 200, headers: new Map(), text: async () => '{"data":{"affected_items":[]}}' };
  });
  const handler = await loadHandler(listAgentsPath, {
    status: 'all', search: 'linux', query: 'id=001', limit: 5, offset: 2,
  }, defaultManagerSecretCtx);
  await handler();
  assert.equal(authCount, 2);
  assert.equal(apiCount, 2);
  assert.match(finalUrl, /search=linux/);
  assert.match(finalUrl, /q=id%3D001/);
  assert.doesNotMatch(finalUrl, /status=/);
});

test('TLS opt-out installs an undici dispatcher and empty response is accepted', async () => {
  let dispatcher;
  setFetch(async (_url, init) => {
    dispatcher = init.dispatcher;
    return { ok: true, status: 200, headers: new Map(), text: async () => '' };
  });
  const handler = await loadHandler(listAlertsPath, {}, {
    config: { indexerEndpoint: 'https://localhost:19200', skipTlsVerify: true },
    secret: { indexerUsername: 'admin', indexerPassword: 'secret' },
  });
  const response = await handler();
  assert.ok(dispatcher);
  assert.equal(response.data.total, 0);
  await dispatcher.close();
});

test('legacy invocation adapter accepts request and context shapes', async () => {
  const { _test } = await import('../src/wazuh-siem.js');
  assert.deepEqual(_test.resolveCallContext({}, { request: { a: 1 }, config: { b: 2 } }), {
    req: { a: 1 },
    ctx: { request: { a: 1 }, config: { b: 2 }, bindings: {}, secret: {}, limits: {}, meta: {}, metadata: {}, getMetadata: undefined },
  });
  assert.deepEqual(_test.resolveCallContext(undefined, undefined, undefined).req, {});
});

// ─── Indexer Basic Auth failure ──────────────────────────────────

test('Indexer auth failure (HTTP 401) maps to UNAUTHENTICATED', async () => {
  mockIndexerAuthFail(401, JSON.stringify({ error: { root_cause: [{ type: 'security_exception' }] } }));

  const handler = await loadHandler(listAlertsPath, {}, defaultDualCtx);
  await assert.rejects(() => handler(), /UNAUTHENTICATED: indexer-post unauthorized \(401\)/);
});

test('authenticate fails with HTTP 403 maps to PERMISSION_DENIED', async () => {
  mockAuthFail(403, JSON.stringify({ title: 'Forbidden', detail: 'Access denied' }));

  const handler = await loadHandler(listAgentsPath, {}, {
    bindings: { endpoint: 'http://localhost:19000' },
    secret: { username: 'user', password: 'pass' },
  });
  await assert.rejects(() => handler(), /PERMISSION_DENIED: Wazuh authentication forbidden \(403\)/);
});

test('fetch timeout maps to DEADLINE_EXCEEDED', async () => {
  setFetch(async () => {
    const err = new Error('The operation was aborted due to timeout');
    err.name = 'TimeoutError';
    throw err;
  });

  const handler = await loadHandler(listAlertsPath, {}, defaultDualCtx);
  await assert.rejects(() => handler(), /DEADLINE_EXCEEDED: request timeout after/);
});

test('throwForHttpError does not leak upstream response body in 401/403 errors', async () => {
  const sensitiveBody = JSON.stringify({ secret_key: 'should-not-appear', internal_ip: '10.0.0.1' });
  mockIndexerAuthFail(401, sensitiveBody);

  const handler = await loadHandler(listAlertsPath, {}, defaultDualCtx);
  try {
    await handler();
    assert.fail('should have thrown');
  } catch (err) {
    const msg = err.message || String(err);
    assert.match(msg, /UNAUTHENTICATED/);
    assert.doesNotMatch(msg, /secret_key/);
    assert.doesNotMatch(msg, /should-not-appear/);
  }
});

// ─── SDK handler invocation ──────────────────────────────────

test('SDK handlers accept single context with dual endpoint config', async () => {
  mockIndexer();

  const { handlers, METHOD_LIST_ALERTS_FULL } = await import('../src/wazuh-siem.js');
  const res = await handlers[METHOD_LIST_ALERTS_FULL]({
    config: { endpoint: 'http://localhost:19000', indexerEndpoint: 'http://localhost:19200' },
    secret: { username: 'wazuh', password: 'wazuh', indexerUsername: 'admin', indexerPassword: 'admin' },
    request: {},
    meta: { instance_id: 'inst-sdk', request_id: 'req-sdk' },
  });

  assert.equal(res.data.alerts.length, 0);
});

test('SDK handlers accept request plus inner context arguments (Manager API)', async () => {
  const { _test } = await import('../src/wazuh-siem.js');
  _test.clearJwtCache();
  const calls = mockWithAuth('inner-token');

  const registered = _test.registerHandlers({
    bindings: { endpoint: 'http://base' },
  });

  await registered[listAgentsPath]({}, {
    bindings: { endpoint: 'http://inner' },
    secret: { username: 'inner-wazuh', password: 'inner-pass' },
    meta: { instanceId: 'inst-camel', requestId: 'req-camel' },
  });

  // Verify inner context overrides
  assert.equal(calls.api.length, 1);
  assert.match(calls.api[0].init.headers['x-engine-instance'], /inst-camel/);
});

// ─── Review fix verification ──────────────────────────────────

test('JWT token cache persists across rpcdef() calls (module-level Map, not closure)', async () => {
  const { _test } = await import('../src/wazuh-siem.js');
  _test.clearJwtCache();

  const calls = mockWithAuth('persistent-token');

  // First call triggers authentication
  const handler1 = await loadHandler(listAgentsPath, {}, defaultManagerSecretCtx);
  await handler1();
  assert.equal(calls.auth.length, 1);

  // Second call reuses cached token — no additional auth request
  const handler2 = await loadHandler(listAgentsPath, {}, defaultManagerSecretCtx);
  await handler2();
  assert.equal(calls.auth.length, 1); // Still 1, cache hit
  assert.equal(calls.api.length, 2);  // Two API calls total
});

test('request-level username/password takes priority for Manager JWT auth', async () => {
  const { _test } = await import('../src/wazuh-siem.js');
  _test.clearJwtCache();

  const calls = mockWithAuth('req-cred-token');

  const handler = await loadHandler(listAgentsPath, {
    username: 'override-user',
    password: 'override-pass',
  }, defaultManagerSecretCtx);
  await handler();

  // Auth should use request-level credentials, not secret-level
  assert.equal(calls.auth.length, 1);
  assert.match(calls.auth[0].init.headers['Authorization'], /^Basic /);
  const decoded = Buffer.from(calls.auth[0].init.headers['Authorization'].slice(6), 'base64').toString();
  assert.equal(decoded, 'override-user:override-pass');
});

test('timeoutMs reads from bindings (config) before falling back to limits', async () => {
  const { _test } = await import('../src/wazuh-siem.js');
  // mergedBindings merges config into bindings, so config.timeoutMs takes priority
  const bindings = _test.mergedBindings({
    config: { timeoutMs: 8000 },
    limits: { timeoutMs: 5000 },
  });
  assert.equal(bindings.timeoutMs, 8000); // config wins over limits
});

test('JWT payload decoded with base64url (not atob) for token expiry parsing', async () => {
  const { _test } = await import('../src/wazuh-siem.js');
  _test.clearJwtCache();

  // Create a JWT-like token with base64url characters (- and _)
  // Header: eyJhbGciOiJIUzI1NiI (standard base64url)
  // Payload: base64url-encoded JSON with exp field containing base64url chars
  const header = 'eyJhbGciOiJIUzI1NiI';
  const payload = Buffer.from(JSON.stringify({ exp: 9999999999 })).toString('base64url');
  const signature = 'test-sig-_with-base64url_chars';
  const jwtToken = `${header}.${payload}.${signature}`;

  const calls = mockWithAuth(jwtToken);
  const handler = await loadHandler(listAgentsPath, {}, defaultManagerSecretCtx);
  await handler();

  // Verify the auth was successful (no error) — base64url parsing worked
  assert.equal(calls.auth.length, 1);
  assert.equal(calls.api.length, 1);
  assert.match(calls.api[0].init.headers['Authorization'], /^Bearer /);
});

test('fetch uses AbortSignal.timeout (not invalid timeoutMs option)', async () => {
  const { _test } = await import('../src/wazuh-siem.js');
  _test.clearJwtCache();

  let capturedInit;
  const calls = mockWithAuth('signal-test-token', (url, init) => {
    capturedInit = init;
    return {
      ok: true,
      status: 200,
      headers: new Map([['content-type', 'application/json']]),
      text: async () => JSON.stringify({
        data: { affected_items: [], total_affected_items: 0 },
        error: 0,
      }),
    };
  });

  const handler = await loadHandler(listAgentsPath, {}, defaultManagerSecretCtx);
  await handler();

  // Verify API call uses AbortSignal.timeout, not raw timeoutMs property
  assert.equal(calls.api.length, 1);
  assert.ok(capturedInit.signal, 'fetch should have signal property from AbortSignal.timeout()');
  assert.equal(capturedInit.timeoutMs, undefined, 'fetch should NOT have raw timeoutMs option');
});

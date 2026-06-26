import { describe, it, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';

import {
  _test,
  handlers,
  METHOD_LIST_VULNS_FULL,
  METHOD_GET_VULN_FULL,
  METHOD_UPDATE_VULN_STATUS_FULL,
  METHOD_GET_VULN_SUMMARY_FULL,
  METHOD_LIST_PROJECTS_FULL,
  METHOD_GET_PROJECT_FULL,
  METHOD_CREATE_PROJECT_FULL,
  METHOD_DELETE_PROJECT_FULL,
  METHOD_LIST_AGENTS_FULL,
  METHOD_GET_SYSTEM_INFO_FULL,
  METHOD_LIST_STRATEGIES_FULL,
  METHOD_GET_SCA_DETAIL_FULL,
} from '../src/dongtai-iast.js';

const {
  errorWithCode,
  firstDefined,
  mergedBindings,
  normalizeBaseUrl,
  parseHeaders,
  toPositiveInt,
  toStruct,
  toValue,
  unwrapString,
} = _test;

// ============ Unit Tests: Utility Functions ============

describe('Utility Functions', () => {
  it('normalizeBaseUrl should handle valid URLs', () => {
    assert.equal(normalizeBaseUrl('http://localhost:9090'), 'http://localhost:9090');
    assert.equal(normalizeBaseUrl('https://dongtai.example.com/'), 'https://dongtai.example.com');
    assert.equal(normalizeBaseUrl('invalid'), null);
    assert.equal(normalizeBaseUrl(''), null);
    assert.equal(normalizeBaseUrl(null), null);
  });

  it('toPositiveInt should parse numbers correctly', () => {
    assert.equal(toPositiveInt(1), 1);
    assert.equal(toPositiveInt(100), 100);
    assert.equal(toPositiveInt({ value: 42 }), 42);
    assert.equal(toPositiveInt(0), 0);
    assert.equal(toPositiveInt(-1), -1);
    assert.equal(toPositiveInt(null), null);
    assert.equal(toPositiveInt(undefined), null);
    assert.equal(toPositiveInt('abc'), null);
    assert.equal(toPositiveInt(1.5), null);
  });

  it('unwrapString should handle various inputs', () => {
    assert.equal(unwrapString('hello'), 'hello');
    assert.equal(unwrapString({ value: 'world' }), 'world');
    assert.equal(unwrapString(null), '');
    assert.equal(unwrapString(undefined), '');
    assert.equal(unwrapString(123), '123');
  });

  it('firstDefined should return the first defined value', () => {
    assert.equal(firstDefined(undefined, null, 'hello'), 'hello');
    assert.equal(firstDefined('first', 'second'), 'first');
    assert.equal(firstDefined(undefined, undefined, 42), 42);
    assert.equal(firstDefined(), undefined);
  });

  it('mergedBindings should merge config and secret', () => {
    const ctx = {
      config: { endpoint: 'http://localhost:9090', timeoutMs: 5000 },
      secret: { apiToken: 'test-token' },
    };
    const result = mergedBindings(ctx);
    assert.equal(result.endpoint, 'http://localhost:9090');
    assert.equal(result.apiToken, 'test-token');
    assert.equal(result.timeoutMs, 5000);
  });

  it('parseHeaders should handle various inputs', () => {
    assert.deepEqual(parseHeaders({ 'X-Custom': 'value' }), { 'X-Custom': 'value' });
    assert.deepEqual(parseHeaders(''), {});
    assert.deepEqual(parseHeaders(null), {});
    assert.deepEqual(parseHeaders('{"X-Auth":"abc"}'), { 'X-Auth': 'abc' });
  });

  it('toValue should convert values correctly', () => {
    assert.deepEqual(toValue('hello'), { stringValue: 'hello' });
    assert.deepEqual(toValue(42), { numberValue: 42 });
    assert.deepEqual(toValue(true), { boolValue: true });
    assert.deepEqual(toValue(null), undefined);
    assert.deepEqual(toValue(undefined), undefined);
  });

  it('toStruct should convert objects to struct format', () => {
    const result = toStruct({ name: 'test', count: 5 });
    assert.ok(result.fields);
    assert.equal(result.fields.name.stringValue, 'test');
    assert.equal(result.fields.count.numberValue, 5);
  });

  it('errorWithCode should create GrpcError with correct code', () => {
    const err = errorWithCode('INVALID_ARGUMENT', 'test error');
    assert.ok(err);
    assert.ok(err.message.includes('INVALID_ARGUMENT'));
    assert.equal(err.legacyCode, 'INVALID_ARGUMENT');
  });
});

// ============ Integration Tests with Mock ============

const MOCK_BASE_URL = 'http://127.0.0.1:19999';
const MOCK_TOKEN = 'test-token-12345';

let mockServer;

function createMockResponse(data, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (name) => name === 'content-type' ? 'application/json' : null,
    },
    text: async () => JSON.stringify(data),
  };
}

describe('API Method Tests (Mock)', () => {
  let originalFetch;

  before(() => {
    originalFetch = globalThis.fetch;
    globalThis.fetch = mock.fn(async (url, init) => {
      const urlStr = String(url);
      const method = init?.method || 'GET';

      // ListVulnerabilities
      if (urlStr.includes('/api/v1/vulns') && method === 'GET') {
        return createMockResponse({
          status: 201,
          data: [
            {
              id: 1, vul_name: 'SQL注入', vul_type: 'sql_injection',
              level_id: 1, level_name: '高危', state: 'confirmed',
              url: 'http://test.com/api', project_id: 1, project_name: 'test-project',
              agent_id: 1, language: 'JAVA', first_time: '2024-01-01', latest_time: '2024-01-02', count: 3,
            },
          ],
          page: { alltotal: 1, num_pages: 1, page_size: 20 },
        });
      }
      // GetVulnerability
      if (urlStr.match(/\/api\/v1\/vuln\/\d+$/) && method === 'GET') {
        return createMockResponse({
          status: 201,
          data: {
            id: 1, vul_name: 'SQL注入', vul_type: 'sql_injection',
            level_id: 1, level_name: '高危', state: 'confirmed',
          },
        });
      }
      // UpdateVulnStatus
      if (urlStr.includes('/api/v1/vuln/status') && method === 'POST') {
        return createMockResponse({ status: 201, msg: 'success' });
      }
      // GetVulnSummary
      if (urlStr.includes('/api/v1/vuln/summary_type') && method === 'GET') {
        return createMockResponse({
          status: 201,
          data: {
            level: [{ level: '高危', level_id: 1, count: 5 }],
            type: [{ vul_type: 'sql_injection', count: 3 }],
          },
        });
      }
      // ListProjects
      if (urlStr.includes('/api/v1/projects') && method === 'GET') {
        return createMockResponse({
          status: 201,
          data: [
            { id: 1, name: 'test-project', mode: '插桩模式', agent_count: 1, owner: 'admin', latest_time: '1782468621', agent_language: ['JAVA'], vul_count: [], status: 0 },
          ],
          page: { alltotal: 1, num_pages: 1, page_size: 20 },
        });
      }
      // GetProject
      if (urlStr.match(/\/api\/v1\/project\/\d+$/) && method === 'GET') {
        return createMockResponse({
          status: 201,
          data: { id: 1, name: 'test-project', mode: '插桩模式', versionData: { version_name: 'V1.0' } },
        });
      }
      // CreateProject
      if (urlStr.includes('/api/v1/project/add') && method === 'POST') {
        return createMockResponse({ status: 201, data: { id: 2, name: 'new-project' } });
      }
      // DeleteProject
      if (urlStr.includes('/api/v1/project/delete') && method === 'POST') {
        return createMockResponse({ status: 201, msg: 'success' });
      }
      // ListAgents
      if (urlStr.includes('/api/v1/agents') && method === 'GET') {
        return createMockResponse({
          status: 201,
          data: [
            { id: 1, token: 'agent-token', alias: 'test-agent', language: 'JAVA', state: 'online', project_id: 1, server: '192.168.1.1', latest_time: '2024-01-01' },
          ],
          page: { alltotal: 1, num_pages: 1, page_size: 20 },
        });
      }
      // GetSystemInfo
      if (urlStr.includes('/api/v1/system/info') && method === 'GET') {
        return createMockResponse({ status: 201, msg: 'success', data: { version: '1.14.0' } });
      }
      // ListStrategies
      if (urlStr.includes('/api/v1/strategys') && method === 'GET') {
        return createMockResponse({
          status: 201,
          data: [
            { id: 41, vul_type: 'FileWrite', vul_name: '文件写入', vul_desc: 'desc', level_id: 3, state: 'enable' },
          ],
        });
      }
      // GetScaDetail
      if (urlStr.match(/\/api\/v1\/sca\/\d+$/) && method === 'GET') {
        return createMockResponse({ status: 201, data: { id: 1, package_name: 'lodash', version: '4.17.0' } });
      }

      return createMockResponse({ status: 404, msg: 'Not Found' }, 404);
    });
  });

  after(() => {
    globalThis.fetch = originalFetch;
  });

  const makeCtx = (req = {}) => ({
    config: { endpoint: MOCK_BASE_URL },
    secret: { apiToken: MOCK_TOKEN },
    req,
    meta: { instance_id: 'test-inst', request_id: 'test-req' },
  });

  it('ListVulnerabilities should return vulns list', async () => {
    const handler = handlers[METHOD_LIST_VULNS_FULL];
    const result = await handler(makeCtx({ page: 1, page_size: 20 }));
    assert.ok(Array.isArray(result.vulns));
    assert.equal(result.vulns.length, 1);
    assert.equal(result.vulns[0].vul_name, 'SQL注入');
    assert.equal(result.total, 1);
  });

  it('ListVulnerabilities should filter by level_id', async () => {
    const handler = handlers[METHOD_LIST_VULNS_FULL];
    const result = await handler(makeCtx({ level_id: 1 }));
    assert.ok(Array.isArray(result.vulns));
  });

  it('GetVulnerability should return vuln detail', async () => {
    const handler = handlers[METHOD_GET_VULN_FULL];
    const result = await handler(makeCtx({ id: 1 }));
    assert.ok(result.vuln);
    assert.equal(result.vuln.id, 1);
    assert.ok(result.raw);
  });

  it('UpdateVulnStatus should update status', async () => {
    const handler = handlers[METHOD_UPDATE_VULN_STATUS_FULL];
    const result = await handler(makeCtx({ id: 1, status: 'confirmed' }));
    assert.ok(result.raw);
  });

  it('GetVulnSummary should return summary stats', async () => {
    const handler = handlers[METHOD_GET_VULN_SUMMARY_FULL];
    const result = await handler(makeCtx());
    assert.ok(Array.isArray(result.levels));
    assert.ok(Array.isArray(result.types));
    assert.equal(result.levels[0].level, '高危');
  });

  it('ListProjects should return projects list', async () => {
    const handler = handlers[METHOD_LIST_PROJECTS_FULL];
    const result = await handler(makeCtx());
    assert.ok(Array.isArray(result.projects));
    assert.equal(result.projects[0].name, 'test-project');
    assert.equal(result.total, 1);
  });

  it('GetProject should return project detail', async () => {
    const handler = handlers[METHOD_GET_PROJECT_FULL];
    const result = await handler(makeCtx({ id: 1 }));
    assert.ok(result.project);
    assert.equal(result.project.name, 'test-project');
  });

  it('CreateProject should create and return project', async () => {
    const handler = handlers[METHOD_CREATE_PROJECT_FULL];
    const result = await handler(makeCtx({ name: 'new-project' }));
    assert.equal(result.id, 2);
    assert.equal(result.name, 'new-project');
  });

  it('DeleteProject should delete project', async () => {
    const handler = handlers[METHOD_DELETE_PROJECT_FULL];
    const result = await handler(makeCtx({ id: 1 }));
    assert.ok(result.raw);
  });

  it('ListAgents should return agents list', async () => {
    const handler = handlers[METHOD_LIST_AGENTS_FULL];
    const result = await handler(makeCtx());
    assert.ok(Array.isArray(result.agents));
    assert.equal(result.agents[0].language, 'JAVA');
  });

  it('GetSystemInfo should return system info', async () => {
    const handler = handlers[METHOD_GET_SYSTEM_INFO_FULL];
    const result = await handler(makeCtx());
    assert.ok(result.raw);
  });

  it('ListStrategies should return strategies list', async () => {
    const handler = handlers[METHOD_LIST_STRATEGIES_FULL];
    const result = await handler(makeCtx());
    assert.ok(Array.isArray(result.strategies));
    assert.equal(result.strategies[0].vul_type, 'FileWrite');
  });

  it('GetScaDetail should return SCA detail', async () => {
    const handler = handlers[METHOD_GET_SCA_DETAIL_FULL];
    const result = await handler(makeCtx({ id: 1 }));
    assert.ok(result.raw);
  });
});

// ============ Error Handling Tests ============

describe('Error Handling', () => {
  let originalFetch;

  before(() => {
    originalFetch = globalThis.fetch;
  });

  after(() => {
    globalThis.fetch = originalFetch;
  });

  const makeCtx = (req = {}) => ({
    config: { endpoint: MOCK_BASE_URL },
    secret: { apiToken: MOCK_TOKEN },
    req,
  });

  it('should throw UNAUTHENTICATED for 401', async () => {
    globalThis.fetch = mock.fn(async () => ({
      ok: false, status: 401, headers: { get: () => 'text/plain' },
      text: async () => 'Unauthorized',
    }));
    const handler = handlers[METHOD_LIST_VULNS_FULL];
    await assert.rejects(
      () => handler(makeCtx()),
      (err) => err.message.includes('UNAUTHENTICATED')
    );
  });

  it('should throw PERMISSION_DENIED for 403', async () => {
    globalThis.fetch = mock.fn(async () => ({
      ok: false, status: 403, headers: { get: () => 'text/plain' },
      text: async () => 'Forbidden',
    }));
    const handler = handlers[METHOD_LIST_VULNS_FULL];
    await assert.rejects(
      () => handler(makeCtx()),
      (err) => err.message.includes('PERMISSION_DENIED')
    );
  });

  it('should throw UNAVAILABLE for network error', async () => {
    globalThis.fetch = mock.fn(async () => { throw new Error('ECONNREFUSED'); });
    const handler = handlers[METHOD_LIST_VULNS_FULL];
    await assert.rejects(
      () => handler(makeCtx()),
      (err) => err.message.includes('UNAVAILABLE')
    );
  });

  it('should throw INVALID_ARGUMENT for missing token', async () => {
    const ctxNoToken = {
      config: { endpoint: MOCK_BASE_URL },
      secret: {},
      req: {},
    };
    const handler = handlers[METHOD_LIST_VULNS_FULL];
    await assert.rejects(
      () => handler(ctxNoToken),
      (err) => err.message.includes('INVALID_ARGUMENT') && err.message.includes('token')
    );
  });

  it('should throw INVALID_ARGUMENT for missing endpoint', async () => {
    const ctxNoEndpoint = {
      config: {},
      secret: { apiToken: 'test' },
      req: {},
    };
    const handler = handlers[METHOD_LIST_VULNS_FULL];
    await assert.rejects(
      () => handler(ctxNoEndpoint),
      (err) => err.message.includes('INVALID_ARGUMENT') && err.message.includes('endpoint')
    );
  });

  it('should throw INVALID_ARGUMENT for invalid status in UpdateVulnStatus', async () => {
    globalThis.fetch = mock.fn(async () => createMockResponse({ status: 201 }));
    const handler = handlers[METHOD_UPDATE_VULN_STATUS_FULL];
    await assert.rejects(
      () => handler(makeCtx({ id: 1, status: 'invalid_status' })),
      (err) => err.message.includes('INVALID_ARGUMENT') && err.message.includes('status')
    );
  });
});

// ============ Config/Secret Binding Tests ============

describe('Config/Secret Binding', () => {
  it('should use endpoint from config', () => {
    const bindings = mergedBindings({ config: { endpoint: 'http://dt.local:9090' }, secret: { apiToken: 'abc' } });
    assert.equal(bindings.endpoint, 'http://dt.local:9090');
    assert.equal(bindings.apiToken, 'abc');
  });

  it('should support legacy baseUrl alias', () => {
    const bindings = mergedBindings({ config: { baseUrl: 'http://dt.local:9090' }, secret: {} });
    assert.equal(bindings.baseUrl, 'http://dt.local:9090');
  });

  it('should prefer endpoint over baseUrl', () => {
    const bindings = mergedBindings({ config: { endpoint: 'http://first:9090', baseUrl: 'http://second:9090' }, secret: {} });
    const url = normalizeBaseUrl(bindings.endpoint || bindings.baseUrl);
    assert.equal(url, 'http://first:9090');
  });
});

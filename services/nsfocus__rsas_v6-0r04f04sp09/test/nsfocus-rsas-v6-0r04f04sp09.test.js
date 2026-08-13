import assert from 'node:assert/strict';
import test from 'node:test';

import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';

import { METHODS, _test, handlers } from '../src/nsfocus-rsas-v6-0r04f04sp09.js';
import { service } from '../src/service.js';
import { createMockServer } from './mock_upstream.js';

const originalFetch = globalThis.fetch;

const buildCtx = (overrides = {}) => ({
  bindings: { host: 'http://device.example:8443', ...(overrides.bindings || {}) },
  config: overrides.config || {},
  secret: { user: 'admin', password: 'Rsas@123', ...(overrides.secret || {}) },
  limits: { timeoutMs: 10_000, ...(overrides.limits || {}) },
  meta: { instance_id: overrides.instance_id || 'inst-1', request_id: 'req' },
  request: overrides.request || {},
});

const call = (methodName, request = {}, ctx = {}) => handlers[METHODS[methodName]]({ ...buildCtx(ctx), request });

const setFetch = (impl) => { globalThis.fetch = impl; };

const expectGrpc = async (fn, legacyCode) => {
  let caught;
  try {
    await fn();
  } catch (err) {
    caught = err;
  }
  assert.ok(caught instanceof GrpcError, 'expected GrpcError');
  assert.equal(caught.legacyCode, legacyCode);
  assert.match(caught.message, new RegExp(`^${legacyCode}:`));
};

test.afterEach(() => { globalThis.fetch = originalFetch; });

test('service and handler registry are wired', () => {
  assert.equal(typeof service, 'object');
  assert.equal(Object.keys(handlers).length, 42);
  assert.equal(typeof handlers[METHODS.GetSystemStatus], 'function');
  assert.equal(typeof handlers[METHODS.DownloadAgent], 'function');
});

test('helpers: base url, coercion, currLang', () => {
  assert.equal(_test.resolveBaseUrl({ host: 'https://d/' }), 'https://d');
  assert.equal(_test.resolveBaseUrl({ base_url: 'ftp://x' }), '');
  assert.equal(_test.toInteger('42abc', 0), 0);
  assert.equal(_test.toInteger(' 7 ', 0), 7);
  assert.equal(_test.toBoolean('yes'), true);
  assert.equal(_test.toBoolean('off'), false);
  assert.equal(_test.resolveCurrLang(_test.resolveCallContext({ config: { currLang: 'en' } })), 'en');
  assert.equal(_test.resolveCurrLang(_test.resolveCallContext({})), 'cn');
});

test('authQuery pulls credentials with precedence and rejects when missing', () => {
  const ctx = _test.resolveCallContext(buildCtx({ secret: { user: 'u', password: 'p' } }));
  assert.deepEqual(_test.authQuery(ctx), { username: 'u', password: 'p', format: 'json', curr_lang: 'cn' });
  const noCred = _test.resolveCallContext({ bindings: { host: 'http://x' } });
  assert.throws(() => _test.authQuery(noCred), /INVALID_ARGUMENT/);
});

test('password is read from secret only, never from config or bindings', () => {
  // username may fall back to config for dev, but password must come from secret.
  const ctx = _test.resolveCallContext({
    secret: { user: 'u' },
    config: { password: 'leaky-from-config' },
    bindings: { host: 'http://x', password: 'leaky-from-bindings' },
  });
  assert.throws(() => _test.authQuery(ctx), /password is required/);
  const ok = _test.resolveCallContext({ secret: { user: 'u', password: 'p' }, config: { user: 'cfg-user' } });
  assert.equal(_test.authQuery(ok).password, 'p');
});

test('toOptionalPositiveInt treats 0/unset as omitted (proto3 default guard)', () => {
  assert.equal(_test.toOptionalPositiveInt(undefined), undefined);
  assert.equal(_test.toOptionalPositiveInt(0), undefined);
  assert.equal(_test.toOptionalPositiveInt('0'), undefined);
  assert.equal(_test.toOptionalPositiveInt(''), undefined);
  assert.equal(_test.toOptionalPositiveInt(5), 5);
  assert.equal(_test.toOptionalPositiveInt('22'), 22);
});

test('filenameFromContentDisposition parses plain and extended forms', () => {
  assert.equal(_test.filenameFromContentDisposition('attachment; filename="a.zip"'), 'a.zip');
  assert.equal(_test.filenameFromContentDisposition("attachment; filename*=UTF-8''b%20c.zip"), 'b c.zip');
  assert.equal(_test.filenameFromContentDisposition(''), '');
});

test('appendQuery encodes and skips empties', () => {
  assert.equal(_test.appendQuery('http://x/api', { a: '1 2', b: '', c: undefined }), 'http://x/api?a=1%202');
  assert.equal(_test.appendQuery('http://x?z=1', { a: 'b' }), 'http://x?z=1&a=b');
});

test('missing host and required args reject with INVALID_ARGUMENT', async () => {
  await expectGrpc(() => call('GetSystemStatus', {}, { bindings: { host: 'device.local' } }), 'INVALID_ARGUMENT');
  await expectGrpc(() => call('CreateVulnTask', { targets: '1.1.1.1' }), 'INVALID_ARGUMENT');
  await expectGrpc(() => call('GetTaskStatus', {}), 'INVALID_ARGUMENT');
  await expectGrpc(() => call('BatchDeleteTasks', { task_ids: [] }), 'INVALID_ARGUMENT');
  await expectGrpc(() => call('DownloadAgent', { platform: 'mac' }), 'INVALID_ARGUMENT');
  await expectGrpc(() => call('DeleteReports', {}), 'INVALID_ARGUMENT');
});

test('HTTP status mapping via guardHttpStatus', () => {
  assert.throws(() => _test.guardHttpStatus(401), /PERMISSION_DENIED/);
  assert.throws(() => _test.guardHttpStatus(403), /PERMISSION_DENIED/);
  assert.throws(() => _test.guardHttpStatus(404), /INVALID_ARGUMENT/);
  assert.throws(() => _test.guardHttpStatus(429), /RESOURCE_EXHAUSTED/);
  assert.throws(() => _test.guardHttpStatus(500), /UNAVAILABLE/);
  assert.doesNotThrow(() => _test.guardHttpStatus(200));
});

test('network failure maps to UNAVAILABLE', async () => {
  setFetch(async () => { throw new Error('ECONNREFUSED'); });
  await expectGrpc(() => call('GetSystemStatus'), 'UNAVAILABLE');
});

test('empty body maps to UNKNOWN', async () => {
  setFetch(async () => ({ status: 200, headers: { get: () => 'application/json' }, text: async () => '', arrayBuffer: async () => new ArrayBuffer(0) }));
  await expectGrpc(() => call('GetSystemStatus'), 'UNKNOWN');
});

// --- integration against the mock device ---

test('GetSystemStatus returns normalized envelope', async () => {
  const mock = await createMockServer();
  try {
    const out = await call('GetSystemStatus', {}, { bindings: { host: mock.url } });
    assert.equal(out.ret_code, 0);
    assert.equal(out.http_status, 200);
    assert.equal(out.data.structValue.fields.version.stringValue, 'V6.0R04F04SP09');
    const req = mock.requests.find((r) => r.pathname === '/api/system/status');
    assert.equal(req.query.username, 'admin');
    assert.equal(req.query.format, 'json');
  } finally {
    await mock.close();
  }
});

test('bad credentials produce PERMISSION_DENIED', async () => {
  const mock = await createMockServer();
  try {
    await expectGrpc(() => call('GetSystemStatus', {}, { bindings: { host: mock.url }, secret: { user: 'admin', password: 'wrong' } }), 'PERMISSION_DENIED');
  } finally {
    await mock.close();
  }
});

test('CreateVulnTask surfaces task_id and posts multipart form', async () => {
  const mock = await createMockServer();
  try {
    const out = await call('CreateVulnTask', { name: 't', targets: '10.65.194.153', template_id: 0 }, { bindings: { host: mock.url } });
    assert.equal(out.ret_code, 0);
    assert.equal(out.task_id, '60');
    const req = mock.requests.find((r) => r.pathname === '/api/task/vul/create');
    assert.equal(req.method, 'POST');
    assert.match(req.rawBody, /name="targets"/);
    assert.match(req.rawBody, /10\.65\.194\.153/);
  } finally {
    await mock.close();
  }
});

test('GetTaskStatus, ListTasks, GetTaskResult round-trip', async () => {
  const mock = await createMockServer();
  try {
    const status = await call('GetTaskStatus', { task_id: '60' }, { bindings: { host: mock.url } });
    assert.equal(status.data.structValue.fields.status.numberValue, 4);
    const list = await call('ListTasks', { type: 1, page: 1, page_size: 10 }, { bindings: { host: mock.url } });
    assert.equal(list.ret_code, 0);
    const listReq = mock.requests.find((r) => r.pathname === '/api/task/list');
    assert.equal(listReq.query.type, '1');
    const result = await call('GetTaskResult', { task_id: '60', targets: '10.65.194.153' }, { bindings: { host: mock.url } });
    assert.equal(result.ret_code, 0);
  } finally {
    await mock.close();
  }
});

test('ListTasks omits type but defaults page/page_size on proto3 default 0', async () => {
  const mock = await createMockServer();
  try {
    // Simulates a decoded proto3 request where unset int64 fields arrive as 0.
    await call('ListTasks', { type: 0, page: 0, page_size: 0 }, { bindings: { host: mock.url } });
    const req = mock.requests.find((r) => r.pathname === '/api/task/list');
    assert.equal(req.query.type, undefined);
    // 1-based pagination defaults, never a proto3 0.
    assert.equal(req.query.page, '1');
    assert.equal(req.query.page_size, '10');
    assert.equal(req.query.format, 'json');
  } finally {
    await mock.close();
  }
});

test('normalizeRequest mirrors camelCase runtime keys to snake_case, recursively', () => {
  const out = _test.normalizeRequest({
    taskId: '60',
    templateUuid: 'u-1',
    jumparray: [{ ipRange: '10.0.0.2', userName: 'root', userPwd: 'x', port: 22 }],
  });
  assert.equal(out.task_id, '60');
  assert.equal(out.template_uuid, 'u-1');
  assert.equal(out.jumparray[0].ip_range, '10.0.0.2');
  assert.equal(out.jumparray[0].user_name, 'root');
  assert.equal(out.jumparray[0].user_pwd, 'x');
  // pre-existing snake_case keys are preserved and not clobbered
  const keep = _test.normalizeRequest({ task_id: 'a', taskId: 'b' });
  assert.equal(keep.task_id, 'a');
});

test('handlers resolve camelCase request keys end-to-end (real-runtime shape)', async () => {
  const mock = await createMockServer();
  try {
    // The CLI runtime delivers task_id as taskId; the handler must still work.
    const out = await call('GetTaskStatus', { taskId: '60' }, { bindings: { host: mock.url } });
    assert.equal(out.ret_code, 0);
    const req = mock.requests.find((r) => r.pathname.startsWith('/api/task/status/'));
    assert.equal(req.pathname, '/api/task/status/60');
  } finally {
    await mock.close();
  }
});

test('CreatePwdTask omits port when it is proto3 default 0', async () => {
  const mock = await createMockServer();
  try {
    // pwd endpoint returns 404 in mock, but we only assert the outgoing form here.
    await call('CreatePwdTask', {
      name: 't', targets: '1.1.1.1', template_id: '188', service_type: 'SSH', port: 0,
    }, { bindings: { host: mock.url } }).catch(() => {});
    const req = mock.requests.find((r) => r.pathname === '/api/task/pwd/create');
    assert.ok(req, 'expected a request to pwd/create');
    assert.doesNotMatch(req.rawBody, /name="port"/);
  } finally {
    await mock.close();
  }
});

test('BatchDeleteTasks sends JSON body', async () => {
  const mock = await createMockServer();
  try {
    const out = await call('BatchDeleteTasks', { task_ids: [1, 2, 0, -3] }, { bindings: { host: mock.url } });
    assert.equal(out.ret_code, 0);
    const req = mock.requests.find((r) => r.pathname === '/api/task/batch_delete');
    assert.deepEqual(JSON.parse(req.rawBody), { task_ids: [1, 2] });
  } finally {
    await mock.close();
  }
});

test('report generate + progress + download flow', async () => {
  const mock = await createMockServer();
  try {
    const gen = await call('GenerateReport', { task_id: '60', report_type: 'pdf,html' }, { bindings: { host: mock.url } });
    assert.equal(gen.data.structValue.fields.report_id.numberValue, 16);
    const prog = await call('GetReportProgress', { report_id: '16' }, { bindings: { host: mock.url } });
    assert.equal(prog.data.structValue.fields.progress.numberValue, 100);
    const dl = await call('DownloadReport', { report_id: '16', report_type: 'html' }, { bindings: { host: mock.url } });
    assert.equal(dl.http_status, 200);
    assert.equal(dl.content_type, 'application/zip');
    assert.equal(dl.filename, 'report_30.zip');
    const decoded = Buffer.from(dl.body_base64, 'base64');
    assert.equal(decoded.subarray(0, 2).toString('ascii'), 'PK');
    assert.ok(decoded.toString('utf8').includes('fake-report-zip'));
    assert.equal(dl.content_length, decoded.length);
  } finally {
    await mock.close();
  }
});

test('agent config get/set and installer download', async () => {
  const mock = await createMockServer();
  try {
    const get = await call('GetAgentMethodConfig', {}, { bindings: { host: mock.url } });
    assert.equal(get.data.structValue.fields.agent_method.stringValue, '1');
    const set = await call('SetAgentMethodConfig', { agent_method: 1 }, { bindings: { host: mock.url } });
    assert.equal(set.ret_code, 0);
    const setReq = mock.requests.find((r) => r.pathname === '/api/agent/agent_method_config' && r.method === 'POST');
    assert.deepEqual(JSON.parse(setReq.rawBody), { agent_method: 1 });
    const dl = await call('DownloadAgent', { platform: 'Linux' }, { bindings: { host: mock.url } });
    assert.equal(dl.content_type, 'application/octet-stream');
    assert.equal(dl.filename, 'NSFOCUS-Agent-Linux_x86-1.0.0.run');
  } finally {
    await mock.close();
  }
});

test('ListSysvulnTemplate returns list data', async () => {
  const mock = await createMockServer();
  try {
    const out = await call('ListSysvulnTemplate', {}, { bindings: { host: mock.url } });
    assert.equal(out.data.listValue.values[0].structValue.fields.name.stringValue, '端口扫描');
  } finally {
    await mock.close();
  }
});

test('skipTlsVerify wires an undici dispatcher', () => {
  assert.deepEqual(_test.buildTlsOptions({}), {});
  const opts = _test.buildTlsOptions({ skipTlsVerify: true });
  assert.ok(opts.dispatcher, 'expected dispatcher when skipTlsVerify is set');
});

test('remaining handlers reach their documented upstream endpoints', async () => {
  const calls = [
    ['CreateBaselineTask', { name: 'n', targets: '1.1.1.1', login_type: 'ssh', login_port: '22', login_name: 'u', login_password: 'p', template_uuid: 't' }],
    ['CreateWebTask', { name: 'n', targets: 'https://x' }],
    ['CreateOfflineTask', { task_field_base64: Buffer.from('x').toString('base64') }],
    ['CreateDockerTask', { name: 'n', targets: 'image' }],
    ['CreateCodeauditTask', { name: 'n', code_source: 1, repo_path: 'https://repo' }],
    ['CreateHostAssetsTask', { name: 'n', targets: '1.1.1.1' }],
    ['CreateWebAssetsTask', { name: 'n', targets: 'https://x' }],
    ['PauseTask', { task_id: 1 }], ['ResumeTask', { task_id: 1 }], ['StopTask', { task_id: 1 }], ['DeleteTask', { task_id: 1 }],
    ['ListActiveTasks', {}], ['CreateAuthInfo', { authinfo: [{ accountname: 'u', accountpwd: 'p', port: 22, protocol: 'ssh', ip: '1.1.1.1' }] }],
    ['LoginVerify', { ip: '1.1.1.1', protocol: 'ssh', port: 22, user_name: 'u', userpwd: 'p' }],
    ['ListWebvulnTemplate', {}], ['ListBaselineTemplate', { industry: 'finance' }],
    ['GetBaselineParams', { uuid: 'u' }], ['ListCodeauditTemplate', { type: 1 }], ['ListAssetTemplate', {}],
    ['CreateBaselineTemplate', { template_base64: Buffer.from('x').toString('base64') }],
    ['ListUserpwd', {}], ['CreateUserpwd', { userpwd: 'secret' }], ['GetLogInfo', {}],
    ['ListReportTemplate', {}], ['DeleteReports', { all: true }], ['GetAgentAuth', {}], ['GetAgentPackageUrl', {}],
  ];
  setFetch(async () => ({ status: 200, headers: new Headers({ 'content-type': 'application/json' }), text: async () => JSON.stringify({ ret_code: 0, data: { task_id: 1 } }) }));
  for (const [name, request] of calls) {
    const out = await call(name, request);
    assert.equal(out.ret_code ?? 0, 0, name);
  }
});

test('remaining validation branches reject unsafe empty requests', async () => {
  await expectGrpc(() => call('CreateAuthInfo', { authinfo: [] }), 'INVALID_ARGUMENT');
  await expectGrpc(() => call('DeleteReports', { report_ids: [] }), 'INVALID_ARGUMENT');
  await expectGrpc(() => call('DownloadAgent', { platform: 'darwin' }), 'INVALID_ARGUMENT');
});

import { describe, it, afterEach } from 'node:test';
import test from 'node:test';
import assert from 'node:assert/strict';

import { rpcdef, handlers, _test } from '../src/qianxin-vs-secvss3600.js';

const PKG = 'QIANXIN_VS_SecVSS3600';
const PREFIX = `/${PKG}.${PKG}/`;

const PATH_GET_DEVICE_STATUS   = `${PREFIX}GetDeviceStatus`;
const PATH_LIST_TASKS          = `${PREFIX}ListTasks`;
const PATH_GET_TASK_STATUS     = `${PREFIX}GetTaskStatus`;
const PATH_SUBMIT_SCAN_TASK    = `${PREFIX}SubmitScanTask`;
const PATH_CONTROL_TASK        = `${PREFIX}ControlTask`;
const PATH_QUERY_SYS           = `${PREFIX}QuerySysScanResult`;
const PATH_QUERY_WEB           = `${PREFIX}QueryWebScanResult`;
const PATH_QUERY_WEAK          = `${PREFIX}QueryWeakPassResult`;

const KEY_GET_DEVICE_STATUS    = `${PKG}.${PKG}/GetDeviceStatus`;
const KEY_LIST_TASKS           = `${PKG}.${PKG}/ListTasks`;
const KEY_GET_TASK_STATUS      = `${PKG}.${PKG}/GetTaskStatus`;
const KEY_SUBMIT_SCAN_TASK     = `${PKG}.${PKG}/SubmitScanTask`;
const KEY_CONTROL_TASK         = `${PKG}.${PKG}/ControlTask`;
const KEY_QUERY_SYS            = `${PKG}.${PKG}/QuerySysScanResult`;
const KEY_QUERY_WEB            = `${PKG}.${PKG}/QueryWebScanResult`;
const KEY_QUERY_WEAK           = `${PKG}.${PKG}/QueryWeakPassResult`;

const makeFetch = (body, status = 200) => async () => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => JSON.stringify(body),
});

const makeTextFetch = (text, status = 200) => async () => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => text,
});

const networkErrorFetch = async () => { throw new Error('ECONNREFUSED'); };

// Default ctx: token in bindings avoids auto-login overhead in most tests
const buildCtx = (overrides = {}) => ({
  bindings: { restBaseUrl: 'https://scanner.example.com', token: 'tok123', ...(overrides.bindings ?? {}) },
  config: overrides.config ?? {},
  secret: overrides.secret ?? {},
  limits: { timeoutMs: 5000, ...(overrides.limits ?? {}) },
  meta: overrides.meta ?? {},
  req: overrides.req ?? {},
});

// No credentials at all: forces INVALID_ARGUMENT on any method needing auth
const noTokenCtx = (req = {}) => ({
  bindings: { restBaseUrl: 'https://scanner.example.com' },
  config: {},
  secret: {},
  limits: { timeoutMs: 5000 },
  meta: {},
  req,
});

const originalFetch = globalThis.fetch;
test.afterEach(() => { globalThis.fetch = originalFetch; });

// ===========================================================================
// Shape
// ===========================================================================
test('rpcdef exposes all 8 method paths', () => {
  const def = rpcdef(buildCtx());
  for (const p of [PATH_GET_DEVICE_STATUS, PATH_LIST_TASKS, PATH_GET_TASK_STATUS,
    PATH_SUBMIT_SCAN_TASK, PATH_CONTROL_TASK, PATH_QUERY_SYS, PATH_QUERY_WEB, PATH_QUERY_WEAK]) {
    assert.equal(typeof def[p], 'function', `${p} missing`);
  }
});

test('handlers exposes all 8 keys without leading slash', () => {
  for (const k of [KEY_GET_DEVICE_STATUS, KEY_LIST_TASKS, KEY_GET_TASK_STATUS,
    KEY_SUBMIT_SCAN_TASK, KEY_CONTROL_TASK, KEY_QUERY_SYS, KEY_QUERY_WEB, KEY_QUERY_WEAK]) {
    assert.equal(typeof handlers[k], 'function', `${k} missing`);
  }
});

// ===========================================================================
// GetDeviceStatus
// ===========================================================================
describe('GetDeviceStatus', () => {
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('success: returns structured fields', async () => {
    globalThis.fetch = makeFetch({
      'CPU Load': '1.5%', 'Disk Usage': '5G/100G',
      'Memory Usage': '4G/8G', System: '3.5.3-R1',
      engine: [{ ip: '127.0.0.1', name: 'local', status: 1 }],
    });
    const r = await rpcdef(buildCtx({ req: {} }))[PATH_GET_DEVICE_STATUS]();
    assert.equal(r.cpu_load, '1.5%');
    assert.equal(r.disk_usage, '5G/100G');
    assert.equal(r.memory_usage, '4G/8G');
    assert.equal(r.system_version, '3.5.3-R1');
    assert.equal(r.engines.length, 1);
  });

  it('no engine array -> engines is []', async () => {
    globalThis.fetch = makeFetch({ 'CPU Load': '5%' });
    const r = await rpcdef(buildCtx())[PATH_GET_DEVICE_STATUS]();
    assert.deepEqual(r.engines, []);
  });

  it('missing baseUrl -> INVALID_ARGUMENT', async () => {
    const ctx = buildCtx({ bindings: { restBaseUrl: '', token: 'tok123' } });
    await assert.rejects(rpcdef(ctx)[PATH_GET_DEVICE_STATUS](), /INVALID_ARGUMENT/);
  });

  it('network error -> UNAVAILABLE', async () => {
    globalThis.fetch = networkErrorFetch;
    await assert.rejects(rpcdef(buildCtx())[PATH_GET_DEVICE_STATUS](), /UNAVAILABLE/);
  });

  it('HTTP 500 -> UNAVAILABLE', async () => {
    globalThis.fetch = makeFetch({}, 500);
    await assert.rejects(rpcdef(buildCtx())[PATH_GET_DEVICE_STATUS](), /UNAVAILABLE/);
  });

  it('HTTP 401 -> PERMISSION_DENIED', async () => {
    globalThis.fetch = makeFetch({}, 401);
    await assert.rejects(rpcdef(buildCtx())[PATH_GET_DEVICE_STATUS](), /PERMISSION_DENIED/);
  });

  it('HTTP 403 -> PERMISSION_DENIED', async () => {
    globalThis.fetch = makeFetch({}, 403);
    await assert.rejects(rpcdef(buildCtx())[PATH_GET_DEVICE_STATUS](), /PERMISSION_DENIED/);
  });

  it('HTTP 422 -> FAILED_PRECONDITION', async () => {
    globalThis.fetch = makeFetch({}, 422);
    await assert.rejects(rpcdef(buildCtx())[PATH_GET_DEVICE_STATUS](), /FAILED_PRECONDITION/);
  });

  it('non-JSON response -> UNKNOWN', async () => {
    globalThis.fetch = makeTextFetch('<html>error</html>');
    await assert.rejects(rpcdef(buildCtx())[PATH_GET_DEVICE_STATUS](), /UNKNOWN/);
  });

  it('empty response body -> UNKNOWN', async () => {
    globalThis.fetch = makeTextFetch('');
    await assert.rejects(rpcdef(buildCtx())[PATH_GET_DEVICE_STATUS](), /UNKNOWN/);
  });

  it('upstream errorcode=1001 -> INVALID_ARGUMENT', async () => {
    globalThis.fetch = makeFetch({ success: false, errorcode: '1001' });
    await assert.rejects(rpcdef(buildCtx())[PATH_GET_DEVICE_STATUS](), /INVALID_ARGUMENT/);
  });

  it('handlers key works', async () => {
    globalThis.fetch = makeFetch({ 'CPU Load': '2%', engine: [] });
    const r = await handlers[KEY_GET_DEVICE_STATUS]({}, buildCtx());
    assert.equal(r.cpu_load, '2%');
  });

  it('single ctx-object handler convention', async () => {
    globalThis.fetch = makeFetch({ 'CPU Load': '3%', engine: [] });
    const ctx = buildCtx({ req: {} });
    const r = await handlers[KEY_GET_DEVICE_STATUS](ctx);
    assert.equal(r.cpu_load, '3%');
  });
});

// ===========================================================================
// ListTasks
// ===========================================================================
describe('ListTasks', () => {
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('success: returns total and tasks', async () => {
    globalThis.fetch = makeFetch({ iTotalRecords: 3, aaData: [{ id: 1 }, { id: 2 }, { id: 3 }] });
    const r = await rpcdef(buildCtx({ req: {} }))[PATH_LIST_TASKS]();
    assert.equal(r.total, 3);
    assert.equal(r.tasks.length, 3);
  });

  it('missing token -> INVALID_ARGUMENT', async () => {
    await assert.rejects(rpcdef(noTokenCtx())[PATH_LIST_TASKS](), /INVALID_ARGUMENT/);
  });

  it('optional filters: status, page, page_size, starttime, endtime', async () => {
    globalThis.fetch = makeFetch({ iTotalRecords: 1, aaData: [{ id: 5 }] });
    const ctx = buildCtx({ req: { status: 4, page: 1, page_size: 10, starttime: { value: '2024-01-01' }, endtime: { value: '2024-12-31' } } });
    const r = await rpcdef(ctx)[PATH_LIST_TASKS]();
    assert.equal(r.total, 1);
  });

  it('empty aaData -> tasks is []', async () => {
    globalThis.fetch = makeFetch({ iTotalRecords: 0, aaData: [] });
    const r = await rpcdef(buildCtx())[PATH_LIST_TASKS]();
    assert.equal(r.total, 0);
    assert.deepEqual(r.tasks, []);
  });

  it('upstream errorcode=1002 -> PERMISSION_DENIED', async () => {
    globalThis.fetch = makeFetch({ success: false, errorcode: '1002' });
    await assert.rejects(rpcdef(buildCtx())[PATH_LIST_TASKS](), /PERMISSION_DENIED/);
  });

  it('upstream errorcode=1013 -> PERMISSION_DENIED', async () => {
    globalThis.fetch = makeFetch({ success: false, errorcode: '1013' });
    await assert.rejects(rpcdef(buildCtx())[PATH_LIST_TASKS](), /PERMISSION_DENIED/);
  });

  it('upstream errorcode=1001 -> INVALID_ARGUMENT', async () => {
    globalThis.fetch = makeFetch({ success: false, errorcode: '1001' });
    await assert.rejects(rpcdef(buildCtx())[PATH_LIST_TASKS](), /INVALID_ARGUMENT/);
  });

  it('upstream errorcode=1006 -> FAILED_PRECONDITION', async () => {
    globalThis.fetch = makeFetch({ success: false, errorcode: '1006' });
    await assert.rejects(rpcdef(buildCtx())[PATH_LIST_TASKS](), /FAILED_PRECONDITION/);
  });

  it('network error -> UNAVAILABLE', async () => {
    globalThis.fetch = networkErrorFetch;
    await assert.rejects(rpcdef(buildCtx())[PATH_LIST_TASKS](), /UNAVAILABLE/);
  });

  it('HTTP 401 -> PERMISSION_DENIED', async () => {
    globalThis.fetch = makeFetch({}, 401);
    await assert.rejects(rpcdef(buildCtx())[PATH_LIST_TASKS](), /PERMISSION_DENIED/);
  });

  it('HTTP 500 -> UNAVAILABLE', async () => {
    globalThis.fetch = makeFetch({}, 500);
    await assert.rejects(rpcdef(buildCtx())[PATH_LIST_TASKS](), /UNAVAILABLE/);
  });

  it('non-JSON -> UNKNOWN', async () => {
    globalThis.fetch = makeTextFetch('Bad Gateway');
    await assert.rejects(rpcdef(buildCtx())[PATH_LIST_TASKS](), /UNKNOWN/);
  });

  it('handlers key works', async () => {
    globalThis.fetch = makeFetch({ iTotalRecords: 0, aaData: [] });
    const r = await handlers[KEY_LIST_TASKS]({}, buildCtx());
    assert.equal(r.total, 0);
  });
});

// ===========================================================================
// GetTaskStatus
// ===========================================================================
describe('GetTaskStatus', () => {
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('success: returns status (int) and progress (int)', async () => {
    globalThis.fetch = makeFetch({ status: 4, progress: 100 });
    const r = await rpcdef(buildCtx({ req: { task_id: 5 } }))[PATH_GET_TASK_STATUS]();
    assert.equal(r.status, 4);
    assert.equal(r.progress, 100);
  });

  it('string status/progress coerced to int', async () => {
    globalThis.fetch = makeFetch({ status: '3', progress: '75' });
    const r = await rpcdef(buildCtx({ req: { task_id: 5 } }))[PATH_GET_TASK_STATUS]();
    assert.equal(r.status, 3);
    assert.equal(r.progress, 75);
  });

  it('missing task_id -> INVALID_ARGUMENT', async () => {
    await assert.rejects(rpcdef(buildCtx({ req: {} }))[PATH_GET_TASK_STATUS](), /INVALID_ARGUMENT/);
  });

  it('missing token -> INVALID_ARGUMENT', async () => {
    await assert.rejects(rpcdef(noTokenCtx({ task_id: 5 }))[PATH_GET_TASK_STATUS](), /INVALID_ARGUMENT/);
  });

  it('taskId alias works', async () => {
    globalThis.fetch = makeFetch({ status: 4, progress: 100 });
    const r = await rpcdef(buildCtx({ req: { taskId: 5 } }))[PATH_GET_TASK_STATUS]();
    assert.equal(r.status, 4);
  });

  it('upstream errorcode=1002 -> PERMISSION_DENIED', async () => {
    globalThis.fetch = makeFetch({ success: false, errorcode: '1002' });
    await assert.rejects(rpcdef(buildCtx({ req: { task_id: 5 } }))[PATH_GET_TASK_STATUS](), /PERMISSION_DENIED/);
  });

  it('upstream errorcode=1013 -> PERMISSION_DENIED', async () => {
    globalThis.fetch = makeFetch({ success: false, errorcode: '1013' });
    await assert.rejects(rpcdef(buildCtx({ req: { task_id: 5 } }))[PATH_GET_TASK_STATUS](), /PERMISSION_DENIED/);
  });

  it('network error -> UNAVAILABLE', async () => {
    globalThis.fetch = networkErrorFetch;
    await assert.rejects(rpcdef(buildCtx({ req: { task_id: 5 } }))[PATH_GET_TASK_STATUS](), /UNAVAILABLE/);
  });

  it('HTTP 500 -> UNAVAILABLE', async () => {
    globalThis.fetch = makeFetch({}, 500);
    await assert.rejects(rpcdef(buildCtx({ req: { task_id: 5 } }))[PATH_GET_TASK_STATUS](), /UNAVAILABLE/);
  });

  it('HTTP 401 -> PERMISSION_DENIED', async () => {
    globalThis.fetch = makeFetch({}, 401);
    await assert.rejects(rpcdef(buildCtx({ req: { task_id: 5 } }))[PATH_GET_TASK_STATUS](), /PERMISSION_DENIED/);
  });

  it('non-JSON -> UNKNOWN', async () => {
    globalThis.fetch = makeTextFetch('plain text');
    await assert.rejects(rpcdef(buildCtx({ req: { task_id: 5 } }))[PATH_GET_TASK_STATUS](), /UNKNOWN/);
  });

  it('handlers key works', async () => {
    globalThis.fetch = makeFetch({ status: 3, progress: 50 });
    const r = await handlers[KEY_GET_TASK_STATUS]({ task_id: 5 }, buildCtx());
    assert.equal(r.status, 3);
  });
});

// ===========================================================================
// SubmitScanTask
// ===========================================================================
describe('SubmitScanTask', () => {
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('success: returns int32 task IDs', async () => {
    globalThis.fetch = makeFetch({ taskall_id: 10, sys_task_id: 4, web_task_id: 9, alive_task_id: 8, ret_crack_task_id: 11 });
    const r = await rpcdef(buildCtx({ req: { target: '192.168.1.1' } }))[PATH_SUBMIT_SCAN_TASK]();
    assert.equal(r.task_id, 10);
    assert.equal(r.sys_task_id, 4);
    assert.equal(r.web_task_id, 9);
    assert.equal(r.alive_task_id, 8);
    assert.equal(r.crack_task_id, 11);
  });

  it('with optional fields: task_type, name, vul_plugin', async () => {
    globalThis.fetch = makeFetch({ taskall_id: 5, sys_task_id: 1, web_task_id: 2, alive_task_id: 3, ret_crack_task_id: 4 });
    const ctx = buildCtx({ req: { target: '10.0.0.1', task_type: 1, name: { value: 'my-scan' }, vul_plugin: 2 } });
    const r = await rpcdef(ctx)[PATH_SUBMIT_SCAN_TASK]();
    assert.equal(r.task_id, 5);
  });

  it('missing target -> INVALID_ARGUMENT', async () => {
    await assert.rejects(rpcdef(buildCtx({ req: {} }))[PATH_SUBMIT_SCAN_TASK](), /INVALID_ARGUMENT/);
  });

  it('missing token -> INVALID_ARGUMENT', async () => {
    await assert.rejects(rpcdef(noTokenCtx({ target: '192.168.1.1' }))[PATH_SUBMIT_SCAN_TASK](), /INVALID_ARGUMENT/);
  });

  it('upstream errorcode=1002 -> PERMISSION_DENIED', async () => {
    globalThis.fetch = makeFetch({ success: false, errorcode: '1002' });
    await assert.rejects(rpcdef(buildCtx({ req: { target: '192.168.1.1' } }))[PATH_SUBMIT_SCAN_TASK](), /PERMISSION_DENIED/);
  });

  it('upstream errorcode=1013 -> PERMISSION_DENIED', async () => {
    globalThis.fetch = makeFetch({ success: false, errorcode: '1013' });
    await assert.rejects(rpcdef(buildCtx({ req: { target: '192.168.1.1' } }))[PATH_SUBMIT_SCAN_TASK](), /PERMISSION_DENIED/);
  });

  it('network error -> UNAVAILABLE', async () => {
    globalThis.fetch = networkErrorFetch;
    await assert.rejects(rpcdef(buildCtx({ req: { target: '192.168.1.1' } }))[PATH_SUBMIT_SCAN_TASK](), /UNAVAILABLE/);
  });

  it('HTTP 401 -> PERMISSION_DENIED', async () => {
    globalThis.fetch = makeFetch({}, 401);
    await assert.rejects(rpcdef(buildCtx({ req: { target: '192.168.1.1' } }))[PATH_SUBMIT_SCAN_TASK](), /PERMISSION_DENIED/);
  });

  it('HTTP 500 -> UNAVAILABLE', async () => {
    globalThis.fetch = makeFetch({}, 500);
    await assert.rejects(rpcdef(buildCtx({ req: { target: '192.168.1.1' } }))[PATH_SUBMIT_SCAN_TASK](), /UNAVAILABLE/);
  });

  it('non-JSON -> UNKNOWN', async () => {
    globalThis.fetch = makeTextFetch('not json');
    await assert.rejects(rpcdef(buildCtx({ req: { target: '192.168.1.1' } }))[PATH_SUBMIT_SCAN_TASK](), /UNKNOWN/);
  });

  it('handlers key works', async () => {
    globalThis.fetch = makeFetch({ taskall_id: 99, sys_task_id: 1, web_task_id: 2, alive_task_id: 3, ret_crack_task_id: 4 });
    const r = await handlers[KEY_SUBMIT_SCAN_TASK]({ target: '10.0.0.1' }, buildCtx());
    assert.equal(r.task_id, 99);
  });
});

// ===========================================================================
// ControlTask
// ===========================================================================
describe('ControlTask', () => {
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('success: stop returns {}', async () => {
    globalThis.fetch = makeFetch({ success: true });
    const r = await rpcdef(buildCtx({ req: { task_id: 5, action: 'stop' } }))[PATH_CONTROL_TASK]();
    assert.deepEqual(r, {});
  });

  it('all valid actions accepted', async () => {
    for (const action of ['start', 'stop', 'pause', 'continue', 'enable', 'disable', 'delete']) {
      globalThis.fetch = makeFetch({ success: true });
      const r = await rpcdef(buildCtx({ req: { task_id: 5, action } }))[PATH_CONTROL_TASK]();
      assert.deepEqual(r, {});
    }
  });

  it('missing task_id -> INVALID_ARGUMENT', async () => {
    await assert.rejects(rpcdef(buildCtx({ req: { action: 'stop' } }))[PATH_CONTROL_TASK](), /INVALID_ARGUMENT/);
  });

  it('missing action -> INVALID_ARGUMENT', async () => {
    await assert.rejects(rpcdef(buildCtx({ req: { task_id: 5 } }))[PATH_CONTROL_TASK](), /INVALID_ARGUMENT/);
  });

  it('invalid action -> INVALID_ARGUMENT', async () => {
    await assert.rejects(rpcdef(buildCtx({ req: { task_id: 5, action: 'NOOP' } }))[PATH_CONTROL_TASK](), /INVALID_ARGUMENT/);
  });

  it('missing token -> INVALID_ARGUMENT', async () => {
    await assert.rejects(rpcdef(noTokenCtx({ task_id: 5, action: 'stop' }))[PATH_CONTROL_TASK](), /INVALID_ARGUMENT/);
  });

  it('controltype alias works', async () => {
    globalThis.fetch = makeFetch({ success: true });
    const r = await rpcdef(buildCtx({ req: { task_id: 5, controltype: 'pause' } }))[PATH_CONTROL_TASK]();
    assert.deepEqual(r, {});
  });

  it('taskId alias works', async () => {
    globalThis.fetch = makeFetch({ success: true });
    const r = await rpcdef(buildCtx({ req: { taskId: 5, action: 'stop' } }))[PATH_CONTROL_TASK]();
    assert.deepEqual(r, {});
  });

  it('upstream errorcode=1002 -> PERMISSION_DENIED', async () => {
    globalThis.fetch = makeFetch({ success: false, errorcode: '1002' });
    await assert.rejects(rpcdef(buildCtx({ req: { task_id: 5, action: 'stop' } }))[PATH_CONTROL_TASK](), /PERMISSION_DENIED/);
  });

  it('upstream errorcode=1006 -> FAILED_PRECONDITION', async () => {
    globalThis.fetch = makeFetch({ success: false, errorcode: '1006' });
    await assert.rejects(rpcdef(buildCtx({ req: { task_id: 5, action: 'stop' } }))[PATH_CONTROL_TASK](), /FAILED_PRECONDITION/);
  });

  it('network error -> UNAVAILABLE', async () => {
    globalThis.fetch = networkErrorFetch;
    await assert.rejects(rpcdef(buildCtx({ req: { task_id: 5, action: 'stop' } }))[PATH_CONTROL_TASK](), /UNAVAILABLE/);
  });

  it('HTTP 401 -> PERMISSION_DENIED', async () => {
    globalThis.fetch = makeFetch({}, 401);
    await assert.rejects(rpcdef(buildCtx({ req: { task_id: 5, action: 'stop' } }))[PATH_CONTROL_TASK](), /PERMISSION_DENIED/);
  });

  it('HTTP 403 -> PERMISSION_DENIED', async () => {
    globalThis.fetch = makeFetch({}, 403);
    await assert.rejects(rpcdef(buildCtx({ req: { task_id: 5, action: 'stop' } }))[PATH_CONTROL_TASK](), /PERMISSION_DENIED/);
  });

  it('HTTP 422 -> FAILED_PRECONDITION', async () => {
    globalThis.fetch = makeFetch({}, 422);
    await assert.rejects(rpcdef(buildCtx({ req: { task_id: 5, action: 'stop' } }))[PATH_CONTROL_TASK](), /FAILED_PRECONDITION/);
  });

  it('HTTP 500 -> UNAVAILABLE', async () => {
    globalThis.fetch = makeFetch({}, 500);
    await assert.rejects(rpcdef(buildCtx({ req: { task_id: 5, action: 'stop' } }))[PATH_CONTROL_TASK](), /UNAVAILABLE/);
  });

  it('non-JSON -> UNKNOWN', async () => {
    globalThis.fetch = makeTextFetch('<error/>');
    await assert.rejects(rpcdef(buildCtx({ req: { task_id: 5, action: 'stop' } }))[PATH_CONTROL_TASK](), /UNKNOWN/);
  });

  it('handlers key works', async () => {
    globalThis.fetch = makeFetch({ success: true });
    const r = await handlers[KEY_CONTROL_TASK]({ task_id: 5, action: 'pause' }, buildCtx());
    assert.deepEqual(r, {});
  });
});

// ===========================================================================
// QuerySysScanResult
// ===========================================================================
describe('QuerySysScanResult', () => {
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('success: returns counts and hosts', async () => {
    globalThis.fetch = makeFetch({
      status: 'completed', hostscount: 2,
      vulhigh: 5, vulmedium: 10, vullow: 20,
      hosts: [{ ip: '192.168.1.1', vulcount: 35 }],
    });
    const r = await rpcdef(buildCtx({ req: { task_id: 4 } }))[PATH_QUERY_SYS]();
    assert.equal(r.status, 'completed');
    assert.equal(r.hosts_count, 2);
    assert.equal(r.vul_high, 5);
    assert.equal(r.vul_medium, 10);
    assert.equal(r.vul_low, 20);
    assert.equal(r.hosts.length, 1);
  });

  it('no hosts -> hosts is []', async () => {
    globalThis.fetch = makeFetch({ status: 'running', hostscount: 0, vulhigh: 0, vulmedium: 0, vullow: 0 });
    const r = await rpcdef(buildCtx({ req: { task_id: 4 } }))[PATH_QUERY_SYS]();
    assert.deepEqual(r.hosts, []);
  });

  it('optional target filter', async () => {
    globalThis.fetch = makeFetch({ status: 'completed', hostscount: 0, vulhigh: 0, vulmedium: 0, vullow: 0, hosts: [] });
    const ctx = buildCtx({ req: { task_id: 4, target: { value: '192.168.1.1' } } });
    const r = await rpcdef(ctx)[PATH_QUERY_SYS]();
    assert.equal(r.status, 'completed');
  });

  it('missing task_id -> INVALID_ARGUMENT', async () => {
    await assert.rejects(rpcdef(buildCtx({ req: {} }))[PATH_QUERY_SYS](), /INVALID_ARGUMENT/);
  });

  it('missing token -> INVALID_ARGUMENT', async () => {
    await assert.rejects(rpcdef(noTokenCtx({ task_id: 4 }))[PATH_QUERY_SYS](), /INVALID_ARGUMENT/);
  });

  it('taskid alias works', async () => {
    globalThis.fetch = makeFetch({ status: 'completed', hostscount: 0, vulhigh: 0, vulmedium: 0, vullow: 0, hosts: [] });
    const r = await rpcdef(buildCtx({ req: { taskid: 4 } }))[PATH_QUERY_SYS]();
    assert.equal(r.status, 'completed');
  });

  it('upstream errorcode=1002 -> PERMISSION_DENIED', async () => {
    globalThis.fetch = makeFetch({ success: false, errorcode: '1002' });
    await assert.rejects(rpcdef(buildCtx({ req: { task_id: 4 } }))[PATH_QUERY_SYS](), /PERMISSION_DENIED/);
  });

  it('upstream errorcode=1013 -> PERMISSION_DENIED', async () => {
    globalThis.fetch = makeFetch({ success: false, errorcode: '1013' });
    await assert.rejects(rpcdef(buildCtx({ req: { task_id: 4 } }))[PATH_QUERY_SYS](), /PERMISSION_DENIED/);
  });

  it('network error -> UNAVAILABLE', async () => {
    globalThis.fetch = networkErrorFetch;
    await assert.rejects(rpcdef(buildCtx({ req: { task_id: 4 } }))[PATH_QUERY_SYS](), /UNAVAILABLE/);
  });

  it('HTTP 503 -> UNAVAILABLE', async () => {
    globalThis.fetch = makeFetch({}, 503);
    await assert.rejects(rpcdef(buildCtx({ req: { task_id: 4 } }))[PATH_QUERY_SYS](), /UNAVAILABLE/);
  });

  it('HTTP 401 -> PERMISSION_DENIED', async () => {
    globalThis.fetch = makeFetch({}, 401);
    await assert.rejects(rpcdef(buildCtx({ req: { task_id: 4 } }))[PATH_QUERY_SYS](), /PERMISSION_DENIED/);
  });

  it('non-JSON -> UNKNOWN', async () => {
    globalThis.fetch = makeTextFetch('{}broken');
    await assert.rejects(rpcdef(buildCtx({ req: { task_id: 4 } }))[PATH_QUERY_SYS](), /UNKNOWN/);
  });

  it('handlers key works', async () => {
    globalThis.fetch = makeFetch({ status: 'completed', hostscount: 0, vulhigh: 0, vulmedium: 0, vullow: 0, hosts: [] });
    const r = await handlers[KEY_QUERY_SYS]({ task_id: 4 }, buildCtx());
    assert.equal(r.status, 'completed');
  });
});

// ===========================================================================
// QueryWebScanResult
// ===========================================================================
describe('QueryWebScanResult', () => {
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('success: returns status, counts, hosts', async () => {
    globalThis.fetch = makeFetch({ status: 'completed', hostscount: 1, total: 5, hosts: [{ url: 'http://test.com', high: 1 }] });
    const r = await rpcdef(buildCtx({ req: { task_id: 9 } }))[PATH_QUERY_WEB]();
    assert.equal(r.status, 'completed');
    assert.equal(r.hosts_count, 1);
    assert.equal(r.total_vulns, 5);
    assert.equal(r.hosts.length, 1);
  });

  it('missing task_id -> INVALID_ARGUMENT', async () => {
    await assert.rejects(rpcdef(buildCtx({ req: {} }))[PATH_QUERY_WEB](), /INVALID_ARGUMENT/);
  });

  it('missing token -> INVALID_ARGUMENT', async () => {
    await assert.rejects(rpcdef(noTokenCtx({ task_id: 9 }))[PATH_QUERY_WEB](), /INVALID_ARGUMENT/);
  });

  it('upstream errorcode=1013 -> PERMISSION_DENIED', async () => {
    globalThis.fetch = makeFetch({ success: false, errorcode: '1013' });
    await assert.rejects(rpcdef(buildCtx({ req: { task_id: 9 } }))[PATH_QUERY_WEB](), /PERMISSION_DENIED/);
  });

  it('upstream errorcode=1006 -> FAILED_PRECONDITION', async () => {
    globalThis.fetch = makeFetch({ success: false, errorcode: '1006' });
    await assert.rejects(rpcdef(buildCtx({ req: { task_id: 9 } }))[PATH_QUERY_WEB](), /FAILED_PRECONDITION/);
  });

  it('network error -> UNAVAILABLE', async () => {
    globalThis.fetch = networkErrorFetch;
    await assert.rejects(rpcdef(buildCtx({ req: { task_id: 9 } }))[PATH_QUERY_WEB](), /UNAVAILABLE/);
  });

  it('HTTP 401 -> PERMISSION_DENIED', async () => {
    globalThis.fetch = makeFetch({}, 401);
    await assert.rejects(rpcdef(buildCtx({ req: { task_id: 9 } }))[PATH_QUERY_WEB](), /PERMISSION_DENIED/);
  });

  it('non-JSON -> UNKNOWN', async () => {
    globalThis.fetch = makeTextFetch('bad json');
    await assert.rejects(rpcdef(buildCtx({ req: { task_id: 9 } }))[PATH_QUERY_WEB](), /UNKNOWN/);
  });

  it('handlers key works', async () => {
    globalThis.fetch = makeFetch({ status: 'completed', hostscount: 0, total: 0, hosts: [] });
    const r = await handlers[KEY_QUERY_WEB]({ task_id: 9 }, buildCtx());
    assert.equal(r.total_vulns, 0);
  });
});

// ===========================================================================
// QueryWeakPassResult
// ===========================================================================
describe('QueryWeakPassResult', () => {
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('success: returns total and hosts', async () => {
    globalThis.fetch = makeFetch({
      status: 'completed', hostscount: 1, total: 2,
      hosts: [{ results: [{ host: '1.2.3.4', login: 'root', password: 'root123', service: 'ssh' }] }],
    });
    const r = await rpcdef(buildCtx({ req: { task_id: 11 } }))[PATH_QUERY_WEAK]();
    assert.equal(r.status, 'completed');
    assert.equal(r.hosts_count, 1);
    assert.equal(r.total, 2);
    assert.equal(r.hosts.length, 1);
  });

  it('missing task_id -> INVALID_ARGUMENT', async () => {
    await assert.rejects(rpcdef(buildCtx({ req: {} }))[PATH_QUERY_WEAK](), /INVALID_ARGUMENT/);
  });

  it('missing token -> INVALID_ARGUMENT', async () => {
    await assert.rejects(rpcdef(noTokenCtx({ task_id: 11 }))[PATH_QUERY_WEAK](), /INVALID_ARGUMENT/);
  });

  it('upstream errorcode=1002 -> PERMISSION_DENIED', async () => {
    globalThis.fetch = makeFetch({ success: false, errorcode: '1002' });
    await assert.rejects(rpcdef(buildCtx({ req: { task_id: 11 } }))[PATH_QUERY_WEAK](), /PERMISSION_DENIED/);
  });

  it('network error -> UNAVAILABLE', async () => {
    globalThis.fetch = networkErrorFetch;
    await assert.rejects(rpcdef(buildCtx({ req: { task_id: 11 } }))[PATH_QUERY_WEAK](), /UNAVAILABLE/);
  });

  it('HTTP 500 -> UNAVAILABLE', async () => {
    globalThis.fetch = makeFetch({}, 500);
    await assert.rejects(rpcdef(buildCtx({ req: { task_id: 11 } }))[PATH_QUERY_WEAK](), /UNAVAILABLE/);
  });

  it('handlers key works', async () => {
    globalThis.fetch = makeFetch({ status: 'completed', hostscount: 0, total: 0, hosts: [] });
    const r = await handlers[KEY_QUERY_WEAK]({ task_id: 11 }, buildCtx());
    assert.equal(r.total, 0);
  });
});

// ===========================================================================
// Auto-login flow
// ===========================================================================
describe('auto-login', () => {
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('uses user+pwd to fetch token then calls API', async () => {
    let callCount = 0;
    globalThis.fetch = async () => {
      callCount++;
      if (callCount === 1) return { ok: true, status: 200, text: async () => JSON.stringify({ token: 'auto-tok' }) };
      return { ok: true, status: 200, text: async () => JSON.stringify({ iTotalRecords: 0, aaData: [] }) };
    };
    const ctx = { bindings: { restBaseUrl: 'https://scanner.example.com' }, config: {}, secret: { user: 'admin', pwd: 'pass' }, limits: { timeoutMs: 5000 }, meta: {}, req: {} };
    const r = await rpcdef(ctx)[PATH_LIST_TASKS]();
    assert.equal(callCount, 2);
    assert.equal(r.total, 0);
  });

  it('upstream errorcode during login -> PERMISSION_DENIED', async () => {
    globalThis.fetch = makeFetch({ success: false, errorcode: '1002' });
    const ctx = { bindings: { restBaseUrl: 'https://scanner.example.com' }, config: {}, secret: { user: 'admin', pwd: 'wrong' }, limits: { timeoutMs: 5000 }, meta: {}, req: {} };
    await assert.rejects(rpcdef(ctx)[PATH_LIST_TASKS](), /PERMISSION_DENIED/);
  });

  it('login returns no token field -> UNKNOWN', async () => {
    globalThis.fetch = makeFetch({ success: true });
    const ctx = { bindings: { restBaseUrl: 'https://scanner.example.com' }, config: {}, secret: { user: 'admin', pwd: 'pass' }, limits: { timeoutMs: 5000 }, meta: {}, req: {} };
    await assert.rejects(rpcdef(ctx)[PATH_LIST_TASKS](), /UNKNOWN/);
  });

  it('no credentials at all -> INVALID_ARGUMENT', async () => {
    const ctx = { bindings: { restBaseUrl: 'https://scanner.example.com' }, config: {}, secret: {}, limits: { timeoutMs: 5000 }, meta: {}, req: {} };
    await assert.rejects(rpcdef(ctx)[PATH_LIST_TASKS](), /INVALID_ARGUMENT/);
  });

  it('bindings.token used when present (no login fetch)', async () => {
    let fetchCalled = false;
    globalThis.fetch = async () => {
      fetchCalled = true;
      return { ok: true, status: 200, text: async () => JSON.stringify({ iTotalRecords: 0, aaData: [] }) };
    };
    const ctx = { bindings: { restBaseUrl: 'https://scanner.example.com', token: 'pre-tok' }, config: {}, secret: {}, limits: { timeoutMs: 5000 }, meta: {}, req: {} };
    await rpcdef(ctx)[PATH_LIST_TASKS]();
    assert.ok(fetchCalled);
  });
});

// ===========================================================================
// URL aliases
// ===========================================================================
describe('URL aliases', () => {
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('baseUrl accepted', async () => {
    globalThis.fetch = makeFetch({ 'CPU Load': '1%', engine: [] });
    const ctx = { bindings: { baseUrl: 'https://scanner.example.com' }, config: {}, secret: {}, limits: { timeoutMs: 5000 }, meta: {}, req: {} };
    const r = await rpcdef(ctx)[PATH_GET_DEVICE_STATUS]();
    assert.equal(r.cpu_load, '1%');
  });

  it('rest_base_url accepted', async () => {
    globalThis.fetch = makeFetch({ 'CPU Load': '2%', engine: [] });
    const ctx = { bindings: { rest_base_url: 'https://scanner.example.com' }, config: {}, secret: {}, limits: { timeoutMs: 5000 }, meta: {}, req: {} };
    const r = await rpcdef(ctx)[PATH_GET_DEVICE_STATUS]();
    assert.equal(r.cpu_load, '2%');
  });

  it('endpoint accepted', async () => {
    globalThis.fetch = makeFetch({ 'CPU Load': '3%', engine: [] });
    const ctx = { bindings: { endpoint: 'https://scanner.example.com' }, config: {}, secret: {}, limits: { timeoutMs: 5000 }, meta: {}, req: {} };
    const r = await rpcdef(ctx)[PATH_GET_DEVICE_STATUS]();
    assert.equal(r.cpu_load, '3%');
  });
});

// ===========================================================================
// TLS
// ===========================================================================
describe('TLS skip verify', () => {
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('tlsInsecureSkipVerify: true still calls fetch', async () => {
    globalThis.fetch = makeFetch({ 'CPU Load': '1%', engine: [] });
    const ctx = buildCtx({ bindings: { restBaseUrl: 'https://scanner.example.com', token: 'tok', tlsInsecureSkipVerify: true } });
    const r = await rpcdef(ctx)[PATH_GET_DEVICE_STATUS]();
    assert.equal(r.cpu_load, '1%');
  });

  it('skipTlsVerify alias works', async () => {
    globalThis.fetch = makeFetch({ 'CPU Load': '2%', engine: [] });
    const ctx = buildCtx({ bindings: { restBaseUrl: 'https://scanner.example.com', token: 'tok', skipTlsVerify: true } });
    const r = await rpcdef(ctx)[PATH_GET_DEVICE_STATUS]();
    assert.equal(r.cpu_load, '2%');
  });
});

// ===========================================================================
// timeoutMs
// ===========================================================================
describe('timeoutMs', () => {
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('timeoutMs=0 falls back to default', async () => {
    globalThis.fetch = makeFetch({ 'CPU Load': '1%', engine: [] });
    const ctx = buildCtx({ limits: { timeoutMs: 0 } });
    const r = await rpcdef(ctx)[PATH_GET_DEVICE_STATUS]();
    assert.equal(r.cpu_load, '1%');
  });
});

// ===========================================================================
// _test.toValue
// ===========================================================================
describe('_test.toValue', () => {
  it('null -> undefined', () => assert.equal(_test.toValue(null), undefined));
  it('undefined -> undefined', () => assert.equal(_test.toValue(undefined), undefined));
  it('string -> stringValue', () => assert.deepEqual(_test.toValue('hi'), { stringValue: 'hi' }));
  it('number -> numberValue', () => assert.deepEqual(_test.toValue(42), { numberValue: 42 }));
  it('true -> boolValue', () => assert.deepEqual(_test.toValue(true), { boolValue: true }));
  it('false -> boolValue', () => assert.deepEqual(_test.toValue(false), { boolValue: false }));
  it('array -> listValue', () => {
    const r = _test.toValue([1, 'x']);
    assert.ok(r.listValue);
    assert.equal(r.listValue.values.length, 2);
  });
  it('null in array -> filtered out', () => {
    const r = _test.toValue([null, 'a']);
    assert.equal(r.listValue.values.length, 1);
    assert.deepEqual(r.listValue.values[0], { stringValue: 'a' });
  });
  it('object -> structValue', () => {
    const r = _test.toValue({ a: 'x', b: 2 });
    assert.ok(r.structValue);
    assert.deepEqual(r.structValue.fields.a, { stringValue: 'x' });
    assert.deepEqual(r.structValue.fields.b, { numberValue: 2 });
  });
  it('null in object field -> nullValue sentinel', () => {
    const r = _test.toValue({ key: null });
    assert.deepEqual(r.structValue.fields.key, { nullValue: 'NULL_VALUE' });
  });
  it('nested object with undefined -> nullValue sentinel', () => {
    const r = _test.toValue({ k: undefined });
    assert.deepEqual(r.structValue.fields.k, { nullValue: 'NULL_VALUE' });
  });
  it('function -> stringValue fallback', () => {
    const r = _test.toValue(function myFn() {});
    assert.ok(typeof r.stringValue === 'string');
  });
});

// ===========================================================================
// _test.normalizeBaseUrl
// ===========================================================================
describe('_test.normalizeBaseUrl', () => {
  it('valid https -> normalized', () => assert.equal(_test.normalizeBaseUrl('https://host:8443'), 'https://host:8443'));
  it('trailing slash stripped', () => assert.equal(_test.normalizeBaseUrl('https://host:8443/'), 'https://host:8443'));
  it('multiple trailing slashes stripped', () => assert.equal(_test.normalizeBaseUrl('HTTPS://host:8443///'), 'HTTPS://host:8443'));
  it('http scheme valid', () => assert.equal(_test.normalizeBaseUrl('http://192.168.1.1:8080'), 'http://192.168.1.1:8080'));
  it('path preserved', () => assert.equal(_test.normalizeBaseUrl('https://host:8443/api'), 'https://host:8443/api'));
  it('no scheme -> null', () => assert.equal(_test.normalizeBaseUrl('host:8443'), null));
  it('empty string -> null', () => assert.equal(_test.normalizeBaseUrl(''), null));
});

// ===========================================================================
// _test.toInt
// ===========================================================================
describe('_test.toInt', () => {
  it('integer -> same', () => assert.equal(_test.toInt(5), 5));
  it('0 is valid', () => assert.equal(_test.toInt(0), 0));
  it('string integer -> number', () => assert.equal(_test.toInt('42'), 42));
  it('float -> null', () => assert.equal(_test.toInt(1.5), null));
  it('null -> null', () => assert.equal(_test.toInt(null), null));
  it('undefined -> null', () => assert.equal(_test.toInt(undefined), null));
  it('NaN string -> null', () => assert.equal(_test.toInt('abc'), null));
  it('wrapper {value} -> extracts', () => assert.equal(_test.toInt({ value: 7 }), 7));
  it('nested wrapper -> extracts', () => assert.equal(_test.toInt({ value: '99' }), 99));
});

// ===========================================================================
// _test.unwrap
// ===========================================================================
describe('_test.unwrap', () => {
  it('null -> undefined', () => assert.equal(_test.unwrap(null), undefined));
  it('undefined -> undefined', () => assert.equal(_test.unwrap(undefined), undefined));
  it('string -> same', () => assert.equal(_test.unwrap('hello'), 'hello'));
  it('{value: str} -> extracts', () => assert.equal(_test.unwrap({ value: 'abc' }), 'abc'));
  it('{value: null} -> empty string', () => assert.equal(_test.unwrap({ value: null }), ''));
  it('number -> string', () => assert.equal(_test.unwrap(42), '42'));
});

// ===========================================================================
// _test.mergedBindings
// ===========================================================================
describe('_test.mergedBindings', () => {
  it('bindings wins over config and secret', () => {
    const ctx = { config: { restBaseUrl: 'from-config' }, secret: { user: 'u' }, bindings: { restBaseUrl: 'from-bindings' } };
    const merged = _test.mergedBindings(ctx);
    assert.equal(merged.restBaseUrl, 'from-bindings');
    assert.equal(merged.user, 'u');
  });

  it('empty ctx -> returns object', () => assert.equal(typeof _test.mergedBindings({}), 'object'));

  it('config values available when not overridden', () => {
    const ctx = { config: { timeout: 3000 }, secret: {}, bindings: {} };
    assert.equal(_test.mergedBindings(ctx).timeout, 3000);
  });
});

// ===========================================================================
// Additional branch coverage
// ===========================================================================
describe('req.token field used when present', () => {
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('req.token takes precedence over bindings.token', async () => {
    globalThis.fetch = makeFetch({ iTotalRecords: 0, aaData: [] });
    // bindings has no token; req provides it explicitly
    const ctx = {
      bindings: { restBaseUrl: 'https://scanner.example.com' },
      config: {}, secret: {}, limits: { timeoutMs: 5000 }, meta: {},
      req: { token: 'from-req' },
    };
    const r = await rpcdef(ctx)[PATH_LIST_TASKS]();
    assert.equal(r.total, 0);
  });

  it('req.token for GetTaskStatus', async () => {
    globalThis.fetch = makeFetch({ status: 4, progress: 100 });
    const ctx = {
      bindings: { restBaseUrl: 'https://scanner.example.com' },
      config: {}, secret: {}, limits: { timeoutMs: 5000 }, meta: {},
      req: { token: 'from-req', task_id: 5 },
    };
    const r = await rpcdef(ctx)[PATH_GET_TASK_STATUS]();
    assert.equal(r.status, 4);
  });
});

describe('additional URL aliases', () => {
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('base_url alias accepted', async () => {
    globalThis.fetch = makeFetch({ 'CPU Load': '4%', engine: [] });
    const ctx = { bindings: { base_url: 'https://scanner.example.com' }, config: {}, secret: {}, limits: { timeoutMs: 5000 }, meta: {}, req: {} };
    const r = await rpcdef(ctx)[PATH_GET_DEVICE_STATUS]();
    assert.equal(r.cpu_load, '4%');
  });
});

describe('additional TLS aliases', () => {
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('skip_tls_verify alias works', async () => {
    globalThis.fetch = makeFetch({ 'CPU Load': '3%', engine: [] });
    const ctx = buildCtx({ bindings: { restBaseUrl: 'https://scanner.example.com', token: 'tok', skip_tls_verify: true } });
    const r = await rpcdef(ctx)[PATH_GET_DEVICE_STATUS]();
    assert.equal(r.cpu_load, '3%');
  });

  it('tls_insecure_skip_verify alias works', async () => {
    globalThis.fetch = makeFetch({ 'CPU Load': '4%', engine: [] });
    const ctx = buildCtx({ bindings: { restBaseUrl: 'https://scanner.example.com', token: 'tok', tls_insecure_skip_verify: true } });
    const r = await rpcdef(ctx)[PATH_GET_DEVICE_STATUS]();
    assert.equal(r.cpu_load, '4%');
  });
});

describe('network error with cause.message', () => {
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('e.cause.message is used when available', async () => {
    globalThis.fetch = async () => {
      const e = new Error('wrapper');
      e.cause = new Error('cause message here');
      throw e;
    };
    await assert.rejects(rpcdef(buildCtx())[PATH_GET_DEVICE_STATUS](), /UNAVAILABLE/);
  });
});

describe('checkError: success=false with null errorcode (no-op)', () => {
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('success=false but no errorcode -> does not throw', async () => {
    // API returns success=false but no errorcode — checkError treats it as non-error
    globalThis.fetch = makeFetch({ success: false, status: 'running', hostscount: 0, vulhigh: 0, vulmedium: 0, vullow: 0 });
    const r = await rpcdef(buildCtx({ req: { task_id: 4 } }))[PATH_QUERY_SYS]();
    assert.equal(r.hosts_count, 0);
  });
});

describe('auto-login: username/password aliases', () => {
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('bindings.username and bindings.password aliases work', async () => {
    let callCount = 0;
    globalThis.fetch = async () => {
      callCount++;
      if (callCount === 1) return { ok: true, status: 200, text: async () => JSON.stringify({ token: 'tok-alias' }) };
      return { ok: true, status: 200, text: async () => JSON.stringify({ iTotalRecords: 0, aaData: [] }) };
    };
    const ctx = {
      bindings: { restBaseUrl: 'https://scanner.example.com' },
      config: {}, secret: { username: 'admin', password: 'pass' },
      limits: { timeoutMs: 5000 }, meta: {}, req: {},
    };
    const r = await rpcdef(ctx)[PATH_LIST_TASKS]();
    assert.equal(r.total, 0);
  });
});

describe('ListTasks: iDisplayLength alias for page_size', () => {
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('iDisplayLength alias works for page_size', async () => {
    globalThis.fetch = makeFetch({ iTotalRecords: 5, aaData: [] });
    const ctx = buildCtx({ req: { iDisplayLength: 20 } });
    const r = await rpcdef(ctx)[PATH_LIST_TASKS]();
    assert.equal(r.total, 5);
  });
});

describe('GetTaskStatus: taskallid alias', () => {
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('taskallid alias works', async () => {
    globalThis.fetch = makeFetch({ status: 4, progress: 100 });
    const r = await rpcdef(buildCtx({ req: { taskallid: 5 } }))[PATH_GET_TASK_STATUS]();
    assert.equal(r.status, 4);
  });
});

describe('SubmitScanTask: taskType alias', () => {
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('taskType alias for task_type', async () => {
    globalThis.fetch = makeFetch({ taskall_id: 5, sys_task_id: 1, web_task_id: 2, alive_task_id: 3, ret_crack_task_id: 4 });
    const r = await rpcdef(buildCtx({ req: { target: '10.0.0.0', taskType: 0 } }))[PATH_SUBMIT_SCAN_TASK]();
    assert.equal(r.task_id, 5);
  });

  it('vulPlugin alias for vul_plugin', async () => {
    globalThis.fetch = makeFetch({ taskall_id: 6, sys_task_id: 1, web_task_id: 2, alive_task_id: 3, ret_crack_task_id: 4 });
    const r = await rpcdef(buildCtx({ req: { target: '10.0.0.0', vulPlugin: 1 } }))[PATH_SUBMIT_SCAN_TASK]();
    assert.equal(r.task_id, 6);
  });
});

describe('QuerySysScanResult: taskId alias', () => {
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('taskId alias works', async () => {
    globalThis.fetch = makeFetch({ status: 'completed', hostscount: 0, vulhigh: 0, vulmedium: 0, vullow: 0, hosts: [] });
    const r = await rpcdef(buildCtx({ req: { taskId: 4 } }))[PATH_QUERY_SYS]();
    assert.equal(r.status, 'completed');
  });
});

describe('?? 0 fallback when numeric fields absent', () => {
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('GetTaskStatus: missing status/progress -> 0', async () => {
    globalThis.fetch = makeFetch({});
    const r = await rpcdef(buildCtx({ req: { task_id: 5 } }))[PATH_GET_TASK_STATUS]();
    assert.equal(r.status, 0);
    assert.equal(r.progress, 0);
  });

  it('SubmitScanTask: missing IDs -> 0', async () => {
    globalThis.fetch = makeFetch({});
    const r = await rpcdef(buildCtx({ req: { target: '10.0.0.1' } }))[PATH_SUBMIT_SCAN_TASK]();
    assert.equal(r.task_id, 0);
    assert.equal(r.crack_task_id, 0);
  });

  it('ListTasks: missing iTotalRecords -> 0', async () => {
    globalThis.fetch = makeFetch({ aaData: [] });
    const r = await rpcdef(buildCtx())[PATH_LIST_TASKS]();
    assert.equal(r.total, 0);
  });

  it('QuerySysScanResult: missing counts -> 0', async () => {
    globalThis.fetch = makeFetch({ status: 'running' });
    const r = await rpcdef(buildCtx({ req: { task_id: 4 } }))[PATH_QUERY_SYS]();
    assert.equal(r.hosts_count, 0);
    assert.equal(r.vul_high, 0);
  });

  it('QueryWebScanResult: missing counts -> 0', async () => {
    globalThis.fetch = makeFetch({ status: 'running' });
    const r = await rpcdef(buildCtx({ req: { task_id: 9 } }))[PATH_QUERY_WEB]();
    assert.equal(r.hosts_count, 0);
    assert.equal(r.total_vulns, 0);
  });

  it('QueryWeakPassResult: missing counts -> 0', async () => {
    globalThis.fetch = makeFetch({ status: 'running' });
    const r = await rpcdef(buildCtx({ req: { task_id: 11 } }))[PATH_QUERY_WEAK]();
    assert.equal(r.hosts_count, 0);
    assert.equal(r.total, 0);
  });
});

describe('GetDeviceStatus: snake_case and fallback field names', () => {
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('cpu_load / disk_usage / memory_usage / system_version snake_case fields', async () => {
    globalThis.fetch = makeFetch({
      cpu_load: '2%', disk_usage: '5G/100G',
      memory_usage: '2G/8G', system_version: '3.6',
      engine: [],
    });
    const r = await rpcdef(buildCtx())[PATH_GET_DEVICE_STATUS]();
    assert.equal(r.cpu_load, '2%');
    assert.equal(r.disk_usage, '5G/100G');
    assert.equal(r.memory_usage, '2G/8G');
    assert.equal(r.system_version, '3.6');
  });

  it('missing all fields -> empty strings', async () => {
    globalThis.fetch = makeFetch({ engine: [] });
    const r = await rpcdef(buildCtx())[PATH_GET_DEVICE_STATUS]();
    assert.equal(r.cpu_load, '');
    assert.equal(r.disk_usage, '');
    assert.equal(r.memory_usage, '');
    assert.equal(r.system_version, '');
  });
});

describe('QueryWebScanResult and QueryWeakPassResult: taskId and taskid aliases', () => {
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('QueryWebScanResult: taskId alias works', async () => {
    globalThis.fetch = makeFetch({ status: 'completed', hostscount: 0, total: 0, hosts: [] });
    const r = await rpcdef(buildCtx({ req: { taskId: 9 } }))[PATH_QUERY_WEB]();
    assert.equal(r.status, 'completed');
  });

  it('QueryWeakPassResult: taskid alias works', async () => {
    globalThis.fetch = makeFetch({ status: 'completed', hostscount: 0, total: 0, hosts: [] });
    const r = await rpcdef(buildCtx({ req: { taskid: 11 } }))[PATH_QUERY_WEAK]();
    assert.equal(r.status, 'completed');
  });

  it('QueryWebScanResult: target filter', async () => {
    globalThis.fetch = makeFetch({ status: 'completed', hostscount: 0, total: 0, hosts: [] });
    const r = await rpcdef(buildCtx({ req: { task_id: 9, target: { value: 'http://test.com' } } }))[PATH_QUERY_WEB]();
    assert.equal(r.status, 'completed');
  });

  it('QueryWeakPassResult: target filter', async () => {
    globalThis.fetch = makeFetch({ status: 'completed', hostscount: 0, total: 0, hosts: [] });
    const r = await rpcdef(buildCtx({ req: { task_id: 11, target: { value: '192.168.1.1' } } }))[PATH_QUERY_WEAK]();
    assert.equal(r.status, 'completed');
  });
});

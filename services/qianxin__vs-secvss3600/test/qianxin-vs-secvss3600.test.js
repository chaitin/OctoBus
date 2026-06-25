import { describe, it, beforeEach, afterEach } from 'node:test';
import test from 'node:test';
import assert from 'node:assert/strict';

import { rpcdef, handlers, _test } from '../src/qianxin-vs-secvss3600.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const PKG = 'QIANXIN_VS_SecVSS3600';
const PREFIX = `/${PKG}.${PKG}/`;

const PATH_GET_TOKEN           = `${PREFIX}GetToken`;
const PATH_SUBMIT_SCAN_TASK    = `${PREFIX}SubmitScanTask`;
const PATH_CONTROL_TASK        = `${PREFIX}ControlTask`;
const PATH_GET_TASK_PROGRESS   = `${PREFIX}GetTaskProgress`;
const PATH_QUERY_SYS_SCAN      = `${PREFIX}QuerySysScanResult`;
const PATH_LIST_TASKS             = `${PREFIX}ListTasks`;
const PATH_QUERY_WEB_SCAN         = `${PREFIX}QueryWebScanResult`;
const PATH_QUERY_WEAK_PASS        = `${PREFIX}QueryWeakPassResult`;
const PATH_GET_DEVICE_STATUS      = `${PREFIX}GetDeviceStatus`;
const PATH_LIST_VUL_TEMPLATES     = `${PREFIX}ListVulTemplates`;

const METHOD_GET_TOKEN         = `${PKG}.${PKG}/GetToken`;
const METHOD_SUBMIT_SCAN_TASK  = `${PKG}.${PKG}/SubmitScanTask`;
const METHOD_CONTROL_TASK      = `${PKG}.${PKG}/ControlTask`;
const METHOD_GET_TASK_PROGRESS = `${PKG}.${PKG}/GetTaskProgress`;
const METHOD_QUERY_SYS_SCAN   = `${PKG}.${PKG}/QuerySysScanResult`;
const METHOD_LIST_TASKS        = `${PKG}.${PKG}/ListTasks`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const makeFetch = (body, status = 200) => async (_url, _init) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: (h) => (h === 'content-type' ? 'application/json' : null) },
  text: async () => JSON.stringify(body),
});

const makeTextFetch = (text, status = 200) => async (_url, _init) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: () => null },
  text: async () => text,
});

const networkErrorFetch = async () => { throw new Error('ECONNREFUSED'); };

const buildCtx = (overrides = {}) => ({
  bindings: { restBaseUrl: 'https://scanner.example.com', ...(overrides.bindings ?? {}) },
  config:   overrides.config ?? {},
  secret:   { user: 'admin', pwd: 'pass123', ...(overrides.secret ?? {}) },
  limits:   { timeoutMs: 5000, ...(overrides.limits ?? {}) },
  meta:     overrides.meta ?? {},
  req:      overrides.req ?? {},
});

// Captures the last intercepted fetch call for assertion
let lastFetchArgs = null;
const captureFetch = (impl) => async (url, init) => {
  lastFetchArgs = { url: String(url), init };
  return impl(url, init);
};

const originalFetch = globalThis.fetch;

// ---------------------------------------------------------------------------
// Restore fetch after each top-level test
// ---------------------------------------------------------------------------
test.afterEach(() => {
  globalThis.fetch = originalFetch;
  lastFetchArgs = null;
});

// ===========================================================================
// rpcdef shape
// ===========================================================================
test('rpcdef exposes all six method paths', () => {
  const def = rpcdef(buildCtx());
  for (const method of ['GetToken', 'SubmitScanTask', 'ControlTask', 'GetTaskProgress', 'QuerySysScanResult', 'ListTasks']) {
    assert.equal(typeof def[`${PREFIX}${method}`], 'function', `${method} missing from rpcdef`);
  }
});

test('handlers exposes all six method keys', () => {
  for (const key of [METHOD_GET_TOKEN, METHOD_SUBMIT_SCAN_TASK, METHOD_CONTROL_TASK, METHOD_GET_TASK_PROGRESS, METHOD_QUERY_SYS_SCAN, METHOD_LIST_TASKS]) {
    assert.equal(typeof handlers[key], 'function', `${key} missing from handlers`);
  }
});

// ===========================================================================
// GetToken
// ===========================================================================
describe('GetToken', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
    lastFetchArgs = null;
  });

  it('success: returns token on valid credentials', async () => {
    const body = { success: true, token: 'abc123token' };
    globalThis.fetch = captureFetch(makeFetch(body));

    const ctx = buildCtx({ req: { user: 'admin', pwd: 'pass' } });
    const res = await rpcdef(ctx)[PATH_GET_TOKEN]();
    assert.equal(res.success, true);
    assert.equal(res.token, 'abc123token');
  });

  it('success: sends credentials from secret when not in req', async () => {
    const body = { success: true, token: 'secret-token' };
    globalThis.fetch = captureFetch(makeFetch(body));

    const ctx = buildCtx();
    const res = await rpcdef(ctx)[PATH_GET_TOKEN]();
    assert.equal(res.success, true);
  });

  it('missing user -> INVALID_ARGUMENT', async () => {
    const ctx = buildCtx({ req: { pwd: 'pass' }, secret: { user: '', pwd: 'pass' } });
    await assert.rejects(
      () => rpcdef(ctx)[PATH_GET_TOKEN](),
      (err) => {
        assert.match(err.message, /INVALID_ARGUMENT/);
        return true;
      },
    );
  });

  it('missing pwd -> INVALID_ARGUMENT', async () => {
    const ctx = buildCtx({ req: { user: 'admin' }, secret: { user: 'admin', pwd: '' } });
    await assert.rejects(
      () => rpcdef(ctx)[PATH_GET_TOKEN](),
      (err) => {
        assert.match(err.message, /INVALID_ARGUMENT/);
        return true;
      },
    );
  });

  it('upstream errorcode=1002 -> PERMISSION_DENIED', async () => {
    globalThis.fetch = makeFetch({ success: false, errorcode: 1002, msg: 'permission denied' });
    const ctx = buildCtx();
    await assert.rejects(
      () => rpcdef(ctx)[PATH_GET_TOKEN](),
      (err) => {
        assert.match(err.message, /PERMISSION_DENIED/);
        return true;
      },
    );
  });

  it('upstream errorcode=1013 -> PERMISSION_DENIED (token timeout)', async () => {
    globalThis.fetch = makeFetch({ success: false, errorcode: 1013, msg: 'token timeout' });
    const ctx = buildCtx();
    await assert.rejects(
      () => rpcdef(ctx)[PATH_GET_TOKEN](),
      (err) => {
        assert.match(err.message, /PERMISSION_DENIED/);
        return true;
      },
    );
  });

  it('network error -> UNAVAILABLE', async () => {
    globalThis.fetch = networkErrorFetch;
    const ctx = buildCtx();
    await assert.rejects(
      () => rpcdef(ctx)[PATH_GET_TOKEN](),
      (err) => {
        assert.match(err.message, /UNAVAILABLE/);
        return true;
      },
    );
  });

  it('HTTP 5xx -> UNAVAILABLE', async () => {
    globalThis.fetch = makeFetch({ error: 'server error' }, 500);
    const ctx = buildCtx();
    await assert.rejects(
      () => rpcdef(ctx)[PATH_GET_TOKEN](),
      (err) => {
        assert.match(err.message, /UNAVAILABLE/);
        return true;
      },
    );
  });

  it('non-JSON response -> UNKNOWN', async () => {
    globalThis.fetch = makeTextFetch('<html>error</html>');
    const ctx = buildCtx();
    await assert.rejects(
      () => rpcdef(ctx)[PATH_GET_TOKEN](),
      (err) => {
        assert.match(err.message, /UNKNOWN/);
        return true;
      },
    );
  });

  it('HTTP 401 -> PERMISSION_DENIED', async () => {
    globalThis.fetch = makeFetch({ success: false, errorcode: 1002 }, 401);
    const ctx = buildCtx();
    await assert.rejects(
      () => rpcdef(ctx)[PATH_GET_TOKEN](),
      (err) => {
        assert.match(err.message, /PERMISSION_DENIED/);
        return true;
      },
    );
  });

  it('handlers[METHOD_GET_TOKEN] also works', async () => {
    const body = { success: true, token: 'tok-via-handler' };
    globalThis.fetch = makeFetch(body);
    const res = await handlers[METHOD_GET_TOKEN]({ user: 'admin', pwd: 'pass' }, buildCtx());
    assert.equal(res.success, true);
  });
});

// ===========================================================================
// SubmitScanTask
// ===========================================================================
describe('SubmitScanTask', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
    lastFetchArgs = null;
  });

  it('success: returns taskall_id and sys_task_id', async () => {
    const body = { success: true, taskall_id: '5', sys_task_id: '4', web_task_id: '9', alive_task_id: '8', ret_crack_task_id: '11' };
    globalThis.fetch = makeFetch(body);
    const ctx = buildCtx({ req: { token: 'abc', target: '192.168.1.1' } });
    const res = await rpcdef(ctx)[PATH_SUBMIT_SCAN_TASK]();
    assert.equal(res.success, true);
    assert.equal(res.taskall_id, '5');
    assert.equal(res.sys_task_id, '4');
  });

  it('missing target -> INVALID_ARGUMENT', async () => {
    const ctx = buildCtx({ req: { token: 'abc' } });
    await assert.rejects(
      () => rpcdef(ctx)[PATH_SUBMIT_SCAN_TASK](),
      (err) => {
        assert.match(err.message, /INVALID_ARGUMENT/);
        return true;
      },
    );
  });

  it('missing token -> INVALID_ARGUMENT', async () => {
    const ctx = buildCtx({ req: { target: '192.168.1.1' } });
    await assert.rejects(
      () => rpcdef(ctx)[PATH_SUBMIT_SCAN_TASK](),
      (err) => {
        assert.match(err.message, /INVALID_ARGUMENT/);
        return true;
      },
    );
  });

  it('upstream errorcode=1002 -> PERMISSION_DENIED', async () => {
    globalThis.fetch = makeFetch({ success: false, errorcode: 1002 });
    const ctx = buildCtx({ req: { token: 'abc', target: '192.168.1.1' } });
    await assert.rejects(
      () => rpcdef(ctx)[PATH_SUBMIT_SCAN_TASK](),
      (err) => {
        assert.match(err.message, /PERMISSION_DENIED/);
        return true;
      },
    );
  });

  it('upstream errorcode=1013 -> PERMISSION_DENIED', async () => {
    globalThis.fetch = makeFetch({ success: false, errorcode: 1013 });
    const ctx = buildCtx({ req: { token: 'abc', target: '192.168.1.1' } });
    await assert.rejects(
      () => rpcdef(ctx)[PATH_SUBMIT_SCAN_TASK](),
      (err) => {
        assert.match(err.message, /PERMISSION_DENIED/);
        return true;
      },
    );
  });

  it('network error -> UNAVAILABLE', async () => {
    globalThis.fetch = networkErrorFetch;
    const ctx = buildCtx({ req: { token: 'abc', target: '192.168.1.1' } });
    await assert.rejects(
      () => rpcdef(ctx)[PATH_SUBMIT_SCAN_TASK](),
      (err) => {
        assert.match(err.message, /UNAVAILABLE/);
        return true;
      },
    );
  });

  it('HTTP 500 -> UNAVAILABLE', async () => {
    globalThis.fetch = makeFetch({ error: 'internal' }, 500);
    const ctx = buildCtx({ req: { token: 'abc', target: '192.168.1.1' } });
    await assert.rejects(
      () => rpcdef(ctx)[PATH_SUBMIT_SCAN_TASK](),
      (err) => {
        assert.match(err.message, /UNAVAILABLE/);
        return true;
      },
    );
  });

  it('non-JSON response -> UNKNOWN', async () => {
    globalThis.fetch = makeTextFetch('not json at all');
    const ctx = buildCtx({ req: { token: 'abc', target: '192.168.1.1' } });
    await assert.rejects(
      () => rpcdef(ctx)[PATH_SUBMIT_SCAN_TASK](),
      (err) => {
        assert.match(err.message, /UNKNOWN/);
        return true;
      },
    );
  });

  it('HTTP 401 -> PERMISSION_DENIED', async () => {
    globalThis.fetch = makeFetch({ success: false, errorcode: 1002 }, 401);
    const ctx = buildCtx({ req: { token: 'abc', target: '192.168.1.1' } });
    await assert.rejects(
      () => rpcdef(ctx)[PATH_SUBMIT_SCAN_TASK](),
      (err) => {
        assert.match(err.message, /PERMISSION_DENIED/);
        return true;
      },
    );
  });

  it('handlers[METHOD_SUBMIT_SCAN_TASK] also works', async () => {
    const body = { success: true, taskall_id: '10', sys_task_id: '9' };
    globalThis.fetch = makeFetch(body);
    const res = await handlers[METHOD_SUBMIT_SCAN_TASK]({ token: 'abc', target: '10.0.0.1' }, buildCtx());
    assert.equal(res.success, true);
    assert.equal(res.taskall_id, '10');
  });
});

// ===========================================================================
// ControlTask
// ===========================================================================
describe('ControlTask', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
    lastFetchArgs = null;
  });

  it('success: stop task returns {success:true}', async () => {
    globalThis.fetch = makeFetch({ success: true });
    const ctx = buildCtx({ req: { token: 'abc', controltype: 'stop', taskallid: '5' } });
    const res = await rpcdef(ctx)[PATH_CONTROL_TASK]();
    assert.equal(res.success, true);
  });

  it('missing controltype -> INVALID_ARGUMENT', async () => {
    const ctx = buildCtx({ req: { token: 'abc', taskallid: '5' } });
    await assert.rejects(
      () => rpcdef(ctx)[PATH_CONTROL_TASK](),
      (err) => {
        assert.match(err.message, /INVALID_ARGUMENT/);
        return true;
      },
    );
  });

  it('missing taskallid -> INVALID_ARGUMENT', async () => {
    const ctx = buildCtx({ req: { token: 'abc', controltype: 'stop' } });
    await assert.rejects(
      () => rpcdef(ctx)[PATH_CONTROL_TASK](),
      (err) => {
        assert.match(err.message, /INVALID_ARGUMENT/);
        return true;
      },
    );
  });

  it('missing token -> INVALID_ARGUMENT', async () => {
    const ctx = buildCtx({ req: { controltype: 'stop', taskallid: '5' } });
    await assert.rejects(
      () => rpcdef(ctx)[PATH_CONTROL_TASK](),
      (err) => {
        assert.match(err.message, /INVALID_ARGUMENT/);
        return true;
      },
    );
  });

  it('upstream errorcode=1002 -> PERMISSION_DENIED', async () => {
    globalThis.fetch = makeFetch({ success: false, errorcode: 1002 });
    const ctx = buildCtx({ req: { token: 'abc', controltype: 'stop', taskallid: '5' } });
    await assert.rejects(
      () => rpcdef(ctx)[PATH_CONTROL_TASK](),
      (err) => {
        assert.match(err.message, /PERMISSION_DENIED/);
        return true;
      },
    );
  });

  it('upstream errorcode=1013 -> PERMISSION_DENIED', async () => {
    globalThis.fetch = makeFetch({ success: false, errorcode: 1013 });
    const ctx = buildCtx({ req: { token: 'abc', controltype: 'stop', taskallid: '5' } });
    await assert.rejects(
      () => rpcdef(ctx)[PATH_CONTROL_TASK](),
      (err) => {
        assert.match(err.message, /PERMISSION_DENIED/);
        return true;
      },
    );
  });

  it('network error -> UNAVAILABLE', async () => {
    globalThis.fetch = networkErrorFetch;
    const ctx = buildCtx({ req: { token: 'abc', controltype: 'stop', taskallid: '5' } });
    await assert.rejects(
      () => rpcdef(ctx)[PATH_CONTROL_TASK](),
      (err) => {
        assert.match(err.message, /UNAVAILABLE/);
        return true;
      },
    );
  });

  it('HTTP 500 -> UNAVAILABLE', async () => {
    globalThis.fetch = makeFetch({ error: 'oops' }, 500);
    const ctx = buildCtx({ req: { token: 'abc', controltype: 'stop', taskallid: '5' } });
    await assert.rejects(
      () => rpcdef(ctx)[PATH_CONTROL_TASK](),
      (err) => {
        assert.match(err.message, /UNAVAILABLE/);
        return true;
      },
    );
  });

  it('non-JSON response -> UNKNOWN', async () => {
    globalThis.fetch = makeTextFetch('<error/>');
    const ctx = buildCtx({ req: { token: 'abc', controltype: 'stop', taskallid: '5' } });
    await assert.rejects(
      () => rpcdef(ctx)[PATH_CONTROL_TASK](),
      (err) => {
        assert.match(err.message, /UNKNOWN/);
        return true;
      },
    );
  });

  it('HTTP 401 -> PERMISSION_DENIED', async () => {
    globalThis.fetch = makeFetch({ success: false, errorcode: 1002 }, 401);
    const ctx = buildCtx({ req: { token: 'abc', controltype: 'stop', taskallid: '5' } });
    await assert.rejects(
      () => rpcdef(ctx)[PATH_CONTROL_TASK](),
      (err) => {
        assert.match(err.message, /PERMISSION_DENIED/);
        return true;
      },
    );
  });

  it('handlers[METHOD_CONTROL_TASK] also works', async () => {
    globalThis.fetch = makeFetch({ success: true });
    const res = await handlers[METHOD_CONTROL_TASK]({ token: 'abc', controltype: 'pause', taskallid: '5' }, buildCtx());
    assert.equal(res.success, true);
  });
});

// ===========================================================================
// GetTaskProgress
// ===========================================================================
describe('GetTaskProgress', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
    lastFetchArgs = null;
  });

  it('success: returns status and progress', async () => {
    const body = { success: true, status: '4', progress: '100', scheduletype: '0' };
    globalThis.fetch = makeFetch(body);
    const ctx = buildCtx({ req: { token: 'abc', taskallid: '5' } });
    const res = await rpcdef(ctx)[PATH_GET_TASK_PROGRESS]();
    assert.equal(res.success, true);
    assert.equal(res.status, '4');
    assert.equal(res.progress, 100);
  });

  it('missing taskallid -> INVALID_ARGUMENT', async () => {
    const ctx = buildCtx({ req: { token: 'abc' } });
    await assert.rejects(
      () => rpcdef(ctx)[PATH_GET_TASK_PROGRESS](),
      (err) => {
        assert.match(err.message, /INVALID_ARGUMENT/);
        return true;
      },
    );
  });

  it('missing token -> INVALID_ARGUMENT', async () => {
    const ctx = buildCtx({ req: { taskallid: '5' } });
    await assert.rejects(
      () => rpcdef(ctx)[PATH_GET_TASK_PROGRESS](),
      (err) => {
        assert.match(err.message, /INVALID_ARGUMENT/);
        return true;
      },
    );
  });

  it('upstream errorcode=1002 -> PERMISSION_DENIED', async () => {
    globalThis.fetch = makeFetch({ success: false, errorcode: 1002 });
    const ctx = buildCtx({ req: { token: 'abc', taskallid: '5' } });
    await assert.rejects(
      () => rpcdef(ctx)[PATH_GET_TASK_PROGRESS](),
      (err) => {
        assert.match(err.message, /PERMISSION_DENIED/);
        return true;
      },
    );
  });

  it('upstream errorcode=1013 -> PERMISSION_DENIED', async () => {
    globalThis.fetch = makeFetch({ success: false, errorcode: 1013 });
    const ctx = buildCtx({ req: { token: 'abc', taskallid: '5' } });
    await assert.rejects(
      () => rpcdef(ctx)[PATH_GET_TASK_PROGRESS](),
      (err) => {
        assert.match(err.message, /PERMISSION_DENIED/);
        return true;
      },
    );
  });

  it('network error -> UNAVAILABLE', async () => {
    globalThis.fetch = networkErrorFetch;
    const ctx = buildCtx({ req: { token: 'abc', taskallid: '5' } });
    await assert.rejects(
      () => rpcdef(ctx)[PATH_GET_TASK_PROGRESS](),
      (err) => {
        assert.match(err.message, /UNAVAILABLE/);
        return true;
      },
    );
  });

  it('HTTP 502 -> UNAVAILABLE', async () => {
    globalThis.fetch = makeFetch({}, 502);
    const ctx = buildCtx({ req: { token: 'abc', taskallid: '5' } });
    await assert.rejects(
      () => rpcdef(ctx)[PATH_GET_TASK_PROGRESS](),
      (err) => {
        assert.match(err.message, /UNAVAILABLE/);
        return true;
      },
    );
  });

  it('non-JSON response -> UNKNOWN', async () => {
    globalThis.fetch = makeTextFetch('plain text');
    const ctx = buildCtx({ req: { token: 'abc', taskallid: '5' } });
    await assert.rejects(
      () => rpcdef(ctx)[PATH_GET_TASK_PROGRESS](),
      (err) => {
        assert.match(err.message, /UNKNOWN/);
        return true;
      },
    );
  });

  it('HTTP 401 -> PERMISSION_DENIED', async () => {
    globalThis.fetch = makeFetch({ success: false }, 401);
    const ctx = buildCtx({ req: { token: 'abc', taskallid: '5' } });
    await assert.rejects(
      () => rpcdef(ctx)[PATH_GET_TASK_PROGRESS](),
      (err) => {
        assert.match(err.message, /PERMISSION_DENIED/);
        return true;
      },
    );
  });

  it('handlers[METHOD_GET_TASK_PROGRESS] also works', async () => {
    globalThis.fetch = makeFetch({ success: true, status: '4', progress: '100' });
    const res = await handlers[METHOD_GET_TASK_PROGRESS]({ token: 'abc', taskallid: '5' }, buildCtx());
    assert.equal(res.success, true);
    assert.equal(res.status, '4');
  });
});

// ===========================================================================
// QuerySysScanResult
// ===========================================================================
describe('QuerySysScanResult', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
    lastFetchArgs = null;
  });

  it('success: returns scan result with hosts list', async () => {
    const body = {
      success: true,
      status: 'completed',
      hostscount: '1',
      vulhigh: '2',
      vulmedium: '1',
      vullow: '3',
      hosts: [{ ip: '192.168.1.1', vulhigh: '2', vulmedium: '1' }],
    };
    globalThis.fetch = makeFetch(body);
    const ctx = buildCtx({ req: { token: 'abc', taskid: '4' } });
    const res = await rpcdef(ctx)[PATH_QUERY_SYS_SCAN]();
    assert.equal(res.success, true);
    assert.equal(res.status, 'completed');
    assert.equal(res.hostscount, 1);
    assert.equal(res.vulhigh, 2);
    assert.ok(Array.isArray(res.hosts));
  });

  it('missing taskid -> INVALID_ARGUMENT', async () => {
    const ctx = buildCtx({ req: { token: 'abc' } });
    await assert.rejects(
      () => rpcdef(ctx)[PATH_QUERY_SYS_SCAN](),
      (err) => {
        assert.match(err.message, /INVALID_ARGUMENT/);
        return true;
      },
    );
  });

  it('missing token -> INVALID_ARGUMENT', async () => {
    const ctx = buildCtx({ req: { taskid: '4' } });
    await assert.rejects(
      () => rpcdef(ctx)[PATH_QUERY_SYS_SCAN](),
      (err) => {
        assert.match(err.message, /INVALID_ARGUMENT/);
        return true;
      },
    );
  });

  it('upstream errorcode=1002 -> PERMISSION_DENIED', async () => {
    globalThis.fetch = makeFetch({ success: false, errorcode: 1002 });
    const ctx = buildCtx({ req: { token: 'abc', taskid: '4' } });
    await assert.rejects(
      () => rpcdef(ctx)[PATH_QUERY_SYS_SCAN](),
      (err) => {
        assert.match(err.message, /PERMISSION_DENIED/);
        return true;
      },
    );
  });

  it('upstream errorcode=1013 -> PERMISSION_DENIED', async () => {
    globalThis.fetch = makeFetch({ success: false, errorcode: 1013 });
    const ctx = buildCtx({ req: { token: 'abc', taskid: '4' } });
    await assert.rejects(
      () => rpcdef(ctx)[PATH_QUERY_SYS_SCAN](),
      (err) => {
        assert.match(err.message, /PERMISSION_DENIED/);
        return true;
      },
    );
  });

  it('network error -> UNAVAILABLE', async () => {
    globalThis.fetch = networkErrorFetch;
    const ctx = buildCtx({ req: { token: 'abc', taskid: '4' } });
    await assert.rejects(
      () => rpcdef(ctx)[PATH_QUERY_SYS_SCAN](),
      (err) => {
        assert.match(err.message, /UNAVAILABLE/);
        return true;
      },
    );
  });

  it('HTTP 503 -> UNAVAILABLE', async () => {
    globalThis.fetch = makeFetch({ error: 'service unavailable' }, 503);
    const ctx = buildCtx({ req: { token: 'abc', taskid: '4' } });
    await assert.rejects(
      () => rpcdef(ctx)[PATH_QUERY_SYS_SCAN](),
      (err) => {
        assert.match(err.message, /UNAVAILABLE/);
        return true;
      },
    );
  });

  it('non-JSON response -> UNKNOWN', async () => {
    globalThis.fetch = makeTextFetch('{}broken');
    const ctx = buildCtx({ req: { token: 'abc', taskid: '4' } });
    await assert.rejects(
      () => rpcdef(ctx)[PATH_QUERY_SYS_SCAN](),
      (err) => {
        assert.match(err.message, /UNKNOWN/);
        return true;
      },
    );
  });

  it('HTTP 401 -> PERMISSION_DENIED', async () => {
    globalThis.fetch = makeFetch({ success: false, errorcode: 1002 }, 401);
    const ctx = buildCtx({ req: { token: 'abc', taskid: '4' } });
    await assert.rejects(
      () => rpcdef(ctx)[PATH_QUERY_SYS_SCAN](),
      (err) => {
        assert.match(err.message, /PERMISSION_DENIED/);
        return true;
      },
    );
  });

  it('handlers[METHOD_QUERY_SYS_SCAN] also works', async () => {
    const body = { success: true, status: 'completed', hostscount: '1', vulhigh: '0', hosts: [] };
    globalThis.fetch = makeFetch(body);
    const res = await handlers[METHOD_QUERY_SYS_SCAN]({ token: 'abc', taskid: '4' }, buildCtx());
    assert.equal(res.success, true);
    assert.equal(res.status, 'completed');
  });
});

// ===========================================================================
// ListTasks
// ===========================================================================
describe('ListTasks', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
    lastFetchArgs = null;
  });

  it('success: returns task list', async () => {
    const body = {
      success: true,
      iTotalRecords: '2',
      aaData: [
        { taskall_id: '5', taskname: 'scan-1', status: '4' },
        { taskall_id: '6', taskname: 'scan-2', status: '2' },
      ],
    };
    globalThis.fetch = makeFetch(body);
    const ctx = buildCtx({ req: { token: 'abc' } });
    const res = await rpcdef(ctx)[PATH_LIST_TASKS]();
    assert.equal(res.success, true);
    assert.equal(res.iTotalRecords, 2);
    assert.ok(Array.isArray(res.aaData));
    assert.equal(res.aaData.length, 2);
  });

  it('missing token -> INVALID_ARGUMENT', async () => {
    const ctx = buildCtx({ req: {} });
    await assert.rejects(
      () => rpcdef(ctx)[PATH_LIST_TASKS](),
      (err) => {
        assert.match(err.message, /INVALID_ARGUMENT/);
        return true;
      },
    );
  });

  it('success: with filter parameters status/page/iDisplayLength', async () => {
    const body = { success: true, iTotalRecords: '1', aaData: [{ taskall_id: '5', status: '4' }] };
    globalThis.fetch = captureFetch(makeFetch(body));
    const ctx = buildCtx({ req: { token: 'abc', status: '4', page: '1', iDisplayLength: '10' } });
    const res = await rpcdef(ctx)[PATH_LIST_TASKS]();
    assert.equal(res.success, true);
    assert.equal(res.iTotalRecords, 1);
  });

  it('upstream errorcode=1002 -> PERMISSION_DENIED', async () => {
    globalThis.fetch = makeFetch({ success: false, errorcode: 1002 });
    const ctx = buildCtx({ req: { token: 'abc' } });
    await assert.rejects(
      () => rpcdef(ctx)[PATH_LIST_TASKS](),
      (err) => {
        assert.match(err.message, /PERMISSION_DENIED/);
        return true;
      },
    );
  });

  it('upstream errorcode=1013 -> PERMISSION_DENIED', async () => {
    globalThis.fetch = makeFetch({ success: false, errorcode: 1013 });
    const ctx = buildCtx({ req: { token: 'abc' } });
    await assert.rejects(
      () => rpcdef(ctx)[PATH_LIST_TASKS](),
      (err) => {
        assert.match(err.message, /PERMISSION_DENIED/);
        return true;
      },
    );
  });

  it('network error -> UNAVAILABLE', async () => {
    globalThis.fetch = networkErrorFetch;
    const ctx = buildCtx({ req: { token: 'abc' } });
    await assert.rejects(
      () => rpcdef(ctx)[PATH_LIST_TASKS](),
      (err) => {
        assert.match(err.message, /UNAVAILABLE/);
        return true;
      },
    );
  });

  it('HTTP 500 -> UNAVAILABLE', async () => {
    globalThis.fetch = makeFetch({ error: 'internal' }, 500);
    const ctx = buildCtx({ req: { token: 'abc' } });
    await assert.rejects(
      () => rpcdef(ctx)[PATH_LIST_TASKS](),
      (err) => {
        assert.match(err.message, /UNAVAILABLE/);
        return true;
      },
    );
  });

  it('non-JSON response -> UNKNOWN', async () => {
    globalThis.fetch = makeTextFetch('Bad Gateway');
    const ctx = buildCtx({ req: { token: 'abc' } });
    await assert.rejects(
      () => rpcdef(ctx)[PATH_LIST_TASKS](),
      (err) => {
        assert.match(err.message, /UNKNOWN/);
        return true;
      },
    );
  });

  it('HTTP 401 -> PERMISSION_DENIED', async () => {
    globalThis.fetch = makeFetch({ success: false, errorcode: 1002 }, 401);
    const ctx = buildCtx({ req: { token: 'abc' } });
    await assert.rejects(
      () => rpcdef(ctx)[PATH_LIST_TASKS](),
      (err) => {
        assert.match(err.message, /PERMISSION_DENIED/);
        return true;
      },
    );
  });

  it('handlers[METHOD_LIST_TASKS] also works', async () => {
    const body = { success: true, iTotalRecords: '0', aaData: [] };
    globalThis.fetch = makeFetch(body);
    const res = await handlers[METHOD_LIST_TASKS]({ token: 'abc' }, buildCtx());
    assert.equal(res.success, true);
    assert.equal(res.iTotalRecords, 0);
  });
});

// ===========================================================================
// _test utility functions
// ===========================================================================
describe('_test.toValue', () => {
  it('string input -> stringValue', () => {
    assert.deepEqual(_test.toValue('hello'), { stringValue: 'hello' });
  });

  it('number input -> numberValue', () => {
    assert.deepEqual(_test.toValue(42), { numberValue: 42 });
  });

  it('boolean true -> boolValue', () => {
    assert.deepEqual(_test.toValue(true), { boolValue: true });
  });

  it('boolean false -> boolValue', () => {
    assert.deepEqual(_test.toValue(false), { boolValue: false });
  });

  it('null -> null', () => {
    assert.equal(_test.toValue(null), null);
  });

  it('undefined -> null', () => {
    assert.equal(_test.toValue(undefined), null);
  });

  it('array -> listValue', () => {
    const result = _test.toValue([1, 'two']);
    assert.ok(result.listValue);
    assert.ok(Array.isArray(result.listValue.values));
    assert.deepEqual(result.listValue.values[0], { numberValue: 1 });
    assert.deepEqual(result.listValue.values[1], { stringValue: 'two' });
  });

  it('array containing null -> nullValue sentinel', () => {
    const result = _test.toValue([null]);
    assert.deepEqual(result.listValue.values[0], { nullValue: 'NULL_VALUE' });
  });

  it('object -> structValue', () => {
    const result = _test.toValue({ a: 'x', b: 2 });
    assert.ok(result.structValue);
    assert.deepEqual(result.structValue.fields.a, { stringValue: 'x' });
    assert.deepEqual(result.structValue.fields.b, { numberValue: 2 });
  });

  it('nested object with null value -> nullValue sentinel in fields', () => {
    const result = _test.toValue({ key: null });
    assert.deepEqual(result.structValue.fields.key, { nullValue: 'NULL_VALUE' });
  });
});

describe('_test.normalizeBaseUrl', () => {
  it('valid https url -> normalized', () => {
    assert.equal(_test.normalizeBaseUrl('https://scanner.example.com:8443'), 'https://scanner.example.com:8443');
  });

  it('trailing slash stripped', () => {
    assert.equal(_test.normalizeBaseUrl('https://scanner.example.com:8443/'), 'https://scanner.example.com:8443');
  });

  it('multiple trailing slashes stripped', () => {
    assert.equal(_test.normalizeBaseUrl('HTTPS://scanner.example.com:8443///'), 'HTTPS://scanner.example.com:8443');
  });

  it('invalid url (no scheme) -> empty string', () => {
    assert.equal(_test.normalizeBaseUrl('scanner.example.com:8443'), '');
  });

  it('empty string -> empty string', () => {
    assert.equal(_test.normalizeBaseUrl(''), '');
  });

  it('url with path -> path preserved (no stripping of mid-path segments)', () => {
    assert.equal(_test.normalizeBaseUrl('https://scanner.example.com:8443/api'), 'https://scanner.example.com:8443/api');
  });

  it('http scheme also valid', () => {
    assert.equal(_test.normalizeBaseUrl('http://192.168.1.1:8080'), 'http://192.168.1.1:8080');
  });
});

describe('_test.mergedBindings', () => {
  it('merges config, secret, bindings with bindings winning', () => {
    const ctx = {
      config:   { restBaseUrl: 'from-config', extra: 'cfg' },
      secret:   { user: 'secret-user', pwd: 'secret-pass' },
      bindings: { restBaseUrl: 'from-bindings' },
    };
    const merged = _test.mergedBindings(ctx);
    assert.equal(merged.restBaseUrl, 'from-bindings');
    assert.equal(merged.extra, 'cfg');
    assert.equal(merged.user, 'secret-user');
    assert.equal(merged.pwd, 'secret-pass');
  });

  it('empty ctx returns empty-ish object', () => {
    const merged = _test.mergedBindings({});
    assert.equal(typeof merged, 'object');
  });

  it('config values available when no bindings override', () => {
    const ctx = { config: { timeout: 3000 }, secret: {}, bindings: {} };
    const merged = _test.mergedBindings(ctx);
    assert.equal(merged.timeout, 3000);
  });

  it('secret values available when not overridden', () => {
    const ctx = { config: {}, secret: { apiKey: 'key123' }, bindings: {} };
    const merged = _test.mergedBindings(ctx);
    assert.equal(merged.apiKey, 'key123');
  });
});

// ---------------------------------------------------------------------------
// Extra branch-coverage tests
// ---------------------------------------------------------------------------

describe('ControlTask: invalid controltype', () => {
  beforeEach(() => { lastFetchArgs = null; });
  afterEach(() => { globalThis.fetch = undefined; });

  it('unknown controltype -> INVALID_ARGUMENT', async () => {
    const ctx = buildCtx({ req: { token: 'tok', controltype: 'NOOP', taskallid: '5' } });
    await assert.rejects(
      () => rpcdef(ctx)[PATH_CONTROL_TASK](),
      (err) => { assert.match(err.message, /INVALID_ARGUMENT/); return true; },
    );
  });
});

describe('upstream FAILED_PRECONDITION path', () => {
  beforeEach(() => { lastFetchArgs = null; });
  afterEach(() => { globalThis.fetch = undefined; });

  it('upstream errorcode 1006 -> FAILED_PRECONDITION', async () => {
    globalThis.fetch = makeFetch({ success: false, errorcode: 1006 });
    const ctx = buildCtx({ req: { token: 'tok', controltype: 'stop', taskallid: '5' } });
    await assert.rejects(
      () => rpcdef(ctx)[PATH_CONTROL_TASK](),
      (err) => { assert.match(err.message, /FAILED_PRECONDITION/); return true; },
    );
  });

  it('HTTP 422 -> FAILED_PRECONDITION', async () => {
    globalThis.fetch = makeFetch({}, 422);
    const ctx = buildCtx({ req: { token: 'tok', controltype: 'stop', taskallid: '5' } });
    await assert.rejects(
      () => rpcdef(ctx)[PATH_CONTROL_TASK](),
      (err) => { assert.match(err.message, /FAILED_PRECONDITION/); return true; },
    );
  });
});

describe('alternative URL aliases', () => {
  beforeEach(() => { lastFetchArgs = null; });
  afterEach(() => { globalThis.fetch = undefined; });

  it('baseUrl alias is accepted', async () => {
    globalThis.fetch = makeFetch({ success: true, token: 'tok' });
    const ctx = {
      bindings: { baseUrl: 'https://scanner.example.com' },
      config: {},
      secret: { user: 'admin', pwd: 'pass123' },
      limits: { timeoutMs: 5000 },
      meta: {},
      req: {},
    };
    const res = await rpcdef(ctx)[PATH_GET_TOKEN]();
    assert.equal(res.token, 'tok');
  });

  it('rest_base_url alias is accepted', async () => {
    globalThis.fetch = makeFetch({ success: true, token: 'tok' });
    const ctx = {
      bindings: { rest_base_url: 'https://scanner.example.com' },
      config: {},
      secret: { user: 'admin', pwd: 'pass123' },
      limits: { timeoutMs: 5000 },
      meta: {},
      req: {},
    };
    const res = await rpcdef(ctx)[PATH_GET_TOKEN]();
    assert.equal(res.token, 'tok');
  });
});

describe('TLS skip verify', () => {
  beforeEach(() => { lastFetchArgs = null; });
  afterEach(() => { globalThis.fetch = undefined; });

  it('tlsInsecureSkipVerify: true still calls fetch successfully', async () => {
    globalThis.fetch = makeFetch({ success: true, token: 'tok' });
    const ctx = buildCtx({ bindings: { tlsInsecureSkipVerify: true } });
    const res = await rpcdef(ctx)[PATH_GET_TOKEN]();
    assert.equal(res.token, 'tok');
  });
});

describe('_test.unwrapString', () => {
  it('plain string -> same string', () => {
    assert.equal(_test.unwrapString('hello'), 'hello');
  });

  it('object with value -> extracts value as string', () => {
    assert.equal(_test.unwrapString({ value: 'abc' }), 'abc');
  });

  it('object with null value -> empty string', () => {
    assert.equal(_test.unwrapString({ value: null }), '');
  });

  it('null -> empty string', () => {
    assert.equal(_test.unwrapString(null), '');
  });

  it('undefined -> empty string', () => {
    assert.equal(_test.unwrapString(undefined), '');
  });

  it('number input -> coerced to string', () => {
    assert.equal(_test.unwrapString(42), '42');
  });
});

describe('unwrapString via field wrapper in request', () => {
  beforeEach(() => { lastFetchArgs = null; });
  afterEach(() => { globalThis.fetch = undefined; });

  it('token as {value: string} is unwrapped correctly', async () => {
    globalThis.fetch = makeFetch({ success: false, errorcode: 1002 });
    const ctx = buildCtx({ req: { token: { value: 'abc-tok' }, controltype: 'stop', taskallid: '5' } });
    await assert.rejects(
      () => rpcdef(ctx)[PATH_CONTROL_TASK](),
      (err) => { assert.match(err.message, /PERMISSION_DENIED/); return true; },
    );
  });
});

describe('HTTP 403 -> PERMISSION_DENIED', () => {
  beforeEach(() => { lastFetchArgs = null; });
  afterEach(() => { globalThis.fetch = undefined; });

  it('HTTP 403 -> PERMISSION_DENIED', async () => {
    globalThis.fetch = makeFetch({}, 403);
    const ctx = buildCtx({ req: { token: 'tok', controltype: 'stop', taskallid: '5' } });
    await assert.rejects(
      () => rpcdef(ctx)[PATH_CONTROL_TASK](),
      (err) => { assert.match(err.message, /PERMISSION_DENIED/); return true; },
    );
  });
});

describe('endpoint alias', () => {
  beforeEach(() => { lastFetchArgs = null; });
  afterEach(() => { globalThis.fetch = undefined; });

  it('endpoint alias is accepted', async () => {
    globalThis.fetch = makeFetch({ success: true, token: 'tok' });
    const ctx = {
      bindings: { endpoint: 'https://scanner.example.com' },
      config: {},
      secret: { user: 'admin', pwd: 'pass123' },
      limits: { timeoutMs: 5000 },
      meta: {},
      req: {},
    };
    const res = await rpcdef(ctx)[PATH_GET_TOKEN]();
    assert.equal(res.token, 'tok');
  });
});

describe('_test.toValue exotic types', () => {
  it('function value -> stringValue fallback (line 48)', () => {
    const fn = function myFn() {};
    const result = _test.toValue(fn);
    assert.ok(result !== null && typeof result.stringValue === 'string');
  });
});

describe('timeoutMs edge cases', () => {
  beforeEach(() => { lastFetchArgs = null; });
  afterEach(() => { globalThis.fetch = undefined; });

  it('timeoutMs=0 -> no AbortSignal added', async () => {
    globalThis.fetch = makeFetch({ success: true, token: 'tok' });
    const ctx = buildCtx({ limits: { timeoutMs: 0 } });
    const res = await rpcdef(ctx)[PATH_GET_TOKEN]();
    assert.equal(res.token, 'tok');
  });
});

describe('handler legacy single-arg mode', () => {
  beforeEach(() => { lastFetchArgs = null; });
  afterEach(() => { globalThis.fetch = undefined; });

  it('single ctx-object arg works (legacy call convention)', async () => {
    globalThis.fetch = makeFetch({ success: true, token: 'tok' });
    // Pass the full ctx object as the only argument (no separate req)
    const ctx = buildCtx({ req: { user: 'admin', pwd: 'pass' } });
    const res = await handlers[METHOD_GET_TOKEN](ctx);
    assert.equal(res.token, 'tok');
  });
});

// ---------------------------------------------------------------------------
// QueryWebScanResult
// ---------------------------------------------------------------------------
describe('QueryWebScanResult', () => {
  it('returns web scan result on success', async () => {
    const mockBody = {
      success: true,
      status: 'completed',
      hostscount: 1,
      total: 5,
      hosts: [{ id: 1, progress: 100 }],
    };
    global.fetch = makeFetch(mockBody);
    const ctx = buildCtx();
    const def = rpcdef({ ...ctx, req: { token: 'tok', taskid: '9' } });
    const r = await def[PREFIX + 'QueryWebScanResult']();
    assert.equal(r.success, true);
    assert.equal(r.status, 'completed');
    assert.equal(r.hostscount, 1);
    assert.equal(r.total, 5);
    assert.ok(Array.isArray(r.hosts));
  });

  it('rejects when token missing', async () => {
    global.fetch = makeFetch({ success: true });
    const ctx = buildCtx();
    const def = rpcdef({ ...ctx, req: { taskid: '9' } });
    await assert.rejects(def[PREFIX + 'QueryWebScanResult'](), /INVALID_ARGUMENT/);
  });

  it('rejects when taskid missing', async () => {
    global.fetch = makeFetch({ success: true });
    const ctx = buildCtx();
    const def = rpcdef({ ...ctx, req: { token: 'tok' } });
    await assert.rejects(def[PREFIX + 'QueryWebScanResult'](), /INVALID_ARGUMENT/);
  });

  it('propagates upstream error', async () => {
    global.fetch = makeFetch({ success: false, errorcode: 1006 });
    const ctx = buildCtx();
    const def = rpcdef({ ...ctx, req: { token: 'tok', taskid: '9' } });
    await assert.rejects(def[PREFIX + 'QueryWebScanResult'](), /FAILED_PRECONDITION/);
  });

  it('throws UNAVAILABLE on network error', async () => {
    global.fetch = networkErrorFetch;
    const ctx = buildCtx();
    const def = rpcdef({ ...ctx, req: { token: 'tok', taskid: '9' } });
    await assert.rejects(def[PREFIX + 'QueryWebScanResult'](), /UNAVAILABLE/);
  });
});

// ---------------------------------------------------------------------------
// QueryWeakPassResult
// ---------------------------------------------------------------------------
describe('QueryWeakPassResult', () => {
  it('returns cracked credentials on success', async () => {
    const mockBody = {
      success: true,
      status: 'completed',
      hostscount: 1,
      total: 2,
      hosts: [{ id: 1, results: [{ host: '1.2.3.4', login: 'admin', password: '1234', service: 'ssh' }] }],
    };
    global.fetch = makeFetch(mockBody);
    const ctx = buildCtx();
    const def = rpcdef({ ...ctx, req: { token: 'tok', taskid: '11' } });
    const r = await def[PREFIX + 'QueryWeakPassResult']();
    assert.equal(r.success, true);
    assert.equal(r.total, 2);
    assert.ok(Array.isArray(r.hosts));
  });

  it('rejects when token missing', async () => {
    global.fetch = makeFetch({ success: true });
    const ctx = buildCtx();
    const def = rpcdef({ ...ctx, req: { taskid: '11' } });
    await assert.rejects(def[PREFIX + 'QueryWeakPassResult'](), /INVALID_ARGUMENT/);
  });

  it('rejects when taskid missing', async () => {
    global.fetch = makeFetch({ success: true });
    const ctx = buildCtx();
    const def = rpcdef({ ...ctx, req: { token: 'tok' } });
    await assert.rejects(def[PREFIX + 'QueryWeakPassResult'](), /INVALID_ARGUMENT/);
  });

  it('throws UNAVAILABLE on network error', async () => {
    global.fetch = networkErrorFetch;
    const ctx = buildCtx();
    const def = rpcdef({ ...ctx, req: { token: 'tok', taskid: '11' } });
    await assert.rejects(def[PREFIX + 'QueryWeakPassResult'](), /UNAVAILABLE/);
  });
});

// ---------------------------------------------------------------------------
// GetDeviceStatus
// ---------------------------------------------------------------------------
describe('GetDeviceStatus', () => {
  it('returns device status object on success', async () => {
    const mockBody = {
      success: true,
      'CPU Load': '5%',
      'Disk Usage': '10G/100G (10%)',
      'Memory Usage': '4G/8G, 50%',
      System: '3.5.3-R1',
      engine: [{ ip: '127.0.0.1', name: 'local', status: 1, type: 'sysscan' }],
    };
    global.fetch = makeFetch(mockBody);
    const ctx = buildCtx();
    const def = rpcdef({ ...ctx, req: {} });
    const r = await def[PREFIX + 'GetDeviceStatus']();
    assert.equal(r.success, true);
    assert.ok(r.device_info != null);
  });

  it('throws when no baseUrl', async () => {
    global.fetch = makeFetch({ success: true });
    const ctx = buildCtx({ bindings: {} });
    const def = rpcdef({ ...ctx, req: {} });
    await assert.rejects(def[PREFIX + 'GetDeviceStatus'](), /INVALID_ARGUMENT/);
  });

  it('throws UNAVAILABLE on network error', async () => {
    global.fetch = networkErrorFetch;
    const ctx = buildCtx();
    const def = rpcdef({ ...ctx, req: {} });
    await assert.rejects(def[PREFIX + 'GetDeviceStatus'](), /UNAVAILABLE/);
  });
});

// ---------------------------------------------------------------------------
// ListVulTemplates
// ---------------------------------------------------------------------------
describe('ListVulTemplates', () => {
  it('returns template list for sysscan', async () => {
    const mockBody = { success: true, aaData: [{ id: 1, name: '全部漏洞扫描' }, { id: 2, name: 'Linux漏洞' }] };
    global.fetch = makeFetch(mockBody);
    const ctx = buildCtx();
    const def = rpcdef({ ...ctx, req: { token: 'tok', type: 'sysscan' } });
    const r = await def[PREFIX + 'ListVulTemplates']();
    assert.equal(r.success, true);
    assert.equal(r.aaData.length, 2);
  });

  it('returns template list for webscan', async () => {
    const mockBody = { success: true, aaData: [{ id: 70, name: '全部WEB漏洞' }] };
    global.fetch = makeFetch(mockBody);
    const ctx = buildCtx();
    const def = rpcdef({ ...ctx, req: { token: 'tok', type: 'webscan' } });
    const r = await def[PREFIX + 'ListVulTemplates']();
    assert.equal(r.success, true);
    assert.equal(r.aaData.length, 1);
  });

  it('rejects invalid type', async () => {
    global.fetch = makeFetch({ success: true });
    const ctx = buildCtx();
    const def = rpcdef({ ...ctx, req: { token: 'tok', type: 'invalid' } });
    await assert.rejects(def[PREFIX + 'ListVulTemplates'](), /INVALID_ARGUMENT/);
  });

  it('rejects when token missing', async () => {
    global.fetch = makeFetch({ success: true });
    const ctx = buildCtx();
    const def = rpcdef({ ...ctx, req: { type: 'sysscan' } });
    await assert.rejects(def[PREFIX + 'ListVulTemplates'](), /INVALID_ARGUMENT/);
  });

  it('throws UNAVAILABLE on network error', async () => {
    global.fetch = networkErrorFetch;
    const ctx = buildCtx();
    const def = rpcdef({ ...ctx, req: { token: 'tok', type: 'sysscan' } });
    await assert.rejects(def[PREFIX + 'ListVulTemplates'](), /UNAVAILABLE/);
  });
});

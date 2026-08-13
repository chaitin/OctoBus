// 360 EPP service test: parameter validation, API mapping, error mapping, auth flow

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { fork } from 'child_process';

import { handlers, rpcdef, _test } from '../src/360-epp.js';

const mockUrl = (port) => `http://127.0.0.1:${port}`;

function startMock() {
  return new Promise((resolve, reject) => {
    const child = fork(new URL('mock_upstream.js', import.meta.url), [], {
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    child.on('message', (msg) => {
      if (msg?.port) resolve({ child, port: msg.port });
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code !== 0 && code !== null) reject(new Error(`mock exited with ${code}`));
    });
    setTimeout(() => reject(new Error('mock start timeout')), 10000);
  });
}

describe('360 EPP Service', () => {
  let mockServer;
  let mockPort;

  before(async () => {
    const mock = await startMock();
    mockServer = mock.child;
    mockPort = mock.port;
  });

  after(() => {
    if (mockServer) mockServer.kill();
  });

  function makeCtx(overrides = {}, reqOverrides = {}) {
    return {
      req: { ...reqOverrides },
      config: {},
      secret: {},
      bindings: {
        endpoint: mockUrl(mockPort),
        username: 'eppadmin',
        password: 'Chaitin123..',
        skipTlsVerify: true,
        ...overrides,
      },
      meta: { instance_id: 'test-instance' },
      limits: {},
    };
  }

  describe('rpcdef', () => {
    it('should return handlers for all methods', () => {
      const ctx = makeCtx();
      const methods = rpcdef(ctx);
      const keys = Object.keys(methods);
      assert.ok(keys.length >= 7, `expected >=7 methods, got ${keys.length}`);
      assert.ok(keys.every((k) => typeof methods[k] === 'function'));
    });

    it('should throw for missing endpoint', async () => {
      const ctx = makeCtx({ endpoint: '' });
      try {
        await rpcdef(ctx)['Qihoo360_EPP.Qihoo360_EPP/GetDashboardInfo']();
        assert.fail('should have thrown');
      } catch (e) {
        assert.ok(e.message.includes('endpoint') || e.message.includes('baseUrl'));
      }
    });

    it('should throw for missing credentials', async () => {
      const ctx = makeCtx({ username: '', password: '' });
      try {
        await rpcdef(ctx)['Qihoo360_EPP.Qihoo360_EPP/GetDashboardInfo']();
        assert.fail('should have thrown');
      } catch (e) {
        assert.ok(e.message.includes('username') || e.message.includes('password'));
      }
    });
  });

  describe('GetDashboardInfo', () => {
    it('should fetch dashboard info', async () => {
      const ctx = makeCtx();
      const result = await rpcdef(ctx)['Qihoo360_EPP.Qihoo360_EPP/GetDashboardInfo']();
      assert.ok(result.data);
    });
  });

  describe('Terminal operations', () => {
    it('lists, describes, and returns terminal hardware', async () => {
      const ctx = makeCtx({}, { page: 2, page_size: 10, keyword: 'pc', group_id: 'g', status: 'online' });
      const methods = rpcdef(ctx);
      const list = await methods['Qihoo360_EPP.Qihoo360_EPP/ListTerminals']();
      assert.equal(list.total, 1);
      assert.equal(list.terminals[0].name, 'pc');

      const detailCtx = makeCtx({}, { terminal_id: '7' });
      const detail = await rpcdef(detailCtx)['Qihoo360_EPP.Qihoo360_EPP/GetTerminalDetail']();
      assert.equal(detail.id, '7');
      assert.equal(detail.os_version, '11');
      const hardware = await rpcdef(detailCtx)['Qihoo360_EPP.Qihoo360_EPP/GetTerminalHardware']();
      assert.equal(hardware.cpu_cores, '8');
    });

    it('requires terminal ids', async () => {
      const methods = rpcdef(makeCtx());
      await assert.rejects(methods['Qihoo360_EPP.Qihoo360_EPP/GetTerminalDetail'], /terminal_id is required/);
      await assert.rejects(methods['Qihoo360_EPP.Qihoo360_EPP/GetTerminalHardware'], /terminal_id is required/);
    });

    it('supports defineService handlers', async () => {
      const result = await handlers['Qihoo360_EPP.Qihoo360_EPP/ListTerminals'](makeCtx());
      assert.equal(result.total, 1);
    });
  });

  describe('ListAlarms', () => {
    it('should fetch alarm list', async () => {
      const ctx = makeCtx();
      const result = await rpcdef(ctx)['Qihoo360_EPP.Qihoo360_EPP/ListAlarms']();
      assert.ok(result.alarms);
      assert.ok(Array.isArray(result.alarms));
      assert.ok(result.total >= 0);
    });
  });

  describe('GetVirusStats', () => {
    it('should fetch virus stats', async () => {
      const ctx = makeCtx();
      const result = await rpcdef(ctx)['Qihoo360_EPP.Qihoo360_EPP/GetVirusStats']();
      assert.ok(result.data);
    });
  });

  describe('GetLeakFixStats', () => {
    it('should fetch leakfix stats', async () => {
      const ctx = makeCtx();
      const result = await rpcdef(ctx)['Qihoo360_EPP.Qihoo360_EPP/GetLeakFixStats']();
      assert.ok(result.data);
    });
  });

  describe('Login flow', () => {
    it('should login and cache session', async () => {
      const ctx = makeCtx();
      const result1 = await rpcdef(ctx)['Qihoo360_EPP.Qihoo360_EPP/GetDashboardInfo']();
      assert.ok(result1.data);
      // Second call should use cached session
      const result2 = await rpcdef(ctx)['Qihoo360_EPP.Qihoo360_EPP/GetVirusStats']();
      assert.ok(result2.data);
    });
  });

  describe('Error handling', () => {
    it('should handle login failure', async () => {
      const ctx = makeCtx({ password: 'wrong_password' });
      try {
        await rpcdef(ctx)['Qihoo360_EPP.Qihoo360_EPP/GetDashboardInfo']();
        assert.fail('should have thrown');
      } catch (e) {
        assert.ok(e.message.includes('login') || e.message.includes('鉴权') || e.message.includes('auth'));
      }
    });
  });

  describe('boundary mappings', () => {
    it('normalizes configuration and numeric inputs', () => {
      assert.equal(_test.normalizeBaseUrl(' https://example.test/ '), 'https://example.test');
      assert.equal(_test.normalizeBaseUrl('ftp://bad'), null);
      assert.equal(_test.toPositiveInt({ value: '2' }), 2);
      assert.equal(_test.toPositiveInt({}), null);
      assert.equal(_test.toPositiveInt('bad'), null);
      assert.equal(_test.toPositiveInt(1.5), null);
      assert.equal(_test.toPositiveInt(3), 3);
      assert.equal(_test.toPositiveInt(null), null);
      assert.equal(_test.firstDefined(undefined, null, 0), 0);
      assert.equal(_test.hasOwn(null, 'x'), false);
      assert.equal(_test.hasOwn({ x: 1 }, 'x'), true);
      assert.deepEqual(_test.mergedBindings({ config: { a: 1 }, secret: { b: 2 }, bindings: { c: 3 } }), { a: 1, b: 2, c: 3 });
    });

    it('maps sparse values without leaking undefined fields', () => {
      assert.equal(_test.toStructValue(null), null);
      assert.deepEqual(_test.toStructValue(2), { stringValue: '2' });
      assert.deepEqual(_test.toStructValue([1, null]), { listValue: { values: [{ stringValue: '1' }] } });
      assert.deepEqual(_test.mapTerminalInfo({ hostname: 'pc', groupName: 'g', lastOnlineTime: 'now', antivirusStatus: 'ok' }), {
        id: '', name: 'pc', ip: '', mac: '', os: '', status: '', group_name: 'g', last_online_time: 'now', antivirus_status: 'ok',
      });
      assert.equal(_test.mapTerminalInfo({ name: 'named' }).name, 'named');
      assert.deepEqual(_test.mapAlarmInfo({ alarm_type: 'virus', level: 'high', name: 'n', desc: 'd', hostname: 'pc', ip: '1', time: 'now' }), {
        id: '', type: 'virus', severity: 'high', title: 'n', description: 'd', terminal_name: 'pc', terminal_ip: '1', created_time: 'now', status: '',
      });
      assert.equal(_test.mapAlarmInfo({ type: 'direct', title: 'title' }).type, 'direct');
    });

    it('maps all grpc error classes', () => {
      for (const code of ['INVALID_ARGUMENT', 'FAILED_PRECONDITION', 'PERMISSION_DENIED', 'UNAVAILABLE', 'DEADLINE_EXCEEDED', 'UNAUTHENTICATED', 'NOT_FOUND', 'OTHER']) {
        assert.equal(_test.errorWithCode(code, 'message').legacyCode, code);
      }
    });

    it('configures sessions and resets credentials safely', () => {
      const session = new _test.EppSession();
      session.cookie = 'PN=old';
      session.configure({
        config: { endpoint: 'https://epp.test/', timeoutMs: 123 },
        secret: { username: 'new', password: 'pw' }, limits: {},
      });
      assert.equal(session.baseUrl, 'https://epp.test');
      assert.equal(session.timeoutMs, 123);
      assert.equal(session.cookie, null);
      session.cookie = 'PN=current';
      session.configure({ bindings: { endpoint: 'http://epp.test', username: 'new', password: 'pw', skip_tls_verify: true }, limits: { timeoutMs: 456 } });
      assert.equal(session.cookie, 'PN=current');
      assert.equal(session.timeoutMs, 456);
      assert.equal(session.skipTlsVerify, true);
    });

    it('handles API response and session error branches', async () => {
      const session = new _test.EppSession();
      session.baseUrl = 'http://epp.test';
      await assert.rejects(() => session.apiGet('/x'), /not logged in/);
      await assert.rejects(() => session.apiPost('/x'), /not logged in/);
      session.cookie = 'PN=x';
      session.fetchWithTimeout = async () => ({ ok: false, status: 502 });
      await assert.rejects(() => session.apiGet('/x'), /HTTP 502/);
      await assert.rejects(() => session.apiPost('/x'), /HTTP 502/);
      session.fetchWithTimeout = async () => ({ ok: true, json: async () => ({ errno: 7, errmsg: 'bad' }) });
      await assert.rejects(() => session.apiGet('/x'), /FAILED_PRECONDITION/);
      await assert.rejects(() => session.apiPost('/x'), /FAILED_PRECONDITION/);
      session.fetchWithTimeout = async () => ({ ok: true, json: async () => ({ errno: 10401, errmsg: 'expired' }) });
      await assert.rejects(() => session.apiGet('/x'), /session expired/);
      session.cookie = 'PN=x';
      await assert.rejects(() => session.apiPost('/x'), /session expired/);
    });

    it('re-authenticates once after an expired API session', async () => {
      for (const method of ['apiGet', 'apiPost']) {
        const session = new _test.EppSession();
        session.baseUrl = 'http://epp.test';
        session.cookie = 'PN=old';
        session.username = 'u';
        session.password = 'p';
        let requests = 0;
        session.login = async () => { session.cookie = 'PN=new'; };
        session.fetchWithTimeout = async () => ({
          ok: true,
          json: async () => (++requests === 1 ? { errno: 10401, errmsg: 'expired' } : { errno: 0, data: { ok: true } }),
        });
        const result = await session[method]('/x', { empty: '', nil: null, keep: 1 });
        assert.equal(result.data.ok, true);
        assert.equal(requests, 2);
      }
    });
  });
});

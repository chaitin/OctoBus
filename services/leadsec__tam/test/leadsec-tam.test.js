import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { handlers, METHOD_ADD_BLACKLIST_FULL, METHOD_ADD_WHITELIST_FULL } from '../src/leadsec-tam.js';
import { createMockUpstream } from './mock_upstream.js';

const withMock = async (fn) => {
  const upstream = createMockUpstream();
  const baseUrl = await upstream.start();
  try {
    await fn(baseUrl, upstream);
  } finally {
    await upstream.stop();
  }
};

const withFetchStub = async (stub, fn) => {
  const originalFetch = global.fetch;
  global.fetch = stub;
  try {
    return await fn();
  } finally {
    global.fetch = originalFetch;
  }
};

const jsonResponse = (json, status = 200) => new Response(JSON.stringify(json), {
  status,
  headers: { 'content-type': 'application/json' },
});

const baseCtx = (baseUrl, req) => ({
  config: {
    baseUrl,
    timeoutMs: 5000,
  },
  secret: {
    username: 'admin',
    password: 'secret',
  },
  req,
});

describe('leadsec-TAM service', () => {
  it('adds blacklist IP addresses and verifies them', async () => {
    await withMock(async (baseUrl, upstream) => {
      const result = await handlers[METHOD_ADD_BLACKLIST_FULL](baseCtx(baseUrl, {
        ip_list: ['192.0.2.10'],
        remark: 'test blacklist',
        request_id: 'req-black',
      }));

      assert.equal(result.status, 'OPERATION_STATUS_SUCCESS');
      assert.equal(result.requestId, 'req-black');
      assert.deepEqual(result.verifiedIps, ['192.0.2.10']);
      const addCall = upstream.calls.find((call) => call.method === 'POST' && call.path.endsWith('/ip_bwlist/info'));
      assert.ok(addCall);
      assert.deepEqual(JSON.parse(addCall.bodyText), {
        ipadd: ['192.0.2.10'],
        ipdirection: 1,
        ipstate: 100,
        remark: 'test blacklist',
      });
    });
  });

  it('adds whitelist IP addresses and verifies them', async () => {
    await withMock(async (baseUrl, upstream) => {
      const result = await handlers[METHOD_ADD_WHITELIST_FULL](baseCtx(baseUrl, {
        ip_list: ['198.51.100.20'],
      }));

      assert.equal(result.status, 'OPERATION_STATUS_SUCCESS');
      assert.deepEqual(result.verifiedIps, ['198.51.100.20']);
      const addCall = upstream.calls.find((call) => call.method === 'POST' && call.path.endsWith('/ip_bwlist/info'));
      assert.equal(JSON.parse(addCall.bodyText).ipstate, 200);
    });
  });

  it('rejects invalid IP addresses', async () => {
    await withMock(async (baseUrl) => {
      await assert.rejects(
        handlers[METHOD_ADD_BLACKLIST_FULL](baseCtx(baseUrl, { ip_list: ['999.1.1.1'] })),
        /INVALID_ARGUMENT/,
      );
    });
  });

  it('uses AbortSignal timeout for upstream fetch calls', async () => {
    const calls = [];
    await withFetchStub(async (url, init = {}) => {
      calls.push({ url, init });
      if (url.endsWith('/web_login/ddos')) {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ result: '0', message: { token: 'mock-token' } }),
        };
      }
      if (url.endsWith('/ip_bwlist/info')) {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ result: '0', message: null }),
        };
      }
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ result: '0', count: 1, message: [{ ipadd: '192.0.2.10' }] }),
      };
    }, async () => {
      await handlers[METHOD_ADD_BLACKLIST_FULL](baseCtx('https://tam.example.local', {
        ip_list: ['192.0.2.10'],
      }));
    });

    assert.ok(calls[0].init.signal instanceof AbortSignal);
    assert.equal('timeoutMs' in calls[0].init, false);
  });

  it('does not verify IPs from count when upstream returns no items', async () => {
    await withFetchStub(async (url) => {
      if (url.endsWith('/web_login/ddos')) {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ result: '0', message: { token: 'mock-token' } }),
        };
      }
      if (url.endsWith('/ip_bwlist/info')) {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ result: '0', message: null }),
        };
      }
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ result: '0', count: 1, message: [] }),
      };
    }, async () => {
      await assert.rejects(
        handlers[METHOD_ADD_BLACKLIST_FULL](baseCtx('https://tam.example.local', {
          ip_list: ['192.0.2.10'],
        })),
        /not all IP addresses were verified/,
      );
    });
  });

  it('validates configuration and the proto IP contract before network access', async () => {
    const request = { ipList: ['192.0.2.1'] };
    await assert.rejects(
      handlers[METHOD_ADD_BLACKLIST_FULL]({ config: { baseUrl: 'ftp://tam.example' }, secret: { username: 'u', password: 'p' }, request }),
      /valid HTTP\(S\) URL/,
    );
    await assert.rejects(
      handlers[METHOD_ADD_BLACKLIST_FULL]({ config: { baseUrl: 'https://u:p@tam.example' }, secret: { username: 'u', password: 'p' }, request }),
      /valid HTTP\(S\) URL/,
    );
    await assert.rejects(
      handlers[METHOD_ADD_BLACKLIST_FULL]({ config: { baseUrl: 'https://tam.example' }, secret: {}, request }),
      /username and secret.password are required/,
    );

    for (const ipList of [[], [''], ['192.0.2.1/33'], ['192.0.2.1/x'], ['192.0.2.1/24/1'], ['300.0.0.1']]) {
      await assert.rejects(
        handlers[METHOD_ADD_BLACKLIST_FULL](baseCtx('https://tam.example', { ip_list: ipList })),
        /INVALID_ARGUMENT/,
      );
    }
  });

  it('maps upstream authentication, HTTP, and protocol failures', async () => {
    const invoke = (fetchImpl) => withFetchStub(fetchImpl, () => handlers[METHOD_ADD_BLACKLIST_FULL](
      baseCtx('https://tam.example', { ip_list: ['192.0.2.1'] }),
    ));

    await assert.rejects(invoke(async () => jsonResponse({ result: '1', message: 'denied' })), /login failed/);
    await assert.rejects(invoke(async () => jsonResponse({ result: '0', message: {} })), /does not contain a token/);
    await assert.rejects(invoke(async () => jsonResponse({ message: 'forbidden' }, 403)), /HTTP 403/);
    await assert.rejects(invoke(async () => jsonResponse([])), /invalid JSON object/);

    let call = 0;
    await assert.rejects(invoke(async () => {
      call += 1;
      if (call === 1) return jsonResponse({ result: 0, token: 'token' });
      return jsonResponse({ result: '99', message: 'rejected' });
    }), /add ip list failed/);
  });

  it('supports documented response variants and already-existing addresses', async () => {
    let call = 0;
    await withFetchStub(async () => {
      call += 1;
      if (call === 1) return jsonResponse({ code: 0, data: { access_token: 'token-from-data' } });
      if (call === 2) return jsonResponse({ code: '-391201', message: 'already exists' });
      return jsonResponse({ code: 0, data: { items: [{ ip: '192.0.2.1/32' }] } });
    }, async () => {
      const result = await handlers[METHOD_ADD_WHITELIST_FULL]({
        config: { baseUrl: 'https://tam.example', language: '', remark: '', timeoutMs: 0 },
        secret: { username: 'admin', password: 'secret' },
        request: { ipList: ['192.0.2.1/32', '192.0.2.1/32'], requestId: 'camel-id' },
      });
      assert.equal(result.requestedIpCount, 1);
      assert.equal(result.requestId, 'camel-id');
      assert.deepEqual(result.verifiedIps, ['192.0.2.1/32']);
      assert.equal(result.upstreamResult, '-391201');
    });
  });
});

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
      assert.equal(result.request_id, 'req-black');
      assert.deepEqual(result.verified_ips, ['192.0.2.10']);
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
      assert.deepEqual(result.verified_ips, ['198.51.100.20']);
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
    global.fetch = async (url, init = {}) => {
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
    };

    await handlers[METHOD_ADD_BLACKLIST_FULL](baseCtx('https://tam.example.local', {
      ip_list: ['192.0.2.10'],
    }));

    assert.ok(calls[0].init.signal instanceof AbortSignal);
    assert.equal('timeoutMs' in calls[0].init, false);
  });

  it('does not verify IPs from count when upstream returns no items', async () => {
    global.fetch = async (url) => {
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
    };

    await assert.rejects(
      handlers[METHOD_ADD_BLACKLIST_FULL](baseCtx('https://tam.example.local', {
        ip_list: ['192.0.2.10'],
      })),
      /not all IP addresses were verified/,
    );
  });
});

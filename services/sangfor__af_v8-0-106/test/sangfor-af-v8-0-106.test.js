import assert from 'node:assert/strict';
import test from 'node:test';

import { handlers } from '../src/sangfor-af-v8-0-106.js';

test('sangfor-af-v8-0-106 exposes all proto handlers', () => {
  const expected = ["sangfor.af.v8_0_106.SangforAfService/Login","sangfor.af.v8_0_106.SangforAfService/KeepAlive","sangfor.af.v8_0_106.SangforAfService/Logout","sangfor.af.v8_0_106.SangforAfService/GetPasswordPolicy","sangfor.af.v8_0_106.SangforAfService/AddIpGroup","sangfor.af.v8_0_106.SangforAfService/DeleteIpGroup","sangfor.af.v8_0_106.SangforAfService/GenericRequest"];
  for (const method of expected) assert.equal(typeof handlers[method], 'function', method);
});

test('sangfor-af-v8-0-106 calls upstream and maps response', async () => {
  const calls = [];
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify({ status: 200, msg: 'ok', token: 'tok' }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const result = await handlers['sangfor.af.v8_0_106.SangforAfService/Login']({
      request: { username: 'api', password: 'pass', namespace: 'public' },
      config: { baseUrl: 'http://127.0.0.1:18080', allowInsecureHttp: true },
      secret: { username: 'api', password: 'pass' },
    });
    assert.equal(result.status, 200);
    assert.match(result.body, /ok|tok/);
    assert.equal(calls.length, 1);
    assert.equal(JSON.parse(calls[0].init.body).name, 'api');
    assert.equal(JSON.parse(calls[0].init.body).username, undefined);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('sangfor-af-v8-0-106 uses documented auth endpoints', async () => {
  const calls = [];
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify({ code: 0, message: 'ok' }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    await handlers['sangfor.af.v8_0_106.SangforAfService/KeepAlive']({
      request: { token: 'tok', namespace: 'public' },
      config: { baseUrl: 'http://127.0.0.1:18080', allowInsecureHttp: true },
      secret: {},
    });
    await handlers['sangfor.af.v8_0_106.SangforAfService/Logout']({
      request: { token: 'tok', namespace: 'public' },
      config: { baseUrl: 'http://127.0.0.1:18080', allowInsecureHttp: true },
      secret: {},
    });
    assert.equal(calls[0].init.method, 'GET');
    assert.equal(calls[0].init.body, undefined);
    assert.equal(calls[1].init.method, 'POST');
    assert.equal(JSON.parse(calls[1].init.body).loginResult.token, 'tok');
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('sangfor-af-v8-0-106 sends ip group payload from payloadJson', async () => {
  const calls = [];
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify({ code: 0, message: 'ok' }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    await handlers['sangfor.af.v8_0_106.SangforAfService/AddIpGroup']({
      request: { token: 'tok', namespace: 'public', payloadJson: '{"name":"group-a"}' },
      config: { baseUrl: 'http://127.0.0.1:18080', allowInsecureHttp: true },
      secret: {},
    });
    assert.equal(JSON.parse(calls[0].init.body).name, 'group-a');
    assert.match(calls[0].url, /\/api\/batch\/v1\/namespaces\/public\/ipgroups$/);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('sangfor-af-v8-0-106 validates required generic path', async () => {
  await assert.rejects(
    () => handlers['sangfor.af.v8_0_106.SangforAfService/GenericRequest']({
      request: { token: 'tok', payloadJson: '{}' },
      config: { baseUrl: 'http://127.0.0.1:18080', allowInsecureHttp: true },
      secret: {},
    }),
    /path is required|id is required/,
  );
});

test('sangfor-af-v8-0-106 rejects generic absolute URLs', async () => {
  const request = (path) => handlers['sangfor.af.v8_0_106.SangforAfService/GenericRequest']({
    request: { token: 'tok', path },
    config: { baseUrl: 'http://127.0.0.1:18080', allowInsecureHttp: true },
    secret: {},
  });
  await assert.rejects(() => request('http://example.com/'), /relative path/);
  await assert.rejects(() => request('//example.com/'), /relative path/);
});

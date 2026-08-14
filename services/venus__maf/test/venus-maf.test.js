import assert from 'node:assert/strict';
import test from 'node:test';

import {
  METHOD_CREATE_SITE_FULL,
  METHOD_DELETE_SITE_FULL,
  METHOD_HEALTH_CHECK_FULL,
  METHOD_LIST_SITES_FULL,
  METHOD_UPLOAD_SENSITIVE_WORDS_FULL,
  _test,
  handlers,
} from '../src/venus-maf.js';

const response = (body, status = 200, headers = {}) => new Response(
  typeof body === 'string' ? body : JSON.stringify(body),
  { status, headers: { 'content-type': 'application/json', ...headers } },
);

const withFetch = async (fetchImpl, callback) => {
  const original = global.fetch;
  global.fetch = fetchImpl;
  try {
    return await callback();
  } finally {
    global.fetch = original;
  }
};

const baseContext = (request = {}) => ({
  config: { baseUrl: 'https://maf.example.local/monitor', timeoutMs: 1234 },
  secret: { username: 'admin', password: 'secret' },
  request,
});

const loginResponse = () => response({ code: 0, msg: 'success', data: { authorization: 'token-1' } });

test('helpers hash passwords, normalize URLs, and sanitize multipart filenames', () => {
  assert.equal(_test.sha256Hex('secret'), '2bb80d537b1da3e38bd30361aa855686bde0eacd7162fef6a25fe97bf527a25b');
  assert.equal(_test.normalizeOrigin('https://maf.example.local/monitor'), 'https://maf.example.local');
  assert.equal(_test.normalizePrefix('api/v3/'), '/api/v3');
  assert.equal(_test.normalizeOrigin('not a URL'), '');
  const multipart = _test.multipartBody('bad"name\\with\r\nbreak.txt', 'word');
  assert.equal(multipart.filename, 'bad_name_with__break.txt');
  assert.match(multipart.body.toString(), /filename="bad_name_with__break\.txt"/);
});

test('HealthCheck logs in with hashed credentials, timeout, and manual redirects', async () => {
  const calls = [];
  await withFetch(async (url, init) => {
    calls.push({ url: String(url), init });
    return loginResponse();
  }, async () => {
    const result = await handlers[METHOD_HEALTH_CHECK_FULL](baseContext());
    assert.deepEqual(result, { ok: true, code: 0, message: 'success' });
  });
  assert.equal(calls[0].url, 'https://maf.example.local/api/v3/login');
  assert.equal(calls[0].init.redirect, 'manual');
  assert.ok(calls[0].init.signal instanceof AbortSignal);
  assert.equal(JSON.parse(calls[0].init.body).password, _test.sha256Hex('secret'));
});

test('ListSites maps pagination and every proto response field', async () => {
  const calls = [];
  await withFetch(async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).endsWith('/login')) return loginResponse();
    return response({
      code: 0,
      msg: 'ok',
      data: { list: [{ id: 7, name: 'site-a', ip: '192.0.2.1', port: 443, http_type: 'https', enable: 1, server_name: ['a.example'] }], total: 1, page: 2, pageSize: 5 },
    });
  }, async () => {
    const result = await handlers[METHOD_LIST_SITES_FULL](baseContext({ page: 2, pageSize: 5, name: 'site-a' }));
    assert.equal(result.sites[0].httpType, 'https');
    assert.deepEqual(result.sites[0].serverName, ['a.example']);
    assert.equal(result.total, 1);
    assert.equal(result.pageSize, 5);
  });
  assert.match(calls[1].url, /page=2&pageSize=5&name=site-a/);
  assert.equal(calls[1].init.headers.authorization, 'token-1');
});

test('CreateSite sends only proto-backed fields and verifies the created site', async () => {
  const calls = [];
  await withFetch(async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).endsWith('/login')) return loginResponse();
    if (String(url).endsWith('/protect/vs/add')) return response('success');
    return response({ code: 0, data: { list: [{ id: 8, name: 'site-a' }], total: 1 } });
  }, async () => {
    const result = await handlers[METHOD_CREATE_SITE_FULL](baseContext({
      name: 'site-a', description: 'managed', enable: 1, httpType: 'http', ip: '192.0.2.10', port: 8080,
      serverName: ['site.example'], netMode: 2, safeMode: 1,
      upstream: { httpType: 'http', loadBalanceAlgo: 'round_robin', serverAddr: [{ ip: '198.51.100.1', port: 8080, weight: 10 }] },
    }));
    assert.equal(result.ok, true);
  });
  const payload = JSON.parse(calls[1].init.body);
  assert.deepEqual(Object.keys(payload).sort(), ['description', 'enable', 'http_type', 'ip', 'name', 'net_mode', 'port', 'safe_mode', 'server_name', 'upstream'].sort());
  assert.deepEqual(payload.upstream.server_addr, [{ ip: '198.51.100.1', port: 8080, weight: 10 }]);
});

test('DeleteSite resolves an omitted id and verifies absence before success', async () => {
  let findCalls = 0;
  let deleteBody;
  await withFetch(async (url, init) => {
    if (String(url).endsWith('/login')) return loginResponse();
    if (String(url).endsWith('/protect/vs/delete')) {
      deleteBody = JSON.parse(init.body);
      return response({ code: 0, msg: 'deleted' });
    }
    findCalls += 1;
    return response({ code: 0, data: { list: findCalls === 1 ? [{ id: 9, name: 'site-a' }] : [] } });
  }, async () => {
    const result = await handlers[METHOD_DELETE_SITE_FULL](baseContext({ name: 'site-a' }));
    assert.equal(result.ok, true);
  });
  assert.deepEqual(deleteBody, [{ id: 9, name: 'site-a' }]);
});

test('UploadCustomSensitiveWords sends bounded multipart data and maps filenames', async () => {
  let upload;
  await withFetch(async (url, init) => {
    if (String(url).endsWith('/login')) return loginResponse();
    upload = init;
    return response({ code: 0, data: { file_name: 'stored.txt' }, msg: 'uploaded' });
  }, async () => {
    const result = await handlers[METHOD_UPLOAD_SENSITIVE_WORDS_FULL](baseContext({ filename: 'words.txt', content: 'secret-word\n' }));
    assert.equal(result.fileName, 'stored.txt');
    assert.equal(result.originFileName, 'words.txt');
  });
  assert.match(upload.headers['content-type'], /^multipart\/form-data; boundary=/);
  assert.match(upload.body.toString(), /secret-word/);
});

test('rejects unsafe configuration, invalid requests, and oversized uploads', async () => {
  await assert.rejects(handlers[METHOD_HEALTH_CHECK_FULL]({ config: { baseUrl: 'https://u:p@maf.example' }, secret: { username: 'u', password: 'p' } }), /valid HTTP\(S\) URL/);
  await assert.rejects(handlers[METHOD_HEALTH_CHECK_FULL]({ config: { baseUrl: 'https://maf.example' }, secret: {} }), /username and secret.password/);
  await assert.rejects(handlers[METHOD_CREATE_SITE_FULL](baseContext({ name: '', ip: '', port: 0 })), /name and ip are required/);
  await assert.rejects(handlers[METHOD_CREATE_SITE_FULL](baseContext({ name: 'a', ip: '1.1.1.1', port: 70000, serverName: ['a'], upstream: { serverAddr: [{ ip: '1.1.1.2', port: 80 }] } })), /port must be/);
  await assert.rejects(handlers[METHOD_DELETE_SITE_FULL](baseContext({})), /id or name is required/);
  await assert.rejects(handlers[METHOD_UPLOAD_SENSITIVE_WORDS_FULL](baseContext({ content: ' ' })), /content is required/);
  await assert.rejects(handlers[METHOD_UPLOAD_SENSITIVE_WORDS_FULL](baseContext({ content: 'x'.repeat(1024 * 1024 + 1) })), /1 MiB/);
});

test('maps HTTP, malformed login, business, verification, and response-size failures', async () => {
  await withFetch(async () => response({ message: 'denied' }, 401), async () => {
    await assert.rejects(handlers[METHOD_HEALTH_CHECK_FULL](baseContext()), /UNAUTHENTICATED/);
  });
  await withFetch(async () => response('success'), async () => {
    await assert.rejects(handlers[METHOD_HEALTH_CHECK_FULL](baseContext()), /invalid JSON object/);
  });
  await withFetch(async () => response({ code: 9, msg: 'bad login' }), async () => {
    await assert.rejects(handlers[METHOD_HEALTH_CHECK_FULL](baseContext()), /business error/);
  });
  await withFetch(async () => response({ code: 0, data: {} }), async () => {
    await assert.rejects(handlers[METHOD_HEALTH_CHECK_FULL](baseContext()), /missing data.authorization/);
  });
  await withFetch(async () => response('x', 200, { 'content-length': String(2 * 1024 * 1024 + 1) }), async () => {
    await assert.rejects(handlers[METHOD_HEALTH_CHECK_FULL](baseContext()), /2 MiB/);
  });
  await withFetch(async () => response('x'.repeat(2 * 1024 * 1024 + 1)), async () => {
    await assert.rejects(handlers[METHOD_HEALTH_CHECK_FULL](baseContext()), /2 MiB/);
  });

  for (const [status, expected] of [[403, /PERMISSION_DENIED/], [422, /FAILED_PRECONDITION/], [500, /UNAVAILABLE/]]) {
    await withFetch(async () => response({ message: 'failure' }, status), async () => {
      await assert.rejects(handlers[METHOD_HEALTH_CHECK_FULL](baseContext()), expected);
    });
  }
});

test('reports failed create/delete verification with the most useful reason', async () => {
  let call = 0;
  await withFetch(async (url) => {
    call += 1;
    if (String(url).endsWith('/login')) return loginResponse();
    if (String(url).endsWith('/protect/vs/add')) return response({ code: 9, msg: 'rejected' });
    return response({ code: 0, data: { list: [] } });
  }, async () => {
    await assert.rejects(handlers[METHOD_CREATE_SITE_FULL](baseContext({
      name: 'missing', ip: '192.0.2.1', port: 80, serverName: ['missing.example'],
      upstream: { serverAddr: [{ ip: '198.51.100.1', port: 80 }] },
    })), /create site upstream business error/);
  });

  await withFetch(async (url) => {
    if (String(url).endsWith('/login')) return loginResponse();
    if (String(url).endsWith('/protect/vs/delete')) return response({ code: 9, msg: 'rejected' });
    return response({ code: 0, data: { list: [{ id: 7, name: 'still-there' }] } });
  }, async () => {
    await assert.rejects(
      handlers[METHOD_DELETE_SITE_FULL](baseContext({ id: 7, name: 'still-there' })),
      /still exists after delete/,
    );
  });

  await withFetch(async (url) => String(url).endsWith('/login') ? loginResponse() : response('success'), async () => {
    await assert.rejects(handlers[METHOD_LIST_SITES_FULL](baseContext()), /invalid JSON object/);
  });
});

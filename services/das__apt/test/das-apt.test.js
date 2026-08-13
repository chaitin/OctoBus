import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import https from 'node:https';

import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';

import {
  GET_ASSET_PATH,
  LIST_ASSETS_PATH,
  METHOD_GET_ASSET_FULL,
  METHOD_LIST_ASSETS_FULL,
  handlers,
  rpcdef,
} from '../src/das-apt.js';
import { service } from '../src/service.js';

const originalFetch = globalThis.fetch;

const buildCtx = (overrides = {}) => ({
  config: {
    host: 'https://apt.example.local/',
    timeoutMs: 2500,
    skipTlsVerify: false,
    ...(overrides.config || {}),
  },
  secret: {
    apikey: 'test-api-key',
    ...(overrides.secret || {}),
  },
  bindings: overrides.bindings || {},
  limits: overrides.limits || {},
  meta: { instance_id: 'inst', request_id: 'req', ...(overrides.meta || {}) },
  req: overrides.req || {},
});

const mockRes = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  json: async () => (typeof body === 'string' ? JSON.parse(body) : body),
});

const assetOne = {
  id: null,
  ip: '192.0.2.10',
  ports: '80,443',
  portFingerprintName: 'nginx',
  lastFoundTime: '2026-06-30 00:25:39',
  firstFoundTime: '2026-06-17 17:10:31',
  lastActiveTime: '2026-06-30 00:25:39',
  portServerType: '443/tcp',
  assetType: 'WEB服务',
  foundSource: 'sensor',
  mac: '00:11:22:33:44:55',
  tag: 'prod',
  content: 'asset note',
  productFingerprintList: [
    {
      id: 7,
      productCode: 'nginx',
      fingerprintClassCode: 'web_server',
      descr: 'Nginx HTTP server',
      offcialWebsite: 'https://nginx.org',
      productWebsite: 'https://nginx.org',
      productNameCn: 'Nginx',
      productNameEn: 'nginx',
      productStatus: '1',
      vendorNameCn: 'Nginx',
      vendorNameEn: 'Nginx',
      tagList: 'web,server',
      createTime: '2026-01-01 00:00:00',
      updateTime: '2026-06-01 00:00:00',
      fingerprintIp: '192.0.2.10',
      fingerprintPort: '443',
      fingerprintName: 'nginx tls',
      fingerprintClass2: 'http',
      fingerprintVersion: '1.24',
    },
  ],
};

test.afterEach(() => {
  globalThis.fetch = originalFetch;
});

test('service exports ListAssets and GetAsset handlers', () => {
  assert.ok(service);
  assert.equal(typeof handlers[METHOD_LIST_ASSETS_FULL], 'function');
  assert.equal(typeof handlers[METHOD_GET_ASSET_FULL], 'function');
  assert.equal(typeof rpcdef(buildCtx())[LIST_ASSETS_PATH], 'function');
  assert.equal(typeof rpcdef(buildCtx())[GET_ASSET_PATH], 'function');
});

test('ListAssets defaults pagination through the public handler', async () => {
  let capturedBody;
  globalThis.fetch = async (url, init) => {
    capturedBody = JSON.parse(init.body);
    return mockRes(200, { code: 0, message: '查询成功', total: 0, data: [] });
  };

  await handlers[METHOD_LIST_ASSETS_FULL](buildCtx());

  assert.deepEqual(capturedBody, {
    offset: 0,
    limit: 100,
  });
});

test('ListAssets maps aliases and trims strings through the public handler', async () => {
  let capturedBody;
  globalThis.fetch = async (url, init) => {
    capturedBody = JSON.parse(init.body);
    return mockRes(200, { code: 0, message: '查询成功', total: 0, data: [] });
  };

  await handlers[METHOD_LIST_ASSETS_FULL](buildCtx({
    req: {
      offset: '5',
      limit: { value: '20' },
      start_time: '2026-06-01 00:00:00',
      endTime: '2026-06-30 23:59:59',
      ip: ' 192.0.2.10 ',
    },
  }));

  assert.deepEqual(capturedBody, {
    offset: 5,
    limit: 20,
    ip: '192.0.2.10',
    startTime: '2026-06-01 00:00:00',
    endTime: '2026-06-30 23:59:59',
  });
});

test('ListAssets posts JSON body to /openapi/asset/list and maps assets', async () => {
  let captured;
  globalThis.fetch = async (url, init) => {
    captured = { url, init };
    return mockRes(200, {
      code: 0,
      message: '查询成功',
      total: 2,
      data: [assetOne, { ...assetOne, ip: '192.0.2.11', productFingerprintList: null }],
    });
  };

  const result = await handlers[METHOD_LIST_ASSETS_FULL](buildCtx({
    req: {
      offset: 0,
      limit: 2,
      ip: '192.0.2.10',
      startTime: '2026-06-01 00:00:00',
      end_time: '2026-06-30 23:59:59',
    },
  }));

  assert.equal(captured.url, 'https://apt.example.local/openapi/asset/list');
  assert.equal(captured.init.method, 'POST');
  assert.equal(captured.init.headers.apikey, 'test-api-key');
  assert.equal(captured.init.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(captured.init.body), {
    offset: 0,
    limit: 2,
    ip: '192.0.2.10',
    startTime: '2026-06-01 00:00:00',
    endTime: '2026-06-30 23:59:59',
  });
  assert.equal(result.total, 2);
  assert.equal(result.items.length, 2);
  assert.equal(result.items[0].ip, '192.0.2.10');
  assert.equal(result.items[0].port_fingerprint_name, 'nginx');
  assert.equal(result.items[0].product_fingerprint_list[0].product_name_en, 'nginx');
  assert.deepEqual(result.items[1].product_fingerprint_list, []);
  assert.equal(Object.hasOwn(result, 'raw'), false);
});

test('ListAssets uses HTTPS request path when skipTlsVerify is enabled', async (t) => {
  globalThis.fetch = async () => {
    throw new Error('fetch should not be called for skipTlsVerify HTTPS requests');
  };

  const originalRequest = https.request;
  t.after(() => {
    https.request = originalRequest;
  });

  let capturedOptions;
  https.request = (url, options, callback) => {
    capturedOptions = { url: String(url), options };
    const req = new EventEmitter();
    req.write = () => {};
    req.end = () => {
      const res = new EventEmitter();
      res.statusCode = 200;
      callback(res);
      res.emit('data', Buffer.from(JSON.stringify({ code: 0, message: '查询成功', total: 0, data: [] })));
      res.emit('end');
    };
    req.destroy = (err) => req.emit('error', err);
    return req;
  };

  await handlers[METHOD_LIST_ASSETS_FULL](buildCtx({
    config: { host: 'https://apt.example.local', skipTlsVerify: true },
  }));

  assert.equal(capturedOptions.url, 'https://apt.example.local/openapi/asset/list');
  assert.equal(capturedOptions.options.rejectUnauthorized, false);
  assert.equal(capturedOptions.options.method, 'POST');
});

test('ListAssets passes timeout abort signal to fetch', async () => {
  let capturedInit;
  globalThis.fetch = async (url, init) => {
    capturedInit = init;
    return mockRes(200, { code: 0, message: '查询成功', total: 0, data: [] });
  };

  await handlers[METHOD_LIST_ASSETS_FULL](buildCtx({ config: { timeoutMs: 25 } }));

  assert.ok(capturedInit.signal instanceof AbortSignal);
  assert.equal(capturedInit.signal.aborted, false);
});

test('GetAsset filters by IP and returns the exact match', async () => {
  let capturedBody;
  globalThis.fetch = async (url, init) => {
    capturedBody = JSON.parse(init.body);
    return mockRes(200, {
      code: 0,
      message: '查询成功',
      total: 2,
      data: [
        { ...assetOne, ip: '192.0.2.20' },
        assetOne,
      ],
    });
  };

  const result = await rpcdef(buildCtx())[GET_ASSET_PATH]({ ip: '192.0.2.10' });

  assert.deepEqual(capturedBody, {
    offset: 0,
    limit: 10,
    ip: '192.0.2.10',
  });
  assert.equal(result.asset.ip, '192.0.2.10');
  assert.equal(Object.hasOwn(result, 'raw'), false);
});

test('GetAsset validates required IP and maps missing assets to NOT_FOUND', async () => {
  const handler = rpcdef(buildCtx())[GET_ASSET_PATH];

  await assert.rejects(() => handler({ ip: ' ' }), (err) => {
    assert.ok(err instanceof GrpcError);
    assert.equal(err.code, grpcStatus.INVALID_ARGUMENT);
    assert.equal(err.legacyCode, 'INVALID_ARGUMENT');
    assert.match(err.message, /ip is required/);
    return true;
  });

  globalThis.fetch = async () => mockRes(200, {
    code: 0,
    message: '查询成功',
    total: 0,
    data: [],
  });

  await assert.rejects(() => handler({ ip: '192.0.2.99' }), (err) => {
    assert.ok(err instanceof GrpcError);
    assert.equal(err.code, grpcStatus.NOT_FOUND);
    assert.equal(err.legacyCode, 'NOT_FOUND');
    assert.match(err.message, /asset not found/);
    return true;
  });
});

test('request aliases work through rpcdef context request and camelCase fields', async () => {
  let capturedBody;
  globalThis.fetch = async (url, init) => {
    capturedBody = JSON.parse(init.body);
    return mockRes(200, { code: 0, message: '查询成功', total: 0, data: [] });
  };

  await rpcdef(buildCtx({
    req: {
      pageOffset: '3',
      pageSize: '4',
      startTime: '2026-06-01 00:00:00',
      endTime: '2026-06-30 23:59:59',
    },
  }))[LIST_ASSETS_PATH]();

  assert.deepEqual(capturedBody, {
    offset: 3,
    limit: 4,
    startTime: '2026-06-01 00:00:00',
    endTime: '2026-06-30 23:59:59',
  });
});

test('configuration validation rejects missing host, invalid host, and apikey', async () => {
  await assert.rejects(
    () => handlers[METHOD_LIST_ASSETS_FULL](buildCtx({ config: { host: '' } })),
    (err) => err instanceof GrpcError && err.code === grpcStatus.INVALID_ARGUMENT && /host is required/.test(err.message),
  );

  const invalidHosts = ['ftp://example', 'not-a-url', 'http://[::1'];
  for (const host of invalidHosts) {
    globalThis.fetch = async () => {
      throw new Error('fetch should not be called for invalid host');
    };

    await assert.rejects(
      () => handlers[METHOD_LIST_ASSETS_FULL](buildCtx({ config: { host } })),
      (err) => err instanceof GrpcError && err.code === grpcStatus.INVALID_ARGUMENT && /host/.test(err.message),
    );
  }

  await assert.rejects(
    () => handlers[METHOD_LIST_ASSETS_FULL](buildCtx({ secret: { apikey: '' } })),
    (err) => err instanceof GrpcError && err.code === grpcStatus.INVALID_ARGUMENT && /apikey is required/.test(err.message),
  );
});

test('upstream HTTP failures map to Connect errors', async (t) => {
  const cases = [
    {
      name: '401 maps to UNAUTHENTICATED',
      response: mockRes(401, { message: '缺少token，请重新登录', error_code: 400 }),
      code: grpcStatus.UNAUTHENTICATED,
      legacyCode: 'UNAUTHENTICATED',
      assertDetails: (err) => assert.equal(err.details.http_status_code, 401),
    },
    {
      name: '403 maps to PERMISSION_DENIED',
      response: mockRes(403, { message: 'forbidden', error_code: 403 }),
      code: grpcStatus.PERMISSION_DENIED,
      legacyCode: 'PERMISSION_DENIED',
    },
    {
      name: '500 maps to UNAVAILABLE',
      response: mockRes(500, { message: 'server error' }),
      code: grpcStatus.UNAVAILABLE,
      legacyCode: 'UNAVAILABLE',
    },
  ];

  for (const scenario of cases) {
    await t.test(scenario.name, async () => {
      globalThis.fetch = async () => scenario.response;

      await assert.rejects(() => handlers[METHOD_LIST_ASSETS_FULL](buildCtx()), (err) => {
        assert.equal(err.code, scenario.code);
        assert.equal(err.legacyCode, scenario.legacyCode);
        scenario.assertDetails?.(err);
        assert.equal(Object.hasOwn(err.details, 'http_response_body'), false);
        assert.equal(Object.hasOwn(err.details, 'upstream'), false);
        assert.equal(Object.hasOwn(err.details, 'request_body'), false);
        return true;
      });
    });
  }
});

test('network failure maps to UNAVAILABLE', async () => {
  globalThis.fetch = async () => {
    throw new Error('connection refused');
  };

  await assert.rejects(() => handlers[METHOD_LIST_ASSETS_FULL](buildCtx()), (err) => {
    assert.equal(err.code, grpcStatus.UNAVAILABLE);
    assert.equal(err.legacyCode, 'UNAVAILABLE');
    assert.match(err.message, /failed to connect to upstream/);
    assert.doesNotMatch(err.message, /connection refused/);
    assert.deepEqual(err.details, { operation: 'ListAssets', path: '/openapi/asset/list' });
    return true;
  });
});

test('fetch timeout maps to DEADLINE_EXCEEDED without leaking request data', async () => {
  globalThis.fetch = async () => {
    const err = new Error('request containing sensitive data timed out');
    err.name = 'AbortError';
    throw err;
  };

  await assert.rejects(() => handlers[METHOD_LIST_ASSETS_FULL](buildCtx({
    req: { ip: '192.0.2.42' },
  })), (err) => {
    assert.equal(err.code, grpcStatus.DEADLINE_EXCEEDED);
    assert.equal(err.legacyCode, 'DEADLINE_EXCEEDED');
    assert.doesNotMatch(err.message, /sensitive|192\.0\.2\.42/);
    assert.equal(Object.hasOwn(err.details, 'request_body'), false);
    return true;
  });
});

test('HTTPS timeout with skipTlsVerify maps to DEADLINE_EXCEEDED', async (t) => {
  const originalRequest = https.request;
  t.after(() => {
    https.request = originalRequest;
  });

  https.request = () => {
    const req = new EventEmitter();
    req.write = () => {};
    req.end = () => req.emit('timeout');
    req.destroy = (err) => req.emit('error', err);
    return req;
  };

  await assert.rejects(() => handlers[METHOD_LIST_ASSETS_FULL](buildCtx({
    config: { skipTlsVerify: true },
  })), (err) => {
    assert.equal(err.code, grpcStatus.DEADLINE_EXCEEDED);
    assert.equal(err.legacyCode, 'DEADLINE_EXCEEDED');
    assert.match(err.message, /upstream request timed out/);
    assert.doesNotMatch(err.message, /request timed out.*request timed out/);
    return true;
  });
});

test('business failure maps to FAILED_PRECONDITION', async () => {
  globalThis.fetch = async () => mockRes(200, { code: 9, message: '业务失败' });

  await assert.rejects(() => handlers[METHOD_LIST_ASSETS_FULL](buildCtx()), (err) => {
    assert.equal(err.code, grpcStatus.FAILED_PRECONDITION);
    assert.equal(err.legacyCode, 'FAILED_PRECONDITION');
    assert.match(err.message, /business error 9/);
    assert.equal(err.details.upstream_code, '9');
    assert.equal(Object.hasOwn(err.details, 'upstream'), false);
    return true;
  });
});

test('parse failure maps to UNKNOWN', async () => {
  globalThis.fetch = async () => mockRes(200, 'not-json');

  await assert.rejects(() => handlers[METHOD_LIST_ASSETS_FULL](buildCtx()), (err) => {
    assert.equal(err.code, grpcStatus.UNKNOWN);
    assert.equal(err.legacyCode, 'UNKNOWN');
    assert.doesNotMatch(err.message, /not-json/);
    assert.equal(Object.hasOwn(err.details, 'http_response_body'), false);
    return true;
  });
});

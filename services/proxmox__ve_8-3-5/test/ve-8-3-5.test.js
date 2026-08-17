import assert from 'node:assert/strict';
import test from 'node:test';

import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';

import {
  METHOD_GET_NODE_STATUS_FULL,
  METHOD_GET_NODE_STATUS_PATH,
  METHOD_GET_QEMU_VM_CONFIG_FULL,
  METHOD_GET_QEMU_VM_CONFIG_PATH,
  METHOD_LIST_LXCS_FULL,
  METHOD_LIST_LXCS_PATH,
  METHOD_LIST_NODES_FULL,
  METHOD_LIST_NODES_PATH,
  METHOD_LIST_QEMU_VMS_FULL,
  METHOD_LIST_QEMU_VMS_PATH,
  METHOD_LIST_STORAGE_FULL,
  METHOD_LIST_STORAGE_PATH,
  _test,
  handlers,
  rpcdef,
} from '../src/ve-8-3-5.js';
import { service } from '../src/service.js';
import {
  DEFAULT_NODE,
  TOKEN_ID,
  TOKEN_SECRET,
  createMockServer,
} from './mock_upstream.js';

const originalFetch = globalThis.fetch;
const originalConsoleLog = console.log;

const responseOf = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
});

const setFetch = (impl) => {
  globalThis.fetch = impl;
};

const buildCtx = (overrides = {}) => ({
  config: {
    baseUrl: 'https://pve.example.com:8006',
    defaultNode: DEFAULT_NODE,
    timeoutMs: 4000,
    ...(overrides.config || {}),
  },
  secret: {
    tokenId: TOKEN_ID,
    tokenSecret: TOKEN_SECRET,
    ...(overrides.secret || {}),
  },
  bindings: overrides.bindings || {},
  limits: { timeoutMs: 4000, ...(overrides.limits || {}) },
  meta: { instance_id: 'inst-1', request_id: 'req-1', ...(overrides.meta || {}) },
  req: overrides.req || {},
});

const expectGrpcError = async (fn, legacyCode, checker = () => {}) => {
  let caught;
  try {
    await fn();
  } catch (err) {
    caught = err;
  }
  assert.ok(caught, 'expected function to reject');
  assert.ok(caught instanceof GrpcError, `expected GrpcError, got ${caught?.constructor?.name}`);
  assert.equal(caught.legacyCode, legacyCode);
  const codes = {
    FAILED_PRECONDITION: grpcStatus.FAILED_PRECONDITION,
    INVALID_ARGUMENT: grpcStatus.INVALID_ARGUMENT,
    PERMISSION_DENIED: grpcStatus.PERMISSION_DENIED,
    UNAVAILABLE: grpcStatus.UNAVAILABLE,
    UNKNOWN: grpcStatus.UNKNOWN,
  };
  assert.equal(caught.code, codes[legacyCode]);
  assert.match(caught.message, new RegExp(`^${legacyCode}:`));
  checker(caught);
};

test.afterEach(() => {
  globalThis.fetch = originalFetch;
  console.log = originalConsoleLog;
});

test('service exports handlers and rpcdef path handlers', () => {
  assert.equal(typeof service, 'object');
  for (const key of [
    METHOD_LIST_NODES_FULL,
    METHOD_LIST_QEMU_VMS_FULL,
    METHOD_GET_QEMU_VM_CONFIG_FULL,
    METHOD_LIST_LXCS_FULL,
    METHOD_LIST_STORAGE_FULL,
    METHOD_GET_NODE_STATUS_FULL,
  ]) {
    assert.equal(typeof handlers[key], 'function', `handler for ${key} should be a function`);
    assert.equal(handlers[key].length, 1, `handler for ${key} must use the single-context SDK ABI`);
  }
  const defs = rpcdef(buildCtx());
  for (const key of [
    METHOD_LIST_NODES_PATH,
    METHOD_LIST_QEMU_VMS_PATH,
    METHOD_GET_QEMU_VM_CONFIG_PATH,
    METHOD_LIST_LXCS_PATH,
    METHOD_LIST_STORAGE_PATH,
    METHOD_GET_NODE_STATUS_PATH,
  ]) {
    assert.equal(typeof defs[key], 'function', `rpcdef for ${key} should be a function`);
  }
});

test('ListNodes happy path issues GET to /api2/json/nodes', async () => {
  let captured;
  setFetch(async (url, init) => {
    captured = { url: String(url), init };
    return responseOf(200, {
      data: [
        { node: 'pve-a', status: 'online', cpu: 0.1, cpu_count: 8, maxmem: 4096, mem: 2048, uptime: 60 },
      ],
    });
  });

  const res = await handlers[METHOD_LIST_NODES_FULL]({}, buildCtx());
  assert.equal(captured.init.method, 'GET');
  assert.equal(captured.url, 'https://pve.example.com:8006/api2/json/nodes');
  assert.equal(captured.init.headers.Authorization, `PVEAPIToken=${TOKEN_ID}=${TOKEN_SECRET}`);
  assert.equal(captured.init.headers.Accept, 'application/json');
  assert.equal(captured.init.timeoutMs, undefined);
  assert.equal(captured.init.redirect, 'error');
  assert.ok(captured.init.signal instanceof AbortSignal);
  assert.equal(res.http_status, 200);
  assert.equal(res.nodes.length, 1);
  assert.equal(res.nodes[0].node, 'pve-a');
  assert.equal(res.nodes[0].status, 'online');
  assert.equal(res.nodes[0].cpu_count, 8);
  assert.match(res.raw_body, /pve-a/);
});

test('ListNodes missing baseUrl returns INVALID_ARGUMENT', async () => {
  await expectGrpcError(
    () => handlers[METHOD_LIST_NODES_FULL]({}, buildCtx({ config: { baseUrl: '' } })),
    'INVALID_ARGUMENT',
    (err) => assert.match(err.message, /baseUrl/),
  );
});

test('ListNodes missing token returns INVALID_ARGUMENT', async () => {
  await expectGrpcError(
    () => handlers[METHOD_LIST_NODES_FULL]({}, buildCtx({ secret: { tokenId: '', tokenSecret: '' } })),
    'INVALID_ARGUMENT',
    (err) => assert.match(err.message, /tokenId/),
  );
});

test('ListNodes http 401 maps to PERMISSION_DENIED', async () => {
  setFetch(async () => responseOf(401, 'no auth'));
  await expectGrpcError(() => handlers[METHOD_LIST_NODES_FULL]({}, buildCtx()), 'PERMISSION_DENIED');
});

test('ListQemuVMs builds correct URL with node and Authorization header', async () => {
  let captured;
  setFetch(async (url, init) => {
    captured = { url: String(url), init };
    return responseOf(200, {
      data: [
        { vmid: 100, name: 'vm-100', status: 'running', cpus: 2, maxmem: 1024, mem: 256 },
      ],
    });
  });

  const res = await handlers[METHOD_LIST_QEMU_VMS_FULL]({ node: 'pve-node-1' }, buildCtx());
  assert.equal(captured.url, 'https://pve.example.com:8006/api2/json/nodes/pve-node-1/qemu');
  assert.equal(captured.init.headers.Authorization, `PVEAPIToken=${TOKEN_ID}=${TOKEN_SECRET}`);
  assert.equal(res.vms.length, 1);
  assert.equal(res.vms[0].vmid, 100);
  assert.equal(res.vms[0].name, 'vm-100');
});

test('ListQemuVMs falls back to bindings.defaultNode when request omits node', async () => {
  let url;
  setFetch(async (u) => {
    url = String(u);
    return responseOf(200, { data: [] });
  });
  await handlers[METHOD_LIST_QEMU_VMS_FULL]({}, buildCtx());
  assert.equal(url, `https://pve.example.com:8006/api2/json/nodes/${DEFAULT_NODE}/qemu`);
});

test('ListQemuVMs missing node returns INVALID_ARGUMENT', async () => {
  await expectGrpcError(
    () => handlers[METHOD_LIST_QEMU_VMS_FULL]({}, buildCtx({ config: { defaultNode: '' } })),
    'INVALID_ARGUMENT',
    (err) => assert.match(err.message, /node is required/),
  );
});

test('ListQemuVMs http 500 maps to UNAVAILABLE', async () => {
  setFetch(async () => responseOf(500, 'broken'));
  await expectGrpcError(() => handlers[METHOD_LIST_QEMU_VMS_FULL]({ node: 'pve-node-1' }, buildCtx()), 'UNAVAILABLE');
});

test('GetQemuVMConfig happy path includes vmid in URL and config in response', async () => {
  let captured;
  setFetch(async (url, init) => {
    captured = { url: String(url), init };
    return responseOf(200, {
      data: {
        vmid: 100,
        name: 'web-1',
        memory: 4096,
        cores: 4,
        sockets: 1,
        ostype: 'l26',
        scsihw: 'virtio-scsi-pci',
        boot: 'order=scsi0',
      },
    });
  });

  const res = await handlers[METHOD_GET_QEMU_VM_CONFIG_FULL]({ node: 'pve-node-1', vmid: 100 }, buildCtx());
  assert.equal(captured.url, 'https://pve.example.com:8006/api2/json/nodes/pve-node-1/qemu/100/config');
  assert.equal(captured.init.method, 'GET');
  assert.equal(res.vmid, 100);
  assert.equal(res.node, 'pve-node-1');
  assert.equal(res.name, 'web-1');
  assert.equal(res.memory, 4096);
  assert.equal(res.cores, 4);
  assert.equal(res.sockets, 1);
  assert.equal(res.ostype, 'l26');
});

test('GetQemuVMConfig missing vmid returns INVALID_ARGUMENT', async () => {
  await expectGrpcError(
    () => handlers[METHOD_GET_QEMU_VM_CONFIG_FULL]({ node: 'pve-node-1' }, buildCtx()),
    'INVALID_ARGUMENT',
    (err) => assert.match(err.message, /vmid is required/),
  );
});

test('GetQemuVMConfig invalid vmid returns INVALID_ARGUMENT', async () => {
  await expectGrpcError(
    () => handlers[METHOD_GET_QEMU_VM_CONFIG_FULL]({ node: 'pve-node-1', vmid: 'abc' }, buildCtx()),
    'INVALID_ARGUMENT',
    (err) => assert.match(err.message, /vmid/),
  );
});

test('GetQemuVMConfig upstream 404 maps to FAILED_PRECONDITION', async () => {
  setFetch(async () => responseOf(404, 'no such vm'));
  await expectGrpcError(
    () => handlers[METHOD_GET_QEMU_VM_CONFIG_FULL]({ node: 'pve-node-1', vmid: 9999 }, buildCtx()),
    'FAILED_PRECONDITION',
  );
});

test('ListLXCs happy path decodes container list', async () => {
  setFetch(async () => responseOf(200, {
    data: [
      { vmid: 200, name: 'lxc-web', status: 'running', cpus: 1, maxmem: 512, mem: 128 },
    ],
  }));
  const res = await handlers[METHOD_LIST_LXCS_FULL]({ node: 'pve-node-2' }, buildCtx());
  assert.equal(res.containers.length, 1);
  assert.equal(res.containers[0].vmid, 200);
  assert.equal(res.containers[0].name, 'lxc-web');
  assert.equal(res.http_status, 200);
});

test('ListLXCs missing node returns INVALID_ARGUMENT', async () => {
  await expectGrpcError(
    () => handlers[METHOD_LIST_LXCS_FULL]({}, buildCtx({ config: { defaultNode: '' } })),
    'INVALID_ARGUMENT',
  );
});

test('ListLXCs malformed node name returns INVALID_ARGUMENT', async () => {
  await expectGrpcError(
    () => handlers[METHOD_LIST_LXCS_FULL]({ node: 'has space' }, buildCtx({ config: { defaultNode: '' } })),
    'INVALID_ARGUMENT',
    (err) => assert.match(err.message, /node name/),
  );
});

test('ListStorage happy path decodes storage pool list', async () => {
  setFetch(async () => responseOf(200, {
    data: [
      { storage: 'local', type: 'dir', total: 1024, used: 256, avail: 768, used_fraction: 0.25, content: 'iso,vztmpl', active: '1', enabled: '1', shared: false },
      { storage: 'nfs', type: 'nfs', total: 2048, used: 0, avail: 2048, used_fraction: 0, content: 'images', active: '1', enabled: '1', shared: true },
    ],
  }));
  const res = await handlers[METHOD_LIST_STORAGE_FULL]({ node: 'pve-node-1' }, buildCtx());
  assert.equal(res.storages.length, 2);
  assert.equal(res.storages[0].storage, 'local');
  assert.equal(res.storages[0].type, 'dir');
  assert.equal(res.storages[0].shared, false);
  assert.equal(res.storages[1].storage, 'nfs');
  assert.equal(res.storages[1].shared, true);
});

test('ListStorage missing node returns INVALID_ARGUMENT', async () => {
  await expectGrpcError(
    () => handlers[METHOD_LIST_STORAGE_FULL]({}, buildCtx({ config: { defaultNode: '' } })),
    'INVALID_ARGUMENT',
  );
});

test('ListStorage http 403 maps to PERMISSION_DENIED', async () => {
  setFetch(async () => responseOf(403, 'forbidden'));
  await expectGrpcError(() => handlers[METHOD_LIST_STORAGE_FULL]({ node: 'pve-node-1' }, buildCtx()), 'PERMISSION_DENIED');
});

test('GetNodeStatus happy path decodes loadavg and memory', async () => {
  setFetch(async () => responseOf(200, {
    data: {
      node: 'pve-node-1',
      status: 'online',
      uptime: 1234,
      loadavg: [0.1, 0.2, 0.3],
      cpu: 0.25,
      memory: { total: 1000, used: 250, free: 750 },
      swap: { total: 500, used: 10, free: 490 },
      kversion: 'Linux 6.8',
      pveversion: 'pve-manager/8.3.5/test',
      cpuinfo: { model: 'test-cpu', cpus: 8 },
    },
  }));
  const res = await handlers[METHOD_GET_NODE_STATUS_FULL]({ node: 'pve-node-1' }, buildCtx());
  assert.equal(res.node, 'pve-node-1');
  assert.equal(res.status, 'online');
  assert.equal(res.uptime, 1234);
  assert.equal(res.load_average_1m, 0.1);
  assert.equal(res.load_average_5m, 0.2);
  assert.equal(res.load_average_15m, 0.3);
  assert.equal(res.cpu_count, 8);
  assert.equal(res.cpu_usage, 0.25);
  assert.equal(res.memory_total, 1000);
  assert.equal(res.memory_used, 250);
  assert.equal(res.memory_free, 750);
  assert.equal(res.swap_total, 500);
  assert.equal(res.swap_used, 10);
  assert.equal(res.kernel_version, 'Linux 6.8');
  assert.equal(res.pve_version, 'pve-manager/8.3.5/test');
  assert.deepEqual(res.cpuinfo, { model: 'test-cpu', cpus: 8 });
});

test('GetNodeStatus missing node returns INVALID_ARGUMENT', async () => {
  await expectGrpcError(
    () => handlers[METHOD_GET_NODE_STATUS_FULL]({}, buildCtx({ config: { defaultNode: '' } })),
    'INVALID_ARGUMENT',
  );
});

test('GetNodeStatus non-JSON response maps to UNKNOWN', async () => {
  setFetch(async () => responseOf(200, 'not json'));
  await expectGrpcError(() => handlers[METHOD_GET_NODE_STATUS_FULL]({ node: 'pve-node-1' }, buildCtx()), 'UNKNOWN');
});

test('mock upstream supports all RPCs end-to-end', async () => {
  const mock = createMockServer();
  const { baseUrl } = await mock.start();
  try {
    const ctx = buildCtx({ config: { baseUrl, allowInsecureHttp: true }, bindings: { skipTlsVerify: true } });

    const nodes = await handlers[METHOD_LIST_NODES_FULL]({}, ctx);
    assert.equal(nodes.http_status, 200);
    assert.equal(nodes.nodes.length, 2);
    assert.equal(nodes.nodes[0].node, 'pve-node-1');

    const vms = await handlers[METHOD_LIST_QEMU_VMS_FULL]({ node: 'pve-node-1' }, ctx);
    assert.equal(vms.vms.length, 2);
    assert.equal(vms.vms[0].vmid, 100);

    const cfg = await handlers[METHOD_GET_QEMU_VM_CONFIG_FULL]({ node: 'pve-node-1', vmid: 100 }, ctx);
    assert.equal(cfg.vmid, 100);
    assert.equal(cfg.memory, 2048);

    const lxcs = await handlers[METHOD_LIST_LXCS_FULL]({ node: 'pve-node-1' }, ctx);
    assert.equal(lxcs.containers.length, 1);
    assert.equal(lxcs.containers[0].vmid, 200);

    const storages = await handlers[METHOD_LIST_STORAGE_FULL]({ node: 'pve-node-1' }, ctx);
    assert.equal(storages.storages.length, 2);
    assert.equal(storages.storages[0].storage, 'local');

    const status = await handlers[METHOD_GET_NODE_STATUS_FULL]({ node: 'pve-node-1' }, ctx);
    assert.equal(status.status, 'online');
    assert.equal(status.load_average_1m, 0.12);
    assert.equal(status.cpu_count, 16);
    assert.equal(status.cpu_usage, 0.18);
    assert.equal(status.kernel_version, 'Linux 6.8.4-2-pve');

    for (const r of mock.requests) {
      assert.match(r.path, /^\/api2\/json\//, `unexpected path: ${r.path}`);
      assert.equal(r.headers.authorization, `PVEAPIToken=${TOKEN_ID}=${TOKEN_SECRET}`);
    }
  } finally {
    await mock.close();
  }
});

test('mock upstream rejects requests with bad token', async () => {
  const mock = createMockServer({ expectedTokenId: 'someone@pam!other', expectedTokenSecret: 'deadbeef' });
  const { baseUrl } = await mock.start();
  try {
    setFetch(originalFetch);
    const ctx = buildCtx({ config: { baseUrl, allowInsecureHttp: true } });
    await expectGrpcError(
      () => handlers[METHOD_LIST_NODES_FULL]({}, ctx),
      'PERMISSION_DENIED',
      (err) => assert.match(err.message, /http 403/),
    );
  } finally {
    setFetch(originalFetch);
    await mock.close();
  }
});

test('mock upstream rejects missing Authorization', async () => {
  const mock = createMockServer();
  const { baseUrl } = await mock.start();
  try {
    const res = await fetch(`${baseUrl}/api2/json/nodes`);
    assert.equal(res.status, 401);
  } finally {
    await mock.close();
  }
});

test('mock upstream returns 404 for unknown paths', async () => {
  const mock = createMockServer();
  const { baseUrl } = await mock.start();
  try {
    const res = await fetch(`${baseUrl}/api2/json/unknown`, {
      headers: { Authorization: mock.validAuthHeader },
    });
    assert.equal(res.status, 404);
  } finally {
    await mock.close();
  }
});

test('rpcdef merges context request with incoming request', async () => {
  let url;
  setFetch(async (u) => {
    url = String(u);
    return responseOf(200, { data: [] });
  });
  const defs = rpcdef(buildCtx({ req: { node: 'from-ctx' } }));
  await defs[METHOD_LIST_QEMU_VMS_PATH]({ node: 'from-call' });
  assert.equal(url, 'https://pve.example.com:8006/api2/json/nodes/from-call/qemu');
});

test('rpcdef falls back to context request when call argument is nullish', async () => {
  let url;
  setFetch(async (u) => {
    url = String(u);
    return responseOf(200, { data: [] });
  });
  const defs = rpcdef(buildCtx({ req: { node: 'ctx-only' } }));
  await defs[METHOD_LIST_QEMU_VMS_PATH](null);
  assert.equal(url, 'https://pve.example.com:8006/api2/json/nodes/ctx-only/qemu');
});

test('helper functions cover normalization, mapping, and validation', async () => {
  assert.equal(_test.grpcCodeFor('NOPE'), grpcStatus.UNKNOWN);
  assert.equal(_test.engineError('FAILED_PRECONDITION', 'x').code, grpcStatus.FAILED_PRECONDITION);
  assert.equal(_test.hasOwn(null, 'x'), false);
  assert.equal(_test.unwrapScalar({ value: 'a' }), 'a');
  assert.equal(_test.unwrapScalar(undefined), undefined);
  assert.equal(_test.pickString(null), '');
  assert.equal(_test.pickString(12), '12');
  assert.equal(_test.pickFirstString([undefined, ' a ']), 'a');
  assert.equal(_test.pickFirstString([' ', undefined]), '');
  assert.equal(_test.pickInt('42'), 42);
  assert.equal(_test.pickInt(null), 0);
  assert.equal(_test.pickLong('999999999'), 999999999);
  assert.equal(_test.pickDouble('1.5'), 1.5);
  assert.equal(_test.pickBoolean('yes'), true);
  assert.equal(_test.pickBoolean('off'), false);
  assert.equal(_test.pickBoolean('maybe'), undefined);
  assert.equal(_test.pickFirstBoolean(['bad', 'true']), true);
  assert.equal(_test.normalizeBaseUrl('https://pve.example.com:8006'), 'https://pve.example.com:8006');
  assert.equal(_test.normalizeBaseUrl('https://pve.example.com:8006///'), 'https://pve.example.com:8006');
  assert.equal(_test.normalizeBaseUrl('https://token@example.com:8006'), '');
  assert.equal(_test.normalizeBaseUrl('https://pve.example.com:8006/api2/json'), '');
  assert.equal(_test.normalizeBaseUrl('ftp://x'), '');
  assert.equal(_test.normalizeBaseUrl(''), '');
  assert.equal(_test.isValidNodeName('pve-node-1'), true);
  assert.equal(_test.isValidNodeName('pve_node.2'), true);
  assert.equal(_test.isValidNodeName('has space'), false);
  assert.equal(_test.isValidVmid(100), true);
  assert.equal(_test.isValidVmid(0), false);
  assert.equal(_test.isValidVmid('200'), true);
  assert.equal(_test.isValidVmid('abc'), false);
  assert.equal(_test.requireVmid({ vmid: '1' }, 'X'), 1);
  assert.throws(() => _test.requireVmid({ vmid: '' }, 'X'), /INVALID_ARGUMENT/);
  assert.throws(() => _test.requireVmid({ vmid: 0 }, 'X'), /INVALID_ARGUMENT/);
  assert.throws(() => _test.requireVmid({ vmid: 'x' }, 'X'), /INVALID_ARGUMENT/);
  assert.throws(() => _test.requireNodeName({}, { defaultNode: '' }, 'X'), /INVALID_ARGUMENT/);
  assert.throws(() => _test.requireNodeName({ node: 'bad name' }, { defaultNode: '' }, 'X'), /INVALID_ARGUMENT/);
  assert.equal(_test.requireNodeName({ node: 'a' }, {}, 'X'), 'a');
  assert.equal(_test.requireNodeName({}, { defaultNode: 'b' }, 'X'), 'b');
  assert.equal(_test.resolveToken({ tokenId: 'a@b!c', tokenSecret: 's' }).tokenId, 'a@b!c');
  assert.throws(() => _test.resolveToken({ tokenId: 'a', tokenSecret: 's' }), /USER@REALM/);
  assert.throws(() => _test.resolveToken({ tokenId: '', tokenSecret: 's' }), /tokenId/);
  assert.throws(() => _test.resolveToken({ tokenId: 'a@b!c', tokenSecret: '' }), /tokenSecret/);
  assert.throws(() => _test.buildAuthHeader({ tokenId: '', tokenSecret: 's' }), /INVALID_ARGUMENT/);
  assert.equal(_test.buildAuthHeader({ tokenId: 'a@b!c', tokenSecret: 's' }), 'PVEAPIToken=a@b!c=s');
  assert.throws(() => _test.resolveBaseUrl({ baseUrl: '' }), /baseUrl/);
  assert.throws(() => _test.resolveBaseUrl({ baseUrl: 'http://insecure.local' }), /https/);
  assert.equal(_test.resolveBaseUrl({ baseUrl: 'http://insecure.local', allowInsecureHttp: true }), 'http://insecure.local');
  assert.throws(() => _test.resolveBaseUrl({ baseUrl: 'ftp://x' }), /baseUrl/);
  assert.equal(_test.resolveTimeoutMs(), 5000);
  assert.equal(_test.resolveTimeoutMs({ limits: { timeoutMs: 10 } }), 10);
  assert.equal(_test.resolveTimeoutMs({ bindings: { timeout_ms: 20 } }), 20);
  assert.equal(_test.resolveTimeoutMs({ bindings: { timeout: 30 } }), 30);
  assert.equal(_test.resolveTimeoutMs({ limits: { timeoutMs: 999999 } }), _test.MAX_TIMEOUT_MS);
  assert.equal(_test.resolveTimeoutMs({ limits: { timeoutMs: 'bad' } }), 5000);
  assert.equal(_test.buildTlsDispatcher({}), undefined);
  const dispatcher = _test.buildTlsDispatcher({ skipTlsVerify: true });
  assert.equal(typeof dispatcher.dispatch, 'function');
  await dispatcher.close();
  assert.equal(_test.shouldSkipTls({ tlsInsecureSkipVerify: 'on' }), true);
  assert.equal(_test.shouldSkipTls({ tls_skip_verify: 'yes' }), true);
  assert.equal(_test.shouldSkipTls({}), false);
  assert.deepEqual(_test.sanitizeHeaders({ a: 1, b: { value: false }, Authorization: 'bad', Cookie: 'bad', evil: 'x\ny' }), { a: '1', b: 'false' });
  assert.deepEqual(_test.sanitizeHeaders(null), {});
  assert.deepEqual(_test.sanitizeHeaders(['skip']), {});
  assert.equal(_test.buildHeaders({ headers: { Extra: '1' } }, 'AUTH').Extra, '1');
  assert.equal(_test.buildHeaders({}, 'AUTH').Authorization, 'AUTH');
  assert.equal(_test.mapHttpStatus(401), 'PERMISSION_DENIED');
  assert.equal(_test.mapHttpStatus(403), 'PERMISSION_DENIED');
  assert.equal(_test.mapHttpStatus(400), 'FAILED_PRECONDITION');
  assert.equal(_test.mapHttpStatus(404), 'FAILED_PRECONDITION');
  assert.equal(_test.mapHttpStatus(500), 'UNAVAILABLE');
  assert.equal(_test.mapHttpStatus(502), 'UNAVAILABLE');
  assert.throws(() => _test.parseJsonBody('not json'), /INVALID_ARGUMENT|UNKNOWN/);
  assert.throws(() => _test.parseJsonBody(''), /UNKNOWN/);
  assert.deepEqual(_test.parseJsonBody('{"a":1}'), { a: 1 });
  assert.equal(_test.buildUrl('https://x.com/', ['nodes', 'pve-1', 'qemu'], { full: 1 }), 'https://x.com/api2/json/nodes/pve-1/qemu?full=1');
  assert.equal(_test.buildUrl('https://x.com', ['nodes'], {}), 'https://x.com/api2/json/nodes');
  assert.equal(_test.buildUrl('https://x.com', []), 'https://x.com/api2/json');
  assert.equal(_test.wrapRawBody('hello'), 'hello');
  assert.equal(_test.wrapRawBody(null), '');
  assert.equal(_test.asJsonValue(null), null);
  assert.equal(_test.asJsonValue(undefined), null);
  assert.deepEqual(_test.asJsonValue({ a: 1 }), { a: 1 });
  assert.deepEqual(_test.arrayOrEmpty([1, 2]), [1, 2]);
  assert.deepEqual(_test.arrayOrEmpty(null), []);
  assert.deepEqual(_test.arrayOrEmpty('x'), []);
  assert.deepEqual(_test.extractData({ data: [1] }), [1]);
  assert.deepEqual(_test.extractData([1, 2]), [1, 2]);
  assert.equal(_test.extractData(null), null);
  assert.deepEqual(_test.buildNodeInfo({ node: 'n', status: 'online', cpu: 0.5, ssl_fingerprint: 'AB:CD' }), {
    node: 'n',
    status: 'online',
    cpu_usage: 0.5,
    cpu_count: 0,
    max_cpu: 0,
    mem_total: 0,
    mem_used: 0,
    disk_total: 0,
    disk_used: 0,
    uptime: 0,
    level: '',
    ip: '',
    maxmem: 0,
    maxdisk: 0,
    raw: { node: 'n', status: 'online', cpu: 0.5, ssl_fingerprint: 'AB:CD' },
    ssl_fingerprint: 'AB:CD',
  });
  assert.equal(_test.buildNodeInfo({ node: 'n' }).ssl_fingerprint, '');

  // QemuVMInfo: extended fields
  assert.equal(_test.buildQemuVMInfo({ vmid: 100, name: 'a', cpu: 0.05, diskread: 100, netin: 200, pid: 999, tags: 'prod' }).disk_read, 100);
  assert.equal(_test.buildQemuVMInfo({ vmid: 100 }).net_in, 0);
  assert.equal(_test.buildQemuVMInfo({ vmid: 100, 'running-machine': 'pc-q35-9.0' }).running_machine, 'pc-q35-9.0');
  assert.equal(_test.buildQemuVMInfo({ vmid: 100, pressurecpufull: 0.5 }).pressure_cpu_full, 0.5);
  assert.equal(_test.buildQemuVMInfo({ vmid: 100 }).pressure_cpu_full, 0);

  // LXCInfo: extended fields
  assert.equal(_test.buildLXCInfo({ vmid: 200, name: 'lxc', maxswap: 4096, tags: 'web' }).max_swap, 4096);
  assert.equal(_test.buildLXCInfo({ vmid: 200 }).max_swap, 0);
  assert.equal(_test.buildLXCInfo({ vmid: 200, pressureiosome: 0.3 }).pressure_io_some, 0.3);

  // StorageInfo: formats_json and select_existing
  const si = _test.buildStorageInfo({ storage: 's1', type: 'dir', total: 100, used: 25, shared: 1, formats: { supported: ['qcow2', 'raw'], default: 'qcow2' }, select_existing: 1 });
  assert.equal(si.used_fraction, 0.25);
  assert.match(si.formats_json, /qcow2/);
  assert.equal(si.select_existing, true);
  assert.equal(_test.buildStorageInfo({}).select_existing, false);

  // NodeStatus: extended fields
  const ns = _test.buildNodeStatus({
    node: 'n', status: 'online', uptime: 100, loadavg: [1, 2, 3],
    cpu: 0.5, cpuinfo: { cpus: 4 }, memory: { total: 100, used: 50, free: 50, available: 80 },
    'boot-info': { mode: 'efi', secureboot: true },
    'current-kernel': { sysname: 'Linux', release: '6.8', version: '#1', machine: 'x86_64' },
    rootfs: { total: 200, used: 50, free: 150, avail: 100 },
    idle: 12345, ksm: { shared: 5 }, wait: 0.05,
  }, 'n');
  assert.equal(ns.boot_info_mode, 'efi');
  assert.equal(ns.boot_info_secureboot, true);
  assert.equal(ns.current_kernel_sysname, 'Linux');
  assert.equal(ns.current_kernel_release, '6.8');
  assert.equal(ns.current_kernel_machine, 'x86_64');
  assert.equal(ns.memory_available, 80);
  assert.equal(ns.rootfs_total, 200);
  assert.equal(ns.rootfs_used, 50);
  assert.equal(ns.rootfs_free, 150);
  assert.equal(ns.rootfs_available, 100);
  assert.equal(ns.idle, 12345);
  assert.equal(ns.ksm_shared, 5);
  assert.equal(ns.wait, 0.05);
  assert.equal(ns.cpu_count, 4);
  assert.equal(ns.cpu_usage, 0.5);
  assert.equal(_test.buildNodeStatus({}, 'fb').node, 'fb');

  // QemuVMConfig: extended fields
  const qc = _test.buildQemuVMConfig({ vmid: 7, name: 'vm', memory: 1024, description: 'test', tags: 'web', template: 1, onboot: 'yes', autostart: 1, cpu: 'host', cpulimit: '2.0', cpuunits: 1024, bios: 'ovmf', machine: 'pc-q35-9.0', arch: 'x86_64', agent: '1', hugepages: '1024', keephugepages: 1, vmgenid: 'g1', protection: 0, lock: 'backup', balloon: 2048, digest: 'sha256=x', hotplug: 'network,disk', keyboard: 'en-us', kvm: 1 }, 'pve-1', 7);
  assert.equal(qc.description, 'test');
  assert.equal(qc.tags, 'web');
  assert.equal(qc.template, true);
  assert.equal(qc.onboot, true);
  assert.equal(qc.autostart, true);
  assert.equal(qc.cpu, 'host');
  assert.equal(qc.cpulimit, 2.0);
  assert.equal(qc.cpuunits, 1024);
  assert.equal(qc.bios, 'ovmf');
  assert.equal(qc.machine, 'pc-q35-9.0');
  assert.equal(qc.arch, 'x86_64');
  assert.equal(qc.agent, true);
  assert.equal(qc.hugepages, '1024');
  assert.equal(qc.keephugepages, true);
  assert.equal(qc.vmgenid, 'g1');
  assert.equal(qc.protection, false);
  assert.equal(qc.lock_status, 'backup');
  assert.equal(qc.balloon, 2048);
  assert.equal(qc.digest, 'sha256=x');
  assert.equal(qc.hotplug, 'network,disk');
  assert.equal(qc.keyboard, 'en-us');
  assert.equal(qc.kvm, true);
  assert.equal(_test.buildQemuVMInfo({ vmid: 100, name: 'a' }).vmid, 100);
  assert.equal(_test.buildQemuVMInfo({ vmid: 'x' }).vmid, 0);
  assert.equal(_test.buildLXCInfo({ vmid: 200, name: 'lxc' }).vmid, 200);
  assert.equal(_test.buildStorageInfo({ storage: 's1', type: 'dir', total: 100, used: 25, shared: 1 }).used_fraction, 0.25);
  assert.equal(_test.buildStorageInfo({ storage: 's2', total: 100, used: 25, shared: 0 }).shared, false);
  assert.equal(_test.buildNodeStatus({ node: 'n', status: 'online', loadavg: [1, 2, 3], cpu_count: 4, cpu_usage: 0.5, memory: { total: 10, used: 5, free: 5 }, swap: { total: 1, used: 0, free: 1 } }, 'n').load_average_5m, 2);
  assert.equal(_test.buildNodeStatus({}, 'fallback').node, 'fallback');
  assert.equal(_test.buildQemuVMConfig({ vmid: 7, name: 'vm', memory: 1024 }, 'pve-1', 7).vmid, 7);
  assert.equal(_test.buildQemuVMConfig({ vmid: '7' }, 'pve-1', 999).vmid, 7);
  assert.equal(_test.valueOrZeroLong('123'), 123);
  assert.equal(_test.valueOrZeroLong(null), 0);
  assert.equal(_test.valueOrZeroLong('bad'), 0);
  assert.equal(_test.valueOrZeroDouble('1.25'), 1.25);
  assert.equal(_test.valueOrZeroDouble(null), 0);
  assert.equal(_test.resolveVmidString('1'), 1);
  assert.equal(_test.resolveVmidString('x'), 0);
  assert.equal(_test.resolveVmidString(null), 0);
  assert.deepEqual(_test.resolveCallContext(), { bindings: {}, limits: {}, meta: {}, req: {} });
  assert.deepEqual(_test.resolveCallContext({ request: { node: 'a' } }).req, { node: 'a' });
  assert.deepEqual(_test.resolveCallContext({ config: { a: 1 }, secret: { b: 2 }, bindings: { c: 3 } }).bindings, { a: 1, b: 2, c: 3 });

  const logs = [];
  console.log = (...args) => logs.push(args);
  _test.logFlow({ meta: { instance_id: 'i', request_id: 'r' } }, 'phase', { ok: true });
  assert.match(logs[0][0], /\[Proxmox_VE_8_3_5\]\[phase\]\[inst=i req=r\]/);
  const circular = {};
  circular.self = circular;
  _test.logFlow({}, 'fallback', circular);
  assert.equal(logs[1][0], '[Proxmox_VE_8_3_5][fallback]');
});

test('helper aliases and response limits cover production fallback paths', async () => {
  assert.equal(_test.normalizeBaseUrl('not a url'), '');
  assert.equal(_test.resolveBaseUrl({ base_url: 'https://pve.example.com:8006' }), 'https://pve.example.com:8006');
  assert.equal(_test.resolveBaseUrl({ host: 'https://pve.example.com:8006' }), 'https://pve.example.com:8006');
  assert.equal(_test.resolveBaseUrl({ restBaseUrl: 'https://pve.example.com:8006' }), 'https://pve.example.com:8006');
  assert.equal(_test.resolveBaseUrl({ url: 'https://pve.example.com:8006' }), 'https://pve.example.com:8006');
  assert.equal(_test.resolveBaseUrl({ baseUrl: 'http://pve.local', allowHttp: true }), 'http://pve.local');
  assert.equal(_test.resolveBaseUrl({ baseUrl: 'http://pve.local' }, { allowHttp: true }), 'http://pve.local');
  assert.equal(_test.resolveBaseUrl({ baseUrl: 'http://127.0.0.1:8006' }), 'http://127.0.0.1:8006');
  assert.equal(_test.resolveBaseUrl({ baseUrl: 'http://[::1]:8006' }), 'http://[::1]:8006');
  assert.equal(_test.resolveToken({ token_id: 'a@b!c', token_secret: 's' }).tokenSecret, 's');
  assert.throws(() => _test.resolveToken({ tokenId: 'a@b!c', tokenSecret: 'bad\nvalue' }), /invalid character/);
  assert.equal(_test.requireNodeName({ nodeName: 'node-a' }, {}, 'X'), 'node-a');
  assert.equal(_test.requireNodeName({ name: 'node-b' }, {}, 'X'), 'node-b');
  assert.equal(_test.requireNodeName({}, { default_node: 'node-c' }, 'X'), 'node-c');
  assert.equal(_test.requireVmid({ vmId: 2 }, 'X'), 2);
  assert.equal(_test.requireVmid({ VMID: 3 }, 'X'), 3);
  assert.equal(_test.pickBoolean(NaN), undefined);
  assert.equal(_test.pickBoolean(1), true);
  assert.equal(_test.pickBoolean(0), false);
  assert.equal(_test.pickBoolean({ value: 'on' }), true);
  assert.equal(_test.pickLong('bad'), 0);
  assert.equal(_test.pickDouble('bad'), 0);
  assert.equal(_test.extractData('scalar'), 'scalar');
  assert.equal(_test.isValidVmid(_test.VMID_MAX + 1), false);
  assert.equal(_test.resolveTimeoutMs({ limits: { timeoutMs: 0 } }), 5000);
  assert.equal(_test.shouldSkipTls({ insecureSkipVerify: true }), true);
  assert.equal(_test.buildLogPrefix({ instanceId: 'i', requestId: 'r' }, 'x'), '[Proxmox_VE_8_3_5][x][inst=i req=r]');

  await assert.rejects(
    () => _test.readResponseText({ headers: { get: () => String(_test.MAX_RESPONSE_BYTES + 1) } }),
    /maximum allowed size/,
  );
  let cancelled = false;
  let released = false;
  const oversized = new Uint8Array(_test.MAX_RESPONSE_BYTES + 1);
  await assert.rejects(
    () => _test.readResponseText({
      headers: { get: () => null },
      body: { getReader: () => ({
        read: async () => ({ done: false, value: oversized }),
        cancel: async () => { cancelled = true; },
        releaseLock: () => { released = true; },
      }) },
    }),
    /maximum allowed size/,
  );
  assert.equal(cancelled, true);
  assert.equal(released, true);
});

test('network failure maps to UNAVAILABLE', async () => {
  setFetch(async () => { throw Object.assign(new Error('connect refused'), { cause: new Error('ECONNREFUSED') }); });
  await expectGrpcError(
    () => handlers[METHOD_LIST_NODES_FULL]({}, buildCtx()),
    'UNAVAILABLE',
    (err) => assert.equal(err.message, 'UNAVAILABLE: upstream request failed'),
  );
});

test('single-context ABI passes request and bindings to the SDK handler', async () => {
  let url;
  setFetch(async (value) => {
    url = String(value);
    return responseOf(200, { data: [] });
  });
  await handlers[METHOD_LIST_QEMU_VMS_FULL]({ ...buildCtx(), req: { node: 'single-ctx' } });
  assert.equal(url, 'https://pve.example.com:8006/api2/json/nodes/single-ctx/qemu');
});

test('request hardening uses dispatcher, aborts timeout, bounds responses, and redacts secrets', async () => {
  let init;
  setFetch(async (_url, requestInit) => {
    init = requestInit;
    return responseOf(200, { data: [] });
  });
  await handlers[METHOD_LIST_NODES_FULL]({}, buildCtx({
    config: { skipTlsVerify: true, headers: { Authorization: 'attacker', Cookie: 'attacker', Safe: 'yes' } },
  }));
  assert.equal(init.redirect, 'error');
  assert.equal(init.headers.Authorization, `PVEAPIToken=${TOKEN_ID}=${TOKEN_SECRET}`);
  assert.equal(init.headers.Cookie, undefined);
  assert.equal(init.headers.Safe, 'yes');
  assert.equal(typeof init.dispatcher.dispatch, 'function');

  setFetch(async (_url, requestInit) => new Promise((_resolve, reject) => {
    requestInit.signal.addEventListener('abort', () => reject(new Error(`leak ${TOKEN_SECRET}`)), { once: true });
  }));
  await expectGrpcError(
    () => handlers[METHOD_LIST_NODES_FULL]({}, buildCtx({ limits: { timeoutMs: 1 } })),
    'UNAVAILABLE',
    (err) => assert.equal(err.message, 'UNAVAILABLE: upstream timeout'),
  );

  setFetch(async () => responseOf(200, 'x'.repeat(_test.MAX_RESPONSE_BYTES + 1)));
  await expectGrpcError(() => handlers[METHOD_LIST_NODES_FULL]({}, buildCtx()), 'UNAVAILABLE');

  const logs = [];
  console.log = (...args) => logs.push(JSON.stringify(args));
  setFetch(async () => { throw new Error(`PVEAPIToken=a=${TOKEN_SECRET}`); });
  await expectGrpcError(() => handlers[METHOD_LIST_NODES_FULL]({}, buildCtx()), 'UNAVAILABLE');
  assert.doesNotMatch(logs.join('\n'), new RegExp(TOKEN_SECRET));
});

test('upstream bodies and unsafe base URLs never become error or redirect targets', async () => {
  setFetch(async () => responseOf(502, `server echoed ${TOKEN_SECRET}`));
  await expectGrpcError(
    () => handlers[METHOD_LIST_NODES_FULL]({}, buildCtx()),
    'UNAVAILABLE',
    (err) => assert.equal(err.message, 'UNAVAILABLE: upstream http 502'),
  );
  for (const baseUrl of [
    'https://user:password@pve.example.com:8006',
    'https://pve.example.com:8006/api2/json',
    'https://pve.example.com:8006?redirect=https://attacker.example',
  ]) {
    await expectGrpcError(() => handlers[METHOD_LIST_NODES_FULL]({}, buildCtx({ config: { baseUrl } })), 'INVALID_ARGUMENT');
  }
});

test('http 200 with empty body maps to UNKNOWN', async () => {
  setFetch(async () => responseOf(200, ''));
  await expectGrpcError(
    () => handlers[METHOD_LIST_NODES_FULL]({}, buildCtx()),
    'UNKNOWN',
  );
});

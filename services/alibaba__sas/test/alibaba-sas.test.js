import test from 'node:test';
import assert from 'node:assert/strict';

const listContainersPath = '/Alibaba_SAS.Alibaba_SAS/ListContainerInstances';
const listImagesPath = '/Alibaba_SAS.Alibaba_SAS/ListImageInstances';
const listImageVulnsPath = '/Alibaba_SAS.Alibaba_SAS/ListImageVulnerabilities';
const getClusterStatsPath = '/Alibaba_SAS.Alibaba_SAS/GetClusterSuspEventStatistics';
const listInterceptionPath = '/Alibaba_SAS.Alibaba_SAS/ListClusterInterceptionConfig';

const buildCtx = (req = {}, overrides = {}) => ({
  bindings: {
    access_key_id: 'test-key-id',
    access_key_secret: 'test-key-secret',
    region: 'cn-hangzhou',
    ...overrides.bindings,
  },
  limits: { timeoutMs: 10000, ...overrides.limits },
  meta: { instance_id: 'inst', request_id: 'req', ...overrides.meta },
  req,
});

const loadHandler = async (req, path, overrides = {}) => {
  const { rpcdef } = await import('../src/alibaba-sas.js');
  const ctx = buildCtx(req, overrides);
  return rpcdef(ctx)[path];
};

const setFetch = (impl) => { global.fetch = impl; };
const mockUpstream = (responseBody, status = 200) => {
  setFetch(async () => ({
    ok: status >= 200 && status < 300,
    status,
    headers: new Map([['content-type', 'application/json']]),
    text: async () => JSON.stringify(responseBody),
  }));
};

// ── Internal helpers ──────────────────────────────────────

test('internal helpers work correctly', async () => {
  const { _test } = await import('../src/alibaba-sas.js');

  assert.equal(_test.toTrimmedString(undefined), '');
  assert.equal(_test.toTrimmedString(' hello '), 'hello');
  assert.equal(_test.toTrimmedString({ value: ' world ' }), 'world');

  assert.equal(_test.toInt64(null), null);
  assert.equal(_test.toInt64({ value: 42 }), 42);
  assert.equal(_test.toInt64('abc'), null);

  assert.equal(_test.firstDefined(undefined, null, 'a'), 'a');

  assert.equal(_test.toBoolean(true), true);
  assert.equal(_test.toBoolean('true'), true);
  assert.equal(_test.toBoolean(0), false);

  assert.deepEqual(_test.toValue('hello'), { stringValue: 'hello' });
  assert.equal(_test.toValue(null), undefined);
});

// ── Alibaba Cloud RPC Signing ────────────────────────────

test('percentEncode handles special characters', async () => {
  const { _test } = await import('../src/alibaba-sas.js');
  assert.equal(_test.percentEncode('abc'), 'abc');
  assert.equal(_test.percentEncode('a b'), 'a%20b');
  assert.equal(_test.percentEncode('a+b'), 'a%2Bb');
  assert.equal(_test.percentEncode('a~b'), 'a~b');
  assert.equal(_test.percentEncode('a*b'), 'a%2Ab');
  assert.equal(_test.percentEncode('中文'), '%E4%B8%AD%E6%96%87');
});

test('signRpc produces correct format signature', async () => {
  const { _test } = await import('../src/alibaba-sas.js');
  const params = {
    Format: 'JSON',
    Version: '2018-12-03',
    AccessKeyId: 'test-id',
    Action: 'DescribeContainerInstances',
    Timestamp: '2026-06-25T10:00:00Z',
    SignatureMethod: 'HMAC-SHA1',
    SignatureVersion: '1.0',
    SignatureNonce: 'test-nonce',
  };
  const signature = _test.signRpc(params, 'test-secret');
  assert.ok(typeof signature === 'string');
  assert.ok(signature.length > 0);
});

test('buildCommonParams includes all required fields', async () => {
  const { _test } = await import('../src/alibaba-sas.js');
  const params = _test.buildCommonParams('test-id', 'DescribeContainerInstances');
  assert.equal(params.Format, 'JSON');
  assert.equal(params.Version, '2018-12-03');
  assert.equal(params.Action, 'DescribeContainerInstances');
  assert.equal(params.SignatureMethod, 'HMAC-SHA1');
  assert.equal(params.SignatureVersion, '1.0');
  assert.ok(params.AccessKeyId, 'test-id');
  assert.ok(params.Timestamp);
  assert.ok(params.SignatureNonce);
});

// ── Credential resolution ─────────────────────────────────

test('resolveCredentials validates required fields', async () => {
  const { _test } = await import('../src/alibaba-sas.js');
  const creds = _test.resolveCredentials({ access_key_id: 'id', access_key_secret: 'secret' });
  assert.equal(creds.accessKeyId, 'id');
  assert.equal(creds.accessKeySecret, 'secret');

  const camelCase = _test.resolveCredentials({ accessKeyId: 'id2', accessKeySecret: 'secret2' });
  assert.equal(camelCase.accessKeyId, 'id2');

  assert.throws(() => _test.resolveCredentials({}), /access_key_id.*is required/);
  assert.throws(() => _test.resolveCredentials({ access_key_id: 'id' }), /access_key_secret.*is required/);
});

test('resolveRegion and resolveEndpoint use defaults', async () => {
  const { _test } = await import('../src/alibaba-sas.js');
  assert.equal(_test.resolveRegion({}), 'cn-hangzhou');
  assert.equal(_test.resolveRegion({ region: 'cn-beijing' }), 'cn-beijing');
  assert.equal(_test.resolveEndpoint({}), 'sas.aliyuncs.com');
  assert.equal(_test.resolveEndpoint({ endpoint: 'custom.sas.com' }), 'custom.sas.com');
});

// ── Pagination ────────────────────────────────────────────

test('buildPagination handles defaults and limits', async () => {
  const { _test } = await import('../src/alibaba-sas.js');
  const defaultP = _test.buildPagination({});
  assert.equal(defaultP.PageSize, '20');
  assert.ok(!defaultP.CurrentPage);

  const withP = _test.buildPagination({ page_size: 50, current_page: 1 });
  assert.equal(withP.PageSize, '50');
  assert.equal(withP.CurrentPage, '1');

  const maxed = _test.buildPagination({ page_size: 500 });
  assert.equal(maxed.PageSize, '20');

  const wrappers = _test.buildPagination({ page_size: { value: 10 }, current_page: { value: 2 } });
  assert.equal(wrappers.PageSize, '10');
  assert.equal(wrappers.CurrentPage, '2');
});

// ── ListContainerInstances ────────────────────────────────

test('ListContainerInstances sends request and maps response', async () => {
  let capturedUrl, capturedBody;
  setFetch(async (url, init) => {
    capturedUrl = url;
    capturedBody = init.body;
    return {
      ok: true, status: 200,
      headers: new Map([['content-type', 'application/json']]),
      text: async () => JSON.stringify({
        ContainerInstanceList: [
          { InstanceId: 'ci-1', ContainerName: 'nginx', Status: 'Running', ClusterName: 'k8s-prod' },
        ],
        TotalCount: 1,
      }),
    };
  });

  const handler = await loadHandler({ page_size: 10 }, listContainersPath);
  const res = await handler();

  assert.ok(capturedBody.includes('Action=DescribeContainerInstances'));
  assert.ok(capturedBody.includes('PageSize=10'));
  assert.equal(res.items.length, 1);
  assert.equal(res.items[0].container_name, 'nginx');
  assert.equal(res.total_count, 1);
});

test('ListContainerInstances handles empty response', async () => {
  mockUpstream({ ContainerInstanceList: [], TotalCount: 0 });
  const handler = await loadHandler({}, listContainersPath);
  const res = await handler();
  assert.deepEqual(res.items, []);
  assert.equal(res.total_count, 0);
});

test('ListContainerInstances with criteria', async () => {
  let capturedBody;
  setFetch(async (url, init) => {
    capturedBody = init.body;
    return {
      ok: true, status: 200,
      headers: new Map([['content-type', 'application/json']]),
      text: async () => JSON.stringify({ ContainerInstanceList: [], TotalCount: 0 }),
    };
  });

  const handler = await loadHandler({ criteria: 'cluster:k8s-prod', logical_exp: 'AND' }, listContainersPath);
  await handler();
  assert.ok(capturedBody.includes('Criteria='));
  assert.ok(capturedBody.includes('LogicalExp=AND'));
});

// ── ListImageInstances ────────────────────────────────────

test('ListImageInstances sends request and maps response', async () => {
  let capturedBody;
  setFetch(async (url, init) => {
    capturedBody = init.body;
    return {
      ok: true, status: 200,
      headers: new Map([['content-type', 'application/json']]),
      text: async () => JSON.stringify({
        ImageInstanceList: [
          { ImageUuid: 'img-1', ImageTag: 'v1.0', RepoName: 'nginx', VulCount: 5, RiskLevel: 'medium' },
        ],
        TotalCount: 1,
      }),
    };
  });

  const handler = await loadHandler({}, listImagesPath);
  const res = await handler();
  assert.ok(capturedBody.includes('Action=DescribeImageInstances'));
  assert.equal(res.items[0].image_uuid, 'img-1');
  assert.equal(res.items[0].vul_count, 5);
});

// ── ListImageVulnerabilities ──────────────────────────────

test('ListImageVulnerabilities requires image_uuid', async () => {
  const handler = await loadHandler({}, listImageVulnsPath);
  await assert.rejects(() => handler(), /INVALID_ARGUMENT: image_uuid is required/);
});

test('ListImageVulnerabilities sends request and maps response', async () => {
  let capturedBody;
  setFetch(async (url, init) => {
    capturedBody = init.body;
    return {
      ok: true, status: 200,
      headers: new Map([['content-type', 'application/json']]),
      text: async () => JSON.stringify({
        VulRecordList: [
          { Name: 'CVE-2024-0001', AliasName: 'Test Vuln', CveId: 'CVE-2024-0001', Level: 'high', Type: 'cve', FixVersion: '1.2.3', IsFixed: false },
        ],
        TotalCount: 1,
      }),
    };
  });

  const handler = await loadHandler({ image_uuid: 'img-1', level: 'high' }, listImageVulnsPath);
  const res = await handler();
  assert.ok(capturedBody.includes('Action=DescribeImageVulList'));
  assert.equal(res.items[0].cve_id, 'CVE-2024-0001');
  assert.equal(res.items[0].is_fixed, false);
  assert.equal(res.total_count, 1);
});

// ── GetClusterSuspEventStatistics ────────────────────────

test('GetClusterSuspEventStatistics returns statistics', async () => {
  mockUpstream({ ClusterSuspEventStatistics: { Serious: 3, Suspicious: 5, Remind: 2 } });
  const handler = await loadHandler({}, getClusterStatsPath);
  const res = await handler();
  assert.ok(res.statistics);
});

// ── ListClusterInterceptionConfig ─────────────────────────

test('ListClusterInterceptionConfig sends request and maps response', async () => {
  let capturedBody;
  setFetch(async (url, init) => {
    capturedBody = init.body;
    return {
      ok: true, status: 200,
      headers: new Map([['content-type', 'application/json']]),
      text: async () => JSON.stringify({
        ClusterConfigList: [
          { ClusterName: 'k8s-prod', ClusterId: 'c-1', InterceptType: 'container', RuleCount: 5, State: 1 },
        ],
        TotalCount: 1,
      }),
    };
  });

  const handler = await loadHandler({ cluster_id: 'c-1' }, listInterceptionPath);
  const res = await handler();
  assert.ok(capturedBody.includes('Action=ListClusterInterceptionConfig'));
  assert.equal(res.items[0].cluster_name, 'k8s-prod');
  assert.equal(res.items[0].rule_count, 5);
});

// ── Error mapping ─────────────────────────────────────────

test('HTTP error codes are mapped correctly', async () => {
  setFetch(async () => ({ ok: false, status: 401, headers: new Map(), text: async () => 'Unauthorized' }));
  const h401 = await loadHandler({}, listContainersPath);
  await assert.rejects(() => h401(), /UNAUTHENTICATED/);

  setFetch(async () => ({ ok: false, status: 403, headers: new Map(), text: async () => 'Forbidden' }));
  const h403 = await loadHandler({}, listContainersPath);
  await assert.rejects(() => h403(), /PERMISSION_DENIED/);

  setFetch(async () => ({ ok: false, status: 422, headers: new Map(), text: async () => 'Invalid' }));
  const h422 = await loadHandler({}, listContainersPath);
  await assert.rejects(() => h422(), /FAILED_PRECONDITION/);

  setFetch(async () => ({ ok: false, status: 503, headers: new Map(), text: async () => 'Down' }));
  const h503 = await loadHandler({}, listContainersPath);
  await assert.rejects(() => h503(), /UNAVAILABLE/);

  setFetch(async () => { throw new Error('network error'); });
  const hNet = await loadHandler({}, listContainersPath);
  await assert.rejects(() => hNet(), /UNAVAILABLE/);
});

test('Alibaba API error codes are mapped correctly', async () => {
  mockUpstream({ Code: 'InvalidAccessKeyId.NotFound', Message: 'not found' });
  const h = await loadHandler({}, listContainersPath);
  await assert.rejects(() => h(), /UNAUTHENTICATED/);

  mockUpstream({ Code: '400', Message: 'bad request' });
  const h2 = await loadHandler({}, listContainersPath);
  await assert.rejects(() => h2(), /FAILED_PRECONDITION/);
});

test('Non-JSON and empty body handling', async () => {
  setFetch(async () => ({ ok: true, status: 200, headers: new Map([['content-type', 'text/plain']]), text: async () => 'not json' }));
  const h1 = await loadHandler({}, listContainersPath);
  await assert.rejects(() => h1(), /UNKNOWN/);

  setFetch(async () => ({ ok: true, status: 200, headers: new Map(), text: async () => '' }));
  const h2 = await loadHandler({}, listContainersPath);
  await assert.rejects(() => h2(), /UNKNOWN: empty response/);
});

// ── Response mappers handle missing fields ────────────────

test('Response mappers handle missing fields', async () => {
  const { _test } = await import('../src/alibaba-sas.js');
  const c = _test.mapContainerInstance({});
  assert.equal(c.instance_id, '');
  assert.equal(c.container_name, '');

  const img = _test.mapImageInstance({});
  assert.equal(img.image_uuid, '');
  assert.equal(img.vul_count, 0);

  const vuln = _test.mapImageVulnerability({});
  assert.equal(vuln.name, '');
  assert.equal(vuln.is_fixed, false);
});

// ── SDK handlers ──────────────────────────────────────────

test('SDK handlers accept two-arg (req, ctx) style', async () => {
  setFetch(async (url, init) => ({
    ok: true, status: 200,
    headers: new Map([['content-type', 'application/json']]),
    text: async () => JSON.stringify({ ContainerInstanceList: [{ InstanceId: 'c1', ContainerName: 'web' }], TotalCount: 1 }),
  }));

  const { handlers, LIST_CONTAINER_INSTANCES_FULL } = await import('../src/alibaba-sas.js');
  const res = await handlers[LIST_CONTAINER_INSTANCES_FULL](
    {},
    { config: { region: 'cn-beijing' }, secret: { access_key_id: 'sdk-id', access_key_secret: 'sdk-key' } },
  );
  assert.equal(res.items.length, 1);
  assert.equal(res.items[0].container_name, 'web');
});

test('Handler fails with clear error when credentials are missing', async () => {
  const handler = await loadHandler(
    {}, listContainersPath,
    { bindings: { access_key_id: '', access_key_secret: '', region: 'cn-hangzhou' } },
  );
  await assert.rejects(() => handler(), /FAILED_PRECONDITION/);
});

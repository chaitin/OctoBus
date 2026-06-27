import test from 'node:test';
import assert from 'node:assert/strict';

const listProjectsPath = '/OWASP_DependencyTrack_SCA_V5.OWASP_DependencyTrack_SCA_V5/ListProjects';
const createProjectPath = '/OWASP_DependencyTrack_SCA_V5.OWASP_DependencyTrack_SCA_V5/CreateProject';
const getProjectMetricsPath = '/OWASP_DependencyTrack_SCA_V5.OWASP_DependencyTrack_SCA_V5/GetProjectMetrics';
const uploadBomPath = '/OWASP_DependencyTrack_SCA_V5.OWASP_DependencyTrack_SCA_V5/UploadBom';
const listFindingsPath = '/OWASP_DependencyTrack_SCA_V5.OWASP_DependencyTrack_SCA_V5/ListFindings';

const buildCtx = (req = {}, overrides = {}) => ({
  bindings: {
    dependency_track_base_url: 'http://localhost:8081',
    dependency_track_api_key: 'secret-token',
    headers: { 'X-Test': 'yes' },
    ...overrides.bindings,
  },
  limits: { timeoutMs: 10_000, ...overrides.limits },
  meta: { instance_id: 'inst', request_id: 'req', ...overrides.meta },
  req,
});

const loadHandler = async (path, req, overrides = {}) => {
  const { rpcdef } = await import('../src/owasp-dependency-track-sca-v5-0.js');
  const ctx = buildCtx(req, overrides);
  return rpcdef(ctx)[path];
};

const setFetch = (impl) => {
  global.fetch = async (...args) => impl(...args);
};

const jsonResponse = (status, body, headers = {}) => ({
  status,
  headers,
  text: async () => JSON.stringify(body),
});

test('helpers normalize bindings, API prefix, query strings, headers, and TLS policy', async () => {
  const { _test } = await import('../src/owasp-dependency-track-sca-v5-0.js');

  assert.deepEqual(_test.mergedBindings({
    config: { dependency_track_base_url: 'http://config', keep: 'config' },
    secret: { dependency_track_api_key: 'secret' },
    bindings: { dependency_track_base_url: 'http://binding' },
  }), {
    dependency_track_base_url: 'http://binding',
    keep: 'config',
    dependency_track_api_key: 'secret',
  });
  assert.equal(_test.normalizeBaseUrl('http://localhost:8081/'), 'http://localhost:8081');
  assert.equal(_test.normalizeBaseUrl('ftp://bad'), '');
  assert.equal(_test.normalizeApiPrefix('api/v1/'), '/api/v1');
  assert.equal(_test.resolveBaseUrl({ baseUrl: 'http://base' }), 'http://base');
  assert.equal(_test.resolveApiKey({ apiKey: 'abc' }), 'abc');
  assert.equal(_test.toOptionalInt({ value: '7' }, { min: 1 }), 7);
  assert.equal(_test.toOptionalInt('0', { min: 1 }), undefined);
  assert.equal(_test.toOptionalBool({ value: 'false' }), false);
  assert.equal(_test.toOptionalBool(1), true);
  assert.deepEqual(_test.parseHeaders('{"X-A":"1"}'), { 'X-A': '1' });
  assert.deepEqual(_test.parseHeaders('{'), {});
  assert.equal(_test.encodeQueryPairs({ a: 'x y', empty: '', missing: undefined }), 'a=x%20y');
  assert.equal(
    _test.buildUrl('http://x/', '/api/v1', '/project', { limit: 2 }),
    'http://x/api/v1/project?limit=2',
  );
  assert.deepEqual(_test.buildRequestHeaders(buildCtx()), {
    Accept: 'application/json',
    'X-Test': 'yes',
    'X-Api-Key': 'secret-token',
  });
  assert.throws(
    () => _test.assertSupportedTlsConfig({ skipTlsVerify: true }),
    /skipTlsVerify is not supported/,
  );
});

test('ListProjects forwards supported filters and maps paginated array response', async () => {
  let captured;
  setFetch(async (url, init) => {
    captured = { url, init };
    return jsonResponse(200, [{ uuid: 'project-uuid', name: 'demo', version: '1.0.0' }], {
      get: (name) => (name === 'X-Total-Count' ? '1' : null),
    });
  });

  const handler = await loadHandler(listProjectsPath, {
    limit: { value: 50 },
    offset: { value: 10 },
    name: 'demo',
    exclude_inactive: true,
    only_root: false,
    not_assigned_to_team_with_uuid: 'team-uuid',
  });
  const res = await handler();

  assert.equal(
    captured.url,
    'http://localhost:8081/api/v1/project?limit=50&offset=10&name=demo&excludeInactive=true&onlyRoot=false&notAssignedToTeamWithUuid=team-uuid',
  );
  assert.equal(captured.init.method, 'GET');
  assert.equal(captured.init.headers['X-Api-Key'], 'secret-token');
  assert.equal(captured.init.headers['X-Test'], 'yes');
  assert.equal(Object.hasOwn(captured.init, 'timeoutMs'), false);
  assert.equal(Object.hasOwn(captured.init, 'skipTlsVerify'), false);
  assert.ok(captured.init.signal instanceof AbortSignal);
  assert.equal(res.http_status, 200);
  assert.equal(res.count, 1);
  assert.equal(res.results[0].structValue.fields.name.stringValue, 'demo');
});

test('ListProjects uses tag and classifier paths when requested', async () => {
  const capturedUrls = [];
  setFetch(async (url) => {
    capturedUrls.push(url);
    return jsonResponse(200, []);
  });

  const tagHandler = await loadHandler(listProjectsPath, { tag: 'release tag', limit: 1 });
  await tagHandler();
  const classifierHandler = await loadHandler(listProjectsPath, { classifier: 'APPLICATION' });
  await classifierHandler();

  assert.equal(capturedUrls[0], 'http://localhost:8081/api/v1/project/tag/release%20tag?limit=1');
  assert.equal(capturedUrls[1], 'http://localhost:8081/api/v1/project/classifier/APPLICATION');
});

test('CreateProject sends JSON body and returns object response', async () => {
  let captured;
  setFetch(async (url, init) => {
    captured = { url, init, body: JSON.parse(init.body) };
    return jsonResponse(201, { uuid: 'created-uuid', name: 'octobus-demo' });
  });

  const handler = await loadHandler(createProjectPath, {
    name: 'octobus-demo',
    version: '1.0.0',
    classifier: 'APPLICATION',
    description: 'created by OctoBus test',
    tags: ['octobus', 'sca'],
    active: true,
  });
  const res = await handler();

  assert.equal(captured.url, 'http://localhost:8081/api/v1/project');
  assert.equal(captured.init.method, 'PUT');
  assert.equal(captured.init.headers['Content-Type'], 'application/json');
  assert.deepEqual(captured.body, {
    name: 'octobus-demo',
    version: '1.0.0',
    classifier: 'APPLICATION',
    description: 'created by OctoBus test',
    tags: [{ name: 'octobus' }, { name: 'sca' }],
    active: true,
  });
  assert.equal(res.http_status, 201);
  assert.equal(res.raw_json.structValue.fields.uuid.stringValue, 'created-uuid');
});

test('GetProjectMetrics validates project_uuid and fetches current metrics', async () => {
  const badHandler = await loadHandler(getProjectMetricsPath, {});
  await assert.rejects(() => badHandler(), /project_uuid is required/);

  let capturedUrl;
  setFetch(async (url) => {
    capturedUrl = url;
    return jsonResponse(200, { critical: 1, high: 2 });
  });

  const handler = await loadHandler(getProjectMetricsPath, { project_uuid: 'project-uuid' });
  const res = await handler();

  assert.equal(capturedUrl, 'http://localhost:8081/api/v1/metrics/project/project-uuid/current');
  assert.equal(res.raw_json.structValue.fields.critical.numberValue, 1);
});

test('OctoBus protobuf JSON lowerCamelCase field names are accepted', async () => {
  const capturedUrls = [];
  const capturedBodies = [];
  setFetch(async (url, init = {}) => {
    capturedUrls.push(url);
    if (init.body) capturedBodies.push(JSON.parse(init.body));
    return jsonResponse(200, []);
  });

  const listProjects = await loadHandler(listProjectsPath, {
    excludeInactive: true,
    onlyRoot: true,
    notAssignedToTeamWithUuid: 'team-uuid',
  });
  await listProjects();

  const metrics = await loadHandler(getProjectMetricsPath, { projectUuid: 'project-uuid' });
  await metrics();

  const upload = await loadHandler(uploadBomPath, {
    projectUuid: 'project-uuid',
    autoCreate: false,
    bom: 'base64-bom',
  });
  await upload();

  const findings = await loadHandler(listFindingsPath, {
    projectUuid: 'project-uuid',
    suppressed: false,
  });
  await findings();

  assert.equal(
    capturedUrls[0],
    'http://localhost:8081/api/v1/project?excludeInactive=true&onlyRoot=true&notAssignedToTeamWithUuid=team-uuid',
  );
  assert.equal(capturedUrls[1], 'http://localhost:8081/api/v1/metrics/project/project-uuid/current');
  assert.equal(capturedUrls[2], 'http://localhost:8081/api/v1/bom');
  assert.equal(capturedBodies[0].project, 'project-uuid');
  assert.equal(capturedBodies[0].autoCreate, false);
  assert.equal(capturedUrls[3], 'http://localhost:8081/api/v1/finding/project/project-uuid?suppressed=false');
});

test('UploadBom sends JSON CycloneDX payload', async () => {
  let captured;
  setFetch(async (url, init) => {
    captured = { url, init, body: JSON.parse(init.body) };
    return jsonResponse(200, { token: 'upload-token' });
  });

  const handler = await loadHandler(uploadBomPath, {
    project_uuid: 'project-uuid',
    auto_create: false,
    bom: 'eyJib21Gb3JtYXQiOiJDeWNsb25lRFgifQ==',
  });
  const res = await handler();

  assert.equal(captured.url, 'http://localhost:8081/api/v1/bom');
  assert.equal(captured.init.method, 'PUT');
  assert.deepEqual(captured.body, {
    bom: 'eyJib21Gb3JtYXQiOiJDeWNsb25lRFgifQ==',
    autoCreate: false,
    project: 'project-uuid',
  });
  assert.equal(res.raw_json.structValue.fields.token.stringValue, 'upload-token');
});

test('UploadBom can auto-create project by name and version', async () => {
  const { _test } = await import('../src/owasp-dependency-track-sca-v5-0.js');

  assert.deepEqual(_test.buildBomBody({
    project_name: 'octobus-demo',
    project_version: '1.0.0',
    bom: 'base64-bom',
  }), {
    bom: 'base64-bom',
    autoCreate: true,
    projectName: 'octobus-demo',
    projectVersion: '1.0.0',
  });
  assert.throws(() => _test.buildBomBody({ bom: 'base64-bom' }), /project_uuid or both project_name and project_version/);
});

test('ListFindings forwards project UUID filters and maps object results', async () => {
  let capturedUrl;
  setFetch(async (url) => {
    capturedUrl = url;
    return jsonResponse(200, {
      count: 1,
      results: [{ component: { name: 'lodash' }, vulnerability: { vulnId: 'CVE-0000-0001' } }],
    });
  });

  const handler = await loadHandler(listFindingsPath, {
    project_uuid: 'project-uuid',
    suppressed: { value: false },
    source: 'NVD',
    limit: 25,
    offset: 0,
  });
  const res = await handler();

  assert.equal(capturedUrl, 'http://localhost:8081/api/v1/finding/project/project-uuid?limit=25&offset=0&suppressed=false&source=NVD');
  assert.equal(res.count, 1);
  assert.equal(res.results[0].structValue.fields.component.structValue.fields.name.stringValue, 'lodash');
});

test('sdk handlers accept single call context with request, config, and secret', async () => {
  const { handlers } = await import('../src/owasp-dependency-track-sca-v5-0.js');
  let captured;
  setFetch(async (url, init) => {
    captured = { url, init };
    return jsonResponse(200, []);
  });

  const res = await handlers['OWASP_DependencyTrack_SCA_V5.OWASP_DependencyTrack_SCA_V5/ListProjects']({
    request: { limit: { value: 1 } },
    config: { dependency_track_base_url: 'http://localhost:8081' },
    secret: { dependency_track_api_key: 'sdk-token' },
  });

  assert.equal(captured.url, 'http://localhost:8081/api/v1/project?limit=1');
  assert.equal(captured.init.headers['X-Api-Key'], 'sdk-token');
  assert.equal(res.count, 0);
});

test('upstream HTTP errors include status and raw body', async () => {
  setFetch(async () => ({
    status: 403,
    text: async () => '{"message":"forbidden"}',
  }));

  const handler = await loadHandler(listProjectsPath, {});
  await assert.rejects(async () => handler(), (err) => {
    assert.match(err.message, /dependency-track upstream http failure/);
    assert.match(err.message, /"http_status":403/);
    assert.match(err.message, /forbidden/);
    return true;
  });
});

test('missing API key remains an INVALID_ARGUMENT validation error', async () => {
  let fetchCalled = false;
  setFetch(async () => {
    fetchCalled = true;
    return jsonResponse(200, []);
  });

  const handler = await loadHandler(listProjectsPath, {}, {
    bindings: { dependency_track_api_key: '' },
  });
  await assert.rejects(async () => handler(), (err) => {
    assert.match(err.message, /dependency_track_api_key is required/);
    assert.doesNotMatch(err.message, /dependency-track upstream request failed/);
    assert.equal(fetchCalled, false);
    return true;
  });
});

test('timeout remains active while reading response body', async () => {
  let capturedSignal;
  setFetch(async (url, init) => {
    capturedSignal = init.signal;
    return {
      status: 200,
      headers: {},
      text: async () => new Promise((resolve, reject) => {
        capturedSignal.addEventListener('abort', () => reject(new Error('body read aborted')), { once: true });
        setTimeout(() => resolve('{"late":true}'), 50);
      }),
    };
  });

  const handler = await loadHandler(listProjectsPath, {}, {
    limits: { timeoutMs: 5 },
  });
  await assert.rejects(async () => handler(), (err) => {
    assert.match(err.message, /dependency-track upstream response read failed/);
    assert.match(err.message, /body read aborted/);
    assert.equal(capturedSignal.aborted, true);
    return true;
  });
});

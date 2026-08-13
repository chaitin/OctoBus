import assert from 'node:assert/strict';
import test from 'node:test';

import { grpcStatus } from '@chaitin-ai/octobus-sdk';

import {
  OPEN_API_METHODS,
  _test,
  buildBotBody,
  buildCreateBody,
  buildListQuery,
  handlers,
} from '../src/feishu-open-api.js';
import { handlers as serviceHandlers, service } from '../src/service.js';

const response = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json' },
});

const fetchQueue = (responses, calls = []) => async (url, options) => {
  calls.push({ url: String(url), options });
  const next = responses.shift();
  if (next instanceof Error) throw next;
  if (!next) throw new Error('unexpected request');
  return next;
};

const context = (responses, req = {}, calls = []) => ({
  config: { baseUrl: 'http://127.0.0.1:18081', allowInsecureHttp: true },
  secret: { appId: 'cli_test', appSecret: 'app-secret' },
  fetchImpl: fetchQueue(responses, calls),
  req,
});

test.beforeEach(() => _test.tokenCache.clear());

test('recognizes runtime timeout shapes and sanitizes upstream messages', () => {
  assert.equal(_test.isTimeoutError({ name: 'TimeoutError' }), true);
  assert.equal(_test.isTimeoutError({ name: 'AbortError', cause: { name: 'TimeoutError' } }), true);
  assert.equal(_test.isTimeoutError(new Error('network failed')), false);
  assert.equal(
    _test.sanitizeUpstreamMessage('authorization: Bearer-secret token=tenant-secret'),
    'authorization=*** token=***',
  );
});

test('keeps legacy group robot method while registering Open Platform methods', () => {
  assert.ok(service);
  assert.equal(typeof service, 'object');
  for (const method of Object.values(OPEN_API_METHODS)) {
    assert.equal(typeof handlers[method], 'function');
    assert.equal(typeof serviceHandlers[method], 'function');
  }
});

test('requires application credentials only when an Open Platform method is called', async () => {
  await assert.rejects(
    handlers[OPEN_API_METHODS.CHECK_CONNECTIVITY]({ secret: {} }),
    (error) => error.code === grpcStatus.INVALID_ARGUMENT && /appId is required/.test(error.message),
  );
  assert.throws(
    () => _test.resolveSettings({
      config: { baseUrl: 'http://example.test' },
      secret: { appId: 'a', appSecret: 'b' },
    }),
    /baseUrl must use HTTPS/,
  );
});

test('validates the ten-hour instance discovery window', () => {
  assert.deepEqual(buildListQuery({
    approvalCode: 'approval-a',
    startTimeMs: 1000n,
    endTimeMs: 3601000n,
    pageSize: 50,
    pageToken: 'next-page',
  }), {
    approval_code: 'approval-a',
    start_time: '1000',
    end_time: '3601000',
    page_size: '50',
    page_token: 'next-page',
  });
  assert.throws(
    () => buildListQuery({
      approvalCode: 'approval-a',
      startTimeMs: 1,
      endTimeMs: 10 * 60 * 60 * 1000 + 2,
    }),
    /must not exceed ten hours/,
  );
  assert.throws(
    () => buildListQuery({
      approvalCode: 'approval-a', startTimeMs: 1, endTimeMs: 2, pageSize: 101,
    }),
    /page_size must be between 1 and 100/,
  );
});

test('builds approval creation with a required Feishu UUID', () => {
  assert.deepEqual(buildCreateBody({
    approvalCode: 'approval-a',
    userId: 'user-a',
    formJson: '[{"id":"ip","type":"input","value":"192.0.2.1"}]',
    nodeApprovers: [{ key: 'owner', userIds: ['user-b'] }],
    nodeCcUsers: [{ key: 'audit', userIds: ['user-c', 'user-c'] }],
    operationId: 'ticket-7-v2',
    cancelBotNotification: true,
  }), {
    approval_code: 'approval-a',
    user_id: 'user-a',
    form: '[{"id":"ip","type":"input","value":"192.0.2.1"}]',
    uuid: 'ticket-7-v2',
    node_approver_user_id_list: [{ key: 'owner', value: ['user-b'] }],
    node_cc_user_id_list: [{ key: 'audit', value: ['user-c'] }],
    cancel_bot_notification: '7',
  });
  for (const invalid of [
    { approvalCode: 'a', formJson: '[]', operationId: 'op' },
    { approvalCode: 'a', userId: 'u', formJson: '{}', operationId: 'op' },
    { approvalCode: 'a', userId: 'u', formJson: '[]' },
  ]) assert.throws(() => buildCreateBody(invalid));
  const bothIds = buildCreateBody({
    approvalCode: 'a', userId: 'u', openId: 'ou_a', formJson: '[]', operationId: 'op',
  });
  assert.equal(bothIds.user_id, 'u');
  assert.equal(bothIds.open_id, 'ou_a');
});

test('builds custom approval Bot template 1021 with UUID deduplication', () => {
  const body = buildBotBody({
    recipientOpenId: 'ou_a',
    operationId: 'risk-1-v3',
    title: 'Retest result',
    content: 'Two vulnerabilities remain.',
    detailUrl: 'https://console.example.test/orders/7',
    locale: 'en-US',
  });
  assert.equal(body.template_id, '1021');
  assert.equal(body.open_id, 'ou_a');
  assert.equal(body.uuid, 'risk-1-v3');
  assert.equal(body.i18n_resources[0].texts['@i18n@content'], 'Two vulnerabilities remain.');
  assert.throws(() => buildBotBody({
    recipientUserId: 'u', operationId: 'op', title: 'x', content: 'x', detailUrl: 'javascript:x',
  }));
});

test('caches tenant token without leaking application credentials into API requests', async () => {
  const calls = [];
  const ctx = context([
    response({ code: 0, tenant_access_token: 'tenant-token', expire: 7200 }),
    response({ code: 0, data: { name: 'CMP change' } }),
    response({ code: 0, data: { name: 'CMP change' } }),
  ], { approvalCode: 'approval-a' }, calls);
  await handlers[OPEN_API_METHODS.GET_APPROVAL_DEFINITION](ctx);
  await handlers[OPEN_API_METHODS.GET_APPROVAL_DEFINITION](ctx);
  assert.equal(calls.length, 3);
  assert.deepEqual(JSON.parse(calls[0].options.body), { app_id: 'cli_test', app_secret: 'app-secret' });
  assert.equal(calls[1].options.headers.Authorization, 'Bearer tenant-token');
  assert.doesNotMatch(JSON.stringify(calls.slice(1)), /app-secret|cli_test/);
});

test('clears the cached tenant token after an authentication business error', async () => {
  const calls = [];
  const ctx = context([
    response({ code: 0, tenant_access_token: 'tenant-token', expire: 7200 }),
    response({ code: 99991663, msg: 'tenant token invalid' }, 403),
  ], { approvalCode: 'approval-a' }, calls);
  await assert.rejects(
    handlers[OPEN_API_METHODS.GET_APPROVAL_DEFINITION](ctx),
    (error) => error.code === grpcStatus.UNAUTHENTICATED,
  );
  assert.equal(_test.tokenCache.size, 0);
  assert.equal(calls.length, 2);
});

test('rejects a successful HTTP response that omits Feishu code', async () => {
  await assert.rejects(
    handlers[OPEN_API_METHODS.GET_APPROVAL_DEFINITION](context([
      response({ code: 0, tenant_access_token: 'tenant-token', expire: 7200 }),
      response({ data: { name: 'missing-code' } }),
    ], { approvalCode: 'approval-a' })),
    (error) => error.code === grpcStatus.UNKNOWN,
  );
});

test('does not reuse a cached tenant token after app secret rotation', async () => {
  await handlers[OPEN_API_METHODS.CHECK_CONNECTIVITY](context([
    response({ code: 0, tenant_access_token: 'old-token', expire: 7200 }),
  ]));

  const calls = [];
  const rotated = context([
    response({ code: 0, tenant_access_token: 'new-token', expire: 7200 }),
  ], {}, calls);
  rotated.secret.appSecret = 'rotated-secret';
  const result = await handlers[OPEN_API_METHODS.CHECK_CONNECTIVITY](rotated);

  assert.equal(result.reachable, true);
  assert.equal(calls.length, 1);
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    app_id: 'cli_test',
    app_secret: 'rotated-secret',
  });
  assert.equal(_test.tokenCache.size, 2);
  for (const key of _test.tokenCache.keys()) {
    assert.doesNotMatch(key, /app-secret|rotated-secret/);
  }
});

test('calls exact creation endpoint once and returns operation correlation', async () => {
  const calls = [];
  const result = await handlers[OPEN_API_METHODS.CREATE_APPROVAL_INSTANCE](context([
    response({ code: 0, tenant_access_token: 'token', expire: 7200 }),
    response({ code: 0, data: { instance_code: 'instance-a' } }),
  ], {
    approvalCode: 'approval-a',
    userId: 'user-a',
    formJson: '[]',
    operationId: 'create-a',
  }, calls));
  assert.deepEqual(result, { instance_code: 'instance-a', operation_id: 'create-a' });
  assert.equal(calls[1].url, 'http://127.0.0.1:18081/open-apis/approval/v4/instances');
  assert.equal(JSON.parse(calls[1].options.body).uuid, 'create-a');
});

test('returns structured Feishu data without exposing the envelope', async () => {
  const result = await handlers[OPEN_API_METHODS.GET_APPROVAL_DEFINITION](context([
    response({ code: 0, tenant_access_token: 'token', expire: 7200 }),
    response({ code: 0, data: { name: 'approval-a', extra: true } }),
  ], { approvalCode: 'approval-a' }));
  assert.deepEqual(result, { data: { name: 'approval-a', extra: true } });
});

test('calls exact read, cancel, Bot, user, and department endpoints', async () => {
  const cases = [
    [OPEN_API_METHODS.LIST_APPROVAL_INSTANCE_CODES,
      { approvalCode: 'a', startTimeMs: 1, endTimeMs: 2, pageSize: 10, pageToken: 'next' },
      '/open-apis/approval/v4/instances?approval_code=a&start_time=1&end_time=2&page_size=10&page_token=next'],
    [OPEN_API_METHODS.GET_APPROVAL_INSTANCE,
      { instanceCode: 'i' },
      '/open-apis/approval/v4/instances/i?user_id_type=open_id'],
    [OPEN_API_METHODS.CANCEL_APPROVAL_INSTANCE,
      { approvalCode: 'a', instanceCode: 'i', userId: 'u', operationId: 'cancel-a' },
      '/open-apis/approval/v4/instances/cancel?user_id_type=open_id'],
    [OPEN_API_METHODS.SEND_APPROVAL_BOT_MESSAGE,
      { recipientUserId: 'u', operationId: 'message-a', title: 'x', content: 'y', detailUrl: 'https://example.test' },
      '/open-apis/approval/v1/message/send'],
    [OPEN_API_METHODS.GET_USER,
      { userId: 'u' },
      '/open-apis/contact/v3/users/u?department_id_type=open_department_id&user_id_type=open_id'],
    [OPEN_API_METHODS.GET_DEPARTMENT,
      { departmentId: 'd' },
      '/open-apis/contact/v3/departments/d?department_id_type=open_department_id&user_id_type=open_id'],
  ];
  for (const [method, req, expectedPath] of cases) {
    _test.tokenCache.clear();
    const calls = [];
    const data = method === OPEN_API_METHODS.SEND_APPROVAL_BOT_MESSAGE
      ? { message_id: 'm' }
      : {};
    await handlers[method](context([
      response({ code: 0, tenant_access_token: 'token', expire: 7200 }),
      response({ code: 0, data }),
    ], req, calls));
    assert.equal(calls[1].url, `http://127.0.0.1:18081${expectedPath}`);
  }
});

test('maps auth, permission, rate limit, not found, and invalid argument errors', async () => {
  const cases = [
    [401, 99991668, grpcStatus.UNAUTHENTICATED],
    [403, 99991663, grpcStatus.UNAUTHENTICATED],
    [200, 40004, grpcStatus.PERMISSION_DENIED],
    [200, 40014, grpcStatus.PERMISSION_DENIED],
    [200, 99991672, grpcStatus.PERMISSION_DENIED],
    [429, 230020, grpcStatus.RESOURCE_EXHAUSTED],
    [400, 1390003, grpcStatus.NOT_FOUND],
    [400, 1390001, grpcStatus.INVALID_ARGUMENT],
    [400, 1395001, grpcStatus.UNAVAILABLE],
  ];
  for (const [status, code, expected] of cases) {
    _test.tokenCache.clear();
    await assert.rejects(
      handlers[OPEN_API_METHODS.GET_APPROVAL_DEFINITION](context([
        response({ code: 0, tenant_access_token: 'token', expire: 7200 }),
        response({ code, msg: 'safe error' }, status),
      ], { approvalCode: 'a' })),
      (error) => error.code === expected,
    );
  }
});

test('does not automatically retry an ambiguous mutation', async () => {
  const calls = [];
  await assert.rejects(
    handlers[OPEN_API_METHODS.CREATE_APPROVAL_INSTANCE](context([
      response({ code: 0, tenant_access_token: 'token', expire: 7200 }),
      new Error('socket closed'),
    ], {
      approvalCode: 'a', userId: 'u', formJson: '[]', operationId: 'op',
    }, calls)),
    (error) => error.code === grpcStatus.UNAVAILABLE
      && error.ambiguous === true
      && /may be ambiguous/.test(error.message),
  );
  assert.equal(calls.length, 2);
});

test('marks HTTP 5xx mutation responses as ambiguous', async () => {
  const calls = [];
  await assert.rejects(
    handlers[OPEN_API_METHODS.CREATE_APPROVAL_INSTANCE](context([
      response({ code: 0, tenant_access_token: 'token', expire: 7200 }),
      response({ code: 1395001, msg: 'try later' }, 500),
    ], {
      approvalCode: 'a', userId: 'u', formJson: '[]', operationId: 'op',
    }, calls)),
    (error) => error.code === grpcStatus.UNAVAILABLE
      && error.ambiguous === true
      && /may be ambiguous/.test(error.message),
  );
  assert.equal(calls.length, 2);
});

test('covers validation boundaries without sending requests', async () => {
  assert.throws(() => buildListQuery({ approvalCode: 'a', startTimeMs: 0, endTimeMs: 2 }), /positive integer/);
  assert.throws(() => buildListQuery({ approvalCode: 'a', startTimeMs: 2, endTimeMs: 1 }), /must be greater/);
  assert.throws(() => buildCreateBody({
    approvalCode: 'a', userId: 'u', formJson: '{', operationId: 'op',
  }), /valid JSON/);
  assert.throws(() => buildCreateBody({
    approvalCode: 'a', userId: 'u', formJson: '[]', operationId: 'x'.repeat(65),
  }), /exceeds 64/);
  assert.throws(() => buildCreateBody({
    approvalCode: 'a', userId: 'u', formJson: '[]', operationId: 'op',
    nodeApprovers: Array.from({ length: 21 }, (_, index) => ({ key: String(index), userIds: ['u'] })),
  }), /at most 20/);
  assert.throws(() => buildCreateBody({
    approvalCode: 'a', userId: 'u', formJson: '[]', operationId: 'op',
    nodeApprovers: [{ key: 'same', userIds: ['u'] }, { key: 'same', userIds: ['v'] }],
  }), /duplicate key/);
  assert.throws(() => buildCreateBody({
    approvalCode: 'a', userId: 'u', formJson: '[]', operationId: 'op',
    nodeApprovers: [{ key: 'owner', userIds: [] }],
  }), /1 to 20 users/);

  const openIdBody = buildCreateBody({
    approvalCode: 'a', openId: 'ou_a', departmentId: 'd', formJson: '[]', operationId: 'op',
  });
  assert.equal(openIdBody.open_id, 'ou_a');
  assert.equal(openIdBody.department_id, 'd');
  assert.equal(openIdBody.cancel_bot_notification, undefined);

  assert.throws(() => buildBotBody({
    recipientUserId: 'u', operationId: 'op', title: 'x', content: 'x', detailUrl: 'not a URL',
  }), /valid HTTP/);
  const zhBody = buildBotBody({
    recipientUserId: 'u', operationId: 'op', title: 'x', content: 'x', detailUrl: 'http://example.test',
  });
  assert.equal(zhBody.user_id, 'u');
  assert.equal(zhBody.i18n_resources[0].texts['@i18n@detail'], '查看详情');
  assert.throws(() => buildBotBody({
    recipientUserId: 'u', operationId: 'op', title: 'x', content: 'x', detailUrl: 'https://example.test', locale: 'fr-FR',
  }), /locale must be one of/);

  assert.throws(() => _test.normalizeBaseUrl('not a URL', false), /valid URL/);
  assert.equal(_test.normalizeBaseUrl(undefined, false), 'https://open.feishu.cn');
  assert.equal(_test.mapErrorCode(403, 0), 'PERMISSION_DENIED');
  assert.equal(_test.mapErrorCode(200, 40004), 'PERMISSION_DENIED');
  assert.equal(_test.mapErrorCode(200, 40014), 'PERMISSION_DENIED');
  assert.equal(_test.mapErrorCode(200, 99991661), 'PERMISSION_DENIED');
  assert.equal(_test.mapErrorCode(429, 0), 'RESOURCE_EXHAUSTED');
  assert.equal(_test.mapErrorCode(200, 99991400), 'RESOURCE_EXHAUSTED');
  assert.equal(_test.mapErrorCode(404, 0), 'NOT_FOUND');
  assert.equal(_test.mapErrorCode(400, 0), 'FAILED_PRECONDITION');
  assert.equal(_test.mapErrorCode(500, 0), 'UNAVAILABLE');
  assert.equal(_test.mapErrorCode(200, 123), 'UNKNOWN');
  await assert.rejects(
    _test.parseResponse(new Response('not json', { status: 200 })),
    (error) => error.code === grpcStatus.UNKNOWN,
  );
  await assert.rejects(
    _test.parseResponse(new Response('not json', { status: 500 })),
    (error) => error.code === grpcStatus.UNAVAILABLE,
  );
  for (const body of ['null', '[]']) {
    await assert.rejects(
      _test.parseResponse(new Response(body, { status: 200 })),
      (error) => error.code === grpcStatus.UNKNOWN,
    );
  }
  await assert.rejects(
    _test.parseResponse(new Response('[]', { status: 500 })),
    (error) => error.code === grpcStatus.UNAVAILABLE,
  );
});

test('checks connectivity and rejects incomplete token responses', async () => {
  const success = await handlers[OPEN_API_METHODS.CHECK_CONNECTIVITY](context([
    response({ code: 0, tenant_access_token: 'token', expire: 7200 }),
  ]));
  assert.equal(success.reachable, true);
  assert.ok(success.token_expires_in_seconds > 7190);

  _test.tokenCache.clear();
  await assert.rejects(
    handlers[OPEN_API_METHODS.CHECK_CONNECTIVITY](context([
      response({ code: 0, tenant_access_token: 'token', expire: 0 }),
    ])),
    /token response is incomplete/,
  );
});

test('reports read network failures as unambiguous', async () => {
  const calls = [];
  await assert.rejects(
    handlers[OPEN_API_METHODS.GET_APPROVAL_DEFINITION](context([
      response({ code: 0, tenant_access_token: 'token', expire: 7200 }),
      Object.assign(new Error('timeout'), { name: 'AbortError' }),
    ], { approvalCode: 'a' }, calls)),
    (error) => error.code === grpcStatus.DEADLINE_EXCEEDED
      && error.ambiguous === false
      && /timed out/.test(error.message),
  );
  assert.equal(calls.length, 2);
});

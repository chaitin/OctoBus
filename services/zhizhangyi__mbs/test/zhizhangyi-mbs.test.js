import test from 'node:test';
import assert from 'node:assert/strict';

import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';

import { rpcdef } from '../src/zhizhangyi-mbs.js';

const ADD_USER = 'zhizhangyi.mbs.UserManagement/AddUser';
const DEL_USERS = 'zhizhangyi.mbs.UserManagement/DelUsers';
const STATE_USERS = 'zhizhangyi.mbs.UserManagement/StateUsers';

const originalFetch = globalThis.fetch;

const buildCtx = (req) => ({
  config: { endpoint: 'https://mbs.example' },
  secret: { appkey: 'appkey', secretkey: 'secretkey', orgCode: 'org' },
  req,
});

test.afterEach(() => {
  globalThis.fetch = originalFetch;
});

test('AddUser requires password before calling upstream', async () => {
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    return { ok: true, status: 200, text: async () => '{"code":0}' };
  };

  await assert.rejects(
    () => rpcdef(buildCtx({ user_name: 'User', login_name: 'user', dept_id: 'dept' }))[ADD_USER](),
    (err) => {
      assert.ok(err instanceof GrpcError);
      assert.equal(err.code, grpcStatus.INVALID_ARGUMENT);
      assert.equal(err.legacyCode, 'INVALID_ARGUMENT');
      assert.match(err.message, /password required/);
      return true;
    },
  );

  assert.equal(called, false);
});

test('StateUsers requires explicit state before calling upstream', async () => {
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    return { ok: true, status: 200, text: async () => '{"code":0}' };
  };

  await assert.rejects(
    () => rpcdef(buildCtx({ type: 0, user_ids: ['user-1'] }))[STATE_USERS](),
    (err) => {
      assert.ok(err instanceof GrpcError);
      assert.equal(err.code, grpcStatus.INVALID_ARGUMENT);
      assert.equal(err.legacyCode, 'INVALID_ARGUMENT');
      assert.match(err.message, /state required/);
      return true;
    },
  );

  assert.equal(called, false);
});

test('DelUsers treats string type zero as userIds mode', async () => {
  let captured;
  globalThis.fetch = async (url, init) => {
    captured = { url, init };
    return { ok: true, status: 200, text: async () => '{"code":0}' };
  };

  await rpcdef(buildCtx({ type: '0', user_ids: ['user-1'] }))[DEL_USERS]();

  assert.equal(captured.url, 'https://mbs.example/uusafe/mos/thirdaccess/rest/opt/v1/delUsers');
  assert.deepEqual(JSON.parse(captured.init.body).userIds, ['user-1']);
  assert.equal(JSON.parse(captured.init.body).type, 0);
  assert.equal(Object.hasOwn(JSON.parse(captured.init.body), 'condition'), false);
});

test('StateUsers treats string type zero as userIds mode', async () => {
  let captured;
  globalThis.fetch = async (url, init) => {
    captured = { url, init };
    return { ok: true, status: 200, text: async () => '{"code":0}' };
  };

  await rpcdef(buildCtx({ type: '0', state: '1', user_ids: ['user-1'] }))[STATE_USERS]();

  assert.equal(captured.url, 'https://mbs.example/uusafe/mos/thirdaccess/rest/opt/v1/stateUsers');
  assert.deepEqual(JSON.parse(captured.init.body).userIds, ['user-1']);
  assert.equal(JSON.parse(captured.init.body).type, 0);
  assert.equal(JSON.parse(captured.init.body).state, '1');
  assert.equal(Object.hasOwn(JSON.parse(captured.init.body), 'condition'), false);
});

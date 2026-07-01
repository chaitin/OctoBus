import test from 'node:test';
import assert from 'node:assert/strict';

import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';

import { rpcdef } from '../src/zhizhangyi-mbs.js';

const ADD_USER = 'zhizhangyi.mbs.UserManagement/AddUser';
const DEL_USERS = 'zhizhangyi.mbs.UserManagement/DelUsers';
const GET_USERS = 'zhizhangyi.mbs.UserManagement/GetUsers';
const STATE_USERS = 'zhizhangyi.mbs.UserManagement/StateUsers';
const UPD_USER = 'zhizhangyi.mbs.UserManagement/UpdUser';

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

test('GetUsers preserves falsy state and is_mdm filters', async () => {
  let captured;
  globalThis.fetch = async (url, init) => {
    captured = { url, init };
    return { ok: true, status: 200, text: async () => '{"code":0,"data":{"total":0,"userInfos":[]}}' };
  };

  await rpcdef(buildCtx({ condition: { state: 0, is_mdm: 0 } }))[GET_USERS]();

  assert.equal(captured.url, 'https://mbs.example/uusafe/mos/thirdaccess/rest/opt/v1/getUsers');
  assert.deepEqual(JSON.parse(captured.init.body).condition, {
    deptId: '1',
    keyWord: '',
    state: 0,
    isMdm: 0,
  });
});

test('AddUser forwards caller-provided 3DES-encrypted password value', async () => {
  let captured;
  globalThis.fetch = async (url, init) => {
    captured = { url, init };
    return { ok: true, status: 200, text: async () => '{"code":0,"data":{"created":true}}' };
  };

  const result = await rpcdef(buildCtx({ user_name: 'User', login_name: 'user', dept_id: 'dept', password: '3des-ciphertext' }))[ADD_USER]();

  assert.equal(captured.url, 'https://mbs.example/uusafe/mos/thirdaccess/rest/opt/v1/addUser');
  assert.equal(JSON.parse(captured.init.body).password, '3des-ciphertext');
  assert.equal(result.data.structValue.fields.created.boolValue, true);
});

test('UpdUser requires dept_id before calling upstream', async () => {
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    return { ok: true, status: 200, text: async () => '{"code":0}' };
  };

  await assert.rejects(
    () => rpcdef(buildCtx({ user_id: 'user-1', user_name: 'User' }))[UPD_USER](),
    (err) => {
      assert.ok(err instanceof GrpcError);
      assert.equal(err.code, grpcStatus.INVALID_ARGUMENT);
      assert.equal(err.legacyCode, 'INVALID_ARGUMENT');
      assert.match(err.message, /dept_id required/);
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

test('DelUsers condition mode preserves falsy condition filters', async () => {
  let captured;
  globalThis.fetch = async (url, init) => {
    captured = { url, init };
    return { ok: true, status: 200, text: async () => '{"code":0,"data":null}' };
  };

  const result = await rpcdef(buildCtx({ type: 1, condition: { key_word: '', status: 0, is_mdm: 0, dept_id: 'dept' } }))[DEL_USERS]();

  assert.equal(captured.url, 'https://mbs.example/uusafe/mos/thirdaccess/rest/opt/v1/delUsers');
  assert.deepEqual(JSON.parse(captured.init.body).condition, {
    keyWord: '',
    status: 0,
    isMdm: 0,
    deptId: 'dept',
  });
  assert.deepEqual(result.data, { nullValue: 'NULL_VALUE' });
});

test('StateUsers condition mode preserves falsy condition filters', async () => {
  let captured;
  globalThis.fetch = async (url, init) => {
    captured = { url, init };
    return { ok: true, status: 200, text: async () => '{"code":0,"data":{"updated":2}}' };
  };

  const result = await rpcdef(buildCtx({ type: 1, state: '0', condition: { status: 0, is_mdm: 0 } }))[STATE_USERS]();

  assert.equal(captured.url, 'https://mbs.example/uusafe/mos/thirdaccess/rest/opt/v1/stateUsers');
  assert.equal(JSON.parse(captured.init.body).state, '0');
  assert.deepEqual(JSON.parse(captured.init.body).condition, {
    status: 0,
    isMdm: 0,
  });
  assert.equal(result.data.structValue.fields.updated.numberValue, 2);
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

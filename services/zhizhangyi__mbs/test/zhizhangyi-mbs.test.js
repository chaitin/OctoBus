import test from 'node:test';
import assert from 'node:assert/strict';

import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';

import { rpcdef } from '../src/zhizhangyi-mbs.js';

const ADD_USER = 'zhizhangyi.mbs.UserManagement/AddUser';
const DEL_USERS = 'zhizhangyi.mbs.UserManagement/DelUsers';
const GET_USERS = 'zhizhangyi.mbs.UserManagement/GetUsers';
const STATE_USERS = 'zhizhangyi.mbs.UserManagement/StateUsers';
const UPD_USER = 'zhizhangyi.mbs.UserManagement/UpdUser';
const UPD_USER_PWD = 'zhizhangyi.mbs.UserManagement/UpdUserPwd';

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

  await rpcdef(buildCtx({ condition: { dept_id: '1', state: 0, is_mdm: 0 } }))[GET_USERS]();

  assert.equal(captured.url, 'https://mbs.example/uusafe/mos/thirdaccess/rest/opt/v1/getUsers');
  assert.deepEqual(JSON.parse(captured.init.body).condition, {
    deptId: '1',
    keyWord: '',
    state: 0,
    isMdm: 0,
  });
});

test('GetUsers requires dept_id before calling upstream', async () => {
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    return { ok: true, status: 200, text: async () => '{"code":0}' };
  };

  await assert.rejects(
    () => rpcdef(buildCtx({ condition: { state: 1 } }))[GET_USERS](),
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

test('HTTP errors expose only a bounded upstream body summary', async () => {
  const body = 'x'.repeat(260);
  globalThis.fetch = async () => ({ ok: false, status: 500, text: async () => body });

  await assert.rejects(
    () => rpcdef(buildCtx({ condition: { dept_id: '1' } }))[GET_USERS](),
    (err) => {
      assert.ok(err instanceof GrpcError);
      assert.equal(err.code, grpcStatus.UNAVAILABLE);
      assert.match(err.message, /http 500: x{200}\.\.\./);
      assert.equal(err.message.includes('x'.repeat(220)), false);
      return true;
    },
  );
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

test('AddUser omits empty numeric fields instead of sending zero values', async () => {
  let captured;
  globalThis.fetch = async (url, init) => {
    captured = { url, init };
    return { ok: true, status: 200, text: async () => '{"code":0,"data":{}}' };
  };

  await rpcdef(buildCtx({ user_name: 'User', login_name: 'user', dept_id: 'dept', password: '3des-ciphertext', is_mdm: '', state: '', weight: '' }))[ADD_USER]();

  const body = JSON.parse(captured.init.body);
  assert.equal(Object.hasOwn(body, 'isMdm'), false);
  assert.equal(Object.hasOwn(body, 'state'), false);
  assert.equal(Object.hasOwn(body, 'weight'), false);
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

test('UpdUser omits empty numeric fields instead of sending zero values', async () => {
  let captured;
  globalThis.fetch = async (url, init) => {
    captured = { url, init };
    return { ok: true, status: 200, text: async () => '{"code":0,"data":{}}' };
  };

  await rpcdef(buildCtx({ user_id: 'user-1', user_name: 'User', dept_id: 'dept', is_mdm: '', weight: '' }))[UPD_USER]();

  const body = JSON.parse(captured.init.body);
  assert.equal(Object.hasOwn(body, 'isMdm'), false);
  assert.equal(Object.hasOwn(body, 'weight'), false);
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

test('UpdUserPwd rejects invalid version before calling upstream', async () => {
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    return { ok: true, status: 200, text: async () => '{"code":0}' };
  };

  await assert.rejects(
    () => rpcdef(buildCtx({ version: '../v1', user_id: 'user-1', password: '3des-ciphertext' }))[UPD_USER_PWD](),
    (err) => {
      assert.ok(err instanceof GrpcError);
      assert.equal(err.code, grpcStatus.INVALID_ARGUMENT);
      assert.equal(err.legacyCode, 'INVALID_ARGUMENT');
      assert.match(err.message, /version must be v1 or v2/);
      return true;
    },
  );

  assert.equal(called, false);
});

test('UpdUserPwd v1 requires user_id and password before calling upstream', async () => {
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    return { ok: true, status: 200, text: async () => '{"code":0}' };
  };

  await assert.rejects(
    () => rpcdef(buildCtx({ version: 'v1', password: '3des-ciphertext' }))[UPD_USER_PWD](),
    (err) => {
      assert.ok(err instanceof GrpcError);
      assert.equal(err.code, grpcStatus.INVALID_ARGUMENT);
      assert.match(err.message, /user_id required for v1/);
      return true;
    },
  );
  await assert.rejects(
    () => rpcdef(buildCtx({ version: 'v1', user_id: 'user-1' }))[UPD_USER_PWD](),
    (err) => {
      assert.ok(err instanceof GrpcError);
      assert.equal(err.code, grpcStatus.INVALID_ARGUMENT);
      assert.match(err.message, /password required as 3DES-encrypted value for v1/);
      return true;
    },
  );

  assert.equal(called, false);
});

test('UpdUserPwd v1 posts to v1 path with encrypted password', async () => {
  let captured;
  globalThis.fetch = async (url, init) => {
    captured = { url, init };
    return { ok: true, status: 200, text: async () => '{"code":0,"data":{}}' };
  };

  const result = await rpcdef(buildCtx({ version: 'v1', user_id: 'user-1', password: '3des-ciphertext' }))[UPD_USER_PWD]();

  assert.equal(captured.url, 'https://mbs.example/uusafe/mos/thirdaccess/rest/opt/v1/updUserPwd');
  assert.equal(JSON.parse(captured.init.body).userId, 'user-1');
  assert.equal(JSON.parse(captured.init.body).password, '3des-ciphertext');
  assert.deepEqual(result.data, { structValue: { fields: {} } });
});

test('UpdUserPwd v2 requires login_name and new_pwd before calling upstream', async () => {
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    return { ok: true, status: 200, text: async () => '{"code":0}' };
  };

  await assert.rejects(
    () => rpcdef(buildCtx({ version: 'v2', new_pwd: 'new-ciphertext' }))[UPD_USER_PWD](),
    (err) => {
      assert.ok(err instanceof GrpcError);
      assert.equal(err.code, grpcStatus.INVALID_ARGUMENT);
      assert.match(err.message, /login_name required for v2/);
      return true;
    },
  );
  await assert.rejects(
    () => rpcdef(buildCtx({ version: 'v2', login_name: 'user' }))[UPD_USER_PWD](),
    (err) => {
      assert.ok(err instanceof GrpcError);
      assert.equal(err.code, grpcStatus.INVALID_ARGUMENT);
      assert.match(err.message, /new_pwd required as 3DES-encrypted value for v2/);
      return true;
    },
  );

  assert.equal(called, false);
});

test('UpdUserPwd v2 posts to v2 path and forwards oldPwd', async () => {
  let captured;
  globalThis.fetch = async (url, init) => {
    captured = { url, init };
    return { ok: true, status: 200, text: async () => '{"code":0,"data":{"changed":true}}' };
  };

  const result = await rpcdef(buildCtx({ version: 'v2', login_name: 'user', old_pwd: 'old-ciphertext', new_pwd: 'new-ciphertext' }))[UPD_USER_PWD]();

  assert.equal(captured.url, 'https://mbs.example/uusafe/mos/thirdaccess/rest/opt/v2/updUserPwd');
  assert.equal(JSON.parse(captured.init.body).loginName, 'user');
  assert.equal(JSON.parse(captured.init.body).oldPwd, 'old-ciphertext');
  assert.equal(JSON.parse(captured.init.body).newPwd, 'new-ciphertext');
  assert.equal(result.data.structValue.fields.changed.boolValue, true);
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

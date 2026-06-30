import test from 'node:test';
import assert from 'node:assert/strict';

import {
  METHOD_DESCRIBE_MACHINE_GENERAL,
  _test,
  handlers,
} from '../src/tencent-cwp.js';

const buildCtx = (overrides = {}) => ({
  config: {
    endpoint: 'https://cwp.tencentcloudapi.com',
    region: 'ap-guangzhou',
    ...overrides.config,
  },
  secret: {
    secretId: 'AKIDEXAMPLE',
    secretKey: 'SECRET',
    ...overrides.secret,
  },
  bindings: overrides.bindings ?? {},
  limits: { timeoutMs: 10_000, ...overrides.limits },
  meta: { instance_id: 'inst-1', request_id: 'req-1', ...overrides.meta },
});

const mockJSON = (impl) => {
  global.fetch = async (url, init) => {
    const json = await impl(url, init);
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify(json),
    };
  };
};

test('buildAuthorization creates deterministic TC3 signature', () => {
  const payload = JSON.stringify({ Limit: 10, Offset: 0 });
  const signed = _test.buildAuthorization({
    secretId: 'AKIDEXAMPLE',
    secretKey: 'SECRET',
    host: 'cwp.tencentcloudapi.com',
    payload,
    timestamp: 1700000000,
  });

  assert.equal(signed.signature, '90e9aa36117ad9893d2029bd00a5067b5c763205bd8f018103b4c962b40223a6');
  assert.equal(
    signed.authorization,
    'TC3-HMAC-SHA256 Credential=AKIDEXAMPLE/2023-11-14/cwp/tc3_request, SignedHeaders=content-type;host, Signature=90e9aa36117ad9893d2029bd00a5067b5c763205bd8f018103b4c962b40223a6',
  );
});

test('DescribeMachineGeneral posts signed JSON and returns raw response object', async () => {
  let captured;
  mockJSON((url, init) => {
    captured = { url, init, body: JSON.parse(init.body) };
    return {
      Response: {
        RequestId: 'general-1',
        MachineCnt: 3,
        OnlineMachineCnt: 2,
      },
    };
  });

  const res = await handlers[METHOD_DESCRIBE_MACHINE_GENERAL]({
    params: { MachineRegion: 'all-regions' },
    offset: 0,
    limit: 0,
  }, buildCtx());

  assert.equal(captured.url, 'https://cwp.tencentcloudapi.com');
  assert.equal(captured.init.method, 'POST');
  assert.equal(captured.init.headers['X-TC-Action'], 'DescribeMachineGeneral');
  assert.equal(captured.init.headers['X-TC-Version'], '2018-02-28');
  assert.equal(captured.init.headers['X-TC-Region'], 'ap-guangzhou');
  assert.match(captured.init.headers.Authorization, /^TC3-HMAC-SHA256 Credential=AKIDEXAMPLE\//);
  assert.deepEqual(captured.body, { MachineRegion: 'all-regions' });
  assert.equal(res.action, 'DescribeMachineGeneral');
  assert.equal(res.request_id, 'general-1');
  assert.equal(res.response.MachineCnt, 3);
});

test('Tencent Cloud API errors and HTTP failures map to gRPC-style errors', async () => {
  mockJSON(() => ({
    Response: {
      Error: {
        Code: 'InvalidParameter.MissingParameter',
        Message: 'missing Limit',
      },
      RequestId: 'err-1',
    },
  }));

  await assert.rejects(
    () => handlers[METHOD_DESCRIBE_MACHINE_GENERAL]({}, buildCtx()),
    /INVALID_ARGUMENT: InvalidParameter.MissingParameter: missing Limit/,
  );

  global.fetch = async () => ({
    ok: false,
    status: 403,
    text: async () => 'forbidden',
  });
  await assert.rejects(
    () => handlers[METHOD_DESCRIBE_MACHINE_GENERAL]({}, buildCtx()),
    /UNAUTHENTICATED: upstream http 403: forbidden/,
  );
});

test('config aliases, temporary token, and Struct inputs are supported', async () => {
  let captured;
  mockJSON((url, init) => {
    captured = { url, init, body: JSON.parse(init.body) };
    return { Response: { RequestId: 'req-token', MachineCnt: 0 } };
  });

  await handlers[METHOD_DESCRIBE_MACHINE_GENERAL]({
    params: {
      fields: {
        Filters: {
          listValue: {
            values: [{
              structValue: {
                fields: {
                  Name: { stringValue: 'Risk' },
                  Values: { listValue: { values: [{ stringValue: 'yes' }] } },
                },
              },
            }],
          },
        },
      },
    },
  }, buildCtx({
    config: {
      host: 'https://cwp.tencentcloudapi.com/',
      headers: { 'X-Extra': 'demo' },
    },
    secret: {
      secret_id: 'SID',
      secret_key: 'SKEY',
      token: 'SESSION',
    },
  }));

  assert.equal(captured.url, 'https://cwp.tencentcloudapi.com');
  assert.equal(captured.init.headers['X-TC-Token'], 'SESSION');
  assert.equal(captured.init.headers['X-Extra'], 'demo');
  assert.equal(Object.hasOwn(captured.init, 'skipTlsVerify'), false);
  assert.equal(Object.hasOwn(captured.init, 'tlsInsecureSkipVerify'), false);
  assert.equal(Object.hasOwn(captured.init, 'insecureSkipVerify'), false);
  assert.deepEqual(captured.body, {
    Filters: [{ Name: 'Risk', Values: ['yes'] }],
  });
});

test('configuration validation rejects unsupported TLS bypass flags', async () => {
  await assert.rejects(
    () => handlers[METHOD_DESCRIBE_MACHINE_GENERAL]({}, buildCtx({ config: { skipTlsVerify: true } })),
    /TLS certificate verification bypass is not supported/,
  );
  await assert.rejects(
    () => handlers[METHOD_DESCRIBE_MACHINE_GENERAL]({}, buildCtx({ bindings: { tlsInsecureSkipVerify: true } })),
    /TLS certificate verification bypass is not supported/,
  );
  assert.throws(
    () => _test.assertSupportedTlsConfig({ insecureSkipVerify: 'yes' }),
    /TLS certificate verification bypass is not supported/,
  );
  assert.throws(
    () => _test.assertSupportedTlsConfig({ skipTlsVerify: false, tlsInsecureSkipVerify: true }),
    /TLS certificate verification bypass is not supported/,
  );
});

test('configuration validation rejects missing endpoint and credentials', async () => {
  await assert.rejects(
    () => handlers[METHOD_DESCRIBE_MACHINE_GENERAL]({}, buildCtx({ config: { endpoint: 'ftp://bad' } })),
    /endpoint\/host must include http or https/,
  );
  await assert.rejects(
    () => handlers[METHOD_DESCRIBE_MACHINE_GENERAL]({}, buildCtx({ secret: { secretId: '' } })),
    /secretId is required/,
  );
});

test('handler accepts OctoBus SDK single-argument context', async () => {
  let captured;
  mockJSON((url, init) => {
    captured = { url, init, body: JSON.parse(init.body) };
    return { Response: { RequestId: 'req-sdk', MachineCnt: 0 } };
  });

  await handlers[METHOD_DESCRIBE_MACHINE_GENERAL]({
    request: {
      params: { MachineRegion: 'all-regions' },
      limit: 5,
    },
    config: {
      endpoint: 'https://cwp.tencentcloudapi.com',
      region: 'ap-shanghai',
    },
    secret: {
      secretId: 'SDKID',
      secretKey: 'SDKKEY',
    },
    limits: { timeoutMs: 10_000 },
  });

  assert.equal(captured.url, 'https://cwp.tencentcloudapi.com');
  assert.equal(captured.init.headers['X-TC-Region'], 'ap-shanghai');
  assert.match(captured.init.headers.Authorization, /^TC3-HMAC-SHA256 Credential=SDKID\//);
  assert.deepEqual(captured.body, { MachineRegion: 'all-regions', Limit: 5 });
});

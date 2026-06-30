import test from 'node:test';
import assert from 'node:assert/strict';

import {
  METHOD_LIST_DSPA_CLUSTERS,
  _test,
  handlers,
} from '../src/tencent-dsgc.js';

const buildCtx = (overrides = {}) => ({
  config: {
    endpoint: 'https://dsgc.tencentcloudapi.com',
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

test('buildAuthorization creates deterministic TC3 signature for DSGC', () => {
  const payload = JSON.stringify({ Limit: 10, Offset: 0 });
  const signed = _test.buildAuthorization({
    secretId: 'AKIDEXAMPLE',
    secretKey: 'SECRET',
    host: 'dsgc.tencentcloudapi.com',
    payload,
    timestamp: 1700000000,
  });

  assert.equal(signed.signature, '2e2b726b627951b0a546952f7ee2a96ec2f5e26527fee930ccc35be39e8fcf03');
  assert.equal(
    signed.authorization,
    'TC3-HMAC-SHA256 Credential=AKIDEXAMPLE/2023-11-14/dsgc/tc3_request, SignedHeaders=content-type;host, Signature=2e2b726b627951b0a546952f7ee2a96ec2f5e26527fee930ccc35be39e8fcf03',
  );
});

test('ListDSPAClusters posts signed JSON, merges pagination, and extracts clusters', async () => {
  let captured;
  mockJSON((url, init) => {
    captured = { url, init, body: JSON.parse(init.body) };
    return {
      Response: {
        RequestId: 'cluster-1',
        TotalCount: 1,
        InstanceList: [{ DspaId: 'dspa-1', Name: 'cluster-a' }],
      },
    };
  });

  const res = await handlers[METHOD_LIST_DSPA_CLUSTERS]({ offset: 0, limit: 10 }, buildCtx());

  assert.equal(captured.url, 'https://dsgc.tencentcloudapi.com');
  assert.equal(captured.init.method, 'POST');
  assert.equal(captured.init.headers['X-TC-Action'], 'ListDSPAClusters');
  assert.equal(captured.init.headers['X-TC-Version'], '2019-07-23');
  assert.equal(captured.init.headers['X-TC-Region'], 'ap-guangzhou');
  assert.match(captured.init.headers.Authorization, /^TC3-HMAC-SHA256 Credential=AKIDEXAMPLE\//);
  assert.deepEqual(captured.body, { Offset: 0, Limit: 10 });
  assert.equal(res.action, 'ListDSPAClusters');
  assert.equal(res.request_id, 'cluster-1');
  assert.equal(res.total_count, 1);
  assert.equal(res.items[0].DspaId, 'dspa-1');
});

test('Tencent Cloud API errors and HTTP failures map to gRPC-style errors', async () => {
  mockJSON(() => ({
    Response: {
      Error: {
        Code: 'InvalidParameter.MissingParameter',
        Message: 'missing DspaId',
      },
      RequestId: 'err-1',
    },
  }));

  await assert.rejects(
    () => handlers[METHOD_LIST_DSPA_CLUSTERS]({}, buildCtx()),
    /INVALID_ARGUMENT: InvalidParameter.MissingParameter: missing DspaId/,
  );

  global.fetch = async () => ({
    ok: false,
    status: 403,
    text: async () => 'forbidden',
  });
  await assert.rejects(
    () => handlers[METHOD_LIST_DSPA_CLUSTERS]({}, buildCtx()),
    /UNAUTHENTICATED: upstream http 403: forbidden/,
  );
});

test('config aliases, language, temporary token, and Struct inputs are supported', async () => {
  let captured;
  mockJSON((url, init) => {
    captured = { url, init, body: JSON.parse(init.body) };
    return { Response: { RequestId: 'req-token', InstanceList: [] } };
  });

  await handlers[METHOD_LIST_DSPA_CLUSTERS]({
    params: {
      fields: {
        DspaId: { stringValue: 'dspa-1' },
        Filters: {
          listValue: {
            values: [{
              structValue: {
                fields: {
                  Name: { stringValue: 'Status' },
                  Values: { listValue: { values: [{ stringValue: 'running' }] } },
                },
              },
            }],
          },
        },
      },
    },
  }, buildCtx({
    config: {
      host: 'https://dsgc.tencentcloudapi.com/',
      language: 'zh-CN',
      headers: { 'X-Extra': 'demo' },
    },
    secret: {
      secret_id: 'SID',
      secret_key: 'SKEY',
      token: 'SESSION',
    },
  }));

  assert.equal(captured.url, 'https://dsgc.tencentcloudapi.com');
  assert.equal(captured.init.headers['X-TC-Token'], 'SESSION');
  assert.equal(captured.init.headers['X-TC-Language'], 'zh-CN');
  assert.equal(captured.init.headers['X-Extra'], 'demo');
  assert.deepEqual(captured.body, {
    DspaId: 'dspa-1',
    Filters: [{ Name: 'Status', Values: ['running'] }],
  });
});

test('configuration validation rejects unsupported TLS bypass flags', async () => {
  await assert.rejects(
    () => handlers[METHOD_LIST_DSPA_CLUSTERS]({}, buildCtx({ config: { skipTlsVerify: true } })),
    /TLS certificate verification bypass is not supported/,
  );
  await assert.rejects(
    () => handlers[METHOD_LIST_DSPA_CLUSTERS]({}, buildCtx({ bindings: { tlsInsecureSkipVerify: true } })),
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
    () => handlers[METHOD_LIST_DSPA_CLUSTERS]({}, buildCtx({ config: { endpoint: 'ftp://bad' } })),
    /endpoint\/host must include http or https/,
  );
  await assert.rejects(
    () => handlers[METHOD_LIST_DSPA_CLUSTERS]({}, buildCtx({ secret: { secretId: '' } })),
    /secretId is required/,
  );
});

test('handler accepts OctoBus SDK single-argument context', async () => {
  let captured;
  mockJSON((url, init) => {
    captured = { url, init, body: JSON.parse(init.body) };
    return { Response: { RequestId: 'req-sdk', InstanceList: [] } };
  });

  await handlers[METHOD_LIST_DSPA_CLUSTERS]({
    request: {
      params: { DspaId: 'dspa-1' },
      limit: 5,
    },
    config: {
      endpoint: 'https://dsgc.tencentcloudapi.com',
      region: 'ap-shanghai',
    },
    secret: {
      secretId: 'SDKID',
      secretKey: 'SDKKEY',
    },
    limits: { timeoutMs: 10_000 },
  });

  assert.equal(captured.url, 'https://dsgc.tencentcloudapi.com');
  assert.equal(captured.init.headers['X-TC-Region'], 'ap-shanghai');
  assert.match(captured.init.headers.Authorization, /^TC3-HMAC-SHA256 Credential=SDKID\//);
  assert.deepEqual(captured.body, { DspaId: 'dspa-1', Limit: 5 });
});

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  METHOD_DESCRIBE_BASELINE_DETECT_OVERVIEW,
  METHOD_DESCRIBE_MACHINES,
  METHOD_DESCRIBE_MACHINE_RISK_CNT,
  METHOD_DESCRIBE_MALWARE_LIST,
  METHOD_DESCRIBE_VUL_LIST,
  METHOD_INVOKE_READ_ONLY_ACTION,
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

test('DescribeMachines posts signed JSON and maps list response', async () => {
  let captured;
  mockJSON((url, init) => {
    captured = { url, init, body: JSON.parse(init.body) };
    return {
      Response: {
        RequestId: 'req-tc-1',
        TotalCount: 2,
        Machines: [
          { MachineName: 'host-a', MachineIp: '10.0.0.1' },
          { MachineName: 'host-b', MachineIp: '10.0.0.2' },
        ],
      },
    };
  });

  const res = await handlers[METHOD_DESCRIBE_MACHINES]({
    params: {
      MachineRegion: 'all-regions',
      MachineType: 'CVM',
      Filters: [{ Name: 'AgentStatus', Values: ['ONLINE'] }],
    },
    offset: 0,
    limit: 10,
  }, buildCtx());

  assert.equal(captured.url, 'https://cwp.tencentcloudapi.com');
  assert.equal(captured.init.method, 'POST');
  assert.equal(captured.init.headers['X-TC-Action'], 'DescribeMachines');
  assert.equal(captured.init.headers['X-TC-Version'], '2018-02-28');
  assert.equal(captured.init.headers['X-TC-Region'], 'ap-guangzhou');
  assert.match(captured.init.headers.Authorization, /^TC3-HMAC-SHA256 Credential=AKIDEXAMPLE\//);
  assert.deepEqual(captured.body, {
    MachineRegion: 'all-regions',
    MachineType: 'CVM',
    Filters: [{ Name: 'AgentStatus', Values: ['ONLINE'] }],
    Offset: 0,
    Limit: 10,
  });
  assert.equal(res.action, 'DescribeMachines');
  assert.equal(res.request_id, 'req-tc-1');
  assert.equal(res.total_count, 2);
  assert.equal(res.items[0].MachineName, 'host-a');
});

test('common list methods use action-specific item arrays', async () => {
  mockJSON((url, init) => {
    assert.equal(init.headers['X-TC-Action'], 'DescribeMalWareList');
    return {
      Response: {
        RequestId: 'malware-1',
        TotalCount: 1,
        MalWareList: [{ Id: 7, FilePath: '/tmp/demo' }],
      },
    };
  });
  const malware = await handlers[METHOD_DESCRIBE_MALWARE_LIST]({}, buildCtx());
  assert.equal(malware.total_count, 1);
  assert.equal(malware.items[0].Id, 7);

  mockJSON((url, init) => {
    assert.equal(init.headers['X-TC-Action'], 'DescribeVulList');
    return {
      Response: {
        RequestId: 'vul-1',
        TotalCount: 1,
        VulInfoList: [{ VulName: 'CVE demo', Level: 3 }],
      },
    };
  });
  const vul = await handlers[METHOD_DESCRIBE_VUL_LIST]({}, buildCtx());
  assert.equal(vul.items[0].VulName, 'CVE demo');
});

test('non-list action returns raw response object', async () => {
  mockJSON((url, init) => {
    assert.equal(init.headers['X-TC-Action'], 'DescribeMachineRiskCnt');
    return {
      Response: {
        RequestId: 'risk-1',
        HostLogin: 1,
        BruteAttack: 2,
        Malware: 3,
      },
    };
  });

  const res = await handlers[METHOD_DESCRIBE_MACHINE_RISK_CNT]({}, buildCtx());
  assert.equal(res.request_id, 'risk-1');
  assert.equal(res.response.HostLogin, 1);
  assert.equal(res.response.Malware, 3);
});

test('DescribeBaselineDetectOverview is exposed as a read-only baseline overview method', async () => {
  mockJSON((url, init) => {
    assert.equal(init.headers['X-TC-Action'], 'DescribeBaselineDetectOverview');
    return {
      Response: {
        RequestId: 'baseline-1',
        HostCount: 3,
        DetectingCount: 0,
      },
    };
  });

  const res = await handlers[METHOD_DESCRIBE_BASELINE_DETECT_OVERVIEW]({}, buildCtx());
  assert.equal(res.request_id, 'baseline-1');
  assert.equal(res.response.HostCount, 3);
});

test('InvokeReadOnlyAction enforces Describe action allow list', async () => {
  mockJSON((url, init) => {
    assert.equal(init.headers['X-TC-Action'], 'DescribeAssetAppList');
    assert.deepEqual(JSON.parse(init.body), { Limit: 5 });
    return { Response: { RequestId: 'asset-apps-1', Apps: [] } };
  });

  const res = await handlers[METHOD_INVOKE_READ_ONLY_ACTION]({
    action: 'DescribeAssetAppList',
    params: { Limit: 5 },
  }, buildCtx());
  assert.equal(res.action, 'DescribeAssetAppList');

  await assert.rejects(
    () => handlers[METHOD_INVOKE_READ_ONLY_ACTION]({ action: 'DeleteMalwares', params: {} }, buildCtx()),
    /InvokeReadOnlyAction only allows Describe\* actions/,
  );
  await assert.rejects(
    () => handlers[METHOD_INVOKE_READ_ONLY_ACTION]({ action: 'DescribeAESKey', params: {} }, buildCtx()),
    /DescribeAESKey is not allowed/,
  );
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
    () => handlers[METHOD_DESCRIBE_MACHINES]({}, buildCtx()),
    /INVALID_ARGUMENT: InvalidParameter.MissingParameter: missing Limit/,
  );

  global.fetch = async () => ({
    ok: false,
    status: 403,
    text: async () => 'forbidden',
  });
  await assert.rejects(
    () => handlers[METHOD_DESCRIBE_MACHINES]({}, buildCtx()),
    /UNAUTHENTICATED: upstream http 403: forbidden/,
  );
});

test('config aliases, temporary token, and Struct inputs are supported', async () => {
  let captured;
  mockJSON((url, init) => {
    captured = { url, init, body: JSON.parse(init.body) };
    return { Response: { RequestId: 'req-token', TotalCount: 0, Machines: [] } };
  });

  await handlers[METHOD_DESCRIBE_MACHINES]({
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
    () => handlers[METHOD_DESCRIBE_MACHINES]({}, buildCtx({ config: { skipTlsVerify: true } })),
    /TLS certificate verification bypass is not supported/,
  );
  await assert.rejects(
    () => handlers[METHOD_DESCRIBE_MACHINES]({}, buildCtx({ bindings: { tlsInsecureSkipVerify: true } })),
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
    () => handlers[METHOD_DESCRIBE_MACHINES]({}, buildCtx({ config: { endpoint: 'ftp://bad' } })),
    /endpoint\/host must include http or https/,
  );
  await assert.rejects(
    () => handlers[METHOD_DESCRIBE_MACHINES]({}, buildCtx({ secret: { secretId: '' } })),
    /secretId is required/,
  );
});

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  METHOD_DESCRIBE_ASSET_OVERVIEW,
  METHOD_DESCRIBE_DSPA_ASSESSMENT_LATEST_RISK_LIST,
  METHOD_DESCRIBE_DSPA_COS_DATA_ASSET_BUCKETS,
  METHOD_DESCRIBE_DSPA_RDB_DATA_ASSET_BY_COMPLIANCE_ID,
  METHOD_INVOKE_READ_ONLY_ACTION,
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

test('DescribeAssetOverview posts signed JSON and returns raw response', async () => {
  let captured;
  mockJSON((url, init) => {
    captured = { url, init, body: JSON.parse(init.body) };
    return {
      Response: {
        RequestId: 'req-dsgc-1',
        DBCount: 3,
        COSCount: 2,
      },
    };
  });

  const res = await handlers[METHOD_DESCRIBE_ASSET_OVERVIEW]({
    params: {
      DspaId: 'dspa-abcd',
    },
  }, buildCtx());

  assert.equal(captured.url, 'https://dsgc.tencentcloudapi.com');
  assert.equal(captured.init.method, 'POST');
  assert.equal(captured.init.headers['X-TC-Action'], 'DescribeAssetOverview');
  assert.equal(captured.init.headers['X-TC-Version'], '2019-07-23');
  assert.equal(captured.init.headers['X-TC-Region'], 'ap-guangzhou');
  assert.match(captured.init.headers.Authorization, /^TC3-HMAC-SHA256 Credential=AKIDEXAMPLE\//);
  assert.deepEqual(captured.body, { DspaId: 'dspa-abcd' });
  assert.equal(res.action, 'DescribeAssetOverview');
  assert.equal(res.request_id, 'req-dsgc-1');
  assert.equal(res.response.DBCount, 3);
  assert.equal(res.response.COSCount, 2);
});

test('list methods merge pagination and extract action-specific arrays', async () => {
  mockJSON((url, init) => {
    assert.equal(init.headers['X-TC-Action'], 'ListDSPAClusters');
    assert.deepEqual(JSON.parse(init.body), { Offset: 0, Limit: 10 });
    return {
      Response: {
        RequestId: 'clusters-1',
        TotalCount: 1,
        InstanceList: [{ DspaId: 'dspa-abcd', Name: 'demo' }],
      },
    };
  });
  const clusters = await handlers[METHOD_LIST_DSPA_CLUSTERS]({ offset: 0, limit: 10 }, buildCtx());
  assert.equal(clusters.total_count, 1);
  assert.equal(clusters.items[0].DspaId, 'dspa-abcd');

  mockJSON((url, init) => {
    assert.equal(init.headers['X-TC-Action'], 'DescribeDSPACOSDataAssetBuckets');
    return {
      Response: {
        RequestId: 'cos-1',
        TotalCount: 1,
        BucketList: [{ BucketName: 'bucket-a' }],
      },
    };
  });
  const cos = await handlers[METHOD_DESCRIBE_DSPA_COS_DATA_ASSET_BUCKETS]({}, buildCtx());
  assert.equal(cos.items[0].BucketName, 'bucket-a');
});

test('risk and asset list methods preserve fallback list arrays', async () => {
  mockJSON((url, init) => {
    assert.equal(init.headers['X-TC-Action'], 'DescribeDSPARDBDataAssetByComplianceId');
    return {
      Response: {
        RequestId: 'rdb-1',
        TotalCount: 1,
        AssetList: [{ DbName: 'mysql-demo' }],
      },
    };
  });
  const rdb = await handlers[METHOD_DESCRIBE_DSPA_RDB_DATA_ASSET_BY_COMPLIANCE_ID]({}, buildCtx());
  assert.equal(rdb.items[0].DbName, 'mysql-demo');

  mockJSON((url, init) => {
    assert.equal(init.headers['X-TC-Action'], 'DescribeDSPAAssessmentLatestRiskList');
    return {
      Response: {
        RequestId: 'risk-1',
        Total: 1,
        RiskList: [{ RiskName: 'public bucket' }],
      },
    };
  });
  const risk = await handlers[METHOD_DESCRIBE_DSPA_ASSESSMENT_LATEST_RISK_LIST]({}, buildCtx());
  assert.equal(risk.total_count, 1);
  assert.equal(risk.items[0].RiskName, 'public bucket');
});

test('InvokeReadOnlyAction enforces read-only action allow list', async () => {
  mockJSON((url, init) => {
    assert.equal(init.headers['X-TC-Action'], 'DescribeDSPAComplianceGroups');
    assert.deepEqual(JSON.parse(init.body), { DspaId: 'dspa-abcd' });
    return { Response: { RequestId: 'compliance-groups-1', Items: [] } };
  });

  const res = await handlers[METHOD_INVOKE_READ_ONLY_ACTION]({
    action: 'DescribeDSPAComplianceGroups',
    params: { DspaId: 'dspa-abcd' },
  }, buildCtx());
  assert.equal(res.action, 'DescribeDSPAComplianceGroups');

  await assert.rejects(
    () => handlers[METHOD_INVOKE_READ_ONLY_ACTION]({ action: 'CreateDSPADiscoveryTask', params: {} }, buildCtx()),
    /InvokeReadOnlyAction only allows Describe\*, List\*, or Get\* actions/,
  );
  await assert.rejects(
    () => handlers[METHOD_INVOKE_READ_ONLY_ACTION]({ action: 'DescribeReportTaskDownloadUrl', params: {} }, buildCtx()),
    /DescribeReportTaskDownloadUrl is not allowed/,
  );
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
    () => handlers[METHOD_DESCRIBE_ASSET_OVERVIEW]({}, buildCtx()),
    /INVALID_ARGUMENT: InvalidParameter.MissingParameter: missing DspaId/,
  );

  global.fetch = async () => ({
    ok: false,
    status: 403,
    text: async () => 'forbidden',
  });
  await assert.rejects(
    () => handlers[METHOD_DESCRIBE_ASSET_OVERVIEW]({}, buildCtx()),
    /UNAUTHENTICATED: upstream http 403: forbidden/,
  );
});

test('config aliases, language, temporary token, and Struct inputs are supported', async () => {
  let captured;
  mockJSON((url, init) => {
    captured = { url, init, body: JSON.parse(init.body) };
    return { Response: { RequestId: 'req-token', TotalCount: 0, Items: [] } };
  });

  await handlers[METHOD_LIST_DSPA_CLUSTERS]({
    params: {
      fields: {
        Filters: {
          listValue: {
            values: [{
              structValue: {
                fields: {
                  Name: { stringValue: 'DspaId' },
                  Values: { listValue: { values: [{ stringValue: 'dspa-abcd' }] } },
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
  assert.equal(Object.hasOwn(captured.init, 'skipTlsVerify'), false);
  assert.equal(Object.hasOwn(captured.init, 'tlsInsecureSkipVerify'), false);
  assert.equal(Object.hasOwn(captured.init, 'insecureSkipVerify'), false);
  assert.deepEqual(captured.body, {
    Filters: [{ Name: 'DspaId', Values: ['dspa-abcd'] }],
  });
});

test('configuration validation rejects unsupported TLS bypass flags', async () => {
  await assert.rejects(
    () => handlers[METHOD_DESCRIBE_ASSET_OVERVIEW]({}, buildCtx({ config: { skipTlsVerify: true } })),
    /TLS certificate verification bypass is not supported/,
  );
  await assert.rejects(
    () => handlers[METHOD_DESCRIBE_ASSET_OVERVIEW]({}, buildCtx({ bindings: { tlsInsecureSkipVerify: true } })),
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
    () => handlers[METHOD_DESCRIBE_ASSET_OVERVIEW]({}, buildCtx({ config: { endpoint: 'ftp://bad' } })),
    /endpoint\/host must include http or https/,
  );
  await assert.rejects(
    () => handlers[METHOD_DESCRIBE_ASSET_OVERVIEW]({}, buildCtx({ secret: { secretId: '' } })),
    /secretId is required/,
  );
});

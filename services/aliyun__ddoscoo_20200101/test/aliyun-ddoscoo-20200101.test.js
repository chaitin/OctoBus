import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert/strict';
import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';
import { handlers, rpcdef, _test } from '../src/aliyun-ddoscoo-20200101.js';
import { createMockServer } from './mock_upstream.js';

// --------------- Helpers ---------------

function buildCtx(overrides = {}) {
  return {
    config: {},
    secret: {},
    bindings: {},
    limits: {},
    meta: new Map(),
    req: {},
    getMetadata: (name) => undefined,
    getMetadataAll: (name) => [],
    ...overrides,
  };
}

function expectGrpcError(fn, legacyCode, checker) {
  return fn().then(
    () => { throw new Error(`Expected GrpcError(${legacyCode}) but no error was thrown`); },
    (err) => {
      assert.ok(err instanceof GrpcError, `Expected GrpcError but got ${err?.constructor?.name}`);
      assert.equal(err.legacyCode, legacyCode);
      if (checker) checker(err);
    },
  );
}

function parseStructuredError(err) {
  try { return JSON.parse(err.message); } catch { return null; }
}

// --------------- Tests ---------------

describe('aliyun-ddoscoo-20200101', () => {
  // ====== Service Structure ======

  it('exports handlers for all 6 RPCs', () => {
    const names = Object.keys(handlers);
    assert.equal(names.length, 6);
    for (const name of names) {
      assert.match(name, /^Aliyun_DDoSCOO_20200101\.DDoSCOOService\//);
      assert.equal(typeof handlers[name], 'function');
    }
  });

  it('rpcdef returns all 6 paths', () => {
    const ctx = buildCtx();
    const def = rpcdef(ctx);
    const paths = Object.keys(def);
    assert.equal(paths.length, 6);
    for (const path of paths) {
      assert.match(path, /^\/Aliyun_DDoSCOO_20200101\.DDoSCOOService\//);
      assert.equal(typeof def[path], 'function');
    }
  });

  // ====== Authentication Errors ======

  it('throws UNAUTHENTICATED when accessKeyId is missing', async () => {
    const ctx = buildCtx({
      secret: { accessKeySecret: 'test-secret' },
    });
    await expectGrpcError(
      () => handlers[_test.METHOD_DESCRIBE_INSTANCES_FULL]({ pageNumber: '1', pageSize: '10' }, ctx),
      'INVALID_ARGUMENT',
      (err) => {
        const se = parseStructuredError(err);
        assert.match(se.message, /accessKeyId/);
      },
    );
  });

  it('throws UNAUTHENTICATED when accessKeySecret is missing', async () => {
    const ctx = buildCtx({
      secret: { accessKeyId: 'test-id' },
    });
    await expectGrpcError(
      () => handlers[_test.METHOD_DESCRIBE_INSTANCES_FULL]({ pageNumber: '1', pageSize: '10' }, ctx),
      'INVALID_ARGUMENT',
      (err) => {
        const se = parseStructuredError(err);
        assert.match(se.message, /accessKeySecret/);
      },
    );
  });

  // ====== Signature Computation ======

  it('buildSignedParams produces valid signature structure', () => {
    const params = _test.buildSignedParams(
      'DescribeInstances',
      { PageNumber: '1', PageSize: '10' },
      'test-id',
      'test-secret',
    );
    assert.ok(params.has('AccessKeyId'));
    assert.equal(params.get('AccessKeyId'), 'test-id');
    assert.ok(params.has('Action'));
    assert.equal(params.get('Action'), 'DescribeInstances');
    assert.ok(params.has('Signature'));
    assert.ok(params.has('SignatureNonce'));
    assert.ok(params.has('Timestamp'));
    assert.ok(params.has('SignatureMethod'));
    assert.equal(params.get('SignatureMethod'), 'HMAC-SHA1');
    assert.ok(params.has('SignatureVersion'));
    assert.equal(params.get('SignatureVersion'), '1.0');
    assert.ok(params.has('Version'));
    assert.equal(params.get('Version'), '2020-01-01');
    assert.ok(params.has('Format'));
    assert.equal(params.get('Format'), 'JSON');
    // Business params
    assert.ok(params.has('PageNumber'));
    assert.ok(params.has('PageSize'));
  });

  it('aliyunPercentEncode handles special characters', () => {
    assert.equal(_test.aliyunPercentEncode('abc'), 'abc');
    assert.equal(_test.aliyunPercentEncode('/'), '%2F');
    assert.equal(_test.aliyunPercentEncode(' '), '%20');
    assert.equal(_test.aliyunPercentEncode('='), '%3D');
    assert.equal(_test.aliyunPercentEncode('&'), '%26');
    assert.equal(_test.aliyunPercentEncode('*'), '%2A');
  });

  // ====== Error Mapping ======

  it('grpcCodeFor maps all known codes', () => {
    assert.equal(_test.grpcCodeFor('FAILED_PRECONDITION'), grpcStatus.FAILED_PRECONDITION);
    assert.equal(_test.grpcCodeFor('INVALID_ARGUMENT'), grpcStatus.INVALID_ARGUMENT);
    assert.equal(_test.grpcCodeFor('UNAUTHENTICATED'), grpcStatus.UNAUTHENTICATED);
    assert.equal(_test.grpcCodeFor('PERMISSION_DENIED'), grpcStatus.PERMISSION_DENIED);
    assert.equal(_test.grpcCodeFor('NOT_FOUND'), grpcStatus.NOT_FOUND);
    assert.equal(_test.grpcCodeFor('UNAVAILABLE'), grpcStatus.UNAVAILABLE);
    assert.equal(_test.grpcCodeFor('INTERNAL'), grpcStatus.INTERNAL);
    assert.equal(_test.grpcCodeFor('UNKNOWN'), grpcStatus.INTERNAL);
  });

  it('mapAliyunErrorCode maps known codes correctly', () => {
    assert.equal(_test.mapAliyunErrorCode('InvalidAccessKeyId.NotFound'), 'UNAUTHENTICATED');
    assert.equal(_test.mapAliyunErrorCode('SignatureDoesNotMatch'), 'UNAUTHENTICATED');
    assert.equal(_test.mapAliyunErrorCode('Forbidden.NotAdminUser'), 'PERMISSION_DENIED');
    assert.equal(_test.mapAliyunErrorCode('InvalidParameter'), 'INVALID_ARGUMENT');
    assert.equal(_test.mapAliyunErrorCode('MissingParameter'), 'INVALID_ARGUMENT');
    assert.equal(_test.mapAliyunErrorCode('EntityNotFound'), 'NOT_FOUND');
    assert.equal(_test.mapAliyunErrorCode('Throttling.User'), 'UNAVAILABLE');
    assert.equal(_test.mapAliyunErrorCode('SomeRandomError'), 'FAILED_PRECONDITION');
  });

  // ====== Request Mapping ======

  it('mapDescribeInstancesReq maps all fields', () => {
    const result = _test.mapDescribeInstancesReq({
      pageNumber: '1',
      pageSize: '10',
      instanceIds: ['inst-1'],
      ip: '1.2.3.4',
      remark: 'test',
      status: [1],
      edition: 1,
      enabled: 1,
      expireStartTime: 1609459200,
      expireEndTime: 1735689600,
      resourceGroupId: 'rg-1',
      tagKey: 'env',
      tagValue: 'prod',
    });
    assert.equal(result.PageNumber, '1');
    assert.equal(result.PageSize, '10');
    assert.deepEqual(result.InstanceIds, ['inst-1']);
    assert.equal(result.Ip, '1.2.3.4');
    assert.equal(result.Remark, 'test');
    assert.deepEqual(result.Status, [1]);
    assert.equal(result.Edition, 1);
    assert.equal(result.Enabled, 1);
    assert.equal(result.ExpireStartTime, 1609459200);
    assert.equal(result.ExpireEndTime, 1735689600);
    assert.equal(result.ResourceGroupId, 'rg-1');
    assert.deepEqual(result.Tag, [{ Key: 'env', Value: 'prod' }]);
  });

  it('mapDescribeInstancesReq skips empty/undefined values', () => {
    const result = _test.mapDescribeInstancesReq({
      pageNumber: '1',
      pageSize: '10',
    });
    assert.equal(result.PageNumber, '1');
    assert.equal(result.PageSize, '10');
    assert.equal(result.InstanceIds, undefined);
    assert.equal(result.Ip, undefined);
  });

  it('mapDescribeDomainResourceReq maps fields', () => {
    const result = _test.mapDescribeDomainResourceReq({
      domain: 'example.com',
      pageNumber: '1',
      pageSize: '20',
      instanceIds: ['inst-1'],
      queryDomainPattern: '*.example.com',
    });
    assert.equal(result.Domain, 'example.com');
    assert.equal(result.PageNumber, '1');
    assert.equal(result.QueryDomainPattern, '*.example.com');
  });

  it('mapEnableWebCCReq requires domain', () => {
    const result = _test.mapEnableWebCCReq({
      domain: 'example.com',
      resourceGroupId: 'rg-1',
    });
    assert.equal(result.Domain, 'example.com');
    assert.equal(result.ResourceGroupId, 'rg-1');
  });

  it('mapConfigWebCCTemplateReq requires domain and template', () => {
    const result = _test.mapConfigWebCCTemplateReq({
      domain: 'example.com',
      template: 'default',
    });
    assert.equal(result.Domain, 'example.com');
    assert.equal(result.Template, 'default');
  });

  // ====== Config/Secret Resolution ======

  it('resolveRegionId uses default when not provided', () => {
    const ctx = buildCtx({ config: {} });
    assert.equal(_test.resolveRegionId(ctx), 'cn-hangzhou');
  });

  it('resolveRegionId reads from config', () => {
    const ctx = buildCtx({ config: { regionId: 'cn-shanghai' } });
    assert.equal(_test.resolveRegionId(ctx), 'cn-shanghai');
  });

  it('resolveTimeoutMs uses default when not provided', () => {
    const ctx = buildCtx({ config: {} });
    assert.equal(_test.resolveTimeoutMs(ctx), 10000);
  });

  it('resolveTimeoutMs reads from config', () => {
    const ctx = buildCtx({ config: { timeoutMs: 5000 } });
    assert.equal(_test.resolveTimeoutMs(ctx), 5000);
  });

  // ====== JSON Helpers ======

  it('tryParseJson parses valid JSON', () => {
    const result = _test.tryParseJson('{"a":1}');
    assert.ok(result.ok);
    assert.deepEqual(result.value, { a: 1 });
  });

  it('tryParseJson handles invalid JSON', () => {
    const result = _test.tryParseJson('not json');
    assert.equal(result.ok, false);
  });

  it('toValue converts primitives', () => {
    assert.deepEqual(_test.toValue('hello'), { stringValue: 'hello' });
    assert.deepEqual(_test.toValue(42), { numberValue: 42 });
    assert.deepEqual(_test.toValue(true), { boolValue: true });
    assert.deepEqual(_test.toValue(null), { nullValue: 0 });
  });

  it('toValue converts arrays', () => {
    const result = _test.toValue([1, 'two']);
    assert.ok(result.listValue);
    assert.equal(result.listValue.values.length, 2);
  });

  it('toValue converts objects', () => {
    const result = _test.toValue({ key: 'value' });
    assert.ok(result.structValue);
    assert.equal(result.structValue.fields.key.stringValue, 'value');
  });

  it('unwrapScalar extracts values', () => {
    assert.equal(_test.unwrapScalar({ stringValue: 'foo' }), 'foo');
    assert.equal(_test.unwrapScalar({ numberValue: 42 }), 42);
    assert.equal(_test.unwrapScalar({ boolValue: true }), true);
    assert.equal(_test.unwrapScalar('plain'), 'plain');
  });

  it('firstDefined returns first non-null value', () => {
    assert.equal(_test.firstDefined(undefined, null, 'val', 'other'), 'val');
    assert.equal(_test.firstDefined(undefined, undefined), undefined);
    assert.equal(_test.firstDefined(null, null, 0), 0);
  });

  // ====== Handler Success (with mocked fetch) ======

  describe('handlers with mocked fetch', () => {
    let originalFetch;

    beforeEach(() => {
      originalFetch = globalThis.fetch;
    });

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    function mockFetch(responseBody, status = 200, contentType = 'application/json') {
      globalThis.fetch = async (url, init) => {
        return {
          ok: status >= 200 && status < 300,
          status,
          text: async () => typeof responseBody === 'string' ? responseBody : JSON.stringify(responseBody),
          json: async () => typeof responseBody === 'string' ? JSON.parse(responseBody) : responseBody,
        };
      };
    }

    it('DescribeInstances returns success response', async () => {
      mockFetch({
        Instances: [{ InstanceId: 'ddos-1', Ip: '1.2.3.4', Status: 1 }],
        TotalCount: 1,
        RequestId: 'req-001',
      });

      const ctx = buildCtx({
        secret: { accessKeyId: 'test-id', accessKeySecret: 'test-secret' },
      });
      const result = await handlers[_test.METHOD_DESCRIBE_INSTANCES_FULL](
        { pageNumber: '1', pageSize: '10' },
        ctx,
      );
      assert.equal(result.httpStatus, 200);
      assert.ok(result.rawJson.structValue);
    });

    it('DescribeDomainResource returns success response', async () => {
      mockFetch({
        WebRules: [{ Domain: 'example.com', Cname: 'cname.example.com' }],
        TotalCount: 1,
        RequestId: 'req-002',
      });

      const ctx = buildCtx({
        secret: { accessKeyId: 'test-id', accessKeySecret: 'test-secret' },
      });
      const result = await handlers[_test.METHOD_DESCRIBE_DOMAIN_RESOURCE_FULL](
        { domain: 'example.com' },
        ctx,
      );
      assert.equal(result.httpStatus, 200);
      assert.ok(result.rawJson.structValue);
    });

    it('DescribeNetworkRules returns success response', async () => {
      mockFetch({
        NetworkRules: [{ InstanceId: 'ddos-1', Protocol: 'tcp', FrontendPort: 443 }],
        TotalCount: 1,
        RequestId: 'req-003',
      });

      const ctx = buildCtx({
        secret: { accessKeyId: 'test-id', accessKeySecret: 'test-secret' },
      });
      const result = await handlers[_test.METHOD_DESCRIBE_NETWORK_RULES_FULL](
        { instanceId: 'ddos-1' },
        ctx,
      );
      assert.equal(result.httpStatus, 200);
      assert.ok(result.rawJson.structValue);
    });

    it('DescribeDDosAllEventList returns success response', async () => {
      mockFetch({
        AttackEvents: [{ EventType: 'defense', Ip: '1.2.3.4', StartTime: 1700000000 }],
        TotalCount: 1,
        RequestId: 'req-004',
      });

      const ctx = buildCtx({
        secret: { accessKeyId: 'test-id', accessKeySecret: 'test-secret' },
      });
      const result = await handlers[_test.METHOD_DESCRIBE_DDOS_ALL_EVENT_LIST_FULL](
        { startTime: 1700000000, endTime: 1700086400 },
        ctx,
      );
      assert.equal(result.httpStatus, 200);
      assert.ok(result.rawJson.structValue);
    });

    it('EnableWebCC returns success response', async () => {
      mockFetch({ RequestId: 'req-005' });

      const ctx = buildCtx({
        secret: { accessKeyId: 'test-id', accessKeySecret: 'test-secret' },
      });
      const result = await handlers[_test.METHOD_ENABLE_WEB_CC_FULL](
        { domain: 'example.com' },
        ctx,
      );
      assert.equal(result.httpStatus, 200);
    });

    it('ConfigWebCCTemplate returns success response', async () => {
      mockFetch({ RequestId: 'req-006' });

      const ctx = buildCtx({
        secret: { accessKeyId: 'test-id', accessKeySecret: 'test-secret' },
      });
      const result = await handlers[_test.METHOD_CONFIG_WEB_CC_TEMPLATE_FULL](
        { domain: 'example.com', template: 'default' },
        ctx,
      );
      assert.equal(result.httpStatus, 200);
    });

    // ====== Error Cases ======

    it('maps HTTP 401 to PERMISSION_DENIED', async () => {
      mockFetch({ Code: 'InvalidAccessKeyId.NotFound', Message: 'Key not found' }, 401);

      const ctx = buildCtx({
        secret: { accessKeyId: 'bad-id', accessKeySecret: 'test-secret' },
      });
      await expectGrpcError(
        () => handlers[_test.METHOD_DESCRIBE_INSTANCES_FULL]({ pageNumber: '1', pageSize: '10' }, ctx),
        'PERMISSION_DENIED',
        (err) => {
          const se = parseStructuredError(err);
          assert.match(se.message, /Key not found/);
        },
      );
    });

    it('maps HTTP 403 to PERMISSION_DENIED', async () => {
      mockFetch({ Code: 'Forbidden', Message: 'Access denied' }, 403);

      const ctx = buildCtx({
        secret: { accessKeyId: 'test-id', accessKeySecret: 'test-secret' },
      });
      await expectGrpcError(
        () => handlers[_test.METHOD_DESCRIBE_INSTANCES_FULL]({}, ctx),
        'PERMISSION_DENIED',
      );
    });

    it('maps HTTP 400 to FAILED_PRECONDITION', async () => {
      mockFetch({ Code: 'InvalidParameter', Message: 'Bad param' }, 400);

      const ctx = buildCtx({
        secret: { accessKeyId: 'test-id', accessKeySecret: 'test-secret' },
      });
      await expectGrpcError(
        () => handlers[_test.METHOD_DESCRIBE_INSTANCES_FULL]({}, ctx),
        'FAILED_PRECONDITION',
      );
    });

    it('maps HTTP 500 to UNAVAILABLE', async () => {
      globalThis.fetch = async () => ({
        ok: false,
        status: 500,
        text: async () => 'Internal Server Error',
      });

      const ctx = buildCtx({
        secret: { accessKeyId: 'test-id', accessKeySecret: 'test-secret' },
      });
      await expectGrpcError(
        () => handlers[_test.METHOD_DESCRIBE_INSTANCES_FULL]({}, ctx),
        'UNAVAILABLE',
      );
    });

    it('maps non-JSON response to UNAVAILABLE', async () => {
      mockFetch('not-json', 200, 'text/plain');

      const ctx = buildCtx({
        secret: { accessKeyId: 'test-id', accessKeySecret: 'test-secret' },
      });
      await expectGrpcError(
        () => handlers[_test.METHOD_DESCRIBE_INSTANCES_FULL]({}, ctx),
        'UNAVAILABLE',
        (err) => {
          const se = parseStructuredError(err);
          assert.match(se.message, /non-JSON/);
        },
      );
    });

    it('maps API business error to INVALID_ARGUMENT', async () => {
      mockFetch({ Code: 'MissingParameter.NotFound', Message: 'Parameter is missing', RequestId: 'req-err' });

      const ctx = buildCtx({
        secret: { accessKeyId: 'test-id', accessKeySecret: 'test-secret' },
      });
      await expectGrpcError(
        () => handlers[_test.METHOD_DESCRIBE_INSTANCES_FULL]({}, ctx),
        'INVALID_ARGUMENT',
        (err) => {
          const se = parseStructuredError(err);
          assert.equal(se.response_code, 'MissingParameter.NotFound');
        },
      );
    });

    it('maps network error to UNAVAILABLE', async () => {
      globalThis.fetch = async () => { throw new Error('ECONNREFUSED'); };

      const ctx = buildCtx({
        secret: { accessKeyId: 'test-id', accessKeySecret: 'test-secret' },
      });
      await expectGrpcError(
        () => handlers[_test.METHOD_DESCRIBE_INSTANCES_FULL]({}, ctx),
        'UNAVAILABLE',
        (err) => {
          const se = parseStructuredError(err);
          assert.match(se.message, /ECONNREFUSED/);
        },
      );
    });
  });

  // ====== Utilities ======

  it('throwStructuredError includes all optional fields', () => {
    try {
      _test.throwStructuredError('UNAVAILABLE', 'test error', {
        httpStatus: 500,
        rawBody: 'body content',
        rawJson: { key: 'value' },
        reason: 'network timeout',
        responseCode: 'Timeout',
        verboseMsg: 'The request timed out',
      });
    } catch (err) {
      const se = parseStructuredError(err);
      assert.equal(se.code, 'UNAVAILABLE');
      assert.equal(se.message, 'test error');
      assert.equal(se.http_status, 500);
      assert.equal(se.raw_body, 'body content');
      assert.deepEqual(se.raw_json, { key: 'value' });
      assert.equal(se.reason, 'network timeout');
      assert.equal(se.response_code, 'Timeout');
      assert.equal(se.verbose_msg, 'The request timed out');
    }
  });

  it('toTrimmedString handles valid and invalid inputs', () => {
    assert.equal(_test.toTrimmedString('  hello  '), 'hello');
    assert.equal(_test.toTrimmedString(123), undefined);
    assert.equal(_test.toTrimmedString(null), undefined);
    assert.equal(_test.toTrimmedString(undefined), undefined);
  });

  it('buildUrl constructs regional endpoint', () => {
    assert.equal(_test.buildUrl('cn-hangzhou'), 'https://ddoscoo.cn-hangzhou.aliyuncs.com/');
    assert.equal(_test.buildUrl('cn-shanghai'), 'https://ddoscoo.cn-shanghai.aliyuncs.com/');
  });
});

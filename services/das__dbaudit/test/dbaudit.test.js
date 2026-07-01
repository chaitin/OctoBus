import test from 'node:test';
import assert from 'node:assert/strict';
import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';

import {
  METHOD_CREATE_IP_FILTER_FULL,
  METHOD_CREATE_IP_FILTER_PATH,
  METHOD_GET_SYSTEM_RESOURCE_FULL,
  METHOD_GET_SYSTEM_RESOURCE_PATH,
  METHOD_LIST_IP_FILTERS_FULL,
  METHOD_LIST_IP_FILTERS_PATH,
  METHOD_QUERY_SYSTEM_RESOURCE_HISTORY_FULL,
  METHOD_QUERY_SYSTEM_RESOURCE_HISTORY_PATH,
  _test,
  handlers,
  rpcdef,
} from '../src/dbaudit.js';
import { service } from '../src/service.js';

const originalFetch = globalThis.fetch;

const fixedNow = () => new Date(2026, 5, 28, 12, 30, 0, 0).getTime();

const buildCtx = (overrides = {}) => ({
  config: {
    baseUrl: 'https://db.example.com/',
    regionId: 'cn',
    ...(overrides.config || {}),
  },
  secret: {
    accessKeyId: 'ak',
    accessKeySecret: 'secret',
    ...(overrides.secret || {}),
  },
  bindings: overrides.bindings || {},
  req: overrides.req || {},
  now: overrides.now || fixedNow,
});

const jsonResponse = (body) => ({
  status: 200,
  async text() {
    return JSON.stringify(body);
  },
});

test.afterEach(() => {
  globalThis.fetch = originalFetch;
});

test('unified service exports IP filter and system resource handlers', () => {
  assert.ok(service);
  assert.equal(typeof handlers[METHOD_LIST_IP_FILTERS_FULL], 'function');
  assert.equal(typeof handlers[METHOD_CREATE_IP_FILTER_FULL], 'function');
  assert.equal(typeof handlers[METHOD_GET_SYSTEM_RESOURCE_FULL], 'function');
  assert.equal(typeof handlers[METHOD_QUERY_SYSTEM_RESOURCE_HISTORY_FULL], 'function');
  assert.equal(typeof rpcdef(buildCtx())[METHOD_LIST_IP_FILTERS_PATH], 'function');
  assert.equal(typeof rpcdef(buildCtx())[METHOD_CREATE_IP_FILTER_PATH], 'function');
  assert.equal(typeof rpcdef(buildCtx())[METHOD_GET_SYSTEM_RESOURCE_PATH], 'function');
  assert.equal(typeof rpcdef(buildCtx())[METHOD_QUERY_SYSTEM_RESOURCE_HISTORY_PATH], 'function');
});

test('buildListIPFiltersData maps aliases and defaults', () => {
  assert.deepEqual(_test.buildListIPFiltersData({}), {
    CurrentPage: 1,
    PageSize: 10,
    Name: '',
    IpFilterList: '',
    InstanceId: '',
  });
  assert.deepEqual(_test.buildListIPFiltersData({
    name: { value: ' allow ' },
    ipFilterList: '1.1.1.1/24',
    currentPage: '2',
    page_size: 50,
    instanceId: 'asset-1',
  }), {
    CurrentPage: 2,
    PageSize: 50,
    Name: 'allow',
    IpFilterList: '1.1.1.1/24',
    InstanceId: 'asset-1',
  });
});

test('buildCreateIPFilterData validates required fields', () => {
  assert.deepEqual(_test.buildCreateIPFilterData({
    name: 'office',
    ip_filter_list: '10.0.0.0/8',
  }), {
    Name: 'office',
    IpFilterList: '10.0.0.0/8',
    InstanceId: '',
  });

  assert.throws(
    () => _test.buildCreateIPFilterData({ ip_filter_list: '10.0.0.0/8' }),
    (err) => err instanceof GrpcError && err.code === grpcStatus.INVALID_ARGUMENT && /name is required/.test(err.message),
  );
  assert.throws(
    () => _test.buildCreateIPFilterData({ name: 'office' }),
    (err) => err instanceof GrpcError && err.code === grpcStatus.INVALID_ARGUMENT && /ip_filter_list is required/.test(err.message),
  );
});

test('ListIPFilters calls DescribeSipFilter with query data and maps response', async () => {
  let seenUrl;
  let seenInit;
  globalThis.fetch = async (url, init) => {
    seenUrl = url;
    seenInit = init;
    return jsonResponse({
      success: true,
      code: '200',
      data: {
        list: [
          { Id: 11, Name: 'office', IpFilterList: '10.0.0.0/8', UserId: null },
          { IpFilterId: '12', IpFilterName: 'lab', IpFilterList: '192.168.0.0/16', UserId: 'u1' },
        ],
        totalCount: 2,
      },
      requestId: 'upstream-req',
    });
  };

  const result = await rpcdef(buildCtx({
    req: {
      name: 'office',
      ip_filter_list: '10.0.0.0/8',
      current_page: 1,
      page_size: 20,
    },
  }))[METHOD_LIST_IP_FILTERS_PATH]();

  const url = new URL(seenUrl);
  assert.equal(url.origin + url.pathname, 'https://db.example.com/openapi/dbaudit/2.0/DescribeSipFilter.json');
  assert.equal(seenInit.method, 'GET');
  assert.deepEqual(JSON.parse(url.searchParams.get('data')), {
    CurrentPage: 1,
    PageSize: 20,
    Name: 'office',
    IpFilterList: '10.0.0.0/8',
    InstanceId: '',
  });
  assert.equal(url.searchParams.get('accessKeyId'), 'ak');
  assert.ok(url.searchParams.get('accessTime'));
  assert.ok(url.searchParams.get('accessSign'));
  assert.deepEqual(result.filters, [
    { id: 11, name: 'office', ip_filter_list: '10.0.0.0/8', user_id: '' },
    { id: 12, name: 'lab', ip_filter_list: '192.168.0.0/16', user_id: 'u1' },
  ]);
  assert.equal(result.total_count, 2);
  assert.equal(result.raw.requestId, 'upstream-req');
});

test('CreateIPFilter calls CreateSipFilter with form data and maps response', async () => {
  let seenUrl;
  let seenInit;
  globalThis.fetch = async (url, init) => {
    seenUrl = url;
    seenInit = init;
    return jsonResponse({
      code: '200',
      message: 'success',
      success: true,
      data: {
        IpFilterId: 11,
        IpFilterName: 'test',
        IpFilterList: '1.1.1.1/24',
        UserId: null,
      },
      requestId: '796a759f-2e17-44de-8bc6-5a46a8b0cab1',
    });
  };

  const result = await handlers[METHOD_CREATE_IP_FILTER_FULL](buildCtx({
    req: {
      name: 'test',
      ip_filter_list: '1.1.1.1/24',
      instance_id: '',
    },
  }));

  assert.equal(seenUrl, 'https://db.example.com/openapi/dbaudit/2.0/CreateSipFilter.json');
  assert.equal(seenInit.method, 'POST');
  assert.equal(seenInit.headers['Content-Type'], 'application/x-www-form-urlencoded');
  assert.ok(seenInit.body instanceof URLSearchParams);
  assert.deepEqual(JSON.parse(seenInit.body.get('data')), {
    Name: 'test',
    IpFilterList: '1.1.1.1/24',
    InstanceId: '',
  });
  assert.deepEqual(result, {
    ip_filter_id: 11,
    ip_filter_name: 'test',
    ip_filter_list: '1.1.1.1/24',
    user_id: '',
    raw: result.raw,
  });
  assert.equal(result.raw.requestId, '796a759f-2e17-44de-8bc6-5a46a8b0cab1');
});

test('resolveTimeRange handles relative, calendar, custom, and realtime presets', () => {
  const now = fixedNow();
  assert.deepEqual(_test.resolveTimeRange({ time_preset: 'last_1h' }, fixedNow), {
    preset: 'last_1h',
    startTime: now - 60 * 60 * 1000,
    endTime: now,
    interval: '1m',
  });
  assert.equal(_test.resolveTimeRange({ time_preset: 'last_6h' }, fixedNow).interval, '5m');
  assert.equal(_test.resolveTimeRange({ time_preset: 'last_7d' }, fixedNow).startTime, now - 7 * 24 * 60 * 60 * 1000);
  assert.equal(_test.resolveTimeRange({ time_preset: 'today' }, fixedNow).startTime, _test.startOfLocalDay(now));
  assert.equal(_test.resolveTimeRange({ time_preset: 'this_week' }, fixedNow).startTime, _test.startOfLocalWeek(now));
  assert.equal(_test.resolveTimeRange({ time_preset: 'this_month' }, fixedNow).startTime, _test.startOfLocalMonth(now));
  assert.deepEqual(_test.resolveTimeRange({ time_preset: 'custom', start_time: 1000, end_time: 2000, interval: '30s' }, fixedNow), {
    preset: 'custom',
    startTime: 1000,
    endTime: 2000,
    interval: '30s',
  });
  assert.deepEqual(_test.resolveTimeRange({ time_preset: 'realtime' }, fixedNow), {
    preset: 'realtime',
    startTime: 0,
    endTime: 0,
    interval: '',
  });
  assert.throws(
    () => _test.resolveTimeRange({ time_preset: 'custom', start_time: 0, end_time: 2000 }, fixedNow),
    (err) => err instanceof GrpcError && err.code === grpcStatus.INVALID_ARGUMENT && /start_time and end_time/.test(err.message),
  );
  assert.throws(() => _test.resolveTimeRange({ time_preset: 'future' }, fixedNow), /unsupported time_preset/);
});

test('buildHistoryData maps scope, realtime, and required resource type', () => {
  assert.deepEqual(_test.buildHistoryData({
    resource_type: 'system_cpu_usage',
    time_preset: 'last_1h',
    query_scope: 'one',
    instance_id: 'asset-1',
  }, fixedNow), {
    action: 'GetOneSystemResourceByTimeRange',
    data: {
      StartTime: fixedNow() - 60 * 60 * 1000,
      EndTime: fixedNow(),
      Interval: '1m',
      ResourceType: 'system_cpu_usage',
      InstanceId: 'asset-1',
    },
    scope: 'one',
    realtime: false,
  });
  assert.deepEqual(_test.buildHistoryData({
    resource_type: 'system_cpu_usage',
    time_preset: 'realtime',
    instance_id: 'asset-1',
  }, fixedNow), {
    action: 'getSystemResource',
    data: { InstanceId: 'asset-1' },
    scope: 'all',
    realtime: true,
  });
  assert.throws(() => _test.buildHistoryData({ time_preset: 'last_1h' }, fixedNow), /resource_type is required/);
  assert.throws(() => _test.buildHistoryData({ resource_type: 'system_cpu_usage', query_scope: 'bad' }, fixedNow), /unsupported query_scope/);
});

test('GetSystemResource calls current resource endpoint and returns raw response', async () => {
  let seenUrl;
  globalThis.fetch = async (url) => {
    seenUrl = url;
    return jsonResponse({ success: true, code: '200', data: { cpu: 10 } });
  };

  const result = await handlers[METHOD_GET_SYSTEM_RESOURCE_FULL](buildCtx({ req: { instance_id: 'asset-1' } }));

  const url = new URL(seenUrl);
  assert.equal(url.origin + url.pathname, 'https://db.example.com/openapi/dbaudit/2.0/getSystemResource.json');
  assert.deepEqual(JSON.parse(url.searchParams.get('data')), { InstanceId: 'asset-1' });
  assert.deepEqual(result.raw.data, { cpu: 10 });
});

test('QuerySystemResourceHistory calls history endpoints and maps records', async () => {
  const seen = [];
  globalThis.fetch = async (url, init) => {
    seen.push({ url, init });
    return jsonResponse({
      success: true,
      code: '200',
      data: {
        list: [
          { time: '1710000000000', type: 'system_cpu_usage', avg: '10.5', max: '20.25', tags: ['host:a'] },
          { Time: 1710000060000, Type: 'system_memory_usage', Avg: 30, Max: 40, Tags: 'host:b, role:db' },
        ],
      },
    });
  };

  const result = await rpcdef(buildCtx({
    req: {
      resource_type: 'system_cpu_usage',
      time_preset: 'last_6h',
      query_scope: 'all',
    },
  }))[METHOD_QUERY_SYSTEM_RESOURCE_HISTORY_PATH]();
  await handlers[METHOD_QUERY_SYSTEM_RESOURCE_HISTORY_FULL](buildCtx({
    req: {
      resource_type: 'disk_io_read',
      time_preset: 'custom',
      start_time: 1000,
      end_time: 2000,
      query_scope: 'one',
    },
  }));
  await handlers[METHOD_QUERY_SYSTEM_RESOURCE_HISTORY_FULL](buildCtx({
    req: {
      resource_type: 'disk_io_read',
      time_preset: 'realtime',
    },
  }));

  const url = new URL(seen[0].url);
  assert.equal(url.origin + url.pathname, 'https://db.example.com/openapi/dbaudit/2.0/GetAllSystemResourceByTimeRange.json');
  assert.equal(seen[0].init.method, 'GET');
  assert.deepEqual(JSON.parse(url.searchParams.get('data')), {
    StartTime: fixedNow() - 6 * 60 * 60 * 1000,
    EndTime: fixedNow(),
    Interval: '5m',
    ResourceType: 'system_cpu_usage',
    InstanceId: '',
  });
  assert.deepEqual(result.records, [
    { time: 1710000000000, type: 'system_cpu_usage', avg: 10.5, max: 20.25, tags: ['host:a'] },
    { time: 1710000060000, type: 'system_memory_usage', avg: 30, max: 40, tags: ['host:b', 'role:db'] },
  ]);
  assert.equal(new URL(seen[1].url).pathname, '/openapi/dbaudit/2.0/GetOneSystemResourceByTimeRange.json');
  assert.equal(new URL(seen[2].url).pathname, '/openapi/dbaudit/2.0/getSystemResource.json');
});

test('upstream failures propagate through shared OpenAPI helper', async () => {
  globalThis.fetch = async () => jsonResponse({ success: false, code: '400', message: 'bad request' });

  await assert.rejects(
    handlers[METHOD_CREATE_IP_FILTER_FULL](buildCtx({ req: { name: 'test', ip_filter_list: '1.1.1.1/24' } })),
    (err) => err instanceof GrpcError && err.code === grpcStatus.FAILED_PRECONDITION && /bad request/.test(err.message),
  );
});

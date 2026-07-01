import assert from 'node:assert';
import { _test as t, handlers, rpcdef } from '../src/dsensor.js';

assert.strictEqual(t.unwrapScalar(undefined), undefined);
assert.strictEqual(t.unwrapScalar(null), undefined);
assert.strictEqual(t.unwrapScalar('hello'), 'hello');
assert.strictEqual(t.unwrapScalar(42), 42);
assert.strictEqual(t.unwrapScalar({ value: 'wrapped' }), 'wrapped');
assert.strictEqual(t.unwrapScalar({ value: { value: 'deep' } }), 'deep');

assert.strictEqual(t.unwrapString(undefined), '');
assert.strictEqual(t.unwrapString(null), '');
assert.strictEqual(t.unwrapString('hello'), 'hello');
assert.strictEqual(t.unwrapString(42), '42');

assert.strictEqual(t.normalizeBaseUrl(''), '');
assert.strictEqual(t.normalizeBaseUrl('not-a-url'), '');
assert.strictEqual(t.normalizeBaseUrl('http://example.com/'), 'http://example.com');
assert.strictEqual(t.normalizeBaseUrl('https://api.dsensor.local'), 'https://api.dsensor.local');

assert.strictEqual(t.firstDefined(undefined, null, 'found'), 'found');
assert.strictEqual(t.firstDefined('first', 'second'), 'first');

assert.deepStrictEqual(t.mergedBindings({}), {});
assert.deepStrictEqual(t.mergedBindings({ config: { a: 1 }, secret: { b: 2 } }), { a: 1, b: 2 });

assert.deepStrictEqual(t.toValue(null), { nullValue: 'NULL_VALUE' });
assert.deepStrictEqual(t.toValue('str'), { stringValue: 'str' });
assert.deepStrictEqual(t.toValue(42), { numberValue: 42 });
assert.deepStrictEqual(t.toValue(true), { boolValue: true });
assert.deepStrictEqual(t.toValue([1, 2]), { listValue: { values: [{ numberValue: 1 }, { numberValue: 2 }] } });

assert.strictEqual(t.API_REGISTRY.length, 25, 'Should have 25 registered methods');

const paths = t.API_REGISTRY.map((entry) => entry.path);
assert.strictEqual(new Set(paths).size, paths.length, 'API paths should be unique');

for (const entry of t.API_REGISTRY) {
  assert.ok(t.API_PATHS[entry.method], `Missing API path for ${entry.method}`);
  assert.strictEqual(t.API_PATHS[entry.method], entry.path);
}

assert.ok(t.API_PATHS['dsensor.dsensor_agent_change_type/query_dsensor_agent_change_type']);
assert.ok(t.API_PATHS['dsensor.dsensor_agent_portmap_update/query_dsensor_agent_portmap_update']);
assert.ok(t.API_PATHS['dsensor.dsensor_agent_scan_update/query_dsensor_agent_scan_update']);

assert.deepStrictEqual(
  JSON.parse(t.buildRequestPayload('dsensor.dsensor_agent_clear_service/query_dsensor_agent_clear_service', {
    sns: ['sn-001', 'sn-002'],
  })),
  { sns: ['sn-001', 'sn-002'] },
  'clear_service should forward sns directly',
);

assert.deepStrictEqual(
  JSON.parse(t.buildRequestPayload('dsensor.dsensor_honeypot_create/query_dsensor_honeypot_create', {
    nid: 'nid-1',
    displayName: 'hp',
    image: 'wiki',
    imageId: 'sha256:abc',
    node: '',
    preset: {
      copyPreset: '',
      meta: {
        portraitOption: 'open',
        __name__: '',
      },
    },
  })),
  {
    nid: 'nid-1',
    display_name: 'hp',
    image: 'wiki',
    image_id: 'sha256:abc',
    preset: {
      meta: {
        portrait_option: 'open',
      },
    },
  },
  'honeypot_create should keep object preset and strip empty strings',
);

assert.deepStrictEqual(
  JSON.parse(t.buildRequestPayload('dsensor.dsensor_honeypot_reset/query_dsensor_honeypot_reset', {
    cid: 'cid-1',
    preset: {
      copyPreset: '',
      meta: {
        certName: 'demo',
      },
    },
  })),
  {
    cid: 'cid-1',
    preset: {
      meta: {
        cert_name: 'demo',
      },
    },
  },
  'honeypot_reset should support structured preset payloads',
);

assert.strictEqual(
  t.buildRequestPayload('dsensor.dsensor_honeypot_delete/query_dsensor_honeypot_delete', { cid: 'cid-1' }),
  '',
  'honeypot_delete should not send a request body',
);

assert.strictEqual(
  t.buildRequestUrl('https://dsensor.local', 'dsensor.dsensor_honeypot_delete/query_dsensor_honeypot_delete', { cid: 'cid-1' }),
  'https://dsensor.local/api/honey/pot/delete?cid=cid-1',
  'honeypot_delete should encode cid as query string',
);

assert.strictEqual(
  t.buildRequestUrl('https://dsensor.local', 'dsensor.dsensor_agent_list/query_dsensor_agent_list', {}),
  'https://dsensor.local/api/agent/list',
);

const handlerKeys = Object.keys(handlers);
assert.strictEqual(handlerKeys.length, 25, 'Should have 25 handlers');
for (const entry of t.API_REGISTRY) {
  assert.ok(handlers[entry.method], `Missing handler for ${entry.method}`);
}

const routes = rpcdef({});
const routeKeys = Object.keys(routes);
assert.strictEqual(routeKeys.length, 25, 'rpcdef should expose 25 routes');
for (const key of routeKeys) {
  assert.strictEqual(typeof routes[key], 'function', `${key} should be a function`);
}

const err = t.errorWithCode('INVALID_ARGUMENT', 'test error');
assert.ok(err.legacyCode === 'INVALID_ARGUMENT', 'errorWithCode should set legacyCode');
assert.ok(err.message.includes('INVALID_ARGUMENT'), 'error message should include code');

console.log('✅ All tests passed —', handlerKeys.length, 'handlers,', routeKeys.length, 'routes');

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CREATE_FIREWALL_RULE_PATH,
  CREATE_FIREWALL_RULES_PATH,
  DELETE_FIREWALL_RULE_PATH,
  DELETE_FIREWALL_RULES_PATH,
  DISABLE_FIREWALL_RULE_PATH,
  ENABLE_FIREWALL_RULE_PATH,
  LIST_FIREWALL_RULES_PATH,
  MODIFY_FIREWALL_RULE_PATH,
  _test,
  rpcdef,
} from '../src/alibaba-cloud-simple-application-server-firewall.js';
import { service } from '../src/service.js';
import { MockSWASClient, createMockContext } from './mock_upstream.js';

const buildCtx = (overrides = {}) => ({
  bindings: {
    regionId: 'cn-beijing',
    instanceId: 'i-test',
    accessKeyId: 'ak',
    accessKeySecret: 'sk',
    endpoint: 'swas.cn-hangzhou.aliyuncs.com',
    ...(overrides.bindings || {}),
  },
  config: overrides.config || {},
  secret: overrides.secret || {},
  limits: overrides.limits || {},
  meta: overrides.meta || {},
  req: overrides.req || {},
});

test('service exports handlers', () => {
  assert.equal(typeof service.handlers, 'object');
  assert.ok(service.handlers['AlibabaCloud_SWAS_Firewall.SimpleApplicationServerFirewallService/CreateFirewallRule']);
});

test('normalizes and validates firewall rule input', () => {
  assert.deepEqual(_test.normalizeRuleInput({
    rule_protocol: 'tcp',
    port: '39080',
    source_cidr_ip: '203.0.113.10/32',
    remark: 'test',
  }), {
    ruleProtocol: 'TCP',
    port: '39080',
    sourceCidrIp: '203.0.113.10/32',
    remark: 'test',
  });
  assert.equal(_test.requirePort('-1', 'ICMP'), '-1/-1');
  assert.throws(() => _test.normalizeRuleProtocol('GRE'), /rule_protocol must be/);
  assert.throws(() => _test.requirePort('0', 'TCP'), /between 1 and 65535/);
});

test('CreateFirewallRule requires credentials and rule fields before calling upstream', async () => {
  await assert.rejects(
    () => rpcdef(buildCtx({ bindings: { accessKeyId: '' }, req: { ruleProtocol: 'TCP', port: '39080' } }))[CREATE_FIREWALL_RULE_PATH](),
    /accessKeyId is required/,
  );
  await assert.rejects(
    () => rpcdef(buildCtx({ req: { ruleProtocol: 'TCP' } }))[CREATE_FIREWALL_RULE_PATH](),
    /port is required/,
  );
});

test('ListFirewallRules validates pagination and required scope', async () => {
  await assert.rejects(
    () => rpcdef(buildCtx({ bindings: { regionId: '' }, req: {} }))[LIST_FIREWALL_RULES_PATH](),
    /region_id is required/,
  );
  await assert.rejects(
    () => rpcdef(buildCtx({ req: { pageSize: -1 } }))[LIST_FIREWALL_RULES_PATH](),
    /page_size must be a positive integer/,
  );
});

test('Modify/Delete/Enable/Disable require rule ID', async () => {
  for (const path of [
    MODIFY_FIREWALL_RULE_PATH,
    DELETE_FIREWALL_RULE_PATH,
    ENABLE_FIREWALL_RULE_PATH,
    DISABLE_FIREWALL_RULE_PATH,
  ]) {
    await assert.rejects(
      () => rpcdef(buildCtx({ req: path === MODIFY_FIREWALL_RULE_PATH ? { ruleProtocol: 'TCP', port: '39080' } : {} }))[path](),
      /rule_id is required/,
    );
  }
});

test('DeleteFirewallRules requires non-empty rule IDs', async () => {
  await assert.rejects(
    () => rpcdef(buildCtx({ req: { ruleIds: [] } }))[DELETE_FIREWALL_RULES_PATH](),
    /rule_ids must contain at least one/,
  );
});

test('CreateFirewallRules requires at least one rule', async () => {
  await assert.rejects(
    () => rpcdef(buildCtx({ req: { firewallRules: [] } }))[CREATE_FIREWALL_RULES_PATH](),
    /firewall_rules must contain at least one/,
  );
});

test('normalizes listed firewall rules from mixed SDK field names', () => {
  const rule = _test.normalizeFirewallRule({
    FirewallRuleId: 'rule-1',
    RuleProtocol: 'TCP',
    Port: '39080',
    SourceCidrIp: '203.0.113.10/32',
    Remark: 'test',
    Status: 'Available',
    Tags: [{ Key: 'env', Value: 'test' }],
  });

  assert.equal(rule.firewall_rule_id, 'rule-1');
  assert.equal(rule.rule_protocol, 'TCP');
  assert.equal(rule.source_cidr_ip, '203.0.113.10/32');
  assert.deepEqual(rule.tags, [{ key: 'env', value: 'test' }]);
  assert.equal(rule.raw_json.structValue.fields.FirewallRuleId.stringValue, 'rule-1');
});

test('CreateFirewallRule maps request through batch create API with source CIDR', async () => {
  const { client, ctx } = createMockContext({
    req: {
      ruleProtocol: 'TCP',
      port: '39080',
      sourceCidrIp: '203.0.113.10/32',
      remark: 'mock rule',
      clientToken: 'mock-token',
    },
  });

  const result = await rpcdef(ctx)[CREATE_FIREWALL_RULE_PATH]();

  assert.equal(result.success, true);
  assert.equal(result.firewall_rule_id, 'mock-rule-1');
  assert.equal(client.lastCall().method, 'createFirewallRulesWithOptions');
  assert.equal(client.lastCall().request.regionId, 'cn-beijing');
  assert.equal(client.lastCall().request.instanceId, 'mock-instance');
  assert.equal(client.lastCall().request.clientToken, 'mock-token');
  assert.equal(client.lastCall().request.firewallRules[0].ruleProtocol, 'TCP');
  assert.equal(client.lastCall().request.firewallRules[0].port, '39080');
  assert.equal(client.lastCall().request.firewallRules[0].sourceCidrIp, '203.0.113.10/32');
  assert.equal(client.lastCall().runtime.readTimeout, 12_000);
});

test('CreateFirewallRules maps multiple rules and tags', async () => {
  const { client, ctx } = createMockContext({
    responses: {
      createFirewallRulesWithOptions: {
        body: {
          requestId: 'mock-create-rules-request',
          firewallRuleIds: ['mock-rule-1', 'mock-rule-2'],
        },
      },
    },
    req: {
      firewallRules: [
        { ruleProtocol: 'TCP', port: '39080', sourceCidrIp: '203.0.113.10/32', remark: 'rule 1' },
        { ruleProtocol: 'UDP', port: '39081', sourceCidrIp: '203.0.113.11/32', remark: 'rule 2' },
      ],
      tags: [{ key: 'purpose', value: 'octobus-test' }],
    },
  });

  const result = await rpcdef(ctx)[CREATE_FIREWALL_RULES_PATH]();

  assert.deepEqual(result.firewall_rule_ids, ['mock-rule-1', 'mock-rule-2']);
  assert.equal(client.lastCall().request.firewallRules.length, 2);
  assert.deepEqual(client.lastCall().request.tag.map((tag) => ({ key: tag.key, value: tag.value })), [{ key: 'purpose', value: 'octobus-test' }]);
});

test('ListFirewallRules maps pagination, rule ID, and response fields', async () => {
  const { client, ctx } = createMockContext({
    req: {
      firewallRuleId: 'mock-rule-1',
      pageNumber: 1,
      pageSize: 100,
    },
  });

  const result = await rpcdef(ctx)[LIST_FIREWALL_RULES_PATH]();

  assert.equal(client.lastCall().method, 'listFirewallRulesWithOptions');
  assert.equal(client.lastCall().request.firewallRuleId, 'mock-rule-1');
  assert.equal(client.lastCall().request.pageSize, 100);
  assert.equal(result.request_id, 'mock-list-request');
  assert.equal(result.firewall_rules[0].firewall_rule_id, 'mock-rule-1');
  assert.equal(result.firewall_rules[0].source_cidr_ip, '203.0.113.10/32');
});

test('Modify/Enable/Disable/Delete map rule ID and fields', async () => {
  const modify = createMockContext({
    req: {
      ruleId: 'mock-rule-1',
      ruleProtocol: 'TCP',
      port: '39081',
      sourceCidrIp: '203.0.113.10/32',
      remark: 'updated',
    },
  });
  await rpcdef(modify.ctx)[MODIFY_FIREWALL_RULE_PATH]();
  assert.equal(modify.client.lastCall().request.ruleId, 'mock-rule-1');
  assert.equal(modify.client.lastCall().request.port, '39081');

  const disable = createMockContext({ req: { ruleId: 'mock-rule-1', remark: 'disabled' } });
  await rpcdef(disable.ctx)[DISABLE_FIREWALL_RULE_PATH]();
  assert.equal(disable.client.lastCall().method, 'disableFirewallRuleWithOptions');
  assert.equal(disable.client.lastCall().request.ruleId, 'mock-rule-1');

  const enable = createMockContext({ req: { ruleId: 'mock-rule-1', sourceCidrIp: '203.0.113.10/32', remark: 'enabled' } });
  await rpcdef(enable.ctx)[ENABLE_FIREWALL_RULE_PATH]();
  assert.equal(enable.client.lastCall().method, 'enableFirewallRuleWithOptions');
  assert.equal(enable.client.lastCall().request.sourceCidrIp, '203.0.113.10/32');

  const deleteOne = createMockContext({ req: { ruleId: 'mock-rule-1' } });
  await rpcdef(deleteOne.ctx)[DELETE_FIREWALL_RULE_PATH]();
  assert.equal(deleteOne.client.lastCall().method, 'deleteFirewallRuleWithOptions');

  const deleteMany = createMockContext({ req: { ruleIds: ['mock-rule-1', 'mock-rule-2'] } });
  await rpcdef(deleteMany.ctx)[DELETE_FIREWALL_RULES_PATH]();
  assert.deepEqual(deleteMany.client.lastCall().request.ruleIds, ['mock-rule-1', 'mock-rule-2']);
});

test('Alibaba Cloud SDK errors map to gRPC-compatible errors', async () => {
  const client = new MockSWASClient({
    errors: {
      listFirewallRulesWithOptions: Object.assign(new Error('Forbidden.RAM: permission denied'), {
        code: 'Forbidden.RAM',
        statusCode: 403,
        requestId: 'mock-denied-request',
      }),
    },
  });
  const { ctx } = createMockContext({ client, req: {} });

  await assert.rejects(
    () => rpcdef(ctx)[LIST_FIREWALL_RULES_PATH](),
    (err) => {
      assert.equal(err.legacyCode, 'PERMISSION_DENIED');
      assert.match(err.message, /mock-denied-request/);
      return true;
    },
  );
});

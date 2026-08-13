/* node:coverage disable */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CREATE_FIREWALL_RULE_PATH,
  CREATE_FIREWALL_RULES_PATH,
  DELETE_FIREWALL_RULE_PATH,
  DELETE_FIREWALL_RULES_PATH,
  DISABLE_FIREWALL_RULE_PATH,
  ENABLE_FIREWALL_RULE_PATH,
  LIST_FIREWALL_RULES_PATH,
  MODIFY_FIREWALL_RULE_PATH,
  rpcdef,
} from '../src/alibaba-cloud-simple-application-server-firewall.js';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const serviceRoot = path.resolve(dirname, '..');
const artifactsDir = path.join(serviceRoot, 'test-artifacts');

const env = process.env;
const liveEnabled = Boolean(
  env.ALIBABA_CLOUD_ACCESS_KEY_ID &&
  env.ALIBABA_CLOUD_ACCESS_KEY_SECRET &&
  env.ALIBABA_CLOUD_REGION_ID &&
  env.ALIBABA_CLOUD_SWAS_INSTANCE_ID &&
  env.ALIBABA_CLOUD_SWAS_TEST_SOURCE_CIDR,
);

const testRule = {
  ruleProtocol: env.ALIBABA_CLOUD_SWAS_TEST_PROTOCOL || 'TCP',
  port: env.ALIBABA_CLOUD_SWAS_TEST_PORT || '39080',
  sourceCidrIp: env.ALIBABA_CLOUD_SWAS_TEST_SOURCE_CIDR || '',
  remark: env.ALIBABA_CLOUD_SWAS_TEST_REMARK || `octobus-live-test-${Date.now()}`,
};

const updatedRule = {
  ...testRule,
  port: env.ALIBABA_CLOUD_SWAS_TEST_MODIFY_PORT || '39081',
  remark: `${testRule.remark}-modified`,
};

const buildCtx = (req = {}) => ({
  config: {
    regionId: env.ALIBABA_CLOUD_REGION_ID,
    instanceId: env.ALIBABA_CLOUD_SWAS_INSTANCE_ID,
    timeoutMs: 20_000,
  },
  secret: {
    accessKeyId: env.ALIBABA_CLOUD_ACCESS_KEY_ID,
    accessKeySecret: env.ALIBABA_CLOUD_ACCESS_KEY_SECRET,
    securityToken: env.ALIBABA_CLOUD_SECURITY_TOKEN || undefined,
  },
  req,
});

const maskToken = (value, visible = 6) => {
  const raw = String(value || '');
  if (!raw) return '';
  if (raw.length <= visible) return '*'.repeat(raw.length);
  return `${'*'.repeat(Math.max(4, raw.length - visible))}${raw.slice(-visible)}`;
};

const maskCIDR = (value) => {
  const raw = String(value || '');
  const [host, prefix] = raw.split('/');
  if (host.includes('.')) {
    const parts = host.split('.');
    if (parts.length === 4) return `${parts[0]}.${parts[1]}.*.*${prefix ? `/${prefix}` : ''}`;
  }
  if (host.includes(':')) return `${host.split(':').slice(0, 2).join(':')}:****${prefix ? `/${prefix}` : ''}`;
  return maskToken(raw, 3);
};

const maskValuePayload = (value, masker) => {
  if (Array.isArray(value)) return value.map((item) => maskValuePayload(item, masker));
  if (value && typeof value === 'object') {
    if (Object.prototype.hasOwnProperty.call(value, 'stringValue')) return { ...value, stringValue: masker(value.stringValue) };
    if (Object.prototype.hasOwnProperty.call(value, 'listValue')) {
      return {
        ...value,
        listValue: {
          ...value.listValue,
          values: (value.listValue?.values || []).map((item) => maskValuePayload(item, masker)),
        },
      };
    }
    return sanitizeValue(value);
  }
  return masker(value);
};

const sanitizeValue = (value) => {
  if (Array.isArray(value)) return value.map(sanitizeValue);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      const lower = key.toLowerCase();
      if (lower.includes('secret') || lower.includes('token') || lower.includes('credential')) {
        out[key] = '[REDACTED]';
      } else if (lower.includes('instance_id') || lower.includes('instanceid')) {
        out[key] = maskValuePayload(item, maskToken);
      } else if (lower.includes('firewall_rule_id') || lower.includes('firewallruleid') || lower === 'rule_id' || lower === 'ruleid') {
        out[key] = maskValuePayload(item, maskToken);
      } else if (lower.includes('source_cidr_ip') || lower.includes('sourcecidrip')) {
        out[key] = maskValuePayload(item, maskCIDR);
      } else {
        out[key] = sanitizeValue(item);
      }
    }
    return out;
  }
  return value;
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const operation = async (name, req, pathName) => {
  const startedAt = new Date().toISOString();
  const result = await rpcdef(buildCtx(req))[pathName]();
  const redacted = sanitizeValue(result);
  return {
    name,
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    success: result.success === true,
    request_id: result.request_id,
    firewall_rule_id: maskToken(result.firewall_rule_id),
    firewall_rule_ids: (result.firewall_rule_ids || []).map((id) => maskToken(id)),
    total_count: result.total_count,
    result: redacted,
    actual_firewall_rule_id: result.firewall_rule_id,
    actual_firewall_rule_ids: result.firewall_rule_ids,
  };
};

const writeEvidence = async (evidence) => {
  await fs.mkdir(artifactsDir, { recursive: true });
  const jsonPath = path.join(artifactsDir, 'aliyun-swas-firewall-live-evidence.json');
  const mdPath = path.join(artifactsDir, 'aliyun-swas-firewall-live-evidence.md');
  await fs.writeFile(jsonPath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  const rows = evidence.operations.map((op) => `| ${op.name} | ${op.success ? 'success' : 'failed'} | ${op.request_id || ''} | ${(op.firewall_rule_id || op.firewall_rule_ids || []).toString()} |`).join('\n');
  await fs.writeFile(mdPath, [
    '# Alibaba Cloud SWAS Firewall Live Evidence',
    '',
    `- Timestamp: ${evidence.finished_at}`,
    `- RegionId: ${evidence.region_id}`,
    `- InstanceId: ${evidence.instance_id}`,
    `- Test protocol: ${evidence.test_rule.ruleProtocol}`,
    `- Test port: ${evidence.test_rule.port}`,
    `- Test source CIDR: ${evidence.test_rule.sourceCidrIp}`,
    `- AccessKey ID suffix: ${evidence.access_key_id_suffix}`,
    '',
    '| Operation | Status | RequestId | Rule ID(s) |',
    '| --- | --- | --- | --- |',
    rows,
    '',
    'AccessKey Secret is not recorded in this evidence.',
    '',
  ].join('\n'), 'utf8');
  return { jsonPath, mdPath };
};

test('live Alibaba Cloud SWAS firewall CRUD and batch operations', { skip: liveEnabled ? false : 'set ALIBABA_CLOUD_* environment variables to run live test', timeout: 120_000 }, async () => {
  const evidence = {
    service: 'alibaba-cloud-simple-application-server-firewall',
    started_at: new Date().toISOString(),
    finished_at: '',
    region_id: env.ALIBABA_CLOUD_REGION_ID,
    instance_id: maskToken(env.ALIBABA_CLOUD_SWAS_INSTANCE_ID),
    access_key_id_suffix: maskToken(env.ALIBABA_CLOUD_ACCESS_KEY_ID),
    test_rule: sanitizeValue(testRule),
    updated_rule: sanitizeValue(updatedRule),
    operations: [],
    created_rule_ids: [],
    cleanup_rule_ids: [],
    deletion_confirmed: false,
    remaining_rule_ids_after_cleanup: [],
  };

  const cleanupIds = new Set();

  try {
    const createOne = await operation('CreateFirewallRule', testRule, CREATE_FIREWALL_RULE_PATH);
    evidence.operations.push(createOne);
    assert.ok(createOne.actual_firewall_rule_id, 'CreateFirewallRule should return firewall_rule_id');
    cleanupIds.add(createOne.actual_firewall_rule_id);
    evidence.created_rule_ids.push(maskToken(createOne.actual_firewall_rule_id));

    const listAfterCreate = await operation('ListFirewallRules after create', { pageSize: 100 }, LIST_FIREWALL_RULES_PATH);
    evidence.operations.push(listAfterCreate);
    assert.ok(listAfterCreate.result.firewall_rules.some((rule) => rule.firewall_rule_id === maskToken(createOne.actual_firewall_rule_id)));

    const modify = await operation('ModifyFirewallRule', { ...updatedRule, ruleId: createOne.actual_firewall_rule_id }, MODIFY_FIREWALL_RULE_PATH);
    evidence.operations.push(modify);
    assert.equal(modify.success, true);

    const disable = await operation('DisableFirewallRule', { ruleId: createOne.actual_firewall_rule_id, remark: `${updatedRule.remark}-disabled` }, DISABLE_FIREWALL_RULE_PATH);
    evidence.operations.push(disable);
    assert.equal(disable.success, true);

    const enable = await operation('EnableFirewallRule', { ruleId: createOne.actual_firewall_rule_id, sourceCidrIp: testRule.sourceCidrIp, remark: `${updatedRule.remark}-enabled` }, ENABLE_FIREWALL_RULE_PATH);
    evidence.operations.push(enable);
    assert.equal(enable.success, true);

    const batchRules = [
      { ...testRule, port: env.ALIBABA_CLOUD_SWAS_TEST_BATCH_PORT_1 || '39082', remark: `${testRule.remark}-batch-1` },
      { ...testRule, port: env.ALIBABA_CLOUD_SWAS_TEST_BATCH_PORT_2 || '39083', remark: `${testRule.remark}-batch-2` },
    ];
    const createBatch = await operation('CreateFirewallRules', { firewallRules: batchRules }, CREATE_FIREWALL_RULES_PATH);
    evidence.operations.push(createBatch);
    assert.equal(createBatch.actual_firewall_rule_ids.length, 2);
    for (const id of createBatch.actual_firewall_rule_ids) {
      cleanupIds.add(id);
      evidence.created_rule_ids.push(maskToken(id));
    }

    const deleteBatch = await operation('DeleteFirewallRules', { ruleIds: createBatch.actual_firewall_rule_ids }, DELETE_FIREWALL_RULES_PATH);
    evidence.operations.push(deleteBatch);
    assert.equal(deleteBatch.success, true);
    for (const id of createBatch.actual_firewall_rule_ids) cleanupIds.delete(id);

    const deleteOne = await operation('DeleteFirewallRule', { ruleId: createOne.actual_firewall_rule_id }, DELETE_FIREWALL_RULE_PATH);
    evidence.operations.push(deleteOne);
    assert.equal(deleteOne.success, true);
    cleanupIds.delete(createOne.actual_firewall_rule_id);

    let remainingRules = [];
    for (let attempt = 1; attempt <= 6; attempt += 1) {
      if (attempt > 1) await sleep(5_000);
      const finalList = await operation(`ListFirewallRules final attempt ${attempt}`, { pageSize: 100 }, LIST_FIREWALL_RULES_PATH);
      evidence.operations.push(finalList);
      remainingRules = finalList.result.firewall_rules.filter((rule) => evidence.created_rule_ids.includes(rule.firewall_rule_id));
      if (remainingRules.length === 0) break;
    }
    evidence.remaining_rule_ids_after_cleanup = remainingRules.map((rule) => rule.firewall_rule_id);
    evidence.deletion_confirmed = remainingRules.length === 0;
    assert.deepEqual(evidence.remaining_rule_ids_after_cleanup, []);
  } finally {
    for (const id of cleanupIds) {
      try {
        const cleanup = await operation(`cleanup DeleteFirewallRule ${maskToken(id)}`, { ruleId: id }, DELETE_FIREWALL_RULE_PATH);
        evidence.operations.push(cleanup);
        evidence.cleanup_rule_ids.push(maskToken(id));
      } catch (err) {
        evidence.operations.push({
          name: `cleanup DeleteFirewallRule ${maskToken(id)}`,
          success: false,
          error: err?.message || String(err),
        });
      }
    }
    for (const op of evidence.operations) {
      delete op.actual_firewall_rule_id;
      delete op.actual_firewall_rule_ids;
    }
    evidence.finished_at = new Date().toISOString();
    const paths = await writeEvidence(evidence);
    console.log(`Live evidence written to ${paths.jsonPath}`);
    console.log(`Live evidence written to ${paths.mdPath}`);
  }
});

#!/usr/bin/env node
/**
 * OctoBus SDK Handler 联调验证脚本 (MISP)
 * 通过 OctoBus service package 导出的 handlers 直接调用，
 * 与 OctoBus SDK runServiceMain 调用路径完全一致。
 *
 * 用法:
 *   NODE_TLS_REJECT_UNAUTHORIZED=0 node verify-octobus-sdk-misp.mjs
 */

import { handlers } from '../src/misp.js';

const config = {
  endpoint: 'https://127.0.0.1:8444',
  skipTlsVerify: true,
  timeoutMs: 10000,
};
const secret = {
  api_key: 'e750b3f3064a8f31560a1fcad3b06c988a2d7878',
};

const baseCtx = {
  config,
  secret,
  metadata: {},
  serviceId: 'verify',
  instanceId: 'verify-001',
};

console.log('=== OctoBus SDK Handler 联调验证 (MISP) ===');
console.log('通过 OctoBus service package 导出的 handlers 调用\n');

const methods = [
  { name: 'SearchEvents', key: 'MISP.MISP/SearchEvents', req: {} },
  { name: 'GetEvent', key: 'MISP.MISP/GetEvent', req: { event_id: '1' } },
  { name: 'CreateEvent', key: 'MISP.MISP/CreateEvent', req: { info: 'OctoBus verification test', threat_level_id: '4', analysis: '0', date: '2026-06-26' } },
  { name: 'SearchAttributes', key: 'MISP.MISP/SearchAttributes', req: {} },
  { name: 'AddAttribute', key: 'MISP.MISP/AddAttribute', req: { event_id: '1', type: 'ip-dst', value: '10.0.0.1', category: 'Network activity' } },
  { name: 'SearchTags', key: 'MISP.MISP/SearchTags', req: { name: 'tlp:white' } },
];

const results = [];
for (const m of methods) {
  const handler = handlers[m.key];
  if (!handler) {
    console.log('SKIP ' + m.name + ': handler not found');
    results.push({ name: m.name, status: 'FAIL', error: 'handler not found' });
    continue;
  }
  try {
    const res = await handler({ ...baseCtx, request: m.req, method: m.key });
    const summary = JSON.stringify(res).slice(0, 200);
    console.log('OK ' + m.name + ': success ' + summary);
    results.push({ name: m.name, status: 'PASS' });
  } catch (e) {
    console.log('FAIL ' + m.name + ': ' + e.message);
    results.push({ name: m.name, status: 'FAIL', error: e.message });
  }
}

console.log('');
console.log('=== 验证结果汇总 ===');
for (const r of results) {
  const icon = r.status === 'PASS' ? 'OK' : 'FAIL';
  console.log('  ' + icon + ' ' + r.name + (r.error ? ' - ' + r.error : ''));
}
const passCount = results.filter(r => r.status === 'PASS').length;
console.log('');
console.log('通过: ' + passCount + '/' + results.length);

if (passCount !== results.length) process.exit(1);

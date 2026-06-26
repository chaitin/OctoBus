#!/usr/bin/env node
/**
 * ThreatBook HFish 真实设备联调验证脚本
 *
 * 用法:
 *   HFISH_ENDPOINT=https://your-hfish:4433 HFISH_API_KEY=your-key node verify-real-device.mjs
 *
 * 可选环境变量:
 *   SKIP_TLS     - 设置为 true 跳过 TLS 验证（HFish 默认使用自签名证书）
 */

import { rpcdef } from '../src/hfish.js';

const endpoint = process.env.HFISH_ENDPOINT;
const apiKey = process.env.HFISH_API_KEY;
const skipTls = process.env.SKIP_TLS !== 'false'; // default true for self-signed certs

if (!endpoint || !apiKey) {
  console.error('❌ 请设置环境变量 HFISH_ENDPOINT 和 HFISH_API_KEY');
  console.error('   例: HFISH_ENDPOINT=https://hfish:4433 HFISH_API_KEY=xxx node verify-real-device.mjs');
  process.exit(1);
}

const ctx = {
  bindings: { endpoint, skipTlsVerify: skipTls },
  secret: { apiKey },
  limits: { timeoutMs: 10000 },
  meta: { instance_id: 'verify', request_id: 'verify-001' },
  req: {},
};

const api = rpcdef(ctx);
const results = [];

const testMethod = async (name, path, req = {}) => {
  try {
    const handlerCtx = { ...ctx, req };
    const res = await rpcdef(handlerCtx)[path]();
    console.log(`✅ ${name}: success`, JSON.stringify(res).slice(0, 200));
    results.push({ name, status: 'PASS' });
    return res;
  } catch (e) {
    console.log(`❌ ${name}: ${e.message}`);
    results.push({ name, status: 'FAIL', error: e.message });
    return null;
  }
};

console.log('=== HFish 真实设备联调验证 ===\n');
console.log(`Endpoint: ${endpoint}`);
console.log(`TLS skip: ${skipTls}\n`);

await testMethod('GetSystemInfo', '/ThreatBook_HFISH.ThreatBook_HFISH/GetSystemInfo', {});
await testMethod('ListAttackIPs', '/ThreatBook_HFISH.ThreatBook_HFISH/ListAttackIPs', { page: 1, limit: 20 });
await testMethod('ListAttackDetails', '/ThreatBook_HFISH.ThreatBook_HFISH/ListAttackDetails', { page: 1, limit: 20 });
await testMethod('ListAttackAccounts', '/ThreatBook_HFISH.ThreatBook_HFISH/ListAttackAccounts', { page: 1, limit: 20 });

console.log('\n=== 验证结果汇总 ===');
for (const r of results) {
  console.log(`  ${r.status === 'PASS' ? '✅' : '❌'} ${r.name}: ${r.status}${r.error ? ' - ' + r.error : ''}`);
}
const passCount = results.filter(r => r.status === 'PASS').length;
console.log(`\n通过: ${passCount}/${results.length}`);

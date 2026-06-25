// Alibaba Cloud SAS API 真实设备验证脚本
// 运行方式: ACCESS_KEY_ID=xxx ACCESS_KEY_SECRET=xxx node verify_sas.mjs

import { _test } from './src/alibaba-sas.js';

const ACCESS_KEY_ID = process.env.ACCESS_KEY_ID;
const ACCESS_KEY_SECRET = process.env.ACCESS_KEY_SECRET;

if (!ACCESS_KEY_ID || !ACCESS_KEY_SECRET) {
  console.error('错误：请设置环境变量 ACCESS_KEY_ID 和 ACCESS_KEY_SECRET');
  console.error('  export ACCESS_KEY_ID=your_access_key_id');
  console.error('  export ACCESS_KEY_SECRET=your_access_key_secret');
  console.error('  node verify_sas.mjs');
  process.exit(1);
}

const ctx = {
  bindings: {
    access_key_id: ACCESS_KEY_ID,
    access_key_secret: ACCESS_KEY_SECRET,
    region: 'cn-hangzhou',
    endpoint: 'sas.aliyuncs.com',
  },
  limits: { timeoutMs: 30000 },
  meta: { instance_id: 'verify', request_id: 'v001' },
};

async function main() {
  console.log('========================================');
  console.log('Alibaba Cloud SAS API 真实设备验证');
  console.log('========================================\n');

  // 1. ListContainerInstances
  try {
    console.log('1. ListContainerInstances ----------');
    const containers = await _test.listContainerInstances({ page_size: 5 }, ctx);
    console.log('   Total:', containers.total_count);
    if (containers.items.length) {
      containers.items.forEach(c => {
        console.log(`   - ${c.container_name} | ${c.status} | cluster:${c.cluster_name}`);
      });
    }
    console.log('   ✓ PASS\n');
  } catch(e) { console.log('   ✗ FAIL:', e.message, '\n'); }

  // 2. ListImageInstances
  try {
    console.log('2. ListImageInstances --------------');
    const images = await _test.listImageInstances({ page_size: 5 }, ctx);
    console.log('   Total:', images.total_count);
    if (images.items.length) {
      images.items.forEach(img => {
        console.log(`   - ${img.image_tag} | vulns:${img.vul_count} | risk:${img.risk_level}`);
      });
    }
    console.log('   ✓ PASS\n');
  } catch(e) { console.log('   ✗ FAIL:', e.message, '\n'); }

  // 3. ListImageVulnerabilities (needs image_uuid from step 2)
  try {
    console.log('3. ListImageVulnerabilities --------');
    // Get first image UUID if available
    const images = await _test.listImageInstances({ page_size: 1 }, ctx);
    if (images.items.length > 0 && images.items[0].image_uuid) {
      const uuid = images.items[0].image_uuid;
      const vulns = await _test.listImageVulnerabilities({ image_uuid: uuid, page_size: 5 }, ctx);
      console.log('   Total vulns:', vulns.total_count);
      vulns.items.forEach(v => {
        console.log(`   - ${v.cve_id} | ${v.level} | fix:${v.fix_version} | fixed:${v.is_fixed}`);
      });
    } else {
      console.log('   (no images found, skipping)');
    }
    console.log('   ✓ PASS\n');
  } catch(e) { console.log('   ✗ FAIL:', e.message, '\n'); }

  // 4. GetClusterSuspEventStatistics
  try {
    console.log('4. GetClusterSuspEventStatistics ---');
    const stats = await _test.getClusterSuspEventStatistics({}, ctx);
    console.log('   Result:', JSON.stringify(stats.statistics));
    console.log('   ✓ PASS\n');
  } catch(e) { console.log('   ✗ FAIL:', e.message, '\n'); }

  // 5. ListClusterInterceptionConfig
  try {
    console.log('5. ListClusterInterceptionConfig ---');
    const configs = await _test.listClusterInterceptionConfig({ page_size: 5 }, ctx);
    console.log('   Total:', configs.total_count);
    configs.items.forEach(c => {
      console.log(`   - ${c.cluster_name} | type:${c.intercept_type} | rules:${c.rule_count} | state:${c.state}`);
    });
    console.log('   ✓ PASS\n');
  } catch(e) { console.log('   ✗ FAIL:', e.message, '\n'); }

  console.log('========================================');
  console.log('验证完成');
  console.log('========================================');
}

main().catch(console.error);

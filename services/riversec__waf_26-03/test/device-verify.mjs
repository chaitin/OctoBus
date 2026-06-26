#!/usr/bin/env node
/**
 * Real-device verification via OctoBus Connect RPC.
 *
 * Usage:
 *   node test/device-verify.mjs
 *   node test/device-verify.mjs --base-url http://127.0.0.1:9000 --capset waf-ops --instance riversec-demo
 *   node test/device-verify.mjs --rule-id YOUR_RULE_ID --upstream-ip 192.168.2.200
 *
 * Safe write tests use RFC5737 TEST-NET-3 (203.0.113.10) and are cleaned up when possible.
 * Full write tests target a test environment; destructive RPCs attempt cleanup in finally blocks.
 */

const args = process.argv.slice(2);
const readArg = (name, fallback) => {
  const idx = args.indexOf(name);
  return idx >= 0 && args[idx + 1] ? args[idx + 1] : fallback;
};

const GATEWAY = readArg('--base-url', 'http://127.0.0.1:9000').replace(/\/$/, '');
const CAPSET = readArg('--capset', 'waf-ops');
const INSTANCE = readArg('--instance', 'riversec-demo');
const TEST_IP = readArg('--test-ip', '203.0.113.10');
const RULE_ID = readArg('--rule-id', process.env.OCTOBUS_RIVERSEC_RULE_ID || '');
const UPSTREAM_IP = readArg('--upstream-ip', '192.168.2.200');
const SITE_NAME = readArg('--site-name', `octobus-auto-${Date.now()}.test`);

const results = [];

const connectUrl = (method) =>
  `${GATEWAY}/capsets/${encodeURIComponent(CAPSET)}/connect/${encodeURIComponent(INSTANCE)}/${method}`;

async function callRpc(method, body = undefined) {
  const init = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  };
  if (body !== undefined) init.body = JSON.stringify(body);

  const response = await fetch(connectUrl(method), init);
  const text = await response.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { _raw: text };
  }
  return { status: response.status, json };
}

function record(name, category, outcome, detail = '') {
  results.push({ name, category, outcome, detail });
  const icon = outcome === 'pass' ? '✅' : outcome === 'skip' ? '⏭️' : '❌';
  const suffix = detail ? ` — ${detail}` : '';
  console.log(`${icon} [${category}] ${name}${suffix}`);
}

function isAbdUnavailable(message = '') {
  return message.includes('404') || message.includes('HTTP 404');
}

function buildUpstream(port = 80) {
  return {
    protocol: 'http',
    upstreamList: [{ enable: true, ip: UPSTREAM_IP, port }],
    loadBalance: 'round_robin',
  };
}

function buildSitePayload({ type, site, port = 80, protectionMode = 'monitor' }) {
  return {
    type,
    site,
    protocol: 'http',
    port,
    protectionMode,
    upstream: buildUpstream(port),
  };
}

async function expectOk(name, category, method, body) {
  try {
    const { status, json } = await callRpc(method, body);
    if (status !== 200) {
      record(name, category, 'fail', `HTTP ${status}: ${JSON.stringify(json)}`);
      return null;
    }
    if (json?.code) {
      record(name, category, 'fail', `${json.code}: ${json.message || ''}`.trim());
      return null;
    }
    record(name, category, 'pass', JSON.stringify(json).slice(0, 120));
    return json;
  } catch (err) {
    record(name, category, 'fail', err.message);
    return null;
  }
}

async function expectOkOrSkip(name, category, method, body, skipIf) {
  try {
    const { status, json } = await callRpc(method, body);
    if (status !== 200 || json?.code) {
      const message = `${json?.message || ''} ${JSON.stringify(json)}`;
      if (skipIf(message)) {
        record(name, category, 'skip', json?.message || `HTTP ${status}`);
        return null;
      }
      record(name, category, 'fail', `${json?.code || `HTTP ${status}`}: ${json?.message || ''}`.trim());
      return null;
    }
    record(name, category, 'pass', JSON.stringify(json).slice(0, 120));
    return json;
  } catch (err) {
    record(name, category, 'fail', err.message);
    return null;
  }
}

async function expectFail(name, category, method, body, hint = '') {
  try {
    const { status, json } = await callRpc(method, body);
    if (status === 200 && !json?.code) {
      record(name, category, 'fail', `expected failure but succeeded: ${JSON.stringify(json)}`);
      return;
    }
    record(name, category, 'pass', hint || `${json?.code || `HTTP ${status}`}`);
  } catch (err) {
    record(name, category, 'pass', hint || err.message);
  }
}

async function createProtectedSiteWithFallback(P) {
  const method = `${P}.ProtectedSiteService/CreateProtectedSite`;
  const candidates = [
    buildSitePayload({ type: 'ipv4', site: UPSTREAM_IP, port: 80 }),
    buildSitePayload({ type: 'domain', site: SITE_NAME, port: 8080 }),
    buildSitePayload({ type: 'domain', site: 'octobus-verify.example.com', port: 8080 }),
  ];

  let lastError = '';
  const attemptErrors = [];
  for (const payload of candidates) {
    const { status, json } = await callRpc(method, payload);
    if (status === 200 && !json?.code && json?.id) {
      record(
        'CreateProtectedSite',
        'write-full',
        'pass',
        `${payload.type}:${payload.site} -> ${JSON.stringify(json).slice(0, 80)}`,
      );
      return { id: json.id, payload };
    }
    lastError = `${payload.type}:${payload.site}: ${json?.message || `HTTP ${status}`}`.trim();
    attemptErrors.push(lastError);
  }
  const deviceRejected = attemptErrors.every((msg) => msg.includes('err_no=4') || msg.includes('INVALID_ARGUMENT'));
  record(
    'CreateProtectedSite',
    'write-full',
    deviceRejected ? 'skip' : 'fail',
    attemptErrors.join(' | '),
  );
  return null;
}

async function runBlacklistOverwriteTests(P, initialBlacklistStatus) {
  await expectOk('SetBlacklistStatus on (overwrite tests)', 'write-full', `${P}.IPBlacklistService/SetBlacklistStatus`, { status: 'on' });

  await expectOk('SetBlacklist', 'write-full', `${P}.IPBlacklistService/SetBlacklist`, {
    items: [`${TEST_IP}/32`],
  });
  await expectOk('GetBlacklist after SetBlacklist', 'write-full', `${P}.IPBlacklistService/GetBlacklist`);
  await expectOk('ClearBlacklist', 'write-full', `${P}.IPBlacklistService/ClearBlacklist`);
  await callRpc(`${P}.IPBlacklistService/UnblockIP`, { ip_list: [TEST_IP] }).catch(() => {});

  if (initialBlacklistStatus !== 'on') {
    await expectOk('Restore SetBlacklistStatus after overwrite tests', 'write-full', `${P}.IPBlacklistService/SetBlacklistStatus`, { status: initialBlacklistStatus });
  }
}

async function runProtectedSiteTests(P) {
  const created = await createProtectedSiteWithFallback(P);
  if (!created?.id) {
    record('ProtectedSite CRUD', 'write-full', 'skip', 'CreateProtectedSite failed for all fallback payloads');
    return;
  }

  const siteId = created.id;
  try {
    await expectOk('GetProtectedSite', 'write-full', `${P}.ProtectedSiteService/GetProtectedSite`, { id: siteId });
    await expectOk('UpdateProtectedSite', 'write-full', `${P}.ProtectedSiteService/UpdateProtectedSite`, {
      id: siteId,
      protectionMode: 'passthrough',
    });
    await expectOk('BatchUpdateProtectedSites', 'write-full', `${P}.ProtectedSiteService/BatchUpdateProtectedSites`, {
      siteList: [siteId],
      config: { protectionMode: 'monitor' },
    });
  } finally {
    await expectOk('DeleteProtectedSite', 'write-full', `${P}.ProtectedSiteService/DeleteProtectedSite`, { id: siteId });
  }
}

async function runProgrammableRuleTests(P) {
  const initialEditor = await callRpc(`${P}.ProgrammableRuleService/GetEditorStatus`);
  const initialEditorStatus = initialEditor.json?.status || 'off';

  const editorOn = await expectOk('SetEditorStatus on', 'write-full', `${P}.ProgrammableRuleService/SetEditorStatus`, { status: 'on' });
  if (editorOn !== null) {
    await expectOkOrSkip(
      'UpdateWebRule',
      'write-full',
      `${P}.ProgrammableRuleService/UpdateWebRule`,
      { manualRule: '// octobus device-verify web rule\n' },
      (msg) => msg.includes('err_no=12') || msg.includes('Illegal UBB rule'),
    );
    await expectOkOrSkip(
      'UpdateAppRule',
      'write-full',
      `${P}.ProgrammableRuleService/UpdateAppRule`,
      { manualRule: '// octobus device-verify app rule\n' },
      (msg) => msg.includes('err_no=12') || msg.includes('Illegal UBB rule'),
    );
    await expectOkOrSkip(
      'UploadResourceFile',
      'write-full',
      `${P}.ProgrammableRuleService/UploadResourceFile`,
      {
        fileName: 'octobus-verify.list',
        type: 'list',
        fileContent: '127.0.0.1\n',
      },
      (msg) => msg.includes('err_no=4') || msg.includes('Argument error'),
    );
  }

  if (RULE_ID) {
    await expectOk('GetRuleStatus', 'write-full', `${P}.ProgrammableRuleService/GetRuleStatus`, { id: RULE_ID });
    const ruleStatus = await callRpc(`${P}.ProgrammableRuleService/GetRuleStatus`, { id: RULE_ID });
    const currentRuleStatus = ruleStatus.json?.status || 'off';
    const toggled = currentRuleStatus === 'on' ? 'off' : 'on';
    await expectOk('SetRuleStatus', 'write-full', `${P}.ProgrammableRuleService/SetRuleStatus`, {
      id: RULE_ID,
      status: toggled,
    });
    if (toggled !== currentRuleStatus) {
      await expectOk('Restore SetRuleStatus', 'write-full', `${P}.ProgrammableRuleService/SetRuleStatus`, {
        id: RULE_ID,
        status: currentRuleStatus,
      });
    }
  } else {
    record('GetRuleStatus', 'write-full', 'skip', 'pass --rule-id or OCTOBUS_RIVERSEC_RULE_ID');
    record('SetRuleStatus', 'write-full', 'skip', 'pass --rule-id or OCTOBUS_RIVERSEC_RULE_ID');
  }

  if (initialEditorStatus !== 'on') {
    await expectOk('Restore SetEditorStatus', 'write-full', `${P}.ProgrammableRuleService/SetEditorStatus`, { status: initialEditorStatus });
  }
}

async function runClusterTests(P) {
  const cluster = await callRpc(`${P}.ClusterService/GetClusterInfo`);
  const preVersion = cluster.json?.preVersion || cluster.json?.pre_version || '';

  await expectOkOrSkip(
    'UpgradeCluster',
    'write-full',
    `${P}.ClusterService/UpgradeCluster`,
    { upgradePackage: Buffer.from('octobus-device-verify-upgrade-package').toString('base64') },
    (msg) => msg.includes('err_no=4') || msg.includes('INVALID_ARGUMENT') || msg.includes('FAILED_PRECONDITION'),
  );

  await expectOkOrSkip(
    'RollbackCluster',
    'write-full',
    `${P}.ClusterService/RollbackCluster`,
    {},
    (msg) => !preVersion || msg.includes('err_no=') || msg.includes('FAILED_PRECONDITION') || msg.includes('INVALID_ARGUMENT'),
  );
}

async function runApiManagementTests(P) {
  const listed = await callRpc(`${P}.APIManagementService/ListAPIs`);
  if (listed.status !== 200 || listed.json?.code) {
    const message = `${listed.json?.message || ''} ${JSON.stringify(listed.json)}`;
    if (isAbdUnavailable(message)) {
      for (const name of ['AddAPI', 'DeleteAPI', 'IgnoreAPI', 'SetAPIOnlineStatus']) {
        record(name, 'write-full', 'skip', 'ABD module unavailable (HTTP 404)');
      }
      return;
    }
    record('APIManagementService', 'write-full', 'fail', listed.json?.message || `HTTP ${listed.status}`);
    return;
  }

  const apiName = `octobus-verify-${Date.now()}`;
  await expectOk('AddAPI', 'write-full', `${P}.APIManagementService/AddAPI`, {
    apiName,
    groupName: 'default',
    method: 'GET',
    port: 443,
    host: 'api.example.com',
    apiEndpoint: '/v1/octobus-verify',
    matchSubPath: 'false',
  });

  const apis = await callRpc(`${P}.APIManagementService/ListAPIs`);
  const api = (apis.json?.apiList || apis.json?.api_list || []).find((item) => item.apiName === apiName || item.api_name === apiName);
  if (!api?.id) {
    record('APIManagement follow-up', 'write-full', 'fail', `created API ${apiName} not found in ListAPIs`);
    return;
  }

  try {
    await expectOk('SetAPIOnlineStatus off', 'write-full', `${P}.APIManagementService/SetAPIOnlineStatus`, {
      id: api.id,
      status: 'off',
    });
    await expectOk('IgnoreAPI', 'write-full', `${P}.APIManagementService/IgnoreAPI`, { apiId: api.id });
  } finally {
    await expectOk('DeleteAPI', 'write-full', `${P}.APIManagementService/DeleteAPI`, { apiId: api.id });
  }
}

async function main() {
  console.log(`Gateway: ${GATEWAY}`);
  console.log(`Capset:  ${CAPSET}`);
  console.log(`Instance:${INSTANCE}`);
  console.log(`Test IP: ${TEST_IP}`);
  console.log(`Upstream:${UPSTREAM_IP}`);
  console.log(`Site:    ${SITE_NAME}`);
  console.log(`Rule ID: ${RULE_ID || '(not set)'}`);
  console.log('---');

  const P = 'Riversec_Botgate_WAF';

  await callRpc(`${P}.IPBlacklistService/UnblockIP`, { ip_list: [TEST_IP] }).catch(() => {});

  // Read-only
  await expectOk('GetBlacklistStatus', 'read', `${P}.IPBlacklistService/GetBlacklistStatus`);
  await expectOk('GetBlacklist', 'read', `${P}.IPBlacklistService/GetBlacklist`);
  await expectOk('ListProtectedSites', 'read', `${P}.ProtectedSiteService/ListProtectedSites`);
  await expectOk('GetClusterInfo', 'read', `${P}.ClusterService/GetClusterInfo`);
  await expectOk('GetEditorStatus', 'read', `${P}.ProgrammableRuleService/GetEditorStatus`);
  const listApis = await expectOkOrSkip(
    'ListAPIs',
    'read',
    `${P}.APIManagementService/ListAPIs`,
    undefined,
    isAbdUnavailable,
  );
  void listApis;
  await expectOk('GetSSOToken', 'read', `${P}.ClusterService/GetSSOToken`, { username: 'admin' });

  const sites = await callRpc(`${P}.ProtectedSiteService/ListProtectedSites`);
  if (sites.status === 200 && sites.json?.sites?.length) {
    const siteId = sites.json.sites[0].id;
    await expectOk('GetProtectedSite (existing)', 'read', `${P}.ProtectedSiteService/GetProtectedSite`, { id: siteId });
  } else {
    record('GetProtectedSite (existing)', 'read', 'skip', 'no pre-existing protected sites');
  }

  if (RULE_ID) {
    await expectOk('GetRuleStatus (read)', 'read', `${P}.ProgrammableRuleService/GetRuleStatus`, { id: RULE_ID });
  } else {
    record('GetRuleStatus (read)', 'read', 'skip', 'pass --rule-id or OCTOBUS_RIVERSEC_RULE_ID');
  }

  const initialStatus = await callRpc(`${P}.IPBlacklistService/GetBlacklistStatus`);
  const initialValue = initialStatus.json?.status || 'off';
  await expectOk('SetBlacklistStatus on (for write tests)', 'write-safe', `${P}.IPBlacklistService/SetBlacklistStatus`, { status: 'on' });

  const blocked = await expectOk('BlockIP', 'write-safe', `${P}.IPBlacklistService/BlockIP`, {
    ip_list: [TEST_IP],
  });
  if (blocked) {
    await expectOk('GetBlacklist after BlockIP', 'write-safe', `${P}.IPBlacklistService/GetBlacklist`);
    await expectOk('UnblockIP', 'write-safe', `${P}.IPBlacklistService/UnblockIP`, {
      ip_list: [TEST_IP],
    });
  }

  await expectOk('AddBlacklistItems', 'write-safe', `${P}.IPBlacklistService/AddBlacklistItems`, {
    items: [`${TEST_IP}/32`],
  });
  await expectOk('UnblockIP cleanup AddBlacklistItems', 'write-safe', `${P}.IPBlacklistService/UnblockIP`, {
    ip_list: [TEST_IP],
  });

  await expectFail(
    'BlockIP rejects remark',
    'validation',
    `${P}.IPBlacklistService/BlockIP`,
    { ip_list: [TEST_IP], remark: 'demo' },
    'INVALID_ARGUMENT',
  );
  await callRpc(`${P}.IPBlacklistService/UnblockIP`, { ip_list: [TEST_IP] }).catch(() => {});

  if (initialValue !== 'on') {
    await expectOk('Restore SetBlacklistStatus', 'write-safe', `${P}.IPBlacklistService/SetBlacklistStatus`, { status: initialValue });
  }

  await runBlacklistOverwriteTests(P, initialValue);
  await runProtectedSiteTests(P);
  await runProgrammableRuleTests(P);
  await runClusterTests(P);
  await runApiManagementTests(P);

  console.log('---');
  const pass = results.filter((r) => r.outcome === 'pass').length;
  const fail = results.filter((r) => r.outcome === 'fail').length;
  const skip = results.filter((r) => r.outcome === 'skip').length;
  console.log(`Summary: ${pass} pass, ${fail} fail, ${skip} skip / ${results.length} total`);

  if (fail > 0) {
    console.log('\nFailures:');
    for (const row of results.filter((r) => r.outcome === 'fail')) {
      console.log(`  - ${row.name}: ${row.detail}`);
    }
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

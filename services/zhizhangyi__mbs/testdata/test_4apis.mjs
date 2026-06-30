// MBS API 测试: getUsers / detailUser / checkLoginName / stateUsers
import crypto from 'node:crypto';
import https from 'node:https';

const C = {
  baseUrl: process.env.MBS_BASE_URL || 'https://127.0.0.1:9074',
  orgCode: process.env.MBS_ORG_CODE || '',
  appkey: process.env.MBS_APPKEY || '',
  secretkey: process.env.MBS_SECRETKEY || '',
};
const requireConfig = () => {
  const missing = Object.entries(C).filter(([, value]) => !value).map(([key]) => key);
  if (missing.length > 0) {
    throw new Error(`Missing MBS test config: ${missing.join(', ')}. Set MBS_BASE_URL, MBS_ORG_CODE, MBS_APPKEY and MBS_SECRETKEY.`);
  }
};
requireConfig();
const BASE = `${C.baseUrl}/uusafe/mos/thirdaccess/rest/opt`;
const agent = new https.Agent({ rejectUnauthorized: false });
const md5 = (s) => crypto.createHash('md5').update(s, 'utf8').digest('hex');
const sign = (...ps) => md5(ps.map((p) => (p ?? '')).join('') + C.secretkey);

const post = async (path, body) => {
  const res = await fetch(`${BASE}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' }, body: JSON.stringify(body), agent });
  const text = await res.text();
  return { status: res.status, json: JSON.parse(text) };
};

(async () => {
  const { appkey, orgCode } = C;

  // ── Test 1: getUsers ──
  console.log('══════════════════════════════════════════');
  console.log('Test 1: getUsers (用户列表)');
  console.log('══════════════════════════════════════════');
  try {
    const r1 = await post('/v1/getUsers', {
      index: 0, size: 10, orderCode: 0, orderType: 1,
      condition: { deptId: '1', keyWord: '' },
      orgCode, appkey,
      sign: sign(appkey, orgCode, 0, 10, 0, 1, '', '', '', '1'),
    });
    console.log(`HTTP ${r1.status}  code=${r1.json.code}`);
    if (r1.json.code === 0) {
      console.log(`  共 ${r1.json.data.total} 个用户`);
      (r1.json.data.userInfos || []).forEach((u, i) =>
        console.log(`  [${i + 1}] ${u.userName} (${u.loginName}) userId=${u.userId} state=${u.state}`));
    } else { console.log(`  ❌ ${r1.json.msg}`); }
  } catch (e) { console.log(`  ❌ ${e.message}`); }

  // ── Test 2: detailUser (test1) ──
  console.log('\n══════════════════════════════════════════');
  console.log('Test 2: detailUser (用户详情 - test1)');
  console.log('══════════════════════════════════════════');
  const uid = '1691979294102310912'; // test1
  try {
    const r2 = await post('/v1/detailUser', {
      userId: uid, orgCode, appkey,
      sign: sign(appkey, orgCode, uid),
    });
    console.log(`HTTP ${r2.status}  code=${r2.json.code}`);
    if (r2.json.code === 0) {
      const d = r2.json.data;
      console.log(`  ID: ${d.userId}`);
      console.log(`  姓名: ${d.userName}`);
      console.log(`  登录名: ${d.loginName}`);
      console.log(`  部门: ${d.deptName} (${d.deptId})`);
      console.log(`  手机: ${d.phoneNumber || '(空)'}`);
      console.log(`  邮箱: ${d.email || '(空)'}`);
      console.log(`  状态: ${d.state === 1 ? '启用' : d.state === 0 ? '停用' : '未激活'}`);
      console.log(`  设备管理: ${d.isMdm ? '开启' : '关闭'}`);
    } else { console.log(`  ❌ ${r2.json.msg}`); }
  } catch (e) { console.log(`  ❌ ${e.message}`); }

  // ── Test 3: checkLoginName ──
  console.log('\n══════════════════════════════════════════');
  console.log('Test 3: checkLoginName (账号校验)');
  console.log('══════════════════════════════════════════');
  for (const name of ['test1', 'nonexistent_user']) {
    try {
      const r3 = await post('/v1/checkLoginName', {
        loginName: name, orgCode, appkey,
        sign: sign(appkey, orgCode, name),
      });
      const ok = r3.json.code === 0;
      console.log(`  "${name}" -> HTTP ${r3.status} code=${r3.json.code} ${ok ? '✅ 可用' : '❌ ' + r3.json.msg}`);
    } catch (e) { console.log(`  "${name}" -> ❌ ${e.message}`); }
  }

  // ── Test 4: stateUsers (启停 - 先停用 test2 再启用) ──
  console.log('\n══════════════════════════════════════════');
  console.log('Test 4: stateUsers (用户启停 - test2)');
  console.log('══════════════════════════════════════════');
  const uid2 = '1691979421122613248'; // test2

  // 4a: 停用
  console.log('  4a: 停用 test2...');
  try {
    const r4a = await post('/v1/stateUsers', {
      userIds: [uid2], type: 0, state: '0',
      orgCode, appkey,
      sign: sign(appkey, orgCode, uid2, 0, '0', ''),
    });
    console.log(`  HTTP ${r4a.status} code=${r4a.json.code} ${r4a.json.code === 0 ? '✅ 停用成功' : '❌ ' + r4a.json.msg}`);
  } catch (e) { console.log(`  ❌ ${e.message}`); }

  // 4b: 验证 - 查详情看 state
  try {
    const r4b = await post('/v1/detailUser', {
      userId: uid2, orgCode, appkey,
      sign: sign(appkey, orgCode, uid2),
    });
    console.log(`  4b: 验证停用后详情 state=${r4b.json.data?.state} ${r4b.json.data?.state === 0 ? '✅ 已停用' : '⚠️'}`);
  } catch (e) { console.log(`  4b: ❌ ${e.message}`); }

  // 4c: 重新启用
  console.log('  4c: 重新启用 test2...');
  try {
    const r4c = await post('/v1/stateUsers', {
      userIds: [uid2], type: 0, state: '1',
      orgCode, appkey,
      sign: sign(appkey, orgCode, uid2, 0, '1', ''),
    });
    console.log(`  HTTP ${r4c.status} code=${r4c.json.code} ${r4c.json.code === 0 ? '✅ 重新启用成功' : '❌ ' + r4c.json.msg}`);
  } catch (e) { console.log(`  ❌ ${e.message}`); }

  console.log('\n══════════════════════════════════════════');
  console.log('全部测试完成');
  console.log('══════════════════════════════════════════');
})();

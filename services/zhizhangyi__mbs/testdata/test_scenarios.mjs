// MBS 场景测试: test2停用 / test1设备激活停用 / test1开启设备管控
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

const { appkey, orgCode } = C;
const uid1 = '1691979294102310912'; // test1
const uid2 = '1691979421122613248'; // test2

// 辅助: 查详情
const detail = async (uid) => {
  const r = await post('/v1/detailUser', { userId: uid, orgCode, appkey, sign: sign(appkey, orgCode, uid) });
  return r.json?.data;
};

(async () => {
  // 先查初始状态
  console.log('=== 初始状态 ===');
  let d1 = await detail(uid1);
  let d2 = await detail(uid2);
  console.log(`test1: state=${d1.state} isMdm=${d1.isMdm}`);
  console.log(`test2: state=${d2.state} isMdm=${d2.isMdm}`);

  // ═══ 场景1: test2 用户状态 → 停用 (state=0) ═══
  console.log('\n═══ 场景1: test2 用户状态 → 停用 (state=0) ═══');
  const r1 = await post('/v1/stateUsers', {
    userIds: [uid2], type: 0, state: '0',
    orgCode, appkey,
    sign: sign(appkey, orgCode, uid2, 0, '0', ''),
  });
  console.log(`  stateUsers -> HTTP ${r1.status} code=${r1.json.code} ${r1.json.code === 0 ? '✅' : '❌'}`);
  d2 = await detail(uid2);
  console.log(`  验证: test2 state=${d2.state} ${d2.state === 0 ? '✅ 已停用' : '⚠️'}`);

  // 恢复 test2
  await post('/v1/stateUsers', {
    userIds: [uid2], type: 0, state: '1',
    orgCode, appkey,
    sign: sign(appkey, orgCode, uid2, 0, '1', ''),
  });

  // ═══ 场景2: test1 设备激活状态 → 停用 (state=0) ═══
  console.log('\n═══ 场景2: test1 设备激活状态 → 停用 (state=0) ═══');
  const r2 = await post('/v1/stateUsers', {
    userIds: [uid1], type: 0, state: '0',
    orgCode, appkey,
    sign: sign(appkey, orgCode, uid1, 0, '0', ''),
  });
  console.log(`  stateUsers -> HTTP ${r2.status} code=${r2.json.code} ${r2.json.code === 0 ? '✅' : '❌'}`);
  d1 = await detail(uid1);
  console.log(`  验证: test1 state=${d1.state} ${d1.state === 0 ? '✅ 已停用' : '⚠️'}`);

  // 恢复 test1
  await post('/v1/stateUsers', {
    userIds: [uid1], type: 0, state: '1',
    orgCode, appkey,
    sign: sign(appkey, orgCode, uid1, 0, '1', ''),
  });

  // ═══ 场景3: test1 开启设备管控 (isMdm=1) ═══
  console.log('\n═══ 场景3: test1 开启设备管控 (isMdm=1) ═══');
  console.log('  调用 updUser 设置 isMdm=1 ...');
  const r3 = await post('/v1/updUser', {
    userId: uid1,
    userName: '测试1',
    loginName: 'test1',
    deptId: '1',
    isMdm: 1,
    orgCode, appkey,
    sign: sign(appkey, orgCode, uid1, '测试1', 'test1', '1'),
  });
  console.log(`  updUser -> HTTP ${r3.status} code=${r3.json.code} ${r3.json.code === 0 ? '✅' : '❌ ' + r3.json.msg}`);
  d1 = await detail(uid1);
  console.log(`  验证: test1 isMdm=${d1.isMdm} ${d1.isMdm === 1 ? '✅ 设备管控已开启' : '⚠️'}`);
  console.log(`        test1 state=${d1.state} (应仍为1-启用)`);

  console.log('\n=== 全部场景测试完成 ===');
})();

// MBS getUsers API 直连测试
// 不依赖 OctoBus SDK，直接用 Node.js 原生 fetch 调用

import crypto from 'node:crypto';
import https from 'node:https';

const CONFIG = {
  baseUrl: process.env.MBS_BASE_URL || 'https://127.0.0.1:9074',
  orgCode: process.env.MBS_ORG_CODE || '',
  appkey: process.env.MBS_APPKEY || '',
  secretkey: process.env.MBS_SECRETKEY || '',
};

const md5 = (s) => crypto.createHash('md5').update(s, 'utf8').digest('hex');

// sign = MD5(appkey + orgCode + index + size + orderCode + orderType + keyword + state + isMdm + deptId + secretkey)
// 拼接时不包含 "+"
const computeSign = (params) => {
  const joined = params.map((p) => (p === undefined || p === null ? '' : String(p))).join('');
  return md5(joined + CONFIG.secretkey);
};

const requireConfig = () => {
  const missing = Object.entries(CONFIG).filter(([, value]) => !value).map(([key]) => key);
  if (missing.length > 0) {
    throw new Error(`Missing MBS test config: ${missing.join(', ')}. Set MBS_BASE_URL, MBS_ORG_CODE, MBS_APPKEY and MBS_SECRETKEY.`);
  }
};

const testGetUsers = async () => {
  requireConfig();
  const { baseUrl, orgCode, appkey } = CONFIG;

  const index = 0;
  const size = 10;
  const orderCode = 0;
  const orderType = 1;
  const keyword = '';
  const state = '';
  const isMdm = '';
  const deptId = '1';

  const sign = computeSign([appkey, orgCode, index, size, orderCode, orderType, keyword, state, isMdm, deptId]);

  const body = {
    index,
    size,
    orderCode,
    orderType,
    condition: { deptId, keyWord: keyword },
    orgCode,
    appkey,
    sign,
  };

  console.log('=== MBS getUsers 测试 ===');
  console.log('URL:', `${baseUrl}/uusafe/mos/thirdaccess/rest/opt/v1/getUsers`);
  console.log('Body:', JSON.stringify(body, null, 2));
  console.log('Sign:', sign);
  console.log('');

  // 忽略自签名证书
  const agent = new https.Agent({ rejectUnauthorized: false });

  try {
    const res = await fetch(`${baseUrl}/uusafe/mos/thirdaccess/rest/opt/v1/getUsers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(body),
      agent,
    });

    const text = await res.text();
    console.log('HTTP Status:', res.status);
    console.log('Response headers:', Object.fromEntries(res.headers.entries()));

    let json;
    try {
      json = JSON.parse(text);
      console.log('\n✅ 响应 JSON:');
      console.log(JSON.stringify(json, null, 2));

      if (json.code === 0) {
        console.log(`\n✅ 成功！共 ${json.data?.total ?? 0} 个用户`);
        const users = json.data?.userInfos;
        if (Array.isArray(users)) {
          users.forEach((u, i) => {
            console.log(`  [${i + 1}] ${u.userName} (${u.loginName}) - ${u.deptName} - ${u.state === 1 ? '启用' : u.state === 0 ? '停用' : '未激活'}`);
          });
        }
      } else {
        console.log(`\n❌ MBS 返回错误: code=${json.code}, msg=${json.msg}`);
      }
    } catch {
      console.log('\n⚠️ 非 JSON 响应:');
      console.log(text.substring(0, 500));
    }
  } catch (e) {
    console.log('\n❌ 网络错误:', e.message);
    if (e.cause) console.log('  原因:', e.cause.message);
  }
};

testGetUsers();

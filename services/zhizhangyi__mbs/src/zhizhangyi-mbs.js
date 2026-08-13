// MBS User Management API Proxy - Part 1: helpers + first 6 handlers
import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';
import crypto from 'node:crypto';
import { Agent } from 'undici';

const DEF_TO = 30000;
const BASE = '/uusafe/mos/thirdaccess/rest/opt';
const insecureDispatcher = new Agent({ connect: { rejectUnauthorized: false } });

const has = (o, k) => Object.prototype.hasOwnProperty.call(o ?? {}, k);
const first = (...vs) => vs.find((v) => v !== undefined && v !== null);
const merge = (ctx = {}) => ({ ...(ctx?.config ?? {}), ...(ctx?.secret ?? {}), ...(ctx?.bindings ?? {}) });
const normUrl = (u) => /^https?:\/\//i.test(String(u || '').trim()) ? String(u).trim().replace(/\/$/, '') : null;
const md5 = (s) => crypto.createHash('md5').update(s, 'utf8').digest('hex');
const signCalc = (sk, ...ps) => md5(ps.map((p) => (p === undefined || p === null ? '' : String(p))).join('') + String(sk || ''));
const arr = (v) => Array.isArray(v) ? v : [];
const str = (v) => (v === undefined || v === null || v === '') ? undefined : String(v);
const num = (v) => {
  if (v === undefined || v === null || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};
const gc = (c) => ({ INVALID_ARGUMENT: grpcStatus.INVALID_ARGUMENT, FAILED_PRECONDITION: grpcStatus.FAILED_PRECONDITION, PERMISSION_DENIED: grpcStatus.PERMISSION_DENIED, UNAVAILABLE: grpcStatus.UNAVAILABLE, DEADLINE_EXCEEDED: grpcStatus.DEADLINE_EXCEEDED })[c] ?? grpcStatus.UNKNOWN;
const er = (c, m) => { const e = new GrpcError(gc(c), c + ': ' + m); e.legacyCode = c; return e; };
const doFetch = async (url, init, to, st) => {
  const signal = to ? AbortSignal.timeout(Number(to)) : undefined;
  try { return await fetch(url, { ...init, ...(st && { dispatcher: insecureDispatcher }), ...(signal && { signal }) }); } catch (e) { throw er('UNAVAILABLE', e?.cause?.message || e?.message || 'fetch failed'); }
};
const rdJson = async (res) => { const t = await res.text(); if (!res.ok) { const safe = t.length > 200 ? t.slice(0, 200) + '...' : t; throw er(res.status === 401 || res.status === 403 ? 'PERMISSION_DENIED' : res.status >= 400 && res.status < 500 ? 'FAILED_PRECONDITION' : 'UNAVAILABLE', 'http ' + res.status + ': ' + safe); } if (!t.trim()) return {}; try { return JSON.parse(t); } catch { throw er('UNKNOWN', 'not JSON'); } };
const check = (j) => { if (j.code !== undefined && j.code !== 0) throw er('FAILED_PRECONDITION', 'MBS code=' + j.code + ': ' + (j.msg || '')); };
const buildCond = (cond) => { const c = {}; const kw = first(cond?.key_word, cond?.keyWord); if (kw !== undefined) c.keyWord = kw; if (cond?.status !== undefined && cond?.status !== null) c.status = cond.status; const im = first(cond?.is_mdm, cond?.isMdm); if (im !== undefined) c.isMdm = im; const did = first(cond?.dept_id, cond?.deptId); if (did !== undefined) c.deptId = did; return c; };
const toValue = (value) => {
  if (value === undefined || value === null) return { nullValue: 'NULL_VALUE' };
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'number') return Number.isFinite(value) ? { numberValue: value } : { stringValue: String(value) };
  if (typeof value === 'boolean') return { boolValue: value };
  if (Array.isArray(value)) return { listValue: { values: value.map((item) => toValue(item)) } };
  if (typeof value === 'object') {
    const fields = {};
    for (const [k, v] of Object.entries(value)) fields[k] = toValue(v);
    return { structValue: { fields } };
  }
  return { stringValue: String(value) };
};

const mapUser = (it) => ({ user_id: it?.userId ?? '', user_name: it?.userName ?? '', login_name: it?.loginName ?? '', phone_number: it?.phoneNumber ?? '', email: it?.email ?? '', employee_number: it?.employeeNumber ?? '', dept_id: it?.deptId ?? '', dept_name: it?.deptName ?? '', device_count: it?.deviceCount ?? 0, is_mdm: it?.isMdm ?? 0, state: it?.state ?? 0, is_admin: it?.isAdmin ?? 0, user_source: it?.userSource ?? 0, status: it?.status ?? 0, weight: it?.weight ?? 0, attrs: arr(it?.attrs).map((a) => ({ attr_key: a?.attrKey ?? '', attr_value: a?.attrValue ?? '' })), dept_full_id: it?.deptFullId ?? '', dept_full_path: it?.deptFullPath ?? '', job: it?.job ?? '', mobile: it?.mobile ?? '', address: it?.address ?? '', organization: it?.organization ?? '' });
const mapDetail = (it) => ({ user_id: it?.userId ?? '', user_name: it?.userName ?? '', login_name: it?.loginName ?? '', dept_id: it?.deptId ?? '', dept_name: it?.deptName ?? '', phone_number: it?.phoneNumber ?? '', job: it?.job ?? '', employee_number: it?.employeeNumber ?? '', address: it?.address ?? '', mobile: it?.mobile ?? '', email: it?.email ?? '', organization: it?.organization ?? '', is_mdm: it?.isMdm ?? 0, state: it?.state ?? 0, weight: it?.weight ?? 0, icon_file_id: it?.iconFileId ?? '', attrs: arr(it?.attrs).map((a) => ({ attr_key: a?.attrKey ?? '', attr_value: a?.attrValue ?? '' })) });
const mapPhone = (it) => ({ user_id: it?.userId ?? '', user_name: it?.userName ?? '', login_name: it?.loginName ?? '', phone_number: it?.phoneNumber ?? '', email: it?.email ?? '' });

const M = {
  GetUsers: 'zhizhangyi.mbs.UserManagement/GetUsers',
  AddUser: 'zhizhangyi.mbs.UserManagement/AddUser',
  UpdUser: 'zhizhangyi.mbs.UserManagement/UpdUser',
  DetailUser: 'zhizhangyi.mbs.UserManagement/DetailUser',
  DelUsers: 'zhizhangyi.mbs.UserManagement/DelUsers',
  StateUsers: 'zhizhangyi.mbs.UserManagement/StateUsers',
  CheckLoginName: 'zhizhangyi.mbs.UserManagement/CheckLoginName',
  GetUserByPhone: 'zhizhangyi.mbs.UserManagement/GetUserByPhone',
  UpdUserPwd: 'zhizhangyi.mbs.UserManagement/UpdUserPwd',
  ForceOffline: 'zhizhangyi.mbs.UserManagement/ForceOffline',
  ImportUser: 'zhizhangyi.mbs.UserManagement/ImportUser',
};

export function rpcdef(ctx) {
  const b = merge(ctx);
  const baseUrl = normUrl(b.endpoint || b.baseUrl || '');
  const to = ctx?.limits?.timeoutMs || b.timeoutMs || DEF_TO;
  const skipTls = Boolean(b.skipTlsVerify);
  const ak = b.appkey || '';
  const sk = b.secretkey || '';
  const ocDef = b.orgCode || '';

  const post = async (path, body) => {
    if (!baseUrl) throw er('INVALID_ARGUMENT', 'endpoint/baseUrl required');
    const r = await doFetch(baseUrl + path, { method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' }, body: JSON.stringify(body) }, to, skipTls);
    const j = await rdJson(r); check(j); return j;
  };

  // 6.2.1 GetUsers
  const goGetUsers = async (req) => {
    const oc = first(req?.org_code, req?.orgCode) || ocDef;
    const apk = first(req?.appkey) || ak;
    const idx = first(req?.index) ?? 0; const sz = first(req?.size) ?? 10;
    const odc = first(req?.order_code, req?.orderCode) ?? 0; const odt = first(req?.order_type, req?.orderType) ?? 1;
    const did = first(req?.condition?.dept_id, req?.condition?.deptId);
    if (!did) throw er('INVALID_ARGUMENT', 'dept_id required');
    const kw = first(req?.condition?.key_word, req?.condition?.keyWord) || '';
    const st = first(req?.condition?.state) ?? ''; const md = first(req?.condition?.is_mdm, req?.condition?.isMdm) ?? '';
    const sg = first(req?.sign) || signCalc(sk, apk, oc, idx, sz, odc, odt, kw, st, md, did);
    const cond = { deptId: did, keyWord: kw }; if (st !== '') cond.state = st; if (md !== '') cond.isMdm = md;
    const j = await post(BASE + '/v1/getUsers', { index: Number(idx), size: Number(sz), orderCode: Number(odc), orderType: Number(odt), condition: cond, orgCode: oc, appkey: apk, sign: sg });
    const d = j?.data || {};
    return { code: j?.code ?? 0, msg: j?.msg ?? '', data: { total: d.total ?? 0, user_infos: arr(d.userInfos).map(mapUser) }, time_stamp: j?.timeStamp ?? '' };
  };

  // 6.2.2 AddUser
  const goAddUser = async (req) => {
    const oc = first(req?.org_code, req?.orgCode) || ocDef; const apk = first(req?.appkey) || ak;
    const un = first(req?.user_name, req?.userName) || ''; const ln = first(req?.login_name, req?.loginName) || '';
    const did = first(req?.dept_id, req?.deptId) || ''; const encryptedPw = first(req?.password) || '';
    if (!un) throw er('INVALID_ARGUMENT', 'user_name required'); if (!ln) throw er('INVALID_ARGUMENT', 'login_name required'); if (!did) throw er('INVALID_ARGUMENT', 'dept_id required'); if (!encryptedPw) throw er('INVALID_ARGUMENT', 'password required as 3DES-encrypted value');
    const sg = first(req?.sign) || signCalc(sk, apk, oc, un, ln, did, encryptedPw);
    const body = { userName: un, loginName: ln, deptId: did, password: encryptedPw, orgCode: oc, appkey: apk, sign: sg };
    const userSource = num(first(req?.user_source, req?.userSource));
    if (userSource !== undefined) body.userSource = userSource;
    const sm = { phone_number: 'phoneNumber', job: 'job', employee_number: 'employeeNumber', address: 'address', mobile: 'mobile', email: 'email', organization: 'organization' };
    for (const [k, jk] of Object.entries(sm)) { const v = str(first(req?.[k])); if (v !== undefined) body[jk] = v; }
    for (const k of ['is_mdm', 'state', 'weight']) { const v = num(first(req?.[k])); if (v !== undefined) body[k === 'is_mdm' ? 'isMdm' : k] = v; }
    if (arr(req?.attrs).length > 0) body.attrs = req.attrs.map((a) => ({ attrKey: a?.attr_key ?? '', attrValue: a?.attr_value ?? '' }));
    const j = await post(BASE + '/v1/addUser', body);
    return { code: j?.code ?? 0, msg: j?.msg ?? '', data: toValue(j?.data ?? null) };
  };

  // 6.2.3 UpdUser
  const goUpdUser = async (req) => {
    const oc = first(req?.org_code, req?.orgCode) || ocDef; const apk = first(req?.appkey) || ak;
    const uid = first(req?.user_id, req?.userId) || ''; const un = first(req?.user_name, req?.userName) || '';
    if (!uid) throw er('INVALID_ARGUMENT', 'user_id required'); if (!un) throw er('INVALID_ARGUMENT', 'user_name required');
    const ln = str(first(req?.login_name, req?.loginName)); const did = first(req?.dept_id, req?.deptId) || '';
    if (!did) throw er('INVALID_ARGUMENT', 'dept_id required');
    const sg = first(req?.sign) || signCalc(sk, apk, oc, uid, un, ln ?? '', did);
    const body = { userId: uid, userName: un, deptId: did, orgCode: oc, appkey: apk, sign: sg };
    if (ln !== undefined) body.loginName = ln;
    const sm = { phone_number: 'phoneNumber', job: 'job', employee_number: 'employeeNumber', address: 'address', mobile: 'mobile', email: 'email', organization: 'organization' };
    for (const [k, jk] of Object.entries(sm)) { const v = str(first(req?.[k])); if (v !== undefined) body[jk] = v; }
    for (const k of ['is_mdm', 'weight']) { const v = num(first(req?.[k])); if (v !== undefined) body[k === 'is_mdm' ? 'isMdm' : k] = v; }
    if (arr(req?.attrs).length > 0) body.attrs = req.attrs.map((a) => ({ attrKey: a?.attr_key ?? '', attrValue: a?.attr_value ?? '' }));
    const j = await post(BASE + '/v1/updUser', body);
    return { code: j?.code ?? 0, msg: j?.msg ?? '', data: toValue(j?.data ?? null) };
  };

  // 6.2.4 DetailUser
  const goDetailUser = async (req) => {
    const oc = first(req?.org_code, req?.orgCode) || ocDef; const apk = first(req?.appkey) || ak;
    const uid = first(req?.user_id, req?.userId) || ''; if (!uid) throw er('INVALID_ARGUMENT', 'user_id required');
    const sg = first(req?.sign) || signCalc(sk, apk, oc, uid);
    const j = await post(BASE + '/v1/detailUser', { userId: uid, orgCode: oc, appkey: apk, sign: sg });
    return { code: j?.code ?? 0, msg: j?.msg ?? '', data: j?.data ? mapDetail(j.data) : null };
  };

  // 6.2.5 DelUsers
  const goDelUsers = async (req) => {
    const oc = first(req?.org_code, req?.orgCode) || ocDef; const apk = first(req?.appkey) || ak;
    const tp = Number(first(req?.type) ?? 0); const uids = arr(first(req?.user_ids, req?.userIds));
    if (tp !== 0 && tp !== 1) throw er('INVALID_ARGUMENT', 'type must be 0 or 1');
    const c = buildCond(req?.condition);
    if (tp === 0 && uids.length === 0) throw er('INVALID_ARGUMENT', 'user_ids required for type=0');
    if (tp === 1 && Object.keys(c).length === 0) throw er('INVALID_ARGUMENT', 'condition required for type=1');
    const signParams = tp === 0
      ? [uids.join(','), tp]
      : [uids.join(','), tp, c.keyWord ?? '', c.status ?? '', c.isMdm ?? '', c.deptId ?? ''];
    const sg = first(req?.sign) || signCalc(sk, apk, oc, ...signParams);
    const body = { type: tp, orgCode: oc, appkey: apk, sign: sg };
    if (tp === 0) { body.userIds = uids; } else if (Object.keys(c).length > 0) body.condition = c;
    const j = await post(BASE + '/v1/delUsers', body);
    return { code: j?.code ?? 0, msg: j?.msg ?? '', data: toValue(j?.data ?? null) };
  };

  // 6.2.6 StateUsers
  const goStateUsers = async (req) => {
    const oc = first(req?.org_code, req?.orgCode) || ocDef; const apk = first(req?.appkey) || ak;
    const tp = Number(first(req?.type) ?? 0); const st = first(req?.state);
    if (tp !== 0 && tp !== 1) throw er('INVALID_ARGUMENT', 'type must be 0 or 1');
    if (st === undefined || st === null) throw er('INVALID_ARGUMENT', 'state required');
    const uids = arr(first(req?.user_ids, req?.userIds));
    const c = buildCond(req?.condition);
    if (tp === 0 && uids.length === 0) throw er('INVALID_ARGUMENT', 'user_ids required for type=0');
    if (tp === 1 && Object.keys(c).length === 0) throw er('INVALID_ARGUMENT', 'condition required for type=1');
    const signParams = tp === 0
      ? [uids.join(','), tp, st, '']
      : [uids.join(','), tp, st, c.keyWord ?? '', c.status ?? '', c.isMdm ?? '', c.deptId ?? ''];
    const sg = first(req?.sign) || signCalc(sk, apk, oc, ...signParams);
    const body = { type: tp, state: st, orgCode: oc, appkey: apk, sign: sg };
    if (tp === 0) { body.userIds = uids; } else if (Object.keys(c).length > 0) body.condition = c;
    const j = await post(BASE + '/v1/stateUsers', body);
    return { code: j?.code ?? 0, msg: j?.msg ?? '', data: toValue(j?.data ?? null) };
  };

  // 6.2.7 CheckLoginName
  const goCheckLoginName = async (req) => {
    const oc = first(req?.org_code, req?.orgCode) || ocDef; const apk = first(req?.appkey) || ak;
    const ln = first(req?.login_name, req?.loginName) || ''; if (!ln) throw er('INVALID_ARGUMENT', 'login_name required');
    const sg = first(req?.sign) || signCalc(sk, apk, oc, ln);
    const j = await post(BASE + '/v1/checkLoginName', { loginName: ln, orgCode: oc, appkey: apk, sign: sg });
    return { code: j?.code ?? 0, msg: j?.msg ?? '', data: toValue(j?.data ?? null) };
  };

  // 6.2.8 GetUserByPhone
  const goGetUserByPhone = async (req) => {
    const oc = first(req?.org_code, req?.orgCode) || ocDef; const apk = first(req?.appkey) || ak;
    const ph = first(req?.phone) || ''; if (!ph) throw er('INVALID_ARGUMENT', 'phone required');
    const sg = first(req?.sign) || signCalc(sk, apk, oc, ph);
    const j = await post(BASE + '/v1/getUserByPhone', { phone: ph, orgCode: oc, appkey: apk, sign: sg });
    return { code: j?.code ?? 0, msg: j?.msg ?? '', data: arr(j?.data).map(mapPhone) };
  };

  // 6.2.9/6.2.10 UpdUserPwd
  const goUpdUserPwd = async (req) => {
    const oc = first(req?.org_code, req?.orgCode) || ocDef; const apk = first(req?.appkey) || ak;
    const ver = first(req?.version) || 'v1';
    if (ver !== 'v1' && ver !== 'v2') throw er('INVALID_ARGUMENT', 'version must be v1 or v2');
    let body;
    if (ver === 'v2') {
      const ln = first(req?.login_name, req?.loginName) || ''; const encryptedNewPwd = first(req?.new_pwd, req?.newPwd) || '';
      if (!ln) throw er('INVALID_ARGUMENT', 'login_name required for v2'); if (!encryptedNewPwd) throw er('INVALID_ARGUMENT', 'new_pwd required as 3DES-encrypted value for v2');
      const sg = first(req?.sign) || signCalc(sk, apk, oc, ln, encryptedNewPwd);
      body = { loginName: ln, newPwd: encryptedNewPwd, orgCode: oc, appkey: apk, sign: sg };
      const encryptedOldPwd = first(req?.old_pwd, req?.oldPwd); if (encryptedOldPwd) body.oldPwd = encryptedOldPwd;
    } else {
      const uid = first(req?.user_id, req?.userId) || ''; const encryptedPw = first(req?.password) || '';
      if (!uid) throw er('INVALID_ARGUMENT', 'user_id required for v1'); if (!encryptedPw) throw er('INVALID_ARGUMENT', 'password required as 3DES-encrypted value for v1');
      const sg = first(req?.sign) || signCalc(sk, apk, oc, uid, encryptedPw);
      body = { userId: uid, password: encryptedPw, orgCode: oc, appkey: apk, sign: sg };
    }
    const j = await post(BASE + `/${ver}/updUserPwd`, body);
    return { code: j?.code ?? 0, msg: j?.msg ?? '', data: toValue(j?.data ?? null) };
  };

  // 6.2.11 ForceOffline
  const goForceOffline = async (req) => {
    const oc = first(req?.org_code, req?.orgCode) || ocDef; const apk = first(req?.appkey) || ak;
    const uid = first(req?.user_id, req?.userId) || ''; if (!uid) throw er('INVALID_ARGUMENT', 'user_id required');
    const sg = first(req?.sign) || signCalc(sk, apk, oc, uid);
    const j = await post(BASE + '/v1/forceOffline', { userId: uid, orgCode: oc, appkey: apk, sign: sg });
    return { code: j?.code ?? 0, msg: j?.msg ?? '', data: toValue(j?.data ?? null) };
  };

  // 6.2.12 ImportUser
  const goImportUser = async (req) => {
    const oc = first(req?.org_code, req?.orgCode) || ocDef; const apk = first(req?.appkey) || ak;
    const lang = first(req?.lang) ?? 0; const fid = first(req?.file_id, req?.fileId) || '';
    if (!fid) throw er('INVALID_ARGUMENT', 'file_id required');
    const sg = first(req?.sign) || signCalc(sk, apk, oc, lang, fid);
    const j = await post(BASE + '/v1/importUser', { lang: Number(lang), fileId: fid, orgCode: oc, appkey: apk, sign: sg });
    return { code: j?.code ?? 0, msg: j?.msg ?? '', data: toValue(j?.data ?? null) };
  };

  return {
    [M.GetUsers]: async () => goGetUsers(ctx.req || {}),
    [M.AddUser]: async () => goAddUser(ctx.req || {}),
    [M.UpdUser]: async () => goUpdUser(ctx.req || {}),
    [M.DetailUser]: async () => goDetailUser(ctx.req || {}),
    [M.DelUsers]: async () => goDelUsers(ctx.req || {}),
    [M.StateUsers]: async () => goStateUsers(ctx.req || {}),
    [M.CheckLoginName]: async () => goCheckLoginName(ctx.req || {}),
    [M.GetUserByPhone]: async () => goGetUserByPhone(ctx.req || {}),
    [M.UpdUserPwd]: async () => goUpdUserPwd(ctx.req || {}),
    [M.ForceOffline]: async () => goForceOffline(ctx.req || {}),
    [M.ImportUser]: async () => goImportUser(ctx.req || {}),
  };
}


// Legacy handler wrapper
function wrapLegacyHandler(baseCtx, methodPath) {
  return async function(reqOrCtx, maybeInnerCtx) {
    var incoming = (reqOrCtx && typeof reqOrCtx === 'object') ? reqOrCtx : {};
    var callCtx = {
      ...(baseCtx ?? {}),
      ...incoming,
      req: incoming.request ?? incoming.req ?? reqOrCtx ?? {},
      request: incoming.request ?? incoming.req ?? reqOrCtx ?? {},
      config: incoming.config ?? baseCtx?.config,
      secret: incoming.secret ?? baseCtx?.secret,
      metadata: incoming.metadata ?? baseCtx?.metadata,
      meta: incoming.meta ?? baseCtx?.meta,
      getMetadata: incoming.getMetadata ?? baseCtx?.getMetadata,
      getMetadataAll: incoming.getMetadataAll ?? baseCtx?.getMetadataAll,
    };
    return rpcdef(callCtx)[methodPath]();
  };
}

function registerHandlers(ctx) {
  return {
    [M.GetUsers]: wrapLegacyHandler(ctx, M.GetUsers),
    [M.AddUser]: wrapLegacyHandler(ctx, M.AddUser),
    [M.UpdUser]: wrapLegacyHandler(ctx, M.UpdUser),
    [M.DetailUser]: wrapLegacyHandler(ctx, M.DetailUser),
    [M.DelUsers]: wrapLegacyHandler(ctx, M.DelUsers),
    [M.StateUsers]: wrapLegacyHandler(ctx, M.StateUsers),
    [M.CheckLoginName]: wrapLegacyHandler(ctx, M.CheckLoginName),
    [M.GetUserByPhone]: wrapLegacyHandler(ctx, M.GetUserByPhone),
    [M.UpdUserPwd]: wrapLegacyHandler(ctx, M.UpdUserPwd),
    [M.ForceOffline]: wrapLegacyHandler(ctx, M.ForceOffline),
    [M.ImportUser]: wrapLegacyHandler(ctx, M.ImportUser),
  };
}

var sdkHandlers = registerHandlers({});

export var handlers = {
  [M.GetUsers]: (ctx) => sdkHandlers[M.GetUsers](ctx),
  [M.AddUser]: (ctx) => sdkHandlers[M.AddUser](ctx),
  [M.UpdUser]: (ctx) => sdkHandlers[M.UpdUser](ctx),
  [M.DetailUser]: (ctx) => sdkHandlers[M.DetailUser](ctx),
  [M.DelUsers]: (ctx) => sdkHandlers[M.DelUsers](ctx),
  [M.StateUsers]: (ctx) => sdkHandlers[M.StateUsers](ctx),
  [M.CheckLoginName]: (ctx) => sdkHandlers[M.CheckLoginName](ctx),
  [M.GetUserByPhone]: (ctx) => sdkHandlers[M.GetUserByPhone](ctx),
  [M.UpdUserPwd]: (ctx) => sdkHandlers[M.UpdUserPwd](ctx),
  [M.ForceOffline]: (ctx) => sdkHandlers[M.ForceOffline](ctx),
  [M.ImportUser]: (ctx) => sdkHandlers[M.ImportUser](ctx),
};

const { login, authenticatedRequest, mapPayload, normalizeInvocation } = require('./client.js');
const site = require('./modules/site.js');
const policy = require('./modules/policy.js');
const acpolicy = require('./modules/acpolicy.js');
const lists = require('./modules/lists.js');
const monitor = require('./modules/monitor.js');
const system = require('./modules/system.js');

const SERVICE_PACKAGE = 'HILLSTONE_WAF_V55R12.HILLSTONE_WAF_V55R12';

const METHOD_LOGIN_FULL = `${SERVICE_PACKAGE}/Login`;
const METHOD_GET_LOGIN_STATUS_FULL = `${SERVICE_PACKAGE}/GetLoginStatus`;
const METHOD_LOGOUT_FULL = `${SERVICE_PACKAGE}/Logout`;
const METHOD_LIST_WEBSITES_FULL = `${SERVICE_PACKAGE}/ListWebsites`;
const METHOD_GET_WEBSITE_FULL = `${SERVICE_PACKAGE}/GetWebsite`;
const METHOD_CREATE_WEBSITE_FULL = `${SERVICE_PACKAGE}/CreateWebsite`;
const METHOD_UPDATE_WEBSITE_FULL = `${SERVICE_PACKAGE}/UpdateWebsite`;
const METHOD_DELETE_WEBSITE_FULL = `${SERVICE_PACKAGE}/DeleteWebsite`;
const METHOD_QUERY_WAF_POLICY_FULL = `${SERVICE_PACKAGE}/QueryWafPolicy`;
const METHOD_UPDATE_WAF_POLICY_FULL = `${SERVICE_PACKAGE}/UpdateWafPolicy`;
const METHOD_QUERY_WAF_AC_POLICY_FULL = `${SERVICE_PACKAGE}/QueryWafAcPolicy`;
const METHOD_UPDATE_WAF_AC_POLICY_FULL = `${SERVICE_PACKAGE}/UpdateWafAcPolicy`;
const METHOD_LIST_BLOCKLIST_FULL = `${SERVICE_PACKAGE}/ListBlocklist`;
const METHOD_LIST_ALLOWLIST_FULL = `${SERVICE_PACKAGE}/ListAllowlist`;
const METHOD_LIST_EXCEPTION_LIST_FULL = `${SERVICE_PACKAGE}/ListExceptionList`;
const METHOD_GET_SYS_INFO_FULL = `${SERVICE_PACKAGE}/GetSysInfo`;
const METHOD_LIST_VSYS_FULL = `${SERVICE_PACKAGE}/ListVsys`;
const METHOD_GET_WEB_SECURITY_LOG_FULL = `${SERVICE_PACKAGE}/GetWebSecurityLog`;

async function doLogin(input, ctx) {
  const normalized = normalizeInvocation(input, ctx);
  const result = await login(normalized.ctx, normalized.request);
  return { success: true, result: [result], total: 0 };
}

async function getLoginStatus(input, ctx) {
  const normalized = normalizeInvocation(input, ctx);
  const { payload } = await authenticatedRequest(normalized.ctx, 'GET', '/rest/api/login', normalized.request);
  return payload;
}

async function logout(input, ctx) {
  const normalized = normalizeInvocation(input, ctx);
  const request = normalized.request;
  const sessionRequest = { ...request };
  const { payload } = await authenticatedRequest(normalized.ctx, 'DELETE', '/rest/api/login', sessionRequest, {
    body: {
      username: request.username || normalized.ctx?.secrets?.username || 'admin',
      protocol: normalized.ctx?.bindings?.protocol || 'https',
    },
  });
  return payload;
}

function wrapHandler(handler) {
  return async (input, ctx) => {
    const normalized = normalizeInvocation(input, ctx);
    return handler(normalized.request, normalized.ctx);
  };
}

const handlers = {
  [METHOD_LOGIN_FULL]: doLogin,
  [METHOD_GET_LOGIN_STATUS_FULL]: getLoginStatus,
  [METHOD_LOGOUT_FULL]: logout,
  [METHOD_LIST_WEBSITES_FULL]: wrapHandler(site.listWebsites),
  [METHOD_GET_WEBSITE_FULL]: wrapHandler(site.getWebsite),
  [METHOD_CREATE_WEBSITE_FULL]: wrapHandler(site.createWebsite),
  [METHOD_UPDATE_WEBSITE_FULL]: wrapHandler(site.updateWebsite),
  [METHOD_DELETE_WEBSITE_FULL]: wrapHandler(site.deleteWebsite),
  [METHOD_QUERY_WAF_POLICY_FULL]: wrapHandler(policy.queryWafPolicy),
  [METHOD_UPDATE_WAF_POLICY_FULL]: wrapHandler(policy.updateWafPolicy),
  [METHOD_QUERY_WAF_AC_POLICY_FULL]: wrapHandler(acpolicy.queryWafAcPolicy),
  [METHOD_UPDATE_WAF_AC_POLICY_FULL]: wrapHandler(acpolicy.updateWafAcPolicy),
  [METHOD_LIST_BLOCKLIST_FULL]: wrapHandler(lists.listBlocklist),
  [METHOD_LIST_ALLOWLIST_FULL]: wrapHandler(lists.listAllowlist),
  [METHOD_LIST_EXCEPTION_LIST_FULL]: wrapHandler(lists.listExceptionList),
  [METHOD_GET_SYS_INFO_FULL]: wrapHandler(system.getSysInfo),
  [METHOD_LIST_VSYS_FULL]: wrapHandler(system.listVsys),
  [METHOD_GET_WEB_SECURITY_LOG_FULL]: wrapHandler(monitor.getWebSecurityLog),
};

module.exports = {
  SERVICE_PACKAGE,
  METHOD_LOGIN_FULL,
  METHOD_GET_LOGIN_STATUS_FULL,
  METHOD_LOGOUT_FULL,
  METHOD_LIST_WEBSITES_FULL,
  METHOD_GET_WEBSITE_FULL,
  METHOD_CREATE_WEBSITE_FULL,
  METHOD_UPDATE_WEBSITE_FULL,
  METHOD_DELETE_WEBSITE_FULL,
  METHOD_QUERY_WAF_POLICY_FULL,
  METHOD_UPDATE_WAF_POLICY_FULL,
  METHOD_QUERY_WAF_AC_POLICY_FULL,
  METHOD_UPDATE_WAF_AC_POLICY_FULL,
  METHOD_LIST_BLOCKLIST_FULL,
  METHOD_LIST_ALLOWLIST_FULL,
  METHOD_LIST_EXCEPTION_LIST_FULL,
  METHOD_GET_SYS_INFO_FULL,
  METHOD_LIST_VSYS_FULL,
  METHOD_GET_WEB_SECURITY_LOG_FULL,
  handlers,
};

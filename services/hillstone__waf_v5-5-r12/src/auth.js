const { invalidArgument, unauthenticated } = require('./errors.js');

function asBase64(text) {
  return Buffer.from(String(text), 'utf8').toString('base64');
}

function getCredentialSource(ctx, input = {}) {
  return {
    username: input.username || ctx?.secrets?.username || ctx?.bindings?.username || ctx?.bindings?.user || '',
    password: input.password || ctx?.secrets?.password || ctx?.bindings?.password || '',
    apiToken: input.apiToken || ctx?.secrets?.apiToken || '',
    lang: input.lang || ctx?.bindings?.lang || 'zh_CN',
  };
}

function normalizeSession(result, fallbackUsername) {
  const first = Array.isArray(result?.result)
    ? result.result[0]
    : result?.result && typeof result.result === 'object' && result.result.token
      ? result.result
      : result;
  if (!first?.token) throw unauthenticated('Login did not return a valid token');
  return {
    token: first.token,
    fromrootvsys: String(first.fromrootvsys ?? 'true'),
    vsysId: String(first.vsysId ?? '0'),
    role: String(first.role ?? 'admin'),
    username: first.username || fallbackUsername,
    phpSessionId: result?.phpSessionId || '',
  };
}

function buildAuthHeaders(session) {
  if (!session?.token) throw unauthenticated('Missing auth token');
  const headers = {
    'X-Auth-Fromrootvsys': String(session.fromrootvsys ?? 'true'),
    'X-Auth-VsysId': String(session.vsysId ?? '0'),
    'X-Auth-Username': String(session.username || ''),
    'X-Auth-Role': String(session.role ?? 'admin'),
    'X-Auth-Token': String(session.token),
  };
  const cookieParts = [];
  const cookieValue = (value) => encodeURIComponent(String(value));
  if (session.phpSessionId) cookieParts.push(`PHPSESSID=${cookieValue(session.phpSessionId)}`);
  cookieParts.push(`username=${cookieValue(session.username || '')}`);
  cookieParts.push(`token=${cookieValue(session.token)}`);
  cookieParts.push(`vsysId=${cookieValue(session.vsysId ?? '0')}`);
  cookieParts.push(`role=${cookieValue(session.role ?? 'admin')}`);
  cookieParts.push(`fromrootvsys=${cookieValue(session.fromrootvsys ?? 'true')}`);
  headers.Cookie = cookieParts.join('; ');
  return headers;
}

function sessionFromInput(input = {}) {
  if (!input.token) return null;
  return {
    token: String(input.token),
    fromrootvsys: String(input.fromrootvsys ?? 'true'),
    vsysId: String(input.vsysId ?? '0'),
    role: String(input.role ?? 'admin'),
    username: String(input.username || ''),
    phpSessionId: String(input.phpSessionId || ''),
  };
}

function validateLoginSource(source) {
  if (source.apiToken) return;
  if (!source.username) throw invalidArgument('username is required');
  if (!source.password) throw invalidArgument('password is required');
}

module.exports = { asBase64, getCredentialSource, normalizeSession, buildAuthHeaders, sessionFromInput, validateLoginSource };

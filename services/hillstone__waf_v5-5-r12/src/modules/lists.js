const { authenticatedRequest, mapPayload } = require('../client.js');

async function listBlocklist(input, ctx) {
  const request = mapPayload(input);
  const { payload } = await authenticatedRequest(ctx, 'GET', '/rest/api/blocklist', request);
  return payload;
}

async function listAllowlist(input, ctx) {
  const request = mapPayload(input);
  const { payload } = await authenticatedRequest(ctx, 'GET', '/rest/api/allowlist', request);
  return payload;
}

async function listExceptionList(input, ctx) {
  const request = mapPayload(input);
  const { payload } = await authenticatedRequest(ctx, 'GET', '/rest/api/exceptionlist', request);
  return payload;
}

module.exports = { listBlocklist, listAllowlist, listExceptionList };

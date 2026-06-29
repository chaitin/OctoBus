const { authenticatedRequest, mapPayload } = require('../client.js');

async function queryWafAcPolicy(input, ctx) {
  const request = mapPayload(input);
  const { payload } = await authenticatedRequest(ctx, 'GET', '/rest/api/wafacpolicy', request);
  return payload;
}

async function updateWafAcPolicy(input, ctx) {
  const request = mapPayload(input);
  const body = request.policy || request.payload || request;
  const { payload } = await authenticatedRequest(ctx, 'PUT', '/rest/api/wafacpolicy', request, { body });
  return payload;
}

module.exports = { queryWafAcPolicy, updateWafAcPolicy };

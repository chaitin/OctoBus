const { authenticatedRequest, mapPayload } = require('../client.js');

async function queryWafPolicy(input, ctx) {
  const request = mapPayload(input);
  const { payload } = await authenticatedRequest(ctx, 'GET', '/rest/api/wafpolicy', request);
  return payload;
}

async function updateWafPolicy(input, ctx) {
  const request = mapPayload(input);
  const body = request.policy || request.payload || request;
  const { payload } = await authenticatedRequest(ctx, 'PUT', '/rest/api/wafpolicy', request, { body });
  return payload;
}

module.exports = { queryWafPolicy, updateWafPolicy };

const { authenticatedRequest, mapPayload } = require('../client.js');

async function getWebSecurityLog(input, ctx) {
  const request = mapPayload(input);
  const { payload } = await authenticatedRequest(ctx, 'GET', '/rest/api/websecuritylog', request);
  return payload;
}

module.exports = { getWebSecurityLog };

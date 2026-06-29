const { authenticatedRequest, mapPayload } = require('../client.js');

async function getSysInfo(input, ctx) {
  const request = mapPayload(input);
  const { payload } = await authenticatedRequest(ctx, 'GET', '/rest/api/sysinfo', request);
  return payload;
}

async function listVsys(input, ctx) {
  const request = mapPayload(input);
  const { payload } = await authenticatedRequest(ctx, 'GET', '/rest/api/vsys', request);
  return payload;
}

module.exports = { getSysInfo, listVsys };

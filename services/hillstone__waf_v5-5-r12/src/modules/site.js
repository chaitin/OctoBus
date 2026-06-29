const { authenticatedRequest, mapPayload } = require('../client.js');

async function listWebsites(input, ctx) {
  const { payload } = await authenticatedRequest(ctx, 'GET', '/rest/api/website', mapPayload(input));
  return payload;
}

async function getWebsite(input, ctx) {
  const request = mapPayload(input);
  const { payload } = await authenticatedRequest(ctx, 'GET', '/rest/api/website', request);
  return payload;
}

async function createWebsite(input, ctx) {
  const request = mapPayload(input);
  const rawBody = request.website || request.payload || request;
  const body = Array.isArray(rawBody) ? rawBody : [rawBody];
  const { payload } = await authenticatedRequest(ctx, 'POST', '/rest/api/website', request, { body });
  return payload;
}

async function updateWebsite(input, ctx) {
  const request = mapPayload(input);
  const body = request.website || request.payload || request;
  const { payload } = await authenticatedRequest(ctx, 'PUT', '/rest/api/website', request, { body });
  return payload;
}

async function deleteWebsite(input, ctx) {
  const request = mapPayload(input);
  const body = request.website || request.payload || request;
  const { payload } = await authenticatedRequest(ctx, 'DELETE', '/rest/api/website', request, { body });
  return payload;
}

module.exports = { listWebsites, getWebsite, createWebsite, updateWebsite, deleteWebsite };
